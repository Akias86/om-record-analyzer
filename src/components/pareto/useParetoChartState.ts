import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ChangeEvent } from 'react'
import { fetchRecords, fetchMetrics } from '../../api/om'
import type { OmRecordDTO, OmMetricDTO, OmScoreDTO, NumericScoreKey, BoolFilter } from '../../types'
import { NUMERIC_SCORE_KEYS, BOOL_SCORE_KEYS, METRIC_LABELS } from '../../types'
import {
  getManifold,
  manifoldsForType,
  computeFrontierIndices,
  supportsScore,
  type Manifold,
  type OmType,
  type MetricId,
} from '../../lib/manifold'
import { computeUserFrontierByManifold } from '../../lib/userFrontier'
import type { UserSolutionRecord } from '../../state/userSolutions'
import { loadSetting, saveSetting } from '../../lib/settings'
import {
  CLASS_ORDER,
  type ParetoPoint,
  type PointClass,
  type ZoomDomain,
} from './constants'
import { classifyPoint, computeParetoFrontier, getMetricValue } from './points'
import { generateLogTicks, generateTicks, niceLinearDomain, niceLogDomain } from './ticks'

export interface ParetoChartState {
  loading: boolean
  error: string | null
  metricLabels: Map<string, string>

  manifoldId: string
  setManifoldIdFromEvent: (e: ChangeEvent<HTMLSelectElement>) => void
  selectManifold: (id: string) => void

  xMetric: NumericScoreKey | ''
  setXMetricFromEvent: (e: ChangeEvent<HTMLSelectElement>) => void
  yMetric: NumericScoreKey | ''
  setYMetricFromEvent: (e: ChangeEvent<HTMLSelectElement>) => void

  xScale: 'linear' | 'log'
  yScale: 'linear' | 'log'
  setXScale: (v: 'linear' | 'log') => void
  setYScale: (v: 'linear' | 'log') => void

  boolFilters: BoolFilter
  setBoolFilter: (key: string, value: string) => void

  availableManifolds: Manifold[]
  availableMetrics: NumericScoreKey[]
  metricOptions: { key: NumericScoreKey; label: string }[]
  manifold: Manifold | undefined

  puzzleUserRecords: UserSolutionRecord[]
  userFrontierByManifold: Map<string, Set<string>>
  allPoints: ParetoPoint[]
  boundaryPoints: ParetoPoint[]
  paretoPoints: ParetoPoint[]
  nonParetoPoints: ParetoPoint[]
  userPoints: ParetoPoint[]
  userGreenPoints: ParetoPoint[]
  userRedPoints: ParetoPoint[]
  frontierByClass: Record<PointClass, ParetoPoint[]>
  nonFrontierByClass: Record<PointClass, ParetoPoint[]>
  pointMap: Map<string, ParetoPoint[]>

  defaultDomain: { x: [number, number]; y: [number, number]; xTicks?: number[]; yTicks?: number[] } | null
  xDomain: [number, number] | undefined
  yDomain: [number, number] | undefined
  xTicks: number[] | undefined
  yTicks: number[] | undefined
  isZoomed: boolean
  zoomDomain: ZoomDomain | null
  handleZoom: (d: ZoomDomain) => void
  resetZoom: () => void

  getLabel: (key: string) => string
}

interface ParetoChartStateArgs {
  puzzleId: string
  userRecords: UserSolutionRecord[]
  refreshFrontierForPuzzle: (puzzleId: string, leaderboard: OmRecordDTO[]) => void
}

export function useParetoChartState({
  puzzleId,
  userRecords,
  refreshFrontierForPuzzle,
}: ParetoChartStateArgs): ParetoChartState {
  const [records, setRecords] = useState<OmRecordDTO[]>([])
  // Which puzzle the `records` state belongs to. Stays `null` until the
  // first successful fetch lands, and is updated together with `records`.
  // Used to guard the frontier-refresh effect so navigating from puzzle A
  // to B doesn't momentarily recompute B's slice against A's stale records
  // (which are still in state until B's fetch resolves) — that race caused
  // the sidebar list to flicker (records wrongly appearing/disappearing)
  // before the correct data arrived.
  const [recordsPuzzleId, setRecordsPuzzleId] = useState<string | null>(null)
  const [metrics, setMetrics] = useState<OmMetricDTO[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [xMetric, setXMetric] = useState<NumericScoreKey | ''>(() =>
    loadSetting('om-chart:xMetric', '') as NumericScoreKey | '')
  const [yMetric, setYMetric] = useState<NumericScoreKey | ''>(() =>
    loadSetting('om-chart:yMetric', '') as NumericScoreKey | '')
  const [boolFilters, setBoolFilters] = useState<BoolFilter>(() => {
    try {
      const saved = localStorage.getItem('om-chart:boolFilters')
      if (saved) return JSON.parse(saved) as BoolFilter
    } catch { }
    return { overlap: 'any', trackless: 'any' }
  })
  const [xScale, setXScale] = useState<'linear' | 'log'>(() =>
    loadSetting('om-chart:xScale', 'linear') as 'linear' | 'log')
  const [yScale, setYScale] = useState<'linear' | 'log'>(() =>
    loadSetting('om-chart:yScale', 'linear') as 'linear' | 'log')
  const [zoomDomain, setZoomDomain] = useState<ZoomDomain | null>(null)
  const [manifoldId, setManifoldId] = useState<string>(() => loadSetting('om-chart:manifold', ''))

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    Promise.all([fetchRecords(puzzleId, { useCache: false }), fetchMetrics()])
      .then(([recs, mets]) => {
        if (cancelled) return
        setRecords(recs)
        setRecordsPuzzleId(puzzleId)
        setMetrics(mets)
        setLoading(false)
      })
      .catch((err) => {
        if (cancelled) return
        setError(String(err))
        setLoading(false)
      })
    return () => { cancelled = true }
  }, [puzzleId])

  // The chart fetches the leaderboard with `useCache: false` (bypass), so
  // it has the freshest data. Feed it back to the context so the sidebar
  // frontier list reflects this puzzle's frontier computed against the
  // latest leaderboard rather than the cached snapshot from upload time.
  // The `recordsPuzzleId === puzzleId` guard is essential: without it,
  // navigating from A to B recomputes B's slice against A's records (still
  // in state until B's fetch resolves), corrupting the sidebar list.
  useEffect(() => {
    if (records.length === 0) return
    if (recordsPuzzleId !== puzzleId) return
    refreshFrontierForPuzzle(puzzleId, records)
  }, [puzzleId, records, recordsPuzzleId, refreshFrontierForPuzzle])

  const puzzleType = useMemo<OmType | null>(() => {
    const t = records[0]?.puzzle.type
    return t === 'NORMAL' || t === 'POLYMER_HEIGHT' || t === 'POLYMER_WIDTH' || t === 'POLYMER_SKEW' || t === 'PRODUCTION' ? t : null
  }, [records])

  const availableManifolds = useMemo(() => (puzzleType ? manifoldsForType(puzzleType) : []), [puzzleType])

  const puzzleUserRecords = useMemo(
    () => (puzzleType ? userRecords.filter((r) => r.puzzleType === puzzleType) : []),
    [userRecords, puzzleType],
  )

  const userFrontierByManifold = useMemo<Map<string, Set<string>>>(() => {
    if (!puzzleType || puzzleUserRecords.length === 0) return new Map()
    const leaderboardScores: OmScoreDTO[] = []
    for (const r of records) {
      if (r.score !== null) leaderboardScores.push(r.score)
    }
    const userItems = puzzleUserRecords.map((r) => ({ id: r.id, puzzleId: r.puzzleId, score: r.score }))
    return computeUserFrontierByManifold(puzzleType, leaderboardScores, userItems)
  }, [puzzleType, puzzleUserRecords, records])

  const anyManifoldGreen = useMemo<Set<string>>(() => {
    const set = new Set<string>()
    for (const ids of userFrontierByManifold.values()) {
      for (const id of ids) set.add(id)
    }
    return set
  }, [userFrontierByManifold])

  const manifold = useMemo<Manifold | undefined>(() => {
    if (!manifoldId || !puzzleType) return undefined
    const m = getManifold(manifoldId)
    return m && m.supportedTypes.includes(puzzleType) ? m : undefined
  }, [manifoldId, puzzleType])

  useEffect(() => {
    if (manifoldId && puzzleType && !availableManifolds.some((m) => m.id === manifoldId)) {
      setManifoldId('')
      saveSetting('om-chart:manifold', '')
    }
  }, [manifoldId, puzzleType, availableManifolds])

  useEffect(() => {
    if (!manifold) return
    const allowed = new Set<MetricId>(manifold.scoreParts)
    if (xMetric && !allowed.has(xMetric as MetricId)) {
      setXMetric('')
      saveSetting('om-chart:xMetric', '')
    }
    if (yMetric && !allowed.has(yMetric as MetricId)) {
      setYMetric('')
      saveSetting('om-chart:yMetric', '')
    }
  }, [manifold, xMetric, yMetric])

  const availableMetrics = useMemo(() => {
    if (records.length === 0) return []
    const allowed = manifold ? new Set<MetricId>(manifold.scoreParts) : null
    const numericKeys: NumericScoreKey[] = []
    for (const key of NUMERIC_SCORE_KEYS) {
      if (allowed != null && !allowed.has(key as MetricId)) continue
      if (records.some((r) => r.score !== null && getMetricValue(r.score, key) !== null)) {
        numericKeys.push(key)
      }
    }
    return numericKeys
  }, [records, manifold])

  const frontierRecordIndices = useMemo<Set<number> | null>(() => {
    if (!manifold) return null
    const idxMap: number[] = []
    const dense: OmScoreDTO[] = []
    records.forEach((r, i) => {
      if (r.score !== null) {
        dense.push(r.score)
        idxMap.push(i)
      }
    })
    const frontierDense = computeFrontierIndices(manifold, dense)
    return new Set(frontierDense.map((d) => idxMap[d]))
  }, [records, manifold])

  const allPoints = useMemo(() => {
    if (!xMetric || !yMetric) return []
    const points: ParetoPoint[] = []
    records.forEach((r, i) => {
      if (r.score === null) return
      if (manifold && !supportsScore(manifold, r.score)) return
      if (manifold && frontierRecordIndices && !frontierRecordIndices.has(i)) return
      const x = getMetricValue(r.score, xMetric)
      const y = getMetricValue(r.score, yMetric)
      if (x === null || y === null) return
      let skip = false
      for (const key of BOOL_SCORE_KEYS) {
        const f = boolFilters[key]
        if (f !== 'any' && r.score[key] !== (f === 'true')) {
          skip = true
          break
        }
      }
      if (skip) return
      points.push({ x, y, id: r.id ?? `${x}-${y}`, score: r.smartFormattedScore, categories: r.smartFormattedCategories, recordIndex: i, overlap: !!r.score.overlap, trackless: !!r.score.trackless })
    })
    return points
  }, [records, xMetric, yMetric, boolFilters, manifold, frontierRecordIndices])

  const userPoints = useMemo<ParetoPoint[]>(() => {
    if (!xMetric || !yMetric || !puzzleType || puzzleUserRecords.length === 0) return []
    const points: ParetoPoint[] = []
    for (const r of puzzleUserRecords) {
      if (manifold && !supportsScore(manifold, r.score)) continue
      const x = getMetricValue(r.score, xMetric)
      const y = getMetricValue(r.score, yMetric)
      if (x === null || y === null) continue
      let skip = false
      for (const key of BOOL_SCORE_KEYS) {
        const f = boolFilters[key]
        if (f !== 'any' && r.score[key] !== (f === 'true')) {
          skip = true
          break
        }
      }
      if (skip) continue
      const green = manifold
        ? (userFrontierByManifold.get(manifold.id)?.has(r.id) ?? false)
        : anyManifoldGreen.has(r.id)
      points.push({
        x,
        y,
        id: `user-${r.id}`,
        score: null,
        categories: null,
        recordIndex: -1,
        overlap: !!r.score.overlap,
        trackless: !!r.score.trackless,
        isUser: true,
        name: r.solutionName,
        fullScore: r.fullScore,
        green,
      })
    }
    return points
  }, [puzzleUserRecords, puzzleType, xMetric, yMetric, boolFilters, manifold, userFrontierByManifold, anyManifoldGreen])

  const boundaryPoints = useMemo(() => (manifold ? computeParetoFrontier(allPoints) : []), [allPoints, manifold])
  const boundaryIdSet = useMemo(() => new Set(boundaryPoints.map((p) => p.id)), [boundaryPoints])
  const paretoPoints = useMemo(() => allPoints.filter((p) => boundaryIdSet.has(p.id)), [allPoints, boundaryIdSet])
  const nonParetoPoints = useMemo(() => allPoints.filter((p) => !boundaryIdSet.has(p.id)), [allPoints, boundaryIdSet])

  const pointMap = useMemo(() => {
    const map = new Map<string, ParetoPoint[]>()
    for (const p of allPoints) {
      const key = `${p.x}|${p.y}`
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(p)
    }
    for (const p of userPoints) {
      const key = `${p.x}|${p.y}`
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(p)
    }
    return map
  }, [allPoints, userPoints])

  const defaultDomain = useMemo(() => {
    if (allPoints.length === 0 && userPoints.length === 0) return null
    let xMin = Infinity, xMax = -Infinity, yMin = Infinity, yMax = -Infinity
    for (const p of allPoints) {
      if (p.x < xMin) xMin = p.x
      if (p.x > xMax) xMax = p.x
      if (p.y < yMin) yMin = p.y
      if (p.y > yMax) yMax = p.y
    }
    for (const p of userPoints) {
      if (p.x < xMin) xMin = p.x
      if (p.x > xMax) xMax = p.x
      if (p.y < yMin) yMin = p.y
      if (p.y > yMax) yMax = p.y
    }
    const xIsInt = xMetric !== 'width'
    const yIsInt = yMetric !== 'width'
    const xLo = xScale === 'log' ? Math.max(1, xMin) : 0
    const yLo = yScale === 'log' ? Math.max(1, yMin) : 0
    const xRes = xScale === 'log' ? niceLogDomain(xMax, xLo) : niceLinearDomain(xMax, xIsInt)
    const yRes = yScale === 'log' ? niceLogDomain(yMax, yLo) : niceLinearDomain(yMax, yIsInt)
    const xTicks = xScale === 'log' ? (xRes.ticks.length > 0 ? xRes.ticks : undefined) : (xRes.ticks.length > 1 ? xRes.ticks : undefined)
    const yTicks = yScale === 'log' ? (yRes.ticks.length > 0 ? yRes.ticks : undefined) : (yRes.ticks.length > 1 ? yRes.ticks : undefined)
    return { x: [xLo, xRes.hi] as [number, number], y: [yLo, yRes.hi] as [number, number], xTicks, yTicks }
  }, [allPoints, userPoints, xScale, yScale, xMetric, yMetric])

  const xDomain = zoomDomain?.x ?? defaultDomain?.x
  const yDomain = zoomDomain?.y ?? defaultDomain?.y
  const isZoomed = zoomDomain !== null

  const xIsInteger = xMetric !== 'width'
  const yIsInteger = yMetric !== 'width'
  const xTicks = zoomDomain
    ? (xScale === 'log' ? generateLogTicks(zoomDomain.x) : generateTicks(zoomDomain.x, xIsInteger))
    : defaultDomain?.xTicks
  const yTicks = zoomDomain
    ? (yScale === 'log' ? generateLogTicks(zoomDomain.y) : generateTicks(zoomDomain.y, yIsInteger))
    : defaultDomain?.yTicks

  const visibleNonPareto = useMemo(
    () => (zoomDomain ? nonParetoPoints.filter((p) => p.x >= zoomDomain.x[0] && p.x <= zoomDomain.x[1] && p.y >= zoomDomain.y[0] && p.y <= zoomDomain.y[1]) : nonParetoPoints),
    [nonParetoPoints, zoomDomain],
  )
  const visiblePareto = useMemo(
    () => (zoomDomain ? paretoPoints.filter((p) => p.x >= zoomDomain.x[0] && p.x <= zoomDomain.x[1] && p.y >= zoomDomain.y[0] && p.y <= zoomDomain.y[1]) : paretoPoints),
    [paretoPoints, zoomDomain],
  )

  const visibleUserPoints = useMemo(
    () => (zoomDomain ? userPoints.filter((p) => p.x >= zoomDomain.x[0] && p.x <= zoomDomain.x[1] && p.y >= zoomDomain.y[0] && p.y <= zoomDomain.y[1]) : userPoints),
    [userPoints, zoomDomain],
  )

  const userGreenPoints = useMemo(() => visibleUserPoints.filter((p) => p.green), [visibleUserPoints])
  const userRedPoints = useMemo(() => visibleUserPoints.filter((p) => !p.green), [visibleUserPoints])

  const frontierByClass = useMemo(() => {
    const map: Record<PointClass, ParetoPoint[]> = { overlap: [], trackless: [], normal: [] }
    for (const p of visiblePareto) map[classifyPoint(p)].push(p)
    return map
  }, [visiblePareto])

  const nonFrontierByClass = useMemo(() => {
    const map: Record<PointClass, ParetoPoint[]> = { overlap: [], trackless: [], normal: [] }
    for (const p of visibleNonPareto) map[classifyPoint(p)].push(p)
    return map
  }, [visibleNonPareto])

  const resetZoom = useCallback(() => setZoomDomain(null), [])
  const handleZoom = useCallback((d: ZoomDomain) => setZoomDomain(d), [])

  useEffect(() => {
    setZoomDomain(null)
  }, [puzzleId, xMetric, yMetric, xScale, yScale, boolFilters, manifoldId])

  const setXMetricFromEvent = useCallback((e: ChangeEvent<HTMLSelectElement>) => {
    const val = e.target.value as NumericScoreKey | ''
    setXMetric(val)
    saveSetting('om-chart:xMetric', val)
  }, [])

  const setYMetricFromEvent = useCallback((e: ChangeEvent<HTMLSelectElement>) => {
    const val = e.target.value as NumericScoreKey | ''
    setYMetric(val)
    saveSetting('om-chart:yMetric', val)
  }, [])

  const setBoolFilter = useCallback((key: string, value: string) => {
    const newFilters = { ...boolFilters, [key]: value as 'any' | 'true' | 'false' }
    setBoolFilters(newFilters)
    try { localStorage.setItem('om-chart:boolFilters', JSON.stringify(newFilters)) } catch { }
  }, [boolFilters])

  const setXScalePersisted = useCallback((v: 'linear' | 'log') => {
    setXScale(v)
    saveSetting('om-chart:xScale', v)
  }, [])

  const setYScalePersisted = useCallback((v: 'linear' | 'log') => {
    setYScale(v)
    saveSetting('om-chart:yScale', v)
  }, [])

  const setManifoldIdFromEvent = useCallback((e: ChangeEvent<HTMLSelectElement>) => {
    const val = e.target.value
    setManifoldId(val)
    saveSetting('om-chart:manifold', val)
  }, [])

  const selectManifold = useCallback((id: string) => {
    setManifoldId(id)
    saveSetting('om-chart:manifold', id)
  }, [])

  const metricLabels = useMemo(() => {
    const map = new Map<string, string>()
    for (const m of metrics) map.set(m.id, m.displayName)
    return map
  }, [metrics])

  const getLabel = useCallback((key: string) => METRIC_LABELS[key] ?? metricLabels.get(key) ?? key, [metricLabels])

  const metricOptions = useMemo(
    () => availableMetrics.map((key) => ({ key, label: getLabel(key) })),
    [availableMetrics, getLabel],
  )

  return {
    loading,
    error,
    metricLabels,
    manifoldId,
    setManifoldIdFromEvent,
    selectManifold,
    xMetric,
    setXMetricFromEvent,
    yMetric,
    setYMetricFromEvent,
    xScale,
    yScale,
    setXScale: setXScalePersisted,
    setYScale: setYScalePersisted,
    boolFilters,
    setBoolFilter,
    availableManifolds,
    availableMetrics,
    metricOptions,
    manifold,
    puzzleUserRecords,
    userFrontierByManifold,
    allPoints,
    boundaryPoints,
    paretoPoints,
    nonParetoPoints,
    userPoints,
    userGreenPoints,
    userRedPoints,
    frontierByClass,
    nonFrontierByClass,
    pointMap,
    defaultDomain,
    xDomain,
    yDomain,
    xTicks,
    yTicks,
    isZoomed,
    zoomDomain,
    handleZoom,
    resetZoom,
    getLabel,
  }
}

// Re-export CLASS_ORDER so the main component's JSX can iterate without
// needing a second import.
export { CLASS_ORDER }