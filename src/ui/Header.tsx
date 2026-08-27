/** En-tête du panneau : identité du plugin et état de la liaison Illustrator. */

import { version } from '../../package.json'

interface HeaderProps {
  /** `true` quand l'API Illustrator répond. */
  connected: boolean
}

export function Header({ connected }: HeaderProps) {
  const label = connected ? 'Illustrator connecté' : 'Illustrator injoignable'

  return (
    <header className="panel-header">
      <div className="brand">
        <span className="brand-name">Logo Forge</span>
        <span className="brand-version">v{version}</span>
      </div>
      <div className="connection" title={label}>
        <span
          className={`status-dot${connected ? ' is-on' : ' is-off'}`}
          role="img"
          aria-label={label}
        />
        <span className="connection-label">
          {connected ? 'Connecté' : 'Hors ligne'}
        </span>
      </div>
    </header>
  )
}
