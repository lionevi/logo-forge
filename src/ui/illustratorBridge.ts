/**
 * Pont entre le cœur métier et les API UXP / Illustrator.
 *
 * Il fournit à l'interface le `FileWriter` adossé au système de fichiers UXP,
 * et lui donne accès au moteur Illustrator réel. Les deux sont décrits par des
 * interfaces de `core/types.ts`, ce qui laisse le cœur métier testable sans
 * Illustrator.
 */

import type { ActiveDocumentInfo, FileWriter, IllustratorEngine } from '../core/types'
import {
  getHostEnvironment,
  isIllustratorAvailable,
  type HostEnvironment,
} from '../illustrator/host'
import {
  createIllustratorEngine,
  getActiveDocument,
} from '../illustrator/illustratorEngine'

/**
 * Sous-ensemble de l'API `uxp.storage` réellement utilisé ici.
 * Le typage local évite une dépendance de compilation aux types UXP, absents
 * de l'environnement de CI.
 */
export interface UxpEntry {
  isFolder: boolean
  name: string
  /** Chemin natif complet de l'entrée, tel que le système de fichiers le voit. */
  nativePath: string
  getEntry(name: string): Promise<UxpEntry>
  createFolder(name: string): Promise<UxpEntry>
  createFile(name: string, options?: { overwrite?: boolean }): Promise<UxpFileEntry>
}

interface UxpFileEntry extends UxpEntry {
  write(data: Uint8Array | string, options?: { format?: unknown }): Promise<void>
}

interface UxpFileSystem {
  getFolder(): Promise<UxpEntry>
}

/** Indique si le code s'exécute bien dans un hôte UXP. */
export function isUxpAvailable(): boolean {
  return typeof require === 'function' && typeof window !== 'undefined'
}

/** Charge le module `uxp` de l'hôte, ou échoue avec un message explicite. */
function loadStorage(): { localFileSystem: UxpFileSystem } {
  if (typeof require !== 'function') {
    throw new Error(
      "Le module UXP n'est pas disponible : le panneau doit être exécuté dans Illustrator.",
    )
  }
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const uxp = require('uxp') as { storage: { localFileSystem: UxpFileSystem } }
  return uxp.storage
}

/**
 * Demande à l'utilisateur de choisir le dossier de destination du pack.
 * Renvoie `null` si la sélection est annulée.
 */
export async function pickDestinationFolder(): Promise<UxpEntry | null> {
  const storage = loadStorage()
  try {
    return await storage.localFileSystem.getFolder()
  } catch {
    return null
  }
}

/**
 * Crée un `FileWriter` enraciné dans un dossier UXP.
 *
 * Les dossiers déjà créés sont mémorisés : sur un pack de plusieurs centaines de
 * fichiers, cela évite autant d'allers-retours inutiles au système de fichiers.
 */
export function createUxpWriter(root: UxpEntry): FileWriter {
  const folders = new Map<string, UxpEntry>([['', root]])

  async function resolveFolder(path: string): Promise<UxpEntry> {
    const cached = folders.get(path)
    if (cached) return cached

    const segments = path.split('/').filter(Boolean)
    let current = root
    let walked = ''

    for (const segment of segments) {
      walked = walked ? `${walked}/${segment}` : segment
      const known = folders.get(walked)
      if (known) {
        current = known
        continue
      }

      let next: UxpEntry
      try {
        const existing = await current.getEntry(segment)
        // Un fichier homonyme empêcherait la création : on le signale.
        if (!existing.isFolder) {
          throw new Error(
            `Impossible de créer le dossier « ${walked} » : un fichier porte déjà ce nom.`,
          )
        }
        next = existing
      } catch (error) {
        if (error instanceof Error && error.message.startsWith('Impossible')) {
          throw error
        }
        next = await current.createFolder(segment)
      }

      folders.set(walked, next)
      current = next
    }

    return current
  }

  return {
    async ensureDirectory(path: string) {
      await resolveFolder(path)
    },
    async writeFile(path: string, data: Uint8Array | string) {
      const lastSlash = path.lastIndexOf('/')
      const directory = lastSlash === -1 ? '' : path.slice(0, lastSlash)
      const fileName = lastSlash === -1 ? path : path.slice(lastSlash + 1)

      const folder = await resolveFolder(directory)
      const file = await folder.createFile(fileName, { overwrite: true })
      await file.write(data)
    },
  }
}

/* -------------------------------------------------------------------------- *
 * Moteur Illustrator
 * -------------------------------------------------------------------------- */

/**
 * Renvoie le moteur d'export réel.
 *
 * Le moteur est construit à chaque appel : il ne détient aucun état, et le
 * document actif peut changer entre deux exports.
 */
export function getIllustratorEngine(): IllustratorEngine {
  return createIllustratorEngine()
}

/** Chemin natif d'un dossier UXP, sans jamais lever. */
export function folderPath(entry: UxpEntry | null): string | null {
  try {
    return entry?.nativePath ?? null
  } catch {
    return null
  }
}

/**
 * Document Illustrator actif, ou `null` si aucun n'est ouvert — y compris hors
 * d'Illustrator, où le panneau doit rester utilisable en lecture.
 */
export function readActiveDocument(): ActiveDocumentInfo | null {
  try {
    return getActiveDocument()
  } catch {
    // `getActiveDocument` se protège déjà, mais le panneau l'appelle pendant le
    // rendu : une erreur imprévue y démonterait tout l'arbre React.
    return null
  }
}

/** Indique si l'API Illustrator répond, donc si un export est possible. */
export function isIllustratorReady(): boolean {
  try {
    return isIllustratorAvailable()
  } catch {
    return false
  }
}

/** Environnement d'exécution du panneau : `uxp`, `cep` ou `none`. */
export function getPanelEnvironment(): HostEnvironment {
  try {
    return getHostEnvironment()
  } catch {
    return 'none'
  }
}

/* -------------------------------------------------------------------------- *
 * Shell UXP
 * -------------------------------------------------------------------------- */

/** Sous-ensemble de `uxp.shell` utilisé pour révéler le pack exporté. */
interface UxpShell {
  openPath(path: string): Promise<void>
}

/**
 * Ouvre un dossier dans le Finder ou l'Explorateur.
 *
 * @returns `true` si l'hôte a pris la demande, `false` sinon — l'échec n'est
 * jamais fatal : le chemin reste affiché dans le panneau.
 */
export async function revealInFileManager(path: string): Promise<boolean> {
  if (typeof require !== 'function') return false

  try {
    // UXP fournit ses modules par `require` à l'exécution : c'est le seul
    // moyen d'y accéder, un import ES échouerait au build comme au runtime.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const uxp = require('uxp') as { shell?: UxpShell }
    if (!uxp.shell) return false
    await uxp.shell.openPath(path)
    return true
  } catch {
    return false
  }
}

/* -------------------------------------------------------------------------- *
 * Sondage du document actif
 * -------------------------------------------------------------------------- */

/** Nombre d'échecs consécutifs au-delà duquel le sondage s'arrête. */
export const POLL_FAILURE_LIMIT = 3

export interface DocumentPollerOptions {
  /** Période du sondage, en millisecondes. */
  intervalMs: number
  /** Appelé à chaque relecture réussie. */
  onDocument: (document: ActiveDocumentInfo | null) => void
  /** Appelé une seule fois, quand le sondage renonce. */
  onDisabled?: (reason: string) => void
  /** Minuteur injectable, pour les tests. */
  schedule?: (callback: () => void, delayMs: number) => number
  /** Annulation du minuteur, pour les tests. */
  cancel?: (handle: number) => void
}

export interface DocumentPoller {
  /** Arrête le sondage ; appelable plusieurs fois sans effet de bord. */
  stop(): void
}

/**
 * Relit périodiquement le document actif.
 *
 * Illustrator ne prévient pas un panneau qu'on a changé de document : le
 * sondage est la seule voie. Il est ici blindé de bout en bout — une erreur
 * n'interrompt jamais le minuteur, et au bout de {@link POLL_FAILURE_LIMIT}
 * échecs consécutifs le sondage s'arrête plutôt que de s'acharner, cas typique
 * d'un hôte CEP où l'API Illustrator n'existe pas.
 */
export function createDocumentPoller(options: DocumentPollerOptions): DocumentPoller {
  const {
    intervalMs,
    onDocument,
    onDisabled,
    schedule = (callback, delay) => setInterval(callback, delay) as unknown as number,
    cancel = (handle) => clearInterval(handle),
  } = options

  let failures = 0
  let stopped = false
  let handle: number | null = null

  const stop = () => {
    if (stopped) return
    stopped = true
    if (handle !== null) cancel(handle)
    handle = null
  }

  handle = schedule(() => {
    if (stopped) return

    try {
      onDocument(readActiveDocument())
      failures = 0
    } catch (error) {
      failures += 1
      const message = error instanceof Error ? error.message : String(error)
      console.warn(
        `[Logo Forge] échec de relecture du document (${failures}/${POLL_FAILURE_LIMIT}) : ${message}`,
      )

      if (failures >= POLL_FAILURE_LIMIT) {
        stop()
        console.warn('[Logo Forge] CEP mode - polling disabled')
        // Le rappel est lui aussi protégé : une erreur d'interface ne doit pas
        // remonter dans le minuteur, où plus personne ne l'intercepterait.
        try {
          onDisabled?.(message)
        } catch {
          /* ignoré volontairement */
        }
      }
    }
  }, intervalMs)

  return { stop }
}
