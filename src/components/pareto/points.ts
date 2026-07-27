import type { OmScoreDTO } from '../../types'
import type { ParetoPoint, PointClass } from './constants'

export function isNumeric(val: unknown): val is number {
  return typeof val === 'number' && Number.isFinite(val)
}

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

export function classifyPoint(p: ParetoPoint): PointClass {
  if (p.overlap) return 'overlap'
  if (p.trackless) return 'trackless'
  return 'normal'
}

export function computeParetoFrontier(points: ParetoPoint[]): ParetoPoint[] {
  if (points.length === 0) return []
  const sorted = [...points].sort((a, b) => {
    if (a.x !== b.x) return a.x - b.x
    return a.y - b.y
  })
  const frontier: ParetoPoint[] = []
  let minY = Infinity
  for (const p of sorted) {
    if (p.y < minY) {
      frontier.push(p)
      minY = p.y
    }
  }
  return frontier
}