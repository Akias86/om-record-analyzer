import { useState, useCallback, useEffect } from 'react'
import { getPuzzleTree } from '../api/om'
import type { CollectionTreeNode } from '../api/om'
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

  if (loading) {
    return <aside className="sidebar"><div className="sidebar-loading">Loading...</div></aside>
  }

  return (
    <aside className="sidebar">
      <div className="sidebar-header">Puzzles</div>
      <nav className="sidebar-nav">
        {tree.map((col) => {
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
        })}
      </nav>
    </aside>
  )
}
