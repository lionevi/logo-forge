/**
 * Accès au module `illustrator` fourni par l'hôte UXP.
 *
 * Ce module est le *seul* point où `require('illustrator')` est appelé. Il est
 * isolé pour deux raisons : les tests peuvent y injecter une doublure, et le
 * reste du code n'a jamais à se demander si l'hôte est disponible.
 *
 * Note : c'est bien `require('illustrator')`, jamais `require('photoshop')` —
 * ce dernier n'existe pas dans un plugin Illustrator.
 */

/**
 * Surface du module `illustrator` réellement utilisée par le moteur.
 *
 * Adobe ne publie pas de typage npm pour l'API UXP d'Illustrator : cette
 * interface décrit à la main le sous-ensemble dont nous dépendons, ce qui évite
 * `any` tout en gardant la compilation possible hors d'Illustrator.
 */
export interface IllustratorHost {
  app: IllustratorApp
  /** Énumération des formats d'export. */
  ExportType?: Record<string, unknown>
  /** Énumération de l'espace colorimétrique d'un document. */
  DocumentColorSpace?: Record<string, unknown>
  /** Énumération du placement lors d'une duplication. */
  ElementPlacement?: Record<string, unknown>
  /** Constructeurs de couleurs et d'options, exposés par le module. */
  [key: string]: unknown
}

export interface IllustratorApp {
  activeDocument?: IllustratorDocument
  documents: DocumentCollection
  [key: string]: unknown
}

export interface DocumentCollection {
  length: number
  add?(...args: unknown[]): IllustratorDocument
  [key: string]: unknown
}

export interface IllustratorDocument {
  name: string
  /** Objet fichier ; `fsName` sous ExtendScript, `nativePath` sous UXP. */
  fullName?: { fsName?: string; nativePath?: string; name?: string }
  path?: string
  artboards: ArtboardCollection
  pathItems: ItemCollection
  pageItems: ItemCollection
  documentColorSpace?: unknown
  width?: number
  height?: number
  /** Présent selon la version de l'hôte ; le moteur teste avant d'appeler. */
  duplicate?(): IllustratorDocument | Promise<IllustratorDocument>
  exportFile(file: unknown, type: unknown, options?: unknown): void | Promise<void>
  saveAs(file: unknown, options?: unknown): void | Promise<void>
  close(saveOptions?: unknown): void | Promise<void>
  [key: string]: unknown
}

export interface ArtboardCollection {
  length: number
  setActiveArtboardIndex?(index: number): void
  [index: number]: unknown
}

/** Élément de page porteur d'un remplissage et d'un contour. */
export interface PageItemLike {
  filled?: boolean
  stroked?: boolean
  fillColor?: unknown
  strokeColor?: unknown
  [key: string]: unknown
}

export interface ItemCollection {
  length: number
  [index: number]: PageItemLike
}

/** Doublure injectée par les tests ; `null` en production. */
let injectedHost: IllustratorHost | null = null

/** Module réel, mémorisé après le premier chargement réussi. */
let cachedHost: IllustratorHost | null = null

/**
 * Remplace le module hôte, pour les tests.
 * Passer `null` restaure le chargement normal par `require`.
 */
export function setIllustratorHost(host: IllustratorHost | null): void {
  injectedHost = host
  cachedHost = null
}

/** Indique si un module Illustrator est joignable, sans lever. */
export function isIllustratorAvailable(): boolean {
  if (injectedHost) return true
  try {
    return loadIllustratorHost() !== null
  } catch {
    return false
  }
}

/**
 * Renvoie le module `illustrator`.
 * @throws {Error} hors d'Illustrator, avec un message exploitable par l'interface.
 */
export function loadIllustratorHost(): IllustratorHost {
  if (injectedHost) return injectedHost
  if (cachedHost) return cachedHost

  if (typeof require !== 'function') {
    throw new Error(
      "L'API Illustrator est introuvable : le panneau doit s'exécuter dans Illustrator.",
    )
  }

  let module: unknown
  try {
    module = require('illustrator')
  } catch (error) {
    throw new Error(
      `Chargement du module « illustrator » impossible : ${
        error instanceof Error ? error.message : String(error)
      }`,
    )
  }

  if (!module || typeof module !== 'object' || !('app' in module)) {
    throw new Error(
      "Le module « illustrator » n'expose pas d'objet `app` : version d'hôte incompatible.",
    )
  }

  cachedHost = module as IllustratorHost
  return cachedHost
}
