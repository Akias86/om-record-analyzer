import type { MouseEvent as ReactMouseEvent } from 'react'

export function toSvgCoords(e: ReactMouseEvent): { x: number; y: number } | null {
  const svg = (e.currentTarget as SVGElement).ownerSVGElement
  if (!svg) return null
  const pt = svg.createSVGPoint()
  pt.x = e.clientX
  pt.y = e.clientY
  const ctm = svg.getScreenCTM()
  if (!ctm) return null
  const inv = ctm.inverse()
  const local = pt.matrixTransform(inv)
  return { x: local.x, y: local.y }
}

export function globalToSvgCoords(
  clientX: number,
  clientY: number,
  svgEl: SVGSVGElement | null,
): { x: number; y: number } | null {
  if (!svgEl) return null
  const pt = svgEl.createSVGPoint()
  pt.x = clientX
  pt.y = clientY
  const ctm = svgEl.getScreenCTM()
  if (!ctm) return null
  const inv = ctm.inverse()
  const local = pt.matrixTransform(inv)
  return { x: local.x, y: local.y }
}