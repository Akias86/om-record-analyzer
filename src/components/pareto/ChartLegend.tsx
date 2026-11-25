import { usePlotArea } from 'recharts'
import {
  CLASS_COLOR,
  CLASS_ORDER,
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
      opacity: 1,
      shape: 'circle',
      label: cls,
    }))
  if (hasUserPoints) {
    items.push({ key: 'user-green', color: USER_GREEN, opacity: 1, shape: 'diamond', label: 'Yours (frontier)' })
    items.push({ key: 'user-red', color: USER_RED, opacity: 1, shape: 'diamond', label: 'Yours (off frontier)' })
  }
  const padX = 10
  const padY = 7
  const rowH = 17
  const boxW = hasUserPoints ? 140 : 100
  const boxH = padY * 2 + items.length * rowH
  const x = plotArea.x + plotArea.width - boxW - 10
  const y = plotArea.y + 10
  return (
    <g style={{ pointerEvents: 'none' }}>
      <rect
        x={x}
        y={y}
        width={boxW}
        height={boxH}
        rx={6}
        fill="var(--surface-bg)"
        fillOpacity={0.94}
        stroke="var(--border)"
        strokeWidth={1}
      />
      {items.map((it, i) => {
        const marker = it.shape === 'diamond'
          ? <path d="M 5,-4.5 L 9.5,0 L 5,4.5 L 0.5,0 Z" fill={it.color} fillOpacity={it.opacity} stroke={it.color} strokeWidth={0.5} />
          : <circle cx={5} cy={0} r={4.5} fill={it.color} fillOpacity={it.opacity} stroke="var(--chart-point-stroke, rgba(15, 23, 42, 0.4))" strokeWidth={0.75} />
        return (
          <g key={it.key} transform={`translate(${x + padX}, ${y + padY + i * rowH + 9})`}>
            {marker}
            <text x={15} y={3.5} fill="var(--text-h)" fontSize={11.5} style={{ textTransform: it.shape === 'diamond' ? 'none' : 'capitalize', fontWeight: 500 }}>
              {it.label}
            </text>
          </g>
        )
      })}
    </g>
  )
}
