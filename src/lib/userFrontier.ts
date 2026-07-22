import type { OmRecordDTO, OmScoreDTO } from '../types'
import { fetchRecordsWithStatus } from '../api/om'
import { manifoldsForType, computeFrontierIndices, supportsScore, partialCompare, type OmType } from './manifold'

export interface ScoredUserItem {
  id: string
  puzzleId: string
  score: OmScoreDTO
  solutionName?: string | null
}

export interface FrontierRecordDetail {
  id: string
  solutionName: string | null
  puzzleId: string
  manifoldIds: string[]
}

export interface UserFrontierSummary {
  greenCount: number
  records: FrontierRecordDetail[]
}

export interface FrontierProgressInfo {
  done: number
  total: number
  cacheHits: number
}

function asOmType(type: string | undefined): OmType | null {
  if (type === 'NORMAL' || type === 'POLYMER_HEIGHT' || type === 'POLYMER_WIDTH' || type === 'POLYMER_SKEW' || type === 'PRODUCTION') {
    return type
  }
  return null
}

export function computeUserFrontierByManifold(
  puzzleType: OmType,
  leaderboardScores: OmScoreDTO[],
  userItems: ScoredUserItem[],
): Map<string, Set<string>> {
  const manifolds = manifoldsForType(puzzleType)
  const map = new Map<string, Set<string>>()
  if (manifolds.length === 0 || userItems.length === 0) return map
  const userScores = userItems.map((u) => u.score)
  const lbCount = leaderboardScores.length
  for (const m of manifolds) {
    const merged = [...leaderboardScores, ...userScores]
    const frontierDense = computeFrontierIndices(m, merged)
    const greenIds = new Set<string>()
    // Scores of user records already marked green in this manifold. Used
    // to deduplicate user-side ties: if two of the user's own records have
    // identical scores, only the first one encountered is green — the rest
    // are redundant (no better than an existing green record) and red.
    const greenUserScores: OmScoreDTO[] = []
    for (const d of frontierDense) {
      if (d < lbCount) continue
      const userIdx = d - lbCount
      const userScore = userScores[userIdx]
      const equalsLeaderboard = leaderboardScores.some(
        (lb) => supportsScore(m, lb) && partialCompare(m.scoreParts, userScore, lb) === 'EQUAL',
      )
      if (equalsLeaderboard) continue
      const equalsOtherUser = greenUserScores.some(
        (gs) => partialCompare(m.scoreParts, userScore, gs) === 'EQUAL',
      )
      if (equalsOtherUser) continue
      greenIds.add(userItems[userIdx].id)
      greenUserScores.push(userScore)
    }
    map.set(m.id, greenIds)
  }
  return map
}

// Build the frontier detail entries for a single puzzle from its
// leaderboard records (already fetched). Used both by the batch summary
// and by the chart view to refresh one puzzle's slice of the summary with
// freshly fetched (bypass) leaderboard data.
export function computeFrontierDetailsForPuzzle(
  puzzleId: string,
  leaderboard: OmRecordDTO[],
  userItems: ScoredUserItem[],
): FrontierRecordDetail[] {
  if (userItems.length === 0) return []
  const type = asOmType(leaderboard[0]?.puzzle.type)
  if (!type) return []
  const leaderboardScores = leaderboard
    .map((r) => r.score)
    .filter((s): s is OmScoreDTO => s !== null)
  const byManifold = computeUserFrontierByManifold(type, leaderboardScores, userItems)
  const details: FrontierRecordDetail[] = []
  for (const item of userItems) {
    const manifoldIds: string[] = []
    for (const [manifoldId, ids] of byManifold) {
      if (ids.has(item.id)) manifoldIds.push(manifoldId)
    }
    if (manifoldIds.length > 0) {
      details.push({
        id: item.id,
        solutionName: item.solutionName ?? null,
        puzzleId,
        manifoldIds,
      })
    }
  }
  return details
}

function sortDetails(records: FrontierRecordDetail[]): FrontierRecordDetail[] {
  return records.sort((a, b) =>
    a.puzzleId === b.puzzleId
      ? (a.solutionName ?? '').localeCompare(b.solutionName ?? '')
      : a.puzzleId.localeCompare(b.puzzleId),
  )
}

// Replace one puzzle's entries in an existing summary with freshly
// computed details (e.g. from a bypass fetch in the chart view), keeping
// all other puzzles untouched and recomputing the green count.
export function mergeFrontierForPuzzle(
  prev: UserFrontierSummary,
  puzzleId: string,
  details: FrontierRecordDetail[],
): UserFrontierSummary {
  const others = prev.records.filter((r) => r.puzzleId !== puzzleId)
  const merged = sortDetails([...others, ...details])
  const greenIds = new Set<string>()
  for (const r of merged) greenIds.add(r.id)
  return { greenCount: greenIds.size, records: merged }
}

export async function summarizeUserFrontier(
  userItems: ScoredUserItem[],
  onProgress?: (info: FrontierProgressInfo) => void,
): Promise<UserFrontierSummary> {
  const byPuzzle = new Map<string, ScoredUserItem[]>()
  for (const u of userItems) {
    let arr = byPuzzle.get(u.puzzleId)
    if (!arr) {
      arr = []
      byPuzzle.set(u.puzzleId, arr)
    }
    arr.push(u)
  }

  const greenIds = new Set<string>()
  const records: FrontierRecordDetail[] = []
  const puzzles = [...byPuzzle.entries()]
  const total = puzzles.length
  let done = 0
  let cacheHits = 0

  const report = () => onProgress?.({ done, total, cacheHits })

  await Promise.all(
    puzzles.map(async ([puzzleId, items]) => {
      try {
        // Batch-upload path: use the Worker edge cache (30 min TTL) so a
        // burst of N puzzles reuses entries fetched by this or other users.
        const { data: lbRecords, cache } = await fetchRecordsWithStatus(puzzleId, { useCache: true })
        if (cache === 'hit') cacheHits++
        done++
        report()
        const details = computeFrontierDetailsForPuzzle(puzzleId, lbRecords, items)
        for (const d of details) {
          greenIds.add(d.id)
          records.push(d)
        }
      } catch {
        done++
        report()
      }
    }),
  )

  return { greenCount: greenIds.size, records: sortDetails(records) }
}
