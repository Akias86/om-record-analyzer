import { createContext, useContext } from 'react'

export type ThemeMode = 'system' | 'light' | 'dark'

export interface ThemeModeContextValue {
  mode: ThemeMode
  setMode: (mode: ThemeMode) => void
}

export const ThemeModeContext = createContext<ThemeModeContextValue>({
  mode: 'system',
  setMode: () => {},
})

export function useThemeMode(): ThemeModeContextValue {
  return useContext(ThemeModeContext)
}
