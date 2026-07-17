const PUZZLE_ID_RE = /^(P\d{3}|w\d{7,})$/
const FALLBACK_RE = /\b(P\d{3}|w\d{7,})\b/

export function identifyPuzzle(solutionBytes: Uint8Array): string | null {
  if (solutionBytes.length > 5) {
    const len = solutionBytes[4]
    if (len > 0 && len <= 16 && solutionBytes.length >= 5 + len) {
      const id = new TextDecoder('latin1').decode(solutionBytes.subarray(5, 5 + len))
      if (PUZZLE_ID_RE.test(id)) return id
    }
  }
  const text = new TextDecoder('latin1').decode(solutionBytes)
  const match = text.match(FALLBACK_RE)
  return match ? match[1] : null
}
