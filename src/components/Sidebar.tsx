import { useState, useCallback, useEffect, useMemo, useRef } from 'react'
import type { DragEvent } from 'react'
import { getPuzzleTree } from '../api/om'
import type { CollectionTreeNode } from '../api/om'
import { useUserSolutions } from '../state/userSolutions'
import { getManifold } from '../lib/manifold'
import './Sidebar.css'

interface SidebarProps {
  selectedPuzzleId: string | null
  onSelectPuzzle: (puzzleId: string | null) => void
  expandCollectionId?: string | null
  expandGroupId?: string | null
}

export default function Sidebar({ selectedPuzzleId, onSelectPuzzle, expandCollectionId, expandGroupId }: SidebarProps) {
  const [tree, setTree] = useState<CollectionTreeNode[]>([])
  const [expandedCollections, setExpandedCollections] = useState<Set<string>>(new Set())
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [frontierExpanded, setFrontierExpanded] = useState(false)
  const [search, setSearch] = useState('')
  const { records, uploading, progress, skipped, duplicated, lastUploadTotal, frontierSummary, frontierLoading, frontierProgress, addFiles, clear } = useUserSolutions()
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const el = inputRef.current
    if (el) {
      el.setAttribute('webkitdirectory', '')
      el.setAttribute('directory', '')
    }
  }, [])

  const handleFiles = useCallback((files: FileList | File[]) => {
    void addFiles(files)
  }, [addFiles])

  const onDrop = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    if (uploading) return
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleFiles(e.dataTransfer.files)
    }
  }, [handleFiles, uploading])

  useEffect(() => {
    getPuzzleTree()
      .then((data) => {
        setTree(data)
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [])

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

  useEffect(() => {
    if (frontierSummary && frontierSummary.greenCount > 0) setFrontierExpanded(true)
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

  const handlePuzzleClick = useCallback(
    (puzzleId: string) => {
      onSelectPuzzle(puzzleId === selectedPuzzleId ? null : puzzleId)
    },
    [onSelectPuzzle, selectedPuzzleId],
  )

  const query = search.trim().toLowerCase()
  const searchResults = useMemo(() => {
    if (!query) return null
    const results: Array<{ id: string; displayName: string; type: string; path: string }> = []
    for (const col of tree) {
      for (const grp of col.groups) {
        for (const puz of grp.puzzles) {
          if (puz.displayName.toLowerCase().includes(query)) {
            results.push({ id: puz.id, displayName: puz.displayName, type: puz.type, path: `${col.displayName} / ${grp.displayName}` })
          }
        }
      }
    }
    return results
  }, [tree, query])

  if (loading) {
    return <aside className="sidebar"><div className="sidebar-loading">Loading...</div></aside>
  }

  return (
    <aside className="sidebar">
      <div className="sidebar-header">OM Record Analyzer</div>
      <div className="sidebar-search">
        <input
          type="text"
          className="sidebar-search-input"
          placeholder="Search puzzles..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        {search && (
          <button type="button" className="sidebar-search-clear" onClick={() => setSearch('')} aria-label="Clear search">
            {'\u00D7'}
          </button>
        )}
      </div>
      <nav className="sidebar-nav">
        {searchResults ? (
          searchResults.length === 0 ? (
            <div className="sidebar-no-results">No matching puzzles</div>
          ) : (
            searchResults.map((p) => (
              <div
                key={p.id}
                id={`puzzle-${p.id}`}
                className={`sidebar-item sidebar-item-puzzle ${selectedPuzzleId === p.id ? 'selected' : ''}`}
                onClick={() => handlePuzzleClick(p.id)}
                title={p.path}
              >
                <span className="sidebar-label">{p.displayName}</span>
                <span className="sidebar-type">{p.type}</span>
              </div>
            ))
          )
        ) : (
          tree.map((col) => {
          const isColExpanded = expandedCollections.has(col.id)
          return (
            <div key={col.id} className="sidebar-node">
              <div
                className={`sidebar-item sidebar-item-collection ${isColExpanded ? 'expanded' : ''}`}
                onClick={() => toggleCollection(col.id)}
              >
                <span className="sidebar-chevron">{isColExpanded ? '\u25BC' : '\u25B6'}</span>
                <span className="sidebar-label">{col.displayName}</span>
              </div>
              {isColExpanded && (
                <div className="sidebar-children">
                  {col.groups.map((grp) => {
                    const isGrpExpanded = expandedGroups.has(grp.id)
                    return (
                      <div key={grp.id} className="sidebar-node">
                        <div
                          className={`sidebar-item sidebar-item-group ${isGrpExpanded ? 'expanded' : ''}`}
                          onClick={() => toggleGroup(grp.id)}
                        >
                          <span className="sidebar-chevron">{isGrpExpanded ? '\u25BC' : '\u25B6'}</span>
                          <span className="sidebar-label">{grp.displayName}</span>
                          <span className="sidebar-count">{grp.puzzles.length}</span>
                        </div>
                        {isGrpExpanded && (
                          <div className="sidebar-children">
                            {grp.puzzles.map((puz) => (
                              <div
                                key={puz.id}
                                id={`puzzle-${puz.id}`}
                                className={`sidebar-item sidebar-item-puzzle ${selectedPuzzleId === puz.id ? 'selected' : ''}`}
                                onClick={() => handlePuzzleClick(puz.id)}
                              >
                                <span className="sidebar-label">{puz.displayName}</span>
                                <span className="sidebar-type">{puz.type}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )
        })
        )}
      </nav>
      <div
        className={`sidebar-footer ${uploading ? 'is-disabled' : ''}`}
        onDragOver={(e) => { if (!uploading) e.preventDefault() }}
        onDrop={onDrop}
      >
        <input
          ref={inputRef}
          type="file"
          accept=".solution"
          className="sidebar-file-input"
          multiple
          onChange={(e) => { if (e.target.files) handleFiles(e.target.files); e.target.value = '' }}
        />
        <button
          type="button"
          className="sidebar-upload-btn"
          onClick={() => { if (!uploading) inputRef.current?.click() }}
          disabled={uploading}
        >
          {uploading ? `Verifying ${progress?.done ?? 0}/${progress?.total ?? 0}` : 'Upload .solution files'}
        </button>
        {!uploading && records.length > 0 && (
          <div className="sidebar-upload-info">
            <span>
              Loaded {records.length}{duplicated > 0 ? ` (dup ${duplicated})` : ''}{skipped > 0 ? ` (skipped ${skipped})` : ''}
              {frontierLoading
                ? ` · computing frontier ${frontierProgress?.done ?? 0}/${frontierProgress?.total ?? 0}${frontierProgress && frontierProgress.cacheHits > 0 ? ` · ${frontierProgress.cacheHits} cached` : ''}`
                : ''}
            </span>
            <button type="button" className="sidebar-clear-btn" onClick={clear}>Clear</button>
          </div>
        )}
        {!uploading && !frontierLoading && frontierSummary && frontierSummary.greenCount > 0 && (
          <div className="sidebar-frontier">
            <button
              type="button"
              className="sidebar-frontier-toggle"
              onClick={() => setFrontierExpanded((v) => !v)}
            >
              <span className="sidebar-chevron">{frontierExpanded ? '\u25BC' : '\u25B6'}</span>
              <span>{frontierSummary.greenCount} on Pareto frontier</span>
            </button>
            {frontierExpanded && (
              <ul className="sidebar-frontier-list">
                {frontierSummary.records.map((r) => (
                  <li key={r.id} className="sidebar-frontier-item">
                    <button
                      type="button"
                      className={`sidebar-frontier-row ${selectedPuzzleId === r.puzzleId ? 'active' : ''}`}
                      onClick={() => onSelectPuzzle(r.puzzleId)}
                    >
                      <span className="sidebar-frontier-name">{r.solutionName ?? '(unnamed)'}</span>
                      <span className="sidebar-frontier-puzzle">{r.puzzleId}</span>
                    </button>
                    <span className="sidebar-frontier-chips">
                      {r.manifoldIds.map((mid) => (
                        <span key={mid} className="sidebar-frontier-chip">{getManifold(mid)?.label ?? mid}</span>
                      ))}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        {!uploading && records.length === 0 && lastUploadTotal > 0 && (
          <div className="sidebar-upload-info">
            <span>skipped {skipped}</span>
          </div>
        )}
      </div>
    </aside>
  )
}
