/**
 * Garde-fous sur le panneau CEP vanilla.
 *
 * Ce fichier est autonome par construction : rien ne le compile, rien ne le
 * vérifie au build. Sans ces contrôles, une syntaxe trop récente ou un élément
 * manquant ne se découvrirait qu'une fois déployé dans Illustrator — et le
 * symptôme y est un panneau muet.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import * as acorn from 'acorn'
import { describe, expect, it } from 'vitest'

const HTML = readFileSync(resolve(import.meta.dirname, '../src/panel-cep.html'), 'utf8')

/** Scripts inline du document, hors balises à `src`. */
const INLINE_SCRIPTS = [
  ...HTML.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g),
].map((match) => match[1])

const SCRIPT = INLINE_SCRIPTS.join('\n;\n')

/** Feuille de style inline, dépouillée de ses commentaires. */
const STYLE = (/<style>([\s\S]*?)<\/style>/.exec(HTML)?.[1] ?? '').replace(
  /\/\*[\s\S]*?\*\//g,
  '',
)

describe('autonomie', () => {
  it('ne contient aucun module ES', () => {
    expect(SCRIPT).not.toMatch(/\bimport\s+[\w{*]/)
    expect(SCRIPT).not.toMatch(/\bexport\s+(default|const|function|\{)/)
  })

  it("n'utilise ni React ni aucun bundle", () => {
    expect(HTML).not.toMatch(/\breact\b/i)
    expect(HTML).not.toMatch(/src="\.\/index\.js"/)
  })

  it('embarque exactement un script inline et sa feuille de style', () => {
    expect(INLINE_SCRIPTS).toHaveLength(1)
    expect(STYLE.length).toBeGreaterThan(1000)
  })
})

describe('compatibilité Chromium 61', () => {
  it('parse intégralement en ES5', () => {
    expect(() =>
      acorn.parse(SCRIPT, { ecmaVersion: 5, sourceType: 'script' }),
    ).not.toThrow()
  })

  it("n'utilise pas d'unité vh", () => {
    expect(STYLE).not.toMatch(/\d\s*vh\b/)
  })

  it("n'utilise pas de syntaxe CSS postérieure à Chromium 61", () => {
    // `gap` en flexbox demande Chrome 84, `inset` Chrome 87,
    // `rgb(r g b / a%)` Chrome 65.
    expect(STYLE).not.toMatch(/[\s;{]gap:/)
    expect(STYLE).not.toMatch(/[\s;{]inset:/)
    expect(STYLE).not.toMatch(/rgb\(\s*\d+\s+\d+\s+\d+/)
  })

  it('ancre la mise en page en positionnement absolu', () => {
    for (const selector of [
      '.panel',
      '.panel-header',
      '.panel-body',
      '.panel-footer',
    ]) {
      const block = STYLE.slice(STYLE.indexOf(`\n      ${selector} {`)).slice(0, 400)
      expect(block, selector).toMatch(/position: absolute/)
    }
  })
})

describe('éléments attendus par le script', () => {
  const IDS = [
    'status-dot',
    'status-label',
    'document-card',
    'refresh',
    'preset-grid',
    'preset-count',
    'scheme-list',
    'package-name',
    'choose-folder',
    'destination',
    'messages',
    'export',
  ]

  it.each(IDS)('déclare #%s dans le balisage', (id) => {
    expect(HTML).toContain(`id="${id}"`)
  })

  it('référence les huit préréglages', () => {
    for (const id of [
      'sources',
      'web',
      'print',
      'social',
      'favicon',
      'office',
      'appIcons',
      'video',
    ]) {
      expect(SCRIPT, id).toContain(`id: '${id}'`)
    }
  })

  it('référence les quatre déclinaisons actives et le badge de la cinquième', () => {
    for (const id of ['full-color', 'black', 'white', 'grayscale']) {
      expect(SCRIPT, id).toContain(`id: '${id}'`)
    }
    expect(HTML).toContain('v1.1')
  })
})

describe('pont Illustrator', () => {
  it("parle à l'hôte par __adobe_cep__", () => {
    expect(SCRIPT).toContain('__adobe_cep__')
  })

  it('fournit un repli quand CSInterface est absent', () => {
    expect(SCRIPT).toMatch(/typeof CSInterface === 'undefined'/)
  })

  it('arrête la relecture après trois échecs consécutifs', () => {
    expect(SCRIPT).toContain('POLL_FAILURE_LIMIT')
    expect(SCRIPT).toContain('CEP mode - polling disabled')
  })

  it('sonde toutes les trois secondes', () => {
    expect(SCRIPT).toMatch(/POLL_MS = 3000/)
  })
})
