/**
 * Garde-fou de mise en page, tel que le build l'applique.
 *
 * Un panneau CEP dont la hauteur dépend de `vh` s'effondre à zéro : il ne
 * reste que l'en-tête sur un fond gris, et rien n'en dit la cause. Le contrôle
 * est une étape obligatoire du build ; ces cas vérifient qu'il refuse
 * réellement, et qu'il ne refuse pas à tort.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import { checkPanel, fixPanel } from '../scripts/check-cep-css.mjs'

const PANEL = readFileSync(
  resolve(import.meta.dirname, '../src/panel-cep.html'),
  'utf8',
)
const PACKAGE = JSON.parse(
  readFileSync(resolve(import.meta.dirname, '../package.json'), 'utf8'),
) as { scripts: Record<string, string> }

/** Enveloppe une feuille de style dans un document minimal. */
const document_ = (style: string) => `<html><style>${style}</style></html>`

const SOUND = `
  html, body { width: 100%; height: 100%; }
  .panel { position: absolute; top: 0; right: 0; bottom: 0; left: 0; }
  .panel-body { position: absolute; top: 78px; right: 0; bottom: 0; left: 0; }
`

describe('ce qui vide un panneau', () => {
  it('refuse une hauteur en vh', () => {
    const faults = checkPanel(document_(SOUND + '.x { height: 100vh; }'), 'essai')

    expect(faults).toHaveLength(1)
    expect(faults[0].message).toContain('vh')
    expect(faults[0].fixable).toBe(true)
  })

  it('refuse aussi dvh et svh', () => {
    // Les unités récentes tombent dans le même piège, sans être plus lisibles.
    expect(checkPanel(document_(SOUND + '.x{height:100dvh}'), 'e')).not.toHaveLength(0)
    expect(checkPanel(document_(SOUND + '.x{height:100svh}'), 'e')).not.toHaveLength(0)
  })

  it('refuse un calcul fondé sur vh', () => {
    const faults = checkPanel(
      document_(SOUND + '.x { height: calc(100vh - 40px); }'),
      'essai',
    )

    expect(faults.length).toBeGreaterThan(0)
    expect(faults.some((fault) => !fault.fixable)).toBe(true)
  })

  it('refuse position: fixed', () => {
    const faults = checkPanel(document_(SOUND + '.x { position: fixed; }'), 'essai')

    expect(faults[0].message).toContain('position: fixed')
  })

  it('ignore ce qui est hors de la feuille de style', () => {
    // Le mot « 100vh » dans un texte ou un commentaire ne vide aucun panneau.
    const faults = checkPanel(
      '<html><style>' + SOUND + '</style><p>évitez 100vh</p></html>',
      'essai',
    )

    expect(faults).toEqual([])
  })
})

describe('ce sans quoi le panneau n’a pas de hauteur', () => {
  it('exige html et body en hauteur pleine', () => {
    const faults = checkPanel(document_(SOUND.replace('height: 100%;', '')), 'essai')

    expect(faults.map((fault) => fault.message).join(' ')).toContain('hauteur pleine')
  })

  it('exige un panneau borné par ses quatre côtés', () => {
    const faults = checkPanel(
      document_(
        SOUND.replace('.panel { position: absolute;', '.panel { position: static;'),
      ),
      'essai',
    )

    expect(faults.map((fault) => fault.message).join(' ')).toContain('quatre côtés')
  })

  it('exige un corps borné en haut et en bas', () => {
    const faults = checkPanel(
      document_(SOUND.replace(/\.panel-body[^}]*}/, '.panel-body { display: block; }')),
      'essai',
    )

    expect(faults.map((fault) => fault.message).join(' ')).toContain('haut et en bas')
  })

  it('laisse passer une feuille de style saine', () => {
    expect(checkPanel(document_(SOUND), 'essai')).toEqual([])
  })
})

describe('correction assistée', () => {
  it('remplace par l’équivalent qui convient à un panneau borné', () => {
    const { html, applied } = fixPanel('.x { height: 100vh; position: fixed; }')

    expect(html).toContain('height: 100%')
    expect(html).toContain('position: absolute')
    expect(applied).toHaveLength(2)
  })

  it('ne touche pas ce qu’elle ne sait pas corriger', () => {
    // Un `calc(100vh - …)` demande une décision, pas une substitution.
    const { html } = fixPanel('.x { height: calc(100vh - 40px); }')

    expect(html).toContain('calc(100vh - 40px)')
  })

  it('ne signale rien quand il n’y a rien à corriger', () => {
    expect(fixPanel(SOUND).applied).toEqual([])
  })
})

describe('le panneau livré', () => {
  it('passe le contrôle', () => {
    expect(checkPanel(PANEL, 'src/panel-cep.html')).toEqual([])
  })

  it('est contrôlé par le build, pas seulement par les tests', () => {
    // Un garde-fou qui ne s'exécute qu'en test laisse passer un build lancé
    // à la main — et c'est celui-là qui part chez un tiers.
    expect(PACKAGE.scripts.build).toContain('check-cep-css.mjs')
    expect(PACKAGE.scripts.build).toContain('check-jsx-es3.mjs')
  })
})
