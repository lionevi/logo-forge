/**
 * Sélecteur de préréglages.
 *
 * Choisir un préréglage remplace la configuration courante, à l'exception du
 * nom de marque, qui est conservé d'un préréglage à l'autre.
 */

import { PRESETS } from '../core/presets'
import type { Preset } from '../core/types'

interface PresetSelectorProps {
  /** Identifiant du préréglage actif, ou `null` si la config a été modifiée. */
  activeId: string | null
  onSelect: (preset: Preset) => void
}

export function PresetSelector({ activeId, onSelect }: PresetSelectorProps) {
  return (
    <section className="section">
      <h2 className="section-title">Préréglages</h2>
      <div className="preset-grid">
        {PRESETS.map((preset) => (
          <button
            key={preset.id}
            type="button"
            className={`preset-card${activeId === preset.id ? ' is-active' : ''}`}
            onClick={() => onSelect(preset)}
            aria-pressed={activeId === preset.id}
          >
            <span className="preset-label">{preset.label}</span>
            <span className="preset-description">{preset.description}</span>
          </button>
        ))}
      </div>
      {activeId === null && (
        <p className="hint">
          Configuration personnalisée — aucun préréglage ne correspond aux réglages
          actuels.
        </p>
      )}
    </section>
  )
}
