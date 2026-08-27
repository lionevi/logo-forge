/**
 * Frontière d'erreur React.
 *
 * Sans elle, une erreur levée pendant le rendu fait démonter **tout** l'arbre
 * par React 18 : le panneau devient blanc, sans message. Elle est d'autant plus
 * nécessaire en CEP, où la console de débogage n'est pas toujours accessible :
 * l'erreur doit s'afficher dans le panneau lui-même.
 *
 * Un `try`/`catch` autour du `return` d'un composant ne remplacerait pas ce
 * mécanisme : React n'appelle les composants enfants qu'après le retour du
 * parent, si bien qu'une erreur d'enfant se produit hors du bloc `try`. Seule
 * une frontière d'erreur les intercepte.
 */

import { Component, type ErrorInfo, type ReactNode } from 'react'

interface ErrorBoundaryProps {
  children: ReactNode
  /** Nom de la zone protégée, affiché en tête du message. */
  label?: string
}

interface ErrorBoundaryState {
  error: Error | null
  /** Pile des composants React, plus parlante que la pile JavaScript. */
  componentStack: string | null
}

/** Styles en ligne : ils doivent tenir même si la feuille de style a échoué. */
const CONTAINER: React.CSSProperties = {
  padding: '12px',
  margin: '8px 0',
  border: '1px solid #e34850',
  borderRadius: '4px',
  background: 'rgba(227, 72, 80, 0.12)',
  color: '#ff6b6b',
  fontFamily: 'monospace',
  fontSize: '11px',
  lineHeight: 1.5,
}

const PRE: React.CSSProperties = {
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
  margin: '8px 0 0',
  maxHeight: '220px',
  overflow: 'auto',
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  override state: ErrorBoundaryState = { error: null, componentStack: null }

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { error }
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    this.setState({ componentStack: info.componentStack ?? null })
    // Utile quand la console distante CEP *est* accessible.
    console.error('[Logo Forge]', error, info.componentStack)
  }

  override render(): ReactNode {
    const { error, componentStack } = this.state
    if (!error) return this.props.children

    const title = this.props.label
      ? `Erreur Logo Forge — ${this.props.label}`
      : 'Erreur Logo Forge'

    return (
      <div style={CONTAINER} role="alert">
        <strong>{title} :</strong>
        <pre style={PRE}>
          {error.message}
          {'\n\n'}
          {componentStack ?? error.stack ?? '(pile indisponible)'}
        </pre>
      </div>
    )
  }
}
