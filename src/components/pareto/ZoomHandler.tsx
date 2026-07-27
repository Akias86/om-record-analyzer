import { useEffect, useRef, useState } from 'react'
import type { MouseEvent as ReactMouseEvent } from 'react'
import {
  usePlotArea,
  useXAxisInverseScale,
  useYAxisInverseScale,
} from 'recharts'
import { globalToSvgCoords, toSvgCoords } from './svg'
import type { ZoomDomain } from './constants'

export function ZoomHandler({
  onZoom,
  onResetZoom,
}: {
  onZoom: (d: ZoomDomain) => void
  onResetZoom: () => void
}) {
  const plotArea = usePlotArea()
  const xInv = useXAxisInverseScale()
  const yInv = useYAxisInverseScale()
  const [sel, setSel] = useState<{ x1: number; y1: number; x2: number; y2: number } | null>(null)
  const dragRef = useRef<{ x1: number; y1: number; svgEl: SVGSVGElement | null } | null>(null)
  const ctxRef = useRef({ onZoom, xInv, yInv, plotArea })
  ctxRef.current = { onZoom, xInv, yInv, plotArea }

  useEffect(() => {
    const onMove = (e: globalThis.MouseEvent) => {
      const drag = dragRef.current
      if (!drag) return
      const coords = globalToSvgCoords(e.clientX, e.clientY, drag.svgEl)
      if (!coords) return
      setSel((prev) => (prev ? { ...prev, x2: coords.x, y2: coords.y } : null))
    }
    const onUp = (e: globalThis.MouseEvent) => {
      const drag = dragRef.current
      if (!drag) return
      dragRef.current = null
      const { xInv: xi, yInv: yi, plotArea: pa, onZoom: oz } = ctxRef.current
      const coords = globalToSvgCoords(e.clientX, e.clientY, drag.svgEl)
      setSel(null)
      if (!coords || !xi || !yi || !pa) return
      const x1 = Math.min(drag.x1, coords.x)
      const y1 = Math.min(drag.y1, coords.y)
      const x2 = Math.max(drag.x1, coords.x)
      const y2 = Math.max(drag.y1, coords.y)
      if (Math.abs(x2 - x1) < 5 || Math.abs(y2 - y1) < 5) return
      const cx1 = Math.max(pa.x, Math.min(pa.x + pa.width, x1))
      const cx2 = Math.max(pa.x, Math.min(pa.x + pa.width, x2))
      const cy1 = Math.max(pa.y, Math.min(pa.y + pa.height, y1))
      const cy2 = Math.max(pa.y, Math.min(pa.y + pa.height, y2))
      const dx1 = xi(cx1)
      const dx2 = xi(cx2)
      const dy1 = yi(cy1)
      const dy2 = yi(cy2)
      if (dx1 == null || dx2 == null || dy1 == null || dy2 == null) return
      const nx1 = Number(dx1)
      const nx2 = Number(dx2)
      const ny1 = Number(dy1)
      const ny2 = Number(dy2)
      if (!Number.isFinite(nx1) || !Number.isFinite(nx2) || !Number.isFinite(ny1) || !Number.isFinite(ny2)) return
      oz({
        x: [Math.min(nx1, nx2), Math.max(nx1, nx2)],
        y: [Math.min(ny1, ny2), Math.max(ny1, ny2)],
      })
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [])

  if (!plotArea) return null

  const onDown = (e: ReactMouseEvent) => {
    if (e.button !== 0) return
    e.preventDefault()
    const svgEl = (e.currentTarget as SVGElement).ownerSVGElement ?? null
    const coords = toSvgCoords(e)
    if (!coords || !svgEl) return
    dragRef.current = { x1: coords.x, y1: coords.y, svgEl }
    setSel({ x1: coords.x, y1: coords.y, x2: coords.x, y2: coords.y })
  }

  return (
    <g>
      <rect
        x={plotArea.x}
        y={plotArea.y}
        width={plotArea.width}
        height={plotArea.height}
        fill="transparent"
        onMouseDown={onDown}
        onDoubleClick={onResetZoom}
        style={{ cursor: 'crosshair' }}
      />
      {sel && (
        <rect
          x={Math.min(sel.x1, sel.x2)}
          y={Math.min(sel.y1, sel.y2)}
          width={Math.abs(sel.x2 - sel.x1)}
          height={Math.abs(sel.y2 - sel.y1)}
          fill="var(--accent)"
          fillOpacity={0.1}
          stroke="var(--accent)"
          strokeWidth={1}
          strokeDasharray="4 2"
        />
      )}
    </g>
  )
}