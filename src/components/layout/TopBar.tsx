import { demoAvailable, isDemoEnabled, setDemoEnabled } from '../../api/demo'
import { THEME_LABELS, nextThemeMode } from '../../lib/theme'
import { useUserSolutions } from '../../state/userSolutions'
import { useSolutionUpload } from '../../state/solutionUpload'
import { useAppNav } from './AppShell'
import { PuzzleSearch } from './PuzzleSearch'
import { useTheme } from '../../state/useTheme'
import { IconAlembic, IconHexagon, IconMenu, IconMonitor, IconMoon, IconSun, IconUpload } from '../ui/icons'

interface TopBarProps {
  onPickPuzzle: (puzzleId: string) => void
}

export function TopBar({ onPickPuzzle }: TopBarProps) {
  const { navOpen, toggleNav } = useAppNav()
  const { pickFiles } = useSolutionUpload()
  const { uploading, progress, records } = useUserSolutions()

  return (
    <>
      <button
        type="button"
        className="btn btn--ghost btn--icon topbar-menu"
        onClick={toggleNav}
        aria-label={navOpen ? 'Close navigation' : 'Open navigation'}
        aria-expanded={navOpen}
      >
        <IconMenu size={19} />
      </button>
      <Brand />
      <div className="topbar-center">
        <PuzzleSearch onPick={onPickPuzzle} />
      </div>
      <div className="topbar-actions">
        {uploading && (
          <span className="chip chip--accent" role="status">
            <span className="spinner" aria-hidden="true" />
            {progress ? `Verifying ${progress.done}/${progress.total}` : 'Verifying…'}
          </span>
        )}
        {!uploading && records.length > 0 && (
          <span className="chip" title="Verified solutions held in this browser">
            <IconHexagon size={12} />
            {records.length} yours
          </span>
        )}
        <DemoToggle />
        <ThemeToggle />
        <span className="topbar-divider" aria-hidden="true" />
        <a className="btn btn--ghost" href="#/validator" title="Batch-verify a folder of .solution files">
          <IconAlembic size={16} />
          <span className="topbar-action-label">Validator</span>
        </a>
        <button type="button" className="btn btn--primary" onClick={pickFiles} title="Verify .solution files locally in this browser">
          <IconUpload size={16} />
          <span className="topbar-action-label">Verify solutions</span>
        </button>
      </div>
    </>
  )
}

export function Brand({ label = 'Record Analyzer' }: { label?: string }) {
  return (
    <a className="brand" href="#/" title="Opus Magnum Record Analyzer">
      <span className="brand-mark" aria-hidden="true">
        <IconHexagon size={19} strokeWidth={1.5} />
      </span>
      <span className="brand-text">
        <span className="brand-title">Opus Magnum</span>
        <span className="brand-sub">{label}</span>
      </span>
    </a>
  )
}

export function ThemeToggle() {
  const { mode, cycle } = useTheme()
  const Icon = mode === 'dark' ? IconMoon : mode === 'light' ? IconSun : IconMonitor
  const next = THEME_LABELS[nextThemeMode(mode)]
  return (
    <button
      type="button"
      className="btn btn--ghost btn--icon theme-toggle"
      onClick={cycle}
      title={`Theme: ${THEME_LABELS[mode]} — click for ${next}`}
      aria-label={`Theme: ${THEME_LABELS[mode]}. Switch to ${next}.`}
    >
      <Icon size={17} />
    </button>
  )
}

/** Development aid: flips the offline dataset on and off (reloads the page). */
export function DemoToggle() {
  if (!demoAvailable()) return null
  const enabled = isDemoEnabled()
  return (
    <button
      type="button"
      className={`chip demo-toggle${enabled ? ' is-on' : ''}`}
      onClick={() => setDemoEnabled(!enabled)}
      title={enabled
        ? 'Demo data is on: puzzles and records come from the bundled offline dataset. Click to use the live leaderboard API.'
        : 'Use the bundled offline dataset instead of the leaderboard API (development only).'}
    >
      <span className="demo-dot" aria-hidden="true" />
      Demo data
    </button>
  )
}
