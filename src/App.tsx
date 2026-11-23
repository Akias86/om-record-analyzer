import { useState, useEffect, useCallback, useMemo } from 'react'
import Sidebar from './components/Sidebar'
import ParetoChart from './components/ParetoChart'
import RecordsTable from './components/records/RecordsTable'
import TestPage from './test/TestPage'
import { fetchPuzzleDetail } from './api/om'
import type { OmPuzzleDetail } from './api/om'
import { UserSolutionsProvider, useUserSolutions } from './state/userSolutions'
import type { UserSolutionRecord } from './state/userSolutions'
import { usePuzzleRecords } from './state/usePuzzleRecords'
import { PuzzleTreeProvider } from './state/puzzleTree'
import { SolutionUploadProvider, useSolutionUpload } from './state/solutionUpload'
import { loadSetting, saveSetting } from './lib/settings'
import { findPlaybackRecord, findUserPlaybackRecord, parseHash, puzzleHash, recordPlaybackTarget } from './lib/routes'
import type { PlaybackTarget, Route } from './lib/routes'
import { pushRecentPuzzle, readRecentPuzzles } from './lib/recentPuzzles'
import type { RecentPuzzle } from './lib/recentPuzzles'
import type { OmRecordDTO } from './types'
import { GifViewer } from './components/pareto/GifViewer'
import { AppShell } from './components/layout/AppShell'
import { TopBar } from './components/layout/TopBar'
import { PuzzleHeader } from './components/layout/PuzzleHeader'
import type { MainView } from './components/layout/PuzzleHeader'
import { WelcomeScreen } from './components/layout/WelcomeScreen'
import { IconAlert, IconClose } from './components/ui/icons'

/* Routing lives here; everything below it is presentational. The hash is the
   single source of truth so a shared link restores the puzzle, the view and
   any playback that was open. */

function App() {
  const [route, setRoute] = useState<Route>(() => parseHash(window.location.hash))

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

  // The validator is a standalone page: it verifies files itself and needs
  // none of the app-level providers, so they stay unmounted there.
  if (route.validator) return <TestPage />

  return (
    <PuzzleTreeProvider>
      <UserSolutionsProvider>
        <SolutionUploadProvider>
          <MainApp
            puzzleId={route.puzzleId}
            playback={route.playback}
            onSelectPuzzle={navigatePuzzle}
            onPlayRecord={playRecord}
            onPlayUserSolution={playUserSolution}
            onClosePlayback={closePlayback}
          />
        </SolutionUploadProvider>
      </UserSolutionsProvider>
    </PuzzleTreeProvider>
  )
}

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
  const [recent, setRecent] = useState<RecentPuzzle[]>(() => readRecentPuzzles())
  // Remember the last view across puzzle changes and reloads. The shared
  // fetch lives here so switching views doesn't refetch.
  const [view, setView] = useState<MainView>(() =>
    loadSetting('om-app:view', 'table') === 'chart' ? 'chart' : 'table')
  const shared = usePuzzleRecords(puzzleId)
  const { records: userRecords, frontierSummary } = useUserSolutions()
  const { pickFiles } = useSolutionUpload()

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
        setRecent(pushRecentPuzzle({ id: d.id, name: d.displayName }))
      })
      .catch(() => setDetail(null))
    return () => { cancelled = true }
  }, [puzzleId])

  const steadyStateCount = useMemo(
    () => shared.records.reduce((count, record) => (record.score?.rate != null ? count + 1 : count), 0),
    [shared.records],
  )
  const frontierCount = useMemo(() => {
    const ids = new Set<string>()
    for (const set of shared.userFrontierByManifold.values()) for (const id of set) ids.add(id)
    return ids.size
  }, [shared.userFrontierByManifold])

  return (
    <AppShell
      topBar={<TopBar onPickPuzzle={onSelectPuzzle} />}
      sidebar={(
        <Sidebar
          selectedPuzzleId={puzzleId}
          onSelectPuzzle={onSelectPuzzle}
          expandCollectionId={expandCollectionId}
          expandGroupId={expandGroupId}
          recent={recent}
        />
      )}
    >
      {puzzleId ? (
        <div className="workspace workspace--flush">
          <PuzzleHeader
            puzzleId={puzzleId}
            detail={detail}
            view={view}
            onViewChange={setView}
            recordCount={shared.records.length}
            steadyStateCount={steadyStateCount}
            userCount={shared.puzzleUserRecords.length}
            frontierCount={frontierCount}
            loading={shared.loading || (!shared.recordsReady && !shared.error)}
          />
          {playback && playbackReady && !playbackOpen && (
            <div className="notice" role="alert">
              <span className="notice-icon" aria-hidden="true"><IconAlert size={16} /></span>
              <span className="notice-text">
                {playback.kind === 'user'
                  ? 'This local solution file is unavailable in this browser. Re-upload the .solution file to play it.'
                  : 'This record is unavailable or has no replay.'}
              </span>
              <button type="button" className="btn btn--sm btn--ghost" onClick={onClosePlayback}>
                <IconClose size={13} />
                Dismiss
              </button>
            </div>
          )}
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
      ) : (
        <WelcomeScreen
          recent={recent}
          onSelectPuzzle={onSelectPuzzle}
          onUpload={pickFiles}
          verifiedCount={userRecords.length}
          frontierCount={frontierSummary?.greenCount ?? 0}
        />
      )}
      {playbackView && (
        <GifViewer
          {...playbackView}
          open={playbackOpen}
          onClose={onClosePlayback}
        />
      )}
    </AppShell>
  )
}

export default App
