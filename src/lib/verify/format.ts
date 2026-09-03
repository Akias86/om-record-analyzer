import type { VerifiedScore } from './types'
import { trackedGeometry } from './metrics'

function isProductionType(puzzleType?: string | null): boolean {
  return puzzleType === 'PRODUCTION'
}

export function sumScores(score: VerifiedScore, puzzleType?: string | null): { sum: number | null; sum4: number | null } {
  if (isProductionType(puzzleType)) {
    return { sum: score.cost + score.cycles + score.instructions, sum4: null }
  }
  return {
    sum: score.cost + score.cycles + score.area,
    sum4: score.cost + score.cycles + score.area + score.instructions,
  }
}

function fmt(n: number): string {
  if (n === Infinity) return '\u221E'
  if (!Number.isFinite(n)) return '\u2014'
  if (Number.isInteger(n)) return String(n)
  return String(Number(n.toFixed(3)))
}

function fmtAreaINF(score: VerifiedScore): string {
  const v = score.areaINFValue
  if (v === null) return `${score.area}a`
  const suffix = score.areaINFLevel === 0 ? '' : score.areaINFLevel === 1 ? "'" : "''"
  return `${fmt(v)}a${suffix}`
}

export interface ScoreParts {
  victory: string
  infinity: string | null
}

export function formatScoreParts(score: VerifiedScore, puzzleType?: string): ScoreParts {
  const tracked = trackedGeometry(puzzleType)

  const vParts: string[] = [
    `${score.cost}g`,
    `${score.cycles}c`,
    `${score.area}a`,
    `${score.instructions}i`,
  ]
  if (tracked.height && score.height !== null) vParts.push(`${fmt(score.height)}h`)
  if (tracked.width && score.width !== null) vParts.push(`${fmt(score.width)}w`)
  if (tracked.boundingHex && score.boundingHex !== null) vParts.push(`${fmt(score.boundingHex)}b`)
  if (score.trackless) vParts.push('T')

  if (score.rate === null) {
    return { victory: vParts.join('/'), infinity: null }
  }

  vParts.push('L')

  const infParts: string[] = [
    `${score.cost}g`,
    `${fmt(score.rate)}r`,
    fmtAreaINF(score),
    `${score.instructions}i`,
  ]
  if (tracked.height && score.heightINF !== null) infParts.push(`${fmt(score.heightINF)}h`)
  if (tracked.width && score.widthINF !== null) infParts.push(`${fmt(score.widthINF)}w`)
  if (tracked.boundingHex && score.boundingHexINF !== null) infParts.push(`${fmt(score.boundingHexINF)}b`)
  if (score.trackless) infParts.push('T')

  return { victory: vParts.join('/') + '@V', infinity: infParts.join('/') + '@\u221E' }
}

export function formatFullScore(score: VerifiedScore, puzzleType?: string): string {
  const { victory, infinity } = formatScoreParts(score, puzzleType)
  return infinity === null ? victory : `${victory} ${infinity}`
}
