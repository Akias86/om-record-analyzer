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
  fileName?: string
  hash?: string
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
  duplicated: number
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

async function sha256(bytes: Uint8Array): Promise<string | null> {
  const subtle = typeof crypto !== 'undefined' ? crypto.subtle : undefined
  if (!subtle) return null
  try {
    const digest = await subtle.digest('SHA-256', bytes.buffer as ArrayBuffer)
    return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
  } catch {
    return null
  }
}

interface ParsedSolutionFile {
  file: File
  bytes: Uint8Array
  meta: SolutionMeta
  hash: string | null
}

interface PendingSolution {
  index: number | null
  meta: SolutionMeta
  fileName: string
  hash: string | null
}

// Index of the record representing the same solution as the parsed file, or
// null for a brand-new solution. Matching uses puzzleId + file name; legacy
// records persisted before the fileName field existed fall back to the
// embedded solution name.
function findRecordMatch(records: UserSolutionRecord[], parsed: ParsedSolutionFile): number | null {
  const { meta } = parsed
  if (!meta.puzzleId) return null
  for (let i = 0; i < records.length; i++) {
    const r = records[i]
    if (r.puzzleId !== meta.puzzleId) continue
    if (r.fileName !== undefined) {
      if (r.fileName.toLowerCase() === parsed.file.name.toLowerCase()) return i
    } else if (r.solutionName && meta.solutionName) {
      if (r.solutionName.toLowerCase() === meta.solutionName.toLowerCase()) return i
    }
  }
  return null
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
  const [duplicated, setDuplicated] = useState(0)
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
    setSkipped(0)
    setDuplicated(0)
    setLastUploadTotal(all.length)

    let merged = records
    let skippedCount = 0
    let duplicatedCount = 0

    try {
      const parsed = await Promise.all(
        all.map(async (file) => {
          const bytes = new Uint8Array(await file.arrayBuffer())
          return { file, bytes, meta: parseSolutionMeta(bytes), hash: await sha256(bytes) }
        }),
      )

      const pendingInputs: BatchInput[] = []
      const pendingPlans: PendingSolution[] = []
      for (const p of parsed) {
        const match = findRecordMatch(records, p)
        const recordHash = match !== null ? records[match].hash : undefined
        if (recordHash && p.hash && recordHash === p.hash) {
          duplicatedCount++
          continue
        }
        pendingPlans.push({ index: match, meta: p.meta, fileName: p.file.name, hash: p.hash })
        pendingInputs.push({ bytes: p.bytes, puzzleId: p.meta.puzzleId })
      }

      if (pendingInputs.length > 0) {
        setProgress({ done: 0, total: pendingInputs.length })
        const results = await verifyBatch(pendingInputs, undefined, (done, total) =>
          setProgress({ done, total }),
        )
        const next = [...records]
        for (let i = 0; i < pendingInputs.length; i++) {
          const res = results[i]
          const plan = pendingPlans[i]
          if (!res || !res.passed || !res.score || !res.puzzleId) {
            skippedCount++
            continue
          }
          const record: UserSolutionRecord = {
            id: plan.index !== null ? records[plan.index].id : genId(),
            puzzleId: res.puzzleId,
            puzzleType: res.puzzleType ?? '',
            solutionName: plan.meta.solutionName,
            fileName: plan.fileName,
            hash: plan.hash ?? undefined,
            score: verifiedToOmScore(res.score),
            fullScore: formatFullScore(res.score, res.puzzleType ?? undefined),
          }
          if (plan.index !== null) next[plan.index] = record
          else next.push(record)
        }
        merged = next
      }
    } catch {
      skippedCount = all.length
    }

    setSkipped(skippedCount)
    setDuplicated(duplicatedCount)
    setUploading(false)
    setProgress(null)
    runningRef.current = false

    if (merged.length === 0) {
      frontierGenRef.current++
      setFrontierSummary(null)
      setFrontierLoading(false)
      setFrontierProgress(null)
      return
    }

    const changed = merged.length !== records.length || merged.some((r, i) => r !== records[i])
    if (!changed) return
    setRecords(merged)

    const gen = ++frontierGenRef.current
    const uniquePuzzles = new Set(merged.map((r) => r.puzzleId)).size
    setFrontierLoading(true)
    setFrontierProgress({ done: 0, total: uniquePuzzles, cacheHits: 0 })
    summarizeUserFrontier(
      merged.map((r) => ({ id: r.id, puzzleId: r.puzzleId, score: r.score, solutionName: r.solutionName })),
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
  }, [records])

  const clear = useCallback(() => {
    if (runningRef.current) return
    frontierGenRef.current++
    setRecords([])
    setSkipped(0)
    setDuplicated(0)
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
    () => ({ records, uploading, progress, skipped, duplicated, lastUploadTotal, frontierSummary, frontierLoading, frontierProgress, addFiles, clear, refreshFrontierForPuzzle }),
    [records, uploading, progress, skipped, duplicated, lastUploadTotal, frontierSummary, frontierLoading, frontierProgress, addFiles, clear, refreshFrontierForPuzzle],
  )

  return <UserSolutionsContext.Provider value={value}>{children}</UserSolutionsContext.Provider>
}

export function useUserSolutions(): UserSolutionsContextValue {
  const ctx = useContext(UserSolutionsContext)
  if (!ctx) throw new Error('useUserSolutions must be used within UserSolutionsProvider')
  return ctx
}
