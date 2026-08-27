import { describe, expect, it, vi } from 'vitest'

import {
  colorSchemeFor,
  resolutionFor,
  runExport,
  summarizeReport,
  toNativePath,
} from '../src/core/exportOrchestrator'
import { planExport } from '../src/core/planner'
import type {
  ActiveDocumentInfo,
  ColorScheme,
  DocumentHandle,
  ExportConfig,
  IllustratorEngine,
  PlannedFile,
  RenderRequest,
} from '../src/core/types'

/** Trace d'un appel reçu par le moteur factice. */
interface EngineCall {
  scheme: ColorScheme
  request: RenderRequest
}

interface FakeEngineOptions {
  document?: ActiveDocumentInfo | null
  /** Fait échouer l'export des fichiers dont le chemin contient ce fragment. */
  failOn?: string
  /** Fait échouer la fermeture des duplicatas. */
  failClose?: boolean
  /** Levé avant chaque export, pour simuler une annulation en cours de route. */
  beforeExport?: () => void
}

/** Moteur factice : il enregistre ce qui lui est demandé, sans rien exporter. */
function createFakeEngine(options: FakeEngineOptions = {}) {
  const {
    document = {
      name: 'test-logo.ai',
      path: '/tmp/test-logo.ai',
      artboardCount: 2,
      artboardWidthPoints: 512,
    },
    failOn,
    failClose = false,
    beforeExport,
  } = options

  const calls: EngineCall[] = []
  /** Duplicatas ouverts, pour vérifier qu'ils sont tous refermés. */
  const open = new Set<DocumentHandle>()
  let nextId = 0

  const engine: IllustratorEngine = {
    getActiveDocument: () => document,

    async duplicateActiveDocument() {
      const handle = { id: (nextId += 1) }
      open.add(handle)
      return handle
    },

    async applyColorScheme(handle, scheme) {
      if (!open.has(handle)) throw new Error('document déjà refermé')
      calls.push({ scheme, request: null as unknown as RenderRequest })
    },

    async exportDocument(handle, request) {
      if (!open.has(handle)) throw new Error('document déjà refermé')
      beforeExport?.()
      // Rattache la requête à la déclinaison enregistrée juste avant.
      calls[calls.length - 1].request = request
      if (failOn && request.file.path.includes(failOn)) {
        throw new Error('exportFile a échoué')
      }
    },

    async closeDocument(handle) {
      open.delete(handle)
      if (failClose) throw new Error('document verrouillé')
    },
  }

  return { engine, calls, open }
}

/** Writer factice : il ne retient que les dossiers demandés. */
function createFakeWriter() {
  const directories: string[] = []
  return {
    directories,
    writer: {
      ensureDirectory: vi.fn(async (path: string) => {
        directories.push(path)
      }),
    },
  }
}

function config(overrides: Partial<ExportConfig> = {}): ExportConfig {
  return {
    naming: {
      brand: 'Ma Marque',
      strategy: 'usage-format',
      namingCase: 'kebab',
      includeSize: true,
      includeColorSpace: true,
      packFolder: 'logo-pack',
    },
    variants: ['primary'],
    colorModes: ['full-color', 'black'],
    formats: ['svg'],
    sizes: [],
    usages: ['web'],
    background: '#ffffff',
    quality: 90,
    ...overrides,
  }
}

describe('toNativePath', () => {
  it('assemble un chemin POSIX', () => {
    expect(toNativePath('/Users/lea/Bureau', 'pack/Web/SVG/a.svg')).toBe(
      '/Users/lea/Bureau/pack/Web/SVG/a.svg',
    )
  })

  it('assemble un chemin Windows avec des antislashs', () => {
    expect(toNativePath('C:\\Users\\lea\\Bureau', 'pack/Web/SVG/a.svg')).toBe(
      'C:\\Users\\lea\\Bureau\\pack\\Web\\SVG\\a.svg',
    )
  })

  it('absorbe un séparateur final en trop', () => {
    expect(toNativePath('/tmp/', 'a.svg')).toBe('/tmp/a.svg')
  })

  it('renvoie la racine pour un chemin relatif vide', () => {
    expect(toNativePath('/tmp', '')).toBe('/tmp')
  })
})

describe('colorSchemeFor', () => {
  it('traduit chaque déclinaison du plan', () => {
    expect(colorSchemeFor('full-color')).toBe('original')
    expect(colorSchemeFor('black')).toBe('black')
    expect(colorSchemeFor('white')).toBe('white')
    expect(colorSchemeFor('knockout')).toBe('white')
    expect(colorSchemeFor('grayscale')).toBe('grayscale')
  })
})

describe('resolutionFor', () => {
  const raster = (size: number | null) => ({ size }) as PlannedFile

  it('calcule la résolution pour tenir la taille demandée', () => {
    // 1024 px sur un plan de 512 pt : il faut doubler les 72 ppp de référence.
    expect(resolutionFor(raster(1024), 512)).toBe(144)
  })

  it('renvoie 72 ppp pour un format vectoriel', () => {
    expect(resolutionFor(raster(null), 512)).toBe(72)
  })

  it('retombe sur 72 ppp si la largeur du plan est inconnue', () => {
    expect(resolutionFor(raster(1024), 0)).toBe(72)
  })
})

describe('runExport', () => {
  it('exporte chaque fichier du plan', async () => {
    const { engine, calls } = createFakeEngine()
    const { writer } = createFakeWriter()
    const options = config()
    const plan = planExport(options)

    const report = await runExport({
      config: options,
      engine,
      writer,
      destination: '/tmp/sortie',
    })

    expect(report.written).toHaveLength(plan.totalFiles)
    expect(report.failures).toEqual([])
    expect(report.cancelled).toBe(false)
    expect(calls).toHaveLength(plan.totalFiles)
  })

  it('duplique, teinte, exporte puis referme pour chaque fichier', async () => {
    const { engine, calls, open } = createFakeEngine()
    const { writer } = createFakeWriter()

    await runExport({
      config: config(),
      engine,
      writer,
      destination: '/tmp/sortie',
    })

    // Aucun duplicata ne doit rester ouvert.
    expect(open.size).toBe(0)
    expect(calls.map((call) => call.scheme)).toEqual(['original', 'black'])
  })

  it('passe au moteur un chemin natif absolu', async () => {
    const { engine, calls } = createFakeEngine()
    const { writer } = createFakeWriter()

    await runExport({
      config: config(),
      engine,
      writer,
      destination: '/tmp/sortie',
    })

    for (const call of calls) {
      expect(call.request.outputPath.startsWith('/tmp/sortie/logo-pack/')).toBe(true)
    }
  })

  it("crée l'arborescence avant d'exporter", async () => {
    const { engine } = createFakeEngine()
    const { writer, directories } = createFakeWriter()

    await runExport({
      config: config(),
      engine,
      writer,
      destination: '/tmp/sortie',
    })

    expect(directories).toEqual([
      '/tmp/sortie/logo-pack',
      '/tmp/sortie/logo-pack/Web',
      '/tmp/sortie/logo-pack/Web/SVG',
    ])
  })

  it('reporte le rapport sur le document et la destination', async () => {
    const { engine } = createFakeEngine()
    const { writer } = createFakeWriter()

    const report = await runExport({
      config: config(),
      engine,
      writer,
      destination: '/tmp/sortie',
    })

    expect(report.document.name).toBe('test-logo.ai')
    expect(report.destination).toBe('/tmp/sortie')
    expect(report.durationMs).toBeGreaterThanOrEqual(0)
  })

  it('calcule la résolution depuis la largeur du plan de travail', async () => {
    const { engine, calls } = createFakeEngine()
    const { writer } = createFakeWriter()

    await runExport({
      config: config({ formats: ['png'], sizes: [1024], colorModes: ['full-color'] }),
      engine,
      writer,
      destination: '/tmp/sortie',
    })

    expect(calls[0].request.resolution).toBe(144)
  })

  it('exige un document ouvert', async () => {
    const { engine } = createFakeEngine({ document: null })
    const { writer } = createFakeWriter()

    await expect(
      runExport({ config: config(), engine, writer, destination: '/tmp' }),
    ).rejects.toThrow(/Aucun document Illustrator ouvert/)
  })

  it("refuse un plan porteur d'erreurs bloquantes", async () => {
    const { engine } = createFakeEngine()
    const { writer } = createFakeWriter()

    await expect(
      runExport({
        config: config({ formats: [] }),
        engine,
        writer,
        destination: '/tmp',
      }),
    ).rejects.toThrow(/erreurs bloquantes/)
  })
})

describe('runExport — gestion des erreurs fichier par fichier', () => {
  it("poursuit le lot après l'échec d'un fichier", async () => {
    const { engine } = createFakeEngine({ failOn: 'noir' })
    const { writer } = createFakeWriter()

    const report = await runExport({
      config: config({ colorModes: ['full-color', 'black', 'white'] }),
      engine,
      writer,
      destination: '/tmp/sortie',
    })

    expect(report.failures).toHaveLength(1)
    expect(report.written).toHaveLength(2)
    expect(report.cancelled).toBe(false)
  })

  it("consigne le chemin du fichier et la cause dans l'échec", async () => {
    const { engine } = createFakeEngine({ failOn: 'noir' })
    const { writer } = createFakeWriter()

    const report = await runExport({
      config: config({ colorModes: ['black'] }),
      engine,
      writer,
      destination: '/tmp/sortie',
    })

    expect(report.failures[0].message).toContain('ma-marque-principal-noir.svg')
    expect(report.failures[0].message).toContain('exportFile a échoué')
    expect(report.failures[0].file.colorMode).toBe('black')
  })

  it("referme le duplicata même quand l'export échoue", async () => {
    const { engine, open } = createFakeEngine({ failOn: 'noir' })
    const { writer } = createFakeWriter()

    await runExport({
      config: config({ colorModes: ['full-color', 'black'] }),
      engine,
      writer,
      destination: '/tmp/sortie',
    })

    expect(open.size).toBe(0)
  })

  it('signale un duplicata resté ouvert sans perdre le fichier écrit', async () => {
    const { engine } = createFakeEngine({ failClose: true })
    const { writer } = createFakeWriter()

    const report = await runExport({
      config: config({ colorModes: ['full-color'] }),
      engine,
      writer,
      destination: '/tmp/sortie',
    })

    expect(report.written).toHaveLength(1)
    expect(report.failures[0].message).toContain('duplicata non refermé')
  })

  it("s'arrête au premier échec quand stopOnError est demandé", async () => {
    const { engine } = createFakeEngine({ failOn: 'couleur' })
    const { writer } = createFakeWriter()

    const report = await runExport({
      config: config({ colorModes: ['full-color', 'black', 'white'] }),
      engine,
      writer,
      destination: '/tmp/sortie',
      stopOnError: true,
    })

    expect(report.failures).toHaveLength(1)
    expect(report.written).toEqual([])
    expect(report.cancelled).toBe(true)
  })
})

describe('runExport — progression et annulation', () => {
  it('appelle onProgress une fois par fichier', async () => {
    const { engine } = createFakeEngine()
    const { writer } = createFakeWriter()
    const onProgress = vi.fn()
    const options = config({ colorModes: ['full-color', 'black', 'white'] })
    const plan = planExport(options)

    await runExport({
      config: options,
      engine,
      writer,
      destination: '/tmp/sortie',
      onProgress,
    })

    expect(onProgress).toHaveBeenCalledTimes(plan.totalFiles)
    expect(onProgress.mock.calls.at(-1)?.[0]).toMatchObject({
      completed: plan.totalFiles,
      total: plan.totalFiles,
    })
  })

  it('signale aussi la progression des fichiers en échec', async () => {
    const { engine } = createFakeEngine({ failOn: 'noir' })
    const { writer } = createFakeWriter()
    const onProgress = vi.fn()

    await runExport({
      config: config({ colorModes: ['full-color', 'black'] }),
      engine,
      writer,
      destination: '/tmp/sortie',
      onProgress,
    })

    expect(onProgress).toHaveBeenCalledTimes(2)
  })

  it("interrompt l'export dès que le signal est levé", async () => {
    const signal = { aborted: false }
    const { engine } = createFakeEngine({
      // Lever le drapeau pendant le premier export coupe la boucle au suivant.
      beforeExport: () => {
        signal.aborted = true
      },
    })
    const { writer } = createFakeWriter()

    const report = await runExport({
      config: config({ colorModes: ['full-color', 'black', 'white'] }),
      engine,
      writer,
      destination: '/tmp/sortie',
      signal,
    })

    expect(report.cancelled).toBe(true)
    expect(report.written).toHaveLength(1)
  })
})

describe('summarizeReport', () => {
  it('résume un export réussi', async () => {
    const { engine } = createFakeEngine()
    const { writer } = createFakeWriter()

    const report = await runExport({
      config: config({ colorModes: ['full-color'] }),
      engine,
      writer,
      destination: '/tmp/sortie',
    })

    expect(summarizeReport(report)).toMatch(/^1 fichiers écrits en \d+\.\d s$/)
  })

  it("mentionne les échecs et l'interruption", () => {
    expect(
      summarizeReport({
        document: {
          name: 'a.ai',
          path: '',
          artboardCount: 1,
          artboardWidthPoints: 512,
        },
        plan: planExport(config()),
        destination: '/tmp',
        written: [],
        failures: [{ file: {} as PlannedFile, message: 'x' }],
        cancelled: true,
        durationMs: 200,
      }),
    ).toBe('0 fichiers écrits en 0.2 s · 1 échecs · export interrompu')
  })
})
