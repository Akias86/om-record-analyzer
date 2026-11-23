/* Theme preference: `auto` follows the OS (the default), `light` and `dark`
   pin it. The choice is written to <html data-theme> so tokens.css can flip
   the whole palette with `light-dark()`; `auto` removes the attribute. */

export type ThemeMode = 'auto' | 'light' | 'dark'

export const THEME_KEY = 'om-app:theme'

export const THEME_MODES: ThemeMode[] = ['auto', 'light', 'dark']

export const THEME_LABELS: Record<ThemeMode, string> = {
  auto: 'Match system',
  light: 'Light',
  dark: 'Dark',
}

export function parseThemeMode(value: unknown): ThemeMode {
  return value === 'light' || value === 'dark' ? value : 'auto'
}

/** Cycle used by the single-button theme toggle: auto → light → dark → auto. */
export function nextThemeMode(mode: ThemeMode): ThemeMode {
  const index = THEME_MODES.indexOf(mode)
  return THEME_MODES[(index + 1) % THEME_MODES.length] ?? 'auto'
}

/** The palette actually in effect for a mode on this device. */
export function resolveTheme(mode: ThemeMode, prefersDark: boolean): 'light' | 'dark' {
  if (mode !== 'auto') return mode
  return prefersDark ? 'dark' : 'light'
}

export function readThemeMode(storage: Pick<Storage, 'getItem'> | undefined = safeStorage()): ThemeMode {
  return parseThemeMode(storage?.getItem(THEME_KEY))
}

export function writeThemeMode(mode: ThemeMode, storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | undefined = safeStorage()): void {
  if (!storage) return
  try {
    if (mode === 'auto') storage.removeItem(THEME_KEY)
    else storage.setItem(THEME_KEY, mode)
  } catch { /* private mode or a full quota: the session theme still applies */ }
}

export function applyThemeMode(mode: ThemeMode, root: Pick<HTMLElement, 'dataset'> | undefined = safeRoot()): void {
  if (!root) return
  if (mode === 'auto') delete root.dataset.theme
  else root.dataset.theme = mode
}

export function prefersDarkScheme(window_: Pick<Window, 'matchMedia'> | undefined = safeWindow()): boolean {
  try {
    return !!window_?.matchMedia('(prefers-color-scheme: dark)').matches
  } catch {
    return false
  }
}

function safeRoot(): Pick<HTMLElement, 'dataset'> | undefined {
  try {
    return typeof document === 'undefined' ? undefined : document.documentElement
  } catch {
    return undefined
  }
}

function safeStorage(): Storage | undefined {
  try {
    return typeof localStorage === 'undefined' ? undefined : localStorage
  } catch {
    return undefined
  }
}

function safeWindow(): Window | undefined {
  try {
    return typeof window === 'undefined' ? undefined : window
  } catch {
    return undefined
  }
}

/** Called from an inline <head> script and again from main.tsx: setting the
   attribute before first paint avoids a light-theme flash for dark users. */
export function initTheme(): void {
  applyThemeMode(readThemeMode())
}
