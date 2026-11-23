import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { initTheme } from './lib/theme'
import './styles/index.css'
import App from './App.tsx'

// Applied before first paint; index.html does the same inline so a dark-mode
// user never sees a light flash while the bundle loads.
initTheme()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
