/**
 * Doublure du modèle objet d'Illustrator, pour exécuter `src/jsx/main.jsx`
 * dans Node.
 *
 * La couche ExtendScript est la seule à parler à Illustrator : sans doublure,
 * elle ne pourrait être vérifiée qu'en ouvrant Illustrator à la main. Ce que
 * l'on vérifie ici n'est pas Illustrator, mais le contrat que le code passe
 * avec lui — ordre de superposition, objets masqués, décomptes, cadrage,
 * fichiers écrits. Les écarts entre cette doublure et le vrai Illustrator
 * restent possibles : ils sont signalés dans docs/AUDIT.md.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

export type Bounds = [number, number, number, number]

/** Fichier en mémoire : un chemin, une taille. */
export interface FakeFileEntry {
  bytes: number
}

export class FakeFileSystem {
  readonly files = new Map<string, FakeFileEntry>()
  readonly folders = new Set<string>(['/tmp'])

  write(path: string, bytes: number): void {
    this.files.set(path, { bytes })
  }

  reset(): void {
    this.files.clear()
    this.folders.clear()
    this.folders.add('/tmp')
  }
}

let filesystem = new FakeFileSystem()

/** Objet de page : ce que Logo Forge copie d'un document à l'autre. */
export class FakeItem {
  hidden = false
  locked = false
  /** Refus de duplication, pour simuler un calque verrouillé. */
  refuseDuplicate = false

  constructor(
    public typename: string,
    public visibleBounds: Bounds,
    public label = '',
  ) {}

  duplicate(layer: FakeLayer, placement: string): FakeItem {
    if (this.refuseDuplicate) {
      throw new Error('objet verrouille : ' + this.label)
    }
    const copy = new FakeItem(this.typename, [...this.visibleBounds], this.label)
    copy.hidden = this.hidden
    copy.locked = this.locked
    if (placement === 'PLACEATBEGINNING') layer.pageItems.unshift(copy)
    else layer.pageItems.push(copy)
    return copy
  }
}

/** Objet sélectionné en mode édition de texte : aucune boîte englobante. */
export class FakeTextRange {
  typename = 'TextRange'
  get visibleBounds(): Bounds {
    throw new Error('TextRange n a pas de visibleBounds')
  }
}

export class FakeLayer {
  pageItems: FakeItem[] = []
  locked = false
  visible = true
}

export class FakeArtboard {
  constructor(public artboardRect: Bounds) {}
}

export class FakeDocument {
  layers: FakeLayer[] = [new FakeLayer()]
  artboards: FakeArtboard[]
  selection: unknown[] = []
  closed = false
  /** Chemin du dernier `saveAs`, qui ré-associe le document. */
  savedTo: string | null = null
  /** Taille écrite par le prochain `saveAs`, pour simuler un fichier vide. */
  saveBytes = 4096
  exports: Array<{ path: string; type: string }> = []

  constructor(
    public name: string,
    public documentColorSpace: string,
    width: number,
    height: number,
  ) {
    this.artboards = [new FakeArtboard([0, 0, width, -height])]
  }

  get pageItems(): FakeItem[] {
    const all: FakeItem[] = []
    for (const layer of this.layers) all.push(...layer.pageItems)
    return all
  }

  saveAs(file: { fsName: string }, _options: unknown): void {
    filesystem.write(file.fsName, this.saveBytes)
    this.savedTo = file.fsName
    this.name = file.fsName.split('/').pop() ?? this.name
  }

  exportFile(file: { fsName: string }, type: string, _options: unknown): void {
    filesystem.write(file.fsName, 2048)
    this.exports.push({ path: file.fsName, type })
  }

  close(): void {
    this.closed = true
    const index = host.app.documents.indexOf(this)
    if (index >= 0) host.app.documents.splice(index, 1)
  }
}

/** Application Illustrator simulée. */
class FakeApp {
  documents: FakeDocument[] & { add?: unknown } = [] as never
  activeDocument: FakeDocument | null = null
  /** Documents créés par `documents.add`, dans l'ordre. */
  created: FakeDocument[] = []
  /** Taille écrite par `saveAs` sur les documents à venir. */
  defaultSaveBytes = 4096

  constructor() {
    Object.defineProperty(this.documents, 'add', {
      value: (space: string, width: number, height: number) => {
        const doc = new FakeDocument('sans-titre', space, width, height)
        doc.saveBytes = this.defaultSaveBytes
        this.documents.push(doc)
        this.created.push(doc)
        this.activeDocument = doc
        return doc
      },
      enumerable: false,
    })
  }

  open(file: { fsName: string }): FakeDocument {
    const doc = new FakeDocument(
      file.fsName.split('/').pop() ?? 'ouvert',
      'RGB',
      100,
      100,
    )
    this.documents.push(doc)
    this.activeDocument = doc
    return doc
  }

  executeMenuCommand(): void {
    /* sans effet dans la doublure */
  }
}

interface Host {
  app: FakeApp
  filesystem: FakeFileSystem
  api: Record<string, (...args: unknown[]) => string>
}

let host: Host

/** Charge `src/jsx/main.jsx` dans un environnement Illustrator simulé. */
export function loadExtendScript(): Host {
  filesystem = new FakeFileSystem()
  const app = new FakeApp()

  class FakeFile {
    fsName: string
    constructor(path: string | { fsName: string }) {
      this.fsName = typeof path === 'string' ? path : path.fsName
    }
    get exists(): boolean {
      return filesystem.files.has(this.fsName)
    }
    get length(): number {
      return filesystem.files.get(this.fsName)?.bytes ?? 0
    }
    copy(target: string): boolean {
      const entry = filesystem.files.get(this.fsName)
      if (!entry) return false
      filesystem.write(target, entry.bytes)
      return true
    }
    remove(): boolean {
      return filesystem.files.delete(this.fsName)
    }
    open(): boolean {
      return true
    }
    write(text: string): void {
      filesystem.write(this.fsName, text.length)
    }
    close(): void {
      /* rien à libérer */
    }
  }

  class FakeFolder {
    static temp = { fsName: '/tmp' }
    fsName: string
    constructor(path: string) {
      this.fsName = path
    }
    get exists(): boolean {
      return filesystem.folders.has(this.fsName)
    }
    create(): boolean {
      filesystem.folders.add(this.fsName)
      return true
    }
    remove(): boolean {
      return filesystem.folders.delete(this.fsName)
    }
    getFiles(pattern?: string): FakeFile[] {
      const suffix = pattern ? pattern.replace('*', '') : ''
      const matches: FakeFile[] = []
      for (const path of filesystem.files.keys()) {
        if (!path.startsWith(this.fsName + '/')) continue
        if (suffix && !path.endsWith(suffix)) continue
        matches.push(new FakeFile(path))
      }
      return matches
    }
  }

  const options = (): Record<string, unknown> => ({
    antiAliasing: false,
    transparency: false,
    artBoardClipping: false,
    saveMultipleArtboards: false,
    artboardRange: '',
    horizontalScale: 100,
    verticalScale: 100,
    qualitySetting: 80,
    pdfCompatible: false,
    preserveEditability: false,
    viewAfterSaving: false,
    embedAllFonts: false,
    embedRasterImages: false,
    includeDocumentThumbnails: false,
    fontType: '',
    coordinatePrecision: 3,
  })

  const source = readFileSync(
    resolve(import.meta.dirname, '../src/jsx/main.jsx'),
    'utf8',
  )

  const globals = {
    app,
    File: FakeFile,
    Folder: FakeFolder,
    ElementPlacement: {
      PLACEATEND: 'PLACEATEND',
      PLACEATBEGINNING: 'PLACEATBEGINNING',
    },
    DocumentColorSpace: { CMYK: 'CMYK', RGB: 'RGB' },
    SaveOptions: { DONOTSAVECHANGES: 'DONOTSAVECHANGES' },
    ExportType: { PNG24: 'PNG24', JPEG: 'JPEG', SVG: 'SVG' },
    SVGFontType: { OUTLINEFONT: 'OUTLINEFONT' },
    ExportOptionsPNG24: function () {
      return options()
    },
    ExportOptionsJPEG: function () {
      return options()
    },
    ExportOptionsSVG: function () {
      return options()
    },
    IllustratorSaveOptions: function () {
      return options()
    },
    PDFSaveOptions: function () {
      return options()
    },
    EPSSaveOptions: function () {
      return options()
    },
    RGBColor: function () {
      return { typename: 'RGBColor', red: 0, green: 0, blue: 0 }
    },
    CMYKColor: function () {
      return { typename: 'CMYKColor', cyan: 0, magenta: 0, yellow: 0, black: 0 }
    },
    GrayColor: function () {
      return { typename: 'GrayColor', gray: 0 }
    },
  }

  const names = Object.keys(globals)
  const exported = [
    'lfPing',
    'lfGetDocumentName',
    'lfGetDocumentInfo',
    'lfDescribeSelection',
    'lfSetComponent',
    'lfRenderThumbnail',
    'lfOpenComponent',
    'lfRemoveComponentFile',
    'lfApplyColorScheme',
    'lfExportPNG',
    'lfExportSVG',
    'lfExportAI',
  ]

  const factory = new Function(
    ...names,
    `${source}\nreturn { ${exported.map((n) => `${n}: ${n}`).join(', ')} }`,
  ) as (...args: unknown[]) => Record<string, (...args: unknown[]) => string>

  const api = factory(...names.map((name) => (globals as never)[name]))

  host = { app, filesystem, api }
  return host
}

/** Découpe une réponse « OK|charge » en statut et champs. */
export function parseResult(raw: string): {
  ok: boolean
  value: string
  fields: string[]
} {
  const separator = raw.indexOf('|')
  const status = raw.slice(0, separator)
  const value = raw.slice(separator + 1)
  return {
    ok: status === 'OK',
    value,
    fields: value.split(String.fromCharCode(31)),
  }
}
