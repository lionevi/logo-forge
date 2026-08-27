/**
 * Déclinaisons chromatiques du pack.
 *
 * « Personnalisé » est présent mais désactivé : il attend le sélecteur de
 * nuances prévu en v1.1, et l'annoncer ici évite de le faire chercher.
 */

import type { ColorMode } from '../core/types'

/** Déclinaisons proposées, dans l'ordre d'affichage. */
const SCHEMES: Array<{ mode: ColorMode; label: string }> = [
  { mode: 'full-color', label: 'Full Color' },
  { mode: 'black', label: 'Black' },
  { mode: 'white', label: 'White' },
  { mode: 'grayscale', label: 'Grayscale' },
]

interface ColorSchemesProps {
  selected: readonly ColorMode[]
  onToggle: (mode: ColorMode) => void
  disabled: boolean
}

export function ColorSchemes({ selected, onToggle, disabled }: ColorSchemesProps) {
  const active = new Set(selected)

  return (
    <section className="section" aria-labelledby="schemes-title">
      <h2 className="section-title" id="schemes-title">
        Déclinaisons
      </h2>

      <div className="check-list">
        {SCHEMES.map(({ mode, label }) => (
          <label key={mode} className="check-row">
            <input
              type="checkbox"
              checked={active.has(mode)}
              disabled={disabled}
              onChange={() => onToggle(mode)}
            />
            <span className="check-label">{label}</span>
          </label>
        ))}

        <label className="check-row is-disabled">
          <input type="checkbox" checked={false} disabled readOnly />
          <span className="check-label">Custom</span>
          <span className="badge">v1.1</span>
        </label>
      </div>

      {active.size === 0 && (
        <p className="hint is-warning">Cochez au moins une déclinaison.</p>
      )}
    </section>
  )
}
