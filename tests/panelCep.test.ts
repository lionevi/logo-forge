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

  it('charge le moteur d export depuis js/export-engine.js', () => {
    expect(HTML).toContain('src="./js/export-engine.js"')
  })

  it('signale un moteur manquant plutot que de laisser un bouton inerte', () => {
    expect(SCRIPT).toContain("typeof LogoForgeEngine === 'undefined'")
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
    'document-card',
    'refresh',
    'tabs',
    'subtabs',
    'comp-grid',
    'comp-count',
    'add-component',
    'scheme-list',
    'custom-list',
    'add-custom',
    'print-formats',
    'web-formats',
    'scale-list',
    'add-scale',
    'separator',
    'padding-fields',
    'client-name',
    'choose-folder',
    'destination',
    'messages',
    'open-export',
    'start-export',
    'cancel-export',
    'abort-export',
    'progress-bar',
    'progress-label',
    'progress-title',
    'export-veil',
    'progress-veil',
    'open-settings',
    'settings-veil',
    'threshold',
    'remember-schemes',
    'done-panel',
    'done-count',
    'open-folder',
    'reset-all',
    'invert-before',
    'invert-after',
    'pass-print',
    'pass-web',
  ]

  it.each(IDS)('déclare #%s dans le balisage', (id) => {
    expect(HTML).toContain(`id="${id}"`)
  })

  it('référence les cinq déclinaisons', () => {
    for (const id of ['fullColor', 'black', 'white', 'inverted', 'grayscale']) {
      expect(SCRIPT, id).toContain(`id: '${id}'`)
    }
  })

  it('référence les cinq formats exportables', () => {
    for (const id of ['ai', 'svg', 'png', 'pdf', 'eps']) {
      expect(SCRIPT, id).toContain(`id: '${id}'`)
    }
  })

  it('propose quatre composants par défaut', () => {
    for (const name of ['Logo', 'Logo Mark', 'Logotype', 'Stacked Logo']) {
      expect(SCRIPT, name).toContain(`newComponent('${name}')`)
    }
  })

  it('déclare les deux onglets et les quatre sous-onglets de réglages', () => {
    // Les réglages sont une fenêtre modale ouverte par l'engrenage, pas un
    // onglet : ils ne doivent pas voler la place aux composants.
    for (const tab of ['components', 'colors']) {
      expect(HTML, tab).toContain(`data-tab="${tab}"`)
    }
    expect(HTML).not.toContain('data-tab="settings"')
    for (const sub of ['files', 'names', 'scales', 'padding']) {
      expect(HTML, sub).toContain(`data-sub="${sub}"`)
    }
  })
})

describe('flux Logo Package Express', () => {
  it('affecte un composant depuis la sélection', () => {
    expect(SCRIPT).toContain("'lfSetComponent'")
  })

  it('transmet le seuil d inversion au moteur', () => {
    expect(SCRIPT).toMatch(/threshold: state\.threshold/)
  })

  it('prévisualise les couleurs sans passer par Illustrator', () => {
    expect(SCRIPT).toContain('function previewColor(')
    expect(SCRIPT).toContain("getContext('2d')")
  })

  it('laisse le seuil agir sur la prévisualisation inversée', () => {
    // Les deux branches doivent différer : un seuil sans effet visible
    // rendrait le curseur mensonger.
    const block = SCRIPT.slice(
      SCRIPT.indexOf("if (schemeId === 'inverted')"),
      SCRIPT.indexOf("if (schemeId === 'inverted')") + 400,
    )
    expect(block).toMatch(/luminance\(rgb\) >= \(threshold \/ 100\) \* 255/)
    expect(block).toContain('return hex')
    expect(block).toContain('255 - rgb[0]')
  })

  it('propose les deux passes d export', () => {
    expect(HTML).toContain('id="pass-print"')
    expect(HTML).toContain('id="pass-web"')
  })

  it('affiche un écran de fin actionnable', () => {
    expect(HTML).toContain('Package terminé')
    expect(HTML).toContain('Ouvrir le dossier')
    expect(HTML).toContain('Réinitialiser')
  })
})

describe('pont Illustrator', () => {
  it("parle à l'hôte par __adobe_cep__", () => {
    expect(SCRIPT).toContain('__adobe_cep__')
  })

  it("n'embarque aucune bibliothèque tierce", () => {
    // Charger CSInterface sans le livrer ne donnerait qu'un 404 rouge dans la
    // console de l'extension : __adobe_cep__ suffit.
    expect(HTML).not.toContain('CSInterface.js')
    expect(HTML).not.toMatch(/<script src="(?!\.\/js\/export-engine\.js)/)
  })

  it('arrête la relecture après trois échecs consécutifs', () => {
    expect(SCRIPT).toContain('POLL_FAILURE_LIMIT')
    expect(SCRIPT).toContain('CEP mode - polling disabled')
  })

  it('sonde toutes les trois secondes', () => {
    expect(SCRIPT).toMatch(/POLL_MS = 3000/)
  })
})
