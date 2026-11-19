import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './ui/App'
import '@fontsource-variable/archivo/wdth.css'
import '@fontsource/jetbrains-mono/400.css'
import './ui/styles.css'
import './ui/theme.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
