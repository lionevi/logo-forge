/**
 * Moteur d'export.
 *
 * Le moteur ne connaît ni Illustrator ni UXP : il reçoit un {@link FileWriter}
 * et un {@link DocumentRenderer} injectés. En production ils sont adossés au
 * système de fichiers UXP et à l'API Illustrator ; en test ils sont remplacés
 * par des doublures en mémoire.
 */

import type {
  DocumentRenderer,
  ExportFailure,
  ExportPlan,
  ExportProgress,
  ExportResult,
  FileWriter,
  PlannedFile,
} from './types'

export interface ExportOptions {
  /** Appelé après chaque fichier traité, réussi ou non. */
  onProgress?: (progress: ExportProgress) => void
  /**
   * Interrompt l'export dès que possible. La boucle vérifie le signal avant
   * chaque fichier ; le fichier en cours d'écriture est toujours terminé.
   */
  signal?: { aborted: boolean }
  /**
   * Interrompt l'export au premier échec au lieu de poursuivre.
   * Par défaut l'export continue et rapporte tous les échecs à la fin.
   */
  stopOnError?: boolean
}

/** Extrait un message lisible de n'importe quelle valeur levée. */
function toMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}

/**
 * Crée les dossiers d'un plan, parents d'abord.
 *
 * Les dossiers sont déjà triés par profondeur par le planificateur, ce qui rend
 * la création séquentielle sûre même si `ensureDirectory` n'est pas récursif.
 */
export async function createDirectories(
  plan: ExportPlan,
  writer: FileWriter,
): Promise<void> {
  for (const directory of plan.directories) {
    await writer.ensureDirectory(directory)
  }
}

/**
 * Exécute un plan d'export : crée l'arborescence, rend chaque fichier puis
 * l'écrit.
 *
 * L'export n'échoue jamais en bloc sur un fichier isolé : chaque erreur est
 * collectée dans {@link ExportResult.failures}, de sorte qu'un pack de 200
 * fichiers ne soit pas perdu à cause d'un seul format récalcitrant.
 */
export async function runExport(
  plan: ExportPlan,
  writer: FileWriter,
  renderer: DocumentRenderer,
  options: ExportOptions = {},
): Promise<ExportResult> {
  const startedAt = Date.now()
  const written: PlannedFile[] = []
  const failures: ExportFailure[] = []
  let cancelled = false

  const blocking = plan.issues.some((issue) => issue.level === 'error')
  if (blocking) {
    throw new Error(
      "Le plan comporte des erreurs bloquantes : corrigez la configuration avant d'exporter.",
    )
  }

  await createDirectories(plan, writer)

  for (const file of plan.files) {
    if (options.signal?.aborted) {
      cancelled = true
      break
    }

    try {
      const data = await renderer.render(file)
      await writer.writeFile(file.path, data)
      written.push(file)
    } catch (error) {
      failures.push({ file, message: toMessage(error) })
      if (options.stopOnError) {
        cancelled = true
        options.onProgress?.({
          completed: written.length + failures.length,
          total: plan.totalFiles,
          current: file,
        })
        break
      }
    }

    options.onProgress?.({
      completed: written.length + failures.length,
      total: plan.totalFiles,
      current: file,
    })
  }

  return {
    written,
    failures,
    cancelled,
    durationMs: Date.now() - startedAt,
  }
}

/** Bilan lisible d'un export terminé, affiché dans le panneau. */
export function summarizeResult(result: ExportResult): string {
  const seconds = (result.durationMs / 1000).toFixed(1)
  const parts = [`${result.written.length} fichiers écrits en ${seconds} s`]

  if (result.failures.length > 0) {
    parts.push(`${result.failures.length} échecs`)
  }
  if (result.cancelled) {
    parts.push('export interrompu')
  }

  return parts.join(' · ')
}

/**
 * `FileWriter` en mémoire, utilisé par les tests et la prévisualisation du
 * panneau. Il enregistre exactement ce qui aurait été écrit sur le disque.
 */
export function createMemoryWriter(): FileWriter & {
  files: Map<string, Uint8Array | string>
  directories: Set<string>
} {
  const files = new Map<string, Uint8Array | string>()
  const directories = new Set<string>()

  return {
    files,
    directories,
    async ensureDirectory(path: string) {
      directories.add(path)
    },
    async writeFile(path: string, data: Uint8Array | string) {
      files.set(path, data)
    },
  }
}
