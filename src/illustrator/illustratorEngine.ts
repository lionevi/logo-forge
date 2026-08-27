/**
 * Moteur d'export Illustrator.
 *
 * Toutes les opérations qui touchent réellement Illustrator vivent ici. Le
 * module dépend de `host.ts` pour obtenir `require('illustrator')`, ce qui rend
 * l'ensemble testable en injectant une doublure.
 *
 * Chaque appel à l'hôte est enveloppé : une erreur d'Illustrator est retraduite
 * en `Error` portant le nom du fichier concerné et la cause d'origine, de sorte
 * que le chef d'orchestre puisse la consigner sans deviner ce qui a échoué.
 */

import { rgbToHex, toGrayscale } from '../core/colorManager'
import type {
  ActiveDocumentInfo,
  ColorScheme,
  DocumentHandle,
  IllustratorEngine,
  RenderRequest,
} from '../core/types'
import type { IllustratorDocument, IllustratorHost, PageItemLike } from './host'
import { loadIllustratorHost } from './host'

/** Résolution de référence d'Illustrator : 100 % d'échelle vaut 72 ppp. */
const BASE_RESOLUTION = 72

/** Options passées à `exportAsSVG`. */
export interface SvgExportOptions {
  /** Incorpore les images liées plutôt que de les référencer. */
  embedImages?: boolean
  /** Conserve les données d'édition Illustrator dans le SVG. */
  preserveEditability?: boolean
  /** Index du plan de travail exporté, base 0. */
  artboardIndex?: number
}

/** Options passées à `exportAsPNG`. */
export interface PngExportOptions {
  /** Résolution en points par pouce ; 72, 150 et 300 sont les valeurs usuelles. */
  resolution?: number
  /** Conserve un fond transparent. */
  transparency?: boolean
  artboardIndex?: number
}

/** Options passées à `exportAsPDF`. */
export interface PdfExportOptions {
  /** Version de compatibilité PDF, ex. `Compatibility.ACROBAT5`. */
  compatibility?: unknown
  /** Conserve les données d'édition Illustrator dans le PDF. */
  preserveEditability?: boolean
  artboardIndex?: number
}

/** Options passées à `exportAsEPS`. */
export interface EpsExportOptions {
  /** Version de compatibilité EPS. */
  compatibility?: unknown
  /** Incorpore les polices utilisées. */
  embedAllFonts?: boolean
  artboardIndex?: number
}

/** Enveloppe une erreur de l'hôte en y ajoutant le contexte de l'appel. */
function wrapError(context: string, error: unknown): Error {
  const cause = error instanceof Error ? error.message : String(error)
  return new Error(`${context} : ${cause}`)
}

/**
 * Affecte une propriété seulement si l'objet la déclare déjà.
 *
 * Les jeux d'options d'Illustrator varient d'une version à l'autre : écrire une
 * propriété inconnue lève sur certaines versions. On n'écrit donc que ce que
 * l'hôte reconnaît, et on ignore silencieusement le reste.
 */
function assignIfSupported(
  target: Record<string, unknown>,
  key: string,
  value: unknown,
): void {
  if (value === undefined) return
  if (!(key in target)) return
  target[key] = value
}

/**
 * Instancie un objet exposé par le module `illustrator` (options d'export,
 * couleurs, descripteur de fichier).
 *
 * @throws {Error} si l'hôte n'expose pas ce constructeur.
 */
function construct(host: IllustratorHost, name: string): Record<string, unknown> {
  const candidate = host[name]
  if (typeof candidate !== 'function') {
    throw new Error(
      `Le module « illustrator » n'expose pas le constructeur ${name} : version d'hôte incompatible.`,
    )
  }
  // Le module UXP expose des constructeurs sans signature typée : le cast est
  // circonscrit à cette ligne, et `construct` est le seul endroit qui en use.
  const Factory = candidate as new () => Record<string, unknown>
  return new Factory()
}

/**
 * Construit la valeur attendue par `exportFile`/`saveAs` pour désigner un
 * fichier de sortie.
 *
 * L'API UXP accepte un chemin natif direct ; les hôtes plus anciens attendent un
 * objet `File`. On privilégie le `File` quand le module l'expose.
 */
function toFileTarget(host: IllustratorHost, outputPath: string): unknown {
  const fileFactory = host.File
  if (typeof fileFactory === 'function') {
    const Factory = fileFactory as new (path: string) => unknown
    return new Factory(outputPath)
  }
  return outputPath
}

/** Sélectionne le plan de travail à exporter, si l'hôte le permet. */
function selectArtboard(document: IllustratorDocument, index: number): void {
  const artboards = document.artboards
  if (!artboards || typeof artboards.setActiveArtboardIndex !== 'function') return
  if (index < 0 || index >= artboards.length) return
  artboards.setActiveArtboardIndex(index)
}

/** Applique le cadrage sur un unique plan de travail, quand les options l'admettent. */
function restrictToArtboard(options: Record<string, unknown>, index: number): void {
  assignIfSupported(options, 'saveMultipleArtboards', true)
  assignIfSupported(options, 'artboardRange', String(index + 1))
}

/**
 * Largeur du premier plan de travail, en points.
 *
 * `artboardRect` est un quadruplet `[gauche, haut, droite, bas]` en points ; la
 * largeur en est la différence horizontale. On retombe sur `document.width`
 * quand l'hôte n'expose pas les rectangles.
 */
function readArtboardWidth(document: IllustratorDocument): number {
  try {
    const artboard = document.artboards?.[0] as { artboardRect?: unknown } | undefined
    const rect = artboard?.artboardRect

    if (Array.isArray(rect) && rect.length >= 3) {
      const left = Number(rect[0])
      const right = Number(rect[2])
      const width = Math.abs(right - left)
      if (Number.isFinite(width) && width > 0) return width
    }

    const fallback = Number(document.width)
    return Number.isFinite(fallback) && fallback > 0 ? fallback : 0
  } catch {
    return 0
  }
}

/* -------------------------------------------------------------------------- *
 * 1. Lecture du document actif
 * -------------------------------------------------------------------------- */

/**
 * Renvoie un signalement du document Illustrator actif.
 *
 * @returns `null` si aucun document n'est ouvert, ou si l'hôte est injoignable.
 */
export function getActiveDocument(): ActiveDocumentInfo | null {
  let host: IllustratorHost
  try {
    host = loadIllustratorHost()
  } catch {
    return null
  }

  try {
    const document = host.app.activeDocument
    if (!document) return null

    // `fsName` est la forme ExtendScript, `nativePath` la forme UXP.
    const fullName = document.fullName
    const path = fullName?.nativePath ?? fullName?.fsName ?? document.path ?? ''

    return {
      name: document.name ?? 'sans-titre',
      path,
      artboardCount: document.artboards?.length ?? 0,
      artboardWidthPoints: readArtboardWidth(document),
    }
  } catch {
    // Illustrator lève quand aucun document n'est ouvert plutôt que de renvoyer
    // `undefined` : les deux cas se traduisent ici par « pas de document ».
    return null
  }
}

/* -------------------------------------------------------------------------- *
 * 2 à 5. Export par format
 * -------------------------------------------------------------------------- */

/** Récupère une valeur d'énumération `ExportType`, ex. `SVG`, `PNG24`. */
function exportType(host: IllustratorHost, name: string): unknown {
  const values = host.ExportType
  if (!values || !(name in values)) {
    throw new Error(
      `Le module « illustrator » n'expose pas ExportType.${name} : version d'hôte incompatible.`,
    )
  }
  return values[name]
}

/**
 * Exporte un plan de travail en SVG.
 *
 * @param document Document Illustrator, généralement un duplicata.
 * @param outputPath Chemin natif absolu du fichier produit.
 */
export async function exportAsSVG(
  document: IllustratorDocument,
  outputPath: string,
  options: SvgExportOptions = {},
): Promise<void> {
  const host = loadIllustratorHost()
  const artboardIndex = options.artboardIndex ?? 0

  try {
    selectArtboard(document, artboardIndex)

    const exportOptions = construct(host, 'ExportOptionsSVG')
    assignIfSupported(exportOptions, 'embedRasterImages', options.embedImages ?? true)
    assignIfSupported(
      exportOptions,
      'preserveEditability',
      options.preserveEditability ?? false,
    )
    // Les polices sont converties en tracés : un logo doit s'afficher à
    // l'identique sans que la police soit installée chez le destinataire.
    assignIfSupported(exportOptions, 'fontType', host.SVGFontType)
    restrictToArtboard(exportOptions, artboardIndex)

    await document.exportFile(
      toFileTarget(host, outputPath),
      exportType(host, 'SVG'),
      exportOptions,
    )
  } catch (error) {
    throw wrapError(`Export SVG de ${outputPath}`, error)
  }
}

/**
 * Exporte un plan de travail en PNG 24 bits.
 *
 * La résolution est traduite en pourcentage d'échelle : Illustrator raisonne en
 * `horizontalScale`/`verticalScale`, où 100 % correspond à 72 ppp.
 */
export async function exportAsPNG(
  document: IllustratorDocument,
  outputPath: string,
  options: PngExportOptions = {},
): Promise<void> {
  const host = loadIllustratorHost()
  const artboardIndex = options.artboardIndex ?? 0
  const resolution = options.resolution ?? BASE_RESOLUTION

  if (!Number.isFinite(resolution) || resolution <= 0) {
    throw new Error(`Résolution PNG invalide pour ${outputPath} : ${resolution}`)
  }

  try {
    selectArtboard(document, artboardIndex)

    const scale = (resolution / BASE_RESOLUTION) * 100
    const exportOptions = construct(host, 'ExportOptionsPNG24')
    assignIfSupported(exportOptions, 'horizontalScale', scale)
    assignIfSupported(exportOptions, 'verticalScale', scale)
    assignIfSupported(exportOptions, 'transparency', options.transparency ?? true)
    assignIfSupported(exportOptions, 'antiAliasing', true)
    // Cadre l'export sur le plan de travail, sans quoi Illustrator rogne sur la
    // boîte englobante du dessin et les tailles demandées ne sont pas tenues.
    assignIfSupported(exportOptions, 'artBoardClipping', true)
    restrictToArtboard(exportOptions, artboardIndex)

    await document.exportFile(
      toFileTarget(host, outputPath),
      exportType(host, 'PNG24'),
      exportOptions,
    )
  } catch (error) {
    throw wrapError(`Export PNG de ${outputPath}`, error)
  }
}

/**
 * Écrit un plan de travail en PDF.
 *
 * Le PDF n'est pas un format d'*export* dans le modèle objet d'Illustrator :
 * il passe par `saveAs` avec un `PDFSaveOptions`.
 */
export async function exportAsPDF(
  document: IllustratorDocument,
  outputPath: string,
  options: PdfExportOptions = {},
): Promise<void> {
  const host = loadIllustratorHost()
  const artboardIndex = options.artboardIndex ?? 0

  try {
    selectArtboard(document, artboardIndex)

    const saveOptions = construct(host, 'PDFSaveOptions')
    assignIfSupported(saveOptions, 'compatibility', options.compatibility)
    assignIfSupported(
      saveOptions,
      'preserveEditability',
      options.preserveEditability ?? true,
    )
    assignIfSupported(saveOptions, 'viewAfterSaving', false)
    restrictToArtboard(saveOptions, artboardIndex)

    await document.saveAs(toFileTarget(host, outputPath), saveOptions)
  } catch (error) {
    throw wrapError(`Export PDF de ${outputPath}`, error)
  }
}

/**
 * Écrit un plan de travail en EPS.
 *
 * Comme le PDF, l'EPS relève de `saveAs` et d'un `EPSSaveOptions` : le modèle
 * objet d'Illustrator ne propose pas d'`ExportType` pour l'EPS.
 */
export async function exportAsEPS(
  document: IllustratorDocument,
  outputPath: string,
  options: EpsExportOptions = {},
): Promise<void> {
  const host = loadIllustratorHost()
  const artboardIndex = options.artboardIndex ?? 0

  try {
    selectArtboard(document, artboardIndex)

    const saveOptions = construct(host, 'EPSSaveOptions')
    assignIfSupported(saveOptions, 'compatibility', options.compatibility)
    assignIfSupported(saveOptions, 'embedAllFonts', options.embedAllFonts ?? true)
    assignIfSupported(saveOptions, 'includeDocumentThumbnails', true)
    restrictToArtboard(saveOptions, artboardIndex)

    await document.saveAs(toFileTarget(host, outputPath), saveOptions)
  } catch (error) {
    throw wrapError(`Export EPS de ${outputPath}`, error)
  }
}

/**
 * Écrit un plan de travail au format natif Illustrator.
 *
 * L'`.ai` est le document lui-même : il passe donc par `saveAs` avec un
 * `IllustratorSaveOptions`.
 */
export async function exportAsAI(
  document: IllustratorDocument,
  outputPath: string,
  options: { compatibility?: unknown; artboardIndex?: number } = {},
): Promise<void> {
  const host = loadIllustratorHost()

  try {
    selectArtboard(document, options.artboardIndex ?? 0)

    const saveOptions = construct(host, 'IllustratorSaveOptions')
    assignIfSupported(saveOptions, 'compatibility', options.compatibility)
    assignIfSupported(saveOptions, 'pdfCompatible', true)

    await document.saveAs(toFileTarget(host, outputPath), saveOptions)
  } catch (error) {
    throw wrapError(`Export AI de ${outputPath}`, error)
  }
}

/**
 * Exporte un plan de travail en JPEG.
 *
 * Le JPEG n'ayant pas de canal alpha, le fond du plan de travail est aplati par
 * Illustrator ; le planificateur en a déjà averti l'utilisateur.
 */
export async function exportAsJPEG(
  document: IllustratorDocument,
  outputPath: string,
  options: { resolution?: number; quality?: number; artboardIndex?: number } = {},
): Promise<void> {
  const host = loadIllustratorHost()
  const artboardIndex = options.artboardIndex ?? 0
  const resolution = options.resolution ?? BASE_RESOLUTION

  try {
    selectArtboard(document, artboardIndex)

    const scale = (resolution / BASE_RESOLUTION) * 100
    const exportOptions = construct(host, 'ExportOptionsJPEG')
    assignIfSupported(exportOptions, 'horizontalScale', scale)
    assignIfSupported(exportOptions, 'verticalScale', scale)
    assignIfSupported(exportOptions, 'qualitySetting', options.quality ?? 90)
    assignIfSupported(exportOptions, 'antiAliasing', true)
    assignIfSupported(exportOptions, 'artBoardClipping', true)
    restrictToArtboard(exportOptions, artboardIndex)

    await document.exportFile(
      toFileTarget(host, outputPath),
      exportType(host, 'JPEG'),
      exportOptions,
    )
  } catch (error) {
    throw wrapError(`Export JPEG de ${outputPath}`, error)
  }
}

/* -------------------------------------------------------------------------- *
 * 6. Duplication du document
 * -------------------------------------------------------------------------- */

/**
 * Duplique le document afin de le teinter sans toucher à l'original.
 *
 * Deux stratégies, dans cet ordre :
 *
 * 1. `document.duplicate()`, quand l'hôte l'expose ;
 * 2. sinon, création d'un document vierge dans lequel chaque élément de page de
 *    la source est dupliqué. C'est la méthode historique du modèle objet
 *    d'Illustrator, où `Document` n'a pas toujours porté `duplicate()`.
 */
export async function duplicateDocument(
  source: IllustratorDocument,
): Promise<IllustratorDocument> {
  const host = loadIllustratorHost()

  try {
    if (typeof source.duplicate === 'function') {
      return await source.duplicate()
    }

    const add = host.app.documents.add
    if (typeof add !== 'function') {
      throw new Error(
        "l'hôte n'expose ni `document.duplicate()` ni `app.documents.add()`",
      )
    }

    const copy = add.call(host.app.documents, source.documentColorSpace)
    const placement = (host.ElementPlacement as Record<string, unknown> | undefined)
      ?.PLACEATEND

    const items = source.pageItems
    // Parcours à rebours : dupliquer en tête décale les index restants.
    for (let index = items.length - 1; index >= 0; index -= 1) {
      const item = items[index] as PageItemLike & {
        duplicate?: (target: unknown, placement?: unknown) => unknown
      }
      if (typeof item.duplicate !== 'function') continue
      item.duplicate(copy.activeLayer ?? copy, placement)
    }

    return copy
  } catch (error) {
    throw wrapError(`Duplication du document ${source.name ?? ''}`.trim(), error)
  }
}

/* -------------------------------------------------------------------------- *
 * 7. Déclinaison chromatique
 * -------------------------------------------------------------------------- */

/** Lit une composante numérique d'une couleur Illustrator. */
function readChannel(color: Record<string, unknown>, key: string): number {
  const value = color[key]
  return typeof value === 'number' ? value : 0
}

/**
 * Traduit une couleur Illustrator en `#rrggbb`.
 *
 * @returns `null` pour un dégradé, un motif ou une teinte non convertible.
 */
function colorToHex(color: unknown): string | null {
  if (!color || typeof color !== 'object') return null
  const record = color as Record<string, unknown>

  if ('red' in record && 'green' in record && 'blue' in record) {
    return rgbToHex({
      r: readChannel(record, 'red'),
      g: readChannel(record, 'green'),
      b: readChannel(record, 'blue'),
    })
  }

  if ('cyan' in record && 'magenta' in record && 'yellow' in record) {
    const c = readChannel(record, 'cyan') / 100
    const m = readChannel(record, 'magenta') / 100
    const y = readChannel(record, 'yellow') / 100
    const k = readChannel(record, 'black') / 100
    return rgbToHex({
      r: Math.round(255 * (1 - c) * (1 - k)),
      g: Math.round(255 * (1 - m) * (1 - k)),
      b: Math.round(255 * (1 - y) * (1 - k)),
    })
  }

  if ('gray' in record) {
    // Chez Illustrator, `gray` vaut 0 pour le blanc et 100 pour le noir.
    const level = Math.round(255 * (1 - readChannel(record, 'gray') / 100))
    return rgbToHex({ r: level, g: level, b: level })
  }

  return null
}

/** Construit une couleur Illustrator en niveaux de gris, `gray` de 0 à 100. */
function makeGray(host: IllustratorHost, gray: number): unknown {
  const color = construct(host, 'GrayColor')
  color.gray = Math.max(0, Math.min(100, gray))
  return color
}

/** Construit le noir de renfort demandé : CMJN 0/0/0/100. */
function makeBlack(host: IllustratorHost): unknown {
  const color = construct(host, 'CMYKColor')
  color.cyan = 0
  color.magenta = 0
  color.yellow = 0
  color.black = 100
  return color
}

/** Construit un blanc pur, CMJN 0/0/0/0. */
function makeWhite(host: IllustratorHost): unknown {
  const color = construct(host, 'CMYKColor')
  color.cyan = 0
  color.magenta = 0
  color.yellow = 0
  color.black = 0
  return color
}

/**
 * Calcule la couleur de remplacement d'un élément.
 *
 * @returns `null` si l'élément doit rester tel quel — cas d'un dégradé ou d'un
 * motif en mode niveaux de gris, qu'on ne sait pas convertir sans le dénaturer.
 */
function schemeColor(
  host: IllustratorHost,
  scheme: ColorScheme,
  current: unknown,
): unknown | null {
  switch (scheme) {
    case 'original':
      return null
    case 'black':
      return makeBlack(host)
    case 'white':
      return makeWhite(host)
    case 'grayscale': {
      const hex = colorToHex(current)
      if (hex === null) return null
      const grayHex = toGrayscale(hex)
      // `toGrayscale` renvoie trois composantes égales : la première suffit.
      const level = parseInt(grayHex.slice(1, 3), 16)
      return makeGray(host, ((255 - level) / 255) * 100)
    }
  }
}

/**
 * Applique une déclinaison chromatique à tous les éléments d'un document.
 *
 * Les éléments dont le remplissage ou le contour n'est pas une couleur unie
 * (dégradés, motifs) sont laissés intacts en mode niveaux de gris : les
 * convertir demanderait de reconstruire le dégradé, ce qui dénaturerait la
 * marque. Ils sont en revanche bien aplatis en noir ou en blanc, où l'intention
 * est justement d'écraser toute nuance.
 */
export async function applyColorScheme(
  document: IllustratorDocument,
  scheme: ColorScheme,
): Promise<void> {
  if (scheme === 'original') return

  const host = loadIllustratorHost()

  try {
    const items = document.pathItems
    const count = items?.length ?? 0

    for (let index = 0; index < count; index += 1) {
      const item = items[index]
      if (!item) continue

      if (item.filled === true) {
        const replacement = schemeColor(host, scheme, item.fillColor)
        if (replacement !== null) item.fillColor = replacement
      }
      if (item.stroked === true) {
        const replacement = schemeColor(host, scheme, item.strokeColor)
        if (replacement !== null) item.strokeColor = replacement
      }
    }
  } catch (error) {
    throw wrapError(`Application de la déclinaison « ${scheme} »`, error)
  }
}

/* -------------------------------------------------------------------------- *
 * Fermeture et façade
 * -------------------------------------------------------------------------- */

/** Referme un document sans enregistrer les modifications. */
export async function closeWithoutSaving(document: IllustratorDocument): Promise<void> {
  const host = loadIllustratorHost()

  try {
    const saveOptions = (host.SaveOptions as Record<string, unknown> | undefined)
      ?.DONOTSAVECHANGES
    await document.close(saveOptions)
  } catch (error) {
    throw wrapError('Fermeture du document dupliqué', error)
  }
}

/** Traduit une déclinaison du plan en déclinaison applicable au document. */
export function toColorScheme(mode: RenderRequest['file']['colorMode']): ColorScheme {
  switch (mode) {
    case 'full-color':
      return 'original'
    case 'black':
      return 'black'
    // La réserve est un logo blanc destiné à être posé sur un aplat de couleur.
    case 'white':
    case 'knockout':
      return 'white'
    case 'grayscale':
      return 'grayscale'
  }
}

/**
 * Aiguille un fichier planifié vers l'export correspondant à son format.
 *
 * @throws {Error} pour un format qu'Illustrator ne sait pas produire.
 */
export async function exportPlannedFile(
  document: IllustratorDocument,
  request: RenderRequest,
): Promise<void> {
  const { file, outputPath, artboardIndex, resolution, quality } = request

  switch (file.format) {
    case 'svg':
      return exportAsSVG(document, outputPath, { artboardIndex })
    case 'png':
      return exportAsPNG(document, outputPath, {
        artboardIndex,
        resolution,
        transparency: file.transparent,
      })
    case 'pdf':
      return exportAsPDF(document, outputPath, { artboardIndex })
    case 'eps':
      return exportAsEPS(document, outputPath, { artboardIndex })
    case 'ai':
      return exportAsAI(document, outputPath, { artboardIndex })
    case 'jpg':
      return exportAsJPEG(document, outputPath, {
        artboardIndex,
        resolution,
        quality,
      })
    case 'webp':
      // Illustrator n'expose pas d'export WebP par script : le signaler
      // explicitement vaut mieux que de produire un fichier au mauvais format.
      throw new Error(
        `Le format WebP n'est pas exportable depuis Illustrator par script (${outputPath}).`,
      )
  }
}

/**
 * Fabrique l'implémentation d'`IllustratorEngine` consommée par le chef
 * d'orchestre. La façade masque les poignées de document derrière `unknown` :
 * le cœur métier ne manipule jamais d'objet Illustrator typé.
 */
export function createIllustratorEngine(): IllustratorEngine {
  /** Rétablit le typage de la poignée opaque au passage de la frontière. */
  const asDocument = (handle: DocumentHandle): IllustratorDocument => {
    if (!handle || typeof handle !== 'object') {
      throw new Error('Poignée de document Illustrator invalide.')
    }
    return handle as IllustratorDocument
  }

  return {
    getActiveDocument,

    async duplicateActiveDocument() {
      const host = loadIllustratorHost()
      const source = host.app.activeDocument
      if (!source) {
        throw new Error(
          'Aucun document Illustrator ouvert : ouvrez le logo à exporter.',
        )
      }
      return duplicateDocument(source)
    },

    async applyColorScheme(handle, scheme) {
      return applyColorScheme(asDocument(handle), scheme)
    },

    async exportDocument(handle, request) {
      return exportPlannedFile(asDocument(handle), request)
    },

    async closeDocument(handle) {
      return closeWithoutSaving(asDocument(handle))
    },
  }
}
