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
  /** Contenu, quand il a été écrit par le code testé. */
  content?: string
}

export class FakeFileSystem {
  readonly files = new Map<string, FakeFileEntry>()
  readonly folders = new Set<string>(['/tmp'])

  write(path: string, bytes: number, content?: string): void {
    this.files.set(path, { bytes, content })
  }

  reset(): void {
    this.files.clear()
    this.folders.clear()
    this.folders.add('/tmp')
  }
}

let filesystem = new FakeFileSystem()

/** Union des boîtes englobantes, dans le repère d'Illustrator. */
function unionBounds(all: Bounds[]): Bounds {
  if (all.length === 0) return [0, 0, 0, 0]
  return [
    Math.min(...all.map((b) => b[0])),
    Math.max(...all.map((b) => b[1])),
    Math.max(...all.map((b) => b[2])),
    Math.min(...all.map((b) => b[3])),
  ]
}

/** Objet de page : ce que Logo Forge copie d'un document à l'autre. */
export class FakeItem {
  hidden = false
  locked = false
  /** Refus de duplication, pour simuler un calque verrouillé. */
  refuseDuplicate = false
  /** Refus de déplacement, pour éprouver le regroupement. */
  refuseMove = false
  /** Transmet le refus de déplacement aux copies, jamais à l original. */
  refuseMoveOnCopy = false
  /** Sélection : ce que lit le repli par presse-papiers. */
  selected = false
  /** Conteneur : un calque pour un objet de premier niveau, sinon un groupe. */
  parent: FakeLayer | FakeGroup | null = null

  /* Attributs lus par le contrôle de production. */
  pathPoints: unknown[] = [{}, {}]
  filled = true
  stroked = false
  clipping = false
  guides = false
  fillOverprint = false
  strokeOverprint = false
  fillColor: unknown = { typename: 'RGBColor', red: 0, green: 0, blue: 0 }
  strokeColor: unknown = { typename: 'RGBColor', red: 0, green: 0, blue: 0 }
  /** Collection d'où l'objet se retire lui-même. */
  collection: FakeItem[] | null = null

  remove(): void {
    if (this.collection) {
      const index = this.collection.indexOf(this)
      if (index >= 0) this.collection.splice(index, 1)
    }
    if (this.parent instanceof FakeLayer) {
      const items = this.parent.items
      const index = items.indexOf(this)
      if (index >= 0) items.splice(index, 1)
    }
  }

  constructor(
    public typename: string,
    public visibleBounds: Bounds,
    public label = '',
  ) {}

  duplicate(target: FakeLayer | FakeGroup, placement: string): FakeItem {
    if (this.refuseDuplicate) {
      throw new Error('objet verrouille : ' + this.label)
    }
    // Illustrator refuse une cible « groupe » appartenant à un autre
    // document ; la doublure reproduit ce refus, sans quoi le cas ne serait
    // jamais exercé.
    if (target instanceof FakeGroup && target.ownerDocument !== this.ownerDocument) {
      throw new Error('cible d un autre document')
    }
    const copy = new FakeItem(this.typename, [...this.visibleBounds], this.label)
    copy.hidden = this.hidden
    copy.locked = this.locked
    copy.refuseMove = this.refuseMoveOnCopy
    target.insert(copy, placement)
    return copy
  }

  /** Déplacement d'un conteneur à l'autre, dans un même document. */
  move(target: FakeLayer | FakeGroup, placement: string): void {
    if (this.refuseMove) throw new Error('deplacement refuse : ' + this.label)
    this.remove()
    target.insert(this, placement)
  }

  /** Document auquel l'objet appartient, en remontant ses conteneurs. */
  get ownerDocument(): unknown {
    let node: FakeLayer | FakeGroup | null = this.parent
    while (node && node instanceof FakeGroup) node = node.parent
    return node instanceof FakeLayer ? node.ownerDocument : null
  }
}

/**
 * Groupe : conteneur déplaçable et redimensionnable d'un seul tenant.
 *
 * Simplification assumée : `resize` et `position` déplacent la boîte du groupe
 * sans recalculer celle de ses enfants. Ce qui est vérifié ici est le
 * placement du groupe dans sa cellule, pas la géométrie interne.
 */
export class FakeGroup {
  typename = 'GroupItem'
  pageItems: FakeItem[] = []
  hidden = false
  locked = false
  parent: FakeLayer | null = null

  get ownerDocument(): unknown {
    return this.parent ? this.parent.ownerDocument : null
  }
  visibleBounds: Bounds = [0, 0, 0, 0]
  /** Facteur cumulé appliqué par `resize`, en pourcentage. */
  scale = 100

  insert(item: FakeItem, placement: string): void {
    item.parent = this
    if (placement === 'PLACEATBEGINNING') this.pageItems.unshift(item)
    else this.pageItems.push(item)
    this.visibleBounds = unionBounds(this.pageItems.map((child) => child.visibleBounds))
  }

  resize(horizontal: number, vertical: number): void {
    const [left, top, right, bottom] = this.visibleBounds
    const width = (right - left) * (horizontal / 100)
    const height = (top - bottom) * (vertical / 100)
    this.visibleBounds = [left, top, left + width, top - height]
    this.scale = (this.scale * horizontal) / 100
  }

  get position(): [number, number] {
    return [this.visibleBounds[0], this.visibleBounds[1]]
  }

  set position(value: [number, number]) {
    const [left, top, right, bottom] = this.visibleBounds
    const width = right - left
    const height = top - bottom
    this.visibleBounds = [value[0], value[1], value[0] + width, value[1] - height]
  }

  remove(): void {
    if (!this.parent) return
    const index = this.parent.groups.indexOf(this)
    if (index >= 0) this.parent.groups.splice(index, 1)
  }
}

/** Bloc de texte, réduit à ce que la planche et le contrôle en attendent. */
export class FakeTextFrame {
  typename = 'TextFrame'
  contents = ''
  position: [number, number] = [0, 0]
  textRange = {
    characterAttributes: {
      size: 12,
      fillColor: { typename: 'RGBColor', red: 0, green: 0, blue: 0 },
    },
  }
  collection: FakeTextFrame[] | null = null

  remove(): void {
    if (!this.collection) return
    const index = this.collection.indexOf(this)
    if (index >= 0) this.collection.splice(index, 1)
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
  typename = 'Layer'
  /** Groupes de premier niveau, suivis à part de leurs enfants. */
  groups: FakeGroup[] = []
  locked = false
  visible = true
  /** Document propriétaire : Illustrator refuse une cible d un autre document. */
  ownerDocument: unknown = null

  private direct: FakeItem[] = []

  /**
   * Comme dans Illustrator, cette collection descend dans les groupes : c'est
   * précisément ce qui oblige le code à filtrer sur le parent.
   */
  get pageItems(): Array<FakeItem | FakeGroup> {
    const out: Array<FakeItem | FakeGroup> = []
    for (const item of this.direct) out.push(item)
    for (const group of this.groups) {
      out.push(group)
      for (const child of group.pageItems) out.push(child)
    }
    return out
  }

  set pageItems(items: Array<FakeItem | FakeGroup>) {
    this.direct = items as FakeItem[]
    for (const item of this.direct) item.parent = this
  }

  insert(item: FakeItem, placement: string): void {
    item.parent = this
    if (placement === 'PLACEATBEGINNING') this.direct.unshift(item)
    else this.direct.push(item)
  }

  /** Objets directs du calque, sans descendre dans les groupes. */
  get items(): FakeItem[] {
    return this.direct
  }

  set items(items: FakeItem[]) {
    this.pageItems = items
  }
}

export class FakeArtboard {
  constructor(public artboardRect: Bounds) {}
}

/** Collection Illustrator : un tableau doté d'une méthode `add`. */
function createCollection<T>(factory: () => T): T[] & { add: () => T } {
  const collection = [] as unknown as T[] & { add: () => T }
  collection.add = () => {
    const created = factory()
    collection.push(created)
    return created
  }
  return collection
}

export class FakeDocument {
  layers: FakeLayer[] = [new FakeLayer()]
  artboards: FakeArtboard[]

  /**
   * Sélection : dans Illustrator c'est une vue vivante sur les objets marqués,
   * et non un tableau à part. Le repli par presse-papiers coche `selected` sur
   * chaque objet et relit `selection` — sans cette fidélité, il ne verrait
   * rien.
   */
  private assigned: unknown[] = []

  get selection(): unknown[] {
    // Ce qui a été affecté directement — un TextRange n'est pas un objet de
    // page — plus tout objet de page marqué depuis.
    const out = [...this.assigned]
    for (const layer of this.layers) {
      for (const item of layer.pageItems) {
        // Un groupe n'est pas marqué : la sélection porte sur ses objets.
        if (item instanceof FakeItem && item.selected && out.indexOf(item) < 0) {
          out.push(item)
        }
      }
    }
    return out
  }

  set selection(items: unknown[] | null) {
    for (const layer of this.layers) {
      for (const item of layer.pageItems) {
        if (item instanceof FakeItem) item.selected = false
      }
    }
    this.assigned = items ? [...items] : []
    for (const item of this.assigned as FakeItem[]) {
      if (item instanceof FakeItem) item.selected = true
    }
  }
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
    for (const layer of this.layers) layer.ownerDocument = this
  }

  textFrames = createCollection<FakeTextFrame>(() => {
    const frame = new FakeTextFrame()
    frame.collection = this.textFrames
    return frame
  })

  /** Nuanciers du document, pour le contrôle des couleurs inutilisées. */
  swatches: Array<{ name: string; color: unknown }> = []

  private paths: FakeItem[] = []

  get pathItems(): FakeItem[] & { rectangle: (...args: number[]) => FakeItem } {
    const collection = this.paths as FakeItem[] & {
      rectangle: (...args: number[]) => FakeItem
    }
    collection.rectangle = (
      top: number,
      left: number,
      width: number,
      height: number,
    ) => {
      const item = new FakeItem('PathItem', [left, top, left + width, top - height])
      // Le fond est créé avant le logo : il est déjà au fond de la pile.
      this.layers[0].insert(item, 'PLACEATBEGINNING')
      item.collection = this.paths
      this.paths.push(item)
      return item
    }
    return collection
  }

  set pathItems(items: FakeItem[]) {
    this.paths = items
    for (const item of items) item.collection = this.paths
  }

  get groupItems(): FakeGroup[] & { add: () => FakeGroup } {
    const layer = this.layers[0]
    const collection = [...layer.groups] as FakeGroup[] & {
      add: () => FakeGroup
    }
    collection.add = () => {
      const group = new FakeGroup()
      group.parent = layer
      layer.groups.push(group)
      return group
    }
    return collection
  }

  get pageItems(): Array<FakeItem | FakeGroup> {
    const all: Array<FakeItem | FakeGroup> = []
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
        // Repère chronologique : la copie doit précéder la création, sinon la
        // sélection de l'utilisateur est déjà perdue.
        this.markCreation()
        this.activeDocument = doc
        return doc
      },
      enumerable: false,
    })
  }

  /** Document que le prochain `open` renverra, pour scénariser un composant. */
  nextOpened: FakeDocument | null = null

  open(file: { fsName: string }): FakeDocument {
    if (this.nextOpened) {
      const prepared = this.nextOpened
      this.nextOpened = null
      this.documents.push(prepared)
      this.activeDocument = prepared
      return prepared
    }
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

  /** Presse-papiers du repli inter-documents. */
  private clipboard: FakeItem[] = []
  /** Rend le presse-papiers stérile, pour éprouver l échec complet. */
  breakClipboard = false
  /** Commandes de menu reçues, dans l ordre. */
  commands: string[] = []
  /** Commandes déjà reçues au moment de chaque création de document. */
  creationMarks: number[] = []

  /** Note le rang de la création courante dans la suite des commandes. */
  markCreation(): void {
    // Nombre de commandes déjà reçues : une création qui suit `copy` porte un
    // repère strictement supérieur au rang de cette commande.
    this.creationMarks.push(this.commands.length)
  }

  /** Un document a-t-il été créé après la commande donnée ? */
  createdAfterCommand(command: string): boolean {
    const at = this.commands.indexOf(command)
    if (at < 0) return false
    return this.creationMarks.some((mark) => mark > at)
  }

  executeMenuCommand(command?: string): void {
    this.commands.push(String(command ?? ''))
    const doc = this.activeDocument
    if (!doc) return

    if (command === 'copy') {
      this.clipboard = this.breakClipboard ? [] : (doc.selection as FakeItem[]).slice()
      return
    }

    if (command === 'pasteFront' || command === 'paste') {
      const pasted: FakeItem[] = []
      for (const item of this.clipboard) {
        const copy = new FakeItem(item.typename, [...item.visibleBounds], item.label)
        doc.layers[0].insert(copy, 'PLACEATEND')
        pasted.push(copy)
      }
      doc.selection = pasted
      return
    }
    /* les autres commandes restent sans effet */
  }
}

export interface Host {
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
      filesystem.write(this.fsName, text.length, text)
    }
    read(): string {
      return filesystem.files.get(this.fsName)?.content ?? ''
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
    ZOrderMethod: { SENDTOBACK: 'sendToBack', BRINGTOFRONT: 'bringToFront' },
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
    'lfFitArtboard',
    'lfInspectDocument',
    'lfCreatePackage',
    'lfPlaceComponent',
    'lfAddLabel',
    'lfFinishPackage',
    'lfAbortPackage',
    'lfPreflight',
    'lfClean',
    'lfListColors',
    'lfRemoveComponentFile',
    'lfApplyColorScheme',
    'lfExportPNG',
    'lfExportSVG',
    'lfExportAI',
    'lfWriteIco',
    'lfPackageBackground',
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
