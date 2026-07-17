import type { VerifiedScore } from './types'
import type { VerifierModule } from './verifier'

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

export function computeScore(v: VerifierModule, ptr: number, puzzleType?: string): VerifiedScore {
  const tracked = (puzzleType ? TRACKED_GEOMETRY[puzzleType] : undefined) ?? ALL_TRACKED
  const m = (name: string): number => {
    const val = v.evaluate(ptr, name)
    if (v.error(ptr)) {
      v.clearError(ptr)
      return NaN
    }
    return val
  }

  const measureRate = (): number | null => {
    const c = m('per repetition cycles')
    const o = m('per repetition outputs')
    if (!(o > 0) || !(c >= 0)) return null
    return Math.ceil((100 * c) / o) / 100
  }
  const measureAreaAtInfinity = (): { level: number; value: number } | null => {
    if (!measureRate()) return null
    const o = m('per repetition outputs')
    const a2 = m('per repetition^2 area') / o ** 2
    if (a2 > 0) return { level: 2, value: a2 }
    const a1 = m('per repetition area') / o
    if (a1 > 0) return { level: 1, value: a1 }
    return { level: 0, value: m('steady state area') }
  }

  const rate = measureRate()
  const aINF = measureAreaAtInfinity()

  const directOr = (trackedDim: boolean | undefined, name: string): number | null => {
    if (!trackedDim) return null
    const x = m(name)
    return Number.isNaN(x) ? null : x
  }
  const infOr = (trackedDim: boolean | undefined, val: number): number | null => {
    if (!trackedDim) return null
    if (!rate) return null
    return val >= 0 ? val : Infinity
  }

  const height = directOr(tracked.height, 'height')
  const widthRaw = directOr(tracked.width, 'width*2')
  const boundingHex = directOr(tracked.boundingHex, 'minimum hexagon')
  const heightINF = infOr(tracked.height, m('steady state height'))
  const widthINF = infOr(tracked.width, m('steady state width*2') / 2)
  const boundingHexINF = infOr(tracked.boundingHex, m('steady state minimum hexagon'))

  return {
    cost: m('cost'),
    instructions: m('instructions'),
    overlap: m('overlap') > 0,
    trackless: m('number of track segments') === 0,
    cycles: m('cycles'),
    area: m('area'),
    width: widthRaw === null ? null : widthRaw / 2,
    height,
    boundingHex,
    rate,
    areaINFLevel: aINF ? aINF.level : null,
    areaINFValue: aINF ? aINF.value : null,
    heightINF,
    widthINF,
    boundingHexINF,
  }
}