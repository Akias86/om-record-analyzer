import { usePlotArea } from 'recharts'

export function ResetZoomButton({ onReset }: { onReset: () => void }) {
  const plotArea = usePlotArea()
  if (!plotArea) return null
  const w = 84
  const h = 22
  const x = plotArea.x + plotArea.width - w
  const y = plotArea.y + plotArea.height + 28
  return (
    <foreignObject x={x} y={y} width={w} height={h} style={{ overflow: 'visible' }}>
      <button
        type="button"
        className="pareto-chart-reset-btn"
        onClick={onReset}
        style={{ width: '100%', height: '100%' }}
      >
        Reset zoom
      </button>
    </foreignObject>
  )
}