import { getPuzzleMap, getPuzzleMeta } from '../../api/om'

const puzzleBytesCache = new Map<string, Promise<Uint8Array>>()

export async function fetchPuzzleBytes(puzzleId: string): Promise<Uint8Array> {
  let p = puzzleBytesCache.get(puzzleId)
  if (!p) {
    p = (async () => {
      const res = await fetch(`/puzzles/${encodeURIComponent(puzzleId)}.puzzle`)
      if (!res.ok) throw new Error(`puzzle file not found: ${puzzleId}`)
      return new Uint8Array(await res.arrayBuffer())
    })()
    puzzleBytesCache.set(puzzleId, p)
    p.catch(() => puzzleBytesCache.delete(puzzleId))
  }
  return p
}

export async function fetchPuzzleType(puzzleId: string): Promise<string> {
  try {
    const meta = await getPuzzleMeta(puzzleId)
    return meta?.type ?? ''
  } catch {
    return ''
  }
}

export async function prefetchPuzzles(ids: Iterable<string>): Promise<{
  bytes: Map<string, Uint8Array>
  types: Map<string, string>
}> {
  const unique = [...new Set(ids)]

  // Filter to puzzles that exist in the official puzzle list. Solution
  // files can reference retired/placeholder/community ids whose .puzzle
  // files are absent (e.g. P001-P006 tutorial levels, w* workshop
  // puzzles). Without this filter, every upload batch fires a guaranteed
  // 404 request per such id. The puzzle map is cached after first load
  // (sidebar triggers it on mount), so this is ~free. If the map can't be
  // loaded, fall back to per-id fetches so uploads still work.
  let valid = unique
  try {
    const puzzleMap = await getPuzzleMap()
    if (puzzleMap.size > 0) {
      valid = unique.filter((id) => puzzleMap.has(id))
    }
  } catch {
    /* map unavailable → don't filter, fall back to per-id 404 */
  }

  const bytes = new Map<string, Uint8Array>()
  const types = new Map<string, string>()
  await Promise.all(
    valid.map(async (id) => {
      try {
        bytes.set(id, await fetchPuzzleBytes(id))
      } catch {
        /* missing puzzle file */
      }
      try {
        types.set(id, await fetchPuzzleType(id))
      } catch {
        types.set(id, '')
      }
    }),
  )
  return { bytes, types }
}
