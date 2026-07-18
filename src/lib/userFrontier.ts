import type { OmScoreDTO } from '../types'
import { fetchRecords } from '../api/om'
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
    for (const d of frontierDense) {
      if (d >= lbCount) {
        const userIdx = d - lbCount
        const userScore = userScores[userIdx]
        const equalsLeaderboard = leaderboardScores.some(
          (lb) => supportsScore(m, lb) && partialCompare(m.scoreParts, userScore, lb) === 'EQUAL',
        )
        if (!equalsLeaderboard) {
          greenIds.add(userItems[userIdx].id)
        }
      }
    }
    map.set(m.id, greenIds)
  }
  return map
}

export async function summarizeUserFrontier(
  userItems: ScoredUserItem[],
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

  await Promise.all(
    [...byPuzzle.entries()].map(async ([puzzleId, items]) => {
      try {
        const lbRecords = await fetchRecords(puzzleId, { useCache: false })
        const type = asOmType(lbRecords[0]?.puzzle.type)
        if (!type) return
        const leaderboardScores = lbRecords
          .map((r) => r.score)
          .filter((s): s is OmScoreDTO => s !== null)
        const byManifold = computeUserFrontierByManifold(type, leaderboardScores, items)
        for (const item of items) {
          const manifoldIds: string[] = []
          for (const [manifoldId, ids] of byManifold) {
            if (ids.has(item.id)) manifoldIds.push(manifoldId)
          }
          if (manifoldIds.length > 0) {
            greenIds.add(item.id)
            records.push({
              id: item.id,
              solutionName: item.solutionName ?? null,
              puzzleId,
              manifoldIds,
            })
          }
        }
      } catch {
        /* leaderboard unavailable for this puzzle, skip */
      }
    }),
  )

  records.sort((a, b) =>
    a.puzzleId === b.puzzleId
      ? (a.solutionName ?? '').localeCompare(b.solutionName ?? '')
      : a.puzzleId.localeCompare(b.puzzleId),
  )

  return { greenCount: greenIds.size, records }
}
