import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { DragEvent } from 'react'
import { demoAvailable, isDemoEnabled, setDemoEnabled } from '../api/demo'
import { getManifold } from '../lib/manifold'
import { puzzleTypeShort } from '../lib/puzzleType'
import type { RecentPuzzle } from '../lib/recentPuzzles'
import { usePuzzleTree } from '../state/puzzleTree'
import { useSolutionUpload } from '../state/solutionUpload'
import { useUserSolutions } from '../state/userSolutions'
import { useAppNav } from './layout/AppShell'
import {
  IconAlert,
  IconChevronRight,
  IconClock,
  IconGrid,
  IconSparkle,
  IconTarget,
  IconTrash,
  IconUpload,
} from './ui/icons'
import './Sidebar.css'

interface SidebarProps {
  selectedPuzzleId: string | null
  onSelectPuzzle: (puzzleId: string | null) => void
  expandCollectionId?: string | null
  expandGroupId?: string | null
  recent?: RecentPuzzle[]
}

export default function Sidebar({ selectedPuzzleId, onSelectPuzzle, expandCollectionId, expandGroupId, recent = [] }: SidebarProps) {
  const { tree, puzzles, loading, error, reload } = usePuzzleTree()
  const { pickFiles, handleFiles } = useSolutionUpload()
  const { closeNav } = useAppNav()
  const {
    records, uploading, progress, skipped, duplicated, storageWarning,
    frontierSummary, frontierLoading, frontierProgress, clear,
  } = useUserSolutions()

  const [expandedCollections, setExpandedCollections] = useState<Set<string>>(new Set())
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set())
  const [frontierExpanded, setFrontierExpanded] = useState(false)
  const [recentExpanded, setRecentExpanded] = useState(true)
  const [dropActive, setDropActive] = useState(false)
  const dropDepth = useRef(0)

  useEffect(() => {
    if (expandCollectionId) {
      setExpandedCollections((prev) => (prev.has(expandCollectionId) ? prev : new Set(prev).add(expandCollectionId)))
    }
  }, [expandCollectionId])

  useEffect(() => {
    if (expandGroupId) {
      setExpandedGroups((prev) => (prev.has(expandGroupId) ? prev : new Set(prev).add(expandGroupId)))
    }
  }, [expandGroupId])

  useEffect(() => {
    if (!selectedPuzzleId) return
    const el = document.getElementById(`puzzle-${selectedPuzzleId}`)
    if (el) el.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [selectedPuzzleId, expandedGroups])

  const prevGreenCountRef = useRef(0)
  useEffect(() => {
    const greenCount = frontierSummary?.greenCount ?? 0
    // Auto-expand only when greens first appear; incremental merges during an
    // upload must not re-expand a list the user collapsed manually.
    if (greenCount > 0 && prevGreenCountRef.current === 0) setFrontierExpanded(true)
    prevGreenCountRef.current = greenCount
  }, [frontierSummary])

  const toggleCollection = useCallback((collectionId: string) => {
    setExpandedCollections((prev) => {
      const next = new Set(prev)
      if (next.has(collectionId)) next.delete(collectionId)
      else next.add(collectionId)
      return next
    })
  }, [])

  const toggleGroup = useCallback((groupId: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev)
      if (next.has(groupId)) next.delete(groupId)
      else next.add(groupId)
      return next
    })
  }, [])

  const select = useCallback((puzzleId: string) => {
    onSelectPuzzle(puzzleId === selectedPuzzleId ? null : puzzleId)
    closeNav()
  }, [onSelectPuzzle, selectedPuzzleId, closeNav])

  const onDragEnter = useCallback((event: DragEvent<HTMLElement>) => {
    if (uploading || !event.dataTransfer.types.includes('Files')) return
    dropDepth.current += 1
    setDropActive(true)
  }, [uploading])

  const onDragLeave = useCallback(() => {
    dropDepth.current = Math.max(0, dropDepth.current - 1)
    if (dropDepth.current === 0) setDropActive(false)
  }, [])

  const onDrop = useCallback((event: DragEvent<HTMLElement>) => {
    event.preventDefault()
    dropDepth.current = 0
    setDropActive(false)
    if (uploading) return
    if (event.dataTransfer.files && event.dataTransfer.files.length > 0) handleFiles(event.dataTransfer.files)
  }, [handleFiles, uploading])

  const recentIds = useMemo(() => new Set(recent.map((entry) => entry.id)), [recent])

  return (
    <aside
      className={`sidebar${dropActive ? ' is-drop-target' : ''}`}
      onDragEnter={onDragEnter}
      onDragOver={(event) => { if (!uploading) event.preventDefault() }}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      {dropActive && (
        <div className="sidebar-drop-hint" role="status">
          <IconUpload size={20} />
          <span>Drop .solution files to verify</span>
        </div>
      )}

      <div className="sidebar-scroll">
        {loading && (
          <div className="sidebar-loading">
            <span className="spinner" aria-hidden="true" />
            Loading puzzles…
          </div>
        )}

        {!loading && error && (
          <div className="sidebar-error">
            <IconAlert size={18} />
            <p>The puzzle list could not be loaded.</p>
            <p className="sidebar-error-detail">{error}</p>
            <div className="sidebar-error-actions">
              <button type="button" className="btn btn--sm" onClick={reload}>Retry</button>
              {demoAvailable() && !isDemoEnabled() && (
                <button type="button" className="btn btn--sm btn--primary" onClick={() => setDemoEnabled(true)}>
                  Use demo data
                </button>
              )}
            </div>
          </div>
        )}

        {!loading && !error && recent.length > 0 && (
          <section className="sidebar-section">
            <button
              type="button"
              className="sidebar-head"
              onClick={() => setRecentExpanded((value) => !value)}
              aria-expanded={recentExpanded}
            >
              <span className="sidebar-head-icon" aria-hidden="true"><IconClock size={13} /></span>
              <span className="sidebar-head-title">Recent</span>
              <span className="sidebar-head-count">{recent.length}</span>
              <span className="sidebar-chevron" aria-hidden="true"><IconChevronRight size={13} /></span>
            </button>
            {recentExpanded && (
              <div className="sidebar-recent">
                {recent.map((entry) => (
                  <button
                    key={entry.id}
                    type="button"
                    id={recentIds.has(entry.id) ? `recent-${entry.id}` : undefined}
                    className={`tree-row tree-row--recent${selectedPuzzleId === entry.id ? ' is-selected' : ''}`}
                    onClick={() => select(entry.id)}
                    title={`${entry.name} (${entry.id})`}
                  >
                    <span className="tree-label">{entry.name}</span>
                    <span className="tree-id">{entry.id}</span>
                  </button>
                ))}
              </div>
            )}
          </section>
        )}

        {!loading && !error && (
          <section className="sidebar-section">
            <div className="sidebar-head sidebar-head--static">
              <span className="sidebar-head-icon" aria-hidden="true"><IconGrid size={13} /></span>
              <span className="sidebar-head-title">Puzzles</span>
              <span className="sidebar-head-count">{puzzles.length}</span>
            </div>
            <nav className="tree" aria-label="Puzzle browser">
              {tree.map((collection) => {
                const collectionOpen = expandedCollections.has(collection.id)
                return (
                  <div key={collection.id} className="tree-node">
                    <button
                      type="button"
                      className="tree-row tree-row--collection"
                      aria-expanded={collectionOpen}
                      onClick={() => toggleCollection(collection.id)}
                    >
                      <span className="tree-chevron" aria-hidden="true"><IconChevronRight size={13} /></span>
                      <span className="tree-label">{collection.displayName}</span>
                      <span className="tree-count">{collection.groups.reduce((sum, group) => sum + group.puzzles.length, 0)}</span>
                    </button>
                    {collectionOpen && collection.groups.map((group) => {
                      const groupOpen = expandedGroups.has(group.id)
                      return (
                        <div key={group.id} className="tree-node">
                          <button
                            type="button"
                            className="tree-row tree-row--group"
                            aria-expanded={groupOpen}
                            onClick={() => toggleGroup(group.id)}
                          >
                            <span className="tree-chevron" aria-hidden="true"><IconChevronRight size={13} /></span>
                            <span className="tree-label">{group.displayName}</span>
                            <span className="tree-count">{group.puzzles.length}</span>
                          </button>
                          {groupOpen && group.puzzles.map((puzzle) => (
                            <button
                              key={puzzle.id}
                              type="button"
                              id={`puzzle-${puzzle.id}`}
                              className={`tree-row tree-row--puzzle${selectedPuzzleId === puzzle.id ? ' is-selected' : ''}`}
                              aria-current={selectedPuzzleId === puzzle.id ? 'true' : undefined}
                              title={`${puzzle.displayName} (${puzzle.id})`}
                              onClick={() => select(puzzle.id)}
                            >
                              <span className="tree-label">{puzzle.displayName}</span>
                              <span className="tree-type">{puzzleTypeShort(puzzle.type) ?? puzzle.type}</span>
                            </button>
                          ))}
                        </div>
                      )
                    })}
                  </div>
                )
              })}
            </nav>
          </section>
        )}
      </div>

      <div className="sidebar-dock">
        <div className={`upload-card${uploading ? ' is-busy' : ''}`}>
          <button
            type="button"
            className="upload-card-action"
            onClick={pickFiles}
            disabled={uploading}
            title="Choose a folder of exported .solution files"
          >
            {uploading
              ? <span className="spinner" aria-hidden="true" />
              : <IconUpload size={16} />}
            <span>
              {uploading
                ? `Verifying ${progress?.done ?? 0}/${progress?.total ?? 0}`
                : 'Verify .solution files'}
            </span>
          </button>
          {uploading && progress && (
            <div className="progress" role="progressbar" aria-valuenow={progress.done} aria-valuemax={progress.total}>
              <span style={{ width: `${progress.total ? Math.round((progress.done / progress.total) * 100) : 0}%` }} />
            </div>
          )}
          <p className="upload-card-hint">
            Drop a folder anywhere in this panel — scored locally, never uploaded.
          </p>
        </div>

        {records.length > 0 && (
          <div className="upload-summary">
            <span className="upload-summary-text">
              <strong>{records.length}</strong> verified
              {!uploading && duplicated > 0 && ` · ${duplicated} duplicate`}
              {!uploading && skipped > 0 && ` · ${skipped} skipped`}
              {frontierLoading && ` · computing frontier ${frontierProgress?.done ?? 0}/${frontierProgress?.total ?? 0}`}
            </span>
            {!uploading && (
              <button type="button" className="btn btn--sm btn--ghost btn--danger" onClick={clear} title="Remove every verified solution from this browser">
                <IconTrash size={13} />
                Clear
              </button>
            )}
          </div>
        )}

        {!uploading && records.length === 0 && skipped > 0 && (
          <div className="upload-summary">
            <span className="upload-summary-text">{skipped} skipped</span>
          </div>
        )}

        {storageWarning && (
          <p className="sidebar-warning" role="status">
            <IconAlert size={13} />
            {storageWarning}
          </p>
        )}

        {frontierSummary && frontierSummary.greenCount > 0 && (
          <section className="frontier">
            <button
              type="button"
              className="frontier-toggle"
              onClick={() => setFrontierExpanded((value) => !value)}
              aria-expanded={frontierExpanded}
            >
              <span className="frontier-toggle-icon" aria-hidden="true"><IconTarget size={13} /></span>
              <span className="frontier-toggle-text">{frontierSummary.greenCount} on the Pareto frontier</span>
              <span className="sidebar-chevron" aria-hidden="true"><IconChevronRight size={13} /></span>
            </button>
            {frontierExpanded && (
              <ul className="frontier-list">
                {frontierSummary.records.map((record) => (
                  <li key={record.id} className="frontier-item">
                    <button
                      type="button"
                      className={`frontier-row${selectedPuzzleId === record.puzzleId ? ' is-active' : ''}`}
                      onClick={() => { onSelectPuzzle(record.puzzleId); closeNav() }}
                      title={`Open ${record.puzzleId}`}
                    >
                      <IconSparkle size={12} className="frontier-row-icon" />
                      <span className="frontier-name">{record.solutionName ?? '(unnamed)'}</span>
                      <span className="frontier-puzzle">{record.puzzleId}</span>
                    </button>
                    <span className="frontier-chips">
                      {record.manifoldIds.map((manifoldId) => (
                        <span key={manifoldId} className="chip chip--accent frontier-chip">
                          {getManifold(manifoldId)?.label ?? manifoldId}
                        </span>
                      ))}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}
      </div>
    </aside>
  )
}
