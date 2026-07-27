import { formatTick } from './ticks'
import type { ParetoPoint } from './constants'

interface CustomTooltipProps {
  active?: boolean
  payload?: { payload: ParetoPoint }[]
  pointMap: Map<string, ParetoPoint[]>
  xLabel: string
  yLabel: string
}

export function CustomTooltip({ active, payload, pointMap, xLabel, yLabel }: CustomTooltipProps) {
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
              <div key={`u-${pi}`} className={`pareto-chart-tooltip-user ${p.green ? 'pareto-chart-tooltip-user--green' : 'pareto-chart-tooltip-user--red'}`}>
                <div className="pareto-chart-tooltip-user-header">
                  <span className="pareto-chart-tooltip-user-marker" />
                  <div className="pareto-chart-tooltip-user-name">{p.name ?? '(unnamed)'}</div>
                </div>
                <div className="pareto-chart-tooltip-user-score">{p.fullScore ?? ''}</div>
              </div>
            ))}
          </div>
        )
      })}
    </div>
  )
}