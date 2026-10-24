import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
} from '@tanstack/react-table'
import type { ColumnDef, SortingFn, SortingState } from '@tanstack/react-table'
import { METRIC_LABELS } from '../../types'
import type { BoolScoreKey, OmRecordDTO, OmScoreDTO } from '../../types'
import { formatAreaINF, formatLevelValue, formatScoreNumber, getMetricValue, isInfinityScoreKey } from '../../lib/metrics'
import { FLAG_ORDER, FLAG_STATE_KEYS, activeFlagSorting, nextFlagState, parseFlags } from './flags'
import type { Flags, FlagState } from './flags'
import { getRecordsTableLayout } from './layout'
import { useRecordsNameWidth } from './useRecordsNameWidth'
import { loadSetting, saveSetting } from '../../lib/settings'
import { compareMetric } from '../../lib/manifold'
import { evaluateCategoryHolders, parseCategoryCached } from '../../lib/customCategories'
import type { CustomCategoryBadge } from '../../lib/customCategories'
import { useCustomCategories } from '../../state/useCustomCategories'
import { CLASS_COLOR, USER_GREEN, USER_RED } from '../pareto/constants'
import { makeDiamondShape } from '../pareto/shapes'
import type { PuzzleRecordsData } from '../../state/usePuzzleRecords'
import type { UserSolutionRecord } from '../../state/userSolutions'
import CategoryManager from './CategoryManager'
import './RecordsTable.css'

const GreenUserMarker = makeDiamondShape(USER_GREEN)
const RedUserMarker = makeDiamondShape(USER_RED)

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

// O defaults to false first. T and L default off, then cycle through true
// first, false first, and off. Only flag columns react to sort clicks.
const FLAG_GLYPHS: Record<Exclude<FlagState, null>, string> = { asc: '▴', desc: '▾' }
const FLAG_LABELS: Record<BoolScoreKey, string> = { overlap: 'Overlap', trackless: 'Trackless', looping: 'Looping' }
const FLAG_COLORS: Record<BoolScoreKey, string> = CLASS_COLOR
const FLAG_TITLES: Record<BoolScoreKey, string> = {
  overlap: 'Overlap — click to cycle sort: ▴ false first / ▾ true first / − off',
  trackless: 'Trackless — click to cycle sort: − off / ▾ true first / ▴ false first',
  looping: 'Looping — click to cycle sort: − off / ▾ true first / ▴ false first',
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
  customCategories: CustomCategoryBadge[]
  record: OmRecordDTO | null
  userRecord: UserSolutionRecord | null
}

type ChainMap = Record<TableMode, string[]>

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
      return parseFlags(saved)
    }
  } catch { }
  return parseFlags(null)
}

interface RecordsTableProps {
  shared: PuzzleRecordsData
  onPlayRecord: (record: OmRecordDTO) => void
  onPlayUserSolution: (record: UserSolutionRecord) => void
}

// @∞ metrics show the raw value plus the apostrophe-level suffix, not the
// graded numeric value used for charts. Every metric shows its full number,
// never an SI abbreviation (1728679, not 1.7M).
function metricCellText(score: OmScoreDTO | null, key: string): string {
  if (score === null) return '–'
  if (key === 'areaINF') return formatAreaINF(score) ?? '–'
  if (isInfinityScoreKey(key)) return formatLevelValue(score[key]) ?? '–'
  const v = getMetricValue(score, key)
  return v === null ? '–' : formatScoreNumber(v)
}

export default function RecordsTable({ shared, onPlayRecord, onPlayUserSolution }: RecordsTableProps) {
  const [mode, setMode] = useState<TableMode>(() => (loadSetting('om-table:mode', 'v') === 'inf' ? 'inf' : 'v'))
  const [chains, setChains] = useState<ChainMap>(loadChainMap)
  const [flags, setFlags] = useState<Flags>(loadFlags)
  // Written directly in onDragStart so dropOn sees the key even when the
  // drop arrives in the same tick (before a re-render could propagate it).
  const dragKeyRef = useRef<string | null>(null)
  const [dragOverKey, setDragOverKey] = useState<string | null>(null)
  const customState = useCustomCategories()
  // Non-null while the custom category manager popover is open; carries the
  // fixed-position anchor computed from the gear button's rect.
  const [managerPos, setManagerPos] = useState<{ top: number; right: number } | null>(null)
  const gearRef = useRef<HTMLButtonElement | null>(null)

  const chain = chains[mode]

  // @∞ requires sustained steady-state production, not the stricter Looping
  // condition. A non-Looping score with a rate still belongs here.
  const steadyStateOnly = mode === 'inf'

  // Metrics with no value anywhere on this puzzle's leaderboard are hidden.
  const availableKeys = useMemo(() => {
    const keys = new Set<string>()
    for (const key of MODE_CHAINS[mode]) {
      if (shared.records.some((r) =>
        r.score !== null && (!steadyStateOnly || r.score.rate != null) && getMetricValue(r.score, key) !== null)) {
        keys.add(key)
      }
    }
    return keys
  }, [shared.records, mode, steadyStateOnly])

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

  // Custom category holders are evaluated over the same domain the green/red
  // frontier uses — every leaderboard record plus every user solution for this
  // puzzle — independent of the table's mode filter. Keys mirror the row keys
  // below so badges can be attached while building rows.
  const customHolders = useMemo(() => {
    const byRow = new Map<string, CustomCategoryBadge[]>()
    const type = shared.puzzleType
    if (type === null || customState.categories.length === 0) return byRow
    const scores: OmScoreDTO[] = []
    const keys: string[] = []
    shared.records.forEach((r, i) => {
      if (r.score === null) return
      scores.push(r.score)
      keys.push(r.id ?? `lb-${i}`)
    })
    for (const r of shared.puzzleUserRecords) {
      scores.push(r.score)
      keys.push(`user-${r.id}`)
    }
    for (const def of customState.categories) {
      if (!def.enabled) continue
      const parsed = parseCategoryCached(def.expression)
      if (!parsed.ok) continue
      const holders = evaluateCategoryHolders(parsed.category, type, scores)
      const badge: CustomCategoryBadge = { id: def.id, name: def.name, expression: def.expression }
      for (const idx of holders) {
        const key = keys[idx]
        const list = byRow.get(key)
        if (list) list.push(badge)
        else byRow.set(key, [badge])
      }
    }
    return byRow
  }, [shared.records, shared.puzzleUserRecords, shared.puzzleType, customState.categories])

  const rows = useMemo<TableRow[]>(() => {
    const out: TableRow[] = []
    shared.records.forEach((r, i) => {
      if (r.score === null) return
      if (steadyStateOnly && r.score.rate == null) return
      const key = r.id ?? `lb-${i}`
      out.push({
        key,
        isUser: false,
        name: null,
        green: null,
        score: r.score,
        smart: r.smartFormattedScore,
        full: r.fullFormattedScore,
        categories: r.smartFormattedCategories,
        customCategories: customHolders.get(key) ?? [],
        record: r,
        userRecord: null,
      })
    })
    for (const r of shared.puzzleUserRecords) {
      if (steadyStateOnly && r.score.rate == null) continue
      const key = `user-${r.id}`
      out.push({
        key,
        isUser: true,
        name: r.solutionName ?? '(unnamed)',
        green: userGreen.has(r.id),
        score: r.score,
        smart: null,
        full: r.fullScore,
        categories: null,
        customCategories: customHolders.get(key) ?? [],
        record: null,
        userRecord: r,
      })
    }
    return out
  }, [shared.records, shared.puzzleUserRecords, userGreen, steadyStateOnly, customHolders])

  const leaderboardCount = useMemo(() => rows.filter((r) => !r.isUser).length, [rows])
  const userCount = useMemo(
    () => (steadyStateOnly
      ? shared.puzzleUserRecords.filter((r) => r.score.rate != null)
      : shared.puzzleUserRecords).length,
    [shared.puzzleUserRecords, steadyStateOnly],
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
    if (isInfinityScoreKey(columnId) && rowA.original.score && rowB.original.score) {
      return compareMetric(columnId, rowA.original.score, rowB.original.score)
    }
    const a = rowA.original.score ? getMetricValue(rowA.original.score, columnId) : null
    const b = rowB.original.score ? getMetricValue(rowB.original.score, columnId) : null
    if (a === null && b === null) return 0
    if (a === null) return 1
    if (b === null) return -1
    return a < b ? -1 : a > b ? 1 : 0
  }, [])
  const makeFlagSortingFn = useCallback((flag: BoolScoreKey): SortingFn<TableRow> => (rowA, rowB) => {
    const a = rowA.original.score?.[flag]
    const b = rowB.original.score?.[flag]
    if (a == null && b == null) return 0
    if (a == null) return 1
    if (b == null) return -1
    const desc = flagsRef.current[FLAG_STATE_KEYS[flag]] === 'desc'
    return desc ? Number(b) - Number(a) : Number(a) - Number(b)
  }, [])

  const columns = useMemo<ColumnDef<TableRow>[]>(() => [
    ...MODE_CHAINS[mode].map((key) => ({
      id: key,
      accessorFn: (row: TableRow) => (row.score ? getMetricValue(row.score, key) : null),
      sortingFn: metricSortingFn,
    })),
    ...FLAG_ORDER.map((flag) => ({
      id: flag,
      accessorFn: (row: TableRow) => row.score?.[flag],
      sortingFn: makeFlagSortingFn(flag),
    })),
  ], [mode, metricSortingFn, makeFlagSortingFn])

  // O, T and L, when active, are a fixed prefix in that order ahead of the
  // metric chain. Metrics are always ascending (best first); priority is
  // expressed by chain order, which is changed by dragging headers, never
  // by clicking them.
  const sorting = useMemo<SortingState>(() => {
    const state: SortingState = activeFlagSorting(flags)
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

  const cycleFlag = (flag: BoolScoreKey) => {
    setFlags((f) => {
      const key = FLAG_STATE_KEYS[flag]
      const updated = { ...f, [key]: nextFlagState(flag, f[key]) }
      try { localStorage.setItem('om-table:flags', JSON.stringify(updated)) } catch { }
      return updated
    })
  }

  // Anchored to the gear button with fixed positioning: the table wrap
  // scrolls and would clip an absolutely positioned child.
  const toggleManager = () => {
    if (managerPos !== null) {
      setManagerPos(null)
      return
    }
    const rect = gearRef.current?.getBoundingClientRect()
    setManagerPos({
      top: rect ? rect.bottom + 6 : 96,
      right: rect ? Math.max(8, window.innerWidth - rect.right) : 16,
    })
  }

  const sortParts = useMemo(() => {
    const parts: string[] = []
    for (const k of visibleChain) parts.push(METRIC_LABELS[k] ?? k)
    return parts
  }, [visibleChain])

  const userNames = useMemo(() => rows.filter((row) => row.isUser).map((row) => row.name ?? ''), [rows])
  const { tableRef, longestNameWidth } = useRecordsNameWidth(
    userNames, !shared.loading && !shared.error && shared.recordsReady,
  )
  const { minTableWidth, rankWidth } = getRecordsTableLayout(visibleChain.length, longestNameWidth)

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
        <div className="records-table-sizing" style={{ minWidth: minTableWidth }}>
          <table ref={tableRef} className="records-table-table" style={{ minWidth: minTableWidth }}>
            <thead>
              <tr>
                <th className="records-table-th records-table-th-rank" style={{ width: rankWidth }} title="Leaderboard rank">#</th>
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
                {FLAG_ORDER.map((flag) => {
                  const state = flags[FLAG_STATE_KEYS[flag]]
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
                <th className="records-table-th records-table-th-cat" title="Solution categories">
                  <span className="records-table-cat-head">
                    <span>Category</span>
                    <button
                      ref={gearRef}
                      type="button"
                      data-cat-toggle
                      className={`records-table-cat-gear${managerPos !== null ? ' is-open' : ''}`}
                      title="Custom categories"
                      aria-label="Custom categories"
                      onClick={toggleManager}
                    >
                      {'\u2699'}
                    </button>
                  </span>
                </th>
              </tr>
            </thead>
            <tbody>
              {table.getRowModel().rows.map((row) => {
                const rank = row.original.isUser ? null : ++leaderboardRank
                const UserMarker = row.original.green ? GreenUserMarker : RedUserMarker
                const record = row.original.record
                const userRecord = row.original.userRecord
                const play = userRecord
                  ? () => onPlayUserSolution(userRecord)
                  : record && (record.gif || record.solution) ? () => onPlayRecord(record) : undefined
                const customNames = row.original.customCategories.map((c) => c.name).join(', ')
                const title = [
                  row.original.smart ?? row.original.full,
                  row.original.categories,
                  customNames ? `Custom: ${customNames}` : null,
                  play ? 'Click to view solution replay' : null,
                ].filter(Boolean).join('\n')
                return (
                  <tr
                    key={row.original.key}
                    className={[
                      'records-table-row',
                      row.original.isUser ? 'records-table-row-user' : '',
                      play ? 'records-table-row-clickable' : '',
                    ].filter(Boolean).join(' ')}
                    title={title || undefined}
                    tabIndex={play ? 0 : undefined}
                    onClick={play}
                    onKeyDown={play ? (event) => {
                      if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); play() }
                    } : undefined}
                  >
                    <td className="records-table-td records-table-td-rank">
                      {row.original.isUser ? (
                        <span
                          className="records-table-user"
                          title={row.original.green ? 'On the Pareto frontier' : 'Dominated'}
                        >
                          <svg
                            className="records-table-user-marker"
                            width={12}
                            height={12}
                            viewBox="-6 -6 12 12"
                            aria-hidden="true"
                            focusable="false"
                          >
                            <UserMarker cx={0} cy={0} />
                          </svg>
                          <span className="records-table-user-name" title={row.original.name ?? undefined}>{row.original.name}</span>
                        </span>
                      ) : rank}
                    </td>
                    {visibleChain.map((key) => (
                      <td key={key} className="records-table-td records-table-td-num">
                        {metricCellText(row.original.score, key)}
                      </td>
                    ))}
                    {FLAG_ORDER.map((flag) => (
                      <td key={flag} className={`records-table-td records-table-td-flag records-table-flag-${flag}`}>
                        {row.original.score?.[flag] == null ? (
                          <span title={flag === 'looping' ? 'Looping unknown (legacy score or unfinished steady-state analysis)' : `${FLAG_LABELS[flag]} unavailable`}>–</span>
                        ) : row.original.score[flag] && (
                          <span
                            className="records-table-flag-dot"
                            style={{ background: FLAG_COLORS[flag] }}
                            title={FLAG_LABELS[flag]}
                          />
                        )}
                      </td>
                    ))}
                    <td className="records-table-td records-table-td-cat">
                      {row.original.categories ?? ''}
                      {row.original.customCategories.length > 0 && (
                        <span className="records-table-cat-chips">
                          {row.original.customCategories.map((badge) => (
                            <span
                              key={badge.id}
                              className="records-table-cat-chip"
                              title={`Custom category ${badge.name}\n${badge.expression}`}
                            >
                              {badge.name}
                            </span>
                          ))}
                        </span>
                      )}
                    </td>
                  </tr>
                )
              })}
              {rows.length === 0 && (
                <tr><td className="records-table-empty" colSpan={visibleChain.length + FLAG_ORDER.length + 2}>No records</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
      {managerPos !== null && (
        <CategoryManager
          position={managerPos}
          categories={customState.categories}
          addCategory={customState.addCategory}
          updateCategory={customState.updateCategory}
          removeCategory={customState.removeCategory}
          toggleCategory={customState.toggleCategory}
          onClose={() => setManagerPos(null)}
        />
      )}
    </div>
  )
}