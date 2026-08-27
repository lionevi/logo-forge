/**
 * Panneau principal.
 *
 * `Panel` détient la configuration, replanifie le pack à chaque changement et
 * pilote l'export. Le plan est recalculé de façon synchrone : c'est une
 * opération pure et peu coûteuse, même sur plusieurs centaines de fichiers.
 */

import { useCallback, useMemo, useRef, useState } from 'react'

import { runExport, summarizeResult } from '../core/exporter'
import { planExport, summarizePlan } from '../core/planner'
import { DEFAULT_CONFIG, PRESETS, applyPreset } from '../core/presets'
import type { ExportConfig, ExportProgress, ExportResult, Preset } from '../core/types'
import { ExportSettings } from './ExportSettings'
import { PresetSelector } from './PresetSelector'
import {
  createStubRenderer,
  createUxpWriter,
  isUxpAvailable,
  pickDestinationFolder,
} from './illustratorBridge'

/** Compare deux tableaux sans tenir compte de l'ordre des éléments. */
function sameSet<T>(a: readonly T[], b: readonly T[]): boolean {
  if (a.length !== b.length) return false
  const left = [...a].sort()
  const right = [...b].sort()
  return left.every((value, index) => value === right[index])
}

/**
 * Retrouve le préréglage correspondant exactement à une configuration.
 * Le nom de la marque est ignoré : il est propre au projet, pas au préréglage.
 */
function matchPreset(config: ExportConfig): Preset | null {
  return (
    PRESETS.find((preset) => {
      const candidate = preset.config
      return (
        sameSet(candidate.variants, config.variants) &&
        sameSet(candidate.colorModes, config.colorModes) &&
        sameSet(candidate.formats, config.formats) &&
        sameSet(candidate.sizes, config.sizes) &&
        sameSet(candidate.usages, config.usages) &&
        candidate.background === config.background &&
        candidate.quality === config.quality &&
        candidate.naming.strategy === config.naming.strategy &&
        candidate.naming.namingCase === config.naming.namingCase &&
        candidate.naming.includeSize === config.naming.includeSize &&
        candidate.naming.includeColorSpace === config.naming.includeColorSpace &&
        candidate.naming.packFolder === config.naming.packFolder
      )
    }) ?? null
  )
}

export function Panel() {
  const [config, setConfig] = useState<ExportConfig>(DEFAULT_CONFIG)
  const [sizesInput, setSizesInput] = useState(DEFAULT_CONFIG.sizes.join(', '))
  const [progress, setProgress] = useState<ExportProgress | null>(null)
  const [result, setResult] = useState<ExportResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [exporting, setExporting] = useState(false)
  const abortRef = useRef<{ aborted: boolean }>({ aborted: false })

  const plan = useMemo(() => planExport(config), [config])
  const activePreset = useMemo(() => matchPreset(config), [config])
  const blocking = plan.issues.some((issue) => issue.level === 'error')

  const handlePreset = useCallback(
    (preset: Preset) => {
      const next = applyPreset(preset, config.naming.brand)
      setConfig(next)
      setSizesInput(next.sizes.join(', '))
      setResult(null)
      setError(null)
    },
    [config.naming.brand],
  )

  const handleExport = useCallback(async () => {
    setError(null)
    setResult(null)

    if (!isUxpAvailable()) {
      setError("Le panneau doit s'exécuter dans Illustrator pour écrire sur le disque.")
      return
    }

    let destination
    try {
      destination = await pickDestinationFolder()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
      return
    }
    if (!destination) return

    abortRef.current = { aborted: false }
    setExporting(true)
    setProgress({ completed: 0, total: plan.totalFiles, current: plan.files[0] })

    try {
      const exportResult = await runExport(
        plan,
        createUxpWriter(destination),
        createStubRenderer(),
        { onProgress: setProgress, signal: abortRef.current },
      )
      setResult(exportResult)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setExporting(false)
      setProgress(null)
    }
  }, [plan])

  const handleCancel = useCallback(() => {
    abortRef.current.aborted = true
  }, [])

  return (
    <div className="panel">
      <header className="panel-header">
        <h1 className="panel-title">Logo Forge</h1>
        <p className="panel-subtitle">{summarizePlan(plan)}</p>
      </header>

      <div className="panel-body">
        <PresetSelector activeId={activePreset?.id ?? null} onSelect={handlePreset} />

        <ExportSettings
          config={config}
          sizesInput={sizesInput}
          onSizesInputChange={setSizesInput}
          onChange={(next) => {
            setConfig(next)
            setResult(null)
          }}
          disabled={exporting}
        />

        {plan.issues.length > 0 && (
          <section className="section">
            <h2 className="section-title">Diagnostics</h2>
            <ul className="issues">
              {plan.issues.map((issue) => (
                <li
                  key={`${issue.code}-${issue.message}`}
                  className={`issue is-${issue.level}`}
                >
                  {issue.message}
                </li>
              ))}
            </ul>
          </section>
        )}

        {plan.totalFiles > 0 && (
          <section className="section">
            <h2 className="section-title">
              Aperçu du pack ({plan.totalFiles} fichiers)
            </h2>
            <ul className="file-list">
              {plan.files.slice(0, 40).map((file) => (
                <li key={file.path} className="file-row">
                  {file.path}
                </li>
              ))}
            </ul>
            {plan.totalFiles > 40 && (
              <p className="hint">
                … et {plan.totalFiles - 40} fichiers supplémentaires.
              </p>
            )}
          </section>
        )}
      </div>

      <footer className="panel-footer">
        {progress && (
          <div className="progress" role="status">
            <div
              className="progress-bar"
              style={{
                width: `${Math.round((progress.completed / Math.max(progress.total, 1)) * 100)}%`,
              }}
            />
            <span className="progress-label">
              {progress.completed} / {progress.total} — {progress.current?.fileName}
            </span>
          </div>
        )}

        {error && <p className="banner is-error">{error}</p>}
        {result && <p className="banner is-ok">{summarizeResult(result)}</p>}

        <div className="actions">
          <button
            type="button"
            className="button is-primary"
            disabled={blocking || exporting || plan.totalFiles === 0}
            onClick={handleExport}
          >
            {exporting ? 'Export en cours…' : `Exporter ${plan.totalFiles} fichiers`}
          </button>
          {exporting && (
            <button type="button" className="button" onClick={handleCancel}>
              Annuler
            </button>
          )}
        </div>
      </footer>
    </div>
  )
}
