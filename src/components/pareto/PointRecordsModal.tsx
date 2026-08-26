import type { ParetoPoint } from './constants'
import { formatTick } from './ticks'
import { useEscapeKey } from './useEscapeKey'

interface PointRecordsModalProps {
  x: number
  y: number
  records: ParetoPoint[]
  onClose: () => void
  onSelectGif: (url: string, title: string) => void
}

export function PointRecordsModal({ x, y, records, onClose, onSelectGif }: PointRecordsModalProps) {
  useEscapeKey(onClose)
  const leaderboard = records.filter((r) => !r.isUser)
  const user = records.filter((r) => r.isUser)
  return (
    <div className="gif-viewer-backdrop" onClick={onClose}>
      <div className="gif-viewer-panel point-records-panel" onClick={(e) => e.stopPropagation()}>
        <div className="gif-viewer-header">
          <div className="gif-viewer-title">{records.length} record{records.length === 1 ? '' : 's'} at {formatTick(x)} / {formatTick(y)}</div>
          <button type="button" className="gif-viewer-close" onClick={onClose} aria-label="Close">{'\u00D7'}</button>
        </div>
        <div className="point-records-list">
          {leaderboard.map((p, pi) => {
            const label = p.score || `${p.x} / ${p.y}`
            const gif = p.gif ?? null
            return (
              <div key={`lb-${pi}`} className="point-records-row">
                {gif ? (
                  <button
                    type="button"
                    className="point-records-score point-records-score--link"
                    title="Click to view replay GIF"
                    onClick={() => onSelectGif(gif, label)}
                  >
                    {label}
                  </button>
                ) : (
                  <span className="point-records-score">{label}</span>
                )}
                {p.categories && <span className="pareto-chart-tooltip-cat">{p.categories}</span>}
              </div>
            )
          })}
          {user.map((p, pi) => (
            <div key={`u-${pi}`} className={`point-records-row point-records-user ${p.green ? 'is-green' : 'is-red'}`}>
              <span className="point-records-marker" />
              <span className="point-records-user-name">{p.name ?? '(unnamed)'}</span>
              <span className="point-records-user-score">{p.fullScore ?? ''}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
