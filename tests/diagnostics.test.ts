/**
 * Erreurs actionnables, journal et sondes système.
 *
 * Un message d'ExtendScript décrit une cause technique ; le designer a besoin
 * de savoir quoi faire. Et une opération qui échoue dans Illustrator ne laisse
 * aucune trace : le journal est le seul moyen de raconter après coup ce qui
 * s'est passé.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { beforeEach, describe, expect, it } from 'vitest'

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

interface Fault {
  what: string
  why: string
  how: string
  retryable: boolean
  detail: string
  action: string
}

const describeError = (message: string, action?: string): Fault =>
  (engine.describeError as unknown as (m: string, a?: string) => Fault)(message, action)

beforeEach(() => {
  // Le journal est un état de module : chaque cas repart d'un moteur neuf.
  engine = loadEngine()
})

describe('erreurs actionnables', () => {
  it('traduit une sélection vide en geste à faire', () => {
    const fault = describeError(
      'selectionnez un objet dans Illustrator avant de definir le composant',
    )

    expect(fault.what).toContain('Rien n est sélectionné')
    expect(fault.how).toContain('Sélectionnez le logo')
    expect(fault.retryable).toBe(true)
  })

  it('explique le mode édition de texte', () => {
    const fault = describeError(
      'la selection ne contient aucun objet cadrable — sortez du mode edition de texte',
    )

    expect(fault.how).toContain('Échap')
  })

  it('oriente vers l’enregistrement du document', () => {
    const fault = describeError('enregistrez le document avant d exporter')

    expect(fault.what).toContain('jamais été enregistré')
    expect(fault.how).toContain('Enregistrez')
  })

  it('déclare irrécupérable une capture disparue', () => {
    const fault = describeError('composant introuvable : /tmp/logo.ai')

    expect(fault.retryable).toBe(false)
    expect(fault.how).toContain('Réassignez')
  })

  it('distingue un refus de droits d’un disque plein', () => {
    expect(describeError('permission denied').how).toContain('droits')
    expect(describeError('creation refusee : /pack').how).toContain('dossier')
  })

  it('reconnaît un hôte muet', () => {
    const fault = describeError('ExtendScript a refuse lfPing')

    expect(fault.what).toContain('n a pas répondu')
    expect(fault.how).toContain('rechargez')
  })

  it('ne masque jamais un message inconnu', () => {
    const fault = describeError('erreur 4711 du moteur', 'export')

    expect(fault.detail).toBe('erreur 4711 du moteur')
    expect(fault.what).toContain('export')
    expect(fault.retryable).toBe(true)
  })

  it('supporte un message vide sans lever', () => {
    const fault = describeError('')

    expect(fault.detail).toBe('')
    expect(fault.what).toBeTruthy()
  })

  it('donne à chaque cas connu les trois temps', () => {
    for (const hint of engine.ERROR_HINTS as unknown as Array<{
      match: string
      what: string
      why: string
      how: string
    }>) {
      expect(hint.what, hint.match).toBeTruthy()
      expect(hint.why, hint.match).toBeTruthy()
      expect(hint.how, hint.match).toBeTruthy()
    }
  })
})

describe('journal', () => {
  const log = () => engine.log as unknown as (...args: unknown[]) => unknown
  const history = () =>
    engine.logHistory as unknown as () => Array<Record<string, unknown>>

  it('consigne une opération avec son résultat', () => {
    log()('EXPORT_FILE', 'logo.svg', 'ok', '', 42)
    const entries = history()()

    expect(entries).toHaveLength(1)
    expect(entries[0].action).toBe('EXPORT_FILE')
    expect(entries[0].input).toBe('logo.svg')
    expect(entries[0].durationMs).toBe(42)
  })

  it('rend la plus récente en tête', () => {
    log()('PREMIER', '', 'ok')
    log()('SECOND', '', 'ok')

    expect(history()()[0].action).toBe('SECOND')
  })

  it('horodate au format heure locale', () => {
    log()('TEST', '', 'ok')

    expect(history()()[0].time).toMatch(/^\d{2}:\d{2}:\d{2}$/)
  })

  it('ne grossit pas sans fin', () => {
    const limit = engine.LOG_LIMIT as unknown as number
    for (let i = 0; i < limit + 50; i += 1) log()('BOUCLE', String(i), 'ok')

    const entries = history()()
    expect(entries).toHaveLength(limit)
    // Les plus anciennes cèdent la place, pas les plus récentes.
    expect(entries[0].input).toBe(String(limit + 49))
  })

  it('se vide sur demande', () => {
    log()('TEST', '', 'ok')
    ;(engine.clearLog as unknown as () => void)()

    expect(history()()).toHaveLength(0)
  })

  it('se met en forme pour un signalement', () => {
    log()('EXPORT_FILE', 'logo.svg', 'fail', 'disque plein', 12)
    const text = (engine.formatLog as unknown as () => string)()

    expect(text).toContain('EXPORT_FILE')
    expect(text).toContain('logo.svg')
    expect(text).toContain('disque plein')
    expect(text).toContain('12 ms')
  })

  it('tolère une opération sans entrée ni durée', () => {
    log()('PING')
    const entry = history()()[0]

    expect(entry.input).toBe('')
    expect(entry.durationMs).toBeNull()
  })
})

describe('sondes système', () => {
  interface Report {
    results: Array<{ id: string; ok: boolean; hint: string; durationMs: number }>
    ok: boolean
    failed: number
  }

  /** Hôte simulé, avec la liste des sondes à faire échouer. */
  function installHost(failing: string[] = []): string[] {
    const calls: string[] = []
    ;(globalThis as Record<string, unknown>).__adobe_cep__ = {
      evalScript(expression: string, callback: (raw: string) => void) {
        calls.push(expression)
        const failed = failing.some((name) => expression.indexOf(name) === 0)
        let answer = 'OK|ok'
        if (failed) answer = 'ERR|sonde en echec'
        else if (expression.indexOf('lfPing') === 0) answer = 'OK|pong'
        else if (expression.indexOf('lfGetDocumentInfo') === 0) answer = 'OK|brand.ai'
        setTimeout(() => callback(answer), 0)
      },
    }
    return calls
  }

  function run(state: Record<string, unknown> = {}): Promise<Report> {
    return new Promise((resolve) => {
      ;(
        engine.runDiagnostics as unknown as (
          s: unknown,
          h: { onDone: (r: Report) => void; onStep?: () => void },
        ) => void
      )(state, { onDone: resolve })
    })
  }

  it('interroge chaque sonde du plan', async () => {
    const calls = installHost()
    const report = await run()

    const plan = (
      engine.diagnosticPlan as unknown as (s: unknown) => Array<{ id: string }>
    )({})
    expect(report.results).toHaveLength(plan.length)
    expect(calls.length).toBe(plan.length)
  })

  it('déclare le système sain quand tout répond', async () => {
    installHost()
    const report = await run()

    expect(report.ok).toBe(true)
    expect(report.failed).toBe(0)
  })

  it('poursuit après une sonde en échec', async () => {
    installHost(['lfGetDocumentInfo'])
    const report = await run()

    expect(report.ok).toBe(false)
    expect(report.failed).toBe(1)
    // Les sondes suivantes ont bien été exécutées.
    expect(report.results).toHaveLength(6)
  })

  it('accompagne un échec d’un geste à faire', async () => {
    installHost(['lfPing'])
    const report = await run()
    const bridge = report.results.find((entry) => entry.id === 'bridge')!

    expect(bridge.ok).toBe(false)
    expect(bridge.hint).toContain('rechargez')
  })

  it('refuse un ping qui ne renvoie pas le mot attendu', async () => {
    // Un hôte qui répond « OK » à tout ne prouve rien.
    ;(globalThis as Record<string, unknown>).__adobe_cep__ = {
      evalScript(_expression: string, callback: (raw: string) => void) {
        setTimeout(() => callback('OK|autre chose'), 0)
      },
    }
    const report = await run()

    expect(report.results.find((entry) => entry.id === 'bridge')!.ok).toBe(false)
  })

  it('journalise chaque sonde', async () => {
    installHost()
    await run()

    const entries = (engine.logHistory as unknown as () => Array<{ action: string }>)()
    expect(entries.map((entry) => entry.action)).toContain('lfPing')
  })

  it('mesure la durée de chaque sonde', async () => {
    installHost()
    const report = await run()

    for (const entry of report.results) {
      expect(entry.durationMs, entry.id).toBeGreaterThanOrEqual(0)
    }
  })
})
