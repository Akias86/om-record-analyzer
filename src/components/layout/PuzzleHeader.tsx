import type { ReactNode } from 'react'
import { puzzleTypeLabel } from '../../lib/puzzleType'
import type { OmPuzzleDetail } from '../../api/om'
import { IconScatter, IconTable } from '../ui/icons'

export type MainView = 'table' | 'chart'

interface PuzzleHeaderProps {
  puzzleId: string
  detail: OmPuzzleDetail | null
  view: MainView
  onViewChange: (view: MainView) => void
  recordCount: number
  steadyStateCount: number
  userCount: number
  frontierCount: number
  loading: boolean
  aside?: ReactNode
}

/** Breadcrumb, title, at-a-glance counts and the records/chart switch. */
export function PuzzleHeader({
  puzzleId, detail, view, onViewChange,
  recordCount, steadyStateCount, userCount, frontierCount, loading, aside,
}: PuzzleHeaderProps) {
  const typeLabel = puzzleTypeLabel(detail?.type)
  return (
    <header className="puzzle-head">
      <div className="puzzle-crumb">
        {detail ? (
          <>
            <span className="truncate">{detail.group.collection.displayName}</span>
            <span className="puzzle-crumb-sep" aria-hidden="true">/</span>
            <span className="truncate">{detail.group.displayName}</span>
          </>
        ) : <span className="truncate">Puzzle</span>}
        <span className="puzzle-crumb-id">{puzzleId}</span>
      </div>
      <div className="puzzle-head-row">
        <div className="puzzle-head-main">
          <div className="puzzle-title-row">
            <h1 className="puzzle-title" title={detail?.displayName ?? puzzleId}>
              {detail?.displayName ?? puzzleId}
            </h1>
            {typeLabel && <span className="badge">{typeLabel}</span>}
            {aside}
          </div>
          <div className="puzzle-stats" role="status" aria-live="polite">
            <span className="puzzle-stat">
              {loading ? <span className="spinner" aria-hidden="true" /> : <strong>{recordCount}</strong>}
              {loading ? 'Loading records' : 'records'}
            </span>
            {!loading && steadyStateCount > 0 && (
              <>
                <span className="puzzle-stat-dot" aria-hidden="true" />
                <span className="puzzle-stat"><strong>{steadyStateCount}</strong> with @∞</span>
              </>
            )}
            {!loading && userCount > 0 && (
              <>
                <span className="puzzle-stat-dot" aria-hidden="true" />
                <span className="puzzle-stat">
                  <strong>{userCount}</strong> yours{frontierCount > 0 ? ` · ${frontierCount} on frontier` : ''}
                </span>
              </>
            )}
          </div>
        </div>
        <div className="puzzle-head-side">
          <div className="segmented segmented--lg" role="group" aria-label="View">
            <button
              type="button"
              aria-pressed={view === 'table'}
              className={view === 'table' ? 'is-active' : ''}
              onClick={() => onViewChange('table')}
              title="Records table"
            >
              <IconTable size={15} />
              Records
            </button>
            <button
              type="button"
              aria-pressed={view === 'chart'}
              className={view === 'chart' ? 'is-active' : ''}
              onClick={() => onViewChange('chart')}
              title="Pareto frontier chart"
            >
              <IconScatter size={15} />
              Pareto chart
            </button>
          </div>
        </div>
      </div>
    </header>
  )
}
