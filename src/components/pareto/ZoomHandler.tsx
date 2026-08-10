import { useEffect, useRef, useState } from 'react'
import type { MouseEvent as ReactMouseEvent } from 'react'
import {
  usePlotArea,
  useXAxisInverseScale,
  useYAxisInverseScale,
} from 'recharts'
import { globalToSvgCoords, toSvgCoords } from './svg'
import type { ZoomDomain } from './constants'

type InverseScale = (pixel: number) => unknown

type DragMode = 'select' | 'zoomout' | 'pan'

interface DragState {
  mode: DragMode
  x1: number
  y1: number
  svgEl: SVGSVGElement | null
  baseXInv?: InverseScale
  baseYInv?: InverseScale
  basePlot?: { x: number; y: number; width: number; height: number }
  baseX?: [number, number]
  baseY?: [number, number]
}

interface FullBounds {
  x: [number, number]
  y: [number, number]
}

const MIN_SELECT_PX = 5
const FULL_DOMAIN_EPS = 1e-6

function isFullDomain(dom: ZoomDomain, full: FullBounds): boolean {
  const xs = Math.max(Math.abs(full.x[0]), Math.abs(full.x[1]), 1)
  const ys = Math.max(Math.abs(full.y[0]), Math.abs(full.y[1]), 1)
  return (
    Math.abs(dom.x[0] - full.x[0]) <= FULL_DOMAIN_EPS * xs &&
    Math.abs(dom.x[1] - full.x[1]) <= FULL_DOMAIN_EPS * xs &&
    Math.abs(dom.y[0] - full.y[0]) <= FULL_DOMAIN_EPS * ys &&
    Math.abs(dom.y[1] - full.y[1]) <= FULL_DOMAIN_EPS * ys
  )
}

function clampDomain(dom: ZoomDomain, bounds: FullBounds): ZoomDomain | null {
  const nx0 = Math.min(Math.max(dom.x[0], bounds.x[0]), bounds.x[1])
  const nx1 = Math.min(Math.max(dom.x[1], bounds.x[0]), bounds.x[1])
  const ny0 = Math.min(Math.max(dom.y[0], bounds.y[0]), bounds.y[1])
  const ny1 = Math.min(Math.max(dom.y[1], bounds.y[0]), bounds.y[1])
  if (nx0 >= nx1 || ny0 >= ny1) return null
  return { x: [nx0, nx1], y: [ny0, ny1] }
}

function clampPanDomain(dom: ZoomDomain, bounds: FullBounds): ZoomDomain | null {
  let nx0 = dom.x[0]
  let nx1 = dom.x[1]
  let ny0 = dom.y[0]
  let ny1 = dom.y[1]
  if (nx0 >= nx1 || ny0 >= ny1) return null
  if (nx1 - nx0 >= bounds.x[1] - bounds.x[0]) {
    nx0 = bounds.x[0]
    nx1 = bounds.x[1]
  } else if (nx0 < bounds.x[0]) {
    nx1 += bounds.x[0] - nx0
    nx0 = bounds.x[0]
  } else if (nx1 > bounds.x[1]) {
    nx0 -= nx1 - bounds.x[1]
    nx1 = bounds.x[1]
  }
  if (ny1 - ny0 >= bounds.y[1] - bounds.y[0]) {
    ny0 = bounds.y[0]
    ny1 = bounds.y[1]
  } else if (ny0 < bounds.y[0]) {
    ny1 += bounds.y[0] - ny0
    ny0 = bounds.y[0]
  } else if (ny1 > bounds.y[1]) {
    ny0 -= ny1 - bounds.y[1]
    ny1 = bounds.y[1]
  }
  return { x: [nx0, nx1], y: [ny0, ny1] }
}

export function ZoomHandler({
  onZoom,
  onResetZoom,
  xDomain,
  yDomain,
  defaultDomain,
  isZoomed,
}: {
  onZoom: (d: ZoomDomain) => void
  onResetZoom: () => void
  xDomain?: [number, number]
  yDomain?: [number, number]
  defaultDomain: FullBounds | null
  isZoomed: boolean
}) {
  const plotArea = usePlotArea()
  const xInv = useXAxisInverseScale()
  const yInv = useYAxisInverseScale()
  const [sel, setSel] = useState<{ x1: number; y1: number; x2: number; y2: number } | null>(null)
  const dragRef = useRef<DragState | null>(null)
  const panDeltaRef = useRef<{ dx: number; dy: number } | null>(null)
  const rafRef = useRef<number | null>(null)
  const ctxRef = useRef({ onZoom, onResetZoom, xInv, yInv, plotArea, xDomain, yDomain, defaultDomain, isZoomed })
  ctxRef.current = { onZoom, onResetZoom, xInv, yInv, plotArea, xDomain, yDomain, defaultDomain, isZoomed }

  const commitPan = (finalize: boolean, coords: { x: number; y: number } | null) => {
    const drag = dragRef.current
    if (!drag || drag.mode !== 'pan' || !drag.baseXInv || !drag.baseYInv || !drag.basePlot) return
    const delta = coords
      ? { dx: coords.x - drag.x1, dy: coords.y - drag.y1 }
      : panDeltaRef.current
    if (!delta) return
    const nx0 = Number(drag.baseXInv(drag.basePlot.x - delta.dx))
    const nx1 = Number(drag.baseXInv(drag.basePlot.x + drag.basePlot.width - delta.dx))
    const ny1 = Number(drag.baseYInv(drag.basePlot.y - delta.dy))
    const ny0 = Number(drag.baseYInv(drag.basePlot.y + drag.basePlot.height - delta.dy))
    if (![nx0, nx1, ny0, ny1].every(Number.isFinite)) return
    let dom: ZoomDomain = { x: [nx0, nx1], y: [ny0, ny1] }
    const ctx = ctxRef.current
    if (ctx.defaultDomain) {
      const clamped = clampPanDomain(dom, ctx.defaultDomain)
      if (!clamped) return
      dom = clamped
    }
    if (finalize && ctx.defaultDomain && isFullDomain(dom, ctx.defaultDomain)) {
      ctx.onResetZoom()
      return
    }
    if (
      ctx.xDomain && ctx.yDomain &&
      dom.x[0] === ctx.xDomain[0] && dom.x[1] === ctx.xDomain[1] &&
      dom.y[0] === ctx.yDomain[0] && dom.y[1] === ctx.yDomain[1]
    ) return
    ctx.onZoom(dom)
  }

  const commitZoomOut = (drag: DragState, coords: { x: number; y: number }) => {
    const { basePlot: pa, baseXInv: xi, baseYInv: yi, baseX, baseY } = drag
    const ctx = ctxRef.current
    if (!pa || !xi || !yi || !baseX || !baseY) return
    const rx1 = Math.min(drag.x1, coords.x)
    const ry1 = Math.min(drag.y1, coords.y)
    const rx2 = Math.max(drag.x1, coords.x)
    const ry2 = Math.max(drag.y1, coords.y)
    if (rx2 - rx1 < MIN_SELECT_PX || ry2 - ry1 < MIN_SELECT_PX) return
    const cx1 = Math.max(pa.x, Math.min(pa.x + pa.width, rx1))
    const cx2 = Math.max(pa.x, Math.min(pa.x + pa.width, rx2))
    const cy1 = Math.max(pa.y, Math.min(pa.y + pa.height, ry1))
    const cy2 = Math.max(pa.y, Math.min(pa.y + pa.height, ry2))
    const rectW = cx2 - cx1
    const rectH = cy2 - cy1
    if (rectW <= 0 || rectH <= 0) return
    const cxd = Number(xi((cx1 + cx2) / 2))
    const cyd = Number(yi((cy1 + cy2) / 2))
    if (![cxd, cyd].every(Number.isFinite)) return
    const fx = pa.width / rectW
    const fy = pa.height / rectH
    const nx0 = cxd - (cxd - baseX[0]) * fx
    const nx1 = cxd + (baseX[1] - cxd) * fx
    const ny0 = cyd - (cyd - baseY[0]) * fy
    const ny1 = cyd + (baseY[1] - cyd) * fy
    if (![nx0, nx1, ny0, ny1].every(Number.isFinite)) return
    let dom: ZoomDomain = { x: [nx0, nx1], y: [ny0, ny1] }
    if (ctx.defaultDomain) {
      const clamped = clampDomain(dom, ctx.defaultDomain)
      if (!clamped) return
      dom = clamped
    }
    if (
      ctx.xDomain && ctx.yDomain &&
      dom.x[0] === ctx.xDomain[0] && dom.x[1] === ctx.xDomain[1] &&
      dom.y[0] === ctx.yDomain[0] && dom.y[1] === ctx.yDomain[1]
    ) return
    if (ctx.defaultDomain && isFullDomain(dom, ctx.defaultDomain)) {
      ctx.onResetZoom()
      return
    }
    ctx.onZoom(dom)
  }

  useEffect(() => {
    const onMove = (e: globalThis.MouseEvent) => {
      const drag = dragRef.current
      if (!drag) return
      const coords = globalToSvgCoords(e.clientX, e.clientY, drag.svgEl)
      if (!coords) return
      if (drag.mode === 'pan') {
        panDeltaRef.current = { dx: coords.x - drag.x1, dy: coords.y - drag.y1 }
        if (rafRef.current == null) {
          rafRef.current = requestAnimationFrame(() => {
            rafRef.current = null
            commitPan(false, null)
          })
        }
        return
      }
      setSel((prev) => (prev ? { ...prev, x2: coords.x, y2: coords.y } : null))
    }
    const onUp = (e: globalThis.MouseEvent) => {
      const drag = dragRef.current
      if (!drag) return
      dragRef.current = null
      const coords = globalToSvgCoords(e.clientX, e.clientY, drag.svgEl)
      if (drag.mode === 'pan') {
        if (rafRef.current != null) {
          cancelAnimationFrame(rafRef.current)
          rafRef.current = null
        }
        commitPan(true, coords)
        panDeltaRef.current = null
        return
      }
      setSel(null)
      if (!coords) return
      if (drag.mode === 'zoomout') {
        commitZoomOut(drag, coords)
        return
      }
      const { xInv: xi, yInv: yi, plotArea: pa, onZoom: oz } = ctxRef.current
      if (!xi || !yi || !pa) return
      const x1 = Math.min(drag.x1, coords.x)
      const y1 = Math.min(drag.y1, coords.y)
      const x2 = Math.max(drag.x1, coords.x)
      const y2 = Math.max(drag.y1, coords.y)
      if (Math.abs(x2 - x1) < MIN_SELECT_PX || Math.abs(y2 - y1) < MIN_SELECT_PX) return
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
      if (rafRef.current != null) {
        cancelAnimationFrame(rafRef.current)
        rafRef.current = null
      }
    }
  }, [])

  if (!plotArea) return null

  const onDown = (e: ReactMouseEvent) => {
    if (e.button !== 0 && e.button !== 1 && e.button !== 2) return
    const ctx = ctxRef.current
    if (e.button !== 0 && !ctx.isZoomed) return
    const svgEl = (e.currentTarget as SVGElement).ownerSVGElement ?? null
    const coords = toSvgCoords(e)
    if (!coords || !svgEl) return
    const base = {
      baseXInv: ctx.xInv,
      baseYInv: ctx.yInv,
      basePlot: ctx.plotArea ?? undefined,
      baseX: ctx.xDomain,
      baseY: ctx.yDomain,
    }
    if (e.button === 1) {
      if (!ctx.xInv || !ctx.yInv || !ctx.plotArea) return
      e.preventDefault()
      dragRef.current = { mode: 'pan', x1: coords.x, y1: coords.y, svgEl, ...base }
      panDeltaRef.current = { dx: 0, dy: 0 }
      return
    }
    e.preventDefault()
    dragRef.current = { mode: e.button === 0 ? 'select' : 'zoomout', x1: coords.x, y1: coords.y, svgEl, ...base }
    setSel({ x1: coords.x, y1: coords.y, x2: coords.x, y2: coords.y })
  }

  return (
    <g onContextMenu={(e) => e.preventDefault()}>
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
