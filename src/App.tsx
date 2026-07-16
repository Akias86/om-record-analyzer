import { useState, useEffect } from 'react'
import Sidebar from './components/Sidebar'
import ParetoChart from './components/ParetoChart'
import './App.css'

const PUZZLE_KEY = 'om-selected-puzzle'

function App() {
  const [selectedPuzzleId, setSelectedPuzzleId] = useState<string | null>(() => {
    try { return localStorage.getItem(PUZZLE_KEY) } catch { return null }
  })

  useEffect(() => {
    try {
      if (selectedPuzzleId) localStorage.setItem(PUZZLE_KEY, selectedPuzzleId)
      else localStorage.removeItem(PUZZLE_KEY)
    } catch {}
  }, [selectedPuzzleId])

  return (
    <div className="app-layout">
      <Sidebar selectedPuzzleId={selectedPuzzleId} onSelectPuzzle={setSelectedPuzzleId} />
      <main className="app-main">
        {selectedPuzzleId ? (
          <div className="app-content">
            <h1>{selectedPuzzleId}</h1>
            <ParetoChart puzzleId={selectedPuzzleId} />
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
