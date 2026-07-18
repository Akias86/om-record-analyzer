import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { OmScoreDTO } from '../types'
import { parseSolutionMeta, verifySolution, formatFullScore } from '../lib/verify'
import { verifiedToOmScore } from '../lib/verify/convert'

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
  addFiles: (files: FileList | File[]) => Promise<void>
  clear: () => void
}

const STORAGE_KEY = 'om-user-solutions'

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

export function UserSolutionsProvider({ children }: { children: ReactNode }) {
  const [records, setRecords] = useState<UserSolutionRecord[]>(() => loadRecords())
  const [uploading, setUploading] = useState(false)
  const [progress, setProgress] = useState<UploadProgress | null>(null)
  const [skipped, setSkipped] = useState(0)
  const [lastUploadTotal, setLastUploadTotal] = useState(0)
  const runningRef = useRef(false)

  useEffect(() => {
    saveRecords(records)
  }, [records])

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
    let done = 0

    for (const file of all) {
      try {
        const bytes = new Uint8Array(await file.arrayBuffer())
        const meta = parseSolutionMeta(bytes)
        if (!meta.puzzleId) {
          skippedCount++
          setSkipped(skippedCount)
          done++
          setProgress({ done, total: all.length })
          continue
        }
        const result = await verifySolution(bytes)
        if (!result.passed || !result.score || !result.puzzleId) {
          skippedCount++
          setSkipped(skippedCount)
          done++
          setProgress({ done, total: all.length })
          continue
        }
        const score = verifiedToOmScore(result.score)
        newRecords.push({
          id: genId(),
          puzzleId: result.puzzleId,
          puzzleType: result.puzzleType ?? '',
          solutionName: meta.solutionName,
          score,
          fullScore: formatFullScore(result.score, result.puzzleType ?? undefined),
        })
      } catch {
        skippedCount++
        setSkipped(skippedCount)
      }
      done++
      setProgress({ done, total: all.length })
    }

    setRecords(newRecords)
    setUploading(false)
    setProgress(null)
    runningRef.current = false
  }, [])

  const clear = useCallback(() => {
    if (runningRef.current) return
    setRecords([])
    setSkipped(0)
    setLastUploadTotal(0)
    setProgress(null)
  }, [])

  const value = useMemo<UserSolutionsContextValue>(
    () => ({ records, uploading, progress, skipped, lastUploadTotal, addFiles, clear }),
    [records, uploading, progress, skipped, lastUploadTotal, addFiles, clear],
  )

  return <UserSolutionsContext.Provider value={value}>{children}</UserSolutionsContext.Provider>
}

export function useUserSolutions(): UserSolutionsContextValue {
  const ctx = useContext(UserSolutionsContext)
  if (!ctx) throw new Error('useUserSolutions must be used within UserSolutionsProvider')
  return ctx
}
