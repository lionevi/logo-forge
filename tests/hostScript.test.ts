/**
 * Contrôle du chargement de la couche ExtendScript.
 *
 * Quand `main.jsx` n'est pas accepté par le moteur, aucune de ses fonctions
 * n'existe : le pont ne peut plus rien demander d'utile. Mais `evalScript`
 * évalue n'importe quelle expression, pas seulement les fonctions déclarées —
 * ce contrôle-là ne dépend donc de rien, et rend l'erreur telle que le moteur
 * la formule.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import * as acorn from 'acorn'
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

interface Verdict {
  ok: boolean
  bytes?: number
  defined?: boolean
  message: string
  path: string
}

/** Hôte simulé : il note l'expression reçue et rend ce que le cas décide. */
function host(answer: (expression: string) => string) {
  const seen: string[] = []
  ;(globalThis as Record<string, unknown>).__adobe_cep__ = {
    getSystemPath: () => '/Extensions/logo-forge',
    evalScript(expression: string, callback: (raw: string) => void) {
      seen.push(expression)
      setTimeout(() => callback(answer(expression)), 0)
    },
  }
  return seen
}

const check = () =>
  new Promise<Verdict>((done) => {
    ;(engine.checkHostScript as unknown as (d: unknown) => void)(done)
  })

beforeEach(() => {
  engine = loadEngine()
})

afterEach(() => {
  delete (globalThis as Record<string, unknown>).__adobe_cep__
})

describe('expression envoyée au moteur', () => {
  const probe = () =>
    (engine.hostScriptProbe as unknown as (p: string) => string)(
      '/Extensions/logo-forge/jsx/main.jsx',
    )

  it('ne dépend d’aucune fonction du fichier qu’elle contrôle', () => {
    // Si elle appelait `lfQuelqueChose`, elle échouerait précisément dans le
    // cas qu'elle sert à diagnostiquer.
    expect(probe()).not.toMatch(/\blf[A-Z]\w*\s*\(/)
  })

  it('lit le fichier, l’évalue, et rend la ligne fautive', () => {
    const text = probe()

    expect(text).toContain('new File(')
    expect(text).toContain('eval(src)')
    expect(text).toContain('p.line')
  })

  it('rend le message même sans numéro de ligne', () => {
    // `line` existe sur l'Error d'ExtendScript ; ailleurs il manque, et
    // « ligne undefined » n'aiderait personne.
    expect(probe()).toContain('p.line===undefined?""')
  })

  it('reste une expression ES3 valide', () => {
    // Elle est évaluée par le même moteur que le fichier qu'elle contrôle.
    expect(() =>
      acorn.parse(probe(), { ecmaVersion: 3, sourceType: 'script' }),
    ).not.toThrow()
  })

  it('échappe le chemin qu’on lui confie', () => {
    const text = (engine.hostScriptProbe as unknown as (p: string) => string)(
      '/tmp/a"; app.quit(); "b/main.jsx',
    )

    expect(text).toContain('\\"; app.quit(); \\"')
    expect(() =>
      acorn.parse(text, { ecmaVersion: 3, sourceType: 'script' }),
    ).not.toThrow()
  })

  it('distingue l’absence du fichier de son refus', () => {
    const text = probe()

    expect(text).toContain('fichier introuvable')
    expect(text).toContain('lecture refusee')
    expect(text).toContain('fichier vide')
  })
})

describe('verdict', () => {
  it('cherche le fichier dans le dossier de l’extension', async () => {
    const seen = host(() => 'OK|71000' + UNIT + 'function')
    const verdict = await check()

    expect(verdict.path).toBe('/Extensions/logo-forge/jsx/main.jsx')
    expect(seen[0]).toContain('/Extensions/logo-forge/jsx/main.jsx')
  })

  it('déclare le fichier accepté et ses fonctions définies', async () => {
    host(() => 'OK|71000' + UNIT + 'function')
    const verdict = await check()

    expect(verdict.ok).toBe(true)
    expect(verdict.bytes).toBe(71000)
    expect(verdict.defined).toBe(true)
  })

  it('distingue « relu sans erreur » de « fonctions définies »', async () => {
    // Un fichier valide dont le ScriptPath ne pointe pas ici se relit très
    // bien sans que rien ne soit défini au démarrage du panneau.
    host(() => 'OK|71000' + UNIT + 'undefined')
    const verdict = await check()

    expect(verdict.ok).toBe(true)
    expect(verdict.defined).toBe(false)
  })

  it('rapporte la ligne fautive telle que le moteur la donne', async () => {
    host(() => 'ERR|ligne 593 : Expected: ;')
    const verdict = await check()

    expect(verdict.ok).toBe(false)
    expect(verdict.message).toBe('ligne 593 : Expected: ;')
  })

  it('reconnaît un refus du moteur sur le contrôle lui-même', async () => {
    host(() => 'EvalScript error.')
    const verdict = await check()

    expect(verdict.ok).toBe(false)
    expect(verdict.message).toContain('refuse le controle')
  })

  it('ne prétend rien hors d’Illustrator', async () => {
    // Sans dossier d'extension, il n'y a pas de fichier à relire.
    ;(globalThis as Record<string, unknown>).__adobe_cep__ = {
      evalScript() {},
    }
    const verdict = await check()

    expect(verdict.ok).toBe(false)
    expect(verdict.message).toContain('que dans Illustrator')
  })

  it('consigne le contrôle dans le journal', async () => {
    host(() => 'ERR|ligne 12 : Expected: }')
    await check()
    const entries = (engine.logHistory as unknown as () => Array<{ action: string }>)()

    expect(entries[0].action).toBe('CHECK_HOST_SCRIPT')
  })
})
