import { useCallback, useEffect, useState } from 'react'
import { applyThemeMode, nextThemeMode, prefersDarkScheme, readThemeMode, resolveTheme, writeThemeMode } from '../lib/theme'
import type { ThemeMode } from '../lib/theme'

export interface Theme {
  /** What the user asked for. */
  mode: ThemeMode
  /** Which palette is actually in effect (resolves `auto` against the OS). */
  resolved: 'light' | 'dark'
  setMode: (mode: ThemeMode) => void
  cycle: () => void
}

export function useTheme(): Theme {
  const [mode, setMode] = useState<ThemeMode>(() => readThemeMode())
  const [resolved, setResolved] = useState<'light' | 'dark'>(() => resolveTheme(mode, prefersDarkScheme()))

  useEffect(() => {
    applyThemeMode(mode)
    writeThemeMode(mode)
    setResolved(resolveTheme(mode, prefersDarkScheme()))
  }, [mode])

  // In `auto` mode the OS can flip the palette at any time (scheduled dark
  // mode, or the user changing their system theme mid-session).
  useEffect(() => {
    if (mode !== 'auto') return
    let media: MediaQueryList | undefined
    try {
      media = window.matchMedia('(prefers-color-scheme: dark)')
    } catch {
      return
    }
    if (!media) return
    const update = () => setResolved(resolveTheme('auto', media?.matches ?? false))
    update()
    media.addEventListener?.('change', update)
    return () => media?.removeEventListener?.('change', update)
  }, [mode])

  const cycle = useCallback(() => setMode((current) => nextThemeMode(current)), [])

  return { mode, resolved, setMode, cycle }
}
