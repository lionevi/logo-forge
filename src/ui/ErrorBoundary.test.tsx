/**
 * Tests de la frontière d'erreur.
 *
 * C'est le filet qui doit transformer un panneau muet en message lisible :
 * il mérite d'être vérifié plutôt que supposé.
 */

import { render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ErrorBoundary } from './ErrorBoundary'

/** Composant qui lève au rendu, pour déclencher la frontière. */
function Boom({ message }: { message: string }): never {
  throw new Error(message)
}

beforeEach(() => {
  // React journalise l'erreur interceptée : on tait le bruit sans masquer les
  // vraies régressions, `componentDidCatch` étant vérifié par ailleurs.
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('ErrorBoundary', () => {
  it('affiche les enfants tant que rien ne lève', () => {
    render(
      <ErrorBoundary>
        <p>contenu normal</p>
      </ErrorBoundary>,
    )

    expect(screen.getByText('contenu normal')).toBeInTheDocument()
  })

  it("affiche le message de l'erreur au lieu d'un panneau vide", () => {
    render(
      <ErrorBoundary>
        <Boom message="app.activeDocument est indéfini" />
      </ErrorBoundary>,
    )

    expect(screen.getByRole('alert')).toBeInTheDocument()
    expect(screen.getByText(/app\.activeDocument est indéfini/)).toBeInTheDocument()
  })

  it('nomme la zone fautive quand un libellé est fourni', () => {
    render(
      <ErrorBoundary label="préréglages">
        <Boom message="échec" />
      </ErrorBoundary>,
    )

    expect(screen.getByText('Erreur Logo Forge — préréglages :')).toBeInTheDocument()
  })

  it("journalise l'erreur pour la console distante CEP", () => {
    render(
      <ErrorBoundary>
        <Boom message="échec" />
      </ErrorBoundary>,
    )

    expect(console.error).toHaveBeenCalledWith(
      '[Logo Forge]',
      expect.any(Error),
      expect.anything(),
    )
  })

  it('isole la zone fautive et laisse ses voisines intactes', () => {
    render(
      <div>
        <ErrorBoundary label="a">
          <Boom message="échec" />
        </ErrorBoundary>
        <ErrorBoundary label="b">
          <p>section saine</p>
        </ErrorBoundary>
      </div>,
    )

    expect(screen.getByText('Erreur Logo Forge — a :')).toBeInTheDocument()
    expect(screen.getByText('section saine')).toBeInTheDocument()
  })
})
