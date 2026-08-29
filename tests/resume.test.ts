/**
 * Reprise d'un lot interrompu.
 *
 * Deux cents fichiers, une panne au cent-quarantième : tout refaire coûte une
 * demi-heure et repasse sur des fichiers déjà bons. Ces cas vérifient que la
 * trace laissée par le lot est exploitable — et qu'elle n'est jamais crue sur
 * parole, le disque restant l'autorité.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

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

interface Task {
  folder: string
  fileName: string
  bytes: number
  status: string
  resumed?: boolean
}

interface Snapshot {
  version: number
  fingerprint: string
  root: string
  total: number
  done: Array<{ key: string; bytes: number }>
}

function config(overrides: Record<string, unknown> = {}) {
  return {
    clientName: 'Ma Marque',
    outputFolder: '/Users/lea/Livraisons',
    components: [{ name: 'Logo', path: '/tmp/logo.ai' }],
    colorSchemes: [{ id: 'fullColor' }],
    formats: {
      print: { ai: false, pdf: true, eps: false, jpeg: false },
      web: { svg: true, png: false, jpeg: false, ai: false },
    },
    scales: [{ type: 'web', width: 900, resolution: 72 }],
    passes: { print: true, web: true },
    favicon: false,
    separator: '_',
    padding: { top: 0, right: 0, bottom: 0, left: 0 },
    ...overrides,
  }
}

const fingerprint = (overrides: Record<string, unknown> = {}) =>
  (engine.runFingerprint as unknown as (c: unknown) => string)(config(overrides))

const plan = (overrides: Record<string, unknown> = {}) =>
  (engine.planExport as unknown as (c: unknown) => Task[])(config(overrides))

/** Doublure d'ExtendScript : chaque export répond « chemin | octets ». */
function installHost(options: { failOn?: RegExp } = {}) {
  const calls: string[] = []
  ;(globalThis as Record<string, unknown>).__adobe_cep__ = {
    evalScript(expression: string, callback: (raw: string) => void) {
      calls.push(expression)
      let answer = 'OK|done'
      if (options.failOn && options.failOn.test(expression)) {
        answer = 'ERR|disque plein'
      } else if (expression.indexOf('lfExport') === 0) {
        answer = 'OK|' + ['/tmp/sortie', 4096].join(UNIT)
      }
      setTimeout(() => callback(answer), 0)
    },
  }
  return calls
}

function runExport(
  overrides: Record<string, unknown> = {},
): Promise<{ result: Record<string, unknown>; snapshots: Snapshot[] }> {
  const snapshots: Snapshot[] = []
  return new Promise((done) => {
    ;(engine.runFullExport as unknown as (c: unknown, h: unknown) => unknown)(
      config(overrides),
      {
        onProgress: () => {},
        onSnapshot: (snapshot: Snapshot) => snapshots.push(snapshot),
        onDone: (result: Record<string, unknown>) => done({ result, snapshots }),
        onError: () => done({ result: {}, snapshots }),
      },
    )
  })
}

beforeEach(() => {
  engine = loadEngine()
})

afterEach(() => {
  delete (globalThis as Record<string, unknown>).__adobe_cep__
})

describe('identité d’un lot', () => {
  it('désigne une tâche par le fichier qu’elle écrit', () => {
    const key = (engine.taskKey as unknown as (t: unknown) => string)({
      folder: 'Pour_Web/Logo',
      fileName: 'logo.svg',
    })

    expect(key).toBe('Pour_Web/Logo/logo.svg')
  })

  it('donne la même empreinte à deux plans identiques', () => {
    expect(fingerprint()).toBe(fingerprint())
  })

  it('change d’empreinte dès qu’un fichier de plus est attendu', () => {
    // Reprendre un lot dont le plan a changé livrerait un pack incomplet.
    expect(
      fingerprint({ colorSchemes: [{ id: 'fullColor' }, { id: 'black' }] }),
    ).not.toBe(fingerprint())
    expect(fingerprint({ favicon: true })).not.toBe(fingerprint())
    expect(fingerprint({ folderTemplate: 'agency' })).not.toBe(fingerprint())
    expect(fingerprint({ separator: '-' })).not.toBe(fingerprint())
    expect(fingerprint({ outputFolder: '/ailleurs' })).not.toBe(fingerprint())
  })

  it('distingue une déclinaison personnalisée par sa couleur', () => {
    const bleu = fingerprint({ colorSchemes: [{ id: 'custom', hex: '#0033AA' }] })
    const rouge = fingerprint({ colorSchemes: [{ id: 'custom', hex: '#AA0033' }] })

    expect(bleu).not.toBe(rouge)
  })

  it('refuse une trace qui ne correspond pas au plan courant', () => {
    const matches = engine.snapshotMatches as unknown as (
      s: unknown,
      c: unknown,
    ) => boolean
    const snapshot = { version: 1, fingerprint: fingerprint() }

    expect(matches(snapshot, config())).toBe(true)
    expect(matches(snapshot, config({ favicon: true }))).toBe(false)
    expect(matches({ version: 0, fingerprint: fingerprint() }, config())).toBe(false)
    expect(matches(null, config())).toBe(false)
  })
})

describe('confrontation au disque', () => {
  const snapshot = {
    version: 1,
    fingerprint: 'x',
    root: '/Users/lea/Livraisons/MaMarque',
    total: 3,
    done: [
      { key: 'Pour_Web/Logo/a.svg', bytes: 512 },
      { key: 'Pour_Impression/Logo/b.pdf', bytes: 4096 },
    ],
  }

  function verify(present: string[]) {
    return new Promise<{ completed: Record<string, number>; missing: string[] }>(
      (done) => {
        ;(
          engine.verifySnapshot as unknown as (
            s: unknown,
            e: unknown,
            d: unknown,
          ) => void
        )(
          snapshot,
          (path: string, answer: (ok: boolean) => void) => {
            setTimeout(() => answer(present.some((end) => path.indexOf(end) >= 0)), 0)
          },
          done,
        )
      },
    )
  }

  it('retient ce que le disque confirme', async () => {
    const report = await verify(['a.svg', 'b.pdf'])

    expect(report.completed).toEqual({
      'Pour_Web/Logo/a.svg': 512,
      'Pour_Impression/Logo/b.pdf': 4096,
    })
    expect(report.missing).toEqual([])
  })

  it('réclame ce que le disque a perdu', async () => {
    // Dossier déplacé, nettoyage manuel : la trace ment, le disque non.
    const report = await verify(['a.svg'])

    expect(report.completed).toEqual({ 'Pour_Web/Logo/a.svg': 512 })
    expect(report.missing).toEqual(['Pour_Impression/Logo/b.pdf'])
  })

  it('cherche les fichiers sous la racine du lot', async () => {
    const seen: string[] = []
    await new Promise<void>((done) => {
      ;(
        engine.verifySnapshot as unknown as (s: unknown, e: unknown, d: unknown) => void
      )(
        snapshot,
        (path: string, answer: (ok: boolean) => void) => {
          seen.push(path)
          answer(false)
        },
        () => done(),
      )
    })

    expect(seen[0]).toBe('/Users/lea/Livraisons/MaMarque/Pour_Web/Logo/a.svg')
  })

  it('ne garde que les tâches encore à écrire', () => {
    const tasks = plan()
    const rest = (
      engine.remainingTasks as unknown as (t: unknown, c: unknown) => Task[]
    )(tasks, { [tasks[0].folder + '/' + tasks[0].fileName]: 4096 })

    expect(rest).toHaveLength(tasks.length - 1)
    expect(rest[0].fileName).toBe(tasks[1].fileName)
  })
})

describe('trace laissée par un lot', () => {
  it('publie une trace après chaque fichier écrit', async () => {
    installHost()
    const { result, snapshots } = await runExport()

    expect((result.written as unknown[]).length).toBe(2)
    expect(snapshots).toHaveLength(2)
    expect(snapshots[1].done).toHaveLength(2)
  })

  it('décrit le lot entier, pas seulement ce qui est fait', async () => {
    installHost()
    const { snapshots } = await runExport()

    expect(snapshots[0].total).toBe(2)
    expect(snapshots[0].fingerprint).toBe(fingerprint())
    expect(snapshots[0].root).toBe('/Users/lea/Livraisons/Ma Marque')
  })

  it('retient la taille de chaque fichier écrit', async () => {
    installHost()
    const { snapshots } = await runExport()

    expect(snapshots[0].done[0].bytes).toBe(4096)
  })

  it('garde ce qui a été écrit avant l’échec', async () => {
    installHost({ failOn: /lfExportSVG/ })
    const { snapshots } = await runExport()

    // Le PDF est passé, le SVG a échoué : la trace porte le premier seul.
    expect(snapshots).toHaveLength(1)
    expect(snapshots[0].done[0].key).toContain('.pdf')
  })
})

describe('reprise', () => {
  it('n’exporte pas ce que la trace et le disque confirment', async () => {
    installHost()
    const tasks = plan()
    const key = tasks[0].folder + '/' + tasks[0].fileName
    const calls = installHost()
    const { result } = await runExport({ completed: { [key]: 4096 } })

    expect(result.resumed).toBe(1)
    expect((result.written as unknown[]).length).toBe(2)
    // Un seul export réellement lancé : l'autre fichier est déjà là.
    expect(calls.filter((c) => c.indexOf('lfExport') === 0)).toHaveLength(1)
  })

  it('porte les fichiers repris au crédit du lot, avec leur taille', async () => {
    installHost()
    const tasks = plan()
    const key = tasks[0].folder + '/' + tasks[0].fileName
    const { result } = await runExport({ completed: { [key]: 777 } })
    const written = result.written as Task[]
    const resumed = written.filter((task) => task.resumed)

    expect(resumed).toHaveLength(1)
    expect(resumed[0].bytes).toBe(777)
    expect(resumed[0].status).toBe('success')
  })

  it('soumet les fichiers repris au contrôle final comme les autres', async () => {
    // Reprendre ne dispense pas de vérifier : le pack est relu sur le disque.
    installHost()
    const tasks = plan()
    const key = tasks[0].folder + '/' + tasks[0].fileName
    const { result } = await runExport({ completed: { [key]: 4096 } })
    const audit = result.audit as { expected: number; missing: string[] }

    expect(audit.expected).toBe(2)
    expect(audit.missing).toContain(key)
  })

  it('annonce le total du lot, pas celui du reste', async () => {
    installHost()
    const tasks = plan()
    const key = tasks[0].folder + '/' + tasks[0].fileName
    const { result } = await runExport({ completed: { [key]: 4096 } })

    expect(result.total).toBe(2)
  })

  it('continue de publier la trace pendant la reprise', async () => {
    installHost()
    const tasks = plan()
    const key = tasks[0].folder + '/' + tasks[0].fileName
    const { snapshots } = await runExport({ completed: { [key]: 4096 } })

    // La trace repart du fichier déjà acquis et s'enrichit du suivant.
    expect(snapshots[0].done).toHaveLength(2)
  })

  it('crée l’arborescence entière, pas seulement celle du reste', async () => {
    const calls = installHost()
    const tasks = plan()
    const key = tasks[0].folder + '/' + tasks[0].fileName
    await runExport({ completed: { [key]: 4096 } })

    const folders = calls.filter((c) => c.indexOf('lfCreateFolder') === 0)
    expect(folders.some((c) => c.indexOf(tasks[0].folder.split('/')[0]) >= 0)).toBe(
      true,
    )
  })
})
