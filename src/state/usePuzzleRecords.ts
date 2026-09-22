import { useEffect, useMemo, useState } from 'react'
import { fetchRecords, fetchMetrics } from '../api/om'
import type { OmRecordDTO, OmMetricDTO, OmScoreDTO } from '../types'
import type { OmType } from '../lib/manifold'
import { computeUserFrontierByManifold } from '../lib/userFrontier'
import { useUserSolutions } from './userSolutions'
import type { UserSolutionRecord } from './userSolutions'

// Puzzle-level data shared by the records table and the Pareto chart, so the
// fetch happens once no matter which view is mounted. Also hosts the
// frontier-refresh effect: it must run while the table (the default view) is
// showing, not only when the chart is mounted.
export interface PuzzleRecordsData {
  records: OmRecordDTO[]
  // Whether `records` belongs to the currently selected puzzle (guards the
  // window between navigating to puzzle B and B's fetch resolving).
  recordsReady: boolean
  loading: boolean
  error: string | null
  puzzleType: OmType | null
  metrics: OmMetricDTO[]
  puzzleUserRecords: UserSolutionRecord[]
  userFrontierByManifold: Map<string, Set<string>>
}

export function usePuzzleRecords(puzzleId: string | null): PuzzleRecordsData {
  const { records: userRecords, refreshFrontierForPuzzle } = useUserSolutions()
  const [records, setRecords] = useState<OmRecordDTO[]>([])
  // Which puzzle the `records` state belongs to. Stays `null` until the
  // first successful fetch lands, and is updated together with `records`.
  // Used to guard the frontier-refresh effect so navigating from puzzle A
  // to B doesn't momentarily recompute B's slice against A's stale records
  // (which are still in state until B's fetch resolves) — that race caused
  // the sidebar list to flicker (records wrongly appearing/disappearing)
  // before the correct data arrived.
  const [recordsPuzzleId, setRecordsPuzzleId] = useState<string | null>(null)
  const [metrics, setMetrics] = useState<OmMetricDTO[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!puzzleId) {
      setRecords([])
      setRecordsPuzzleId(null)
      setMetrics([])
      setLoading(false)
      setError(null)
      return
    }
    let cancelled = false
    setLoading(true)
    setError(null)
    Promise.all([fetchRecords(puzzleId, { useCache: false }), fetchMetrics()])
      .then(([recs, mets]) => {
        if (cancelled) return
        setRecords(recs)
        setRecordsPuzzleId(puzzleId)
        setMetrics(mets)
        setLoading(false)
      })
      .catch((err) => {
        if (cancelled) return
        setError(err instanceof Error ? err.message : String(err))
        setLoading(false)
      })
    return () => { cancelled = true }
  }, [puzzleId])

  // The records fetch bypasses caches (`useCache: false`), so it has the
  // freshest data. Feed it back to the context so the sidebar frontier list
  // reflects this puzzle's frontier computed against the latest leaderboard
  // rather than the cached snapshot from upload time. The
  // `recordsPuzzleId === puzzleId` guard is essential: without it,
  // navigating from A to B recomputes B's slice against A's records (still
  // in state until B's fetch resolves), corrupting the sidebar list.
  useEffect(() => {
    if (!puzzleId) return
    if (records.length === 0) return
    if (recordsPuzzleId !== puzzleId) return
    refreshFrontierForPuzzle(puzzleId, records)
  }, [puzzleId, records, recordsPuzzleId, refreshFrontierForPuzzle])

  const puzzleType = useMemo<OmType | null>(() => {
    const t = records[0]?.puzzle.type
    return t === 'NORMAL' || t === 'POLYMER_HEIGHT' || t === 'POLYMER_WIDTH' || t === 'POLYMER_SKEW' || t === 'PRODUCTION' ? t : null
  }, [records])

  const puzzleUserRecords = useMemo(
    () => (puzzleType
      ? userRecords.filter((r) => r.puzzleId === puzzleId && r.puzzleType === puzzleType)
      : []),
    [userRecords, puzzleId, puzzleType],
  )

  const userFrontierByManifold = useMemo<Map<string, Set<string>>>(() => {
    if (!puzzleType || puzzleUserRecords.length === 0) return new Map()
    const leaderboardScores: OmScoreDTO[] = []
    for (const r of records) {
      if (r.score !== null) leaderboardScores.push(r.score)
    }
    const userItems = puzzleUserRecords.map((r) => ({ id: r.id, puzzleId: r.puzzleId, score: r.score }))
    return computeUserFrontierByManifold(puzzleType, leaderboardScores, userItems)
  }, [puzzleType, puzzleUserRecords, records])

  return {
    records,
    recordsReady: recordsPuzzleId !== null && recordsPuzzleId === puzzleId,
    loading,
    error,
    puzzleType,
    metrics,
    puzzleUserRecords,
    userFrontierByManifold,
  }
}
