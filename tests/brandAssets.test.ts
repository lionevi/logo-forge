/**
 * Intégration des éléments de marque.
 *
 * Le panneau part en un seul fichier : une balise `<img src>` ne suivrait pas
 * le thème, et CEP ne charge pas toujours un chemin relatif. Les SVG déposés
 * dans `src/assets/` sont donc insérés en ligne — et ce qui manque ne doit
 * rien casser, puisque le dépôt ne porte aujourd'hui aucun de ces fichiers.
 */

import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import {
  BRAND_FILES,
  MARKER,
  collectBrand,
  inlineBrand,
  prepareSvg,
} from '../scripts/inline-brand.mjs'

const PANEL = readFileSync(
  resolve(import.meta.dirname, '../src/panel-cep.html'),
  'utf8',
)

const ICON =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="48" height="48"><path d="M4 3h13v3H7z"/></svg>'

function assetsWith(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'lf-brand-'))
  for (const [name, contents] of Object.entries(files)) {
    writeFileSync(join(dir, name), contents)
  }
  return dir
}

describe('préparation d’un SVG', () => {
  it('pose la classe qui porte la couleur', () => {
    const { markup } = prepareSvg(ICON)

    expect(markup).toContain('class="lf-icon"')
  })

  it('retire les dimensions, que la feuille de style impose', () => {
    const { markup } = prepareSvg(ICON)

    expect(markup).not.toContain('width="48"')
    expect(markup).not.toContain('height="48"')
    expect(markup).toContain('viewBox="0 0 24 24"')
  })

  it('retire l’en-tête XML et les commentaires', () => {
    const { markup } = prepareSvg('<?xml version="1.0"?>\n<!-- note -->\n' + ICON)

    expect(markup!.startsWith('<svg')).toBe(true)
    expect(markup).not.toContain('note')
  })

  it('exige un viewBox, sans lequel rien ne se met à l’échelle', () => {
    const { markup, reason } = prepareSvg('<svg><path d="M0 0h9v9H0z"/></svg>')

    expect(markup).toBeNull()
    expect(reason).toContain('viewBox')
  })

  it('refuse un script ou une image externe', () => {
    // Le panneau est hors ligne, et la politique de sécurité de CEP les
    // bloquerait de toute façon.
    expect(
      prepareSvg('<svg viewBox="0 0 1 1"><script>x()</script></svg>').markup,
    ).toBeNull()
    expect(
      prepareSvg('<svg viewBox="0 0 1 1"><image href="a.png"/></svg>').markup,
    ).toBeNull()
  })

  it('écarte ce qui n’est pas un SVG plutôt que de l’insérer', () => {
    const { markup, reason } = prepareSvg('ceci n est pas un svg')

    expect(markup).toBeNull()
    expect(reason).toContain('<svg>')
  })

  it('préserve la couleur propre d’un tracé', () => {
    // Un logo polychrome ne doit pas être aplati par `currentColor`.
    const { markup } = prepareSvg(
      '<svg viewBox="0 0 1 1"><path fill="#2680eb" d="M0 0h1v1H0z"/></svg>',
    )

    expect(markup).toContain('fill="#2680eb"')
  })
})

describe('collecte', () => {
  it('range chaque fichier connu sous sa clé', () => {
    const dir = assetsWith({ 'Icone-LF.svg': ICON })
    const { brand } = collectBrand(dir)

    expect(Object.keys(brand)).toEqual(['icon'])
    expect(brand.icon).toContain('lf-icon')
  })

  it('dit ce qu’elle écarte, et pourquoi', () => {
    const dir = assetsWith({
      'Icone-LF.svg': ICON,
      'logo-LF.svg': '<svg><path/></svg>',
      'inconnu.svg': ICON,
    })
    const { brand, notes } = collectBrand(dir)

    expect(brand.logo).toBeUndefined()
    expect(notes.join(' ')).toContain('viewBox')
    expect(notes.join(' ')).toContain('nom inconnu')
  })

  it('ne rend rien quand le dossier n’existe pas', () => {
    expect(collectBrand('/dossier/absent').brand).toEqual({})
  })

  it('couvre les quatre noms annoncés', () => {
    expect(Object.keys(BRAND_FILES).sort()).toEqual([
      'Icone-LF.svg',
      'components-Illustration-LF.svg',
      'logo-LF.svg',
      'wordmark-logo-LF.svg',
    ])
  })
})

describe('insertion dans le panneau', () => {
  it('trouve son marqueur dans le panneau réel', () => {
    expect(PANEL).toContain(MARKER)
  })

  it('remplace le marqueur par un littéral lisible', () => {
    const out = inlineBrand('var LF_BRAND = ' + MARKER, { icon: '<svg/>' })

    expect(out).toBe('var LF_BRAND = {"icon":"<svg/>"}')
  })

  it('refuse de travailler sans marqueur, plutôt que de ne rien faire', () => {
    expect(() => inlineBrand('rien ici', {})).toThrow('marqueur')
  })

  it('laisse le panneau intact quand aucun élément n’est déposé', () => {
    // C'est l'état du dépôt aujourd'hui : la marque n'y est pas.
    const out = inlineBrand(PANEL, {})

    expect(out).toContain('var LF_BRAND = {}')
    expect(out).toContain('LF_BRAND.illustration || ICONS.empty')
  })
})

describe('emplacements dans le panneau', () => {
  it('réserve une place dans l’en-tête, à côté du titre', () => {
    expect(PANEL).toContain('id="brand-mark"')
    expect(PANEL).toContain("if (LF_BRAND.icon) byId('brand-mark').innerHTML")
  })

  it('retombe sur le pictogramme actuel dans une carte vide', () => {
    expect(PANEL).toContain('LF_BRAND.illustration || ICONS.empty')
  })

  it('fait suivre la couleur du thème', () => {
    expect(PANEL).toContain('fill: currentColor')
    expect(PANEL).toMatch(/\.comp-placeholder\.brand \.lf-icon \{[^}]*opacity: 0\.3/)
  })
})
