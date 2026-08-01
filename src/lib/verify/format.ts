import type { VerifiedScore } from './types'

const TRACKED_GEOMETRY: Readonly<Record<string, Readonly<{ height?: boolean; width?: boolean; boundingHex?: boolean }>>> = {
  NORMAL: { height: true, width: true, boundingHex: true },
  POLYMER_HEIGHT: { height: true },
  POLYMER_WIDTH: { width: true },
  POLYMER_SKEW: {},
  PRODUCTION: {},
}

const ALL_TRACKED: Readonly<{ height: boolean; width: boolean; boundingHex: boolean }> = {
  height: true,
  width: true,
  boundingHex: true,
}

function fmt(n: number): string {
  if (n === Infinity) return '\u221E'
  if (!Number.isFinite(n)) return '\u2014'
  return Number.isInteger(n) ? String(n) : String(n)
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
  const tracked = (puzzleType ? TRACKED_GEOMETRY[puzzleType] : undefined) ?? ALL_TRACKED

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
