import { usePlotArea } from 'recharts'
import {
  CLASS_COLOR,
  CLASS_ORDER,
  NORMAL_OPACITY,
  USER_GREEN,
  USER_RED,
} from './constants'

export function ChartLegend({ hasUserPoints }: { hasUserPoints: boolean }) {
  const plotArea = usePlotArea()
  if (!plotArea) return null
  const items: { key: string; color: string; opacity: number; shape: 'circle' | 'diamond'; label: string }[] =
    CLASS_ORDER.map((cls) => ({
      key: cls,
      color: CLASS_COLOR[cls],
      opacity: cls === 'normal' ? NORMAL_OPACITY : 1,
      shape: 'circle',
      label: cls,
    }))
  if (hasUserPoints) {
    items.push({ key: 'user-green', color: USER_GREEN, opacity: 1, shape: 'diamond', label: 'Yours (frontier)' })
    items.push({ key: 'user-red', color: USER_RED, opacity: 1, shape: 'diamond', label: 'Yours (off frontier)' })
  }
  const padX = 8
  const padY = 6
  const rowH = 16
  const boxW = hasUserPoints ? 132 : 92
  const boxH = padY * 2 + items.length * rowH
  const x = plotArea.x + plotArea.width - boxW - 8
  const y = plotArea.y + 8
  return (
    <g style={{ pointerEvents: 'none' }}>
      <rect x={x} y={y} width={boxW} height={boxH} rx={4}
        fill="var(--sidebar-bg)" fillOpacity={0.92} stroke="var(--border)" strokeWidth={1} />
      {items.map((it, i) => {
        const marker = it.shape === 'diamond'
          ? <path d="M 5,-4.5 L 9.5,0 L 5,4.5 L 0.5,0 Z" fill={it.color} fillOpacity={it.opacity} stroke={it.color} strokeWidth={0.5} />
          : <circle cx={5} cy={0} r={4.5} fill={it.color} fillOpacity={it.opacity} stroke={it.color} strokeWidth={0.5} />
        return (
          <g key={it.key} transform={`translate(${x + padX}, ${y + padY + i * rowH + 9})`}>
            {marker}
            <text x={14} y={3} fill="var(--text)" fontSize={11} style={{ textTransform: it.shape === 'diamond' ? 'none' : 'capitalize' }}>
              {it.label}
            </text>
          </g>
        )
      })}
    </g>
  )
}