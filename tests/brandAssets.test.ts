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
  colorsUsed,
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

  it('préserve les couleurs d’une marque polychrome', () => {
    // L'aplatir par `currentColor` la défigurerait.
    const { markup, monochrome } = prepareSvg(
      '<svg viewBox="0 0 1 1"><path fill="#2680eb" d="M0 0h1v1H0z"/>' +
        '<path fill="#e34850" d="M1 0h1v1H1z"/></svg>',
    )

    expect(monochrome).toBe(false)
    expect(markup).toContain('fill="#2680eb"')
    expect(markup).toContain('fill="#e34850"')
  })

  it('fait suivre le thème à une marque monochrome', () => {
    // Une marque noire sur le fond #252525 du panneau serait invisible.
    const { markup, monochrome } = prepareSvg(
      '<svg viewBox="0 0 1 1"><path fill="#000000" d="M0 0h1v1H0z"/>' +
        '<circle fill="#000000" cx="1" cy="1" r="1"/></svg>',
    )

    expect(monochrome).toBe(true)
    expect(markup).not.toContain('#000000')
    expect(markup!.match(/currentColor/g)).toHaveLength(2)
  })

  it('atteint les couleurs rangées dans un bloc style', () => {
    // C'est la forme qu'exporte Illustrator : `.cls-1 { fill: #231f20; }`.
    const { markup } = prepareSvg(
      '<svg viewBox="0 0 1 1"><defs><style>.cls-1{fill:#231f20;}</style></defs>' +
        '<path class="cls-1" d="M0 0h1v1H0z"/></svg>',
    )

    expect(markup).toContain('.cls-1{fill:currentColor;}')
    expect(markup).not.toContain('#231f20')
  })

  it('ne transforme jamais « none » en couleur', () => {
    // Un contour dont on retirerait la couleur retomberait à `none` et le
    // tracé disparaîtrait ; un remplissage `none` doit le rester.
    const { markup } = prepareSvg(
      '<svg viewBox="0 0 1 1"><path fill="none" stroke="#231f20" d="M0 0h1"/></svg>',
    )

    expect(markup).toContain('fill="none"')
    expect(markup).toContain('stroke="currentColor"')
  })

  it('laisse un dégradé à son motif', () => {
    const { markup } = prepareSvg(
      '<svg viewBox="0 0 1 1"><path fill="url(#g)" d="M0 0h1v1H0z"/></svg>',
    )

    expect(markup).toContain('fill="url(#g)"')
  })

  it('relève les couleurs, attributs et feuille de style confondus', () => {
    const colors = colorsUsed(
      '<style>.a{fill:#111;}</style><path stroke="#222" fill="none"/>',
    )

    expect(colors.sort()).toEqual(['#111', '#222'])
  })
})

describe('collecte', () => {
  it('range chaque fichier connu sous sa clé', () => {
    const dir = assetsWith({ 'Icone-LF.svg': ICON })
    const { brand } = collectBrand(dir)

    expect(Object.keys(brand)).toEqual(['icon'])
    expect(brand.icon).toContain('lf-icon')
  })

  it('dit si la marque suivra le thème ou gardera ses couleurs', () => {
    const dir = assetsWith({ 'Icone-LF.svg': ICON })

    expect(collectBrand(dir).notes.join(' ')).toContain('suit le thème')
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
