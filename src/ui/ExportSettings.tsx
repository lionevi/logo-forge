/**
 * Options d'export : variantes, déclinaisons, formats, tailles et nommage.
 *
 * Le composant est entièrement contrôlé — il ne détient aucun état — afin que
 * `Panel` reste la source de vérité et puisse replanifier à chaque changement.
 */

import type {
  ColorMode,
  ExportConfig,
  FileFormat,
  FolderStrategy,
  LogoVariant,
  NamingCase,
  Usage,
} from '../core/types'
import {
  COLOR_MODES,
  FILE_FORMATS,
  FOLDER_STRATEGIES,
  LOGO_VARIANTS,
} from '../core/types'
import { MAX_RASTER_SIZE } from '../core/planner'

const VARIANT_LABEL: Record<LogoVariant, string> = {
  primary: 'Principal',
  horizontal: 'Horizontal',
  stacked: 'Vertical',
  icon: 'Icône seule',
  wordmark: 'Typographique',
}

const COLOR_MODE_LABEL: Record<ColorMode, string> = {
  'full-color': 'Couleur',
  black: 'Noir',
  white: 'Blanc',
  grayscale: 'Niveaux de gris',
  knockout: 'Réserve',
}

const STRATEGY_LABEL: Record<FolderStrategy, string> = {
  'usage-format': 'Usage puis format (Web/PNG…)',
  format: 'Par format (PNG/, SVG/…)',
  variant: 'Par variante (Principal/, Icone/…)',
  flat: 'Tout à plat',
}

const NAMING_CASE_LABEL: Record<NamingCase, string> = {
  kebab: 'kebab-case',
  snake: 'snake_case',
  pascal: 'PascalCase',
}

const USAGE_LABEL: Record<Usage, string> = {
  web: 'Web (RVB)',
  print: 'Print (CMJN)',
}

const USAGES: readonly Usage[] = ['web', 'print']

/** Ajoute ou retire une valeur d'une sélection, en conservant l'ordre. */
function toggle<T>(values: T[], value: T): T[] {
  return values.includes(value)
    ? values.filter((item) => item !== value)
    : [...values, value]
}

/** Analyse une saisie de tailles séparées par des virgules ou des espaces. */
export function parseSizes(input: string): number[] {
  return input
    .split(/[\s,;]+/)
    .map((token) => Number.parseInt(token, 10))
    .filter((size) => Number.isFinite(size))
}

interface ExportSettingsProps {
  config: ExportConfig
  /** Saisie brute des tailles, conservée telle quelle pendant la frappe. */
  sizesInput: string
  onSizesInputChange: (value: string) => void
  onChange: (config: ExportConfig) => void
  disabled: boolean
}

export function ExportSettings({
  config,
  sizesInput,
  onSizesInputChange,
  onChange,
  disabled,
}: ExportSettingsProps) {
  const update = (patch: Partial<ExportConfig>) => onChange({ ...config, ...patch })

  const updateNaming = (patch: Partial<ExportConfig['naming']>) =>
    onChange({ ...config, naming: { ...config.naming, ...patch } })

  return (
    <div className="settings">
      <section className="section">
        <h2 className="section-title">Marque</h2>
        <label className="field">
          <span className="field-label">Nom de la marque</span>
          <input
            type="text"
            value={config.naming.brand}
            disabled={disabled}
            onChange={(event) => updateNaming({ brand: event.target.value })}
            placeholder="Ma Marque"
          />
        </label>
        <label className="field">
          <span className="field-label">Dossier du pack</span>
          <input
            type="text"
            value={config.naming.packFolder}
            disabled={disabled}
            onChange={(event) => updateNaming({ packFolder: event.target.value })}
            placeholder="logo-pack"
          />
        </label>
      </section>

      <section className="section">
        <h2 className="section-title">Variantes</h2>
        <div className="chip-grid">
          {LOGO_VARIANTS.map((variant) => (
            <button
              key={variant}
              type="button"
              className={`chip${config.variants.includes(variant) ? ' is-on' : ''}`}
              disabled={disabled}
              aria-pressed={config.variants.includes(variant)}
              onClick={() => update({ variants: toggle(config.variants, variant) })}
            >
              {VARIANT_LABEL[variant]}
            </button>
          ))}
        </div>
      </section>

      <section className="section">
        <h2 className="section-title">Déclinaisons chromatiques</h2>
        <div className="chip-grid">
          {COLOR_MODES.map((mode) => (
            <button
              key={mode}
              type="button"
              className={`chip${config.colorModes.includes(mode) ? ' is-on' : ''}`}
              disabled={disabled}
              aria-pressed={config.colorModes.includes(mode)}
              onClick={() => update({ colorModes: toggle(config.colorModes, mode) })}
            >
              {COLOR_MODE_LABEL[mode]}
            </button>
          ))}
        </div>
      </section>

      <section className="section">
        <h2 className="section-title">Formats</h2>
        <div className="chip-grid">
          {FILE_FORMATS.map((format: FileFormat) => (
            <button
              key={format}
              type="button"
              className={`chip${config.formats.includes(format) ? ' is-on' : ''}`}
              disabled={disabled}
              aria-pressed={config.formats.includes(format)}
              onClick={() => update({ formats: toggle(config.formats, format) })}
            >
              {format.toUpperCase()}
            </button>
          ))}
        </div>
      </section>

      <section className="section">
        <h2 className="section-title">Usages</h2>
        <div className="chip-grid">
          {USAGES.map((usage) => (
            <button
              key={usage}
              type="button"
              className={`chip${config.usages.includes(usage) ? ' is-on' : ''}`}
              disabled={disabled}
              aria-pressed={config.usages.includes(usage)}
              onClick={() => update({ usages: toggle(config.usages, usage) })}
            >
              {USAGE_LABEL[usage]}
            </button>
          ))}
        </div>
      </section>

      <section className="section">
        <h2 className="section-title">Matriciel</h2>
        <label className="field">
          <span className="field-label">Tailles en pixels (1 à {MAX_RASTER_SIZE})</span>
          <input
            type="text"
            value={sizesInput}
            disabled={disabled}
            onChange={(event) => {
              onSizesInputChange(event.target.value)
              update({ sizes: parseSizes(event.target.value) })
            }}
            placeholder="256, 512, 1024"
          />
        </label>
        <label className="field">
          <span className="field-label">Qualité JPEG / WebP : {config.quality}</span>
          <input
            type="range"
            min={1}
            max={100}
            value={config.quality}
            disabled={disabled}
            onChange={(event) => update({ quality: Number(event.target.value) })}
          />
        </label>
        <label className="field">
          <span className="field-label">Fond des formats opaques</span>
          <input
            type="text"
            value={config.background}
            disabled={disabled}
            onChange={(event) => update({ background: event.target.value })}
            placeholder="#ffffff"
          />
        </label>
      </section>

      <section className="section">
        <h2 className="section-title">Nommage</h2>
        <label className="field">
          <span className="field-label">Structure des dossiers</span>
          <select
            value={config.naming.strategy}
            disabled={disabled}
            onChange={(event) =>
              updateNaming({ strategy: event.target.value as FolderStrategy })
            }
          >
            {FOLDER_STRATEGIES.map((strategy) => (
              <option key={strategy} value={strategy}>
                {STRATEGY_LABEL[strategy]}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span className="field-label">Convention</span>
          <select
            value={config.naming.namingCase}
            disabled={disabled}
            onChange={(event) =>
              updateNaming({ namingCase: event.target.value as NamingCase })
            }
          >
            {(Object.keys(NAMING_CASE_LABEL) as NamingCase[]).map((value) => (
              <option key={value} value={value}>
                {NAMING_CASE_LABEL[value]}
              </option>
            ))}
          </select>
        </label>
        <label className="field field-inline">
          <input
            type="checkbox"
            checked={config.naming.includeSize}
            disabled={disabled}
            onChange={(event) => updateNaming({ includeSize: event.target.checked })}
          />
          <span>Inclure la taille dans le nom</span>
        </label>
        <label className="field field-inline">
          <input
            type="checkbox"
            checked={config.naming.includeColorSpace}
            disabled={disabled}
            onChange={(event) =>
              updateNaming({ includeColorSpace: event.target.checked })
            }
          />
          <span>Suffixer l&apos;espace colorimétrique</span>
        </label>
      </section>
    </div>
  )
}
