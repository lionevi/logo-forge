/**
 * Panneau principal.
 *
 * `Panel` détient toute la sélection — préréglages, déclinaisons, destination —
 * et recalcule le plan du pack à chaque changement. Le calcul est pur et
 * synchrone : même sur plusieurs centaines de fichiers, il tient dans un rendu.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { runExport } from '../core/exportOrchestrator'
import { packageConfig, planPackage } from '../core/packagePlanner'
import { summarizePlan } from '../core/planner'
import { DEFAULT_PRESET_IDS, resolvePresets } from '../core/presets'
import type {
  ActiveDocumentInfo,
  ColorMode,
  ExportProgress,
  ExportReport,
  PresetId,
} from '../core/types'
import { ColorSchemes } from './ColorSchemes'
import { DocumentSection } from './DocumentSection'
import { ExportResults } from './ExportResults'
import { Header } from './Header'
import { OutputSection } from './OutputSection'
import { PresetGrid } from './PresetGrid'
import {
  createUxpWriter,
  getIllustratorEngine,
  isIllustratorReady,
  isUxpAvailable,
  pickDestinationFolder,
  readActiveDocument,
  revealInFileManager,
  type UxpEntry,
} from './illustratorBridge'

/**
 * Intervalle de relecture du document actif, en millisecondes.
 *
 * Illustrator ne notifie pas un panneau UXP d'un changement de document : la
 * seule façon de suivre le document actif est de le relire périodiquement. Deux
 * secondes suffisent à donner l'impression du temps réel sans peser sur l'hôte.
 */
const DOCUMENT_POLL_MS = 2000

/** Retire l'extension d'un nom de fichier, pour en faire un nom de package. */
export function stripExtension(fileName: string): string {
  const dot = fileName.lastIndexOf('.')
  return dot <= 0 ? fileName : fileName.slice(0, dot)
}

/** Ajoute ou retire une valeur d'une sélection, en conservant l'ordre. */
function toggle<T>(values: readonly T[], value: T): T[] {
  return values.includes(value)
    ? values.filter((item) => item !== value)
    : [...values, value]
}

export function Panel() {
  const [presetIds, setPresetIds] = useState<PresetId[]>([...DEFAULT_PRESET_IDS])
  const [colorModes, setColorModes] = useState<ColorMode[]>(['full-color'])
  const [document, setDocument] = useState<ActiveDocumentInfo | null>(() =>
    readActiveDocument(),
  )
  const [packageName, setPackageName] = useState('')
  /** `true` dès que l'utilisateur a saisi un nom : on cesse alors de le déduire. */
  const [nameEdited, setNameEdited] = useState(false)
  const [folder, setFolder] = useState<UxpEntry | null>(null)

  const [exporting, setExporting] = useState(false)
  const [progress, setProgress] = useState<ExportProgress | null>(null)
  const [report, setReport] = useState<ExportReport | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [revealError, setRevealError] = useState<string | null>(null)
  const abortRef = useRef<{ aborted: boolean }>({ aborted: false })

  const connected = isIllustratorReady()

  // Relit le document actif tant qu'aucun export n'est en cours : pendant
  // l'export, le document courant est un duplicata et la lecture serait fausse.
  useEffect(() => {
    if (exporting) return undefined

    const timer = setInterval(() => {
      setDocument((previous) => {
        const next = readActiveDocument()
        if (previous?.name === next?.name && previous?.path === next?.path) {
          return previous
        }
        return next
      })
    }, DOCUMENT_POLL_MS)

    return () => clearInterval(timer)
  }, [exporting])

  // Le nom du package suit celui du document tant que l'utilisateur n'a rien saisi.
  useEffect(() => {
    if (nameEdited) return
    setPackageName(document ? stripExtension(document.name) : '')
  }, [document, nameEdited])

  const selection = useMemo(
    () => ({
      presets: resolvePresets(presetIds),
      colorModes,
      packageName,
      artboardWidthPoints: document?.artboardWidthPoints ?? 0,
    }),
    [presetIds, colorModes, packageName, document],
  )

  const plan = useMemo(() => planPackage(selection), [selection])
  const warnings = useMemo(
    () => plan.issues.filter((issue) => issue.level === 'warning'),
    [plan],
  )
  const blocking = plan.issues.some((issue) => issue.level === 'error')
  const canExport = document !== null && !blocking && plan.totalFiles > 0 && !exporting

  const handleRefreshDocument = useCallback(() => {
    setDocument(readActiveDocument())
    setError(null)
  }, [])

  const handleChooseFolder = useCallback(async () => {
    setError(null)
    try {
      const picked = await pickDestinationFolder()
      if (picked) setFolder(picked)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
    }
  }, [])

  const handleExport = useCallback(async () => {
    setError(null)
    setReport(null)
    setRevealError(null)

    if (!isUxpAvailable() || !isIllustratorReady()) {
      setError("Le panneau doit s'exécuter dans Illustrator pour lancer un export.")
      return
    }

    const active = readActiveDocument()
    setDocument(active)
    if (!active) {
      setError('Aucun document Illustrator ouvert : ouvrez le logo à exporter.')
      return
    }

    let target = folder
    if (!target) {
      try {
        target = await pickDestinationFolder()
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : String(caught))
        return
      }
      if (!target) return
      setFolder(target)
    }

    abortRef.current = { aborted: false }
    setExporting(true)
    setProgress({ completed: 0, total: plan.totalFiles, current: plan.files[0] })

    try {
      setReport(
        await runExport({
          config: packageConfig(selection),
          plan,
          engine: getIllustratorEngine(),
          writer: createUxpWriter(target),
          destination: target.nativePath,
          onProgress: setProgress,
          signal: abortRef.current,
        }),
      )
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setExporting(false)
      setProgress(null)
    }
  }, [folder, plan, selection])

  const handleCancel = useCallback(() => {
    abortRef.current.aborted = true
  }, [])

  const handleReveal = useCallback(async () => {
    setRevealError(null)
    const path = report?.destination ?? folder?.nativePath
    if (!path) return

    if (!(await revealInFileManager(path))) {
      setRevealError(`Ouverture impossible. Le pack se trouve dans ${path}`)
    }
  }, [report, folder])

  const percent =
    progress && progress.total > 0
      ? Math.round((progress.completed / progress.total) * 100)
      : 0

  return (
    <div className="panel">
      <Header connected={connected} />

      <div className="panel-body">
        <DocumentSection
          document={document}
          onRefresh={handleRefreshDocument}
          disabled={exporting}
        />

        <PresetGrid
          selected={presetIds}
          onToggle={(id) => setPresetIds((current) => toggle(current, id))}
          disabled={exporting}
        />

        <ColorSchemes
          selected={colorModes}
          onToggle={(mode) => setColorModes((current) => toggle(current, mode))}
          disabled={exporting}
        />

        <OutputSection
          packageName={packageName}
          onPackageNameChange={(value) => {
            setNameEdited(true)
            setPackageName(value)
          }}
          destination={folder?.nativePath ?? null}
          onChooseFolder={handleChooseFolder}
          disabled={exporting}
        />

        {plan.totalFiles > 0 && <p className="plan-summary">{summarizePlan(plan)}</p>}

        {warnings.length > 0 && !report && (
          <ul className="issues" aria-label="Avertissements">
            {warnings.map((issue) => (
              <li key={issue.code} className="issue is-warning">
                {issue.message}
              </li>
            ))}
          </ul>
        )}

        {report && (
          <ExportResults
            report={report}
            warnings={warnings}
            onReveal={handleReveal}
            revealError={revealError}
          />
        )}
      </div>

      <footer className="panel-footer">
        {exporting && (
          <div className="progress" role="progressbar" aria-valuenow={percent}>
            <div className="progress-bar" style={{ width: `${percent}%` }} />
            <span className="progress-label">
              {progress
                ? `${progress.completed} / ${progress.total} — ${progress.current?.fileName ?? ''}`
                : 'Préparation…'}
            </span>
          </div>
        )}

        {error && <p className="banner is-error">{error}</p>}

        <div className="actions">
          <button
            type="button"
            className={`button is-primary${exporting ? ' is-busy' : ''}`}
            disabled={!canExport}
            onClick={handleExport}
          >
            {exporting ? (
              <>
                <span className="spinner" aria-hidden="true" />
                Export en cours…
              </>
            ) : (
              'Exporter le package logo'
            )}
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
