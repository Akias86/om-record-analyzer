import { NUMERIC_SCORE_KEYS } from '../../types'
import type { NumericScoreKey, OmScoreDTO } from '../../types'
import type { Manifold } from '../../lib/manifold'
import { getMetricValue } from '../../lib/metrics'
import { niceLinearDomain, niceLogDomain } from './ticks'

type AxisScale = 'linear' | 'log'

// Availability and plotting must use the same accessor, including its existing
// value * 100000^level projection for all four @∞ fields.
export function getAvailableAxisMetrics(
  scores: readonly (OmScoreDTO | null)[],
  manifold?: Manifold,
  puzzleType?: string | null,
): NumericScoreKey[] {
  return NUMERIC_SCORE_KEYS.filter((key) =>
    (!manifold || manifold.scoreParts.some((part) => part === key)) &&
    scores.some((score) => score !== null && getMetricValue(score, key, puzzleType) !== null),
  )
}

export function getAxisValue(score: OmScoreDTO, key: NumericScoreKey, scale: AxisScale, puzzleType?: string | null): number | null {
  const value = getMetricValue(score, key, puzzleType)
  return value !== null && (scale !== 'log' || value > 0) ? value : null
}

export function getAxisDomain(values: readonly number[], scale: AxisScale): {
  domain: [number, number]
  ticks: number[] | undefined
  isInteger: boolean
} | null {
  let min = Infinity, max = -Infinity
  let isInteger = true
  for (const value of values) {
    if (!Number.isFinite(value) || (scale === 'log' && value <= 0)) continue
    min = Math.min(min, value)
    max = Math.max(max, value)
    isInteger &&= Number.isInteger(value)
  }
  if (max === -Infinity) return null
  const lo = scale === 'log' ? min : 0
  const result = scale === 'log' ? niceLogDomain(max, lo) : niceLinearDomain(max > 0 ? max : 1, isInteger)
  return {
    domain: [lo, result.hi],
    ticks: result.ticks.length > (scale === 'log' ? 0 : 1) ? result.ticks : undefined,
    isInteger,
  }
}
