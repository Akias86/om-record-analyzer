import { useState, useEffect, useCallback, useMemo } from 'react'
import { Theme } from '@astryxdesign/core/theme'
import { AppShell } from '@astryxdesign/core/AppShell'
import { Badge } from '@astryxdesign/core/Badge'
import { Banner } from '@astryxdesign/core/Banner'
import { Button } from '@astryxdesign/core/Button'
import { EmptyState } from '@astryxdesign/core/EmptyState'
import { Heading } from '@astryxdesign/core/Heading'
import { HStack } from '@astryxdesign/core/HStack'
import { TabList, Tab } from '@astryxdesign/core/TabList'
import { Text } from '@astryxdesign/core/Text'
import { VStack } from '@astryxdesign/core/VStack'
import { FlaskConical, ScatterChart as ScatterChartIcon, ShieldCheck, Table2 } from 'lucide-react'
import { analyzerTheme } from './themes'
import { ThemeModeContext } from './state/themeMode'
import type { ThemeMode } from './state/themeMode'
import { ThemeModeSwitch } from './components/ThemeModeSwitch'
import Sidebar from './components/Sidebar'
import ParetoChart from './components/ParetoChart'
import RecordsTable from './components/records/RecordsTable'
import TestPage from './test/TestPage'
import { fetchPuzzleDetail } from './api/om'
import type { OmPuzzleDetail } from './api/om'
import { UserSolutionsProvider, useUserSolutions } from './state/userSolutions'
import type { UserSolutionRecord } from './state/userSolutions'
import { usePuzzleRecords } from './state/usePuzzleRecords'
import { loadSetting, saveSetting } from './lib/settings'
import { findPlaybackRecord, findUserPlaybackRecord, parseHash, puzzleHash, recordPlaybackTarget } from './lib/routes'
import type { PlaybackTarget, Route } from './lib/routes'
import type { OmRecordDTO } from './types'
import { GifViewer } from './components/pareto/GifViewer'
import './App.css'

function loadInitialThemeMode(): ThemeMode {
  const saved = loadSetting('om-app:themeMode', 'system')
  return saved === 'light' || saved === 'dark' ? saved : 'system'
}

function puzzleTypeBadgeVariant(type: string | undefined): 'blue' | 'purple' | 'teal' | 'neutral' {
  if (type === 'PRODUCTION') return 'purple'
  if (type === 'POLYMER') return 'teal'
  if (type === 'NORMAL') return 'blue'
  return 'neutral'
}

function App() {
  const [route, setRoute] = useState<Route>(() => parseHash(window.location.hash))
  const [themeMode, setThemeModeState] = useState<ThemeMode>(loadInitialThemeMode)

  const setThemeMode = useCallback((next: ThemeMode) => {
    setThemeModeState(next)
    saveSetting('om-app:themeMode', next)
  }, [])

  const themeContextValue = useMemo(
    () => ({ mode: themeMode, setMode: setThemeMode }),
    [themeMode, setThemeMode],
  )

  useEffect(() => {
    const onChange = () => setRoute(parseHash(window.location.hash))
    window.addEventListener('hashchange', onChange)
    return () => window.removeEventListener('hashchange', onChange)
  }, [])

  const navigatePuzzle = useCallback((id: string | null) => {
    if (id) {
      window.location.hash = puzzleHash(id)
    } else if (window.location.hash) {
      history.replaceState(null, '', window.location.pathname + window.location.search)
      setRoute(parseHash(''))
    }
  }, [])

  const playRecord = useCallback((record: OmRecordDTO) => {
    const target = recordPlaybackTarget(record)
    if (target) window.location.hash = puzzleHash(record.puzzle.id, target)
  }, [])

  const playUserSolution = useCallback((record: UserSolutionRecord) => {
    window.location.hash = puzzleHash(record.puzzleId, { kind: 'user', value: record.id })
  }, [])

  const closePlayback = useCallback(() => {
    const current = parseHash(window.location.hash)
    if (!current.puzzleId || !current.playback) return
    // Closing a directly opened link must not navigate away from the app.
    history.replaceState(null, '', puzzleHash(current.puzzleId))
    setRoute(parseHash(window.location.hash))
  }, [])

  return (
    <Theme theme={analyzerTheme} mode={themeMode}>
      <ThemeModeContext.Provider value={themeContextValue}>
        {route.validator ? (
          <TestPage />
        ) : (
          <UserSolutionsProvider>
            <MainApp
              puzzleId={route.puzzleId}
              playback={route.playback}
              onSelectPuzzle={navigatePuzzle}
              onPlayRecord={playRecord}
              onPlayUserSolution={playUserSolution}
              onClosePlayback={closePlayback}
            />
          </UserSolutionsProvider>
        )}
      </ThemeModeContext.Provider>
    </Theme>
  )
}

type MainView = 'table' | 'chart'

interface PlaybackView {
  url: string | null
  title: string
  solutionUrl: string | null
  solutionKey?: string
  fileName?: string
  puzzleId: string
  puzzleName: string
}

interface MainAppProps {
  puzzleId: string | null
  playback: PlaybackTarget | null
  onSelectPuzzle: (id: string | null) => void
  onPlayRecord: (record: OmRecordDTO) => void
  onPlayUserSolution: (record: UserSolutionRecord) => void
  onClosePlayback: () => void
}

function MainApp({ puzzleId, playback, onSelectPuzzle, onPlayRecord, onPlayUserSolution, onClosePlayback }: MainAppProps) {
  const [detail, setDetail] = useState<OmPuzzleDetail | null>(null)
  const [expandCollectionId, setExpandCollectionId] = useState<string | null>(null)
  const [expandGroupId, setExpandGroupId] = useState<string | null>(null)
  // Remember the last tab across puzzle changes and reloads. The shared
  // fetch lives here so switching tabs doesn't refetch.
  const [view, setView] = useState<MainView>(() =>
    loadSetting('om-app:view', 'table') === 'chart' ? 'chart' : 'table')
  const shared = usePuzzleRecords(puzzleId)
  const { records: userRecords } = useUserSolutions()
  const playbackReady = playback?.kind === 'user' || (shared.recordsReady && !shared.loading && !shared.error)
  const playingRecord = playbackReady && puzzleId && playback
    ? findPlaybackRecord(shared.records, puzzleId, playback) : undefined
  const playingUser = puzzleId && playback ? findUserPlaybackRecord(userRecords, puzzleId, playback) : undefined
  const playbackOpen = !!(playingUser?.solutionKey || playingRecord?.gif || playingRecord?.solution)
  const activePlayback = useMemo<PlaybackView | null>(() => {
    if (playingUser?.solutionKey) {
      return {
        url: null,
        title: playingUser.solutionName ?? playingUser.fileName ?? '(unnamed)',
        solutionUrl: null,
        solutionKey: playingUser.solutionKey,
        fileName: playingUser.fileName,
        puzzleId: playingUser.puzzleId,
        puzzleName: detail?.id === playingUser.puzzleId ? detail.displayName : playingUser.puzzleId,
      }
    }
    if (playingRecord && (playingRecord.gif || playingRecord.solution)) {
      return {
        url: playingRecord.gif,
        title: playingRecord.fullFormattedScore ?? playingRecord.smartFormattedScore ?? '',
        solutionUrl: playingRecord.solution,
        puzzleId: playingRecord.puzzle.id,
        puzzleName: playingRecord.puzzle.displayName,
      }
    }
    return null
  }, [detail, playingRecord, playingUser])
  // Keep the player mounted across close/reopen so its WebGPU context, atlas
  // and WASM instance survive. The route only controls visibility.
  const [lastPlayback, setLastPlayback] = useState<PlaybackView | null>(null)
  useEffect(() => {
    if (activePlayback) setLastPlayback(activePlayback)
  }, [activePlayback])
  const playbackView = activePlayback ?? lastPlayback

  useEffect(() => {
    saveSetting('om-app:view', view)
  }, [view])

  useEffect(() => {
    if (!puzzleId) {
      setDetail(null)
      setExpandCollectionId(null)
      setExpandGroupId(null)
      return
    }
    let cancelled = false
    setDetail(null)
    fetchPuzzleDetail(puzzleId)
      .then((d) => {
        if (cancelled) return
        setDetail(d)
        setExpandCollectionId(d.group.collection.id)
        setExpandGroupId(d.group.id)
      })
      .catch(() => setDetail(null))
    return () => { cancelled = true }
  }, [puzzleId])

  const title = detail?.displayName ?? puzzleId ?? ''
  const puzzleType = detail?.type ?? shared.puzzleType ?? undefined

  return (
    <>
      <AppShell
        height="fill"
        variant="surface"
        contentPadding={0}
        sideNav={
          <Sidebar
            selectedPuzzleId={puzzleId}
            onSelectPuzzle={onSelectPuzzle}
            expandCollectionId={expandCollectionId}
            expandGroupId={expandGroupId}
          />
        }
      >
        {puzzleId ? (
          <div className="app-content">
            <header className="app-page-header">
              <div className="app-page-header-top">
                <VStack gap={0.5} className="app-title-stack">
                  {detail && (
                    <Text type="supporting" maxLines={1}>
                      {detail.group.collection.displayName} · {detail.group.displayName}
                    </Text>
                  )}
                  <HStack gap={2} vAlign="center" wrap="wrap">
                    <Heading level={1}>{title}</Heading>
                    {puzzleType && (
                      <Badge variant={puzzleTypeBadgeVariant(puzzleType)} label={puzzleType} />
                    )}
                    <Badge variant="neutral" label={puzzleId} />
                  </HStack>
                </VStack>
                <HStack gap={2} vAlign="center" className="app-header-actions">
                  <Button
                    variant="secondary"
                    size="sm"
                    href="#/validator"
                    icon={<ShieldCheck size={14} />}
                    label="Validator"
                  />
                  <ThemeModeSwitch />
                </HStack>
              </div>
              <div className="app-view-tabs">
                <TabList
                  value={view}
                  onChange={(next) => setView(next as MainView)}
                  size="md"
                  hasDivider
                >
                  <Tab value="table" label="Records" icon={<Table2 size={15} />} />
                  <Tab value="chart" label="Pareto Chart" icon={<ScatterChartIcon size={15} />} />
                </TabList>
              </div>
            </header>

            {playback && playbackReady && !playbackOpen && (
              <div className="app-banner-slot">
                <Banner
                  status="error"
                  title={
                    playback.kind === 'user'
                      ? 'Local solution file unavailable'
                      : 'Replay unavailable'
                  }
                  description={
                    playback.kind === 'user'
                      ? 'This local solution file is unavailable in this browser. Re-upload the .solution file to play it.'
                      : 'This record is unavailable or has no replay.'
                  }
                  isDismissable
                  dismissLabel="Dismiss"
                  onDismiss={onClosePlayback}
                />
              </div>
            )}

            <div className="app-workspace-body">
              {view === 'table' ? (
                <RecordsTable shared={shared} onPlayRecord={onPlayRecord} onPlayUserSolution={onPlayUserSolution} />
              ) : (
                <ParetoChart
                  puzzleId={puzzleId}
                  shared={shared}
                  onPlayRecord={onPlayRecord}
                  onPlayUserSolution={onPlayUserSolution}
                  playbackOpen={playbackOpen}
                />
              )}
            </div>
          </div>
        ) : (
          <div className="app-placeholder">
            <div className="app-placeholder-toolbar">
              <ThemeModeSwitch />
            </div>
            <div className="app-placeholder-center">
              <EmptyState
                headingLevel={1}
                icon={<FlaskConical size={40} strokeWidth={1.6} />}
                title="Select an Opus Magnum puzzle"
                description="Browse campaigns, journal chapters, and tournaments in the sidebar to inspect leaderboard records, custom categories, and multi-dimensional Pareto frontiers."
                actions={
                  <Button
                    variant="primary"
                    href="#/validator"
                    icon={<ShieldCheck size={16} />}
                    label="Open Solution Validator"
                  />
                }
              />
            </div>
          </div>
        )}
      </AppShell>
      {playbackView && (
        <GifViewer
          {...playbackView}
          open={playbackOpen}
          onClose={onClosePlayback}
        />
      )}
    </>
  )
}

export default App
