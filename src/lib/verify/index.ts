import { loadVerifier } from './verifier'
import { identifyPuzzle } from './solution-parse'
import { computeScore } from './metrics'
import { getPuzzleMeta } from '../../api/om'
import type { VerifiedScore, VerifySolutionOptions, VerifySolutionResult } from './types'

export { loadVerifier, identifyPuzzle, computeScore }
export { diffScores } from './compare'
export type { VerifiedScore, VerifySolutionOptions, VerifySolutionResult }
export type { VerifierModule } from './verifier'
export type { ScoreDiffEntry } from './compare'

export async function fetchPuzzleBytes(puzzleId: string): Promise<Uint8Array> {
  const res = await fetch(`/puzzles/${encodeURIComponent(puzzleId)}.puzzle`)
  if (!res.ok) throw new Error(`puzzle file not found: ${puzzleId}`)
  return new Uint8Array(await res.arrayBuffer())
}

export async function fetchPuzzleType(puzzleId: string): Promise<string> {
  try {
    const meta = await getPuzzleMeta(puzzleId)
    return meta?.type ?? ''
  } catch {
    return ''
  }
}

export async function verifySolution(
  solutionBytes: Uint8Array,
  opts?: VerifySolutionOptions,
): Promise<VerifySolutionResult> {
  const puzzleId = identifyPuzzle(solutionBytes)
  if (!puzzleId) {
    return { puzzleId: null, puzzleType: null, passed: false, score: null, error: 'Could not identify puzzle from solution file' }
  }

  const puzzleType = opts?.puzzleType ?? (await fetchPuzzleType(puzzleId))

  let puzzleBytes: Uint8Array
  try {
    puzzleBytes = await fetchPuzzleBytes(puzzleId)
  } catch (err) {
    return {
      puzzleId,
      puzzleType: puzzleType || null,
      passed: false,
      score: null,
      error: err instanceof Error ? err.message : String(err),
    }
  }

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

export async function verifySolutionFile(
  file: File,
  opts?: VerifySolutionOptions,
): Promise<VerifySolutionResult> {
  const bytes = new Uint8Array(await file.arrayBuffer())
  return verifySolution(bytes, opts)
}