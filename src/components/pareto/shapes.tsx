import { USER_DIAMOND_RADIUS } from './constants'
import type { ParetoPoint } from './constants'

interface ShapeProps {
  cx?: number
  cy?: number
  payload?: unknown
}

export function makePointShape(radius: number, opacity: number, color: string, onSelectPoint?: (p: ParetoPoint) => void) {
  return (props: ShapeProps) => {
    const { cx, cy, payload } = props
    if (cx == null || cy == null) return null
    return (
      <circle
        cx={cx}
        cy={cy}
        r={radius}
        fill={color}
        fillOpacity={opacity}
        stroke={color}
        strokeWidth={0.5}
        style={onSelectPoint ? { cursor: 'pointer' } : undefined}
        onClick={
          onSelectPoint && payload
            ? (e) => {
                e.stopPropagation()
                onSelectPoint(payload as ParetoPoint)
              }
            : undefined
        }
      />
    )
  }
}

export function makeDiamondShape(color: string, onSelectPoint?: (p: ParetoPoint) => void) {
  const r = USER_DIAMOND_RADIUS
  return (props: ShapeProps) => {
    const { cx, cy, payload } = props
    if (cx == null || cy == null) return null
    const d = `M ${cx},${cy - r} L ${cx + r},${cy} L ${cx},${cy + r} L ${cx - r},${cy} Z`
    return (
      <path
        d={d}
        fill={color}
        fillOpacity={1}
        stroke={color}
        strokeWidth={0.5}
        style={onSelectPoint ? { cursor: 'pointer' } : undefined}
        onClick={
          onSelectPoint && payload
            ? (e) => {
                e.stopPropagation()
                onSelectPoint(payload as ParetoPoint)
              }
            : undefined
        }
      />
    )
  }
}
