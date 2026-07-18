import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import {
  ResponsiveContainer,
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  usePlotArea,
  useXAxisScale,
  useYAxisScale,
  useXAxisInverseScale,
  useYAxisInverseScale,
} from 'recharts'
import { fetchRecords, fetchMetrics } from '../api/om'
import type { OmRecordDTO, OmMetricDTO, OmScoreDTO, NumericScoreKey, BoolFilter } from '../types'
import { NUMERIC_SCORE_KEYS, BOOL_SCORE_KEYS, METRIC_LABELS } from '../types'
import { getManifold, manifoldsForType, computeFrontierIndices, supportsScore, partialCompare, type Manifold, type OmType, type MetricId } from '../lib/manifold'
import type { UserSolutionRecord } from '../state/userSolutions'
import './ParetoChart.css'

const MARGIN = { top: 16, right: 24, bottom: 40, left: 56 }

function loadSetting(key: string, fallback: string): string {
  try { return localStorage.getItem(key) ?? fallback } catch { return fallback }
}

function saveSetting(key: string, value: string): void {
  try {
    if (value) localStorage.setItem(key, value)
    else localStorage.removeItem(key)
  } catch { }
}

interface ParetoPoint {
  x: number
  y: number
  id: string
  score: string | null
  categories: string | null
  recordIndex: number
  overlap: boolean
  trackless: boolean
  isUser?: boolean
  name?: string | null
  fullScore?: string
  green?: boolean
}

type PointClass = 'overlap' | 'trackless' | 'normal'

function classifyPoint(p: ParetoPoint): PointClass {
  if (p.overlap) return 'overlap'
  if (p.trackless) return 'trackless'
  return 'normal'
}

const CLASS_ORDER: PointClass[] = ['overlap', 'trackless', 'normal']

const CLASS_COLOR: Record<PointClass, string> = {
  normal: 'var(--text)',
  overlap: '#ff7bd7',
  trackless: '#8389fc',
}

const CLASS_FRONTIER_COLOR: Record<PointClass, string> = {
  normal: 'var(--accent)',
  overlap: '#ff7bd7',
  trackless: '#8389fc',
}

const FRONTIER_RADIUS = 5
const NORMAL_RADIUS = 3
const FRONTIER_OPACITY = 1
const NORMAL_OPACITY = 0.35

function makePointShape(radius: number, opacity: number, color: string) {
  return (props: { cx?: number; cy?: number }) => {
    const { cx, cy } = props
    if (cx == null || cy == null) return null
    return <circle cx={cx} cy={cy} r={radius} fill={color} fillOpacity={opacity} stroke={color} strokeWidth={0.5} />
  }
}

const USER_DIAMOND_RADIUS = 5
const USER_GREEN = '#22c55e'
const USER_RED = '#ef4444'

function makeDiamondShape(color: string) {
  const r = USER_DIAMOND_RADIUS
  return (props: { cx?: number; cy?: number }) => {
    const { cx, cy } = props
    if (cx == null || cy == null) return null
    const d = `M ${cx},${cy - r} L ${cx + r},${cy} L ${cx},${cy + r} L ${cx - r},${cy} Z`
    return <path d={d} fill={color} fillOpacity={1} stroke={color} strokeWidth={0.5} />
  }
}

interface ParetoChartProps {
  puzzleId: string
  userRecords: UserSolutionRecord[]
}

type ZoomDomain = { x: [number, number]; y: [number, number] }

function isNumeric(val: unknown): val is number {
  return typeof val === 'number' && Number.isFinite(val)
}

function getMetricValue(score: OmScoreDTO, key: string): number | null {
  if (key === 'sum') return score.cost + score.cycles + score.area
  if (key === 'sum4') return score.cost + score.cycles + score.area + score.instructions
  if (key === 'areaINF') {
    if (!isNumeric(score.areaINFLevel) || !isNumeric(score.areaINFValue)) return null
    return score.areaINFValue! * Math.pow(100000, score.areaINFLevel!)
  }
  const val: unknown = score[key as keyof OmScoreDTO]
  return isNumeric(val) ? val : null
}

function formatTick(n: number): string {
  const abs = Math.abs(n)
  if (abs >= 1e12) {
    const v = n / 1e12
    return Number.isInteger(v) ? `${v}T` : `${v.toFixed(1)}T`
  }
  if (abs >= 1e9) {
    const v = n / 1e9
    return Number.isInteger(v) ? `${v}G` : `${v.toFixed(1)}G`
  }
  if (abs >= 1e6) {
    const v = n / 1e6
    return Number.isInteger(v) ? `${v}M` : `${v.toFixed(1)}M`
  }
  if (abs >= 1e3) {
    const v = n / 1e3
    return Number.isInteger(v) ? `${v}K` : `${v.toFixed(1)}K`
  }
  return Number.isInteger(n) ? String(n) : n.toFixed(1)
}

function generateTicks(domain: [number, number], isInteger: boolean): number[] | undefined {
  const [lo, hi] = domain
  if (lo >= hi) return undefined
  const range = hi - lo
  const rawStep = range / 8
  const mag = Math.pow(10, Math.floor(Math.log(rawStep) / Math.LN10))
  const residual = rawStep / mag
  let step = 1
  if (residual <= 1.75) step = mag
  else if (residual <= 3.5) step = 2 * mag
  else if (residual <= 7.5) step = 5 * mag
  else step = 10 * mag
  const minStep = isInteger ? 1 : 0.5
  step = Math.max(minStep, step)
  const first = Math.ceil(lo / step) * step
  const ticks: number[] = []
  for (let t = first; t <= hi + 1e-9; t += step) {
    ticks.push(Math.round(t * 1e10) / 1e10)
  }
  return ticks.length > 1 ? ticks : undefined
}

function generateLogTicks(domain: [number, number]): number[] | undefined {
  const [lo, hi] = domain
  if (lo >= hi || lo <= 0) return undefined
  const ticks: number[] = []
  const startPow = Math.floor(Math.log10(lo))
  const endPow = Math.ceil(Math.log10(hi))
  for (let p = startPow; p <= endPow; p++) {
    const base = Math.pow(10, p)
    for (const m of [1, 2, 5]) {
      const v = base * m
      if (v >= lo && v <= hi) ticks.push(v)
    }
  }
  return ticks.length > 0 ? ticks : undefined
}

function niceUpperBound(max: number, isInteger: boolean): number {
  if (!Number.isFinite(max) || max <= 0) return 0
  const range = max
  const rawStep = range / 8
  const mag = Math.pow(10, Math.floor(Math.log(rawStep) / Math.LN10))
  const residual = rawStep / mag
  let step = 1
  if (residual <= 1.75) step = mag
  else if (residual <= 3.5) step = 2 * mag
  else if (residual <= 7.5) step = 5 * mag
  else step = 10 * mag
  const minStep = isInteger ? 1 : 0.5
  step = Math.max(minStep, step)
  return Math.ceil(max / step) * step
}

function niceLogUpperBound(max: number): number {
  if (!Number.isFinite(max) || max <= 0) return 1
  const p = Math.floor(Math.log10(max))
  const base = Math.pow(10, p)
  for (const m of [1, 2, 5, 10]) {
    const v = base * m
    if (v >= max) return v
  }
  return Math.pow(10, p + 1)
}

function computeParetoFrontier(points: ParetoPoint[]): ParetoPoint[] {
  if (points.length === 0) return []
  const sorted = [...points].sort((a, b) => {
    if (a.x !== b.x) return a.x - b.x
    return a.y - b.y
  })
  const frontier: ParetoPoint[] = []
  let minY = Infinity
  for (const p of sorted) {
    if (p.y < minY) {
      frontier.push(p)
      minY = p.y
    }
  }
  return frontier
}

function toSvgCoords(e: React.MouseEvent): { x: number; y: number } | null {
  const svg = (e.currentTarget as SVGElement).ownerSVGElement
  if (!svg) return null
  const pt = svg.createSVGPoint()
  pt.x = e.clientX
  pt.y = e.clientY
  const ctm = svg.getScreenCTM()
  if (!ctm) return null
  const inv = ctm.inverse()
  const local = pt.matrixTransform(inv)
  return { x: local.x, y: local.y }
}

function globalToSvgCoords(
  clientX: number,
  clientY: number,
  svgEl: SVGSVGElement | null,
): { x: number; y: number } | null {
  if (!svgEl) return null
  const pt = svgEl.createSVGPoint()
  pt.x = clientX
  pt.y = clientY
  const ctm = svgEl.getScreenCTM()
  if (!ctm) return null
  const inv = ctm.inverse()
  const local = pt.matrixTransform(inv)
  return { x: local.x, y: local.y }
}

function ZoomHandler({
  onZoom,
  onResetZoom,
}: {
  onZoom: (d: ZoomDomain) => void
  onResetZoom: () => void
}) {
  const plotArea = usePlotArea()
  const xInv = useXAxisInverseScale()
  const yInv = useYAxisInverseScale()
  const [sel, setSel] = useState<{ x1: number; y1: number; x2: number; y2: number } | null>(null)
  const dragRef = useRef<{ x1: number; y1: number; svgEl: SVGSVGElement | null } | null>(null)
  const ctxRef = useRef({ onZoom, xInv, yInv, plotArea })
  ctxRef.current = { onZoom, xInv, yInv, plotArea }

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const drag = dragRef.current
      if (!drag) return
      const coords = globalToSvgCoords(e.clientX, e.clientY, drag.svgEl)
      if (!coords) return
      setSel((prev) => (prev ? { ...prev, x2: coords.x, y2: coords.y } : null))
    }
    const onUp = (e: MouseEvent) => {
      const drag = dragRef.current
      if (!drag) return
      dragRef.current = null
      const { xInv: xi, yInv: yi, plotArea: pa, onZoom: oz } = ctxRef.current
      const coords = globalToSvgCoords(e.clientX, e.clientY, drag.svgEl)
      setSel(null)
      if (!coords || !xi || !yi || !pa) return
      const x1 = Math.min(drag.x1, coords.x)
      const y1 = Math.min(drag.y1, coords.y)
      const x2 = Math.max(drag.x1, coords.x)
      const y2 = Math.max(drag.y1, coords.y)
      if (Math.abs(x2 - x1) < 5 || Math.abs(y2 - y1) < 5) return
      const cx1 = Math.max(pa.x, Math.min(pa.x + pa.width, x1))
      const cx2 = Math.max(pa.x, Math.min(pa.x + pa.width, x2))
      const cy1 = Math.max(pa.y, Math.min(pa.y + pa.height, y1))
      const cy2 = Math.max(pa.y, Math.min(pa.y + pa.height, y2))
      const dx1 = xi(cx1)
      const dx2 = xi(cx2)
      const dy1 = yi(cy1)
      const dy2 = yi(cy2)
      if (dx1 == null || dx2 == null || dy1 == null || dy2 == null) return
      const nx1 = Number(dx1)
      const nx2 = Number(dx2)
      const ny1 = Number(dy1)
      const ny2 = Number(dy2)
      if (!Number.isFinite(nx1) || !Number.isFinite(nx2) || !Number.isFinite(ny1) || !Number.isFinite(ny2)) return
      oz({
        x: [Math.min(nx1, nx2), Math.max(nx1, nx2)],
        y: [Math.min(ny1, ny2), Math.max(ny1, ny2)],
      })
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [])

  if (!plotArea) return null

  const onDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return
    e.preventDefault()
    const svgEl = (e.currentTarget as SVGElement).ownerSVGElement ?? null
    const coords = toSvgCoords(e)
    if (!coords || !svgEl) return
    dragRef.current = { x1: coords.x, y1: coords.y, svgEl }
    setSel({ x1: coords.x, y1: coords.y, x2: coords.x, y2: coords.y })
  }

  return (
    <g>
      <rect
        x={plotArea.x}
        y={plotArea.y}
        width={plotArea.width}
        height={plotArea.height}
        fill="transparent"
        onMouseDown={onDown}
        onDoubleClick={onResetZoom}
        style={{ cursor: 'crosshair' }}
      />
      {sel && (
        <rect
          x={Math.min(sel.x1, sel.x2)}
          y={Math.min(sel.y1, sel.y2)}
          width={Math.abs(sel.x2 - sel.x1)}
          height={Math.abs(sel.y2 - sel.y1)}
          fill="var(--accent)"
          fillOpacity={0.1}
          stroke="var(--accent)"
          strokeWidth={1}
          strokeDasharray="4 2"
        />
      )}
    </g>
  )
}

function ParetoOverlay({ paretoPoints }: { paretoPoints: ParetoPoint[] }) {
  const plotArea = usePlotArea()
  const xScale = useXAxisScale()
  const yScale = useYAxisScale()

  if (!plotArea || !xScale || !yScale || paretoPoints.length === 0) return null

  const sorted = [...paretoPoints].sort((a, b) => a.x - b.x)
  const plotTop = plotArea.y
  const plotBottom = plotArea.y + plotArea.height
  const plotLeft = plotArea.x
  const plotRight = plotArea.x + plotArea.width

  let stepD = `M${xScale(sorted[0].x)},${plotTop}`
  stepD += ` L${xScale(sorted[0].x)},${yScale(sorted[0].y)}`
  for (let i = 1; i < sorted.length; i++) {
    stepD += ` L${xScale(sorted[i].x)},${yScale(sorted[i - 1].y)}`
    stepD += ` L${xScale(sorted[i].x)},${yScale(sorted[i].y)}`
  }
  stepD += ` L${plotRight},${yScale(sorted[sorted.length - 1].y)}`

  let shadeD = `M${plotLeft},${plotTop}`
  shadeD += ` L${xScale(sorted[0].x)},${plotTop}`
  shadeD += ` L${xScale(sorted[0].x)},${yScale(sorted[0].y)}`
  for (let i = 1; i < sorted.length; i++) {
    shadeD += ` L${xScale(sorted[i].x)},${yScale(sorted[i - 1].y)}`
    shadeD += ` L${xScale(sorted[i].x)},${yScale(sorted[i].y)}`
  }
  shadeD += ` L${plotRight},${yScale(sorted[sorted.length - 1].y)}`
  shadeD += ` L${plotRight},${plotBottom}`
  shadeD += ` L${plotLeft},${plotBottom}`
  shadeD += ` Z`

  return (
    <g style={{ pointerEvents: 'none' }}>
      <defs>
        <clipPath id="pareto-plot-clip">
          <rect x={plotArea.x} y={plotArea.y} width={plotArea.width} height={plotArea.height} />
        </clipPath>
      </defs>
      <g clipPath="url(#pareto-plot-clip)">
        <path d={shadeD} fill="var(--accent)" fillOpacity={0.12} stroke="none" />
        <path d={stepD} fill="none" stroke="var(--accent)" strokeWidth={2} strokeLinejoin="round" />
      </g>
    </g>
  )
}

function ResetZoomButton({ onReset }: { onReset: () => void }) {
  const plotArea = usePlotArea()
  if (!plotArea) return null
  const w = 84
  const h = 22
  const x = plotArea.x + plotArea.width - w
  const y = plotArea.y + plotArea.height + 28
  return (
    <foreignObject x={x} y={y} width={w} height={h} style={{ overflow: 'visible' }}>
      <button
        type="button"
        className="pareto-chart-reset-btn"
        onClick={onReset}
        style={{ width: '100%', height: '100%' }}
      >
        Reset zoom
      </button>
    </foreignObject>
  )
}

function ChartLegend({ hasUserPoints }: { hasUserPoints: boolean }) {
  const plotArea = usePlotArea()
  if (!plotArea) return null
  const items: { key: string; color: string; opacity: number; shape: 'circle' | 'diamond'; label: string }[] =
    CLASS_ORDER.map((cls) => ({
      key: cls,
      color: CLASS_COLOR[cls],
      opacity: cls === 'normal' ? NORMAL_OPACITY : 1,
      shape: 'circle',
      label: cls,
    }))
  if (hasUserPoints) {
    items.push({ key: 'user-green', color: USER_GREEN, opacity: 1, shape: 'diamond', label: 'user (frontier)' })
    items.push({ key: 'user-red', color: USER_RED, opacity: 1, shape: 'diamond', label: 'user (off frontier)' })
  }
  const padX = 8
  const padY = 6
  const rowH = 16
  const boxW = hasUserPoints ? 132 : 92
  const boxH = padY * 2 + items.length * rowH
  const x = plotArea.x + plotArea.width - boxW - 8
  const y = plotArea.y + 8
  return (
    <g style={{ pointerEvents: 'none' }}>
      <rect x={x} y={y} width={boxW} height={boxH} rx={4}
        fill="var(--sidebar-bg)" fillOpacity={0.92} stroke="var(--border)" strokeWidth={1} />
      {items.map((it, i) => {
        const marker = it.shape === 'diamond'
          ? <path d="M 5,-4.5 L 9.5,0 L 5,4.5 L 0.5,0 Z" fill={it.color} fillOpacity={it.opacity} stroke={it.color} strokeWidth={0.5} />
          : <circle cx={5} cy={0} r={4.5} fill={it.color} fillOpacity={it.opacity} stroke={it.color} strokeWidth={0.5} />
        return (
          <g key={it.key} transform={`translate(${x + padX}, ${y + padY + i * rowH + 9})`}>
            {marker}
            <text x={14} y={3} fill="var(--text)" fontSize={11} style={{ textTransform: it.shape === 'diamond' ? 'none' : 'capitalize' }}>
              {it.label}
            </text>
          </g>
        )
      })}
    </g>
  )
}

function CustomTooltip({ active, payload, pointMap, xLabel, yLabel }: {
  active?: boolean
  payload?: { payload: ParetoPoint }[]
  pointMap: Map<string, ParetoPoint[]>
  xLabel: string
  yLabel: string
}) {
  if (!active || !payload || payload.length === 0) return null
  const seen = new Set<string>()
  const groups: ParetoPoint[][] = []
  for (const entry of payload) {
    const p = entry.payload
    const key = `${p.x}|${p.y}`
    if (seen.has(key)) continue
    seen.add(key)
    const pts = pointMap.get(key)
    if (pts && pts.length > 0) groups.push(pts)
  }
  if (groups.length === 0) return null
  return (
    <div className="pareto-chart-tooltip">
      {groups.map((pts, gi) => {
        const leaderboardPts = pts.filter((p) => !p.isUser)
        const userPts = pts.filter((p) => p.isUser)
        return (
          <div key={gi} className="pareto-chart-tooltip-group">
            <div className="pareto-chart-tooltip-pos">
              {xLabel}: {formatTick(pts[0].x)} / {yLabel}: {formatTick(pts[0].y)}
            </div>
            {leaderboardPts.map((p, pi) => (
              <div key={pi} className="pareto-chart-tooltip-row">
                {p.score || `${p.x} / ${p.y}`}
                {p.categories && <span className="pareto-chart-tooltip-cat">{p.categories}</span>}
              </div>
            ))}
            {userPts.map((p, pi) => (
              <div key={`u-${pi}`} className="pareto-chart-tooltip-user">
                <div className="pareto-chart-tooltip-user-name">{p.name ?? '(unnamed)'}</div>
                <div className="pareto-chart-tooltip-user-score">{p.fullScore ?? ''}</div>
              </div>
            ))}
          </div>
        )
      })}
    </div>
  )
}

export default function ParetoChart({ puzzleId, userRecords }: ParetoChartProps) {
  const [records, setRecords] = useState<OmRecordDTO[]>([])
  const [metrics, setMetrics] = useState<OmMetricDTO[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [xMetric, setXMetric] = useState<NumericScoreKey | ''>(() =>
    loadSetting('om-chart:xMetric', '') as NumericScoreKey | '')
  const [yMetric, setYMetric] = useState<NumericScoreKey | ''>(() =>
    loadSetting('om-chart:yMetric', '') as NumericScoreKey | '')
  const [boolFilters, setBoolFilters] = useState<BoolFilter>(() => {
    try {
      const saved = localStorage.getItem('om-chart:boolFilters')
      if (saved) return JSON.parse(saved) as BoolFilter
    } catch { }
    return { overlap: 'any', trackless: 'any' }
  })
  const [xScale, setXScale] = useState<'linear' | 'log'>(() =>
    loadSetting('om-chart:xScale', 'linear') as 'linear' | 'log')
  const [yScale, setYScale] = useState<'linear' | 'log'>(() =>
    loadSetting('om-chart:yScale', 'linear') as 'linear' | 'log')
  const [zoomDomain, setZoomDomain] = useState<ZoomDomain | null>(null)
  const [manifoldId, setManifoldId] = useState<string>(() => loadSetting('om-chart:manifold', ''))

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    Promise.all([fetchRecords(puzzleId, { useCache: false }), fetchMetrics()])
      .then(([recs, mets]) => {
        if (cancelled) return
        setRecords(recs)
        setMetrics(mets)
        setLoading(false)
      })
      .catch((err) => {
        if (cancelled) return
        setError(String(err))
        setLoading(false)
      })
    return () => { cancelled = true }
  }, [puzzleId])

  const puzzleType = useMemo<OmType | null>(() => {
    const t = records[0]?.puzzle.type
    return t === 'NORMAL' || t === 'POLYMER_HEIGHT' || t === 'POLYMER_WIDTH' || t === 'POLYMER_SKEW' || t === 'PRODUCTION' ? t : null
  }, [records])

  const availableManifolds = useMemo(() => (puzzleType ? manifoldsForType(puzzleType) : []), [puzzleType])

  const puzzleUserRecords = useMemo(
    () => (puzzleType ? userRecords.filter((r) => r.puzzleType === puzzleType) : []),
    [userRecords, puzzleType],
  )

  const userFrontierByManifold = useMemo<Map<string, Set<string>>>(() => {
    const map = new Map<string, Set<string>>()
    if (!puzzleType || puzzleUserRecords.length === 0) return map
    const manifolds = manifoldsForType(puzzleType)
    if (manifolds.length === 0) return map
    const leaderboardScores: OmScoreDTO[] = []
    for (const r of records) {
      if (r.score !== null) leaderboardScores.push(r.score)
    }
    const userScores = puzzleUserRecords.map((r) => r.score)
    const lbCount = leaderboardScores.length
    for (const m of manifolds) {
      const merged = [...leaderboardScores, ...userScores]
      const frontierDense = computeFrontierIndices(m, merged)
      const greenIds = new Set<string>()
      for (const d of frontierDense) {
        if (d >= lbCount) {
          const userIdx = d - lbCount
          const userScore = userScores[userIdx]
          const equalsLeaderboard = leaderboardScores.some(
            (lb) => supportsScore(m, lb) && partialCompare(m.scoreParts, userScore, lb) === 'EQUAL',
          )
          if (!equalsLeaderboard) {
            greenIds.add(puzzleUserRecords[userIdx].id)
          }
        }
      }
      map.set(m.id, greenIds)
    }
    return map
  }, [puzzleType, puzzleUserRecords, records])

  const anyManifoldGreen = useMemo<Set<string>>(() => {
    const set = new Set<string>()
    for (const ids of userFrontierByManifold.values()) {
      for (const id of ids) set.add(id)
    }
    return set
  }, [userFrontierByManifold])

  const manifold = useMemo<Manifold | undefined>(() => {
    if (!manifoldId || !puzzleType) return undefined
    const m = getManifold(manifoldId)
    return m && m.supportedTypes.includes(puzzleType) ? m : undefined
  }, [manifoldId, puzzleType])

  useEffect(() => {
    if (manifoldId && puzzleType && !availableManifolds.some((m) => m.id === manifoldId)) {
      setManifoldId('')
      saveSetting('om-chart:manifold', '')
    }
  }, [manifoldId, puzzleType, availableManifolds])

  useEffect(() => {
    if (!manifold) return
    const allowed = new Set<MetricId>(manifold.scoreParts)
    if (xMetric && !allowed.has(xMetric as MetricId)) {
      setXMetric('')
      saveSetting('om-chart:xMetric', '')
    }
    if (yMetric && !allowed.has(yMetric as MetricId)) {
      setYMetric('')
      saveSetting('om-chart:yMetric', '')
    }
  }, [manifold, xMetric, yMetric])

  const availableMetrics = useMemo(() => {
    if (records.length === 0) return []
    const allowed = manifold ? new Set<MetricId>(manifold.scoreParts) : null
    const numericKeys: NumericScoreKey[] = []
    for (const key of NUMERIC_SCORE_KEYS) {
      if (allowed != null && !allowed.has(key as MetricId)) continue
      if (records.some((r) => r.score !== null && getMetricValue(r.score, key) !== null)) {
        numericKeys.push(key)
      }
    }
    return numericKeys
  }, [records, manifold])

  const frontierRecordIndices = useMemo<Set<number> | null>(() => {
    if (!manifold) return null
    const idxMap: number[] = []
    const dense: OmScoreDTO[] = []
    records.forEach((r, i) => {
      if (r.score !== null) {
        dense.push(r.score)
        idxMap.push(i)
      }
    })
    const frontierDense = computeFrontierIndices(manifold, dense)
    return new Set(frontierDense.map((d) => idxMap[d]))
  }, [records, manifold])

  const allPoints = useMemo(() => {
    if (!xMetric || !yMetric) return []
    const points: ParetoPoint[] = []
    records.forEach((r, i) => {
      if (r.score === null) return
      if (manifold && !supportsScore(manifold, r.score)) return
      if (manifold && frontierRecordIndices && !frontierRecordIndices.has(i)) return
      const x = getMetricValue(r.score, xMetric)
      const y = getMetricValue(r.score, yMetric)
      if (x === null || y === null) return
      let skip = false
      for (const key of BOOL_SCORE_KEYS) {
        const f = boolFilters[key]
        if (f !== 'any' && r.score[key] !== (f === 'true')) {
          skip = true
          break
        }
      }
      if (skip) return
      points.push({ x, y, id: r.id ?? `${x}-${y}`, score: r.smartFormattedScore, categories: r.smartFormattedCategories, recordIndex: i, overlap: !!r.score.overlap, trackless: !!r.score.trackless })
    })
    return points
  }, [records, xMetric, yMetric, boolFilters, manifold, frontierRecordIndices])

  const userPoints = useMemo<ParetoPoint[]>(() => {
    if (!xMetric || !yMetric || !puzzleType || puzzleUserRecords.length === 0) return []
    const points: ParetoPoint[] = []
    for (const r of puzzleUserRecords) {
      if (manifold && !supportsScore(manifold, r.score)) continue
      const x = getMetricValue(r.score, xMetric)
      const y = getMetricValue(r.score, yMetric)
      if (x === null || y === null) continue
      let skip = false
      for (const key of BOOL_SCORE_KEYS) {
        const f = boolFilters[key]
        if (f !== 'any' && r.score[key] !== (f === 'true')) {
          skip = true
          break
        }
      }
      if (skip) continue
      const green = manifold
        ? (userFrontierByManifold.get(manifold.id)?.has(r.id) ?? false)
        : anyManifoldGreen.has(r.id)
      points.push({
        x,
        y,
        id: `user-${r.id}`,
        score: null,
        categories: null,
        recordIndex: -1,
        overlap: !!r.score.overlap,
        trackless: !!r.score.trackless,
        isUser: true,
        name: r.solutionName,
        fullScore: r.fullScore,
        green,
      })
    }
    return points
  }, [puzzleUserRecords, puzzleType, xMetric, yMetric, boolFilters, manifold, userFrontierByManifold, anyManifoldGreen])

  const boundaryPoints = useMemo(() => (manifold ? computeParetoFrontier(allPoints) : []), [allPoints, manifold])
  const boundaryIdSet = useMemo(() => new Set(boundaryPoints.map((p) => p.id)), [boundaryPoints])
  const paretoPoints = useMemo(() => allPoints.filter((p) => boundaryIdSet.has(p.id)), [allPoints, boundaryIdSet])
  const nonParetoPoints = useMemo(() => allPoints.filter((p) => !boundaryIdSet.has(p.id)), [allPoints, boundaryIdSet])

  const pointMap = useMemo(() => {
    const map = new Map<string, ParetoPoint[]>()
    for (const p of allPoints) {
      const key = `${p.x}|${p.y}`
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(p)
    }
    for (const p of userPoints) {
      const key = `${p.x}|${p.y}`
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(p)
    }
    return map
  }, [allPoints, userPoints])

  const defaultDomain = useMemo(() => {
    if (allPoints.length === 0 && userPoints.length === 0) return null
    let xMin = Infinity, xMax = -Infinity, yMin = Infinity, yMax = -Infinity
    for (const p of allPoints) {
      if (p.x < xMin) xMin = p.x
      if (p.x > xMax) xMax = p.x
      if (p.y < yMin) yMin = p.y
      if (p.y > yMax) yMax = p.y
    }
    for (const p of userPoints) {
      if (p.x < xMin) xMin = p.x
      if (p.x > xMax) xMax = p.x
      if (p.y < yMin) yMin = p.y
      if (p.y > yMax) yMax = p.y
    }
    const xIsInt = xMetric !== 'width'
    const yIsInt = yMetric !== 'width'
    const xHi = xScale === 'log' ? niceLogUpperBound(xMax) : niceUpperBound(xMax, xIsInt)
    const yHi = yScale === 'log' ? niceLogUpperBound(yMax) : niceUpperBound(yMax, yIsInt)
    const xLo = xScale === 'log' ? Math.max(1, xMin) : 0
    const yLo = yScale === 'log' ? Math.max(1, yMin) : 0
    return { x: [xLo, xHi] as [number, number], y: [yLo, yHi] as [number, number] }
  }, [allPoints, userPoints, xScale, yScale, xMetric, yMetric])

  const xDomain = zoomDomain?.x ?? defaultDomain?.x
  const yDomain = zoomDomain?.y ?? defaultDomain?.y
  const isZoomed = zoomDomain !== null

  const xIsInteger = xMetric !== 'width'
  const yIsInteger = yMetric !== 'width'
  const xTicks = xDomain ? (xScale === 'log' ? generateLogTicks(xDomain) : generateTicks(xDomain, xIsInteger)) : undefined
  const yTicks = yDomain ? (yScale === 'log' ? generateLogTicks(yDomain) : generateTicks(yDomain, yIsInteger)) : undefined

  const visibleNonPareto = useMemo(
    () => (zoomDomain ? nonParetoPoints.filter((p) => p.x >= zoomDomain.x[0] && p.x <= zoomDomain.x[1] && p.y >= zoomDomain.y[0] && p.y <= zoomDomain.y[1]) : nonParetoPoints),
    [nonParetoPoints, zoomDomain],
  )
  const visiblePareto = useMemo(
    () => (zoomDomain ? paretoPoints.filter((p) => p.x >= zoomDomain.x[0] && p.x <= zoomDomain.x[1] && p.y >= zoomDomain.y[0] && p.y <= zoomDomain.y[1]) : paretoPoints),
    [paretoPoints, zoomDomain],
  )

  const visibleUserPoints = useMemo(
    () => (zoomDomain ? userPoints.filter((p) => p.x >= zoomDomain.x[0] && p.x <= zoomDomain.x[1] && p.y >= zoomDomain.y[0] && p.y <= zoomDomain.y[1]) : userPoints),
    [userPoints, zoomDomain],
  )

  const userGreenPoints = useMemo(() => visibleUserPoints.filter((p) => p.green), [visibleUserPoints])
  const userRedPoints = useMemo(() => visibleUserPoints.filter((p) => !p.green), [visibleUserPoints])

  const frontierByClass = useMemo(() => {
    const map: Record<PointClass, ParetoPoint[]> = { overlap: [], trackless: [], normal: [] }
    for (const p of visiblePareto) map[classifyPoint(p)].push(p)
    return map
  }, [visiblePareto])

  const nonFrontierByClass = useMemo(() => {
    const map: Record<PointClass, ParetoPoint[]> = { overlap: [], trackless: [], normal: [] }
    for (const p of visibleNonPareto) map[classifyPoint(p)].push(p)
    return map
  }, [visibleNonPareto])

  const resetZoom = useCallback(() => setZoomDomain(null), [])
  const handleZoom = useCallback((d: ZoomDomain) => setZoomDomain(d), [])

  useEffect(() => {
    setZoomDomain(null)
  }, [puzzleId, xMetric, yMetric, xScale, yScale, boolFilters, manifoldId])

  const handleXMetricChange = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    const val = e.target.value as NumericScoreKey | ''
    setXMetric(val)
    saveSetting('om-chart:xMetric', val)
  }, [])

  const handleYMetricChange = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    const val = e.target.value as NumericScoreKey | ''
    setYMetric(val)
    saveSetting('om-chart:yMetric', val)
  }, [])

  const handleBoolFilterChange = useCallback((key: string, value: string) => {
    const newFilters = { ...boolFilters, [key]: value as 'any' | 'true' | 'false' }
    setBoolFilters(newFilters)
    try { localStorage.setItem('om-chart:boolFilters', JSON.stringify(newFilters)) } catch { }
  }, [boolFilters])

  const handleXScale = useCallback((v: 'linear' | 'log') => {
    setXScale(v)
    saveSetting('om-chart:xScale', v)
  }, [])

  const handleYScale = useCallback((v: 'linear' | 'log') => {
    setYScale(v)
    saveSetting('om-chart:yScale', v)
  }, [])

  const handleManifoldChange = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    const val = e.target.value
    setManifoldId(val)
    saveSetting('om-chart:manifold', val)
  }, [])

  const handleManifoldSelect = useCallback((id: string) => {
    setManifoldId(id)
    saveSetting('om-chart:manifold', id)
  }, [])

  const metricLabels = useMemo(() => {
    const map = new Map<string, string>()
    for (const m of metrics) map.set(m.id, m.displayName)
    return map
  }, [metrics])

  const getLabel = useCallback((key: string) => METRIC_LABELS[key] ?? metricLabels.get(key) ?? key, [metricLabels])

  const metricOptions = useMemo(
    () => availableMetrics.map((key) => ({ key, label: getLabel(key) })),
    [availableMetrics, getLabel],
  )

  if (loading) {
    return <div className="pareto-chart-container"><div className="pareto-chart-loading">Loading records...</div></div>
  }

  if (error) {
    return <div className="pareto-chart-container"><div className="pareto-chart-error">Error: {error}</div></div>
  }

  const ready = xMetric !== '' && yMetric !== ''

  return (
    <div className="pareto-chart-container">
      <div className="pareto-chart-controls">
        <label className="pareto-chart-label">
          Manifold:
          <select value={manifoldId} onChange={handleManifoldChange} className="pareto-chart-select">
            <option value="">All (no frontier)</option>
            {availableManifolds.map((m) => (
              <option key={m.id} value={m.id}>{m.label}</option>
            ))}
          </select>
        </label>
        <label className="pareto-chart-label">
          X Axis:
          <select value={xMetric} onChange={handleXMetricChange} className="pareto-chart-select">
            <option value="">-- Select metric --</option>
            {metricOptions.map(({ key, label }) => (
              <option key={key} value={key}>{label}</option>
            ))}
          </select>
          <span className="pareto-chart-scale">
            <button type="button" className={`pareto-chart-scale-btn ${xScale === 'linear' ? 'active' : ''}`} onClick={() => handleXScale('linear')}>lin</button>
            <button type="button" className={`pareto-chart-scale-btn ${xScale === 'log' ? 'active' : ''}`} onClick={() => handleXScale('log')}>log</button>
          </span>
        </label>
        <label className="pareto-chart-label">
          Y Axis:
          <select value={yMetric} onChange={handleYMetricChange} className="pareto-chart-select">
            <option value="">-- Select metric --</option>
            {metricOptions.map(({ key, label }) => (
              <option key={key} value={key}>{label}</option>
            ))}
          </select>
          <span className="pareto-chart-scale">
            <button type="button" className={`pareto-chart-scale-btn ${yScale === 'linear' ? 'active' : ''}`} onClick={() => handleYScale('linear')}>lin</button>
            <button type="button" className={`pareto-chart-scale-btn ${yScale === 'log' ? 'active' : ''}`} onClick={() => handleYScale('log')}>log</button>
          </span>
        </label>
        {BOOL_SCORE_KEYS.map((key) => (
          <label key={key} className="pareto-chart-label">
            {getLabel(key)}:
            <select value={boolFilters[key]} onChange={(e) => handleBoolFilterChange(key, e.target.value)} className="pareto-chart-select">
              <option value="any">Any</option>
              <option value="true">Yes</option>
              <option value="false">No</option>
            </select>
          </label>
        ))}
        {ready && (
          <span className="pareto-chart-info">
            {manifold
              ? `${allPoints.length} on ${manifold.label} frontier (${boundaryPoints.length} on 2D boundary)`
              : `${allPoints.length} records (no frontier)`}
          </span>
        )}
      </div>
      {puzzleUserRecords.length > 0 && (
        <div className="pareto-chart-user-summary">
          {puzzleUserRecords.map((r) => {
            const greenManifolds = availableManifolds.filter(
              (m) => supportsScore(m, r.score) && (userFrontierByManifold.get(m.id)?.has(r.id) ?? false),
            )
            return (
              <div key={r.id} className="pareto-chart-user-row">
                <span className="pareto-chart-user-row-name">{r.solutionName ?? '(unnamed)'}</span>
                <span className="pareto-chart-user-row-score">{r.fullScore}</span>
                {greenManifolds.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    className={`pareto-chart-user-chip ${manifoldId === m.id ? 'active' : ''}`}
                    onClick={() => handleManifoldSelect(m.id)}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
            )
          })}
        </div>
      )}
      <div className="pareto-chart-plot">
        {ready && defaultDomain ? (
          <ResponsiveContainer width="100%" height="100%">
            <ScatterChart margin={MARGIN}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis
                type="number"
                dataKey="x"
                domain={xDomain}
                allowDataOverflow
                scale={xScale}
                ticks={xTicks}
                tickFormatter={formatTick}
                label={{ value: `${getLabel(xMetric)} →`, position: 'bottom', offset: 8, style: { fill: 'var(--text-h)', fontSize: 12, fontWeight: 600 } }}
                tick={{ fill: 'var(--text)', fontSize: 11 }}
              />
              <YAxis
                type="number"
                dataKey="y"
                domain={yDomain}
                allowDataOverflow
                scale={yScale}
                ticks={yTicks}
                tickFormatter={formatTick}
                label={{ value: `${getLabel(yMetric)} →`, angle: -90, position: 'left', offset: 4, style: { fill: 'var(--text-h)', fontSize: 12, fontWeight: 600 } }}
                tick={{ fill: 'var(--text)', fontSize: 11 }}
              />
              <ParetoOverlay paretoPoints={boundaryPoints} />
              <ChartLegend hasUserPoints={userPoints.length > 0} />
              <ZoomHandler onZoom={handleZoom} onResetZoom={resetZoom} />
              {isZoomed && <ResetZoomButton onReset={resetZoom} />}
              {CLASS_ORDER.flatMap((cls) => {
                const nf = nonFrontierByClass[cls]
                const fr = frontierByClass[cls]
                const els: React.ReactElement[] = []
                if (nf.length > 0) {
                  els.push(
                    <Scatter key={`nf-${cls}`} name={`non-frontier-${cls}`} data={nf} shape={makePointShape(NORMAL_RADIUS, NORMAL_OPACITY, CLASS_COLOR[cls])} isAnimationActive={false} />,
                  )
                }
                if (fr.length > 0) {
                  els.push(
                    <Scatter key={`f-${cls}`} name={`frontier-${cls}`} data={fr} shape={makePointShape(FRONTIER_RADIUS, FRONTIER_OPACITY, CLASS_FRONTIER_COLOR[cls])} isAnimationActive={false} />,
                  )
                }
                return els
              })}
              {userGreenPoints.length > 0 && (
                <Scatter key="user-green" name="user-green" data={userGreenPoints} shape={makeDiamondShape(USER_GREEN)} isAnimationActive={false} />
              )}
              {userRedPoints.length > 0 && (
                <Scatter key="user-red" name="user-red" data={userRedPoints} shape={makeDiamondShape(USER_RED)} isAnimationActive={false} />
              )}
              <Tooltip cursor={false} isAnimationActive={false} content={<CustomTooltip pointMap={pointMap} xLabel={getLabel(xMetric)} yLabel={getLabel(yMetric)} />} />
            </ScatterChart>
          </ResponsiveContainer>
        ) : (
          <div className="pareto-chart-placeholder">
            {ready ? 'No data' : 'Select X and Y metrics to display the chart'}
          </div>
        )}
      </div>
    </div>
  )
}
