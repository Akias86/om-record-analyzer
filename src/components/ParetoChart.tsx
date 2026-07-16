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
import './ParetoChart.css'

const MARGIN = { top: 16, right: 24, bottom: 40, left: 56 }

function loadSetting(key: string, fallback: string): string {
  try { return localStorage.getItem(key) ?? fallback } catch { return fallback }
}

function saveSetting(key: string, value: string): void {
  try {
    if (value) localStorage.setItem(key, value)
    else localStorage.removeItem(key)
  } catch {}
}

interface ParetoPoint {
  x: number
  y: number
  id: string
  score: string | null
  categories: string | null
}

interface ParetoChartProps {
  puzzleId: string
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
      {groups.map((pts, gi) => (
        <div key={gi} className="pareto-chart-tooltip-group">
          <div className="pareto-chart-tooltip-pos">
            {xLabel}: {formatTick(pts[0].x)} / {yLabel}: {formatTick(pts[0].y)}
          </div>
          {pts.map((p, pi) => (
            <div key={pi} className="pareto-chart-tooltip-row">
              {p.score || `${p.x} / ${p.y}`}
              {p.categories && <span className="pareto-chart-tooltip-cat">{p.categories}</span>}
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}

export default function ParetoChart({ puzzleId }: ParetoChartProps) {
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
    } catch {}
    return { overlap: 'any', trackless: 'any' }
  })
  const [xScale, setXScale] = useState<'linear' | 'log'>(() =>
    loadSetting('om-chart:xScale', 'linear') as 'linear' | 'log')
  const [yScale, setYScale] = useState<'linear' | 'log'>(() =>
    loadSetting('om-chart:yScale', 'linear') as 'linear' | 'log')
  const [zoomDomain, setZoomDomain] = useState<ZoomDomain | null>(null)

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

  const availableMetrics = useMemo(() => {
    if (records.length === 0) return []
    const numericKeys: NumericScoreKey[] = []
    for (const key of NUMERIC_SCORE_KEYS) {
      if (records.some((r) => r.score !== null && getMetricValue(r.score, key) !== null)) {
        numericKeys.push(key)
      }
    }
    return numericKeys
  }, [records])

  const allPoints = useMemo(() => {
    if (!xMetric || !yMetric) return []
    const points: ParetoPoint[] = []
    for (const r of records) {
      if (r.score === null) continue
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
      points.push({ x, y, id: r.id ?? `${x}-${y}`, score: r.smartFormattedScore, categories: r.smartFormattedCategories })
    }
    return points
  }, [records, xMetric, yMetric, boolFilters])

  const paretoPoints = useMemo(() => computeParetoFrontier(allPoints), [allPoints])
  const paretoSet = useMemo(() => new Set(paretoPoints.map((p) => p.id)), [paretoPoints])
  const nonParetoPoints = useMemo(() => allPoints.filter((p) => !paretoSet.has(p.id)), [allPoints, paretoSet])

  const pointMap = useMemo(() => {
    const map = new Map<string, ParetoPoint[]>()
    for (const p of allPoints) {
      const key = `${p.x}|${p.y}`
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(p)
    }
    return map
  }, [allPoints])

  const defaultDomain = useMemo(() => {
    if (allPoints.length === 0) return null
    let xMin = Infinity, xMax = -Infinity, yMin = Infinity, yMax = -Infinity
    for (const p of allPoints) {
      if (p.x < xMin) xMin = p.x
      if (p.x > xMax) xMax = p.x
      if (p.y < yMin) yMin = p.y
      if (p.y > yMax) yMax = p.y
    }
    const xLo = xScale === 'log' ? Math.max(1, xMin) : 0
    const yLo = yScale === 'log' ? Math.max(1, yMin) : 0
    return { x: [xLo, xMax] as [number, number], y: [yLo, yMax] as [number, number] }
  }, [allPoints, xScale, yScale])

  const xDomain = zoomDomain?.x ?? defaultDomain?.x
  const yDomain = zoomDomain?.y ?? defaultDomain?.y
  const isZoomed = zoomDomain !== null

  const xIsInteger = xMetric !== 'width'
  const yIsInteger = yMetric !== 'width'
  const xTicks = xDomain ? (xScale === 'log' ? generateLogTicks(xDomain) : (isZoomed ? generateTicks(xDomain, xIsInteger) : undefined)) : undefined
  const yTicks = yDomain ? (yScale === 'log' ? generateLogTicks(yDomain) : (isZoomed ? generateTicks(yDomain, yIsInteger) : undefined)) : undefined

  const visibleNonPareto = useMemo(
    () => (zoomDomain ? nonParetoPoints.filter((p) => p.x >= zoomDomain.x[0] && p.x <= zoomDomain.x[1] && p.y >= zoomDomain.y[0] && p.y <= zoomDomain.y[1]) : nonParetoPoints),
    [nonParetoPoints, zoomDomain],
  )
  const visiblePareto = useMemo(
    () => (zoomDomain ? paretoPoints.filter((p) => p.x >= zoomDomain.x[0] && p.x <= zoomDomain.x[1] && p.y >= zoomDomain.y[0] && p.y <= zoomDomain.y[1]) : paretoPoints),
    [paretoPoints, zoomDomain],
  )

  const resetZoom = useCallback(() => setZoomDomain(null), [])
  const handleZoom = useCallback((d: ZoomDomain) => setZoomDomain(d), [])

  useEffect(() => {
    setZoomDomain(null)
  }, [puzzleId, xMetric, yMetric, xScale, yScale, boolFilters])

  const handleXMetricChange = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    const val = e.target.value as NumericScoreKey | ''
    setXMetric(val)
    saveSetting('om-chart:xMetric', val)
    if (val === yMetric) {
      setYMetric('')
      saveSetting('om-chart:yMetric', '')
    }
  }, [yMetric])

  const handleYMetricChange = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    const val = e.target.value as NumericScoreKey | ''
    setYMetric(val)
    saveSetting('om-chart:yMetric', val)
    if (val === xMetric) {
      setXMetric('')
      saveSetting('om-chart:xMetric', '')
    }
  }, [xMetric])

  const handleBoolFilterChange = useCallback((key: string, value: string) => {
    const newFilters = { ...boolFilters, [key]: value as 'any' | 'true' | 'false' }
    setBoolFilters(newFilters)
    try { localStorage.setItem('om-chart:boolFilters', JSON.stringify(newFilters)) } catch {}
  }, [boolFilters])

  const handleXScale = useCallback((v: 'linear' | 'log') => {
    setXScale(v)
    saveSetting('om-chart:xScale', v)
  }, [])

  const handleYScale = useCallback((v: 'linear' | 'log') => {
    setYScale(v)
    saveSetting('om-chart:yScale', v)
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
          X Axis:
          <select value={xMetric} onChange={handleXMetricChange} className="pareto-chart-select">
            <option value="">-- Select metric --</option>
            {metricOptions.map(({ key, label }) => (
              <option key={key} value={key} disabled={key === yMetric}>{label}</option>
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
              <option key={key} value={key} disabled={key === xMetric}>{label}</option>
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
            {allPoints.length} records, {paretoPoints.length} on frontier
            {isZoomed && <button type="button" className="pareto-chart-reset-btn" onClick={resetZoom}>Reset zoom</button>}
          </span>
        )}
      </div>
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
              <ParetoOverlay paretoPoints={paretoPoints} />
              <ZoomHandler onZoom={handleZoom} onResetZoom={resetZoom} />
              {visibleNonPareto.length > 0 && (
                <Scatter name="nonPareto" data={visibleNonPareto} fill="var(--text)" fillOpacity={0.25} isAnimationActive={false} />
              )}
              {visiblePareto.length > 0 && (
                <Scatter name="pareto" data={visiblePareto} fill="var(--accent)" fillOpacity={1} isAnimationActive={false} />
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
