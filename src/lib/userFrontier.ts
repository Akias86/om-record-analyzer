import type { OmRecordDTO, OmScoreDTO } from '../types'
import { fetchRecordsWithStatus } from '../api/om'
import { manifoldsForType, computeFrontierIndices, supportsScore, partialCompare, type OmType, type MetricId } from './manifold'

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

  // Union of all manifolds' score parts for this type. Used to determine
  // global domination between user records: when two records tie in a
  // single manifold's dimensions but one is better in dimensions outside
  // that manifold, the better one should win the tie.
  const allParts: MetricId[] = []
  const seenParts = new Set<string>()
  for (const m of manifolds) {
    for (const s of m.scoreParts) {
      if (!seenParts.has(s)) { seenParts.add(s); allParts.push(s) }
    }
  }

  // Sort user items so globally-dominating records come first. This
  // ensures the EQUAL dedup below keeps the "best" record when multiple
  // user records tie in a manifold's dimensions but one is objectively
  // better across all dimensions (e.g. same height/cost/cycles but lower
  // area and boundingHex). Without this, the tiebreak was arbitrary
  // (dependent on file-name sort order), so a worse record could appear
  // green while the better one was red.
  const sortedItems = [...userItems].sort((a, b) => {
    const order = partialCompare(allParts, a.score, b.score)
    if (order === 'SMALLER') return -1
    if (order === 'BIGGER') return 1
    return 0
  })
  const userScores = sortedItems.map((u) => u.score)
  const lbCount = leaderboardScores.length
  for (const m of manifolds) {
    const merged = [...leaderboardScores, ...userScores]
    const frontierDense = computeFrontierIndices(m, merged)
    const greenIds = new Set<string>()
    const greenUserScores: OmScoreDTO[] = []
    for (const d of frontierDense) {
      if (d < lbCount) continue
      const userIdx = d - lbCount
      const userScore = userScores[userIdx]
      const equalsLeaderboard = leaderboardScores.some(
        (lb) => supportsScore(m, lb) && partialCompare(m.scoreParts, userScore, lb) === 'EQUAL',
      )
      if (equalsLeaderboard) continue
      // Deduplicate user-side ties. Only skip the current record when an
      // already-green record is globally better (BIGGER) or identical
      // (EQUAL) across ALL dimensions. If they are globally incomparable
      // (each better in different dimensions), both stay green — they
      // represent genuinely different trade-offs that happen to tie in
      // this manifold's subset of dimensions.
      const equalsOtherUser = greenUserScores.some((gs) => {
        if (partialCompare(m.scoreParts, userScore, gs) !== 'EQUAL') return false
        const globalOrder = partialCompare(allParts, userScore, gs)
        return globalOrder === 'BIGGER' || globalOrder === 'EQUAL'
      })
      if (equalsOtherUser) continue
      greenIds.add(sortedItems[userIdx].id)
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
