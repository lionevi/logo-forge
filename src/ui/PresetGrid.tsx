/**
 * Grille des préréglages, en 2 colonnes x 4 lignes.
 *
 * Les préréglages sont cumulables : chaque tuile est un interrupteur, pas un
 * choix exclusif. Au moins un doit rester actif, règle vérifiée par
 * `validateSelection` et rappelée sous la grille.
 */

import { PRESETS } from '../core/presets'
import type { PresetId } from '../core/types'

interface PresetGridProps {
  /** Identifiants actifs. */
  selected: readonly PresetId[]
  onToggle: (id: PresetId) => void
  disabled: boolean
}

export function PresetGrid({ selected, onToggle, disabled }: PresetGridProps) {
  const active = new Set(selected)

  return (
    <section className="section" aria-labelledby="presets-title">
      <div className="section-head">
        <h2 className="section-title" id="presets-title">
          Préréglages
        </h2>
        <span className="section-count">
          {active.size} / {PRESETS.length}
        </span>
      </div>

      <div className="preset-grid">
        {PRESETS.map((preset) => {
          const isOn = active.has(preset.id)
          return (
            <button
              key={preset.id}
              type="button"
              role="switch"
              aria-checked={isOn}
              className={`preset-tile${isOn ? ' is-on' : ''}`}
              onClick={() => onToggle(preset.id)}
              disabled={disabled}
            >
              <span className="preset-emoji" aria-hidden="true">
                {preset.emoji}
              </span>
              <span className="preset-text">
                <span className="preset-label">{preset.label}</span>
                <span className="preset-summary">{preset.summary}</span>
              </span>
              <span
                className={`preset-switch${isOn ? ' is-on' : ''}`}
                aria-hidden="true"
              >
                <span className="preset-knob" />
              </span>
            </button>
          )
        })}
      </div>

      {active.size === 0 && (
        <p className="hint is-warning">Activez au moins un préréglage.</p>
      )}
    </section>
  )
}
