import type { LevelValue } from '../../types'
import type { VerifiedScore } from './types'
import type { VerifierModule } from './verifier'

const TRACKED_GEOMETRY: Readonly<Record<string, Readonly<{ height?: boolean; width?: boolean; boundingHex?: boolean }>>> = {
  NORMAL: { height: true, width: true, boundingHex: true },
  POLYMER_HEIGHT: { height: true },
  POLYMER_WIDTH: { width: true },
  POLYMER_SKEW: {},
  PRODUCTION: {},
}

export function trackedGeometry(puzzleType?: string): { height: boolean; width: boolean; boundingHex: boolean } {
  const t = puzzleType ? TRACKED_GEOMETRY[puzzleType] : undefined
  if (!t) return { height: true, width: true, boundingHex: true }
  return { height: t.height === true, width: t.width === true, boundingHex: t.boundingHex === true }
}

export function computeScore(
  v: VerifierModule,
  ptr: number,
  puzzleType?: string,
  skipThroughput = false,
): VerifiedScore {
  const tracked = trackedGeometry(puzzleType)
  const m = (name: string): number => {
    const val = v.evaluate(ptr, name)
    if (v.error(ptr)) {
      v.clearError(ptr)
      return NaN
    }
    return val
  }
  const outputs = skipThroughput ? NaN : m('per repetition outputs')
  const cycles = outputs > 0 ? m('per repetition cycles') : NaN
  const rate = outputs > 0 && cycles >= 0 ? Math.ceil((100 * cycles) / outputs) / 100 : null

  const directOr = (trackedDim: boolean, name: string): number | null => {
    if (!trackedDim) return null
    const value = m(name)
    return Number.isFinite(value) ? value : null
  }
  const measureAreaAtInfinity = (): LevelValue | null => {
    if (rate === null) return null
    const a2 = m('per repetition^2 area') / outputs ** 2
    if (a2 > 0) return { level: 2, value: a2 }
    const a1 = m('per repetition area') / outputs
    if (a1 > 0) return { level: 1, value: a1 }
    const value = directOr(true, 'steady state area')
    return value === null ? null : { level: 0, value }
  }
  const measureSizeAtInfinity = (trackedDim: boolean, metric: string): LevelValue | null => {
    if (!trackedDim || rate === null) return null
    const growth = m(`per repetition ${metric}`)
    if (!Number.isFinite(growth)) return null
    if (growth > 0) return { level: 1, value: growth / outputs }
    const value = directOr(true, `steady state ${metric}`)
    return value === null ? null : { level: 0, value }
  }

  return {
    cost: m('cost'),
    instructions: m('instructions'),
    overlap: m('overlap') > 0,
    trackless: m('number of track segments') === 0,
    cycles: m('cycles'),
    area: m('area'),
    width: directOr(tracked.width, 'width'),
    height: directOr(tracked.height, 'height'),
    boundingHex: directOr(tracked.boundingHex, 'minimum hexagon'),
    looping: skipThroughput ? null : v.looping(ptr),
    rate,
    areaINF: measureAreaAtInfinity(),
    heightINF: measureSizeAtInfinity(tracked.height, 'height'),
    widthINF: measureSizeAtInfinity(tracked.width, 'width'),
    boundingHexINF: measureSizeAtInfinity(tracked.boundingHex, 'minimum hexagon'),
  }
}
