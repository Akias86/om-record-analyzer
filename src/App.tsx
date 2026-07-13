import { useState } from 'react'
import Sidebar from './components/Sidebar'
import './App.css'

function App() {
  const [selectedPuzzleId, setSelectedPuzzleId] = useState<string | null>(null)

  return (
    <div className="app-layout">
      <Sidebar selectedPuzzleId={selectedPuzzleId} onSelectPuzzle={setSelectedPuzzleId} />
      <main className="app-main">
        {selectedPuzzleId ? (
          <div className="app-content">
            <h1>{selectedPuzzleId}</h1>
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
