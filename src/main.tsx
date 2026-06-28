import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// Bundled, self-hosted variable fonts with Cyrillic subsets (no external CDN). Inter
// Variable = UI/display; JetBrains Mono Variable = the telemetry/label layer.
import '@fontsource-variable/inter'
import '@fontsource-variable/jetbrains-mono'
import App from './App'
import './styles.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
