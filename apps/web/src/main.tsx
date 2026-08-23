import React from 'react'
import ReactDOM from 'react-dom/client'
import { App } from './App'
import { applyCachedBranding } from './lib/branding'
import { initAnalytics } from './lib/analytics'
import './index.css'

// Antes do primeiro render: sem isto, um tenant de tema claro veria a tela
// pintada no escuro do produto até o `GET /branding` responder — um flash de
// página inteira em toda carga. O valor certo chega logo depois, pelo provider.
applyCachedBranding()

// No-op sem `VITE_GA4_MEASUREMENT_ID`: sem chave, nenhum script de terceiro é
// carregado.
initAnalytics()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js')
  })
}
