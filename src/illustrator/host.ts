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
 * Environnement d'exécution du panneau.
 *
 * - `uxp` : plugin UXP dans Illustrator, l'API est joignable.
 * - `cep` : extension CEP — Chromium embarqué, sans module `uxp` ni
 *   `illustrator`. Le panneau s'affiche, mais n'exporte pas.
 * - `none` : navigateur ou test.
 */
export type HostEnvironment = 'uxp' | 'cep' | 'none'

/**
 * Hôte de repli, renvoyé hors UXP.
 *
 * Il expose la forme attendue avec un document absent, de sorte qu'aucun
 * appelant n'ait à se prémunir d'un hôte manquant : sans lui, le moindre accès
 * lèverait et laisserait le panneau blanc.
 */
function createFallbackHost(): IllustratorHost {
  return {
    app: {
      activeDocument: undefined,
      documents: { length: 0 },
    },
  }
}

/** Indique si le module `uxp` répond, seul marqueur fiable d'un hôte UXP. */
function isUxp(): boolean {
  try {
    return typeof require === 'function' && require('uxp') !== undefined
  } catch {
    return false
  }
}

/**
 * Indique si le panneau tourne dans une extension CEP.
 *
 * CEP injecte `window.__adobe_cep__` dans chaque panneau : c'est le marqueur le
 * plus sûr, disponible que l'intégration Node soit active ou non.
 */
function isCep(): boolean {
  try {
    return (
      typeof window !== 'undefined' &&
      (window as unknown as Record<string, unknown>).__adobe_cep__ !== undefined
    )
  } catch {
    return false
  }
}

/** Détecte l'environnement d'exécution courant. */
export function getHostEnvironment(): HostEnvironment {
  if (injectedHost) return 'uxp'
  if (isUxp()) return 'uxp'
  if (isCep()) return 'cep'
  return 'none'
}

/**
 * Remplace le module hôte, pour les tests.
 * Passer `null` restaure la détection normale.
 */
export function setIllustratorHost(host: IllustratorHost | null): void {
  injectedHost = host
  cachedHost = null
}

/**
 * Indique si l'API Illustrator est réellement joignable.
 *
 * Faux en CEP : le panneau y fonctionne, mais aucun export n'est possible tant
 * que le pont ExtendScript n'est pas en place.
 */
export function isIllustratorAvailable(): boolean {
  return getHostEnvironment() === 'uxp'
}

/**
 * Renvoie le module `illustrator`, ou un hôte de repli hors UXP.
 *
 * Ne lève jamais : en CEP comme au navigateur, un panneau dégradé vaut mieux
 * qu'un panneau blanc.
 */
export function getIllustratorHost(): IllustratorHost {
  if (injectedHost) return injectedHost
  if (cachedHost) return cachedHost

  if (!isUxp()) {
    cachedHost = createFallbackHost()
    return cachedHost
  }

  try {
    // UXP fournit ses modules par `require` à l'exécution : un import ES
    // échouerait au build comme au runtime.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const module = require('illustrator')
    if (module && typeof module === 'object' && 'app' in module) {
      cachedHost = module as IllustratorHost
      return cachedHost
    }
  } catch {
    // L'hôte se dit UXP mais n'expose pas le module : on dégrade plutôt que
    // de faire échouer le rendu du panneau.
  }

  cachedHost = createFallbackHost()
  return cachedHost
}

/**
 * Renvoie le module `illustrator`.
 * @throws {Error} hors UXP, avec un message exploitable par l'interface.
 */
export function loadIllustratorHost(): IllustratorHost {
  if (injectedHost) return injectedHost

  const environment = getHostEnvironment()
  if (environment !== 'uxp') {
    throw new Error(
      environment === 'cep'
        ? "L'API Illustrator n'est pas joignable en CEP : le module « illustrator » " +
            "n'existe que dans un plugin UXP."
        : "L'API Illustrator est introuvable : le panneau doit s'exécuter dans Illustrator.",
    )
  }

  return getIllustratorHost()
}
