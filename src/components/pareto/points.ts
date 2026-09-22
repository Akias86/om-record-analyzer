import type { ParetoPoint, PointClass } from './constants'

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