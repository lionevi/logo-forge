/**
 * Chef d'orchestre de l'export.
 *
 * Il enchaîne le planificateur et le moteur Illustrator : pour chaque fichier du
 * plan, il duplique le document, lui applique la déclinaison chromatique,
 * l'exporte, puis referme le duplicata.
 *
 * Le moteur est **injecté** : ce module reste donc dans `src/core/` sans jamais
 * appeler Illustrator lui-même, et se teste avec un moteur factice.
 */

import { createDirectories } from './exporter'
import { planExport } from './planner'
import type {
  ActiveDocumentInfo,
  ColorMode,
  ColorScheme,
  DocumentHandle,
  ExportConfig,
  ExportFailure,
  ExportProgress,
  ExportReport,
  FileWriter,
  IllustratorEngine,
  PlannedFile,
} from './types'

/** Résolution appliquée aux formats vectoriels, sans effet sur le rendu. */
const VECTOR_RESOLUTION = 72

/** Création de dossiers ; seule partie du `FileWriter` utile ici. */
export type DirectoryCreator = Pick<FileWriter, 'ensureDirectory'>

/** Drapeau d'annulation, relevé par l'interface. */
export interface AbortFlag {
  aborted: boolean
}

/** Paramètres d'un export orchestré. */
export interface ExportOptions {
  /** Configuration saisie dans le panneau. */
  config: ExportConfig
  /** Moteur Illustrator, réel en production, factice en test. */
  engine: IllustratorEngine
  /** Créateur de dossiers ; Illustrator n'ouvre pas un dossier manquant. */
  writer: DirectoryCreator
  /** Dossier racine choisi par l'utilisateur, en chemin natif. */
  destination: string
  /** Index du plan de travail exporté, base 0. */
  artboardIndex?: number
  /** Appelé après chaque fichier traité, réussi ou non. */
  onProgress?: (progress: ExportProgress) => void
  /** Interrompt l'export dès que possible ; vérifié avant chaque fichier. */
  signal?: AbortFlag
  /** Interrompt au premier échec au lieu de poursuivre le lot. */
  stopOnError?: boolean
}

/** Traduit une déclinaison du plan en déclinaison applicable au document. */
export function colorSchemeFor(mode: ColorMode): ColorScheme {
  switch (mode) {
    case 'full-color':
      return 'original'
    case 'black':
      return 'black'
    // La réserve est un logo blanc, destiné à être posé sur un aplat de couleur.
    case 'white':
    case 'knockout':
      return 'white'
    case 'grayscale':
      return 'grayscale'
  }
}

/**
 * Résolution à demander au moteur pour un fichier donné.
 *
 * Le plan raisonne en pixels (côté le plus long) ; Illustrator raisonne en ppp.
 * Le plan de travail étant exprimé en points (1 pt = 1/72 pouce), une taille de
 * `n` pixels sur un plan de `largeur` points demande `n / largeur * 72` ppp.
 */
export function resolutionFor(file: PlannedFile, artboardWidthPoints: number): number {
  if (file.size === null) return VECTOR_RESOLUTION
  if (!Number.isFinite(artboardWidthPoints) || artboardWidthPoints <= 0) {
    return VECTOR_RESOLUTION
  }
  return (file.size / artboardWidthPoints) * VECTOR_RESOLUTION
}

/**
 * Assemble un chemin natif absolu à partir du dossier de destination et du
 * chemin relatif du plan.
 *
 * Le séparateur est déduit de la destination : un chemin Windows contient des
 * antislashs, un chemin POSIX n'en a pas.
 */
export function toNativePath(destination: string, relativePath: string): string {
  const separator = destination.includes('\\') ? '\\' : '/'
  const root = destination.replace(/[\\/]+$/, '')
  const tail = relativePath.split('/').filter(Boolean).join(separator)
  return tail.length === 0 ? root : `${root}${separator}${tail}`
}

/** Extrait un message lisible de n'importe quelle valeur levée. */
function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Referme un duplicata sans jamais faire échouer l'export à cause de la
 * fermeture elle-même : un document resté ouvert est gênant, pas fatal.
 *
 * @returns un message d'erreur si la fermeture a échoué, `null` sinon.
 */
async function closeQuietly(
  engine: IllustratorEngine,
  handle: DocumentHandle,
): Promise<string | null> {
  try {
    await engine.closeDocument(handle)
    return null
  } catch (error) {
    return toMessage(error)
  }
}

/**
 * Exécute un export complet.
 *
 * L'échec d'un fichier n'interrompt pas le lot : chaque erreur est consignée
 * dans {@link ExportReport.failures}, avec le nom du fichier et la cause.
 *
 * @throws {Error} si aucun document n'est ouvert, ou si le plan comporte une
 * erreur bloquante — deux cas où poursuivre n'aurait aucun sens.
 */
export async function runExport(options: ExportOptions): Promise<ExportReport> {
  const {
    config,
    engine,
    writer,
    destination,
    artboardIndex = 0,
    onProgress,
    signal,
    stopOnError = false,
  } = options

  const startedAt = Date.now()

  // 1. Document actif.
  const document: ActiveDocumentInfo | null = engine.getActiveDocument()
  if (!document) {
    throw new Error(
      "Aucun document Illustrator ouvert : ouvrez le logo à exporter avant de lancer l'export.",
    )
  }

  // 2. Plan.
  const plan = planExport(config)
  const blocking = plan.issues.filter((issue) => issue.level === 'error')
  if (blocking.length > 0) {
    throw new Error(
      `Le plan comporte des erreurs bloquantes : ${blocking
        .map((issue) => issue.message)
        .join(' ')}`,
    )
  }

  await createDirectories(plan, {
    ensureDirectory: (path) => writer.ensureDirectory(toNativePath(destination, path)),
    writeFile: async () => {
      // Le moteur Illustrator écrit lui-même les fichiers : ce writer ne sert
      // qu'à préparer l'arborescence.
    },
  })

  const written: PlannedFile[] = []
  const failures: ExportFailure[] = []
  let cancelled = false

  // 3. Un duplicata par fichier : la déclinaison chromatique est destructrice,
  // et réutiliser un document déjà teinté fausserait les fichiers suivants.
  for (const file of plan.files) {
    if (signal?.aborted) {
      cancelled = true
      break
    }

    let handle: DocumentHandle | null = null
    try {
      handle = await engine.duplicateActiveDocument()
      await engine.applyColorScheme(handle, colorSchemeFor(file.colorMode))
      await engine.exportDocument(handle, {
        file,
        outputPath: toNativePath(destination, file.path),
        artboardIndex,
        resolution: resolutionFor(file, document.artboardWidthPoints),
        quality: config.quality,
        background: config.background,
      })
      written.push(file)
    } catch (error) {
      failures.push({ file, message: `${file.path} — ${toMessage(error)}` })
    } finally {
      if (handle !== null) {
        const closeError = await closeQuietly(engine, handle)
        if (closeError !== null) {
          failures.push({
            file,
            message: `${file.path} — duplicata non refermé : ${closeError}`,
          })
        }
      }
    }

    onProgress?.({
      completed: written.length + failures.length,
      total: plan.totalFiles,
      current: file,
    })

    if (stopOnError && failures.length > 0) {
      cancelled = true
      break
    }
  }

  return {
    document,
    plan,
    destination,
    written,
    failures,
    cancelled,
    durationMs: Date.now() - startedAt,
  }
}

/** Bilan lisible d'un export orchestré, affiché dans le panneau. */
export function summarizeReport(report: ExportReport): string {
  const seconds = (report.durationMs / 1000).toFixed(1)
  const parts = [`${report.written.length} fichiers écrits en ${seconds} s`]

  if (report.failures.length > 0) parts.push(`${report.failures.length} échecs`)
  if (report.cancelled) parts.push('export interrompu')

  return parts.join(' · ')
}
