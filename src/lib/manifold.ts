import type { OmScoreDTO } from '../types'

export type OmType = 'NORMAL' | 'POLYMER_HEIGHT' | 'POLYMER_WIDTH' | 'POLYMER_SKEW' | 'PRODUCTION'

export type MetricId =
  | 'overlap'
  | 'trackless'
  | 'looping'
  | 'cost'
  | 'instructions'
  | 'cycles'
  | 'area'
  | 'height'
  | 'width'
  | 'boundingHex'
  | 'rate'
  | 'areaINF'
  | 'heightINF'
  | 'widthINF'
  | 'boundingHexINF'

export interface Manifold {
  id: string
  label: string
  supportedTypes: OmType[]
  scoreParts: MetricId[]
}

const FREESPACE: OmType[] = ['NORMAL', 'POLYMER_HEIGHT', 'POLYMER_WIDTH', 'POLYMER_SKEW']

export const MANIFOLDS: Manifold[] = [
  { id: 'VICTORY_AREA', label: '@aV', supportedTypes: FREESPACE, scoreParts: ['overlap', 'cost', 'cycles', 'area', 'looping', 'instructions', 'trackless'] },
  { id: 'VICTORY_PROD', label: '@iV', supportedTypes: ['PRODUCTION'], scoreParts: ['overlap', 'cost', 'instructions', 'looping', 'area', 'trackless'] },
  { id: 'VICTORY_HEIGHT', label: '@hV', supportedTypes: ['NORMAL', 'POLYMER_HEIGHT'], scoreParts: ['overlap', 'cost', 'cycles', 'height', 'looping', 'instructions', 'trackless'] },
  { id: 'VICTORY_WIDTH', label: '@wV', supportedTypes: ['NORMAL', 'POLYMER_WIDTH'], scoreParts: ['overlap', 'cost', 'cycles', 'width', 'looping', 'instructions', 'trackless'] },
  { id: 'VICTORY_BHEX', label: '@bV', supportedTypes: ['NORMAL'], scoreParts: ['overlap', 'cost', 'cycles', 'boundingHex', 'looping', 'instructions', 'trackless'] },
  { id: 'INFINITY_AREA', label: '@a∞', supportedTypes: FREESPACE, scoreParts: ['overlap', 'cost', 'rate', 'areaINF', 'instructions', 'trackless'] },
  { id: 'INFINITY_PROD', label: '@i∞', supportedTypes: ['PRODUCTION'], scoreParts: ['overlap', 'cost', 'rate', 'instructions', 'areaINF', 'trackless'] },
  { id: 'INFINITY_HEIGHT', label: '@h∞', supportedTypes: ['NORMAL', 'POLYMER_HEIGHT'], scoreParts: ['overlap', 'cost', 'rate', 'heightINF', 'instructions', 'trackless'] },
  { id: 'INFINITY_WIDTH', label: '@w∞', supportedTypes: ['NORMAL', 'POLYMER_WIDTH'], scoreParts: ['overlap', 'cost', 'rate', 'widthINF', 'instructions', 'trackless'] },
  { id: 'INFINITY_BHEX', label: '@b∞', supportedTypes: ['NORMAL'], scoreParts: ['overlap', 'cost', 'rate', 'boundingHexINF', 'instructions', 'trackless'] },
]

export function manifoldsForType(type: OmType): Manifold[] {
  return MANIFOLDS.filter((m) => m.supportedTypes.includes(type))
}

export function getManifold(id: string): Manifold | undefined {
  return MANIFOLDS.find((m) => m.id === id)
}

type MetricKind = 'bool-overlap' | 'bool-reverse' | 'num' | 'infinint' | 'levelvalue'

function metricKind(m: MetricId): MetricKind {
  if (m === 'overlap') return 'bool-overlap'
  if (m === 'trackless' || m === 'looping') return 'bool-reverse'
  if (m === 'areaINF') return 'levelvalue'
  if (m === 'heightINF' || m === 'widthINF' || m === 'boundingHexINF') return 'infinint'
  return 'num'
}

function getNum(score: OmScoreDTO, m: MetricId): number | null {
  switch (m) {
    case 'cost': return score.cost
    case 'instructions': return score.instructions
    case 'cycles': return score.cycles
    case 'area': return score.area
    case 'height': return score.height
    case 'width': return score.width
    case 'boundingHex': return score.boundingHex
    case 'rate': return score.rate
    default: return null
  }
}

function getInfinInt(score: OmScoreDTO, m: MetricId): number | 'Infinity' | null {
  if (m === 'heightINF') return score.heightINF
  if (m === 'widthINF') return score.widthINF
  if (m === 'boundingHexINF') return score.boundingHexINF
  return null
}

function getLevelValue(score: OmScoreDTO, m: MetricId): { level: number; value: number } | null {
  if (m !== 'areaINF') return null
  if (score.areaINFLevel == null || score.areaINFValue == null) return null
  return { level: score.areaINFLevel, value: score.areaINFValue }
}

function getBool(score: OmScoreDTO, m: MetricId): boolean {
  if (m === 'overlap') return score.overlap
  if (m === 'trackless') return score.trackless
  return score.rate != null
}

function hasValue(score: OmScoreDTO, m: MetricId): boolean {
  const kind = metricKind(m)
  if (kind === 'bool-overlap' || kind === 'bool-reverse') return true
  if (kind === 'levelvalue') return getLevelValue(score, m) !== null
  if (kind === 'infinint') return getInfinInt(score, m) !== null
  return getNum(score, m) !== null
}

function sign(n: number): number {
  if (n < 0) return -1
  if (n > 0) return 1
  return 0
}

function compareMetric(m: MetricId, x: OmScoreDTO, y: OmScoreDTO): number {
  const kind = metricKind(m)
  if (kind === 'bool-overlap') {
    const a = x.overlap ? 1 : 0
    const b = y.overlap ? 1 : 0
    return a - b
  }
  if (kind === 'bool-reverse') {
    const a = getBool(x, m) ? 1 : 0
    const b = getBool(y, m) ? 1 : 0
    return b - a
  }
  if (kind === 'levelvalue') {
    const a = getLevelValue(x, m)
    const b = getLevelValue(y, m)
    if (a == null && b == null) return 0
    if (a == null) return 1
    if (b == null) return -1
    if (a.level !== b.level) return a.level - b.level
    return sign(a.value - b.value)
  }
  if (kind === 'infinint') {
    const a = getInfinInt(x, m)
    const b = getInfinInt(y, m)
    if (a == null && b == null) return 0
    if (a == null) return 1
    if (b == null) return -1
    const an = a === 'Infinity' ? Infinity : a
    const bn = b === 'Infinity' ? Infinity : b
    return sign(an - bn)
  }
  const a = getNum(x, m)
  const b = getNum(y, m)
  if (a == null && b == null) return 0
  if (a == null) return 1
  if (b == null) return -1
  return sign(a - b)
}

export type PartialOrder = 'SMALLER' | 'BIGGER' | 'UNCOMPARABLE' | 'EQUAL'

export function partialCompare(scoreParts: MetricId[], x: OmScoreDTO, y: OmScoreDTO): PartialOrder {
  let smaller = false
  let bigger = false
  for (const m of scoreParts) {
    const r = compareMetric(m, x, y)
    if (r < 0) smaller = true
    else if (r > 0) bigger = true
  }
  if (smaller && bigger) return 'UNCOMPARABLE'
  if (smaller) return 'SMALLER'
  if (bigger) return 'BIGGER'
  return 'EQUAL'
}

export function supportsScore(manifold: Manifold, score: OmScoreDTO): boolean {
  return manifold.scoreParts.every((m) => hasValue(score, m))
}

export function frontierCompare(manifold: Manifold, x: OmScoreDTO, y: OmScoreDTO): PartialOrder {
  return partialCompare(manifold.scoreParts, x, y)
}

export function computeFrontierIndices(manifold: Manifold, scores: OmScoreDTO[]): number[] {
  const candidates: number[] = []
  for (let i = 0; i < scores.length; i++) {
    if (supportsScore(manifold, scores[i])) candidates.push(i)
  }
  const frontier: number[] = []
  for (const i of candidates) {
    const dominated = candidates.some((j) => j !== i && partialCompare(manifold.scoreParts, scores[i], scores[j]) === 'BIGGER')
    if (!dominated) frontier.push(i)
  }
  return frontier
}
