import { METRIC_LABELS } from '../../types'
import type { OmMetricDTO } from '../../types'
import puzzleData from './puzzles.json'
import scoreData from './scores.json'
import { buildDemoRecords } from './records'
import type { DemoPuzzle } from './records'

/* ---------------------------------------------------------------------------
   Offline demo API. Serves the same endpoints as the Cloudflare Worker proxy
   (`/api/om/puzzles`, `/api/om/metrics`, `/api/om/puzzle/:id/records`) from
   the bundled public-domain dataset, so the UI can be developed, reviewed and
   demoed without reaching zlbb.faendir.com.

   Development only: src/api/demo.ts guards this module behind
   `import.meta.env.DEV`, so the dataset never ships in a production bundle.
--------------------------------------------------------------------------- */

const PUZZLES = puzzleData as DemoPuzzle[]
const SCORES = scoreData as Record<string, string[]>

const PUZZLE_BY_ID = new Map(PUZZLES.map((puzzle) => [puzzle.id, puzzle]))

const RECORDS_BY_ID = new Map<string, ReturnType<typeof buildDemoRecords>>()

const BOOL_METRICS = new Set(['overlap', 'trackless', 'looping'])

const METRICS: OmMetricDTO[] = Object.entries(METRIC_LABELS).map(([id, displayName]) => ({
  id,
  displayName,
  description: BOOL_METRICS.has(id) ? `${displayName} solutions only` : `Sort or plot by ${displayName.toLowerCase()}`,
  type: BOOL_METRICS.has(id) ? 'BOOLEAN' : 'NUMBER',
}))

export interface DemoApi {
  /** Response body for an `/api/om/...` URL, or undefined when unhandled. */
  get(url: string): unknown | undefined
  puzzles: DemoPuzzle[]
}

function recordsFor(puzzleId: string) {
  const cached = RECORDS_BY_ID.get(puzzleId)
  if (cached) return cached
  const puzzle = PUZZLE_BY_ID.get(puzzleId)
  const built = puzzle ? buildDemoRecords(puzzle, SCORES[puzzleId] ?? []) : []
  RECORDS_BY_ID.set(puzzleId, built)
  return built
}

const RECORDS_PATH = /^\/api\/om\/puzzle\/([^/]+)\/records$/

export function createDemoApi(): DemoApi {
  return {
    puzzles: PUZZLES,
    get(url: string) {
      const { pathname } = new URL(url, 'http://demo.invalid')
      if (pathname === '/api/om/puzzles') {
        return PUZZLES.map((puzzle) => ({
          id: puzzle.id,
          displayName: puzzle.name,
          type: puzzle.type,
          group: {
            id: puzzle.group.id,
            displayName: puzzle.group.name,
            collection: {
              id: puzzle.group.collection.id,
              displayName: puzzle.group.collection.name,
            },
          },
          altIds: [],
        }))
      }
      if (pathname === '/api/om/metrics') return METRICS
      const match = RECORDS_PATH.exec(pathname)
      if (match) {
        let puzzleId = match[1] as string
        try {
          puzzleId = decodeURIComponent(puzzleId)
        } catch { /* keep the raw id */ }
        return recordsFor(puzzleId)
      }
      return undefined
    },
  }
}

export const demoApi = createDemoApi()
