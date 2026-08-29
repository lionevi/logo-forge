/**
 * Kit réseaux sociaux.
 *
 * Un logo carré posé sur une bannière de 1500 × 500 n'est pas un logo livré.
 * Chaque plateforme impose ses dimensions, et le designer les refait à la
 * main à chaque projet. Ces cas vérifient que le canevas produit a la taille
 * annoncée, que le logo y respire, et qu'aucun fichier n'est déclaré produit
 * sans octets sur le disque.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { loadExtendScript, parseResult, type Host } from './extendscriptHost'

const UNIT = String.fromCharCode(31)

const ENGINE_SOURCE = readFileSync(
  resolve(import.meta.dirname, '../src/js/export-engine.js'),
  'utf8',
)

type EngineFn = (...args: never[]) => never

function loadEngine(): Record<string, EngineFn> {
  const holder = { exports: {} as Record<string, EngineFn> }
  const factory = new Function('module', 'window', 'setTimeout', ENGINE_SOURCE)
  factory(holder, globalThis, setTimeout)
  return holder.exports
}

let engine = loadEngine()

interface Canvas {
  preset: { id: string; width: number; height: number }
  component: { name: string; path: string }
  folder: string
  fileName: string
  width: number
  height: number
  left: number
  top: number
  cellWidth: number
  cellHeight: number
  bytes?: number
}

function config(overrides: Record<string, unknown> = {}) {
  return {
    clientName: 'Acme',
    outputFolder: '/out',
    components: [{ name: 'Logo', path: '/tmp/logo.ai' }],
    colorSchemes: [{ id: 'fullColor' }],
    separator: '_',
    folderTemplate: 'client',
    social: { presets: ['avatar', 'xHeader'] },
    ...overrides,
  }
}

const plan = (overrides: Record<string, unknown> = {}) =>
  (
    engine.planSocialKit as unknown as (c: unknown) => {
      canvases: Canvas[]
      settings: Record<string, unknown>
    }
  )(config(overrides))

beforeEach(() => {
  engine = loadEngine()
})

describe('formats des plateformes', () => {
  it('énumère les dimensions plutôt que de les calculer', () => {
    // Les plateformes changent leurs tailles : elles doivent se relire.
    const presets = engine.SOCIAL_PRESETS as unknown as Array<{
      id: string
      width: number
      height: number
      label: string
      use: string
    }>

    expect(presets.length).toBeGreaterThan(5)
    for (const preset of presets) {
      expect(preset.width, preset.id).toBeGreaterThan(0)
      expect(preset.height, preset.id).toBeGreaterThan(0)
      expect(preset.label, preset.id).toBeTruthy()
      expect(preset.use, preset.id).toBeTruthy()
    }
  })

  it('retrouve un format par son identifiant', () => {
    const find = engine.socialPreset as unknown as (
      id: string,
    ) => { width: number; height: number } | null

    expect(find('xHeader')).toEqual(
      expect.objectContaining({ width: 1500, height: 500 }),
    )
    expect(find('inexistant')).toBeNull()
  })
})

describe('plan du kit', () => {
  it('produit un canevas par format retenu et par composant capturé', () => {
    const { canvases } = plan({
      components: [
        { name: 'Logo', path: '/tmp/logo.ai' },
        { name: 'Logo Mark', path: '/tmp/mark.ai' },
      ],
    })

    expect(canvases).toHaveLength(4)
  })

  it('ignore un composant jamais capturé', () => {
    const { canvases } = plan({
      components: [{ name: 'Logo', path: '/tmp/logo.ai' }, { name: 'Logotype' }],
    })

    expect(canvases).toHaveLength(2)
  })

  it('donne au canevas la taille exacte de la plateforme', () => {
    const { canvases } = plan()
    const banner = canvases.find((canvas) => canvas.preset.id === 'xHeader')!

    expect(banner.width).toBe(1500)
    expect(banner.height).toBe(500)
  })

  it('laisse respirer le logo, de chaque côté', () => {
    const { canvases } = plan({ social: { presets: ['avatar'], margin: 10 } })
    const [avatar] = canvases

    expect(avatar.left).toBe(40)
    expect(avatar.top).toBe(-40)
    expect(avatar.cellWidth).toBe(320)
    expect(avatar.cellHeight).toBe(320)
  })

  it('refuse une marge qui ne laisserait rien à voir', () => {
    const settings = engine.socialSettings as unknown as (c: unknown) => {
      margin: number
    }

    expect(settings(config({ social: { margin: 90 } })).margin).toBe(12)
    expect(settings(config({ social: { margin: -5 } })).margin).toBe(12)
    expect(settings(config({ social: { margin: 0 } })).margin).toBe(0)
  })

  it('nomme le fichier par sa plateforme et ses dimensions', () => {
    const { canvases } = plan()
    const banner = canvases.find((canvas) => canvas.preset.id === 'xHeader')!

    expect(banner.fileName).toBe('Acme_Logo_xHeader_1500x500.png')
  })

  it('suit l’arborescence retenue pour la livraison', () => {
    expect(plan().canvases[0].folder).toBe('Reseaux_Sociaux')
    expect(plan({ folderTemplate: 'agency' }).canvases[0].folder).toBe(
      '06_Reseaux_Sociaux',
    )
  })

  it('ne décline pas le kit par couleur', () => {
    // Huit formats fois quatre déclinaisons noieraient le client.
    const { canvases } = plan({
      colorSchemes: [{ id: 'fullColor' }, { id: 'black' }, { id: 'white' }],
    })

    expect(canvases).toHaveLength(2)
    expect(canvases.every((canvas) => canvas.preset)).toBe(true)
  })
})

describe('production du kit', () => {
  function installHost(options: { failOn?: RegExp; emptyOn?: RegExp } = {}) {
    const calls: string[] = []
    ;(globalThis as Record<string, unknown>).__adobe_cep__ = {
      evalScript(expression: string, callback: (raw: string) => void) {
        calls.push(expression)
        let answer = 'OK|done'
        if (options.failOn && options.failOn.test(expression)) {
          answer = 'ERR|refus de l hote'
        } else if (expression.indexOf('lfExportPNG') === 0) {
          const bytes = options.emptyOn && options.emptyOn.test(expression) ? 0 : 8192
          answer = 'OK|' + ['/out/Acme/Reseaux_Sociaux/canevas.png', bytes].join(UNIT)
        }
        setTimeout(() => callback(answer), 0)
      },
    }
    return calls
  }

  function run(
    overrides: Record<string, unknown> = {},
  ): Promise<Record<string, unknown>> {
    return new Promise((done) => {
      ;(engine.runSocialKit as unknown as (c: unknown, h: unknown) => unknown)(
        config(overrides),
        { onProgress: () => {}, onDone: done },
      )
    })
  }

  afterEach(() => {
    delete (globalThis as Record<string, unknown>).__adobe_cep__
  })

  it('crée, peint, remplit puis referme chaque canevas', async () => {
    const calls = installHost()
    await run({ social: { presets: ['avatar'] } })
    const order = calls.map((call) => call.split('(')[0])

    expect(order).toEqual([
      'lfCreateFolder',
      'lfCreateFolder',
      'lfCreatePackage',
      'lfPackageBackground',
      'lfPlaceComponent',
      'lfExportPNG',
      'lfAbortPackage',
    ])
  })

  it('exporte à la largeur exacte du canevas', async () => {
    const calls = installHost()
    await run({ social: { presets: ['xHeader'] } })
    const png = calls.find((call) => call.indexOf('lfExportPNG') === 0)!

    expect(png).toContain('1500')
    expect(png).toContain('Acme_Logo_xHeader_1500x500.png')
  })

  it('peint le fond demandé', async () => {
    const calls = installHost()
    await run({ social: { presets: ['avatar'], background: '#101010' } })

    expect(
      calls.some((call) => call.indexOf('lfPackageBackground("#101010"') === 0),
    ).toBe(true)
  })

  it('laisse le fond transparent sur demande', async () => {
    const calls = installHost()
    await run({ social: { presets: ['avatar'], transparent: true } })

    expect(calls.some((call) => call.indexOf('lfPackageBackground') === 0)).toBe(false)
  })

  it('compte les fichiers écrits, avec leur poids', async () => {
    installHost()
    const result = await run()
    const written = result.written as Canvas[]

    expect(written).toHaveLength(2)
    expect(written[0].bytes).toBe(8192)
  })

  it('poursuit après un canevas raté, et le referme', async () => {
    const calls = installHost({ failOn: /lfPlaceComponent/ })
    const result = await run()

    expect(result.written).toHaveLength(0)
    expect(result.failures).toHaveLength(2)
    // Un canevas raté est refermé : sinon Illustrator garderait un document
    // ouvert par échec.
    expect(calls.filter((call) => call.indexOf('lfAbortPackage') === 0)).toHaveLength(2)
  })

  it('ne compte pas un fichier vide parmi les produits', async () => {
    installHost({ emptyOn: /lfExportPNG/ })
    const result = await run({ social: { presets: ['avatar'] } })

    expect(result.written).toHaveLength(0)
    expect((result.failures as Array<{ message: string }>)[0].message).toContain(
      'vide ou absent',
    )
  })

  it('le dit plutôt que de produire un kit vide', async () => {
    installHost()
    const result = await run({ social: { presets: [] } })

    expect(result.written).toHaveLength(0)
    expect(result.message).toContain('Aucun canevas')
  })
})

describe('fond de canevas', () => {
  let host: Host

  beforeEach(() => {
    host = loadExtendScript()
  })

  it('peint un rectangle aux dimensions du plan de travail', () => {
    host.api.lfCreatePackage(1500, 500, 'rgb')
    const result = parseResult(host.api.lfPackageBackground('#2680EB'))

    expect(result.ok).toBe(true)
    expect(result.fields).toEqual(['1500', '500'])
  })

  it('reprend exactement la couleur demandée', () => {
    host.api.lfCreatePackage(400, 400, 'rgb')
    host.api.lfPackageBackground('#2680EB')
    const rectangle = host.app.activeDocument!.pathItems[0]
    const color = rectangle.fillColor as { red: number; green: number; blue: number }

    expect(color.red).toBe(0x26)
    expect(color.green).toBe(0x80)
    expect(color.blue).toBe(0xeb)
    expect(rectangle.filled).toBe(true)
    expect(rectangle.stroked).toBe(false)
  })

  it('refuse une couleur illisible plutôt que d’en inventer une', () => {
    host.api.lfCreatePackage(400, 400, 'rgb')

    expect(parseResult(host.api.lfPackageBackground('bleu')).ok).toBe(false)
    expect(parseResult(host.api.lfPackageBackground('#12345')).ok).toBe(false)
  })

  it('refuse de peindre sans planche ouverte', () => {
    const result = parseResult(host.api.lfPackageBackground('#FFFFFF'))

    expect(result.ok).toBe(false)
    expect(result.value).toContain('aucune planche')
  })
})
