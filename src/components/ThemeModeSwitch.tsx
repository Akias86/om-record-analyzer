import { SegmentedControl, SegmentedControlItem } from '@astryxdesign/core/SegmentedControl'
import { Monitor, Moon, Sun } from 'lucide-react'
import { useThemeMode } from '../state/themeMode'
import type { ThemeMode } from '../state/themeMode'

export function ThemeModeSwitch() {
  const { mode, setMode } = useThemeMode()

  return (
    <SegmentedControl
      size="sm"
      label="Color theme"
      value={mode}
      onChange={(next) => setMode(next as ThemeMode)}
    >
      <SegmentedControlItem value="light" label="Light theme" isLabelHidden icon={<Sun size={14} />} />
      <SegmentedControlItem value="system" label="System theme" isLabelHidden icon={<Monitor size={14} />} />
      <SegmentedControlItem value="dark" label="Dark theme" isLabelHidden icon={<Moon size={14} />} />
    </SegmentedControl>
  )
}
