import { loadVerifier } from './verifier'
import type { VerifierErrorInfo, VerifierModule } from './verifier'
import { computeScore } from './metrics'
import type {
  BasicMetrics,
  InfinityPartial,
  PartialListener,
  SolutionAnalysis,
  VerifyPartial,
  VerifySolutionResult,
  VictoryPartial,
} from './types'

const CYCLE_LIMIT = 1_000_000
const COLLISION_CHECK_LIMIT = 0n
const SLICE_CYCLES = 10_000
const PARTIAL_INTERVAL_MS = 500
// The post-completion convergence chase after the @V verdict is streamed is NOT
// time-boxed: only @∞ (rate/steady-state) can be hidden by waiting, so the loop
// runs to its natural stop — convergence, collision, or CYCLE_LIMIT — exactly
// like the official verifier. Live @∞ progress rides along on the partials.

const ERROR_NOT_COMPLETE = 'did not complete within cycle limit'
const ERROR_STEADY_NO_PRODUCTS = 'solution reached a steady state without delivering any products'

function describeError(message: string, info: VerifierErrorInfo | null): string {
  if (!info || info.source !== 'simulation' || info.cycle <= 0) return message
  const { u, v } = info.location
  return `${message} (cycle ${info.cycle}, position ${u},${v})`
}

function emptyAnalysis(): SolutionAnalysis {
  return {
    collisionCycle: null,
    collisionReason: null,
    steadyState: false,
    infiniteOutputs: null,
    lastProductCycle: null,
    rate: null,
    simulatedCycles: null,
  }
}

// evaluate-based analysis reused on the converged final path (throughput metrics are
// cached on the verifier by computeScore, so these evaluate calls are cheap).
function analyzeSolution(verifier: VerifierModule, ptr: number): SolutionAnalysis {
  const c = verifier.evaluate(ptr, 'per repetition cycles')
  const err = verifier.error(ptr)
  if (err) {
    verifier.clearError(ptr)
    return emptyAnalysis()
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
      simulatedCycles: null,
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
    simulatedCycles: null,
  }
}

function buildAnalysis(
  opts: {
    collisionCycle?: number | null
    collisionReason?: string | null
    steadyState?: boolean
    infiniteOutputs?: boolean | null
    lastProductCycle?: number | null
    rate?: number | null
    simulatedCycles?: number | null
  },
): SolutionAnalysis {
  return {
    collisionCycle: opts.collisionCycle ?? null,
    collisionReason: opts.collisionReason ?? null,
    steadyState: opts.steadyState ?? false,
    infiniteOutputs: opts.infiniteOutputs ?? null,
    lastProductCycle: opts.lastProductCycle ?? null,
    rate: opts.rate ?? null,
    simulatedCycles: opts.simulatedCycles ?? null,
  }
}

function measureVictory(v: VerifierModule, ptr: number): VictoryPartial {
  // evaluate-based metrics mirror computeScore semantics: 'cycles' is the exact
  // completion cycle (not the current simulation cursor, which keeps advancing
  // past completion while steady-state detection runs). All are cheap post-
  // completion, and evaluate() re-runs only the short completion sim.
  const mc = (metric: string): number | null => {
    const value = v.evaluate(ptr, metric)
    if (v.error(ptr)) {
      v.clearError(ptr)
      return null
    }
    return Number.isNaN(value) ? null : value
  }
  const width2 = mc('width*2')
  return {
    cycles: mc('cycles'),
    area: mc('area'),
    height: mc('height'),
    width: width2 === null ? null : width2 / 2,
    boundingHex: mc('minimum hexagon'),
  }
}

// the official final 'rate' (analyzeSolution) is a 7-decimal fixed-point value;
// quantize the live estimate identically so live->final never changes shape.
const RATE_WINDOW = 50
const RATE_MIN_OUTPUTS = 4

// live @∞ estimates from the advancing board (measureCurrent reads the board at
// the current simulation cursor; it never triggers a sim, unlike evaluate).
// Rate = mean output spacing over the most recent window — the same quantity
// the official 'rate' derives from once steady state is detected — so the live
// value smoothly converges onto the final one. measureCurrent writes v->error on
// failure, so drain it here; collision detection stays in emitPartial's control.
function measureInfinity(v: VerifierModule, ptr: number, intervals: number[]): InfinityPartial {
  const mc = (metric: string): number | null => {
    const value = v.measureCurrent(ptr, metric)
    if (v.error(ptr)) v.clearError(ptr)
    return value < 0 || Number.isNaN(value) ? null : value
  }
  let rate: number | null = null
  const tail = intervals.slice(-RATE_WINDOW)
  if (intervals.length >= RATE_MIN_OUTPUTS && tail.length >= 2) {
    let sum = 0
    for (const x of tail) sum += x
    if (sum > 0) rate = Math.ceil((10_000_000 * sum) / tail.length) / 10_000_000
  }
  const width2 = mc('width*2')
  return {
    rate,
    area: mc('area'),
    height: mc('height'),
    width: width2 === null ? null : width2 / 2,
    boundingHex: mc('minimum hexagon'),
  }
}

function measureBasic(v: VerifierModule, ptr: number): BasicMetrics {
  const m = (metric: string): number => {
    const value = v.evaluateInt(ptr, metric)
    if (v.error(ptr)) {
      v.clearError(ptr)
      return NaN
    }
    return value
  }
  return {
    cost: m('cost'),
    instructions: m('instructions'),
    trackless: m('number of track segments') === 0,
    overlap: m('overlap') > 0,
  }
}

export async function runVerification(
  solutionBytes: Uint8Array,
  puzzleBytes: Uint8Array,
  puzzleType: string,
  puzzleId: string,
  onPartial?: PartialListener,
): Promise<VerifySolutionResult> {
  const verifier = await loadVerifier()
  const ptr = verifier.create(puzzleBytes, solutionBytes)
  const createError = ptr !== 0 ? verifier.error(ptr) : (verifier.error(0) ?? 'failed to create verifier')
  if (createError) {
    if (ptr !== 0) verifier.destroy(ptr)
    return { puzzleId, puzzleType: puzzleType || null, passed: false, score: null, error: createError, analysis: null }
  }

  verifier.setCycleLimit(ptr, CYCLE_LIMIT)
  verifier.setCollisionCheckLimit(ptr, COLLISION_CHECK_LIMIT)

  let lastEmitAt = 0
  let phase: VerifyPartial['phase'] = 'verifying'
  let completedEmitted = false
  let basic: BasicMetrics | null = null
  let victory: VictoryPartial | null = null
  let collision: { cycle: number; reason: string } | null = null
  let lastCount = 0
  let lastSum = 0
  let lateCollision: { cycle: number; reason: string } | null = null

  const readIntervals = (): { count: number; intervals: number[]; lastProductCycle: number | null } => {
    const { count, intervals } = verifier.outputIntervals(ptr)
    if (count > lastCount) {
      for (let i = lastCount; i < count; i++) lastSum += intervals[i]
      lastCount = count
    }
    return { count, intervals, lastProductCycle: count > 0 ? lastSum : null }
  }

  const emitPartial = (): void => {
    if (!onPartial) return
    const { intervals, lastProductCycle } = readIntervals()
    // snapshot any pending simulation error BEFORE evaluate-based measurements:
    // a completing board may collide within the very same slice, and
    // measureVictory's evaluate calls would clobber the error slot.
    const err = verifier.error(ptr)
    const errInfo = err ? verifier.errorInfo(ptr) : null
    const completed = verifier.completed(ptr)
    if (completed && !completedEmitted) {
      // collision check has already run for earlier frames; a board that flips
      // completed in THIS frame cannot hold a pre-win collision (a collision
      // freezes the advance sim, so completion could not have happened after).
      if (phase !== 'failed') {
        completedEmitted = true
        phase = 'passed'
        victory = measureVictory(verifier, ptr)
      }
    }
    if (err && !collision && !lateCollision) {
      const simCollision = !!errInfo && errInfo.source === 'simulation' && errInfo.cycle > 0
      if (simCollision) {
        if (completed) {
          // Official semantics: the verifier's own run ends the moment the
          // winning delivery completes, so a collision can never be observed
          // on a completed board — the advance sim reached completion earlier
          // (the complete flag is sticky) and froze only at the later
          // collision. Informational; the Passed verdict and @V stand.
          lateCollision = { cycle: errInfo!.cycle, reason: err! }
        } else {
          // collision before (or instead of) the winning delivery: Failure.
          collision = { cycle: errInfo!.cycle, reason: err! }
          phase = 'failed'
        }
      }
    }
    // live @∞ only while the board is advancing in passed phase: measureInfinity
    // writes (then drains) the error slot, so it must run after the collision
    // capture above has had its chance to consume any pending simulation error.
    const infinity = phase === 'passed' ? measureInfinity(verifier, ptr, intervals) : null
    const partial: VerifyPartial = {
      phase,
      cycle: verifier.currentCycle(ptr),
      converged: verifier.converged(ptr),
      lastProductCycle,
      collisionCycle: collision ? collision.cycle : lateCollision ? lateCollision.cycle : null,
      collisionReason: collision ? collision.reason : lateCollision ? lateCollision.reason : null,
      collisionIgnorable: !collision && !!lateCollision,
      basic,
      victory,
      infinity,
    }
    lastEmitAt = performance.now()
    onPartial(partial)
  }

  // structural (Basic) metrics never need the simulation, so measure them before
  // the first slice: evaluateInt metrics that decode internally write to the
  // verifier error slot on success and must not clobber a later collision error.
  basic = measureBasic(verifier, ptr)

  // slice loop: advance in small fixed slices so that completion (@V) and
  // collision detection stay within ~one slice of the actual event — a fixed
  // large step would otherwise delay the Passed verdict by tens of seconds on
  // slow, complex boards (e.g. ~15k cycles/s real puzzles: 500k step = ~30s+).
  // Partials stream every PARTIAL_INTERVAL_MS and on every transition @V,
  // last-product cycle, and live @∞ estimates — so the verdict is visible
  // immediately and the remaining chase (for official converged @∞, and to
  // catch collisions that happen INSTEAD of the winning delivery) is a
  // background wait with nothing hidden behind it.  A collision on a board
  // that already completed is post-win noise: informational only, see the
  // lateCollision handling below.
  for (;;) {
    verifier.advance(ptr, SLICE_CYCLES)
    const err = verifier.error(ptr)
    const converged = verifier.converged(ptr)
    const limitReached = verifier.currentCycle(ptr) >= CYCLE_LIMIT
    // closure flags stop the loop even when the error slot was legitimately
    // drained mid-emit (measureVictory/measureInfinity): C has frozen the sim.
    const stop = !!err || converged || limitReached || collision !== null || lateCollision !== null
    if (stop || performance.now() - lastEmitAt >= PARTIAL_INTERVAL_MS) {
      emitPartial()
      if (!stop) {
        // let the event loop breathe between emissions (main-thread fallback path)
        // eslint-disable-next-line no-await-in-loop
        await new Promise((resolve) => setTimeout(resolve, 0))
      }
    }
    if (stop) break
  }

  const finalError = verifier.error(ptr)
  const finalInfo = finalError ? verifier.errorInfo(ptr) : null
  const isCollision = !!finalError && !!finalInfo && finalInfo.source === 'simulation' && finalInfo.cycle > 0
  const completed = verifier.completed(ptr)
  const converged = verifier.converged(ptr)
  const cycleEnd = verifier.currentCycle(ptr)

  const destroy = (): void => verifier.destroy(ptr)

  // --- collision / early failure ---
  if (finalError && !isCollision) {
    const result: VerifySolutionResult = {
      puzzleId,
      puzzleType: puzzleType || null,
      passed: false,
      score: null,
      error: finalError,
      analysis: null,
    }
    destroy()
    return result
  }
  if (isCollision && completed) {
    // Official semantics: the verifier's run ends the moment the winning
    // delivery completes (the complete flag is sticky, and a collision freezes
    // the advance sim), so a completed board can only harbor a POST-WIN
    // collision — unobservable in the game, must not invalidate the pass.
    const { lastProductCycle } = readIntervals()
    const score = computeScore(verifier, ptr, puzzleType || undefined, true)
    const analysis = buildAnalysis({
      collisionCycle: finalInfo!.cycle,
      collisionReason: finalError,
      steadyState: false,
      infiniteOutputs: null,
      lastProductCycle,
      simulatedCycles: cycleEnd,
    })
    destroy()
    return { puzzleId, puzzleType: puzzleType || null, passed: true, score, error: null, analysis }
  }
  if (isCollision) {
    const { lastProductCycle } = readIntervals()
    const analysis = buildAnalysis({
      collisionCycle: finalInfo!.cycle,
      collisionReason: finalError,
      steadyState: false,
      infiniteOutputs: false,
      lastProductCycle,
      simulatedCycles: finalInfo!.cycle,
    })
    const result: VerifySolutionResult = {
      puzzleId,
      puzzleType: puzzleType || null,
      passed: false,
      score: null,
      error: describeError(finalError!, finalInfo),
      analysis,
    }
    destroy()
    return result
  }

  // --- converged ---
  if (converged) {
    const { count, lastProductCycle } = readIntervals()
    if (count === 0) {
      // steady state with zero outputs: provably never delivers a product.
      const analysis = buildAnalysis({
        steadyState: true,
        infiniteOutputs: false,
        simulatedCycles: cycleEnd,
      })
      const result: VerifySolutionResult = {
        puzzleId,
        puzzleType: puzzleType || null,
        passed: false,
        score: null,
        error: ERROR_STEADY_NO_PRODUCTS,
        analysis,
      }
      destroy()
      return result
    }
    // producing solution: completion is guaranteed eventually, but it must complete
    // within the cycle limit.  the completion sim also catches collisions that happen
    // after convergence was first detected.
    verifier.evaluate(ptr, 'cycles')
    const completeErr = verifier.error(ptr)
    if (completeErr) {
      const analysis = buildAnalysis({
        steadyState: true,
        infiniteOutputs: true,
        lastProductCycle,
        simulatedCycles: cycleEnd,
      })
      const result: VerifySolutionResult = {
        puzzleId,
        puzzleType: puzzleType || null,
        passed: false,
        score: null,
        error: describeError(completeErr, verifier.errorInfo(ptr)),
        analysis,
      }
      destroy()
      return result
    }
    const score = computeScore(verifier, ptr, puzzleType || undefined)
    const analysis = analyzeSolution(verifier, ptr)
    destroy()
    return { puzzleId, puzzleType: puzzleType || null, passed: true, score, error: null, analysis }
  }

  // --- stopped without convergence (cycle limit) ---
  const { lastProductCycle } = readIntervals()
  if (!completed) {
    const analysis = buildAnalysis({
      steadyState: false,
      lastProductCycle,
      simulatedCycles: cycleEnd,
    })
    const result: VerifySolutionResult = {
      puzzleId,
      puzzleType: puzzleType || null,
      passed: false,
      score: null,
      error: ERROR_NOT_COMPLETE,
      analysis,
    }
    destroy()
    return result
  }

  // completed but never converged (cycle limit, or the advance sim frozen by a
  // post-win collision): victory metrics are exact and cheap (completion sim
  // stops at complete); throughput (@∞) metrics are skipped.  A post-win
  // collision is carried into the analysis for display only — verdict stands.
  const score = computeScore(verifier, ptr, puzzleType || undefined, true)
  const analysis = buildAnalysis({
    steadyState: false,
    lastProductCycle,
    simulatedCycles: cycleEnd,
    collisionCycle: lateCollision ? lateCollision.cycle : null,
    collisionReason: lateCollision ? lateCollision.reason : null,
  })
  destroy()
  return { puzzleId, puzzleType: puzzleType || null, passed: true, score, error: null, analysis }
}
