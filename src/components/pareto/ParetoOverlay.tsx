import { usePlotArea, useXAxisScale, useYAxisScale } from 'recharts'
import type { ParetoPoint } from './constants'

export function ParetoOverlay({ paretoPoints }: { paretoPoints: ParetoPoint[] }) {
  const plotArea = usePlotArea()
  const xScale = useXAxisScale()
  const yScale = useYAxisScale()

  if (!plotArea || !xScale || !yScale || paretoPoints.length === 0) return null

  const sorted = [...paretoPoints].sort((a, b) => a.x - b.x)
  const plotTop = plotArea.y
  const plotBottom = plotArea.y + plotArea.height
  const plotLeft = plotArea.x
  const plotRight = plotArea.x + plotArea.width

  let stepD = `M${xScale(sorted[0].x)},${plotTop}`
  stepD += ` L${xScale(sorted[0].x)},${yScale(sorted[0].y)}`
  for (let i = 1; i < sorted.length; i++) {
    stepD += ` L${xScale(sorted[i].x)},${yScale(sorted[i - 1].y)}`
    stepD += ` L${xScale(sorted[i].x)},${yScale(sorted[i].y)}`
  }
  stepD += ` L${plotRight},${yScale(sorted[sorted.length - 1].y)}`

  let shadeD = `M${plotLeft},${plotTop}`
  shadeD += ` L${xScale(sorted[0].x)},${plotTop}`
  shadeD += ` L${xScale(sorted[0].x)},${yScale(sorted[0].y)}`
  for (let i = 1; i < sorted.length; i++) {
    shadeD += ` L${xScale(sorted[i].x)},${yScale(sorted[i - 1].y)}`
    shadeD += ` L${xScale(sorted[i].x)},${yScale(sorted[i].y)}`
  }
  shadeD += ` L${plotRight},${yScale(sorted[sorted.length - 1].y)}`
  shadeD += ` L${plotRight},${plotBottom}`
  shadeD += ` L${plotLeft},${plotBottom}`
  shadeD += ` Z`

  return (
    <g style={{ pointerEvents: 'none' }}>
      <defs>
        <clipPath id="pareto-plot-clip">
          <rect x={plotArea.x} y={plotArea.y} width={plotArea.width} height={plotArea.height} />
        </clipPath>
      </defs>
      <g clipPath="url(#pareto-plot-clip)">
        <path d={shadeD} fill="var(--accent)" fillOpacity={0.12} stroke="none" />
        <path d={stepD} fill="none" stroke="var(--accent)" strokeWidth={2} strokeLinejoin="round" />
      </g>
    </g>
  )
}