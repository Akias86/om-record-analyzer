import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import './AppShell.css'

/* ---------------------------------------------------------------------------
   Application frame: a full-width top bar above a navigation column and the
   main workspace. On narrow viewports the navigation column becomes an
   off-canvas drawer driven by the same `navOpen` state, exposed through
   context so the sidebar can close itself after a selection.
--------------------------------------------------------------------------- */

interface AppNav {
  navOpen: boolean
  openNav: () => void
  closeNav: () => void
  toggleNav: () => void
}

const AppNavContext = createContext<AppNav | null>(null)

export function useAppNav(): AppNav {
  const value = useContext(AppNavContext)
  if (!value) throw new Error('useAppNav must be used inside <AppShell>')
  return value
}

interface AppShellProps {
  topBar: ReactNode
  sidebar?: ReactNode
  children: ReactNode
}

export function AppShell({ topBar, sidebar, children }: AppShellProps) {
  const [navOpen, setNavOpen] = useState(false)
  const openNav = useCallback(() => setNavOpen(true), [])
  const closeNav = useCallback(() => setNavOpen(false), [])
  const toggleNav = useCallback(() => setNavOpen((open) => !open), [])

  useEffect(() => {
    if (!navOpen) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        setNavOpen(false)
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [navOpen])

  // A viewport that fits the column permanently must drop the drawer state,
  // otherwise the scrim keeps intercepting clicks after rotating a tablet.
  useEffect(() => {
    let media: MediaQueryList | undefined
    try {
      media = window.matchMedia('(min-width: 960px)')
    } catch {
      return
    }
    if (!media) return
    const update = () => { if (media?.matches) setNavOpen(false) }
    update()
    media.addEventListener?.('change', update)
    return () => media?.removeEventListener?.('change', update)
  }, [])

  const nav = useMemo<AppNav>(() => ({ navOpen, openNav, closeNav, toggleNav }), [navOpen, openNav, closeNav, toggleNav])
  const mainRef = useRef<HTMLElement>(null)
  // A button rather than an anchor: the app routes on location.hash, so an
  // href="#main" skip link would be parsed as a route and clear the puzzle.
  const skipToContent = useCallback(() => mainRef.current?.focus(), [])

  return (
    <AppNavContext.Provider value={nav}>
      <div className={`app${navOpen ? ' is-nav-open' : ''}`}>
        <button type="button" className="skip-link" onClick={skipToContent}>Skip to content</button>
        <div className="app-topbar">{topBar}</div>
        {sidebar && (
          <>
            <button
              type="button"
              className="app-scrim"
              tabIndex={-1}
              aria-label="Close navigation"
              onClick={closeNav}
            />
            <div className="app-sidebar">{sidebar}</div>
          </>
        )}
        <main ref={mainRef} className="app-main" tabIndex={-1}>{children}</main>
      </div>
    </AppNavContext.Provider>
  )
}
