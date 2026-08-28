/**
 * Manifeste et contrôle du pack livré.
 *
 * L'export sait ce qu'il a cru écrire ; le disque sait ce qu'il contient. Le
 * contrôle confronte les deux — sans lui, « export réussi » resterait une
 * affirmation invérifiable.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

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

const engine = loadEngine()

interface Audit {
  checks: Array<{ id: string; label: string; ok: boolean; detail: string }>
  missing: string[]
  empty: string[]
  duplicates: string[]
  extra: string[]
  expected: number
  actual: number
  ready: boolean
}

const audit = (
  expected: string[],
  actual: Array<{ path: string; bytes: number }>,
  options: Record<string, unknown> = {},
): Audit =>
  (engine.auditPackage as unknown as (e: unknown, a: unknown, o: unknown) => Audit)(
    expected,
    actual,
    {
      manifestPresent: true,
      expectDocumentation: false,
      ...options,
    },
  )

const check = (report: Audit, id: string) =>
  report.checks.find((entry) => entry.id === id)!

function file(path: string, bytes = 2048) {
  return { path, bytes }
}

describe('lecture du dossier livré', () => {
  it('relit chemins et tailles', () => {
    const files = (
      engine.parseFileListing as unknown as (
        p: string,
      ) => Array<{ path: string; bytes: number }>
    )(['Print/logo.pdf:4096', 'Web/logo.svg:512'].join(UNIT))

    expect(files).toEqual([
      { path: 'Print/logo.pdf', bytes: 4096 },
      { path: 'Web/logo.svg', bytes: 512 },
    ])
  })

  it('accepte un chemin contenant des deux-points', () => {
    const files = (
      engine.parseFileListing as unknown as (
        p: string,
      ) => Array<{ path: string; bytes: number }>
    )('Web/logo:final.svg:512')

    expect(files[0].path).toBe('Web/logo:final.svg')
    expect(files[0].bytes).toBe(512)
  })

  it('ignore une ligne illisible', () => {
    const files = (engine.parseFileListing as unknown as (p: string) => unknown[])(
      ['bruit', 'Web/logo.svg:512'].join(UNIT),
    )

    expect(files).toHaveLength(1)
  })
})

describe('contrôle du pack', () => {
  const expected = ['Print/logo.pdf', 'Web/logo.svg']

  it('valide un pack complet', () => {
    const report = audit(expected, [file('Print/logo.pdf'), file('Web/logo.svg')])

    expect(report.ready).toBe(true)
    expect(report.missing).toEqual([])
  })

  it('signale un fichier annoncé mais absent du disque', () => {
    const report = audit(expected, [file('Print/logo.pdf')])

    expect(report.ready).toBe(false)
    expect(report.missing).toEqual(['Web/logo.svg'])
    expect(check(report, 'missing').ok).toBe(false)
  })

  it('signale un fichier présent mais vide', () => {
    const report = audit(expected, [file('Print/logo.pdf'), file('Web/logo.svg', 0)])

    expect(report.empty).toEqual(['Web/logo.svg'])
    expect(report.ready).toBe(false)
  })

  it('signale deux fichiers de même nom dans des dossiers différents', () => {
    const report = audit(
      ['a/logo.svg', 'b/logo.svg'],
      [file('a/logo.svg'), file('b/logo.svg')],
    )

    expect(report.duplicates).toEqual(['logo.svg'])
    expect(check(report, 'duplicates').ok).toBe(false)
  })

  it('liste les fichiers en trop sans les tenir pour des défauts', () => {
    const report = audit(expected, [
      file('Print/logo.pdf'),
      file('Web/logo.svg'),
      file('Web/ancien.png'),
    ])

    expect(report.extra).toEqual(['Web/ancien.png'])
    expect(report.ready).toBe(true)
  })

  it('ne compte pas rapport, documentation et manifeste parmi les intrus', () => {
    const report = audit(
      expected,
      [
        file('Print/logo.pdf'),
        file('Web/logo.svg'),
        file('Rapport/export-rapport.html'),
        file('Documentation/LISEZ-MOI.md'),
      ],
      {
        service: {
          'Rapport/export-rapport.html': true,
          'Documentation/LISEZ-MOI.md': true,
        },
      },
    )

    expect(report.extra).toEqual([])
  })

  it('exige la documentation quand elle a été demandée', () => {
    const absent = audit(expected, [file('Print/logo.pdf'), file('Web/logo.svg')], {
      expectDocumentation: true,
      documentationPresent: false,
    })
    const present = audit(expected, [file('Print/logo.pdf'), file('Web/logo.svg')], {
      expectDocumentation: true,
      documentationPresent: true,
    })

    expect(check(absent, 'documentation').ok).toBe(false)
    expect(absent.ready).toBe(false)
    expect(check(present, 'documentation').ok).toBe(true)
  })

  it('exige le manifeste dans tous les cas', () => {
    const report = audit(expected, [file('Print/logo.pdf'), file('Web/logo.svg')], {
      manifestPresent: false,
    })

    expect(check(report, 'manifest').ok).toBe(false)
    expect(report.ready).toBe(false)
  })

  it('compare les décomptes attendus et réels', () => {
    const report = audit(expected, [file('Print/logo.pdf')])

    expect(report.expected).toBe(2)
    expect(report.actual).toBe(1)
    expect(check(report, 'count').detail).toContain('1 présents pour 2 attendus')
  })
})

describe('manifeste', () => {
  const config = {
    clientName: 'Acme',
    brandName: 'Nova',
    projectName: 'Refonte',
    version: '2',
    components: [{ name: 'Logo', type: 'logo' }],
    colorSchemes: [{ id: 'fullColor' }, { id: 'black' }],
    folderTemplate: 'agency',
  }

  const result = {
    documentName: 'brand.ai',
    written: [
      {
        folder: '02_Impression/Logo/FullColor',
        fileName: 'Acme_Logo.pdf',
        format: 'pdf',
        component: { name: 'Logo' },
        scheme: { id: 'fullColor' },
        pass: 'print',
        bytes: 4096,
        status: 'success',
      },
    ],
    failures: [
      {
        task: {
          folder: '02_Impression/Logo/Black',
          fileName: 'Acme_Logo_Black.pdf',
          component: { name: 'Logo' },
          scheme: { id: 'black' },
        },
        message: 'disque plein',
      },
      {
        task: {
          folder: '02_Impression/Logo/Black',
          fileName: 'Acme_Logo_Black.eps',
          component: { name: 'Logo' },
          scheme: { id: 'black' },
        },
        message: 'mode colorimétrique',
        warning: true,
      },
    ],
    skipped: [
      {
        folder: '03_Web/Logo',
        fileName: 'Acme_Logo.svg',
        component: { name: 'Logo' },
        scheme: { id: 'fullColor' },
      },
    ],
  }

  const manifest = (
    engine.buildManifest as unknown as (
      c: unknown,
      r: unknown,
    ) => Record<string, unknown>
  )(config, result)

  it('identifie le projet et sa source', () => {
    expect(manifest.client).toBe('Acme')
    expect(manifest.brand).toBe('Nova')
    expect(manifest.project).toBe('Refonte')
    expect(manifest.version).toBe('2')
    expect(manifest.sourceDocument).toBe('brand.ai')
    expect(manifest.folderTemplate).toBe('agency')
  })

  it('décrit chaque fichier écrit', () => {
    const files = manifest.files as Array<Record<string, unknown>>

    expect(files).toHaveLength(1)
    expect(files[0].path).toBe('02_Impression/Logo/FullColor/Acme_Logo.pdf')
    expect(files[0].bytes).toBe(4096)
    expect(files[0].scheme).toBe('Full Color')
  })

  it('sépare les réserves des erreurs', () => {
    expect(manifest.warnings).toHaveLength(1)
    expect(manifest.errors).toHaveLength(1)
    expect((manifest.errors as Array<{ message: string }>)[0].message).toBe(
      'disque plein',
    )
  })

  it('consigne les fichiers laissés en place', () => {
    expect(manifest.skipped).toEqual(['03_Web/Logo/Acme_Logo.svg'])
  })

  it('reste un JSON valide', () => {
    const text = JSON.stringify(manifest, null, 2)

    expect(() => JSON.parse(text)).not.toThrow()
    expect(JSON.parse(text).generator).toBe('Logo Forge')
  })
})
