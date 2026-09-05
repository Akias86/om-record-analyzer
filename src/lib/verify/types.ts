export interface VerifiedScore {
  cost: number
  instructions: number
  overlap: boolean
  trackless: boolean
  cycles: number
  area: number
  width: number | null
  height: number | null
  boundingHex: number | null
  rate: number | null
  areaINFLevel: number | null
  areaINFValue: number | null
  heightINF: number | null
  widthINF: number | null
  boundingHexINF: number | null
}

export interface SolutionAnalysis {
  collisionCycle: number | null
  collisionReason: string | null
  steadyState: boolean
  infiniteOutputs: boolean | null
  lastProductCycle: number | null
  rate: number | null
  /** cycle count simulated before the run ended (collision / convergence / limit). */
  simulatedCycles: number | null
}

/** structural metrics, available without running the simulation. */
export interface BasicMetrics {
  cost: number
  instructions: number
  trackless: boolean
  overlap: boolean
}

/** victory metrics measured live at the current board state (approximate until the final score). */
export interface VictoryPartial {
  cycles: number | null
  area: number | null
  height: number | null
  width: number | null
  boundingHex: number | null
}

/**
 * @∞ metrics estimated live from the board state at the current simulation
 * cursor. Approximate (tilde-rendered, 'live') until the final converged
 * values replace them; the area growth-order (`a'`/`a''`) classification can
 * only be made at the final score, so `area` here is the raw current-board
 * footprint.
 */
export interface InfinityPartial {
  /** cycles per delivered product over a recent output window (same scale as the final rate). */
  rate: number | null
  area: number | null
  height: number | null
  width: number | null
  boundingHex: number | null
}

/** progressive result streamed out of the worker while the simulation advances. */
export interface VerifyPartial {
  /** 'passed' once board.complete is observed (row becomes Passed / clickable). */
  phase: 'verifying' | 'passed' | 'failed'
  cycle: number
  converged: boolean
  /** cycle of the most recently delivered product (lower bound while streaming). */
  lastProductCycle: number | null
  collisionCycle: number | null
  collisionReason: string | null
  /** true = the collision happened after the winning delivery cycle: the official
   * simulation stops at completion, so it can never observe such a collision —
   * informational only, the Passed verdict stands. */
  collisionIgnorable: boolean
  basic: BasicMetrics | null
  victory: VictoryPartial | null
  /** live @∞ estimates while the post-completion chase advances; null before completion. */
  infinity: InfinityPartial | null
}

export type PartialListener = (partial: VerifyPartial) => void

export interface VerifySolutionResult {
  puzzleId: string | null
  puzzleType: string | null
  passed: boolean
  score: VerifiedScore | null
  error: string | null
  analysis: SolutionAnalysis | null
}
