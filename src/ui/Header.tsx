/** En-tête du panneau : identité du plugin et état de la liaison Illustrator. */

import { version } from '../../package.json'
import type { HostEnvironment } from '../illustrator/host'

interface HeaderProps {
  /** Environnement détecté, qui décide de la couleur du témoin. */
  environment: HostEnvironment
}

/**
 * Libellés du témoin de connexion.
 *
 * CEP a son propre état : le panneau s'y affiche mais l'API Illustrator n'y est
 * pas joignable. Le confondre avec « connecté » ferait promettre un export qui
 * échouerait ensuite.
 */
const STATES: Record<HostEnvironment, { dot: string; short: string; full: string }> = {
  uxp: { dot: 'is-on', short: 'Connecté', full: 'Illustrator connecté' },
  cep: {
    dot: 'is-partial',
    short: 'CEP',
    full: 'Mode CEP — API Illustrator indisponible',
  },
  none: { dot: 'is-off', short: 'Hors ligne', full: 'Illustrator injoignable' },
}

export function Header({ environment }: HeaderProps) {
  const state = STATES[environment]

  return (
    <header className="panel-header">
      <div className="brand">
        <span className="brand-name">Logo Forge</span>
        <span className="brand-version">v{version}</span>
      </div>
      <div className="connection" title={state.full}>
        <span
          className={`status-dot ${state.dot}`}
          role="img"
          aria-label={state.full}
        />
        <span className="connection-label">{state.short}</span>
      </div>
    </header>
  )
}
