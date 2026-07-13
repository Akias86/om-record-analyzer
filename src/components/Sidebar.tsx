import { useState, useCallback, useEffect } from 'react'
import { fetchCollections, fetchGroupsByCollection, fetchPuzzlesByGroup } from '../api/om'
import type { OmCollectionDTO, OmGroupDTO, OmPuzzleDTO } from '../types'
import './Sidebar.css'

interface SidebarProps {
  selectedPuzzleId: string | null
  onSelectPuzzle: (puzzleId: string | null) => void
}

export default function Sidebar({ selectedPuzzleId, onSelectPuzzle }: SidebarProps) {
  const [collections, setCollections] = useState<OmCollectionDTO[]>([])
  const [expandedCollections, setExpandedCollections] = useState<Set<string>>(new Set())
  const [groupsMap, setGroupsMap] = useState<Record<string, OmGroupDTO[]>>({})
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set())
  const [puzzlesMap, setPuzzlesMap] = useState<Record<string, OmPuzzleDTO[]>>({})
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchCollections()
      .then((data) => {
        setCollections(data)
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [])

  const toggleCollection = useCallback(
    async (collectionId: string) => {
      const next = new Set(expandedCollections)
      if (next.has(collectionId)) {
        next.delete(collectionId)
        setExpandedCollections(next)
      } else {
        next.add(collectionId)
        setExpandedCollections(next)
        if (!groupsMap[collectionId]) {
          const groups = await fetchGroupsByCollection(collectionId)
          setGroupsMap((prev) => ({ ...prev, [collectionId]: groups }))
        }
      }
    },
    [expandedCollections, groupsMap],
  )

  const toggleGroup = useCallback(
    async (groupId: string) => {
      const next = new Set(expandedGroups)
      if (next.has(groupId)) {
        next.delete(groupId)
        setExpandedGroups(next)
      } else {
        next.add(groupId)
        setExpandedGroups(next)
        if (!puzzlesMap[groupId]) {
          const puzzles = await fetchPuzzlesByGroup(groupId)
          setPuzzlesMap((prev) => ({ ...prev, [groupId]: puzzles }))
        }
      }
    },
    [expandedGroups, puzzlesMap],
  )

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
        {collections.map((col) => {
          const isColExpanded = expandedCollections.has(col.id)
          const groups = groupsMap[col.id] ?? []
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
                  {groups.map((grp) => {
                    const isGrpExpanded = expandedGroups.has(grp.id)
                    const puzzles = puzzlesMap[grp.id] ?? []
                    return (
                      <div key={grp.id} className="sidebar-node">
                        <div
                          className={`sidebar-item sidebar-item-group ${isGrpExpanded ? 'expanded' : ''}`}
                          onClick={() => toggleGroup(grp.id)}
                        >
                          <span className="sidebar-chevron">{isGrpExpanded ? '\u25BC' : '\u25B6'}</span>
                          <span className="sidebar-label">{grp.displayName}</span>
                          <span className="sidebar-count">{puzzles.length > 0 ? puzzles.length : ''}</span>
                        </div>
                        {isGrpExpanded && (
                          <div className="sidebar-children">
                            {puzzles.map((puz) => (
                              <div
                                key={puz.id}
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
