import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { OmRecordDTO, OmScoreDTO } from '../types'
import { parseSolutionMeta, formatFullScore, verifyBatch } from '../lib/verify'
import type { BatchInput, SolutionMeta } from '../lib/verify'
import { verifiedToOmScore } from '../lib/verify/convert'
import { summarizeUserFrontier, computeFrontierDetailsForPuzzle, mergeFrontierForPuzzle } from '../lib/userFrontier'
import type { UserFrontierSummary, FrontierProgressInfo } from '../lib/userFrontier'

export interface UserSolutionRecord {
  id: string
  puzzleId: string
  puzzleType: string
  solutionName: string | null
  score: OmScoreDTO
  fullScore: string
}

interface UploadProgress {
  done: number
  total: number
}

interface UserSolutionsContextValue {
  records: UserSolutionRecord[]
  uploading: boolean
  progress: UploadProgress | null
  skipped: number
  lastUploadTotal: number
  frontierSummary: UserFrontierSummary | null
  frontierLoading: boolean
  frontierProgress: FrontierProgressInfo | null
  addFiles: (files: FileList | File[]) => Promise<void>
  clear: () => void
  // Recompute the frontier for a single puzzle using leaderboard records
  // fetched by the chart view (bypass / fresh), and merge the result into
  // the existing summary so the sidebar list reflects the latest data.
  refreshFrontierForPuzzle: (puzzleId: string, leaderboard: OmRecordDTO[]) => void
}

const STORAGE_KEY = 'om-user-solutions'
const FRONTIER_STORAGE_KEY = 'om-user-solutions-frontier'

const UserSolutionsContext = createContext<UserSolutionsContextValue | null>(null)

function genId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return Math.random().toString(36).slice(2) + Date.now().toString(36)
}

function loadRecords(): UserSolutionRecord[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed as UserSolutionRecord[]
  } catch {
    return []
  }
}

function saveRecords(records: UserSolutionRecord[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(records))
  } catch { /* storage full or unavailable, ignore */ }
}

function loadFrontierSummary(): UserFrontierSummary | null {
  try {
    const raw = localStorage.getItem(FRONTIER_STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as UserFrontierSummary
    if (typeof parsed.greenCount !== 'number' || !Array.isArray(parsed.records)) return null
    return parsed
  } catch {
    return null
  }
}

function saveFrontierSummary(summary: UserFrontierSummary | null): void {
  try {
    if (summary) localStorage.setItem(FRONTIER_STORAGE_KEY, JSON.stringify(summary))
    else localStorage.removeItem(FRONTIER_STORAGE_KEY)
  } catch { /* ignore */ }
}

export function UserSolutionsProvider({ children }: { children: ReactNode }) {
  const [records, setRecords] = useState<UserSolutionRecord[]>(() => loadRecords())
  const [uploading, setUploading] = useState(false)
  const [progress, setProgress] = useState<UploadProgress | null>(null)
  const [skipped, setSkipped] = useState(0)
  const [lastUploadTotal, setLastUploadTotal] = useState(0)
  const [frontierSummary, setFrontierSummary] = useState<UserFrontierSummary | null>(() => loadFrontierSummary())
  const [frontierLoading, setFrontierLoading] = useState(false)
  const [frontierProgress, setFrontierProgress] = useState<FrontierProgressInfo | null>(null)
  const runningRef = useRef(false)
  const frontierGenRef = useRef(0)

  useEffect(() => {
    saveRecords(records)
  }, [records])

  useEffect(() => {
    saveFrontierSummary(frontierSummary)
  }, [frontierSummary])

  const addFiles = useCallback(async (files: FileList | File[]) => {
    if (runningRef.current) return
    const all = Array.from(files).filter((f) => f.name.endsWith('.solution'))
    if (all.length === 0) return
    all.sort((a, b) => a.name.localeCompare(b.name))

    runningRef.current = true
    setUploading(true)
    setProgress({ done: 0, total: all.length })
    setSkipped(0)
    setLastUploadTotal(all.length)

    const newRecords: UserSolutionRecord[] = []
    let skippedCount = 0

    try {
      const inputs: BatchInput[] = []
      const metas: SolutionMeta[] = []
      for (const file of all) {
        const bytes = new Uint8Array(await file.arrayBuffer())
        const meta = parseSolutionMeta(bytes)
        metas.push(meta)
        inputs.push({ bytes, puzzleId: meta.puzzleId })
      }

      const results = await verifyBatch(inputs, undefined, (done, total) =>
        setProgress({ done, total }),
      )

      for (let i = 0; i < inputs.length; i++) {
        const res = results[i]
        const meta = metas[i]
        if (!res || !res.passed || !res.score || !res.puzzleId) {
          skippedCount++
          continue
        }
        newRecords.push({
          id: genId(),
          puzzleId: res.puzzleId,
          puzzleType: res.puzzleType ?? '',
          solutionName: meta.solutionName,
          score: verifiedToOmScore(res.score),
          fullScore: formatFullScore(res.score, res.puzzleType ?? undefined),
        })
      }
    } catch {
      skippedCount = all.length
    }

    setSkipped(skippedCount)
    setRecords(newRecords)
    setUploading(false)
    setProgress(null)
    runningRef.current = false

    if (newRecords.length > 0) {
      const gen = ++frontierGenRef.current
      const uniquePuzzles = new Set(newRecords.map((r) => r.puzzleId)).size
      setFrontierLoading(true)
      setFrontierProgress({ done: 0, total: uniquePuzzles, cacheHits: 0 })
      summarizeUserFrontier(
        newRecords.map((r) => ({ id: r.id, puzzleId: r.puzzleId, score: r.score, solutionName: r.solutionName })),
        (info) => {
          if (frontierGenRef.current === gen) setFrontierProgress(info)
        },
      )
        .then((summary) => {
          if (frontierGenRef.current === gen) {
            setFrontierSummary(summary)
            setFrontierLoading(false)
            setFrontierProgress(null)
          }
        })
        .catch(() => {
          if (frontierGenRef.current === gen) {
            setFrontierLoading(false)
            setFrontierProgress(null)
          }
        })
    } else {
      frontierGenRef.current++
      setFrontierSummary(null)
      setFrontierLoading(false)
      setFrontierProgress(null)
    }
  }, [])

  const clear = useCallback(() => {
    if (runningRef.current) return
    frontierGenRef.current++
    setRecords([])
    setSkipped(0)
    setLastUploadTotal(0)
    setProgress(null)
    setFrontierSummary(null)
    setFrontierLoading(false)
    setFrontierProgress(null)
  }, [])

  const refreshFrontierForPuzzle = useCallback((puzzleId: string, leaderboard: OmRecordDTO[]) => {
    // Only user solutions belonging to THIS puzzle are scored against this
    // puzzle's leaderboard. Filtering by puzzleId (not puzzleType) keeps
    // cross-puzzle solutions out of this slice.
    const items = records
      .filter((r) => r.puzzleId === puzzleId)
      .map((r) => ({ id: r.id, puzzleId: r.puzzleId, score: r.score, solutionName: r.solutionName }))
    const details = computeFrontierDetailsForPuzzle(puzzleId, leaderboard, items)
    setFrontierSummary((prev) => {
      if (!prev) {
        if (details.length === 0) return null
        return mergeFrontierForPuzzle({ greenCount: 0, records: [] }, puzzleId, details)
      }
      // Skip the state update if this puzzle's slice is unchanged (same ids
      // with the same manifold sets) — avoids spurious re-renders and
      // localStorage writes when the chart re-fetches identical data.
      const prevSlice = prev.records.filter((r) => r.puzzleId === puzzleId)
      const sameSlice =
        prevSlice.length === details.length &&
        prevSlice.every((p) => {
          const d = details.find((x) => x.id === p.id)
          return d !== undefined && d.manifoldIds.length === p.manifoldIds.length &&
            d.manifoldIds.every((m) => p.manifoldIds.includes(m))
        })
      if (sameSlice) return prev
      return mergeFrontierForPuzzle(prev, puzzleId, details)
    })
  }, [records])

  const value = useMemo<UserSolutionsContextValue>(
    () => ({ records, uploading, progress, skipped, lastUploadTotal, frontierSummary, frontierLoading, frontierProgress, addFiles, clear, refreshFrontierForPuzzle }),
    [records, uploading, progress, skipped, lastUploadTotal, frontierSummary, frontierLoading, frontierProgress, addFiles, clear, refreshFrontierForPuzzle],
  )

  return <UserSolutionsContext.Provider value={value}>{children}</UserSolutionsContext.Provider>
}

export function useUserSolutions(): UserSolutionsContextValue {
  const ctx = useContext(UserSolutionsContext)
  if (!ctx) throw new Error('useUserSolutions must be used within UserSolutionsProvider')
  return ctx
}
