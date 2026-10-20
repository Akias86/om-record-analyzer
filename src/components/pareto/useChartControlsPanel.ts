import { useCallback, useEffect, useLayoutEffect, useReducer, useRef, useState } from 'react'
import { loadSetting, saveSetting } from '../../lib/settings'
import { controlsPanelReducer, initialControlsPanel, needsControlsOverlay } from './controlsPanel'

const STORAGE_KEY = 'om-chart:controlsCollapsed'

export function useChartControlsPanel(hasUserSummary: boolean) {
  const [container, setContainer] = useState<HTMLDivElement | null>(null)
  const [state, dispatch] = useReducer(controlsPanelReducer, undefined, () => initialControlsPanel(loadSetting(STORAGE_KEY, 'false')))
  const launcherRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLElement>(null)
  const focusRequested = useRef(false)
  const wasOverlayOpen = useRef(false)
  const open = state.compact ? state.overlayOpen : !state.desktopCollapsed

  useLayoutEffect(() => {
    if (!container) return
    const measure = () => dispatch({ type: 'resize', compact: needsControlsOverlay(container.clientWidth, hasUserSummary) })
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(container)
    return () => observer.disconnect()
  }, [container, hasUserSummary])

  useEffect(() => {
    saveSetting(STORAGE_KEY, String(state.desktopCollapsed))
  }, [state.desktopCollapsed])

  const toggle = useCallback(() => {
    focusRequested.current = true
    dispatch({ type: 'toggle' })
  }, [])
  const close = useCallback(() => {
    focusRequested.current = true
    dispatch({ type: 'close' })
  }, [])

  useLayoutEffect(() => {
    if (focusRequested.current || (wasOverlayOpen.current && !open)) {
      const target = open ? panelRef.current?.querySelector<HTMLButtonElement>('button') : launcherRef.current
      target?.focus({ preventScroll: true })
      focusRequested.current = false
    }
    wasOverlayOpen.current = state.compact && open
  }, [open, state.compact])

  useEffect(() => {
    if (!state.compact || !open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return
      if (event.key === 'Escape') {
        event.preventDefault()
        close()
      } else if (event.key === 'Tab') {
        const panel = panelRef.current
        const focusable = panel?.querySelectorAll<HTMLElement>('button:not(:disabled), select:not(:disabled)')
        if (!panel || !focusable?.length) return
        const first = focusable[0]
        const last = focusable[focusable.length - 1]
        const outside = !panel.contains(document.activeElement)
        if (event.shiftKey && (document.activeElement === first || outside)) {
          event.preventDefault()
          last.focus()
        } else if (!event.shiftKey && (document.activeElement === last || outside)) {
          event.preventDefault()
          first.focus()
        }
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [state.compact, open, close])

  return { containerRef: setContainer, launcherRef, panelRef, open, overlay: state.compact, toggle, close }
}
