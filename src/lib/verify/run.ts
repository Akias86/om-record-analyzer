import { loadVerifier } from './verifier'
import { computeScore } from './metrics'
import type { VerifySolutionResult } from './types'

export async function runVerification(
  solutionBytes: Uint8Array,
  puzzleBytes: Uint8Array,
  puzzleType: string,
  puzzleId: string,
): Promise<VerifySolutionResult> {
  const verifier = await loadVerifier()
  const ptr = verifier.create(puzzleBytes, solutionBytes)
  const createError = ptr !== 0 ? verifier.error(ptr) : (verifier.error(0) ?? 'failed to create verifier')
  if (createError) {
    if (ptr !== 0) verifier.destroy(ptr)
    return { puzzleId, puzzleType: puzzleType || null, passed: false, score: null, error: createError }
  }

  verifier.evaluate(ptr, 'cycles')
  const simError = verifier.error(ptr)
  if (simError) {
    verifier.clearError(ptr)
    verifier.destroy(ptr)
    return { puzzleId, puzzleType: puzzleType || null, passed: false, score: null, error: simError }
  }

  const wrongIdx = verifier.wrongOutputIndex(ptr)
  if (wrongIdx >= 0) {
    verifier.destroy(ptr)
    return {
      puzzleId,
      puzzleType: puzzleType || null,
      passed: false,
      score: null,
      error: `wrong output at index ${wrongIdx}`,
    }
  }

  const score = computeScore(verifier, ptr, puzzleType || undefined)
  verifier.destroy(ptr)
  return { puzzleId, puzzleType: puzzleType || null, passed: true, score, error: null }
}
