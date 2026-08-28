/**
 * Planche de revue : géométrie de la grille et construction dans Illustrator.
 *
 * La grille est calculée en JavaScript ordinaire et vérifiée ici à
 * l'arithmétique près ; le placement, lui, est exécuté contre la doublure du
 * modèle objet d'Illustrator. Une planche fausse est le genre de défaut qui,
 * sans ces cas, ne se découvrirait qu'à l'écran.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { beforeEach, describe, expect, it } from 'vitest'

import {
  FakeDocument,
  FakeItem,
  loadExtendScript,
  parseResult,
} from './extendscriptHost'

/* ------------------------------------------------------------------ *
 * Moteur de grille, chargé comme le panneau le charge
 * ------------------------------------------------------------------ */

const ENGINE_SOURCE = readFileSync(
  resolve(import.meta.dirname, '../src/js/export-engine.js'),
  'utf8',
)

type Engine = Record<string, (...args: never[]) => never>

function loadEngine(): Engine {
  const factory = new Function(
    'module',
    'window',
    'setTimeout',
    `${ENGINE_SOURCE}\nreturn module.exports`,
  ) as (
    module: { exports: unknown },
    window: unknown,
    timeout: typeof setTimeout,
  ) => Engine

  const holder = { exports: {} }
  // Le moteur cherche son hôte sur `window` : la doublure CEP est installée
  // sur `globalThis`, il faut donc lui passer le même objet.
  return factory(holder, globalThis, setTimeout)
}

const engine = loadEngine()

interface Component {
  name: string
  path: string
}

function component(name: string): Component {
  return { name, path: '/tmp/' + name + '.ai' }
}

function gridConfig(overrides: Record<string, unknown> = {}) {
  return {
    components: [component('Logo'), component('Mark')],
    colorSchemes: [{ id: 'fullColor' }, { id: 'black' }],
    grid: {},
    ...overrides,
  }
}

type Grid = {
  width: number
  height: number
  columns: number
  rows: number
  cells: Array<{
    left: number
    top: number
    width: number
    height: number
    column: number
    row: number
    component: Component
    scheme: { id: string }
  }>
  labels: Array<{ kind: string; text: string; left: number; top: number }>
  settings: Record<string, number>
}

const plan = (config: unknown): Grid =>
  (engine.planPackageGrid as unknown as (c: unknown) => Grid)(config)

describe('géométrie de la planche', () => {
  it('croise les composants en colonnes et les déclinaisons en lignes', () => {
    const grid = plan(gridConfig())

    expect(grid.columns).toBe(2)
    expect(grid.rows).toBe(2)
    expect(grid.cells).toHaveLength(4)
  })

  it('ignore les composants non définis', () => {
    const grid = plan(
      gridConfig({
        components: [component('Logo'), { name: 'Vide', path: '' }],
      }),
    )

    expect(grid.columns).toBe(1)
    expect(grid.cells).toHaveLength(2)
  })

  it('ne produit aucune cellule sans composant ni sans déclinaison', () => {
    expect(plan(gridConfig({ components: [] })).cells).toHaveLength(0)
    expect(plan(gridConfig({ colorSchemes: [] })).cells).toHaveLength(0)
  })

  it('déduit la taille de la planche de ses marges et de ses gouttières', () => {
    const grid = plan(gridConfig())
    const s = grid.settings

    expect(grid.width).toBe(
      s.margin * 2 + s.labelGutter + 2 * s.cellWidth + s.columnGap,
    )
    expect(grid.height).toBe(
      s.margin * 2 + s.headerHeight + 2 * s.cellHeight + s.rowGap,
    )
  })

  it('espace les colonnes de la gouttière demandée', () => {
    const grid = plan(gridConfig({ grid: { columnGap: 40, cellWidth: 100 } }))
    const first = grid.cells.find((cell) => cell.column === 0)!
    const second = grid.cells.find((cell) => cell.column === 1)!

    expect(second.left - first.left).toBe(140)
  })

  it('descend chaque ligne de la hauteur de cellule et de sa gouttière', () => {
    const grid = plan(gridConfig({ grid: { rowGap: 20, cellHeight: 90 } }))
    const first = grid.cells.find((cell) => cell.row === 0)!
    const second = grid.cells.find((cell) => cell.row === 1)!

    // Les ordonnées décroissent vers le bas, comme dans Illustrator.
    expect(first.top - second.top).toBe(110)
    expect(second.top).toBeLessThan(first.top)
  })

  it('garde toutes les cellules dans le plan de travail', () => {
    const grid = plan(
      gridConfig({
        components: [component('A'), component('B'), component('C')],
        colorSchemes: [{ id: 'fullColor' }, { id: 'black' }, { id: 'white' }],
      }),
    )

    for (const cell of grid.cells) {
      expect(cell.left).toBeGreaterThanOrEqual(0)
      expect(cell.left + cell.width).toBeLessThanOrEqual(grid.width)
      expect(cell.top).toBeLessThanOrEqual(0)
      expect(cell.top - cell.height).toBeGreaterThanOrEqual(-grid.height)
    }
  })

  it('étiquette chaque colonne et chaque ligne', () => {
    const grid = plan(gridConfig())
    const columns = grid.labels.filter((label) => label.kind === 'column')
    const rows = grid.labels.filter((label) => label.kind === 'row')

    expect(columns.map((label) => label.text)).toEqual(['Logo', 'Mark'])
    expect(rows.map((label) => label.text)).toEqual(['Full Color', 'Black'])
  })

  it('complète les réglages absents par leurs valeurs par défaut', () => {
    const settings = (
      engine.gridSettings as unknown as (o: unknown) => Record<string, number>
    )({ cellWidth: 300, rowGap: 'invalide' })

    expect(settings.cellWidth).toBe(300)
    expect(settings.rowGap).toBe(
      (engine.GRID_DEFAULTS as unknown as Record<string, number>).rowGap,
    )
  })

  it('refuse une valeur négative et retombe sur la valeur par défaut', () => {
    const settings = (
      engine.gridSettings as unknown as (o: unknown) => Record<string, number>
    )({ margin: -20 })

    expect(settings.margin).toBe(
      (engine.GRID_DEFAULTS as unknown as Record<string, number>).margin,
    )
  })
})

/* ------------------------------------------------------------------ *
 * Construction dans Illustrator
 * ------------------------------------------------------------------ */

type Host = ReturnType<typeof loadExtendScript>

let host: Host

/** Document contenant `labels` en objets de premier niveau. */
function openDocument(labels: string[], name = 'brand.ai'): FakeDocument {
  const doc = new FakeDocument(name, 'RGB', 600, 400)
  doc.layers[0].items = labels.map(
    (label, index) => new FakeItem('PathItem', [index * 10, 100, 200, -100], label),
  )
  host.app.documents.push(doc)
  host.app.activeDocument = doc
  return doc
}

beforeEach(() => {
  host = loadExtendScript()
})

describe('objets de premier niveau', () => {
  it('ne recompte pas le contenu des groupes', () => {
    const doc = openDocument(['fond'])
    // Un groupe et son enfant : `pageItems` voit les deux, le moteur ne doit
    // retenir que le groupe.
    const group = doc.groupItems.add()
    group.insert(new FakeItem('PathItem', [0, 10, 10, 0], 'enfant'), 'PLACEATEND')

    expect(doc.pageItems).toHaveLength(3)

    const result = parseResult(host.api.lfInspectDocument(0))
    expect(result.ok).toBe(true)
    expect(result.fields[0]).toBe('2') // fond + groupe
  })
})

describe('ajustement du plan de travail', () => {
  it("cadre le plan de travail sur l'étendue du contenu", () => {
    const doc = openDocument(['marque'])
    doc.layers[0].items[0].visibleBounds = [20, 80, 180, -60]

    const result = parseResult(host.api.lfFitArtboard(0))

    expect(result.ok).toBe(true)
    expect(doc.artboards[0].artboardRect).toEqual([20, 80, 180, -60])
    expect(result.fields[0]).toBe('160')
    expect(result.fields[1]).toBe('140')
  })

  it('refuse un document sans objet', () => {
    openDocument([])
    const result = parseResult(host.api.lfFitArtboard(0))

    expect(result.ok).toBe(false)
    expect(result.value).toContain('aucun objet')
  })

  it('refuse un plan de travail inexistant', () => {
    openDocument(['marque'])
    const result = parseResult(host.api.lfFitArtboard(4))

    expect(result.ok).toBe(false)
    expect(result.value).toContain('inexistant')
  })
})

describe('inspection du document', () => {
  it('signale les objets débordant du plan de travail', () => {
    const doc = openDocument(['dedans', 'dehors'])
    doc.artboards[0].artboardRect = [0, 100, 200, -100]
    doc.layers[0].items[0].visibleBounds = [10, 90, 190, -90]
    doc.layers[0].items[1].visibleBounds = [10, 90, 400, -90]

    const result = parseResult(host.api.lfInspectDocument(0))

    expect(result.ok).toBe(true)
    expect(result.fields[3]).toBe('1')
  })

  it('ne compte pas un débordement pour un arrondi au point près', () => {
    const doc = openDocument(['limite'])
    doc.artboards[0].artboardRect = [0, 100, 200, -100]
    doc.layers[0].items[0].visibleBounds = [-0.5, 100.5, 200.5, -100.5]

    expect(parseResult(host.api.lfInspectDocument(0)).fields[3]).toBe('0')
  })
})

describe('planche de revue', () => {
  /** Enregistre un fichier de composant exploitable par `lfPlaceComponent`. */
  function registerComponent(path: string): void {
    host.filesystem.write(path, 4096)
  }

  it('ouvre une planche aux dimensions demandées', () => {
    const result = parseResult(host.api.lfCreatePackage(800, 600, 'cmyk'))

    expect(result.ok).toBe(true)
    const created = host.app.created[0]
    expect(created.documentColorSpace).toBe('CMYK')
    expect(created.artboards[0].artboardRect).toEqual([0, 0, 800, -600])
  })

  it('refuse des dimensions absurdes', () => {
    const result = parseResult(host.api.lfCreatePackage(0, 600, 'rgb'))

    expect(result.ok).toBe(false)
    expect(result.value).toContain('invalides')
  })

  it('refuse de placer un composant hors planche', () => {
    registerComponent('/tmp/Logo.ai')
    const result = parseResult(
      host.api.lfPlaceComponent('/tmp/Logo.ai', 'fullColor', '', 100, 0, 0, 200, 100),
    )

    expect(result.ok).toBe(false)
    expect(result.value).toContain('aucune planche')
  })

  it('place un composant, le met à l’échelle et le centre dans sa cellule', () => {
    host.api.lfCreatePackage(800, 600, 'rgb')
    registerComponent('/tmp/Logo.ai')
    // `app.open` construit un document ; on lui donne un contenu de 200 × 100.
    const opened = new FakeDocument('Logo.ai', 'RGB', 200, 100)
    opened.layers[0].items = [new FakeItem('PathItem', [0, 100, 200, 0], 'marque')]
    host.app.nextOpened = opened

    const result = parseResult(
      host.api.lfPlaceComponent(
        '/tmp/Logo.ai',
        'fullColor',
        '',
        100,
        100,
        -50,
        100,
        100,
      ),
    )

    expect(result.ok).toBe(true)
    expect(result.fields[0]).toBe('1')

    // 200 × 100 dans une cellule de 100 × 100 : facteur 0,5, donc 100 × 50,
    // centré verticalement dans la cellule.
    const group = host.app.created[0].layers[0].groups[0]
    expect(group.scale).toBe(50)
    expect(group.visibleBounds[0]).toBe(100)
    expect(group.visibleBounds[1]).toBe(-75)
  })

  it('écrit les libellés de la planche', () => {
    host.api.lfCreatePackage(800, 600, 'rgb')
    expect(parseResult(host.api.lfAddLabel('Logo', 120, -40, 12)).ok).toBe(true)

    const frames = host.app.created[0].textFrames
    expect(frames).toHaveLength(1)
    expect(frames[0].contents).toBe('Logo')
    expect(frames[0].position).toEqual([120, -40])
    expect(frames[0].textRange.characterAttributes.size).toBe(12)
  })

  it('refuse de terminer une planche vide', () => {
    host.api.lfCreatePackage(800, 600, 'rgb')
    const result = parseResult(host.api.lfFinishPackage())

    expect(result.ok).toBe(false)
    expect(result.value).toContain('vide')
  })

  it('termine la planche en rapportant son contenu', () => {
    host.api.lfCreatePackage(800, 600, 'rgb')
    registerComponent('/tmp/Logo.ai')
    const opened = new FakeDocument('Logo.ai', 'RGB', 200, 100)
    opened.layers[0].items = [new FakeItem('PathItem', [0, 100, 200, 0], 'marque')]
    host.app.nextOpened = opened
    host.api.lfPlaceComponent('/tmp/Logo.ai', 'fullColor', '', 100, 10, -10, 100, 100)

    const result = parseResult(host.api.lfFinishPackage())

    expect(result.ok).toBe(true)
    expect(Number(result.fields[0])).toBeGreaterThan(0)
    expect(result.fields[3]).toBe('0') // aucun débordement
  })

  it('referme la planche abandonnée', () => {
    host.api.lfCreatePackage(800, 600, 'rgb')
    expect(parseResult(host.api.lfAbortPackage()).ok).toBe(true)
    expect(host.app.created[0].closed).toBe(true)
    // Une seconde annulation ne doit pas lever.
    expect(parseResult(host.api.lfAbortPackage()).value).toBe('idle')
  })
})

/* ------------------------------------------------------------------ *
 * Orchestration de la construction
 * ------------------------------------------------------------------ */

/** Hôte CEP simulé, asynchrone comme `evalScript` l'est réellement. */
function installHost(options: { failOn?: RegExp } = {}): string[] {
  const calls: string[] = []
  ;(globalThis as Record<string, unknown>).__adobe_cep__ = {
    evalScript(expression: string, callback: (raw: string) => void) {
      calls.push(expression)
      let answer = 'OK|done'
      if (options.failOn && options.failOn.test(expression)) {
        answer = 'ERR|refus simule'
      } else if (expression.indexOf('lfFinishPackage') === 0) {
        // objets, largeur, hauteur, débordements, nom
        answer = 'OK|' + ['9', '800', '600', '0', 'planche.ai'].join(UNIT)
      }
      setTimeout(() => callback(answer), 0)
    },
  }
  return calls
}

const UNIT = String.fromCharCode(31)

interface BuildOutcome {
  ok: boolean
  message: string
  report: {
    expected: number
    placed: number
    empty: string[]
    failures: unknown[]
    outside: number
    name: string
  }
}

function buildPackage(
  config: Record<string, unknown> = {},
): Promise<{ outcome: BuildOutcome; progress: number[] }> {
  const progress: number[] = []
  return new Promise((resolve) => {
    ;(
      engine.runPackageBuild as unknown as (
        c: unknown,
        h: {
          onProgress: (done: number, total: number, label: string) => void
          onDone: (outcome: BuildOutcome) => void
        },
      ) => void
    )(
      { ...gridConfig(), ...config },
      {
        onProgress: (done) => progress.push(done),
        onDone: (outcome) => resolve({ outcome, progress }),
      },
    )
  })
}

describe('construction de la planche', () => {
  it('ouvre la planche avant de poser le moindre élément', async () => {
    const calls = installHost()
    await buildPackage()

    expect(calls[0]).toMatch(/^lfCreatePackage/)
    const firstLabel = calls.findIndex((c) => c.indexOf('lfAddLabel') === 0)
    const firstPlace = calls.findIndex((c) => c.indexOf('lfPlaceComponent') === 0)
    expect(firstLabel).toBeGreaterThan(0)
    expect(firstLabel).toBeLessThan(firstPlace)
  })

  it('place une cellule par croisement composant × déclinaison', async () => {
    const calls = installHost()
    const { outcome } = await buildPackage()

    const places = calls.filter((c) => c.indexOf('lfPlaceComponent') === 0)
    expect(places).toHaveLength(4)
    expect(outcome.report.placed).toBe(4)
    expect(outcome.ok).toBe(true)
  })

  it('rend compte de la progression cellule par cellule', async () => {
    installHost()
    const { progress } = await buildPackage()

    expect(progress).toEqual([1, 2, 3, 4])
  })

  it('transmet le seuil d’inversion à chaque placement', async () => {
    const calls = installHost()
    await buildPackage({ threshold: 40 })

    const place = calls.find((c) => c.indexOf('lfPlaceComponent') === 0)
    expect(place).toContain('40')
  })

  it('adopte le CMJN quand la passe impression est demandée', async () => {
    const calls = installHost()
    await buildPackage({ passes: { print: true, web: true } })

    expect(calls[0]).toContain('cmyk')
  })

  it('reste en RVB quand seule la passe web est demandée', async () => {
    const calls = installHost()
    await buildPackage({ passes: { print: false, web: true } })

    expect(calls[0]).toContain('rgb')
  })

  it('poursuit malgré une cellule refusée et la consigne', async () => {
    installHost({ failOn: /lfPlaceComponent/ })
    const { outcome } = await buildPackage()

    expect(outcome.ok).toBe(false)
    expect(outcome.report.placed).toBe(0)
    expect(outcome.report.empty).toHaveLength(4)
    expect(outcome.message).toContain('4 cellule(s) non remplie(s)')
  })

  it('refuse de construire sans composant défini', async () => {
    installHost()
    const { outcome } = await buildPackage({ components: [] })

    expect(outcome.ok).toBe(false)
    expect(outcome.message).toContain('aucun composant')
  })

  it('refuse de construire sans déclinaison cochée', async () => {
    installHost()
    const { outcome } = await buildPackage({ colorSchemes: [] })

    expect(outcome.ok).toBe(false)
    expect(outcome.message).toContain('déclinaison')
  })

  it('referme la planche quand sa finalisation échoue', async () => {
    const calls = installHost({ failOn: /lfFinishPackage/ })
    const { outcome } = await buildPackage()

    expect(outcome.ok).toBe(false)
    expect(calls.some((c) => c.indexOf('lfAbortPackage') === 0)).toBe(true)
  })

  it('rapporte les débordements signalés par la finalisation', async () => {
    installHost()
    const { outcome } = await buildPackage()

    expect(outcome.report.outside).toBe(0)
    expect(outcome.report.name).toBe('planche.ai')
  })

  it("n'appelle jamais d'export de fichier : la planche reste à l'écran", async () => {
    const calls = installHost()
    await buildPackage()

    expect(calls.some((c) => c.indexOf('lfExport') === 0)).toBe(false)
  })
})
