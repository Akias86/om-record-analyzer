import type { InfinityScoreKey, LevelValue, OmScoreDTO } from '../types'

type LegacyScore = Omit<OmScoreDTO, InfinityScoreKey | 'looping'> & {
  looping?: boolean | null
  areaINFLevel: number | null
  areaINFValue: number | null
  heightINF: number | 'Infinity' | null
  widthINF: number | 'Infinity' | null
  boundingHexINF: number | 'Infinity' | null
}

function normalizeLevelValue(value: LevelValue | number | 'Infinity' | null): LevelValue | null {
  if (typeof value === 'number') return Number.isFinite(value) ? { level: 0, value } : null
  return value === 'Infinity' ? null : value
}

// Normalize old edge-cache responses and saved user scores at the boundary.
// Legacy infinite dimensions have no measured growth rate, and legacy Rate
// cannot prove the new Looping condition: keep those values unknown until the
// solution is re-uploaded rather than inventing new scores.
export function normalizeScore(score: OmScoreDTO | LegacyScore): OmScoreDTO {
  const areaINF = 'areaINF' in score ? score.areaINF
    : score.areaINFLevel != null && score.areaINFValue != null
      ? { level: score.areaINFLevel, value: score.areaINFValue }
      : null
  return {
    cost: score.cost,
    instructions: score.instructions,
    overlap: score.overlap,
    trackless: score.trackless,
    cycles: score.cycles,
    area: score.area,
    height: score.height,
    width: score.width,
    boundingHex: score.boundingHex,
    rate: score.rate,
    looping: score.looping ?? null,
    areaINF,
    heightINF: normalizeLevelValue(score.heightINF),
    widthINF: normalizeLevelValue(score.widthINF),
    boundingHexINF: normalizeLevelValue(score.boundingHexINF),
  }
}
