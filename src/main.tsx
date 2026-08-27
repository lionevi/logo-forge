/**
 * Point d'entrée du panneau.
 *
 * Trois filets de sécurité, dans cet ordre, parce qu'un panneau muet est le
 * pire des symptômes à diagnostiquer — surtout en CEP, où la console distante
 * n'est pas toujours joignable :
 *
 * 1. `ErrorBoundary` intercepte les erreurs de rendu React et les affiche ;
 * 2. le `try`/`catch` autour du montage rattrape un échec avant tout rendu ;
 * 3. `window.onerror` et `unhandledrejection` capturent l'asynchrone, qu'aucune
 *    frontière React ne voit — un `setInterval` qui lève, par exemple.
 *
 * Les trois écrivent dans le DOM sans passer par React : un message doit
 * s'afficher même quand React est justement ce qui a échoué.
 */

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import { App } from './App'
import { ErrorBoundary } from './ui/ErrorBoundary'
import './styles/main.css'

/** Identifiant du bandeau de diagnostic, créé à la demande. */
const DIAGNOSTIC_ID = 'logo-forge-diagnostic'

/**
 * Affiche un message d'erreur dans le panneau, sans React.
 *
 * Les styles sont en ligne : la feuille de style peut elle-même être en cause.
 */
function showFatalError(title: string, detail: string): void {
  const host = document.getElementById('root') ?? document.body
  if (!host) return

  let panel = document.getElementById(DIAGNOSTIC_ID)
  if (!panel) {
    panel = document.createElement('div')
    panel.id = DIAGNOSTIC_ID
    panel.setAttribute(
      'style',
      [
        'padding:12px',
        'margin:8px',
        'border:1px solid #e34850',
        'border-radius:4px',
        'background:rgba(227,72,80,0.12)',
        'color:#ff6b6b',
        'font-family:monospace',
        'font-size:11px',
        'line-height:1.5',
        'white-space:pre-wrap',
        'word-break:break-word',
      ].join(';'),
    )
    host.appendChild(panel)
  }

  panel.appendChild(document.createTextNode(`${title}\n${detail}\n\n`))
}

/** Décrit n'importe quelle valeur levée, y compris celles qui ne sont pas des `Error`. */
function describe(value: unknown): string {
  if (value instanceof Error) {
    return `${value.message}\n${value.stack ?? '(pile indisponible)'}`
  }
  return String(value)
}

// Filet 3 : erreurs asynchrones, invisibles pour React.
window.addEventListener('error', (event) => {
  showFatalError(
    'Erreur JavaScript non interceptée :',
    describe(event.error ?? event.message),
  )
})
window.addEventListener('unhandledrejection', (event) => {
  showFatalError('Promesse rejetée sans traitement :', describe(event.reason))
})

// Filet 2 : échec du montage lui-même.
try {
  const container = document.getElementById('root')
  if (!container) {
    throw new Error('Conteneur #root introuvable : le panneau ne peut pas démarrer.')
  }

  // Filet 1 : erreurs de rendu React.
  createRoot(container).render(
    <StrictMode>
      <ErrorBoundary label="panneau">
        <App />
      </ErrorBoundary>
    </StrictMode>,
  )
} catch (error) {
  showFatalError("Le panneau n'a pas pu démarrer :", describe(error))
}
