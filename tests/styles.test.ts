/**
 * Garde-fous sur la feuille de style du panneau.
 *
 * CEP embarque un Chromium figé, et certaines constructions y échouent en
 * silence : une déclaration incomprise est ignorée sans message, ce qui rend un
 * panneau à moitié stylé indiscernable d'un panneau cassé. Ces règles ont déjà
 * coûté deux allers-retours de diagnostic — elles sont désormais vérifiées.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const SOURCE = readFileSync(
  resolve(import.meta.dirname, '../src/styles/main.css'),
  'utf8',
)

/** Feuille dépouillée de ses commentaires : seules les déclarations comptent. */
const DECLARATIONS = SOURCE.replace(/\/\*[\s\S]*?\*\//g, '')

describe('unités de fenêtre', () => {
  it("n'utilise aucune unité vh, que CEP ne résout pas sur la fenêtre du panneau", () => {
    expect(DECLARATIONS).not.toMatch(/\d\s*vh\b/)
  })

  it('ancre le panneau, son en-tête, son corps et son pied en absolu', () => {
    for (const selector of [
      '.panel',
      '.panel-header',
      '.panel-body',
      '.panel-footer',
    ]) {
      const block = DECLARATIONS.slice(DECLARATIONS.indexOf(`\n${selector} {`)).slice(
        0,
        400,
      )
      expect(block, selector).toMatch(/position: absolute/)
    }
  })

  it('donne une hauteur au socle sans passer par la fenêtre', () => {
    expect(DECLARATIONS).toMatch(/html,\s*\n?body \{[^}]*height: 100%/)
  })
})

describe('syntaxes postérieures à Chromium 61', () => {
  it("n'utilise pas la notation rgb() à composantes séparées par des espaces", () => {
    // `rgb(38 128 235 / 10%)` demande Chrome 65 ; `rgba()` remonte à Chrome 1.
    expect(DECLARATIONS).not.toMatch(/rgb\(\s*\d+\s+\d+\s+\d+/)
  })

  it("n'utilise pas la propriété raccourcie inset", () => {
    // `inset` demande Chrome 87 ; les quatre côtés sont compris partout.
    expect(DECLARATIONS).not.toMatch(/[\s;{]inset:/)
  })
})
