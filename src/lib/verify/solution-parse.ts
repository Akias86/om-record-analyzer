const PUZZLE_ID_RE = /^(P\d{3}|w\d{7,})$/
const FALLBACK_RE = /\b(P\d{3}|w\d{7,})\b/

export interface SolutionMeta {
  puzzleId: string | null
  solutionName: string | null
}

function readName(bytes: Uint8Array, idLen: number): string | null {
  const nameOffset = 5 + idLen
  if (bytes.length <= nameOffset) return null
  const nameLen = bytes[nameOffset]
  if (nameLen === 0 || bytes.length < nameOffset + 1 + nameLen) return null
  const raw = new TextDecoder('utf-8').decode(bytes.subarray(nameOffset + 1, nameOffset + 1 + nameLen))
  const nul = raw.indexOf('\u0000')
  return nul >= 0 ? raw.slice(0, nul) : raw
}

export function parseSolutionMeta(solutionBytes: Uint8Array): SolutionMeta {
  if (solutionBytes.length > 5) {
    const len = solutionBytes[4]
    if (len > 0 && len <= 64 && solutionBytes.length >= 5 + len) {
      const id = new TextDecoder('latin1').decode(solutionBytes.subarray(5, 5 + len))
      if (PUZZLE_ID_RE.test(id)) {
        return { puzzleId: id, solutionName: readName(solutionBytes, len) }
      }
    }
  }
  const text = new TextDecoder('latin1').decode(solutionBytes)
  const match = text.match(FALLBACK_RE)
  return { puzzleId: match ? match[1] : null, solutionName: null }
}

export function identifyPuzzle(solutionBytes: Uint8Array): string | null {
  return parseSolutionMeta(solutionBytes).puzzleId
}
