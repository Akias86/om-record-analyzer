import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  ResponsiveContainer,
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  CartesianGrid,
  usePlotArea,
  useXAxisScale,
  useYAxisScale,
  useXAxisInverseScale,
  useYAxisInverseScale,
} from 'recharts'
import { fetchRecords, fetchMetrics } from '../api/om'
import type { OmRecordDTO, OmMetricDTO, NumericScoreKey, BoolFilter } from '../types'
import { NUMERIC_SCORE_KEYS, BOOL_SCORE_KEYS } from '../types'
import './ParetoChart.css'

const MARGIN = { top: 16, right: 24, bottom: 40, left: 56 }

interface ParetoPoint {
  x: number
  y: number
  id: string
}

interface ParetoChartProps {
  puzzleId: string
}

type ZoomDomain = { x: [number, number]; y: [number, number] }

function isNumeric(val: unknown): val is number {
  return typeof val === 'number' && Number.isFinite(val)
}

function formatTick(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1)
}

function computeParetoFrontier(points: ParetoPoint[]): ParetoPoint[] {
  if (points.length === 0) return []
  const sorted = [...points].sort((a, b) => a.x - b.x)
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
  const [sel, setSel] = useState<{ x1: number; y1: number; x2: number; y2: number; svgEl: SVGSVGElement | null } | null>(null)

  useEffect(() => {
    if (!sel) return
    const svgEl = sel.svgEl
    const onUp = (e: MouseEvent) => {
      setSel((prev) => {
        if (!prev) return null
        const coords = globalToSvgCoords(e.clientX, e.clientY, svgEl)
        if (!coords) return null
        const x1 = Math.min(prev.x1, coords.x)
        const y1 = Math.min(prev.y1, coords.y)
        const x2 = Math.max(prev.x1, coords.x)
        const y2 = Math.max(prev.y1, coords.y)
        if (Math.abs(x2 - x1) < 5 || Math.abs(y2 - y1) < 5) return null
        if (!xInv || !yInv || !plotArea) return null
        const dx1 = xInv(x1)
        const dx2 = xInv(x2)
        const dy1 = yInv(y1)
        const dy2 = yInv(y2)
        if (dx1 == null || dx2 == null || dy1 == null || dy2 == null) return null
        onZoom({
          x: [Math.min(Number(dx1), Number(dx2)), Math.max(Number(dx1), Number(dx2))],
          y: [Math.min(Number(dy1), Number(dy2)), Math.max(Number(dy1), Number(dy2))],
        })
        return null
      })
    }
    window.addEventListener('mouseup', onUp)
    return () => window.removeEventListener('mouseup', onUp)
  }, [sel, onZoom, xInv, yInv, plotArea])

  if (!plotArea) return null

  const onDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return
    const coords = toSvgCoords(e)
    if (!coords) return
    setSel({ x1: coords.x, y1: coords.y, x2: coords.x, y2: coords.y, svgEl: (e.currentTarget as SVGElement).ownerSVGElement })
  }

  const onMove = (e: React.MouseEvent) => {
    if (!sel) return
    const coords = toSvgCoords(e)
    if (!coords) return
    setSel((prev) => (prev ? { ...prev, x2: coords.x, y2: coords.y } : null))
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
        onMouseMove={onMove}
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
    <g>
      <path d={shadeD} fill="var(--accent)" fillOpacity={0.12} stroke="none" />
      <path d={stepD} fill="none" stroke="var(--accent)" strokeWidth={2} strokeLinejoin="round" />
    </g>
  )
}

export default function ParetoChart({ puzzleId }: ParetoChartProps) {
  const [records, setRecords] = useState<OmRecordDTO[]>([])
  const [metrics, setMetrics] = useState<OmMetricDTO[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [xMetric, setXMetric] = useState<NumericScoreKey | ''>('')
  const [yMetric, setYMetric] = useState<NumericScoreKey | ''>('')
  const [boolFilters, setBoolFilters] = useState<BoolFilter>({ overlap: 'any', trackless: 'any' })
  const [xScale, setXScale] = useState<'linear' | 'log'>('linear')
  const [yScale, setYScale] = useState<'linear' | 'log'>('linear')
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
      if (records.some((r) => r.score !== null && isNumeric(r.score[key]))) {
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
      const x = r.score[xMetric]
      const y = r.score[yMetric]
      if (!isNumeric(x) || !isNumeric(y)) continue
      let skip = false
      for (const key of BOOL_SCORE_KEYS) {
        const f = boolFilters[key]
        if (f !== 'any' && r.score[key] !== (f === 'true')) {
          skip = true
          break
        }
      }
      if (skip) continue
      points.push({ x: x as number, y: y as number, id: r.id ?? `${x}-${y}` })
    }
    return points
  }, [records, xMetric, yMetric, boolFilters])

  const paretoPoints = useMemo(() => computeParetoFrontier(allPoints), [allPoints])
  const paretoSet = useMemo(() => new Set(paretoPoints.map((p) => p.id)), [paretoPoints])
  const nonParetoPoints = useMemo(() => allPoints.filter((p) => !paretoSet.has(p.id)), [allPoints, paretoSet])

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

  const resetZoom = useCallback(() => setZoomDomain(null), [])
  const handleZoom = useCallback((d: ZoomDomain) => setZoomDomain(d), [])

  const handleXMetricChange = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    const val = e.target.value as NumericScoreKey | ''
    setXMetric(val)
    if (val === yMetric) setYMetric('')
  }, [yMetric])

  const handleYMetricChange = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    const val = e.target.value as NumericScoreKey | ''
    setYMetric(val)
    if (val === xMetric) setXMetric('')
  }, [xMetric])

  const handleBoolFilterChange = useCallback((key: string, value: string) => {
    setBoolFilters((prev) => ({ ...prev, [key]: value as 'any' | 'true' | 'false' }))
  }, [])

  const metricLabels = useMemo(() => {
    const map = new Map<string, string>()
    for (const m of metrics) map.set(m.id, m.displayName)
    return map
  }, [metrics])

  const getLabel = useCallback((key: string) => metricLabels.get(key) ?? key, [metricLabels])

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
            <button type="button" className={`pareto-chart-scale-btn ${xScale === 'linear' ? 'active' : ''}`} onClick={() => setXScale('linear')}>lin</button>
            <button type="button" className={`pareto-chart-scale-btn ${xScale === 'log' ? 'active' : ''}`} onClick={() => setXScale('log')}>log</button>
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
            <button type="button" className={`pareto-chart-scale-btn ${yScale === 'linear' ? 'active' : ''}`} onClick={() => setYScale('linear')}>lin</button>
            <button type="button" className={`pareto-chart-scale-btn ${yScale === 'log' ? 'active' : ''}`} onClick={() => setYScale('log')}>log</button>
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
                tickFormatter={formatTick}
                label={{ value: `${getLabel(yMetric)} →`, angle: -90, position: 'left', offset: 4, style: { fill: 'var(--text-h)', fontSize: 12, fontWeight: 600 } }}
                tick={{ fill: 'var(--text)', fontSize: 11 }}
              />
              {nonParetoPoints.length > 0 && (
                <Scatter data={nonParetoPoints} fill="var(--text)" fillOpacity={0.25} isAnimationActive={false} />
              )}
              {paretoPoints.length > 0 && (
                <Scatter data={paretoPoints} fill="var(--accent)" fillOpacity={1} isAnimationActive={false} />
              )}
              <ParetoOverlay paretoPoints={paretoPoints} />
              <ZoomHandler onZoom={handleZoom} onResetZoom={resetZoom} />
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
