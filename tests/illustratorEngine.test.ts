import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { setIllustratorHost } from '../src/illustrator/host'
import {
  applyColorScheme,
  createIllustratorEngine,
  duplicateDocument,
  exportAsEPS,
  exportAsJPEG,
  exportAsPDF,
  exportAsPNG,
  exportAsSVG,
  exportPlannedFile,
  getActiveDocument,
  toColorScheme,
} from '../src/illustrator/illustratorEngine'
import type { IllustratorDocument } from '../src/illustrator/host'
import type { PlannedFile, RenderRequest } from '../src/core/types'
import {
  createMockDocument,
  createMockHost,
  rgbItem,
  type MockDocument,
} from './illustratorHostMock'

/** Convertit la doublure au type attendu par le moteur. */
function asDocument(document: MockDocument): IllustratorDocument {
  return document as unknown as IllustratorDocument
}

function plannedFile(overrides: Partial<PlannedFile> = {}): PlannedFile {
  return {
    path: 'pack/Web/PNG/marque-principal-couleur-512px.png',
    fileName: 'marque-principal-couleur-512px.png',
    directory: 'pack/Web/PNG',
    variant: 'primary',
    colorMode: 'full-color',
    format: 'png',
    colorSpace: 'rgb',
    usage: 'web',
    size: 512,
    transparent: true,
    ...overrides,
  }
}

function request(overrides: Partial<RenderRequest> = {}): RenderRequest {
  return {
    file: plannedFile(),
    outputPath: '/tmp/pack/logo.png',
    artboardIndex: 0,
    resolution: 144,
    quality: 90,
    background: '#ffffff',
    ...overrides,
  }
}

afterEach(() => {
  setIllustratorHost(null)
  vi.restoreAllMocks()
})

describe('getActiveDocument', () => {
  it('signale le document ouvert', () => {
    setIllustratorHost(
      createMockHost(
        createMockDocument({
          name: 'test-logo.ai',
          nativePath: '/tmp/test-logo.ai',
          artboardCount: 2,
          artboardWidth: 512,
        }),
      ),
    )

    expect(getActiveDocument()).toEqual({
      name: 'test-logo.ai',
      path: '/tmp/test-logo.ai',
      artboardCount: 2,
      artboardWidthPoints: 512,
    })
  })

  it("renvoie null quand aucun document n'est ouvert", () => {
    setIllustratorHost(createMockHost(null))
    expect(getActiveDocument()).toBeNull()
  })

  it("renvoie null quand l'hôte Illustrator est absent", () => {
    setIllustratorHost(null)
    expect(getActiveDocument()).toBeNull()
  })

  it("renvoie null plutôt que de propager une erreur de l'hôte", () => {
    const host = createMockHost()
    Object.defineProperty(host.app, 'activeDocument', {
      get() {
        throw new Error('No document is open')
      },
    })
    setIllustratorHost(host)

    expect(getActiveDocument()).toBeNull()
  })

  it('retombe sur document.width faute de rectangle de plan de travail', () => {
    const document = createMockDocument({ artboardWidth: 300 })
    document.artboards[0] = {}
    setIllustratorHost(createMockHost(document))

    expect(getActiveDocument()?.artboardWidthPoints).toBe(300)
  })
})

describe('exportAsSVG', () => {
  beforeEach(() => setIllustratorHost(createMockHost()))

  it('appelle exportFile avec le type SVG et le chemin demandé', async () => {
    const document = createMockDocument()
    await exportAsSVG(asDocument(document), '/tmp/logo.svg')

    expect(document.exportFile).toHaveBeenCalledTimes(1)
    const [call] = document.calls
    expect(call.kind).toBe('export')
    expect(call.type).toBe('SVG')
    expect(call.target).toBe('/tmp/logo.svg')
  })

  it('incorpore les images et vectorise les polices par défaut', async () => {
    const document = createMockDocument()
    await exportAsSVG(asDocument(document), '/tmp/logo.svg')

    expect(document.calls[0].options).toMatchObject({
      embedRasterImages: true,
      preserveEditability: false,
      fontType: 'OUTLINEFONT',
    })
  })

  it('respecte les options passées', async () => {
    const document = createMockDocument()
    await exportAsSVG(asDocument(document), '/tmp/logo.svg', {
      embedImages: false,
      preserveEditability: true,
    })

    expect(document.calls[0].options).toMatchObject({
      embedRasterImages: false,
      preserveEditability: true,
    })
  })

  it('cible le plan de travail demandé', async () => {
    const document = createMockDocument({ artboardCount: 3 })
    await exportAsSVG(asDocument(document), '/tmp/logo.svg', { artboardIndex: 2 })

    expect(document.artboards.setActiveArtboardIndex).toHaveBeenCalledWith(2)
    // L'intervalle d'Illustrator est en base 1.
    expect(document.calls[0].options).toMatchObject({ artboardRange: '3' })
  })

  it('ignore un index de plan de travail hors limites', async () => {
    const document = createMockDocument({ artboardCount: 2 })
    await exportAsSVG(asDocument(document), '/tmp/logo.svg', { artboardIndex: 9 })

    expect(document.artboards.setActiveArtboardIndex).not.toHaveBeenCalled()
  })

  it("enveloppe l'erreur de l'hôte avec le nom du fichier", async () => {
    const document = createMockDocument({ failExports: true })

    await expect(exportAsSVG(asDocument(document), '/tmp/logo.svg')).rejects.toThrow(
      /Export SVG de \/tmp\/logo\.svg : disque plein/,
    )
  })
})

describe('exportAsPNG', () => {
  beforeEach(() => setIllustratorHost(createMockHost()))

  it("traduit la résolution en pourcentage d'échelle", async () => {
    const document = createMockDocument()
    await exportAsPNG(asDocument(document), '/tmp/logo.png', { resolution: 144 })

    // 144 ppp valent le double de la référence de 72 ppp.
    expect(document.calls[0].options).toMatchObject({
      horizontalScale: 200,
      verticalScale: 200,
    })
  })

  it('utilise 72 ppp par défaut, soit 100 %', async () => {
    const document = createMockDocument()
    await exportAsPNG(asDocument(document), '/tmp/logo.png')

    expect(document.calls[0].options).toMatchObject({ horizontalScale: 100 })
  })

  it('exporte en PNG24 avec cadrage sur le plan de travail', async () => {
    const document = createMockDocument()
    await exportAsPNG(asDocument(document), '/tmp/logo.png')

    expect(document.calls[0].type).toBe('PNG24')
    expect(document.calls[0].options).toMatchObject({ artBoardClipping: true })
  })

  it('transmet la transparence demandée', async () => {
    const document = createMockDocument()
    await exportAsPNG(asDocument(document), '/tmp/logo.png', { transparency: false })

    expect(document.calls[0].options).toMatchObject({ transparency: false })
  })

  it('rejette une résolution invalide', async () => {
    const document = createMockDocument()

    await expect(
      exportAsPNG(asDocument(document), '/tmp/logo.png', { resolution: 0 }),
    ).rejects.toThrow(/Résolution PNG invalide/)
  })
})

describe('exportAsPDF et exportAsEPS', () => {
  beforeEach(() => setIllustratorHost(createMockHost()))

  it('le PDF passe par saveAs, pas par exportFile', async () => {
    const document = createMockDocument()
    await exportAsPDF(asDocument(document), '/tmp/logo.pdf')

    expect(document.saveAs).toHaveBeenCalledTimes(1)
    expect(document.exportFile).not.toHaveBeenCalled()
    expect(document.calls[0].kind).toBe('save')
  })

  it("le PDF conserve l'éditabilité et n'ouvre pas Acrobat", async () => {
    const document = createMockDocument()
    await exportAsPDF(asDocument(document), '/tmp/logo.pdf')

    expect(document.calls[0].options).toMatchObject({
      preserveEditability: true,
      viewAfterSaving: false,
    })
  })

  it("l'EPS passe par saveAs et incorpore les polices", async () => {
    const document = createMockDocument()
    await exportAsEPS(asDocument(document), '/tmp/logo.eps')

    expect(document.calls[0].kind).toBe('save')
    expect(document.calls[0].options).toMatchObject({ embedAllFonts: true })
  })

  it("enveloppe l'erreur EPS avec le nom du fichier", async () => {
    const document = createMockDocument({ failExports: true })

    await expect(exportAsEPS(asDocument(document), '/tmp/logo.eps')).rejects.toThrow(
      /Export EPS de \/tmp\/logo\.eps/,
    )
  })
})

describe('exportAsJPEG', () => {
  beforeEach(() => setIllustratorHost(createMockHost()))

  it('transmet la qualité demandée', async () => {
    const document = createMockDocument()
    await exportAsJPEG(asDocument(document), '/tmp/logo.jpg', { quality: 75 })

    expect(document.calls[0].type).toBe('JPEG')
    expect(document.calls[0].options).toMatchObject({ qualitySetting: 75 })
  })
})

describe('duplicateDocument', () => {
  it("utilise document.duplicate() quand l'hôte l'expose", async () => {
    setIllustratorHost(createMockHost())
    const document = createMockDocument({ withDuplicate: true })

    const copy = await duplicateDocument(asDocument(document))

    expect(document.duplicate).toHaveBeenCalledTimes(1)
    expect((copy as unknown as MockDocument).name).toBe('test-logo.ai (copie)')
  })

  it('retombe sur un document neuf peuplé des éléments source', async () => {
    const host = createMockHost()
    setIllustratorHost(host)

    const items = [rgbItem(255, 0, 0), rgbItem(0, 255, 0)].map((item) => ({
      ...item,
      duplicate: vi.fn(),
    }))
    const document = createMockDocument({ withDuplicate: false, items })

    await duplicateDocument(asDocument(document))

    expect(host.app.documents.add).toHaveBeenCalledTimes(1)
    for (const item of items) {
      expect(item.duplicate).toHaveBeenCalledTimes(1)
    }
  })

  it('échoue explicitement sans duplicate() ni documents.add()', async () => {
    const host = createMockHost()
    // @ts-expect-error suppression volontaire pour simuler un hôte incomplet
    delete host.app.documents.add
    setIllustratorHost(host)

    const document = createMockDocument({ withDuplicate: false })

    await expect(duplicateDocument(asDocument(document))).rejects.toThrow(
      /Duplication du document/,
    )
  })
})

describe('applyColorScheme', () => {
  beforeEach(() => setIllustratorHost(createMockHost()))

  it('ne touche à rien en mode original', async () => {
    const item = rgbItem(38, 128, 235)
    const document = createMockDocument({ items: [item] })

    await applyColorScheme(asDocument(document), 'original')

    expect(item.fillColor).toEqual({ red: 38, green: 128, blue: 235 })
  })

  it('passe les fonds et contours en noir CMJN K:100', async () => {
    const item = rgbItem(38, 128, 235)
    const document = createMockDocument({ items: [item] })

    await applyColorScheme(asDocument(document), 'black')

    expect(item.fillColor).toEqual({ cyan: 0, magenta: 0, yellow: 0, black: 100 })
    expect(item.strokeColor).toEqual({ cyan: 0, magenta: 0, yellow: 0, black: 100 })
  })

  it('passe tout en blanc', async () => {
    const item = rgbItem(38, 128, 235)
    const document = createMockDocument({ items: [item] })

    await applyColorScheme(asDocument(document), 'white')

    expect(item.fillColor).toEqual({ cyan: 0, magenta: 0, yellow: 0, black: 0 })
  })

  it('convertit une couleur en niveau de gris équivalent', async () => {
    // Noir pur : luminance nulle, donc gray à 100 chez Illustrator.
    const item = rgbItem(0, 0, 0)
    const document = createMockDocument({ items: [item] })

    await applyColorScheme(asDocument(document), 'grayscale')

    expect(item.fillColor).toEqual({ gray: 100 })
  })

  it('convertit le blanc en gray 0', async () => {
    const item = rgbItem(255, 255, 255)
    const document = createMockDocument({ items: [item] })

    await applyColorScheme(asDocument(document), 'grayscale')

    expect(item.fillColor).toEqual({ gray: 0 })
  })

  it('laisse intact un dégradé, non convertible en niveaux de gris', async () => {
    const gradient = { type: 'gradient' }
    const item = {
      filled: true,
      stroked: false,
      fillColor: gradient,
      strokeColor: null,
    }
    const document = createMockDocument({ items: [item] })

    await applyColorScheme(asDocument(document), 'grayscale')

    expect(item.fillColor).toBe(gradient)
  })

  it('ignore un élément non rempli et non contouré', async () => {
    const item = { filled: false, stroked: false, fillColor: null, strokeColor: null }
    const document = createMockDocument({ items: [item] })

    await applyColorScheme(asDocument(document), 'black')

    expect(item.fillColor).toBeNull()
    expect(item.strokeColor).toBeNull()
  })
})

describe('toColorScheme', () => {
  it('associe chaque déclinaison du plan à un schéma de document', () => {
    expect(toColorScheme('full-color')).toBe('original')
    expect(toColorScheme('black')).toBe('black')
    expect(toColorScheme('white')).toBe('white')
    expect(toColorScheme('grayscale')).toBe('grayscale')
    // La réserve est un logo blanc posé sur un aplat.
    expect(toColorScheme('knockout')).toBe('white')
  })
})

describe('exportPlannedFile', () => {
  beforeEach(() => setIllustratorHost(createMockHost()))

  it('aiguille chaque format vers le bon appel', async () => {
    const cases: Array<[PlannedFile['format'], 'export' | 'save']> = [
      ['svg', 'export'],
      ['png', 'export'],
      ['jpg', 'export'],
      ['pdf', 'save'],
      ['eps', 'save'],
      ['ai', 'save'],
    ]

    for (const [format, kind] of cases) {
      const document = createMockDocument()
      await exportPlannedFile(
        asDocument(document),
        request({
          file: plannedFile({ format }),
          outputPath: `/tmp/logo.${format}`,
        }),
      )
      expect(document.calls[0].kind, `format ${format}`).toBe(kind)
    }
  })

  it("refuse le WebP, qu'Illustrator ne sait pas exporter par script", async () => {
    const document = createMockDocument()

    await expect(
      exportPlannedFile(
        asDocument(document),
        request({ file: plannedFile({ format: 'webp' }), outputPath: '/tmp/l.webp' }),
      ),
    ).rejects.toThrow(/WEBP n'est pas exportable/)
  })

  it("refuse l'ICO, qu'Illustrator ne sait pas exporter non plus", async () => {
    const document = createMockDocument()

    await expect(
      exportPlannedFile(
        asDocument(document),
        request({ file: plannedFile({ format: 'ico' }), outputPath: '/tmp/l.ico' }),
      ),
    ).rejects.toThrow(/ICO n'est pas exportable/)
  })

  it('reporte la transparence du fichier planifié sur le PNG', async () => {
    const document = createMockDocument()
    await exportPlannedFile(
      asDocument(document),
      request({ file: plannedFile({ format: 'png', transparent: false }) }),
    )

    expect(document.calls[0].options).toMatchObject({ transparency: false })
  })
})

describe('createIllustratorEngine', () => {
  it('expose le document actif à travers la façade', () => {
    setIllustratorHost(createMockHost(createMockDocument({ name: 'marque.ai' })))

    expect(createIllustratorEngine().getActiveDocument()?.name).toBe('marque.ai')
  })

  it('refuse de dupliquer sans document ouvert', async () => {
    setIllustratorHost(createMockHost(null))

    await expect(createIllustratorEngine().duplicateActiveDocument()).rejects.toThrow(
      /Aucun document Illustrator ouvert/,
    )
  })

  it('rejette une poignée de document invalide', async () => {
    setIllustratorHost(createMockHost())

    await expect(
      createIllustratorEngine().applyColorScheme(null, 'black'),
    ).rejects.toThrow(/Poignée de document Illustrator invalide/)
  })

  it('referme un duplicata sans enregistrer', async () => {
    setIllustratorHost(createMockHost())
    const document = createMockDocument()

    await createIllustratorEngine().closeDocument(document)

    expect(document.close).toHaveBeenCalledWith('DONOTSAVECHANGES')
    expect(document.closed).toBe(true)
  })
})
