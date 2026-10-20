import { useState, useEffect, useCallback } from 'react'
import Sidebar from './components/Sidebar'
import ParetoChart from './components/ParetoChart'
import RecordsTable from './components/records/RecordsTable'
import TestPage from './test/TestPage'
import { fetchPuzzleDetail } from './api/om'
import type { OmPuzzleDetail } from './api/om'
import { UserSolutionsProvider } from './state/userSolutions'
import { usePuzzleRecords } from './state/usePuzzleRecords'
import { loadSetting, saveSetting } from './lib/settings'
import { findPlaybackRecord, parseHash, puzzleHash, recordPlaybackTarget } from './lib/routes'
import type { PlaybackTarget, Route } from './lib/routes'
import type { OmRecordDTO } from './types'
import { GifViewer } from './components/pareto/GifViewer'
import './App.css'

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

  const closePlayback = useCallback(() => {
    const current = parseHash(window.location.hash)
    if (!current.puzzleId || !current.playback) return
    // Closing a directly opened link must not navigate away from the app.
    history.replaceState(null, '', puzzleHash(current.puzzleId))
    setRoute(parseHash(window.location.hash))
  }, [])

  if (route.validator) return <TestPage />
  return (
    <UserSolutionsProvider>
      <MainApp
        puzzleId={route.puzzleId}
        playback={route.playback}
        onSelectPuzzle={navigatePuzzle}
        onPlayRecord={playRecord}
        onClosePlayback={closePlayback}
      />
    </UserSolutionsProvider>
  )
}

type MainView = 'table' | 'chart'

interface MainAppProps {
  puzzleId: string | null
  playback: PlaybackTarget | null
  onSelectPuzzle: (id: string | null) => void
  onPlayRecord: (record: OmRecordDTO) => void
  onClosePlayback: () => void
}

function MainApp({ puzzleId, playback, onSelectPuzzle, onPlayRecord, onClosePlayback }: MainAppProps) {
  const [detail, setDetail] = useState<OmPuzzleDetail | null>(null)
  const [expandCollectionId, setExpandCollectionId] = useState<string | null>(null)
  const [expandGroupId, setExpandGroupId] = useState<string | null>(null)
  // Remember the last tab across puzzle changes and reloads. The shared
  // fetch lives here so switching tabs doesn't refetch.
  const [view, setView] = useState<MainView>(() =>
    loadSetting('om-app:view', 'table') === 'chart' ? 'chart' : 'table')
  const shared = usePuzzleRecords(puzzleId)
  const playbackReady = shared.recordsReady && !shared.loading && !shared.error
  const playingRecord = playbackReady && puzzleId && playback
    ? findPlaybackRecord(shared.records, puzzleId, playback) : undefined

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

  const title = detail?.displayName ?? puzzleId

  return (
    <div className="app-layout">
      <Sidebar
        selectedPuzzleId={puzzleId}
        onSelectPuzzle={onSelectPuzzle}
        expandCollectionId={expandCollectionId}
        expandGroupId={expandGroupId}
      />
      <main className="app-main">
        {puzzleId ? (
          <div className="app-content">
            <h1>{title}</h1>
            <div className="app-tabs">
              <button
                type="button"
                className={`app-tab ${view === 'table' ? 'active' : ''}`}
                onClick={() => setView('table')}
              >Records</button>
              <button
                type="button"
                className={`app-tab ${view === 'chart' ? 'active' : ''}`}
                onClick={() => setView('chart')}
              >Pareto Chart</button>
            </div>
            {playback && playbackReady && !playingRecord?.gif && (
              <div className="pareto-chart-error" role="alert">
                This record is unavailable or has no replay.{' '}
                <button type="button" onClick={onClosePlayback}>Dismiss</button>
              </div>
            )}
            {view === 'table' ? (
              <RecordsTable shared={shared} onPlayRecord={onPlayRecord} />
            ) : (
              <ParetoChart puzzleId={puzzleId} shared={shared} onPlayRecord={onPlayRecord} playbackOpen={!!playingRecord?.gif} />
            )}
          </div>
        ) : (
          <div className="app-placeholder">
            <span>Select a puzzle from the sidebar</span>
            <a className="app-placeholder-btn" href="#/validator">Open Solution Validator</a>
          </div>
        )}
      </main>
      {playingRecord?.gif && (
        <GifViewer
          url={playingRecord.gif}
          title={playingRecord.fullFormattedScore ?? playingRecord.smartFormattedScore ?? ''}
          solutionUrl={playingRecord.solution}
          puzzleId={playingRecord.puzzle.id}
          puzzleName={playingRecord.puzzle.displayName}
          onClose={onClosePlayback}
        />
      )}
    </div>
  )
}

export default App
