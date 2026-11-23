import { computeFrontierIndices, manifoldsForType } from '../../lib/manifold'
import type { OmType } from '../../lib/manifold'
import { formatFullScore, formatScoreParts } from '../../lib/verify/format'
import type { OmRecordDTO, OmScoreDTO } from '../../types'
import { parseScoreString } from './scoreString'

/* ---------------------------------------------------------------------------
   Turns a demo puzzle plus its leaderboard score strings into the record DTOs
   the app already consumes, so every view (table, chart, tooltips, categories,
   playback links) exercises exactly the production code path.

   Category badges are recomputed here with the app's own frontier algorithm
   rather than copied from the API, which keeps the demo honest: the labels you
   see are the manifolds the record really is on.
--------------------------------------------------------------------------- */

export interface DemoPuzzle {
  id: string
  name: string
  type: string
  group: { id: string; name: string; collection: { id: string; name: string } }
  /** Path inside the public-domain om-leaderboard repository, when known. */
  path: string | null
}

const OM_TYPES: readonly OmType[] = ['NORMAL', 'POLYMER_HEIGHT', 'POLYMER_WIDTH', 'POLYMER_SKEW', 'PRODUCTION']

const SOLUTION_BASE = 'https://raw.githubusercontent.com/zachtronics-leaderboards/om-leaderboard/master'

export function asOmType(value: string): OmType | null {
  return (OM_TYPES as readonly string[]).includes(value) ? (value as OmType) : null
}

/** Immutable solution link, matching the shape the playback path expects. */
export function demoSolutionUrl(puzzle: DemoPuzzle, scoreString: string): string | null {
  if (!puzzle.path) return null
  const slug = puzzle.path.slice(puzzle.path.lastIndexOf('/') + 1)
  return `${SOLUTION_BASE}/${puzzle.path}/${slug}_${scoreString}.solution`
}

export function buildDemoRecords(puzzle: DemoPuzzle, scoreStrings: readonly string[]): OmRecordDTO[] {
  const type = asOmType(puzzle.type)
  const parsed: Array<{ scoreString: string; score: OmScoreDTO }> = []
  for (const scoreString of scoreStrings) {
    const score = parseScoreString(scoreString)
    if (score) parsed.push({ scoreString, score })
  }
  // Cost first, then cycles: the order the leaderboard lists records in.
  parsed.sort((a, b) => a.score.cost - b.score.cost || a.score.cycles - b.score.cycles)

  const scores = parsed.map((entry) => entry.score)
  const categories: string[][] = scores.map(() => [])
  if (type) {
    for (const manifold of manifoldsForType(type)) {
      for (const index of computeFrontierIndices(manifold, scores)) categories[index].push(manifold.label)
    }
  }

  const detail = {
    id: puzzle.id,
    displayName: puzzle.name,
    group: {
      id: puzzle.group.id,
      displayName: puzzle.group.name,
      collectionId: puzzle.group.collection.id,
    },
    type: puzzle.type,
    altIds: [] as string[],
  }

  return parsed.map(({ scoreString, score }, index) => ({
    id: `demo-${puzzle.id}-${index}`,
    puzzle: detail,
    score,
    smartFormattedScore: formatScoreParts(score, puzzle.type).victory,
    fullFormattedScore: formatFullScore(score, puzzle.type),
    gif: null,
    solution: demoSolutionUrl(puzzle, scoreString),
    categoryIds: categories[index],
    smartFormattedCategories: categories[index].join(', ') || null,
    lastModified: null,
    author: null,
  }))
}
