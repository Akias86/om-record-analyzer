import { useState, useCallback, useEffect } from 'react'
import { fetchCollections, fetchGroupsByCollection, fetchPuzzlesByGroup } from '../api/om'
import type { OmCollectionDTO, OmGroupDTO, OmPuzzleDTO } from '../types'
import './Sidebar.css'

interface SidebarProps {
  selectedPuzzleId: string | null
  onSelectPuzzle: (puzzleId: string | null) => void
  expandCollectionId?: string | null
  expandGroupId?: string | null
}

export default function Sidebar({ selectedPuzzleId, onSelectPuzzle, expandCollectionId, expandGroupId }: SidebarProps) {
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
    for (const collectionId of expandedCollections) {
      if (!groupsMap[collectionId]) {
        fetchGroupsByCollection(collectionId).then((groups) => {
          setGroupsMap((prev) => (prev[collectionId] ? prev : { ...prev, [collectionId]: groups }))
        })
      }
    }
  }, [expandedCollections, groupsMap])

  useEffect(() => {
    for (const groupId of expandedGroups) {
      if (!puzzlesMap[groupId]) {
        fetchPuzzlesByGroup(groupId).then((puzzles) => {
          setPuzzlesMap((prev) => (prev[groupId] ? prev : { ...prev, [groupId]: puzzles }))
        })
      }
    }
  }, [expandedGroups, puzzlesMap])

  useEffect(() => {
    if (!selectedPuzzleId) return
    const el = document.getElementById(`puzzle-${selectedPuzzleId}`)
    if (el) el.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [selectedPuzzleId, expandedGroups, puzzlesMap])

  const toggleCollection = useCallback(
    (collectionId: string) => {
      setExpandedCollections((prev) => {
        const next = new Set(prev)
        if (next.has(collectionId)) next.delete(collectionId)
        else next.add(collectionId)
        return next
      })
    },
    [],
  )

  const toggleGroup = useCallback(
    (groupId: string) => {
      setExpandedGroups((prev) => {
        const next = new Set(prev)
        if (next.has(groupId)) next.delete(groupId)
        else next.add(groupId)
        return next
      })
    },
    [],
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
