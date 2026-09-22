import type { OmScoreDTO } from '../types'

function isNumeric(val: unknown): val is number {
  return typeof val === 'number' && Number.isFinite(val)
}

// Unified numeric accessor for any metric key (NUMERIC_SCORE_KEYS), including
// the computed 'sum'/'sum4' and the level/value-encoded 'areaINF'. Returns
// null when the score has no usable value for the key.
export function getMetricValue(score: OmScoreDTO, key: string): number | null {
  if (key === 'sum') return score.cost + score.cycles + score.area
  if (key === 'sum4') return score.cost + score.cycles + score.area + score.instructions
  if (key === 'areaINF') {
    if (!isNumeric(score.areaINFLevel) || !isNumeric(score.areaINFValue)) return null
    return score.areaINFValue * Math.pow(100000, score.areaINFLevel)
  }
  const val: unknown = score[key as keyof OmScoreDTO]
  return isNumeric(val) ? val : null
}

// Score-string form of the @∞ area metric, matching the notation used in
// smart/full formatted scores: the raw value followed by 'a' and one
// apostrophe per level (`18a`, `18a'`, `1050a''`). Returns null when the
// record has no @∞ area value.
export function formatAreaINF(score: OmScoreDTO): string | null {
  if (!isNumeric(score.areaINFValue)) return null
  const level = isNumeric(score.areaINFLevel) ? score.areaINFLevel : 0
  const suffix = level === 0 ? '' : level === 1 ? "'" : "''"
  return `${formatScoreNumber(score.areaINFValue)}a${suffix}`
}

export function formatScoreNumber(n: number): string {
  if (Number.isInteger(n)) return String(n)
  return String(Number(n.toFixed(3)))
}
