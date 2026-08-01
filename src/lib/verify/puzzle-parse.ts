export interface PuzzleMeta {
  name: string | null
}

export function parsePuzzleMeta(puzzleBytes: Uint8Array): PuzzleMeta {
  if (puzzleBytes.length > 5) {
    const len = puzzleBytes[4]
    if (len > 0 && len <= 64 && puzzleBytes.length >= 5 + len) {
      const raw = new TextDecoder('utf-8').decode(puzzleBytes.subarray(5, 5 + len))
      const nul = raw.indexOf('\u0000')
      return { name: nul >= 0 ? raw.slice(0, nul) : raw }
    }
  }
  return { name: null }
}
