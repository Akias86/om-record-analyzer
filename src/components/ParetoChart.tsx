import {
  ResponsiveContainer,
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from 'recharts'
import { BOOL_SCORE_KEYS } from '../types'
import { supportsScore } from '../lib/manifold'
import type { UserSolutionRecord } from '../state/userSolutions'
import type { OmRecordDTO } from '../types'
import './ParetoChart.css'
import { MARGIN } from './pareto/constants'
import {
  CLASS_COLOR,
  CLASS_FRONTIER_COLOR,
  FRONTIER_OPACITY,
  FRONTIER_RADIUS,
  NORMAL_OPACITY,
  NORMAL_RADIUS,
  USER_GREEN,
  USER_RED,
} from './pareto/constants'
import { formatTick } from './pareto/ticks'
import { makeDiamondShape, makePointShape } from './pareto/shapes'
import { ChartLegend } from './pareto/ChartLegend'
import { CustomTooltip } from './pareto/CustomTooltip'
import { ParetoOverlay } from './pareto/ParetoOverlay'
import { ResetZoomButton } from './pareto/ResetZoomButton'
import { ZoomHandler } from './pareto/ZoomHandler'
import { CLASS_ORDER, useParetoChartState } from './pareto/useParetoChartState'

interface ParetoChartProps {
  puzzleId: string
  userRecords: UserSolutionRecord[]
  refreshFrontierForPuzzle: (puzzleId: string, leaderboard: OmRecordDTO[]) => void
}

export default function ParetoChart({ puzzleId, userRecords, refreshFrontierForPuzzle }: ParetoChartProps) {
  const s = useParetoChartState({ puzzleId, userRecords, refreshFrontierForPuzzle })

  if (s.loading) {
    return <div className="pareto-chart-container"><div className="pareto-chart-loading">Loading records...</div></div>
  }

  if (s.error) {
    return <div className="pareto-chart-container"><div className="pareto-chart-error">Error: {s.error}</div></div>
  }

  const ready = s.xMetric !== '' && s.yMetric !== ''

  return (
    <div className="pareto-chart-container">
      <div className="pareto-chart-controls">
        <label className="pareto-chart-label">
          Manifold:
          <select value={s.manifoldId} onChange={s.setManifoldIdFromEvent} className="pareto-chart-select">
            <option value="">All (no frontier)</option>
            {s.availableManifolds.map((m) => (
              <option key={m.id} value={m.id}>{m.label}</option>
            ))}
          </select>
        </label>
        <label className="pareto-chart-label">
          X Axis:
          <select value={s.xMetric} onChange={s.setXMetricFromEvent} className="pareto-chart-select">
            <option value="">-- Select metric --</option>
            {s.metricOptions.map(({ key, label }) => (
              <option key={key} value={key}>{label}</option>
            ))}
          </select>
          <span className="pareto-chart-scale">
            <button type="button" className={`pareto-chart-scale-btn ${s.xScale === 'linear' ? 'active' : ''}`} onClick={() => s.setXScale('linear')}>lin</button>
            <button type="button" className={`pareto-chart-scale-btn ${s.xScale === 'log' ? 'active' : ''}`} onClick={() => s.setXScale('log')}>log</button>
          </span>
        </label>
        <label className="pareto-chart-label">
          Y Axis:
          <select value={s.yMetric} onChange={s.setYMetricFromEvent} className="pareto-chart-select">
            <option value="">-- Select metric --</option>
            {s.metricOptions.map(({ key, label }) => (
              <option key={key} value={key}>{label}</option>
            ))}
          </select>
          <span className="pareto-chart-scale">
            <button type="button" className={`pareto-chart-scale-btn ${s.yScale === 'linear' ? 'active' : ''}`} onClick={() => s.setYScale('linear')}>lin</button>
            <button type="button" className={`pareto-chart-scale-btn ${s.yScale === 'log' ? 'active' : ''}`} onClick={() => s.setYScale('log')}>log</button>
          </span>
        </label>
        {BOOL_SCORE_KEYS.map((key) => (
          <label key={key} className="pareto-chart-label">
            {s.getLabel(key)}:
            <select value={s.boolFilters[key]} onChange={(e) => s.setBoolFilter(key, e.target.value)} className="pareto-chart-select">
              <option value="any">Any</option>
              <option value="true">Yes</option>
              <option value="false">No</option>
            </select>
          </label>
        ))}
        {ready && (
          <span className="pareto-chart-info">
            {s.manifold
              ? `${s.allPoints.length} on ${s.manifold.label} frontier (${s.boundaryPoints.length} on 2D boundary)`
              : `${s.allPoints.length} records (no frontier)`}
          </span>
        )}
      </div>
      {s.puzzleUserRecords.length > 0 && (
        <div className="pareto-chart-user-summary">
          {s.puzzleUserRecords.map((r) => {
            const greenManifolds = s.availableManifolds.filter(
              (m) => supportsScore(m, r.score) && (s.userFrontierByManifold.get(m.id)?.has(r.id) ?? false),
            )
            return (
              <div key={r.id} className="pareto-chart-user-row">
                <span className="pareto-chart-user-row-name">{r.solutionName ?? '(unnamed)'}</span>
                <span className="pareto-chart-user-row-score">{r.fullScore}</span>
                {greenManifolds.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    className={`pareto-chart-user-chip ${s.manifoldId === m.id ? 'active' : ''}`}
                    onClick={() => s.selectManifold(m.id)}
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
        {ready && s.defaultDomain ? (
          <ResponsiveContainer width="100%" height="100%">
            <ScatterChart margin={MARGIN}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis
                type="number"
                dataKey="x"
                domain={s.xDomain}
                allowDataOverflow
                scale={s.xScale}
                ticks={s.xTicks}
                tickFormatter={formatTick}
                label={{ value: `${s.getLabel(s.xMetric)} →`, position: 'bottom', offset: 8, style: { fill: 'var(--text-h)', fontSize: 12, fontWeight: 600 } }}
                tick={{ fill: 'var(--text)', fontSize: 11 }}
              />
              <YAxis
                type="number"
                dataKey="y"
                domain={s.yDomain}
                allowDataOverflow
                scale={s.yScale}
                ticks={s.yTicks}
                tickFormatter={formatTick}
                label={{ value: `${s.getLabel(s.yMetric)} →`, angle: -90, position: 'left', offset: 4, style: { fill: 'var(--text-h)', fontSize: 12, fontWeight: 600 } }}
                tick={{ fill: 'var(--text)', fontSize: 11 }}
              />
              <ParetoOverlay paretoPoints={s.boundaryPoints} />
              <ChartLegend hasUserPoints={s.userPoints.length > 0} />
              <ZoomHandler onZoom={s.handleZoom} onResetZoom={s.resetZoom} />
              {s.isZoomed && <ResetZoomButton onReset={s.resetZoom} />}
              {CLASS_ORDER.flatMap((cls) => {
                const fr = s.frontierByClass[cls]
                return fr.length > 0
                  ? [<Scatter key={`f-${cls}`} name={`frontier-${cls}`} data={fr} shape={makePointShape(FRONTIER_RADIUS, FRONTIER_OPACITY, CLASS_FRONTIER_COLOR[cls])} isAnimationActive={false} />]
                  : []
              })}
              {s.userRedPoints.length > 0 && (
                <Scatter key="user-red" name="user-red" data={s.userRedPoints} shape={makeDiamondShape(USER_RED)} isAnimationActive={false} />
              )}
              {s.userGreenPoints.length > 0 && (
                <Scatter key="user-green" name="user-green" data={s.userGreenPoints} shape={makeDiamondShape(USER_GREEN)} isAnimationActive={false} />
              )}
              {CLASS_ORDER.flatMap((cls) => {
                const nf = s.nonFrontierByClass[cls]
                return nf.length > 0
                  ? [<Scatter key={`nf-${cls}`} name={`non-frontier-${cls}`} data={nf} shape={makePointShape(NORMAL_RADIUS, NORMAL_OPACITY, CLASS_COLOR[cls])} isAnimationActive={false} />]
                  : []
              })}
              <Tooltip cursor={false} isAnimationActive={false} content={<CustomTooltip pointMap={s.pointMap} xLabel={s.getLabel(s.xMetric)} yLabel={s.getLabel(s.yMetric)} />} />
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