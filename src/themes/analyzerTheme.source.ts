import { defineTheme } from '@astryxdesign/core/theme'
import { themePalette } from '@astryxdesign/core/palette'
import { neutralTheme, neutralIconRegistry } from '@astryxdesign/theme-neutral/built'

export const analyzerTheme = defineTheme({
  name: 'analyzer',
  extends: neutralTheme,
  icons: neutralIconRegistry,
  palette: themePalette({
    accent: '#4f46e5',
    neutral: '#64748b',
    vibrancy: 55,
    recipe: 'astryx-oklch-v2',
  }),
})
