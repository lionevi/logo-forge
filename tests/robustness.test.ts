/**
 * Comportement en conditions dégradées.
 *
 * Ces cas ne décrivent pas ce que fait le plugin quand tout va bien : ils
 * décrivent ce qu'il fait quand l'hôte répond de travers, ne répond pas, ou
 * quand l'état enregistré est abîmé. C'est là que le silence coûte cher.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const UNIT = String.fromCharCode(31)

const ENGINE_SOURCE = readFileSync(
  resolve(import.meta.dirname, '../src/js/export-engine.js'),
  'utf8',
)
const PANEL_SOURCE = readFileSync(
  resolve(import.meta.dirname, '../src/panel-cep.html'),
  'utf8',
)

type EngineFn = (...args: never[]) => never

function loadEngine(): Record<string, EngineFn> {
  const holder = { exports: {} as Record<string, EngineFn> }
  const factory = new Function('module', 'window', 'setTimeout', ENGINE_SOURCE)
  // Transmis par renvoi, et non capturé : dans le panneau, `setTimeout` est
  // le global — les horloges simulées de ces cas doivent donc l'atteindre.
  factory(holder, globalThis, (fn: () => void, delay?: number) =>
    globalThis.setTimeout(fn, delay),
  )
  return holder.exports
}

let engine = loadEngine()

beforeEach(() => {
  engine = loadEngine()
})

afterEach(() => {
  delete (globalThis as Record<string, unknown>).__adobe_cep__
  vi.useRealTimers()
})

const call = (fn: string, args: unknown[]) =>
  new Promise<{ ok: boolean; value: string }>((done) => {
    ;(engine.call as unknown as (f: string, a: unknown[], c: unknown) => void)(
      fn,
      args,
      done,
    )
  })

/** Hôte simulé, dont chaque cas décide de la réponse. */
function host(answer: (expression: string) => string | null) {
  const seen: string[] = []
  ;(globalThis as Record<string, unknown>).__adobe_cep__ = {
    evalScript(expression: string, callback: (raw: string) => void) {
      seen.push(expression)
      const value = answer(expression)
      // `null` : l'hôte ne rappelle jamais.
      if (value === null) return
      setTimeout(() => callback(value), 0)
    },
  }
  return seen
}

describe('valeurs hostiles dans une expression', () => {
  const quote = (value: unknown) =>
    (engine.quote as unknown as (v: unknown) => string)(value)

  it('neutralise un guillemet dans un chemin', () => {
    // Sans échappement, le littéral se refermerait et la suite du chemin
    // serait exécutée comme du code par le moteur ExtendScript.
    expect(quote('/tmp/lo"go.ai')).toBe('"/tmp/lo\\"go.ai"')
  })

  it('neutralise une contre-oblique', () => {
    expect(quote('C:\\Livraisons\\Acme')).toBe('"C:\\\\Livraisons\\\\Acme"')
  })

  it('neutralise un retour à la ligne', () => {
    expect(quote('a\nb\r')).toBe('"a\\nb\\r"')
  })

  it('neutralise les séparateurs de ligne Unicode', () => {
    // Un moteur ES3 les traite comme des fins de ligne : laissés tels quels,
    // ils coupent le littéral en deux.
    expect(quote('a\u2028b\u2029c')).toBe('"a\\u2028b\\u2029c"')
  })

  it('accepte l absence de valeur sans lever', () => {
    expect(quote(undefined)).toBe('""')
    expect(quote(null)).toBe('""')
  })

  it("transmet un chemin piégé sans casser l'appel", async () => {
    const seen = host(() => 'OK|done')
    await call('lfExportPNG', [0, '/tmp/a"; app.quit(); "b.png', 900, 72])

    expect(seen[0]).toBe(
      'lfExportPNG("0","/tmp/a\\"; app.quit(); \\"b.png","900","72")',
    )
  })
})

describe('réponses de travers', () => {
  it('refuse une réponse sans séparateur', async () => {
    host(() => 'bonjour')
    const result = await call('lfPing', [])

    expect(result.ok).toBe(false)
    expect(result.value).toContain('reponse illisible')
  })

  it('reconnaît le refus du moteur ExtendScript', async () => {
    host(() => 'EvalScript error.')
    const result = await call('lfSetComponent', ['x'])

    expect(result.ok).toBe(false)
    expect(result.value).toContain('ExtendScript a refuse')
  })

  it('accepte une réponse vide comme un échec, pas comme un succès', async () => {
    host(() => '')
    const result = await call('lfPing', [])

    expect(result.ok).toBe(false)
  })

  it('ne prend pas un champ manquant pour un fichier écrit', async () => {
    // « OK » sans octets : le fichier n'est pas prouvé.
    host(() => 'OK|/tmp/sortie.png')
    const result = await call('lfExportPNG', [0, '/tmp/sortie.png', 900, 72])
    const bytes = parseInt(String(result.value).split(UNIT)[1], 10) || 0

    expect(bytes).toBe(0)
  })

  it('survit à un hôte absent', async () => {
    const result = await call('lfPing', [])

    expect(result.ok).toBe(false)
    expect(result.value).toContain('aucun pont')
  })

  it('survit à un hôte qui lève', async () => {
    ;(globalThis as Record<string, unknown>).__adobe_cep__ = {
      evalScript() {
        throw new Error('pont rompu')
      },
    }
    const result = await call('lfPing', [])

    expect(result.ok).toBe(false)
    expect(result.value).toContain('pont rompu')
  })
})

describe('hôte muet', () => {
  it('borne l attente au lieu de rester suspendu', async () => {
    vi.useFakeTimers()
    host(() => null)

    let answer: { ok: boolean; value: string } | null = null
    ;(engine.call as unknown as (f: string, a: unknown[], c: unknown) => void)(
      'lfExportPDF',
      [0, '/tmp/a.pdf'],
      (result: { ok: boolean; value: string }) => {
        answer = result
      },
    )

    expect(answer).toBeNull()
    await vi.advanceTimersByTimeAsync(engine.CALL_TIMEOUT_MS as unknown as number)

    expect(answer!.ok).toBe(false)
    expect(answer!.value).toContain('sans reponse')
  })

  it('laisse passer une opération longue', async () => {
    vi.useFakeTimers()
    let late: ((raw: string) => void) | null = null
    ;(globalThis as Record<string, unknown>).__adobe_cep__ = {
      evalScript(_expression: string, callback: (raw: string) => void) {
        late = callback
      },
    }

    let answer: { ok: boolean } | null = null
    ;(engine.call as unknown as (f: string, a: unknown[], c: unknown) => void)(
      'lfExportPDF',
      [0, '/tmp/a.pdf'],
      (result: { ok: boolean }) => {
        answer = result
      },
    )

    const timeout = engine.CALL_TIMEOUT_MS as unknown as number
    await vi.advanceTimersByTimeAsync(timeout - 1000)
    late!('OK|fait')
    await vi.advanceTimersByTimeAsync(2000)

    expect(answer!.ok).toBe(true)
  })

  it('ne règle jamais un appel deux fois', async () => {
    vi.useFakeTimers()
    let late: ((raw: string) => void) | null = null
    ;(globalThis as Record<string, unknown>).__adobe_cep__ = {
      evalScript(_expression: string, callback: (raw: string) => void) {
        late = callback
      },
    }

    let answers = 0
    ;(engine.call as unknown as (f: string, a: unknown[], c: unknown) => void)(
      'lfExportPDF',
      [0, '/tmp/a.pdf'],
      () => {
        answers += 1
      },
    )

    await vi.advanceTimersByTimeAsync(engine.CALL_TIMEOUT_MS as unknown as number)
    // Réponse tardive de l'hôte, après l'abandon : elle ne doit pas relancer
    // la suite du lot une seconde fois.
    late!('OK|fait')
    late!('OK|fait')
    await vi.advanceTimersByTimeAsync(1000)

    expect(answers).toBe(1)
  })

  it('consigne l abandon dans le journal', async () => {
    vi.useFakeTimers()
    host(() => null)
    ;(engine.call as unknown as (f: string, a: unknown[], c: unknown) => void)(
      'lfExportPDF',
      [0, '/tmp/a.pdf'],
      () => {},
    )
    await vi.advanceTimersByTimeAsync(engine.CALL_TIMEOUT_MS as unknown as number)

    const entries = (
      engine.logHistory as unknown as () => Array<{ action: string; detail: string }>
    )()
    expect(entries[0].action).toBe('lfExportPDF')
    expect(entries[0].detail).toContain('aucune reponse')
  })
})

describe('entrées limites du planificateur', () => {
  function config(overrides: Record<string, unknown> = {}) {
    return {
      clientName: 'Acme',
      outputFolder: '/out',
      components: [{ name: 'Logo', path: '/tmp/logo.ai' }],
      colorSchemes: [{ id: 'fullColor' }],
      formats: { print: { pdf: true }, web: { svg: true } },
      scales: [{ type: 'web', width: 900, resolution: 72 }],
      passes: { print: true, web: true },
      separator: '_',
      ...overrides,
    }
  }

  const plan = (overrides: Record<string, unknown> = {}) =>
    (engine.planExport as unknown as (c: unknown) => unknown[])(config(overrides))

  it('ne planifie rien sans composant capturé', () => {
    expect(plan({ components: [] })).toHaveLength(0)
    expect(plan({ components: [{ name: 'Logo' }] })).toHaveLength(0)
  })

  it('ne planifie rien sans format coché', () => {
    expect(plan({ formats: { print: {}, web: {} } })).toHaveLength(0)
  })

  it('supporte un nom de client vide', () => {
    expect(() => plan({ clientName: '' })).not.toThrow()
  })

  it('nettoie un nom qui casserait le système de fichiers', () => {
    const sanitize = engine.sanitize as unknown as (t: string) => string

    expect(sanitize('a/b\\c:d*e?f"g<h>i|j')).toBe('abcdefghij')
    expect(sanitize('')).toBe('')
  })

  it('supporte un nom de composant sans caractère exploitable', () => {
    const tasks = plan({
      components: [{ name: '///', path: '/tmp/logo.ai' }],
    }) as Array<{ fileName: string }>

    // Le fichier garde un nom utilisable plutôt que de devenir « _.pdf ».
    expect(tasks.length).toBeGreaterThan(0)
    for (const task of tasks) {
      expect(task.fileName).not.toBe('')
      expect(task.fileName.indexOf('/')).toBe(-1)
    }
  })

  it('tient un lot de plusieurs centaines de fichiers', () => {
    const components = []
    for (let i = 0; i < 20; i += 1) {
      components.push({ name: 'Composant ' + i, path: '/tmp/c' + i + '.ai' })
    }
    const schemes = [{ id: 'fullColor' }, { id: 'black' }, { id: 'white' }]
    const tasks = plan({ components: components, colorSchemes: schemes })

    expect(tasks.length).toBeGreaterThan(100)
  })
})

describe('état enregistré abîmé', () => {
  it('écarte une valeur qui n a pas la forme attendue', () => {
    // Le stockage local est modifiable de l'extérieur ; un « formats » devenu
    // chaîne faisait échouer le démarrage, à chaque ouverture.
    expect(PANEL_SOURCE).toContain('function wellFormed(')
    expect(PANEL_SOURCE).toContain('if (!wellFormed(key, value)) continue')
  })

  it('exige un objet là où une structure est attendue', () => {
    expect(PANEL_SOURCE).toContain("if (key === 'scales') return isArray")
    expect(PANEL_SOURCE).toContain("if (key === 'formats')")
  })

  it('ramène les champs calculés à des nombres', () => {
    expect(PANEL_SOURCE).toContain('NUMERIC_COMPONENT_FIELDS')
    expect(PANEL_SOURCE).toContain('isNaN(number) ? 0 : number')
  })

  it('offre une porte de sortie quand le démarrage échoue', () => {
    expect(PANEL_SOURCE).toContain('function offerReset(')
    expect(PANEL_SOURCE).toContain("startup('démarrage'")
    expect(PANEL_SOURCE).toContain('Repartir des réglages par défaut')
  })

  it('avertit quand un lot n a pas pu être suivi', () => {
    // Le drapeau existait déjà ; personne ne le lisait.
    expect(PANEL_SOURCE).toContain('state.runTraceLost = true')
    expect(PANEL_SOURCE).toContain('if (state.runTraceLost) {')
    expect(PANEL_SOURCE).toContain('la reprise n aurait pas été proposée')
  })
})
