import type { FlatPuzzle } from '../state/puzzleTree'

/* Puzzle search used by the top bar. Ranking matters more than fuzzy magic:
   an id typed exactly wins, then a name that starts with the query, then a
   word inside the name, then anything else that merely contains it. */

export interface PuzzleMatch {
  puzzle: FlatPuzzle
  score: number
}

const ID_WEIGHT = 0
const PREFIX_WEIGHT = 1
const WORD_WEIGHT = 2
const CONTAINS_WEIGHT = 3
const PATH_WEIGHT = 4

export function normalizeQuery(query: string): string {
  return query.trim().toLowerCase()
}

function scorePuzzle(puzzle: FlatPuzzle, query: string): number | null {
  const name = puzzle.displayName.toLowerCase()
  const id = puzzle.id.toLowerCase()
  if (id === query) return ID_WEIGHT
  if (name === query) return ID_WEIGHT
  if (name.startsWith(query)) return PREFIX_WEIGHT
  if (id.startsWith(query)) return PREFIX_WEIGHT + 0.5
  if (name.includes(query)) {
    // A match at a word boundary reads as more relevant than mid-word.
    return name.includes(` ${query}`) ? WORD_WEIGHT : CONTAINS_WEIGHT
  }
  if (id.includes(query)) return CONTAINS_WEIGHT + 0.5
  const path = `${puzzle.collectionName} ${puzzle.groupName}`.toLowerCase()
  if (path.includes(query)) return PATH_WEIGHT
  return null
}

export function searchPuzzles(puzzles: readonly FlatPuzzle[], query: string, limit = 9): FlatPuzzle[] {
  const normalized = normalizeQuery(query)
  if (!normalized) return []
  const matches: PuzzleMatch[] = []
  for (const puzzle of puzzles) {
    const score = scorePuzzle(puzzle, normalized)
    if (score !== null) matches.push({ puzzle, score })
  }
  matches.sort((a, b) => a.score - b.score || a.puzzle.displayName.localeCompare(b.puzzle.displayName))
  return matches.slice(0, limit).map((match) => match.puzzle)
}
