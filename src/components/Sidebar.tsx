import { useState, useCallback, useEffect, useMemo, useRef } from 'react'
import type { DragEvent } from 'react'
import { Badge } from '@astryxdesign/core/Badge'
import { Button } from '@astryxdesign/core/Button'
import { Collapsible } from '@astryxdesign/core/Collapsible'
import { EmptyState } from '@astryxdesign/core/EmptyState'
import { HStack } from '@astryxdesign/core/HStack'
import { ProgressBar } from '@astryxdesign/core/ProgressBar'
import { SideNav, SideNavHeading, SideNavItem } from '@astryxdesign/core/SideNav'
import { Spinner } from '@astryxdesign/core/Spinner'
import { Text } from '@astryxdesign/core/Text'
import { TextInput } from '@astryxdesign/core/TextInput'
import { VStack } from '@astryxdesign/core/VStack'
import { FlaskConical, Sparkles, Trash2, Upload } from 'lucide-react'
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

function shortTypeLabel(type: string): string {
  if (type === 'PRODUCTION') return 'PROD'
  if (type === 'POLYMER') return 'POLY'
  return type
}

export default function Sidebar({ selectedPuzzleId, onSelectPuzzle, expandCollectionId, expandGroupId }: SidebarProps) {
  const [tree, setTree] = useState<CollectionTreeNode[]>([])
  const [expandedCollections, setExpandedCollections] = useState<Set<string>>(new Set())
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [frontierExpanded, setFrontierExpanded] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const [search, setSearch] = useState('')
  const {
    records,
    uploading,
    progress,
    skipped,
    duplicated,
    lastUploadTotal,
    storageWarning,
    frontierSummary,
    frontierLoading,
    frontierProgress,
    addFiles,
    clear,
  } = useUserSolutions()
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
    setDragOver(false)
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

  const prevGreenCountRef = useRef(0)
  useEffect(() => {
    const greenCount = frontierSummary?.greenCount ?? 0
    // Auto-expand only when greens first appear; incremental merges during
    // an upload must not re-expand a list the user collapsed manually.
    if (greenCount > 0 && prevGreenCountRef.current === 0) setFrontierExpanded(true)
    prevGreenCountRef.current = greenCount
  }, [frontierSummary])

  const setCollectionOpen = useCallback((collectionId: string, isOpen: boolean) => {
    setExpandedCollections((prev) => {
      const next = new Set(prev)
      if (isOpen) next.add(collectionId)
      else next.delete(collectionId)
      return next
    })
  }, [])

  const setGroupOpen = useCallback((groupId: string, isOpen: boolean) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev)
      if (isOpen) next.add(groupId)
      else next.delete(groupId)
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
          if (puz.displayName.toLowerCase().includes(query) || puz.id.toLowerCase().includes(query)) {
            results.push({ id: puz.id, displayName: puz.displayName, type: puz.type, path: `${col.displayName} / ${grp.displayName}` })
          }
        }
      }
    }
    return results
  }, [tree, query])

  const footerContent = (
    <div
      className={`sidebar-upload-panel${uploading ? ' is-disabled' : ''}${dragOver ? ' is-drag-over' : ''}`}
      onDragOver={(e) => {
        if (!uploading) {
          e.preventDefault()
          setDragOver(true)
        }
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={onDrop}
    >
      <input
        ref={inputRef}
        type="file"
        accept=".solution"
        className="sidebar-file-input"
        multiple
        onChange={(e) => {
          if (e.target.files) handleFiles(e.target.files)
          e.target.value = ''
        }}
      />
      <Button
        variant="primary"
        size="sm"
        width="100%"
        icon={<Upload size={14} />}
        isLoading={uploading}
        isDisabled={uploading}
        label={uploading ? `Verifying ${progress?.done ?? 0}/${progress?.total ?? 0}` : 'Upload .solution folder'}
        onClick={() => { if (!uploading) inputRef.current?.click() }}
      />
      {uploading && progress && progress.total > 0 && (
        <ProgressBar
          label="Verifying solutions"
          isLabelHidden
          value={progress.done}
          max={Math.max(1, progress.total)}
          variant="accent"
        />
      )}
      {records.length > 0 && (
        <HStack justify="between" vAlign="center" gap={1.5} className="sidebar-upload-meta">
          <Text type="supporting" size="xsm" hasTabularNumbers>
            Loaded {records.length}
            {!uploading && duplicated > 0 ? ` · dup ${duplicated}` : ''}
            {!uploading && skipped > 0 ? ` · skip ${skipped}` : ''}
            {frontierLoading
              ? ` · frontier ${frontierProgress?.done ?? 0}/${frontierProgress?.total ?? 0}${frontierProgress && frontierProgress.cacheHits > 0 ? ` (${frontierProgress.cacheHits} cached)` : ''}`
              : ''}
          </Text>
          {!uploading && (
            <Button
              variant="ghost"
              size="sm"
              icon={<Trash2 size={12} />}
              label="Clear"
              onClick={clear}
            />
          )}
        </HStack>
      )}
      {storageWarning && (
        <div className="sidebar-warning" role="status">
          {storageWarning}
        </div>
      )}
      {frontierSummary && frontierSummary.greenCount > 0 && (
        <div className="sidebar-frontier-card">
          <Collapsible
            isOpen={frontierExpanded}
            onOpenChange={setFrontierExpanded}
            chevronPosition="start"
            trigger={
              <HStack gap={1.5} vAlign="center">
                <Sparkles size={13} className="sidebar-frontier-icon" />
                <Text type="label" size="sm" color="accent">
                  {frontierSummary.greenCount} on Pareto frontier
                </Text>
              </HStack>
            }
          >
            <ul className="sidebar-frontier-list">
              {frontierSummary.records.map((r) => (
                <li key={r.id} className="sidebar-frontier-item">
                  <button
                    type="button"
                    className={`sidebar-frontier-row${selectedPuzzleId === r.puzzleId ? ' active' : ''}`}
                    onClick={() => onSelectPuzzle(r.puzzleId)}
                  >
                    <span className="sidebar-frontier-name">{r.solutionName ?? '(unnamed)'}</span>
                    <span className="sidebar-frontier-puzzle">{r.puzzleId}</span>
                  </button>
                  <span className="sidebar-frontier-chips">
                    {r.manifoldIds.map((mid) => (
                      <Badge key={mid} variant="green" label={getManifold(mid)?.label ?? mid} />
                    ))}
                  </span>
                </li>
              ))}
            </ul>
          </Collapsible>
        </div>
      )}
      {!uploading && records.length === 0 && lastUploadTotal > 0 && (
        <Text type="supporting" size="xsm">
          Skipped {skipped} file{skipped === 1 ? '' : 's'}
        </Text>
      )}
    </div>
  )

  return (
    <SideNav
      aria-label="Puzzle navigation"
      resizable={{ defaultWidth: 296, minWidth: 244, maxWidth: 420, autoSaveId: 'om-sidebar-width' }}
      header={
        <SideNavHeading
          heading="OM Record Analyzer"
          subheading="Opus Magnum Leaderboard"
          icon={
            <span className="sidebar-brand-mark" aria-hidden="true">
              <FlaskConical size={17} />
            </span>
          }
        />
      }
      topContent={
        <div className="sidebar-search-box">
          <TextInput
            type="search"
            label="Search puzzles"
            isLabelHidden
            startIcon="search"
            hasClear
            size="sm"
            width="100%"
            placeholder="Search puzzles..."
            value={search}
            onChange={(val) => setSearch(val)}
          />
        </div>
      }
      footer={footerContent}
    >
      {loading ? (
        <VStack padding={4} align="center">
          <Spinner size="md" label="Loading puzzles..." />
        </VStack>
      ) : searchResults ? (
        searchResults.length === 0 ? (
          <div className="sidebar-empty-wrap">
            <EmptyState
              isCompact
              title="No matching puzzles"
              description="Try searching by puzzle name or ID."
            />
          </div>
        ) : (
          <div className="sidebar-search-results">
            {searchResults.map((p) => (
              <div key={p.id} id={`puzzle-${p.id}`} title={p.path}>
                <SideNavItem
                  size="sm"
                  label={p.displayName}
                  isSelected={selectedPuzzleId === p.id}
                  onClick={() => handlePuzzleClick(p.id)}
                  endContent={
                    p.type !== 'NORMAL' ? (
                      <span className="sidebar-type-tag">{shortTypeLabel(p.type)}</span>
                    ) : undefined
                  }
                />
              </div>
            ))}
          </div>
        )
      ) : (
        tree.map((col) => {
          const isColExpanded = expandedCollections.has(col.id)
          return (
            <SideNavItem
              key={col.id}
              label={col.displayName}
              collapsible={{
                isCollapsed: !isColExpanded,
                onCollapsedChange: (collapsed) => setCollectionOpen(col.id, !collapsed),
              }}
            >
              {col.groups.map((grp) => {
                const grpKey = grp.id
                const isGrpExpanded = expandedGroups.has(grpKey)
                return (
                  <SideNavItem
                    key={grp.id}
                    size="sm"
                    label={grp.displayName}
                    endContent={<span className="sidebar-count-pill">{grp.puzzles.length}</span>}
                    collapsible={{
                      isCollapsed: !isGrpExpanded,
                      onCollapsedChange: (collapsed) => setGroupOpen(grpKey, !collapsed),
                    }}
                  >
                    {grp.puzzles.map((puz) => (
                      <div key={puz.id} id={`puzzle-${puz.id}`}>
                        <SideNavItem
                          size="sm"
                          label={puz.displayName}
                          isSelected={selectedPuzzleId === puz.id}
                          onClick={() => handlePuzzleClick(puz.id)}
                          endContent={
                            puz.type !== 'NORMAL' ? (
                              <span className="sidebar-type-tag">{shortTypeLabel(puz.type)}</span>
                            ) : undefined
                          }
                        />
                      </div>
                    ))}
                  </SideNavItem>
                )
              })}
            </SideNavItem>
          )
        })
      )}
    </SideNav>
  )
}
