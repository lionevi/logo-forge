/**
 * Pont entre le cœur métier et les API UXP / Illustrator.
 *
 * C'est le seul module de l'interface qui touche à `require('uxp')` et
 * `require('illustrator')`. Il implémente les interfaces `FileWriter` et
 * `DocumentRenderer` définies dans `core/types.ts`, ce qui permet de tester
 * planificateur et moteur d'export sans Illustrator.
 */

import type { DocumentRenderer, FileWriter, PlannedFile } from '../core/types'

/**
 * Sous-ensemble de l'API `uxp.storage` réellement utilisé ici.
 * Le typage local évite une dépendance de compilation aux types UXP, absents
 * de l'environnement de CI.
 */
interface UxpEntry {
  isFolder: boolean
  name: string
  getEntry(name: string): Promise<UxpEntry>
  createFolder(name: string): Promise<UxpEntry>
  createFile(name: string, options?: { overwrite?: boolean }): Promise<UxpFileEntry>
}

interface UxpFileEntry extends UxpEntry {
  write(data: Uint8Array | string, options?: { format?: unknown }): Promise<void>
  nativePath: string
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

/**
 * `DocumentRenderer` de démonstration, utilisé hors Illustrator.
 *
 * Il produit un contenu déterministe qui décrit le fichier attendu, ce qui rend
 * l'arborescence d'un pack inspectable sans lancer Illustrator.
 */
export function createStubRenderer(): DocumentRenderer {
  return {
    async render(file: PlannedFile) {
      return [
        `Logo Forge — fichier planifié`,
        `chemin      : ${file.path}`,
        `variante    : ${file.variant}`,
        `déclinaison : ${file.colorMode}`,
        `format      : ${file.format}`,
        `espace      : ${file.colorSpace}`,
        `usage       : ${file.usage}`,
        `taille      : ${file.size === null ? 'vectoriel' : `${file.size} px`}`,
        `transparent : ${file.transparent ? 'oui' : 'non'}`,
        '',
      ].join('\n')
    },
  }
}
