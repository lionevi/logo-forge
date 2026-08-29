/**
 * Assemblage du favicon.ico.
 *
 * Illustrator n'exporte pas d'ICO ; c'est pourtant le seul fichier qu'un
 * navigateur réclame de lui-même, à la racine du site. Il est assemblé à
 * partir des PNG du pack — ces cas vérifient l'octet près que le conteneur
 * produit est bien un ICO, et qu'il n'annonce jamais une image absente.
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

let host: Host

/** Lit un entier petit-boutiste dans le conteneur produit. */
function readUint(text: string, at: number, width: number): number {
  let value = 0
  for (let i = width - 1; i >= 0; i -= 1) value = value * 256 + text.charCodeAt(at + i)
  return value
}

/** Écrit un faux PNG de la taille demandée sur le disque simulé. */
function putPng(path: string, bytes: number) {
  host.filesystem.write(path, bytes, 'P'.repeat(bytes))
}

beforeEach(() => {
  host = loadExtendScript()
})

describe('conteneur ICO', () => {
  it('écrit un en-tête d’icône et une entrée par image', () => {
    putPng('/pack/favicon_16px.png', 40)
    putPng('/pack/favicon_32px.png', 90)

    const result = parseResult(
      host.api.lfWriteIco(
        '/pack/favicon.ico',
        ['/pack/favicon_16px.png', '/pack/favicon_32px.png'].join(UNIT),
        [16, 32].join(UNIT),
      ),
    )
    const ico = host.filesystem.files.get('/pack/favicon.ico')!.content!

    expect(result.ok).toBe(true)
    // Réservé, type 1 (icône), deux images.
    expect(readUint(ico, 0, 2)).toBe(0)
    expect(readUint(ico, 2, 2)).toBe(1)
    expect(readUint(ico, 4, 2)).toBe(2)
  })

  it('décrit chaque image par sa taille, son poids et sa position', () => {
    putPng('/pack/favicon_16px.png', 40)
    putPng('/pack/favicon_32px.png', 90)
    host.api.lfWriteIco(
      '/pack/favicon.ico',
      ['/pack/favicon_16px.png', '/pack/favicon_32px.png'].join(UNIT),
      [16, 32].join(UNIT),
    )
    const ico = host.filesystem.files.get('/pack/favicon.ico')!.content!

    // Catalogue : 6 octets d'en-tête, puis 16 octets par entrée.
    expect(ico.charCodeAt(6)).toBe(16)
    expect(ico.charCodeAt(7)).toBe(16)
    expect(readUint(ico, 14, 4)).toBe(40)
    expect(readUint(ico, 18, 4)).toBe(6 + 32)
    expect(ico.charCodeAt(22)).toBe(32)
    expect(readUint(ico, 30, 4)).toBe(90)
    // La seconde image commence après la première.
    expect(readUint(ico, 34, 4)).toBe(6 + 32 + 40)
  })

  it('recopie les PNG tels quels, à la suite du catalogue', () => {
    host.filesystem.write('/pack/a.png', 3, 'abc')
    host.filesystem.write('/pack/b.png', 2, 'de')
    host.api.lfWriteIco(
      '/pack/favicon.ico',
      ['/pack/a.png', '/pack/b.png'].join(UNIT),
      [16, 32].join(UNIT),
    )
    const ico = host.filesystem.files.get('/pack/favicon.ico')!.content!

    expect(ico.length).toBe(6 + 32 + 5)
    expect(ico.slice(6 + 32)).toBe('abcde')
  })

  it('écarte une image absente plutôt que de l’annoncer', () => {
    // Un ICO qui promet une image qu'il ne contient pas est illisible.
    putPng('/pack/favicon_16px.png', 40)

    const result = parseResult(
      host.api.lfWriteIco(
        '/pack/favicon.ico',
        ['/pack/favicon_16px.png', '/pack/disparu.png'].join(UNIT),
        [16, 32].join(UNIT),
      ),
    )
    const ico = host.filesystem.files.get('/pack/favicon.ico')!.content!

    expect(result.ok).toBe(true)
    expect(readUint(ico, 4, 2)).toBe(1)
  })

  it('écarte un PNG vide', () => {
    host.filesystem.write('/pack/vide.png', 0, '')
    putPng('/pack/favicon_16px.png', 40)
    host.api.lfWriteIco(
      '/pack/favicon.ico',
      ['/pack/vide.png', '/pack/favicon_16px.png'].join(UNIT),
      [16, 32].join(UNIT),
    )
    const ico = host.filesystem.files.get('/pack/favicon.ico')!.content!

    expect(readUint(ico, 4, 2)).toBe(1)
  })

  it('refuse d’écrire un ICO sans aucune image', () => {
    const result = parseResult(
      host.api.lfWriteIco('/pack/favicon.ico', '/pack/absent.png', '16'),
    )

    expect(result.ok).toBe(false)
    expect(result.value).toContain('aucun PNG lisible')
    expect(host.filesystem.files.has('/pack/favicon.ico')).toBe(false)
  })

  it('note 256 pixels par un zéro, comme le veut le format', () => {
    putPng('/pack/grand.png', 50)
    host.api.lfWriteIco('/pack/favicon.ico', '/pack/grand.png', '256')
    const ico = host.filesystem.files.get('/pack/favicon.ico')!.content!

    expect(ico.charCodeAt(6)).toBe(0)
  })

  it('écarte une taille que le format ne peut pas décrire', () => {
    putPng('/pack/trop.png', 50)

    const result = parseResult(
      host.api.lfWriteIco('/pack/favicon.ico', '/pack/trop.png', '512'),
    )

    expect(result.ok).toBe(false)
  })

  it('rend le chemin et le poids écrits', () => {
    putPng('/pack/favicon_16px.png', 40)
    const result = parseResult(
      host.api.lfWriteIco('/pack/favicon.ico', '/pack/favicon_16px.png', '16'),
    )
    const [path, bytes] = result.value.split(UNIT)

    expect(path).toBe('/pack/favicon.ico')
    expect(Number(bytes)).toBe(6 + 16 + 40)
  })
})

describe('place dans le pack', () => {
  const engine = loadEngine()

  it('ne retient que les petites tailles', () => {
    // Un ICO est demandé à chaque visite : il n'a pas à porter le 192 px.
    expect(engine.ICO_SIZES).toEqual([16, 32, 48])
  })

  it('marque les favicons du plan pour l’assemblage', () => {
    const tasks = (
      engine.planExport as unknown as (c: unknown) => Array<Record<string, unknown>>
    )({
      clientName: 'Acme',
      outputFolder: '/out',
      components: [{ name: 'Logo', path: '/tmp/logo.ai' }],
      colorSchemes: [{ id: 'fullColor' }],
      formats: { print: {}, web: { png: false } },
      scales: [{ type: 'web', width: 900, resolution: 72 }],
      passes: { print: false, web: true },
      favicon: true,
      separator: '_',
    })
    const favicons = tasks.filter((task) => task.favicon)

    expect(favicons).toHaveLength(5)
    expect(favicons.every((task) => task.format === 'png')).toBe(true)
  })

  it('explique l’usage du fichier au client', () => {
    const use = engine.FORMAT_USE as unknown as Record<string, Record<string, string>>

    expect(use.fr.ico).toContain('onglet du navigateur')
    expect(use.en.ico).toContain('browser tab')
  })
})

describe('assemblage pendant l’export', () => {
  const UNIT_ = String.fromCharCode(31)

  function config(overrides: Record<string, unknown> = {}) {
    return {
      clientName: 'Acme',
      outputFolder: '/out',
      components: [{ name: 'Logo', path: '/tmp/logo.ai' }],
      colorSchemes: [{ id: 'fullColor' }],
      formats: { print: {}, web: { svg: true } },
      scales: [{ type: 'web', width: 900, resolution: 72 }],
      passes: { print: false, web: true },
      favicon: true,
      separator: '_',
      documentation: false,
      padding: { top: 0, right: 0, bottom: 0, left: 0 },
      ...overrides,
    }
  }

  /** Doublure d'ExtendScript, qui note les ICO demandés. */
  function installHost(options: { icoFails?: boolean } = {}) {
    const calls: string[] = []
    ;(globalThis as Record<string, unknown>).__adobe_cep__ = {
      evalScript(expression: string, callback: (raw: string) => void) {
        calls.push(expression)
        let answer = 'OK|done'
        if (expression.indexOf('lfWriteIco') === 0) {
          answer = options.icoFails
            ? 'ERR|ouverture en ecriture refusee'
            : 'OK|' + ['/out/Acme/Pour_Web/Favicon/favicon.ico', 1200].join(UNIT_)
        } else if (expression.indexOf('lfExport') === 0) {
          answer = 'OK|' + ['/tmp/sortie', 4096].join(UNIT_)
        }
        setTimeout(() => callback(answer), 0)
      },
    }
    return calls
  }

  function run(
    engineRef: Record<string, EngineFn>,
    overrides: Record<string, unknown> = {},
  ): Promise<Record<string, unknown>> {
    return new Promise((done) => {
      ;(engineRef.runFullExport as unknown as (c: unknown, h: unknown) => unknown)(
        config(overrides),
        {
          onProgress: () => {},
          onDone: done,
          onError: () => done({}),
        },
      )
    })
  }

  afterEach(() => {
    delete (globalThis as Record<string, unknown>).__adobe_cep__
  })

  it('assemble l’ICO à partir des favicons du pack', async () => {
    const calls = installHost()
    const result = await run(loadEngine())
    const ico = calls.filter((call) => call.indexOf('lfWriteIco') === 0)

    expect(ico).toHaveLength(1)
    // Seules les petites tailles entrent dans le conteneur.
    expect(ico[0]).toContain('favicon_16px.png')
    expect(ico[0]).toContain('favicon_32px.png')
    expect(ico[0]).not.toContain('favicon_192px.png')
    expect(result.failures).toEqual([])
  })

  it('compte le fichier dans le pack livré', async () => {
    installHost()
    const result = await run(loadEngine())
    const written = result.written as Array<{ fileName: string; bytes: number }>
    const ico = written.filter((file) => file.fileName === 'favicon.ico')

    expect(ico).toHaveLength(1)
    expect(ico[0].bytes).toBe(1200)
  })

  it('ne demande rien quand les favicons ne sont pas au programme', async () => {
    const calls = installHost()
    await run(loadEngine(), { favicon: false })

    expect(calls.filter((call) => call.indexOf('lfWriteIco') === 0)).toHaveLength(0)
  })

  it('signale un échec au lieu de le taire', async () => {
    installHost({ icoFails: true })
    const result = await run(loadEngine())
    const failures = result.failures as Array<{ message: string }>

    expect(failures).toHaveLength(1)
    expect(failures[0].message).toContain('ouverture en ecriture refusee')
    expect(
      (result.written as Array<{ fileName: string }>).some(
        (file) => file.fileName === 'favicon.ico',
      ),
    ).toBe(false)
  })
})
