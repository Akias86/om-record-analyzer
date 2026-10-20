import { BOOL_SCORE_KEYS } from '../types'
import type { BoolFilter, OmScoreDTO } from '../types'

export function parseBoolFilters(saved: string | null): BoolFilter {
  const filters: BoolFilter = { overlap: 'any', trackless: 'any', looping: 'any' }
  try {
    const parsed = JSON.parse(saved ?? 'null') as Partial<BoolFilter> | null
    for (const key of BOOL_SCORE_KEYS) {
      const value = parsed?.[key]
      if (value === 'any' || value === 'true' || value === 'false') filters[key] = value
    }
  } catch { /* invalid settings: keep defaults */ }
  return filters
}

export function matchesScoreFilters(score: OmScoreDTO, filters: BoolFilter): boolean {
  return BOOL_SCORE_KEYS.every((key) => filters[key] === 'any' || score[key] === (filters[key] === 'true'))
}
