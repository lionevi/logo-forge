/**
 * Point d'entrée du panneau UXP.
 *
 * UXP n'expose pas de `DOMContentLoaded` fiable au moment où le bundle IIFE est
 * évalué : le conteneur est donc résolu immédiatement, le script étant chargé
 * après le `#root` dans `index.html`.
 */

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import { App } from './App'
import './styles/main.css'

const container = document.getElementById('root')

if (!container) {
  throw new Error('Conteneur #root introuvable : le panneau ne peut pas démarrer.')
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
