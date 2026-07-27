import {
  USER_DIAMOND_RADIUS,
} from './constants'

export function makePointShape(radius: number, opacity: number, color: string) {
  return (props: { cx?: number; cy?: number }) => {
    const { cx, cy } = props
    if (cx == null || cy == null) return null
    return <circle cx={cx} cy={cy} r={radius} fill={color} fillOpacity={opacity} stroke={color} strokeWidth={0.5} />
  }
}

export function makeDiamondShape(color: string) {
  const r = USER_DIAMOND_RADIUS
  return (props: { cx?: number; cy?: number }) => {
    const { cx, cy } = props
    if (cx == null || cy == null) return null
    const d = `M ${cx},${cy - r} L ${cx + r},${cy} L ${cx},${cy + r} L ${cx - r},${cy} Z`
    return <path d={d} fill={color} fillOpacity={1} stroke={color} strokeWidth={0.5} />
  }
}