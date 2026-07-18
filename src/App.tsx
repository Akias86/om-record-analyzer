import { useState, useEffect, useCallback, useMemo } from 'react'
import Sidebar from './components/Sidebar'
import ParetoChart from './components/ParetoChart'
import TestPage from './test/TestPage'
import { fetchPuzzleDetail } from './api/om'
import type { OmPuzzleDetail } from './api/om'
import { UserSolutionsProvider, useUserSolutions } from './state/userSolutions'
import './App.css'

interface Route {
  solver: boolean
  puzzleId: string | null
}

function parseHash(hash: string): Route {
  const raw = hash.replace(/^#/, '')
  if (raw === '/solver') return { solver: true, puzzleId: null }
  const m = raw.match(/^\/puzzle\/(.+)$/)
  if (m) return { solver: false, puzzleId: decodeURIComponent(m[1]) }
  return { solver: false, puzzleId: null }
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
      setRoute({ solver: false, puzzleId: null })
    }
  }, [])

  if (route.solver) return <TestPage />
  return (
    <UserSolutionsProvider>
      <MainApp puzzleId={route.puzzleId} onSelectPuzzle={navigatePuzzle} />
    </UserSolutionsProvider>
  )
}

function MainApp({ puzzleId, onSelectPuzzle }: { puzzleId: string | null; onSelectPuzzle: (id: string | null) => void }) {
  const [detail, setDetail] = useState<OmPuzzleDetail | null>(null)
  const [expandCollectionId, setExpandCollectionId] = useState<string | null>(null)
  const [expandGroupId, setExpandGroupId] = useState<string | null>(null)
  const { records: userRecords } = useUserSolutions()

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

  const puzzleUserRecords = useMemo(
    () => (puzzleId ? userRecords.filter((r) => r.puzzleId === puzzleId) : []),
    [userRecords, puzzleId],
  )

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
            <ParetoChart puzzleId={puzzleId} userRecords={puzzleUserRecords} />
          </div>
        ) : (
          <div className="app-placeholder">
            Select a puzzle from the sidebar
          </div>
        )}
      </main>
    </div>
  )
}

export default App
