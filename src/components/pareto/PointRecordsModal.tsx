import { useRef } from 'react'
import type { ParetoPoint } from './constants'
import { formatTick } from './ticks'
import { useEscapeKey } from './useEscapeKey'

interface PointRecordsModalProps {
  x: number
  y: number
  records: ParetoPoint[]
  onClose: () => void
  onPlay: (point: ParetoPoint) => void
}

export function PointRecordsModal({ x, y, records, onClose, onPlay }: PointRecordsModalProps) {
  const backdropRef = useRef<HTMLDivElement>(null)
  useEscapeKey(backdropRef, onClose)
  return (
    <div ref={backdropRef} className="gif-viewer-backdrop" onClick={onClose}>
      <div className="gif-viewer-panel point-records-panel" onClick={(e) => e.stopPropagation()}>
        <div className="gif-viewer-header">
          <div className="gif-viewer-title">{records.length} record{records.length === 1 ? '' : 's'} at {formatTick(x)} / {formatTick(y)}</div>
          <button type="button" className="gif-viewer-close" onClick={onClose} aria-label="Close">{'\u00D7'}</button>
        </div>
        <div className="point-records-list">
          {records.map((p, pi) => {
            const label = p.isUser
              ? `${p.name ?? '(unnamed)'} — ${p.fullScore ?? `${p.x} / ${p.y}`}`
              : p.score || `${p.x} / ${p.y}`
            return (
              <div key={`${p.id}-${pi}`} className="point-records-row">
                {p.canPlay ? (
                  <button
                    type="button"
                    className="point-records-score point-records-score--link"
                    title="Click to view solution replay"
                    onClick={() => onPlay(p)}
                  >
                    {label}
                  </button>
                ) : (
                  <span className="point-records-score">{label}</span>
                )}
                {p.isUser && <span className="pareto-chart-tooltip-cat">Yours</span>}
                {p.categories && <span className="pareto-chart-tooltip-cat">{p.categories}</span>}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
