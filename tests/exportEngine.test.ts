/**
 * Tests du moteur d'export CEP.
 *
 * `src/js/export-engine.js` est en ES5 pur, hors du périmètre TypeScript : rien
 * ne le compile, rien ne le vérifie au build. Ses fonctions pures — plan du
 * pack, nommage, arborescence, rapport — sont donc éprouvées ici, et son
 * enchaînement asynchrone est exercé contre une doublure d'ExtendScript.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import * as acorn from 'acorn'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const ENGINE_PATH = resolve(import.meta.dirname, '../src/js/export-engine.js')
const JSX_PATH = resolve(import.meta.dirname, '../src/jsx/main.jsx')
const ENGINE_SOURCE = readFileSync(ENGINE_PATH, 'utf8')
const JSX_SOURCE = readFileSync(JSX_PATH, 'utf8')

/** Le moteur est un script classique : on l'évalue plutôt que de l'importer. */
type EngineFn = (...args: unknown[]) => unknown

function loadEngine(): Record<string, EngineFn> {
  const module = { exports: {} as Record<string, EngineFn> }
  const factory = new Function('module', 'window', 'setTimeout', ENGINE_SOURCE)
  factory(module, globalThis, setTimeout)
  return module.exports
}

interface Component {
  name: string
  artboardIndex: number
}

interface Task {
  kind: string
  format: string
  folder: string
  fileName: string
  scheme: { id: string; name?: string; hex?: string }
  component: Component
  width?: number
}

let engine: ReturnType<typeof loadEngine>

/** Configuration de référence, que chaque cas ajuste. */
function config(overrides: Record<string, unknown> = {}) {
  return {
    clientName: 'Ma Marque',
    outputFolder: '/Users/lea/Livraisons',
    components: [{ name: 'Logo', artboardIndex: 0 }],
    colorSchemes: [{ id: 'fullColor' }],
    formats: { ai: false, svg: true, png: false, pdf: false, eps: false },
    scales: [{ type: 'web', label: '900px', width: 900, resolution: 72 }],
    favicon: false,
    separator: '-',
    padding: { top: 0, right: 0, bottom: 0, left: 0 },
    ...overrides,
  }
}

function plan(overrides: Record<string, unknown> = {}): Task[] {
  return (engine.planExport as (c: unknown) => Task[])(config(overrides))
}

beforeEach(() => {
  engine = loadEngine()
})

afterEach(() => {
  vi.restoreAllMocks()
  delete (globalThis as Record<string, unknown>).__adobe_cep__
})

describe('compatibilité du moteur', () => {
  it('parse intégralement en ES5', () => {
    expect(() =>
      acorn.parse(ENGINE_SOURCE, { ecmaVersion: 5, sourceType: 'script' }),
    ).not.toThrow()
  })

  it('la couche ExtendScript parse elle aussi en ES5', () => {
    // ExtendScript est un moteur ES3 : tout ce qui dépasse ES5 y échoue.
    expect(() =>
      acorn.parse(JSX_SOURCE, { ecmaVersion: 5, sourceType: 'script' }),
    ).not.toThrow()
  })

  it("n'utilise pas JSON, absent du moteur ExtendScript", () => {
    expect(JSX_SOURCE).not.toMatch(/\bJSON\s*\./)
  })

  it('expose toutes les fonctions globales que le moteur appelle', () => {
    const called = [...ENGINE_SOURCE.matchAll(/call\(\s*'(lf\w+)'/g)].map(
      (match) => match[1],
    )
    expect(called.length).toBeGreaterThan(5)
    for (const fn of new Set(called)) {
      expect(JSX_SOURCE, fn).toContain(`function ${fn}(`)
    }
  })
})

describe('nommage', () => {
  it('retire les caractères interdits par le système de fichiers', () => {
    expect(engine.sanitize('a/b:c*d?')).toBe('abcd')
  })

  it('met en PascalCase sans accent', () => {
    expect(engine.pascal('Logo Mark')).toBe('LogoMark')
    expect(engine.pascal('Icône Réduite')).toBe('IconeReduite')
  })

  it('retombe sur « Logo » pour une entrée vide', () => {
    expect(engine.pascal('///')).toBe('Logo')
  })

  it('compose un nom de fichier avec le séparateur choisi', () => {
    expect(engine.buildFileName(['Logo', 'FullColor', '900px'], '-', 'png')).toBe(
      'Logo-FullColor-900px.png',
    )
    expect(engine.buildFileName(['Logo', 'Black'], '_', 'svg')).toBe('Logo_Black.svg')
  })

  it('ignore les segments vides', () => {
    expect(engine.buildFileName(['Logo', '', null, 'Black'], '-', 'svg')).toBe(
      'Logo-Black.svg',
    )
  })

  it('nomme les déclinaisons livrées et les personnalisées', () => {
    expect(engine.schemeLabel({ id: 'fullColor' })).toBe('FullColor')
    expect(engine.schemeLabel({ id: 'grayscale' })).toBe('Grayscale')
    expect(engine.schemeLabel({ id: 'custom', name: 'Bleu marque' })).toBe('BleuMarque')
  })

  it('assemble les chemins selon le séparateur de la racine', () => {
    expect(engine.joinPath('/Users/lea', ['a', 'b.svg'])).toBe('/Users/lea/a/b.svg')
    expect(engine.joinPath('C:\\Users\\lea', ['a', 'b.svg'])).toBe(
      'C:\\Users\\lea\\a\\b.svg',
    )
  })

  it('absorbe un séparateur final en trop', () => {
    expect(engine.joinPath('/tmp/', ['a'])).toBe('/tmp/a')
  })
})

describe('plan du pack', () => {
  it('produit un fichier par composant, déclinaison et format', () => {
    const tasks = plan({
      components: [
        { name: 'Logo', artboardIndex: 0 },
        { name: 'Logo Mark', artboardIndex: 1 },
      ],
      colorSchemes: [{ id: 'fullColor' }, { id: 'black' }],
      formats: { ai: false, svg: true, png: false, pdf: true, eps: false },
    })

    // 2 composants x 2 déclinaisons x 2 formats vectoriels.
    expect(tasks).toHaveLength(8)
  })

  it('multiplie le PNG par les échelles demandées', () => {
    const tasks = plan({
      formats: { ai: false, svg: false, png: true, pdf: false, eps: false },
      scales: [
        { type: 'web', label: '900px', width: 900, resolution: 72 },
        { type: 'print', label: '2400px', width: 2400, resolution: 300 },
      ],
    })

    expect(tasks).toHaveLength(2)
    expect(tasks.map((t) => t.fileName)).toEqual([
      'Logo-FullColor-900px.png',
      'Logo-FullColor-2400px.png',
    ])
  })

  it('range chaque format dans son dossier', () => {
    const tasks = plan({
      formats: { ai: true, svg: true, png: true, pdf: true, eps: true },
      scales: [
        { type: 'web', label: '900px', width: 900, resolution: 72 },
        { type: 'print', label: '2400px', width: 2400, resolution: 300 },
      ],
    })
    const folders: Record<string, string> = {}
    for (const task of tasks) folders[task.fileName] = task.folder

    expect(folders['Logo.ai']).toBe('01_Sources')
    expect(folders['Logo-FullColor.svg']).toBe('02_Web/SVG')
    expect(folders['Logo-FullColor-900px.png']).toBe('02_Web/PNG')
    expect(folders['Logo-FullColor-2400px.png']).toBe('03_Print/PNG')
    expect(folders['Logo-FullColor.pdf']).toBe('03_Print/PDF')
    expect(folders['Logo-FullColor.eps']).toBe('03_Print/EPS')
  })

  it("n'écrit la source .ai qu'en pleine couleur", () => {
    const tasks = plan({
      colorSchemes: [{ id: 'fullColor' }, { id: 'black' }, { id: 'white' }],
      formats: { ai: true, svg: false, png: false, pdf: false, eps: false },
    })

    // Un .ai recoloré ne serait plus une source.
    expect(tasks).toHaveLength(1)
    expect(tasks[0].fileName).toBe('Logo.ai')
  })

  it('ajoute les cinq favicons quand ils sont demandés', () => {
    const tasks = plan({
      formats: { ai: false, svg: false, png: false, pdf: false, eps: false },
      favicon: true,
    })

    expect(tasks).toHaveLength(5)
    expect(tasks.map((t) => t.fileName)).toEqual([
      'favicon-16px.png',
      'favicon-32px.png',
      'favicon-128px.png',
      'favicon-180px.png',
      'favicon-192px.png',
    ])
    expect(tasks[0].folder).toBe('04_Favicon')
  })

  it('groupe les tâches par déclinaison', () => {
    const tasks = plan({
      components: [
        { name: 'Logo', artboardIndex: 0 },
        { name: 'Mark', artboardIndex: 1 },
      ],
      colorSchemes: [{ id: 'black' }, { id: 'fullColor' }],
    })

    // Le recolorage est coûteux : toutes les tâches d'un même schéma se suivent.
    const order = tasks.map((t) => t.scheme.id)
    const firstChange = order.indexOf(order[order.length - 1])
    expect(order.slice(0, firstChange).every((id) => id === order[0])).toBe(true)
  })

  it('nomme les fichiers avec la couleur personnalisée', () => {
    const tasks = plan({
      colorSchemes: [{ id: 'custom', name: 'Bleu Marque', hex: '#2680eb' }],
    })

    expect(tasks[0].fileName).toBe('Logo-BleuMarque.svg')
  })

  it('renvoie un plan vide sans format ni favicon', () => {
    expect(
      plan({
        formats: { ai: false, svg: false, png: false, pdf: false, eps: false },
      }),
    ).toEqual([])
  })
})

describe('arborescence', () => {
  it('remonte tous les dossiers parents, sans doublon', () => {
    const tasks = plan({
      formats: { ai: true, svg: true, png: true, pdf: false, eps: false },
    })
    const directories = (engine.planDirectories as (t: Task[]) => string[])(tasks)

    expect(directories).toContain('01_Sources')
    expect(directories).toContain('02_Web')
    expect(directories).toContain('02_Web/SVG')
    expect(directories).toContain('02_Web/PNG')
    expect(new Set(directories).size).toBe(directories.length)
  })

  it('place toujours le dossier du rapport', () => {
    const directories = (engine.planDirectories as (t: Task[]) => string[])(plan())
    expect(directories).toContain('05_Rapport')
  })

  it('liste les parents avant leurs enfants', () => {
    const tasks = plan({
      formats: { ai: false, svg: true, png: false, pdf: false, eps: false },
    })
    const directories = (engine.planDirectories as (t: Task[]) => string[])(tasks)
    expect(directories.indexOf('02_Web')).toBeLessThan(
      directories.indexOf('02_Web/SVG'),
    )
  })
})

describe('échappement ExtendScript', () => {
  it('protège les antislashs des chemins Windows', () => {
    expect(engine.quote('C:\\Users\\lea')).toBe('"C:\\\\Users\\\\lea"')
  })

  it('protège les guillemets', () => {
    expect(engine.quote('dossier "test"')).toBe('"dossier \\"test\\""')
  })

  it('accepte une valeur absente', () => {
    expect(engine.quote(null)).toBe('""')
    expect(engine.quote(undefined)).toBe('""')
  })
})

describe('rapport HTML', () => {
  const result = {
    written: [
      {
        component: { name: 'Logo' },
        scheme: { id: 'fullColor' },
        format: 'svg',
        folder: '02_Web/SVG',
        fileName: 'Logo-FullColor.svg',
      },
    ],
    failures: [
      {
        task: {
          component: { name: 'Mark' },
          scheme: { id: 'black' },
          format: 'eps',
          folder: '03_Print/EPS',
          fileName: 'Mark-Black.eps',
        },
        message: 'disque plein',
      },
    ],
    cancelled: false,
    durationMs: 12_300,
    documentName: 'marque.ai',
  }

  it('produit un document HTML autonome', () => {
    const html = (engine.buildReport as (c: unknown, r: unknown) => string)(
      config(),
      result,
    )

    expect(html).toMatch(/^<!DOCTYPE html>/)
    expect(html).toContain('<style>')
    // Aucune ressource externe : le rapport voyage avec le pack.
    expect(html).not.toMatch(/<link[^>]+href=/)
    expect(html).not.toMatch(/<script/)
  })

  it('liste les réussites comme les échecs', () => {
    const html = (engine.buildReport as (c: unknown, r: unknown) => string)(
      config(),
      result,
    )

    expect(html).toContain('Logo-FullColor.svg')
    expect(html).toContain('disque plein')
    expect(html).toContain('Ma Marque')
  })

  it('échappe le HTML des noms fournis par l’utilisateur', () => {
    const html = (engine.buildReport as (c: unknown, r: unknown) => string)(
      config({ clientName: '<script>x</script>' }),
      result,
    )

    expect(html).not.toContain('<script>x')
    expect(html).toContain('&lt;script&gt;')
  })

  it('met en forme la durée', () => {
    expect(engine.formatDuration(12_300)).toBe('12.3 s')
    expect(engine.formatDuration(125_000)).toBe('2 min 5 s')
  })
})

/* -------------------------------------------------------------------------- *
 * Enchaînement asynchrone
 * -------------------------------------------------------------------------- */

/** Doublure d'ExtendScript : répond à chaque appel, et note ce qu'on lui demande. */
function installHost(options: { failOn?: RegExp; unsaved?: boolean } = {}) {
  const calls: string[] = []

  ;(globalThis as Record<string, unknown>).__adobe_cep__ = {
    evalScript(expression: string, callback: (raw: string) => void) {
      calls.push(expression)
      const answer = () => {
        if (expression.indexOf('lfGetDocumentInfo') === 0) {
          const path = options.unsaved ? '' : '/tmp/marque.ai'
          const unit = String.fromCharCode(31)
          return 'OK|' + ['marque.ai', path, 512, 512, 3].join(unit)
        }
        if (options.failOn && options.failOn.test(expression)) {
          return 'ERR|disque plein'
        }
        return 'OK|done'
      }
      // evalScript est asynchrone : la doublure l'est aussi, sans quoi les
      // tests valideraient un enchaînement que CEP n'accepterait pas.
      setTimeout(() => callback(answer()), 0)
    },
  }

  return calls
}

/** Attend la fin d'un export et renvoie son bilan. */
function runExport(
  engineRef: ReturnType<typeof loadEngine>,
  overrides: Record<string, unknown> = {},
): Promise<{ result?: Record<string, unknown>; error?: string }> {
  return new Promise((resolvePromise) => {
    ;(engineRef.runFullExport as (c: unknown, h: unknown) => unknown)(
      config(overrides),
      {
        onProgress: () => {},
        onDone: (result: Record<string, unknown>) => resolvePromise({ result }),
        onError: (error: string) => resolvePromise({ error }),
      },
    )
  })
}

describe('runFullExport', () => {
  it('écrit chaque fichier du plan', async () => {
    installHost()
    const { result } = await runExport(engine, {
      components: [
        { name: 'Logo', artboardIndex: 0 },
        { name: 'Mark', artboardIndex: 1 },
      ],
    })

    expect((result!.written as unknown[]).length).toBe(2)
    expect(result!.failures).toEqual([])
  })

  it('ouvre puis referme la copie de travail', async () => {
    const calls = installHost()
    await runExport(engine)

    expect(calls.some((c) => c.indexOf('lfBeginSession') === 0)).toBe(true)
    expect(calls.some((c) => c.indexOf('lfEndSession') === 0)).toBe(true)
  })

  it('crée les dossiers avant toute exportation', async () => {
    const calls = installHost()
    await runExport(engine)

    const firstFolder = calls.findIndex((c) => c.indexOf('lfCreateFolder') === 0)
    const firstExport = calls.findIndex((c) => c.indexOf('lfExport') === 0)
    expect(firstFolder).toBeGreaterThanOrEqual(0)
    expect(firstFolder).toBeLessThan(firstExport)
  })

  it("n'applique la recoloration qu'une fois par déclinaison", async () => {
    const calls = installHost()
    await runExport(engine, {
      components: [
        { name: 'Logo', artboardIndex: 0 },
        { name: 'Mark', artboardIndex: 1 },
        { name: 'Type', artboardIndex: 2 },
      ],
      colorSchemes: [{ id: 'fullColor' }, { id: 'black' }],
    })

    const recolors = calls.filter((c) => c.indexOf('lfApplyColorScheme') === 0)
    expect(recolors).toHaveLength(2)
  })

  it('poursuit le lot après un échec de fichier', async () => {
    installHost({ failOn: /lfExportSVG/ })
    const { result } = await runExport(engine, {
      components: [
        { name: 'Logo', artboardIndex: 0 },
        { name: 'Mark', artboardIndex: 1 },
      ],
      formats: { ai: true, svg: true, png: false, pdf: false, eps: false },
    })

    expect((result!.failures as unknown[]).length).toBe(2)
    expect((result!.written as unknown[]).length).toBe(2)
  })

  it('écrit le rapport en fin de course', async () => {
    const calls = installHost()
    const { result } = await runExport(engine)

    expect(calls.some((c) => c.indexOf('lfWriteTextFile') === 0)).toBe(true)
    expect(result!.reportPath).toContain('05_Rapport')
  })

  it('exige un document enregistré', async () => {
    installHost({ unsaved: true })
    const { error } = await runExport(engine)

    expect(error).toMatch(/Enregistrez le document/)
  })

  it('range le pack sous le nom du client', async () => {
    const calls = installHost()
    await runExport(engine, { clientName: 'Atelier Nord' })

    expect(calls.some((c) => c.indexOf('Atelier Nord') !== -1)).toBe(true)
  })
})
