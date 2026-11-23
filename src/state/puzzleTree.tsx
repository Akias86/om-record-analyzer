import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { getPuzzleTree } from '../api/om'
import type { CollectionTreeNode } from '../api/om'

/* The puzzle tree is needed by both the sidebar (navigation) and the top bar
   (search), so it is fetched once here and shared. `getPuzzleTree` also
   memoises the request itself, which keeps a reload cheap. */

export interface FlatPuzzle {
  id: string
  displayName: string
  type: string
  groupId: string
  groupName: string
  collectionId: string
  collectionName: string
}

interface PuzzleTreeValue {
  tree: CollectionTreeNode[]
  puzzles: FlatPuzzle[]
  loading: boolean
  error: string | null
  reload: () => void
}

const PuzzleTreeContext = createContext<PuzzleTreeValue | null>(null)

function flatten(tree: CollectionTreeNode[]): FlatPuzzle[] {
  const out: FlatPuzzle[] = []
  for (const collection of tree) {
    for (const group of collection.groups) {
      for (const puzzle of group.puzzles) {
        out.push({
          id: puzzle.id,
          displayName: puzzle.displayName,
          type: puzzle.type,
          groupId: group.id,
          groupName: group.displayName,
          collectionId: collection.id,
          collectionName: collection.displayName,
        })
      }
    }
  }
  return out
}

export function PuzzleTreeProvider({ children }: { children: ReactNode }) {
  const [tree, setTree] = useState<CollectionTreeNode[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    getPuzzleTree()
      .then((data) => {
        if (cancelled) return
        setTree(data)
        setLoading(false)
      })
      .catch((cause: unknown) => {
        if (cancelled) return
        setError(cause instanceof Error ? cause.message : String(cause))
        setLoading(false)
      })
    return () => { cancelled = true }
  }, [attempt])

  const reload = useCallback(() => setAttempt((value) => value + 1), [])
  const puzzles = useMemo(() => flatten(tree), [tree])
  const value = useMemo<PuzzleTreeValue>(
    () => ({ tree, puzzles, loading, error, reload }),
    [tree, puzzles, loading, error, reload],
  )

  return <PuzzleTreeContext.Provider value={value}>{children}</PuzzleTreeContext.Provider>
}

export function usePuzzleTree(): PuzzleTreeValue {
  const value = useContext(PuzzleTreeContext)
  if (!value) throw new Error('usePuzzleTree must be used inside <PuzzleTreeProvider>')
  return value
}
