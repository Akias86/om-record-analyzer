import type { RecentPuzzle } from '../../lib/recentPuzzles'
import { IconAlembic, IconClock, IconHexagon, IconPlay, IconScatter, IconSparkle, IconTarget, IconUpload } from '../ui/icons'

/* Shown when no puzzle is selected: what the tool does, the fastest way in,
   and a way back to whatever you last opened. */

interface WelcomeScreenProps {
  recent: RecentPuzzle[]
  onSelectPuzzle: (puzzleId: string) => void
  onUpload: () => void
  verifiedCount: number
  frontierCount: number
}

function hexPath(cx: number, cy: number, r: number): string {
  const points: string[] = []
  for (let i = 0; i < 6; i++) {
    const angle = (Math.PI / 180) * (60 * i - 30)
    points.push(`${(cx + r * Math.cos(angle)).toFixed(2)},${(cy + r * Math.sin(angle)).toFixed(2)}`)
  }
  return `M${points.join('L')}Z`
}

/** Honeycomb with a frontier path running through it: the app in one glyph. */
function LatticeArt() {
  const r = 21
  const dx = Math.sqrt(3) * r
  const dy = 1.5 * r
  const cells = [
    { col: 1, row: 0, opacity: 0.16 },
    { col: 2, row: 0, opacity: 0.1 },
    { col: 0, row: 1, opacity: 0.22 },
    { col: 1, row: 1, opacity: 0.34 },
    { col: 2, row: 1, opacity: 0.14 },
    { col: 0, row: 2, opacity: 0.12 },
    { col: 1, row: 2, opacity: 0.5 },
    { col: 2, row: 2, opacity: 0.26 },
    { col: 1, row: 3, opacity: 0.18 },
    { col: 2, row: 3, opacity: 0.4 },
  ]
  const center = (col: number, row: number) => ({
    x: 26 + col * dx + (row % 2 ? dx / 2 : 0),
    y: 26 + row * dy,
  })
  const path = [{ col: 0, row: 1 }, { col: 1, row: 1 }, { col: 1, row: 2 }, { col: 2, row: 3 }]
    .map(({ col, row }) => center(col, row))

  return (
    <svg className="welcome-art" width={208} height={178} viewBox="0 0 160 152" aria-hidden="true">
      {cells.map(({ col, row, opacity }) => {
        const { x, y } = center(col, row)
        return (
          <path
            key={`${col}-${row}`}
            d={hexPath(x, y, r)}
            fill="currentColor"
            fillOpacity={opacity * 0.22}
            stroke="currentColor"
            strokeOpacity={opacity}
            strokeWidth={1}
          />
        )
      })}
      <polyline
        points={path.map((p) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' ')}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.6}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeDasharray="3 3"
        opacity={0.85}
      />
      {path.map((p, i) => (
        <circle key={i} cx={p.x} cy={p.y} r={i === path.length - 1 ? 4 : 2.8} fill="currentColor" />
      ))}
    </svg>
  )
}

const FEATURES = [
  {
    icon: IconScatter,
    title: 'Pareto frontier charts',
    body: 'Plot any two metrics — cost, cycles, area, instructions, height, width, bounding hex, rate and their @∞ forms — with log scales, drag-to-zoom and per-manifold frontiers.',
  },
  {
    icon: IconAlembic,
    title: 'Verified in your browser',
    body: 'Drop exported .solution files and score them locally with the WebAssembly engine. Files never leave the machine; nothing is uploaded to the leaderboard.',
  },
  {
    icon: IconTarget,
    title: 'Frontier detection',
    body: 'Your verified solutions are overlaid on the leaderboard and marked green when they reach a frontier — the sidebar lists which manifolds you beat.',
  },
  {
    icon: IconPlay,
    title: 'Instant playback',
    body: 'Replay any record in the embedded real-time player with cycle stepping and speed control, or fall back to its recorded GIF when WebGPU is unavailable.',
  },
]

export function WelcomeScreen({ recent, onSelectPuzzle, onUpload, verifiedCount, frontierCount }: WelcomeScreenProps) {
  return (
    <div className="welcome">
      <div className="welcome-inner">
        <section className="welcome-hero">
          <div>
            <span className="welcome-eyebrow">
              <IconHexagon size={13} strokeWidth={1.8} />
              Community leaderboard analytics
            </span>
            <h1 className="welcome-title">
              Measure every solution<br />against the <em>frontier</em>.
            </h1>
            <p className="welcome-lede">
              Pick a puzzle to read its leaderboard, or verify your own <code>.solution</code> files to see
              exactly where they land — cost against cycles, area against instructions, or any pair of metrics
              you care about.
            </p>
            <div className="welcome-actions">
              <button type="button" className="btn btn--solid btn--lg" onClick={onUpload}>
                <IconUpload size={17} />
                Verify your solutions
              </button>
              <a className="btn btn--lg" href="#/validator">
                <IconAlembic size={17} />
                Batch validator
              </a>
              {verifiedCount > 0 && (
                <span className="chip chip--accent" title="Verified solutions stored in this browser">
                  <IconSparkle size={12} />
                  {verifiedCount} verified{frontierCount > 0 ? ` · ${frontierCount} on frontier` : ''}
                </span>
              )}
            </div>
          </div>
          <LatticeArt />
        </section>

        <section className="welcome-grid">
          {FEATURES.map(({ icon: Icon, title, body }) => (
            <article className="welcome-card" key={title}>
              <span className="welcome-card-icon" aria-hidden="true"><Icon size={17} /></span>
              <h3>{title}</h3>
              <p>{body}</p>
            </article>
          ))}
        </section>

        {recent.length > 0 && (
          <section className="welcome-recent">
            <span className="welcome-recent-head">
              <IconClock size={13} />
              Recently opened
            </span>
            <div className="welcome-recent-list">
              {recent.map((entry) => (
                <button
                  key={entry.id}
                  type="button"
                  className="welcome-recent-item"
                  onClick={() => onSelectPuzzle(entry.id)}
                  title={`${entry.name} (${entry.id})`}
                >
                  {entry.name}
                  <span className="welcome-recent-id">{entry.id}</span>
                </button>
              ))}
            </div>
          </section>
        )}

        <p className="welcome-foot">
          Leaderboard data comes from the community API through a Cloudflare Worker proxy and is cached in this
          browser for a day. Verification runs entirely client-side. Press
          {' '}<kbd>Ctrl</kbd><kbd>K</kbd> anywhere to jump to a puzzle.
        </p>
      </div>
    </div>
  )
}
