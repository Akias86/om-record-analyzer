import { loadVerifier } from './verifier'
import type { VerifierErrorInfo, VerifierModule } from './verifier'
import { computeScore } from './metrics'
import type { SolutionAnalysis, VerifySolutionResult } from './types'

function describeError(message: string, info: VerifierErrorInfo | null): string {
  if (!info || info.source !== 'simulation' || info.cycle <= 0) return message
  const { u, v } = info.location
  return `${message} (cycle ${info.cycle}, position ${u},${v})`
}

function analyzeSolution(verifier: VerifierModule, ptr: number): SolutionAnalysis {
  const c = verifier.evaluate(ptr, 'per repetition cycles')
  const err = verifier.error(ptr)
  if (err) {
    const info = verifier.errorInfo(ptr)
    if (info && info.source === 'simulation' && info.cycle > 0) {
      const { count, intervals } = verifier.outputIntervals(ptr)
      return {
        collisionCycle: info.cycle,
        collisionReason: err,
        steadyState: false,
        infiniteOutputs: false,
        lastProductCycle: count > 0 ? intervals.reduce((a, b) => a + b, 0) : null,
        rate: null,
      }
    }
    return {
      collisionCycle: null,
      collisionReason: null,
      steadyState: false,
      infiniteOutputs: null,
      lastProductCycle: null,
      rate: null,
    }
  }
  const { count, intervals, repeatAfter } = verifier.outputIntervals(ptr)
  if (repeatAfter >= 0) {
    const o = verifier.evaluate(ptr, 'per repetition outputs')
    const rate = o > 0 && c >= 0 ? Math.ceil((10_000_000 * c) / o) / 10_000_000 : null
    return {
      collisionCycle: null,
      collisionReason: null,
      steadyState: true,
      infiniteOutputs: true,
      lastProductCycle: null,
      rate,
    }
  }
  const lastProductCycle = count > 0 ? intervals.reduce((a, b) => a + b, 0) : null
  return {
    collisionCycle: null,
    collisionReason: null,
    steadyState: true,
    infiniteOutputs: false,
    lastProductCycle,
    rate: null,
  }
}

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
    return { puzzleId, puzzleType: puzzleType || null, passed: false, score: null, error: createError, analysis: null }
  }

  verifier.evaluate(ptr, 'cycles')
  const simError = verifier.error(ptr)
  if (simError) {
    const info = verifier.errorInfo(ptr)
    const analysis = analyzeSolution(verifier, ptr)
    verifier.clearError(ptr)
    verifier.destroy(ptr)
    return {
      puzzleId,
      puzzleType: puzzleType || null,
      passed: false,
      score: null,
      error: describeError(simError, info),
      analysis,
    }
  }

  const wrongIdx = verifier.wrongOutputIndex(ptr)
  if (wrongIdx >= 0) {
    const analysis = analyzeSolution(verifier, ptr)
    verifier.destroy(ptr)
    return {
      puzzleId,
      puzzleType: puzzleType || null,
      passed: false,
      score: null,
      error: `wrong output at index ${wrongIdx}`,
      analysis,
    }
  }

  const score = computeScore(verifier, ptr, puzzleType || undefined)
  const analysis = analyzeSolution(verifier, ptr)
  verifier.destroy(ptr)
  return { puzzleId, puzzleType: puzzleType || null, passed: true, score, error: null, analysis }
}
