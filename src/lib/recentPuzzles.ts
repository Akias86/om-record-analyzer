/* Recently opened puzzles, so the welcome screen can offer a way back into
   the last thing you were looking at. Names are stored alongside ids: the
   list must render before (or without) the puzzle tree arriving. */

export interface RecentPuzzle {
  id: string
  name: string
  at: number
}

const STORAGE_KEY = 'om-app:recent-puzzles'
const MAX_RECENT = 8

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

function isRecent(value: unknown): value is RecentPuzzle {
  const entry = value as Partial<RecentPuzzle> | null
  return !!entry && typeof entry.id === 'string' && typeof entry.name === 'string' && typeof entry.at === 'number'
}

export function parseRecentPuzzles(raw: string | null, now = Date.now()): RecentPuzzle[] {
  if (!raw) return []
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter(isRecent)
      .filter((entry) => entry.at <= now)
      .sort((a, b) => b.at - a.at)
      .slice(0, MAX_RECENT)
  } catch {
    return []
  }
}

export function readRecentPuzzles(): RecentPuzzle[] {
  try {
    return parseRecentPuzzles(storage()?.getItem(STORAGE_KEY) ?? null)
  } catch {
    return []
  }
}

/** Moves an already-listed puzzle to the front and caps the list. */
export function mergeRecentPuzzle(list: readonly RecentPuzzle[], puzzle: { id: string; name: string }, now = Date.now()): RecentPuzzle[] {
  return [
    { id: puzzle.id, name: puzzle.name, at: now },
    ...list.filter((entry) => entry.id !== puzzle.id),
  ].slice(0, MAX_RECENT)
}

export function pushRecentPuzzle(puzzle: { id: string; name: string }): RecentPuzzle[] {
  const next = mergeRecentPuzzle(readRecentPuzzles(), puzzle)
  try {
    storage()?.setItem(STORAGE_KEY, JSON.stringify(next))
  } catch { /* storage pressure must not break navigation */ }
  return next
}

export function clearRecentPuzzles(): void {
  try {
    storage()?.removeItem(STORAGE_KEY)
  } catch { /* ignore */ }
}
