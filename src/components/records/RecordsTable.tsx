import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
} from '@tanstack/react-table'
import type { ColumnDef, SortingFn, SortingState } from '@tanstack/react-table'
import { METRIC_LABELS } from '../../types'
import type { OmScoreDTO } from '../../types'
import { formatAreaINF, formatScoreNumber, getMetricValue } from '../../lib/metrics'
import { loadSetting, saveSetting } from '../../lib/settings'
import { CLASS_COLOR, USER_GREEN, USER_RED } from '../pareto/constants'
import { GifViewer } from '../pareto/GifViewer'
import type { PuzzleRecordsData } from '../../state/usePuzzleRecords'
import './RecordsTable.css'

type TableMode = 'v' | 'inf'

// Default sort chains per mode: leftmost = primary key, all numeric
// ascending ("smaller is better", including rate which counts cycles per
// output). @∞ uses the infinity-family metrics in place of their victory
// counterparts; R sits where C does in the victory chain.
const MODE_CHAINS: Record<TableMode, string[]> = {
  v: ['cost', 'cycles', 'area', 'instructions', 'height', 'width', 'boundingHex'],
  inf: ['cost', 'rate', 'areaINF', 'instructions', 'heightINF', 'widthINF', 'boundingHexINF'],
}

// Single-letter header notation, matching the letters used in zlbb score
// strings (40g/143c/12a/6i/...); @∞ metrics carry a superscript ∞.
const METRIC_LETTERS: Record<string, { letter: string; inf?: boolean }> = {
  cost: { letter: 'G' },
  cycles: { letter: 'C' },
  area: { letter: 'A' },
  instructions: { letter: 'I' },
  height: { letter: 'H' },
  width: { letter: 'W' },
  boundingHex: { letter: 'B' },
  rate: { letter: 'R' },
  areaINF: { letter: 'A', inf: true },
  heightINF: { letter: 'H', inf: true },
  widthINF: { letter: 'W', inf: true },
  boundingHexINF: { letter: 'B', inf: true },
}

// O and T are the only columns whose sorting reacts to clicks: a three-state
// cycle starting from each column's default state. O defaults to ▴ (false
// first = cleaner solutions on top); T defaults to − (off), its first click
// lands on ▾ (trackless solutions first).
type FlagState = 'asc' | 'desc' | null
const FLAG_CYCLES: Record<'overlap' | 'trackless', FlagState[]> = {
  overlap: ['asc', 'desc', null],
  trackless: [null, 'desc', 'asc'],
}

const FLAG_GLYPHS: Record<Exclude<FlagState, null>, string> = { asc: '▴', desc: '▾' }
const FLAG_LABELS: Record<'overlap' | 'trackless', string> = { overlap: 'Overlap', trackless: 'Trackless' }
const FLAG_TITLES: Record<'overlap' | 'trackless', string> = {
  overlap: 'Overlap — click to cycle sort: ▴ false first / ▾ true first / − off',
  trackless: 'Trackless — click to cycle sort: − off / ▾ true first / ▴ false first',
}

interface TableRow {
  key: string
  isUser: boolean
  name: string | null
  green: boolean | null
  score: OmScoreDTO | null
  smart: string | null
  full: string | null
  categories: string | null
  gif: string | null
  solution: string | null
}

type ChainMap = Record<TableMode, string[]>

interface Flags {
  o: FlagState
  t: FlagState
}

function loadChainMap(): ChainMap {
  try {
    const saved = localStorage.getItem('om-table:chain')
    if (saved) {
      const parsed = JSON.parse(saved) as Partial<ChainMap>
      if (
        parsed.v && parsed.inf &&
        parsed.v.length === MODE_CHAINS.v.length && parsed.inf.length === MODE_CHAINS.inf.length &&
        parsed.v.every((k) => MODE_CHAINS.v.includes(k)) &&
        parsed.inf.every((k) => MODE_CHAINS.inf.includes(k))
      ) return { v: parsed.v, inf: parsed.inf }
    }
  } catch { }
  return { v: [...MODE_CHAINS.v], inf: [...MODE_CHAINS.inf] }
}

function loadFlags(): Flags {
  try {
    const saved = localStorage.getItem('om-table:flags')
    if (saved) {
      const parsed = JSON.parse(saved) as Partial<Flags>
      if (parsed.o !== undefined) return { o: parsed.o ?? null, t: parsed.t ?? null }
    }
  } catch { }
  return { o: 'asc', t: null }
}

interface RecordsTableProps {
  puzzleId: string
  puzzleName: string
  shared: PuzzleRecordsData
}

// @∞ area is written the way score strings write it (raw value plus the
// apostrophe-level suffix); every other metric shows its full number,
// never an SI abbreviation (1728679, not 1.7M).
function metricCellText(score: OmScoreDTO | null, key: string): string {
  if (score === null) return '–'
  if (key === 'areaINF') return formatAreaINF(score) ?? '–'
  const v = getMetricValue(score, key)
  return v === null ? '–' : formatScoreNumber(v)
}

export default function RecordsTable({ puzzleId, puzzleName, shared }: RecordsTableProps) {
  const [mode, setMode] = useState<TableMode>(() => (loadSetting('om-table:mode', 'v') === 'inf' ? 'inf' : 'v'))
  const [chains, setChains] = useState<ChainMap>(loadChainMap)
  const [flags, setFlags] = useState<Flags>(loadFlags)
  // Written directly in onDragStart so dropOn sees the key even when the
  // drop arrives in the same tick (before a re-render could propagate it).
  const dragKeyRef = useRef<string | null>(null)
  const [dragOverKey, setDragOverKey] = useState<string | null>(null)
  const [gif, setGif] = useState<TableRow | null>(null)

  const chain = chains[mode]

  // @∞ scores only looping solutions: rate === null marks a non-looping
  // run (the same rule manifold.ts uses for the 'looping' metric), and such
  // solutions have no meaningful @∞ row. @V shows everything.
  const loopingOnly = mode === 'inf'

  // Metrics with no value anywhere on this puzzle's leaderboard are hidden.
  const availableKeys = useMemo(() => {
    const keys = new Set<string>()
    for (const key of MODE_CHAINS[mode]) {
      if (shared.records.some((r) =>
        r.score !== null && (!loopingOnly || r.score.rate != null) && getMetricValue(r.score, key) !== null)) {
        keys.add(key)
      }
    }
    return keys
  }, [shared.records, mode, loopingOnly])

  const visibleChain = useMemo(() => chain.filter((k) => availableKeys.has(k)), [chain, availableKeys])

  // User solutions marked green when on the frontier of ANY manifold in the
  // current mode's family (VICTORY_* for @V, INFINITY_* for @∞).
  const userGreen = useMemo(() => {
    const prefix = mode === 'v' ? 'VICTORY_' : 'INFINITY_'
    const set = new Set<string>()
    for (const [mid, ids] of shared.userFrontierByManifold) {
      if (mid.startsWith(prefix)) for (const id of ids) set.add(id)
    }
    return set
  }, [shared.userFrontierByManifold, mode])

  const rows = useMemo<TableRow[]>(() => {
    const out: TableRow[] = []
    shared.records.forEach((r, i) => {
      if (r.score === null) return
      if (loopingOnly && r.score.rate == null) return
      out.push({
        key: r.id ?? `lb-${i}`,
        isUser: false,
        name: null,
        green: null,
        score: r.score,
        smart: r.smartFormattedScore,
        full: r.fullFormattedScore,
        categories: r.smartFormattedCategories,
        gif: r.gif,
        solution: r.solution,
      })
    })
    for (const r of shared.puzzleUserRecords) {
      if (loopingOnly && r.score.rate == null) continue
      out.push({
        key: `user-${r.id}`,
        isUser: true,
        name: r.solutionName ?? '(unnamed)',
        green: userGreen.has(r.id),
        score: r.score,
        smart: null,
        full: r.fullScore,
        categories: null,
        gif: null,
        solution: null,
      })
    }
    return out
  }, [shared.records, shared.puzzleUserRecords, userGreen, loopingOnly])

  const leaderboardCount = useMemo(() => rows.filter((r) => !r.isUser).length, [rows])
  const userCount = useMemo(
    () => (loopingOnly
      ? shared.puzzleUserRecords.filter((r) => r.score.rate != null)
      : shared.puzzleUserRecords).length,
    [shared.puzzleUserRecords, loopingOnly],
  )

  // The flag comparators read the live flag state through a ref so the column
  // defs stay stable; the sorted-row model re-runs because the `sorting`
  // state array below is rebuilt whenever a flag changes. All SortingState
  // entries stay `desc: false` — the library applies no reversal and each
  // comparator handles its own direction, which is what lets missing values
  // (null) sink to the bottom.
  const flagsRef = useRef(flags)
  flagsRef.current = flags

  const metricSortingFn = useCallback<SortingFn<TableRow>>((rowA, rowB, columnId) => {
    const a = rowA.original.score ? getMetricValue(rowA.original.score, columnId) : null
    const b = rowB.original.score ? getMetricValue(rowB.original.score, columnId) : null
    if (a === null && b === null) return 0
    if (a === null) return 1
    if (b === null) return -1
    return a < b ? -1 : a > b ? 1 : 0
  }, [])
  const makeFlagSortingFn = useCallback((flag: 'overlap' | 'trackless'): SortingFn<TableRow> => (rowA, rowB) => {
    const a = rowA.original.score?.[flag] ? 1 : 0
    const b = rowB.original.score?.[flag] ? 1 : 0
    const desc = (flag === 'overlap' ? flagsRef.current.o : flagsRef.current.t) === 'desc'
    return desc ? b - a : a - b
  }, [])

  const columns = useMemo<ColumnDef<TableRow>[]>(() => [
    ...MODE_CHAINS[mode].map((key) => ({
      id: key,
      accessorFn: (row: TableRow) => (row.score ? getMetricValue(row.score, key) : null),
      sortingFn: metricSortingFn,
    })),
    { id: 'overlap', accessorFn: (row: TableRow) => row.score?.overlap ?? false, sortingFn: makeFlagSortingFn('overlap') },
    { id: 'trackless', accessorFn: (row: TableRow) => row.score?.trackless ?? false, sortingFn: makeFlagSortingFn('trackless') },
    { id: 'category' },
    { id: 'actions' },
  ], [mode, metricSortingFn, makeFlagSortingFn])

  // O and T, when active, are a fixed prefix (O before T) ahead of the
  // metric chain. Metrics are always ascending (best first); priority is
  // expressed by chain order, which is changed by dragging headers, never
  // by clicking them.
  const sorting = useMemo<SortingState>(() => {
    const state: SortingState = []
    if (flags.o) state.push({ id: 'overlap', desc: false })
    if (flags.t) state.push({ id: 'trackless', desc: false })
    for (const key of visibleChain) state.push({ id: key, desc: false })
    return state
  }, [flags, visibleChain])

  const table = useReactTable({
    data: rows,
    columns,
    state: { sorting },
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  })

  const switchMode = (m: TableMode) => {
    setMode(m)
    saveSetting('om-table:mode', m)
  }

  useEffect(() => {
    try { localStorage.setItem('om-table:chain', JSON.stringify(chains)) } catch { }
  }, [chains])

  const dropOn = (target: string) => {
    const key = dragKeyRef.current
    if (!key || key === target) return
    setChains((c) => {
      const arr = [...c[mode]]
      const from = arr.indexOf(key)
      const to = arr.indexOf(target)
      if (from === -1 || to === -1) return c
      arr.splice(from, 1)
      arr.splice(to, 0, key)
      return { ...c, [mode]: arr }
    })
  }

  const cycleFlag = (flag: 'overlap' | 'trackless') => {
    setFlags((f) => {
      const cur = flag === 'overlap' ? f.o : f.t
      const cycle = FLAG_CYCLES[flag]
      const next = cycle[(cycle.indexOf(cur) + 1) % cycle.length]
      const updated = { ...f, [flag === 'overlap' ? 'o' : 't']: next }
      try { localStorage.setItem('om-table:flags', JSON.stringify(updated)) } catch { }
      return updated
    })
  }

  const sortParts = useMemo(() => {
    const parts: string[] = []
    for (const k of visibleChain) parts.push(METRIC_LABELS[k] ?? k)
    return parts
  }, [visibleChain])

  const sortTitle = sortParts.length > 0
    ? `Sorted by ${sortParts.join(', then ')} — metrics ascend (best first). Drag a metric header to reorder the chain.`
    : 'No sort keys.'

  if (shared.loading || (!shared.error && !shared.recordsReady)) {
    return <div className="records-table"><div className="pareto-chart-loading">Loading records...</div></div>
  }
  if (shared.error) {
    return <div className="records-table"><div className="pareto-chart-error">Error: {shared.error}</div></div>
  }

  let leaderboardRank = 0

  return (
    <div className="records-table">
      <div className="records-table-toolbar">
        <span className="records-table-modes">
          <button type="button" className={`records-table-mode-btn ${mode === 'v' ? 'active' : ''}`} onClick={() => switchMode('v')}>@V</button>
          <button type="button" className={`records-table-mode-btn ${mode === 'inf' ? 'active' : ''}`} onClick={() => switchMode('inf')}>@∞</button>
        </span>
        <span className="records-table-sort" title={sortTitle}>
          {sortParts.length > 0 ? `Sorted by ${sortParts.join(' → ')}` : 'No sort keys'}
        </span>
        <span className="records-table-count">
          {leaderboardCount} records{userCount > 0 ? ` · ${userCount} yours` : ''}
        </span>
      </div>
      <div className="records-table-wrap">
        <table className="records-table-table">
          <thead>
            <tr>
              <th className="records-table-th records-table-th-rank" title="Leaderboard rank">#</th>
              {visibleChain.map((key, i) => {
                const { letter, inf } = METRIC_LETTERS[key] ?? { letter: key }
                return (
                  <th
                    key={key}
                    className={`records-table-th records-table-th-metric ${dragOverKey === key ? 'is-drop-target' : ''}`}
                    draggable
                    onDragStart={(e) => {
                      dragKeyRef.current = key
                      e.dataTransfer.setData('text/plain', key)
                      e.dataTransfer.effectAllowed = 'move'
                    }}
                    onDragOver={(e) => {
                      e.preventDefault()
                      e.dataTransfer.dropEffect = 'move'
                    }}
                    onDragEnter={() => setDragOverKey(key)}
                    onDrop={() => {
                      dropOn(key)
                      setDragOverKey(null)
                    }}
                    onDragEnd={() => {
                      dragKeyRef.current = null
                      setDragOverKey(null)
                    }}
                    title={`${METRIC_LABELS[key] ?? key} — drag to reorder sort priority`}
                  >
                    {i > 0 && <span className="records-table-chain-arrow" aria-hidden="true">›</span>}
                    <span className="records-table-letter">{letter}{inf && <span className="records-table-inf">∞</span>}</span>
                  </th>
                )
              })}
              {(['overlap', 'trackless'] as const).map((flag) => {
                const state = flag === 'overlap' ? flags.o : flags.t
                return (
                  <th
                    key={flag}
                    className={`records-table-th records-table-th-flag records-table-flag-${flag} ${state ? 'is-active' : ''}`}
                    onClick={() => cycleFlag(flag)}
                    title={FLAG_TITLES[flag]}
                  >
                    <span className="records-table-letter">{FLAG_LABELS[flag][0]}</span>
                    <span className="records-table-flag-glyph">{state ? FLAG_GLYPHS[state] : '−'}</span>
                  </th>
                )
              })}
              <th className="records-table-th records-table-th-cat" title="Solution categories">Category</th>
            </tr>
          </thead>
          <tbody>
            {table.getRowModel().rows.map((row) => {
              const rank = row.original.isUser ? null : ++leaderboardRank
              const clickable = !!row.original.gif
              const title = [
                row.original.smart ?? row.original.full,
                row.original.categories,
                clickable ? 'Click to view replay GIF' : null,
              ].filter(Boolean).join('\n')
              return (
                <tr
                  key={row.original.key}
                  className={[
                    'records-table-row',
                    row.original.isUser ? 'records-table-row-user' : '',
                    clickable ? 'records-table-row-clickable' : '',
                  ].filter(Boolean).join(' ')}
                  title={title || undefined}
                  onClick={clickable ? () => setGif(row.original) : undefined}
                >
                  <td className="records-table-td records-table-td-rank">
                    {row.original.isUser ? (
                      <span
                        className="records-table-user"
                        title={row.original.green ? 'On the Pareto frontier' : 'Dominated'}
                      >
                        <span
                          className="records-table-user-dot"
                          style={{ background: row.original.green ? USER_GREEN : USER_RED }}
                        />
                        <span className="records-table-user-name" title={row.original.name ?? undefined}>{row.original.name}</span>
                      </span>
                    ) : rank}
                  </td>
                  {visibleChain.map((key) => (
                    <td key={key} className="records-table-td records-table-td-num">
                      {metricCellText(row.original.score, key)}
                    </td>
                  ))}
                  {(['overlap', 'trackless'] as const).map((flag) => (
                    <td key={flag} className={`records-table-td records-table-td-flag records-table-flag-${flag}`}>
                      {row.original.score?.[flag] && (
                        <span
                          className="records-table-flag-dot"
                          style={{ background: CLASS_COLOR[flag] }}
                          title={FLAG_LABELS[flag]}
                        />
                      )}
                    </td>
                  ))}
                  <td className="records-table-td records-table-td-cat">{row.original.categories ?? ''}</td>
                </tr>
              )
            })}
            {rows.length === 0 && (
              <tr><td className="records-table-empty" colSpan={visibleChain.length + 4}>No records</td></tr>
            )}
          </tbody>
        </table>
      </div>
      {gif && (
        <GifViewer
          url={gif.gif!}
          title={gif.full ?? gif.smart ?? ''}
          solutionUrl={gif.solution}
          puzzleId={puzzleId}
          puzzleName={puzzleName}
          onClose={() => setGif(null)}
        />
      )}
    </div>
  )
}