import { useLayoutEffect, type RefObject } from 'react'

/** Fit the native GIF-sized playback area, with no padding/letterboxing around it. */
export function usePlayerLayout(backdropRef: RefObject<HTMLDivElement | null>, panelRef: RefObject<HTMLDivElement | null>) {
  useLayoutEffect(() => {
    const backdrop = backdropRef.current
    const panel = panelRef.current
    const header = panel?.querySelector<HTMLElement>('.gif-viewer-header')
    const footer = panel?.querySelector<HTMLElement>('.gif-viewer-footer')
    if (!backdrop || !panel || !header || !footer) return

    const fit = () => {
      const backdropStyle = getComputedStyle(backdrop)
      const panelStyle = getComputedStyle(panel)
      const borderWidth = parseFloat(panelStyle.borderLeftWidth) + parseFloat(panelStyle.borderRightWidth)
      const borderHeight = parseFloat(panelStyle.borderTopWidth) + parseFloat(panelStyle.borderBottomWidth)
      const availableWidth = backdrop.clientWidth - parseFloat(backdropStyle.paddingLeft) - parseFloat(backdropStyle.paddingRight)
      const availableHeight = backdrop.clientHeight - parseFloat(backdropStyle.paddingTop) - parseFloat(backdropStyle.paddingBottom)
      const chromeHeight = header.getBoundingClientRect().height + footer.getBoundingClientRect().height + borderHeight
      const width = Math.max(0, Math.min(826, availableWidth - borderWidth, (availableHeight - chromeHeight) * 826 / 647))
      // Iframe viewports round to CSS pixels; avoid a fractional-width seam.
      panel.style.width = `${Math.floor(width) + borderWidth}px`
    }
    let frame = 0
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(fit)
    })
    observer.observe(backdrop)
    observer.observe(header)
    observer.observe(footer)
    fit()
    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
    }
  }, [backdropRef, panelRef])
}
