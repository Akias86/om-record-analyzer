import { identifyPuzzle } from './solution-parse'
import { runVerification } from './run'
import { fetchPuzzleBytes, fetchPuzzleType } from './puzzle'
import type { VerifySolutionOptions, VerifySolutionResult } from './types'

export { identifyPuzzle, runVerification }
export { loadVerifier } from './verifier'
export { parseSolutionMeta } from './solution-parse'
export type { SolutionMeta } from './solution-parse'
export { computeScore } from './metrics'
export { formatFullScore } from './format'
export { diffScores } from './compare'
export { verifyBatch } from './batch'
export type { BatchInput } from './batch'
export { fetchPuzzleBytes, fetchPuzzleType, prefetchPuzzles } from './puzzle'
export { verifyInPool, terminatePool } from './workerPool'
export type { PoolTask } from './workerPool'
export type { VerifiedScore, VerifySolutionOptions, VerifySolutionResult } from './types'
export type { VerifierModule } from './verifier'
export type { ScoreDiffEntry } from './compare'

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

  return runVerification(solutionBytes, puzzleBytes, puzzleType, puzzleId)
}

export async function verifySolutionFile(
  file: File,
  opts?: VerifySolutionOptions,
): Promise<VerifySolutionResult> {
  const bytes = new Uint8Array(await file.arrayBuffer())
  return verifySolution(bytes, opts)
}
