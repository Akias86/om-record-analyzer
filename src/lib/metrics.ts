import { INFINITY_SCORE_KEYS } from '../types'
import type { InfinityScoreKey, LevelValue, OmScoreDTO } from '../types'

export function isInfinityScoreKey(key: string): key is InfinityScoreKey {
  return (INFINITY_SCORE_KEYS as readonly string[]).includes(key)
}

function isNumeric(val: unknown): val is number {
  return typeof val === 'number' && Number.isFinite(val)
}

// Unified numeric accessor for any metric key (NUMERIC_SCORE_KEYS), including
// the computed 'sum'/'sum4' and all level/value-encoded @∞ metrics. Returns
// null when the score has no usable value for the key.
export function getMetricValue(score: OmScoreDTO, key: string): number | null {
  if (key === 'sum') return score.cost + score.cycles + score.area
  if (key === 'sum4') return score.cost + score.cycles + score.area + score.instructions
  if (isInfinityScoreKey(key)) {
    const value = score[key]
    if (!value || !isNumeric(value.level) || !isNumeric(value.value)) return null
    const scaled = value.value * Math.pow(100000, value.level)
    return isNumeric(scaled) ? scaled : null
  }
  const val: unknown = score[key as keyof OmScoreDTO]
  return isNumeric(val) ? val : null
}

// Score-string form of the @∞ area metric, matching the notation used in
// smart/full formatted scores: the raw value followed by 'a' and one
// apostrophe per level (`18a`, `18a'`, `1050a''`). Returns null when the
// record has no @∞ area value.
export function formatAreaINF(score: OmScoreDTO): string | null {
  return formatLevelValue(score.areaINF, 'a')
}

export function formatLevelValue(value: LevelValue | null, unit = ''): string | null {
  if (!value || !isNumeric(value.value) || !Number.isInteger(value.level) || value.level < 0) return null
  return `${formatScoreNumber(value.value)}${unit}${"'".repeat(value.level)}`
}

export function formatScoreNumber(n: number): string {
  if (Number.isInteger(n)) return String(n)
  return String(Number(n.toFixed(3)))
}
