import { useState, useEffect, useCallback } from 'react'
import Sidebar from './components/Sidebar'
import ParetoChart from './components/ParetoChart'
import RecordsTable from './components/records/RecordsTable'
import TestPage from './test/TestPage'
import { fetchPuzzleDetail } from './api/om'
import type { OmPuzzleDetail } from './api/om'
import { UserSolutionsProvider } from './state/userSolutions'
import { usePuzzleRecords } from './state/usePuzzleRecords'
import './App.css'

interface Route {
  validator: boolean
  puzzleId: string | null
}

function parseHash(hash: string): Route {
  const raw = hash.replace(/^#/, '')
  if (raw === '/validator') return { validator: true, puzzleId: null }
  const m = raw.match(/^\/puzzle\/(.+)$/)
  if (m) return { validator: false, puzzleId: decodeURIComponent(m[1]) }
  return { validator: false, puzzleId: null }
}

function App() {
  const [route, setRoute] = useState<Route>(() => parseHash(window.location.hash))

  useEffect(() => {
    const onChange = () => setRoute(parseHash(window.location.hash))
    window.addEventListener('hashchange', onChange)
    return () => window.removeEventListener('hashchange', onChange)
  }, [])

  const navigatePuzzle = useCallback((id: string | null) => {
    if (id) {
      window.location.hash = `/puzzle/${id}`
    } else if (window.location.hash) {
      history.replaceState(null, '', window.location.pathname + window.location.search)
      setRoute({ validator: false, puzzleId: null })
    }
  }, [])

  if (route.validator) return <TestPage />
  return (
    <UserSolutionsProvider>
      <MainApp puzzleId={route.puzzleId} onSelectPuzzle={navigatePuzzle} />
    </UserSolutionsProvider>
  )
}

type MainView = 'table' | 'chart'

function MainApp({ puzzleId, onSelectPuzzle }: { puzzleId: string | null; onSelectPuzzle: (id: string | null) => void }) {
  const [detail, setDetail] = useState<OmPuzzleDetail | null>(null)
  const [expandCollectionId, setExpandCollectionId] = useState<string | null>(null)
  const [expandGroupId, setExpandGroupId] = useState<string | null>(null)
  // Selecting a puzzle always lands on the records table; the chart is one
  // tab away. The shared fetch lives here so switching tabs doesn't refetch.
  const [view, setView] = useState<MainView>('table')
  const shared = usePuzzleRecords(puzzleId)

  useEffect(() => {
    setView('table')
  }, [puzzleId])

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
            {view === 'table' ? (
              <RecordsTable puzzleId={puzzleId} puzzleName={detail?.displayName ?? puzzleId} shared={shared} />
            ) : (
              <ParetoChart puzzleId={puzzleId} shared={shared} />
            )}
          </div>
        ) : (
          <div className="app-placeholder">
            <span>Select a puzzle from the sidebar</span>
            <a className="app-placeholder-btn" href="#/validator">Open Solution Validator</a>
          </div>
        )}
      </main>
    </div>
  )
}

export default App
