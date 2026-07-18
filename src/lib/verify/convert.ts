import type { OmScoreDTO } from '../../types'
import type { VerifiedScore } from './types'

function toInfinInt(v: number | null): number | 'Infinity' | null {
  if (v === null) return null
  if (v === Infinity) return 'Infinity'
  return v
}

export function verifiedToOmScore(v: VerifiedScore): OmScoreDTO {
  return {
    cost: v.cost,
    instructions: v.instructions,
    overlap: v.overlap,
    trackless: v.trackless,
    cycles: v.cycles,
    area: v.area,
    height: v.height,
    width: v.width,
    boundingHex: v.boundingHex,
    rate: v.rate,
    areaINFLevel: v.areaINFLevel,
    areaINFValue: v.areaINFValue,
    heightINF: toInfinInt(v.heightINF),
    widthINF: toInfinInt(v.widthINF),
    boundingHexINF: toInfinInt(v.boundingHexINF),
  }
}
