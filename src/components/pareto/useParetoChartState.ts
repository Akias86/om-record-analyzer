import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ChangeEvent } from 'react'
import type { NumericScoreKey, BoolFilter, OmScoreDTO } from '../../types'
import { METRIC_LABELS } from '../../types'
import { matchesScoreFilters, parseBoolFilters } from '../../lib/scoreFilters'
import type { UserSolutionRecord } from '../../state/userSolutions'
import {
  getManifold,
  manifoldsForType,
  computeFrontierIndices,
  supportsScore,
  type Manifold,
  type MetricId,
} from '../../lib/manifold'
import { loadSetting, saveSetting } from '../../lib/settings'
import type { PuzzleRecordsData } from '../../state/usePuzzleRecords'
import {
  type ParetoPoint,
  type PointClass,
  type ZoomDomain,
} from './constants'
import { groupPointsByClass, computeParetoFrontier } from './points'
import { generateLogTicks, generateTicks } from './ticks'
import { getAvailableAxisMetrics, getAxisDomain, getAxisValue } from './axes'

interface ParetoChartState {
  loading: boolean
  error: string | null

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
  metricOptions: { key: NumericScoreKey; label: string }[]
  manifold: Manifold | undefined

  puzzleUserRecords: UserSolutionRecord[]
  userFrontierByManifold: Map<string, Set<string>>
  allPoints: ParetoPoint[]
  boundaryPoints: ParetoPoint[]
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
  handleZoom: (d: ZoomDomain) => void
  resetZoom: () => void

  getLabel: (key: string) => string
}

interface ParetoChartStateArgs {
  puzzleId: string
  shared: PuzzleRecordsData
}

export function useParetoChartState({
  puzzleId,
  shared,
}: ParetoChartStateArgs): ParetoChartState {
  const { records, metrics, loading, error, puzzleType, puzzleUserRecords, userFrontierByManifold } = shared
  const [xMetric, setXMetric] = useState<NumericScoreKey | ''>(() =>
    loadSetting('om-chart:xMetric', '') as NumericScoreKey | '')
  const [yMetric, setYMetric] = useState<NumericScoreKey | ''>(() =>
    loadSetting('om-chart:yMetric', '') as NumericScoreKey | '')
  const [boolFilters, setBoolFilters] = useState<BoolFilter>(() => {
    try { return parseBoolFilters(localStorage.getItem('om-chart:boolFilters')) }
    catch { return parseBoolFilters(null) }
  })
  const [xScale, setXScale] = useState<'linear' | 'log'>(() =>
    loadSetting('om-chart:xScale', 'linear') as 'linear' | 'log')
  const [yScale, setYScale] = useState<'linear' | 'log'>(() =>
    loadSetting('om-chart:yScale', 'linear') as 'linear' | 'log')
  const [zoomDomain, setZoomDomain] = useState<ZoomDomain | null>(null)
  const [manifoldId, setManifoldId] = useState<string>(() => loadSetting('om-chart:manifold', ''))

  const availableManifolds = useMemo(() => (puzzleType ? manifoldsForType(puzzleType) : []), [puzzleType])

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

  const availableMetrics = useMemo(() => getAvailableAxisMetrics(
    [...records.map((r) => r.score), ...puzzleUserRecords.map((r) => r.score)],
    manifold,
  ), [records, puzzleUserRecords, manifold])

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
      const x = getAxisValue(r.score, xMetric, xScale)
      const y = getAxisValue(r.score, yMetric, yScale)
      if (x === null || y === null) return
      if (!matchesScoreFilters(r.score, boolFilters)) return
      points.push({
        x,
        y,
        id: r.id ?? `${x}-${y}`,
        score: r.smartFormattedScore,
        categories: r.smartFormattedCategories,
        recordIndex: i,
        overlap: !!r.score.overlap,
        trackless: !!r.score.trackless,
        looping: r.score.looping === true,
        canPlay: !!(r.gif || r.solution),
      })
    })
    return points
  }, [records, xMetric, yMetric, xScale, yScale, boolFilters, manifold, frontierRecordIndices])

  const userPoints = useMemo<ParetoPoint[]>(() => {
    if (!xMetric || !yMetric || !puzzleType || puzzleUserRecords.length === 0) return []
    const points: ParetoPoint[] = []
    for (const r of puzzleUserRecords) {
      if (manifold && !supportsScore(manifold, r.score)) continue
      const x = getAxisValue(r.score, xMetric, xScale)
      const y = getAxisValue(r.score, yMetric, yScale)
      if (x === null || y === null) continue
      if (!matchesScoreFilters(r.score, boolFilters)) continue
      const green = manifold
        ? (userFrontierByManifold.get(manifold.id)?.has(r.id) ?? false)
        : anyManifoldGreen.has(r.id)
      points.push({
        x,
        y,
        id: `user-${r.id}`,
        score: null,
        categories: null,
        overlap: !!r.score.overlap,
        trackless: !!r.score.trackless,
        looping: r.score.looping === true,
        isUser: true,
        userRecordId: r.id,
        canPlay: true,
        name: r.solutionName,
        fullScore: r.fullScore,
        green,
      })
    }
    return points
  }, [puzzleUserRecords, puzzleType, xMetric, yMetric, xScale, yScale, boolFilters, manifold, userFrontierByManifold, anyManifoldGreen])

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

  const chartAxes = useMemo(() => {
    const points = [...allPoints, ...userPoints]
    return {
      x: getAxisDomain(points.map((p) => p.x), xScale),
      y: getAxisDomain(points.map((p) => p.y), yScale),
    }
  }, [allPoints, userPoints, xScale, yScale])

  const defaultDomain = useMemo(() => {
    const { x, y } = chartAxes
    return x && y ? { x: x.domain, y: y.domain, xTicks: x.ticks, yTicks: y.ticks } : null
  }, [chartAxes])

  const xDomain = zoomDomain?.x ?? defaultDomain?.x
  const yDomain = zoomDomain?.y ?? defaultDomain?.y
  const isZoomed = zoomDomain !== null

  const xTicks = zoomDomain
    ? (xScale === 'log' ? generateLogTicks(zoomDomain.x) : generateTicks(zoomDomain.x, chartAxes.x?.isInteger ?? true))
    : defaultDomain?.xTicks
  const yTicks = zoomDomain
    ? (yScale === 'log' ? generateLogTicks(zoomDomain.y) : generateTicks(zoomDomain.y, chartAxes.y?.isInteger ?? true))
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

  const frontierByClass = useMemo(() => groupPointsByClass(visiblePareto), [visiblePareto])
  const nonFrontierByClass = useMemo(() => groupPointsByClass(visibleNonPareto), [visibleNonPareto])

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
    metricOptions,
    manifold,
    puzzleUserRecords,
    userFrontierByManifold,
    allPoints,
    boundaryPoints,
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
    handleZoom,
    resetZoom,
    getLabel,
  }
}
