import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { watchSystemTheme } from './lib/theme'
import App from './App.tsx'

// the inline script in index.html has already applied the theme; this only
// keeps it following the OS afterwards, for anyone left on "system"
watchSystemTheme()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
