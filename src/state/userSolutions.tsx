import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { OmRecordDTO, OmScoreDTO } from '../types'
import { parseSolutionMeta, formatFullScore, verifyBatch } from '../lib/verify'
import type { BatchInput, SolutionMeta } from '../lib/verify'
import { verifiedToOmScore } from '../lib/verify/convert'
import { summarizeUserFrontierPuzzles, computeFrontierDetailsForPuzzle, mergeFrontierForPuzzle } from '../lib/userFrontier'
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
  const frontierSummaryRef = useRef<UserFrontierSummary | null>(null)
  frontierSummaryRef.current = frontierSummary

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

    let skippedCount = 0
    let duplicatedCount = 0
    // Mirror of the records state, extended as each verification lands so
    // finished solutions become visible immediately instead of only after
    // the whole batch. Null until the first verified record arrives.
    let merged: UserSolutionRecord[] | null = null

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

        // Incremental Pareto judging: a puzzle is judged as soon as every
        // solution uploaded for it has finished simulating, so one slow
        // simulation only delays its own puzzle, never the others. Judged
        // slices are merged into the summary as each batch completes.
        const gen = ++frontierGenRef.current
        const hadSummary = frontierSummaryRef.current !== null
        const pendingByPuzzle = new Map<string, number>()
        const successByPuzzle = new Map<string, number>()
        for (const plan of pendingPlans) {
          const pid = plan.meta.puzzleId
          if (!pid) continue
          pendingByPuzzle.set(pid, (pendingByPuzzle.get(pid) ?? 0) + 1)
        }
        const judgedPuzzles = new Set<string>()
        const readyPuzzles = new Set<string>()
        let judging = false
        let uploadDone = false

        const finishCheck = () => {
          if (judging) return
          if (frontierGenRef.current !== gen) return
          if (readyPuzzles.size > 0) {
            void drainJudging()
            return
          }
          if (!uploadDone) return
          setFrontierLoading(false)
          setFrontierProgress(null)
        }

        async function drainJudging(): Promise<void> {
          if (judging) return
          if (readyPuzzles.size === 0) {
            finishCheck()
            return
          }
          judging = true
          setFrontierLoading(true)
          try {
            while (readyPuzzles.size > 0 && frontierGenRef.current === gen) {
              const batch = [...readyPuzzles]
              readyPuzzles.clear()
              for (const pid of batch) judgedPuzzles.add(pid)
              const items = (merged ?? records).map((r) => ({ id: r.id, puzzleId: r.puzzleId, score: r.score, solutionName: r.solutionName }))
              setFrontierProgress({ done: 0, total: batch.length, cacheHits: 0 })
              const byPuzzle = await summarizeUserFrontierPuzzles(items, new Set(batch), (info) => {
                if (frontierGenRef.current === gen) setFrontierProgress(info)
              })
              if (frontierGenRef.current !== gen) break
              setFrontierSummary((prev) => {
                let next = prev ?? { greenCount: 0, records: [] }
                for (const [pid, details] of byPuzzle) next = mergeFrontierForPuzzle(next, pid, details)
                return next
              })
            }
          } catch {
            /* keep whatever has merged so far */
          } finally {
            judging = false
          }
          finishCheck()
        }

        try {
          await verifyBatch(
            pendingInputs,
            (index, result) => {
              const plan = pendingPlans[index]
              const pid = plan.meta.puzzleId
              if (pid) {
                const left = (pendingByPuzzle.get(pid) ?? 1) - 1
                if (left <= 0) pendingByPuzzle.delete(pid)
                else pendingByPuzzle.set(pid, left)
              }
              if (!result || !result.passed || !result.score || !result.puzzleId) {
                skippedCount++
              } else {
                const record: UserSolutionRecord = {
                  id: plan.index !== null ? records[plan.index].id : genId(),
                  puzzleId: result.puzzleId,
                  puzzleType: result.puzzleType ?? '',
                  solutionName: plan.meta.solutionName,
                  fileName: plan.fileName,
                  hash: plan.hash ?? undefined,
                  score: verifiedToOmScore(result.score),
                  fullScore: formatFullScore(result.score, result.puzzleType ?? undefined),
                }
                const next = (merged ?? records).slice()
                if (plan.index !== null) next[plan.index] = record
                else next.push(record)
                merged = next
                setRecords(next)
                successByPuzzle.set(result.puzzleId, (successByPuzzle.get(result.puzzleId) ?? 0) + 1)
              }
              // All solutions uploaded for this puzzle finished and at
              // least one landed: judge it now instead of at batch end.
              if (pid && !pendingByPuzzle.has(pid) && (successByPuzzle.get(pid) ?? 0) > 0) {
                readyPuzzles.add(pid)
                void drainJudging()
              }
            },
            (done, total) => setProgress({ done, total }),
          )
        } finally {
          uploadDone = true
          // Without a summary to build on (first upload / cleared storage),
          // puzzles this upload did not judge still need a pass so the
          // summary ends up covering every puzzle.
          if (!hadSummary) {
            for (const r of merged ?? records) {
              if (!judgedPuzzles.has(r.puzzleId) && !readyPuzzles.has(r.puzzleId)) readyPuzzles.add(r.puzzleId)
            }
          }
          void drainJudging()
        }
      }
    } catch {
      if (merged === null) skippedCount = all.length
    }

    setSkipped(skippedCount)
    setDuplicated(duplicatedCount)
    setUploading(false)
    setProgress(null)
    runningRef.current = false
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
