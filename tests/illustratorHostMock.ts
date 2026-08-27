/**
 * Doublure du module `illustrator`.
 *
 * L'API d'Illustrator n'existe pas hors d'Illustrator : ce module en reproduit
 * la surface utilisée par le moteur, avec assez de fidélité pour vérifier *ce
 * qui est appelé et avec quels arguments*.
 *
 * `vi.mock('illustrator', …)` ne conviendrait pas ici : le moteur charge son
 * hôte par `require('illustrator')` à l'exécution, comme l'exige UXP, et Vitest
 * ne sait pas intercepter un module que Node ne peut pas résoudre. L'injection
 * par `setIllustratorHost` couvre le même besoin sans dépendre de ce détail.
 */

import { vi } from 'vitest'

import type { IllustratorHost } from '../src/illustrator/host'

/** Appel d'export ou d'enregistrement enregistré par la doublure. */
export interface RecordedCall {
  kind: 'export' | 'save'
  target: unknown
  type?: unknown
  options: Record<string, unknown>
}

export interface MockDocument {
  name: string
  fullName: { nativePath: string }
  artboards: {
    length: number
    setActiveArtboardIndex: ReturnType<typeof vi.fn>
    [index: number]: unknown
  }
  pathItems: MockItem[] & { length: number }
  pageItems: MockItem[] & { length: number }
  documentColorSpace: string
  width: number
  duplicate?: ReturnType<typeof vi.fn>
  exportFile: ReturnType<typeof vi.fn>
  saveAs: ReturnType<typeof vi.fn>
  close: ReturnType<typeof vi.fn>
  calls: RecordedCall[]
  closed: boolean
  // Un document Illustrator porte bien d'autres propriétés ; l'index les admet,
  // ce qui rend `MockDocument` assignable à `IllustratorDocument`.
  [key: string]: unknown
}

export interface MockItem {
  filled: boolean
  stroked: boolean
  fillColor: Record<string, unknown> | null
  strokeColor: Record<string, unknown> | null
  // Les éléments d'Illustrator portent bien d'autres propriétés ; l'index les
  // admet, ce qui rend `MockItem` assignable à `PageItemLike`.
  [key: string]: unknown
}

/** Crée un élément de tracé coloré en RVB. */
export function rgbItem(r: number, g: number, b: number): MockItem {
  return {
    filled: true,
    stroked: true,
    fillColor: { red: r, green: g, blue: b },
    strokeColor: { red: r, green: g, blue: b },
  }
}

export interface MockDocumentOptions {
  name?: string
  nativePath?: string
  artboardCount?: number
  artboardWidth?: number
  items?: MockItem[]
  /** Expose `document.duplicate()`, comme les hôtes récents. */
  withDuplicate?: boolean
  /** Fait échouer tout export et tout enregistrement. */
  failExports?: boolean
}

/** Crée un document Illustrator factice. */
export function createMockDocument(options: MockDocumentOptions = {}): MockDocument {
  const {
    name = 'test-logo.ai',
    nativePath = '/tmp/test-logo.ai',
    artboardCount = 2,
    artboardWidth = 512,
    items = [rgbItem(38, 128, 235)],
    withDuplicate = true,
    failExports = false,
  } = options

  const calls: RecordedCall[] = []

  const artboards: MockDocument['artboards'] = {
    length: artboardCount,
    setActiveArtboardIndex: vi.fn(),
  }
  for (let index = 0; index < artboardCount; index += 1) {
    artboards[index] = { artboardRect: [0, artboardWidth, artboardWidth, 0] }
  }

  const document: MockDocument = {
    name,
    fullName: { nativePath },
    artboards,
    pathItems: items as MockDocument['pathItems'],
    pageItems: items as MockDocument['pageItems'],
    documentColorSpace: 'rgb',
    width: artboardWidth,
    calls,
    closed: false,
    exportFile: vi.fn(async (target: unknown, type: unknown, opts: unknown) => {
      if (failExports) throw new Error('disque plein')
      calls.push({
        kind: 'export',
        target,
        type,
        options: opts as Record<string, unknown>,
      })
    }),
    saveAs: vi.fn(async (target: unknown, opts: unknown) => {
      if (failExports) throw new Error('disque plein')
      calls.push({ kind: 'save', target, options: opts as Record<string, unknown> })
    }),
    close: vi.fn(async () => {
      document.closed = true
    }),
  }

  if (withDuplicate) {
    document.duplicate = vi.fn(async () =>
      createMockDocument({ ...options, name: `${name} (copie)` }),
    )
  }

  return document
}

/** Fabrique un constructeur d'objet d'options aux propriétés prédéclarées. */
function optionsFactory(defaults: Record<string, unknown>) {
  return function OptionsObject(this: Record<string, unknown>) {
    Object.assign(this, defaults)
  } as unknown as new () => Record<string, unknown>
}

export interface MockHost extends IllustratorHost {
  app: {
    activeDocument?: MockDocument
    documents: { length: number; add: ReturnType<typeof vi.fn> }
    [key: string]: unknown
  }
}

/**
 * Crée un module `illustrator` factice.
 * @param activeDocument document actif, ou `null` pour simuler un hôte sans document.
 */
export function createMockHost(
  activeDocument: MockDocument | null = createMockDocument(),
): MockHost {
  const host = {
    app: {
      activeDocument: activeDocument ?? undefined,
      documents: {
        length: activeDocument ? 1 : 0,
        add: vi.fn(() => createMockDocument({ name: 'nouveau.ai' })),
      },
    },
    ExportType: { SVG: 'SVG', PNG24: 'PNG24', JPEG: 'JPEG' },
    SaveOptions: { DONOTSAVECHANGES: 'DONOTSAVECHANGES' },
    ElementPlacement: { PLACEATEND: 'PLACEATEND' },
    DocumentColorSpace: { RGB: 'rgb', CMYK: 'cmyk' },
    SVGFontType: 'OUTLINEFONT',

    // Les propriétés déclarées ici sont les seules que le moteur peut écrire :
    // `assignIfSupported` ignore tout le reste, exactement comme le ferait un
    // hôte d'une version antérieure.
    ExportOptionsSVG: optionsFactory({
      embedRasterImages: false,
      preserveEditability: false,
      fontType: null,
      saveMultipleArtboards: false,
      artboardRange: '',
    }),
    ExportOptionsPNG24: optionsFactory({
      horizontalScale: 100,
      verticalScale: 100,
      transparency: true,
      antiAliasing: true,
      artBoardClipping: false,
      saveMultipleArtboards: false,
      artboardRange: '',
    }),
    ExportOptionsJPEG: optionsFactory({
      horizontalScale: 100,
      verticalScale: 100,
      qualitySetting: 60,
      antiAliasing: true,
      artBoardClipping: false,
      saveMultipleArtboards: false,
      artboardRange: '',
    }),
    PDFSaveOptions: optionsFactory({
      compatibility: null,
      preserveEditability: false,
      viewAfterSaving: true,
      saveMultipleArtboards: false,
      artboardRange: '',
    }),
    EPSSaveOptions: optionsFactory({
      compatibility: null,
      embedAllFonts: false,
      includeDocumentThumbnails: false,
      saveMultipleArtboards: false,
      artboardRange: '',
    }),
    IllustratorSaveOptions: optionsFactory({
      compatibility: null,
      pdfCompatible: false,
    }),

    CMYKColor: optionsFactory({ cyan: 0, magenta: 0, yellow: 0, black: 0 }),
    GrayColor: optionsFactory({ gray: 0 }),
    RGBColor: optionsFactory({ red: 0, green: 0, blue: 0 }),
  }

  return host as unknown as MockHost
}
