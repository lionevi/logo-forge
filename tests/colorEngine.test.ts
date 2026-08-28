/**
 * Moteur couleurs de la chaîne CEP.
 *
 * Ce que le panneau prévisualise et ce que la couche ExtendScript applique
 * doivent sortir du même calcul : ces cas fixent ce calcul. Le contraste, lui,
 * décide si une déclinaison est livrable — un logo blanc sur fond blanc est un
 * fichier parfaitement valide et parfaitement inutile.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const ENGINE_SOURCE = readFileSync(
  resolve(import.meta.dirname, '../src/js/export-engine.js'),
  'utf8',
)

type EngineFn = (...args: unknown[]) => unknown

function loadEngine(): Record<string, EngineFn> {
  const holder = { exports: {} as Record<string, EngineFn> }
  const factory = new Function('module', 'window', 'setTimeout', ENGINE_SOURCE)
  factory(holder, globalThis, setTimeout)
  return holder.exports
}

const engine = loadEngine()

const hexToRgb = engine.hexToRgb as (hex: string) => number[] | null
const rgbToHex = engine.rgbToHex as (rgb: number[]) => string
const contrastRatio = engine.contrastRatio as (a: string, b: string) => number
const contrastVerdict = engine.contrastVerdict as (ratio: number) => string
const inkColor = engine.inkColor as (
  scheme: Record<string, unknown>,
  source: string,
  threshold?: number,
) => string
const formatColorMap = engine.formatColorMap as (
  map: Array<{ from: string; to: string }>,
) => string
const parseColorMap = engine.parseColorMap as (
  text: string,
) => Array<{ from: string; to: string }>
const checkContrast = engine.checkContrast as (
  scheme: Record<string, unknown>,
  samples: string[],
  threshold?: number,
  backgrounds?: Array<{ id: string; label: string; hex: string }>,
) => {
  results: Array<{ background: { id: string }; ratio: number; verdict: string }>
  worst: { verdict: string; ratio: number }
}

describe('lecture des couleurs', () => {
  it('décompose et recompose une couleur', () => {
    expect(hexToRgb('#2680eb')).toEqual([38, 128, 235])
    expect(rgbToHex([38, 128, 235])).toBe('#2680eb')
  })

  it('accepte une couleur sans dièse', () => {
    expect(hexToRgb('ffffff')).toEqual([255, 255, 255])
  })

  it('refuse une couleur illisible plutôt que d’en inventer une', () => {
    for (const value of ['#12345', 'bleu', '', '#12345g']) {
      expect(hexToRgb(value), value).toBeNull()
    }
  })

  it('borne les composantes hors plage', () => {
    expect(rgbToHex([-40, 300, 12.6])).toBe('#00ff0d')
  })
})

describe('déclinaisons', () => {
  const source = '#2680eb'

  it('laisse la pleine couleur intacte', () => {
    expect(inkColor({ id: 'fullColor' }, source)).toBe(source)
  })

  it('aplatit en noir et en blanc', () => {
    expect(inkColor({ id: 'black' }, source)).toBe('#000000')
    expect(inkColor({ id: 'white' }, source)).toBe('#ffffff')
  })

  it('convertit en gris de même luminance', () => {
    const gray = inkColor({ id: 'grayscale' }, source)
    const rgb = hexToRgb(gray)!
    expect(rgb[0]).toBe(rgb[1])
    expect(rgb[1]).toBe(rgb[2])
  })

  it('rend une couleur illisible telle quelle', () => {
    expect(inkColor({ id: 'black' }, 'bleu')).toBe('bleu')
  })

  describe('inversion', () => {
    it('ne bascule rien à seuil nul', () => {
      expect(inkColor({ id: 'inverted' }, '#101010', 0)).toBe('#101010')
    })

    it('bascule tout à seuil maximal', () => {
      expect(inkColor({ id: 'inverted' }, '#101010', 100)).toBe('#efefef')
    })

    it('ne bascule que ce qui est plus sombre que le seuil', () => {
      // Seuil 50 % : la limite de luminance est 127,5.
      expect(inkColor({ id: 'inverted' }, '#000000', 50)).toBe('#ffffff')
      expect(inkColor({ id: 'inverted' }, '#ffffff', 50)).toBe('#ffffff')
    })

    it('traite un seuil absent comme une inversion complète', () => {
      expect(inkColor({ id: 'inverted' }, '#404040')).toBe('#bfbfbf')
    })
  })

  describe('couleur personnalisée', () => {
    it('applique la couleur unique quand aucune table ne la couvre', () => {
      expect(inkColor({ id: 'custom', hex: '#ff0000' }, source)).toBe('#ff0000')
    })

    it('préfère la correspondance déclarée à la couleur unique', () => {
      const scheme = {
        id: 'custom',
        hex: '#ff0000',
        map: [{ from: '#2680eb', to: '#00aa55' }],
      }
      expect(inkColor(scheme, source)).toBe('#00aa55')
    })

    it('ignore la casse de la couleur source', () => {
      const scheme = {
        id: 'custom',
        hex: '#ff0000',
        map: [{ from: '#2680EB', to: '#00aa55' }],
      }
      expect(inkColor(scheme, '#2680eb')).toBe('#00aa55')
    })

    it('retombe sur la couleur unique hors correspondance', () => {
      const scheme = {
        id: 'custom',
        hex: '#ff0000',
        map: [{ from: '#000000', to: '#00aa55' }],
      }
      expect(inkColor(scheme, source)).toBe('#ff0000')
    })
  })
})

describe('table de correspondance', () => {
  it('fait un aller-retour sans perte', () => {
    const map = [
      { from: '#112233', to: '#445566' },
      { from: '#aabbcc', to: '#ddeeff' },
    ]
    expect(parseColorMap(formatColorMap(map))).toEqual(map)
  })

  it('écarte les paires illisibles plutôt que de les transporter', () => {
    expect(formatColorMap([{ from: 'bleu', to: '#445566' }])).toBe('')
    expect(parseColorMap('#112233>rouge;#aabbcc>#ddeeff')).toEqual([
      { from: '#aabbcc', to: '#ddeeff' },
    ])
  })

  it('tolère une table vide', () => {
    expect(formatColorMap([])).toBe('')
    expect(parseColorMap('')).toEqual([])
    expect(parseColorMap(undefined as unknown as string)).toEqual([])
  })
})

describe('contraste', () => {
  it('mesure les extrêmes connus', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 5)
    expect(contrastRatio('#ffffff', '#ffffff')).toBeCloseTo(1, 5)
  })

  it('est symétrique', () => {
    expect(contrastRatio('#2680eb', '#ffffff')).toBeCloseTo(
      contrastRatio('#ffffff', '#2680eb'),
      10,
    )
  })

  it('vaut zéro sur une couleur illisible, sans lever', () => {
    expect(contrastRatio('bleu', '#ffffff')).toBe(0)
  })

  it('classe selon le seuil des objets graphiques', () => {
    expect(contrastVerdict(21)).toBe('good')
    expect(contrastVerdict(3)).toBe('good')
    expect(contrastVerdict(2)).toBe('warning')
    expect(contrastVerdict(1.2)).toBe('critical')
  })
})

describe('contrôle avant export', () => {
  const samples = ['#2680eb', '#1d1d1d']

  it('juge chaque fond de contrôle', () => {
    const report = checkContrast({ id: 'fullColor' }, samples)

    expect(report.results.map((entry) => entry.background.id)).toEqual([
      'white',
      'black',
      'gray',
    ])
  })

  it("retient l'encre la plus contrastée sur un fond donné", () => {
    // Un logo bleu et blanc reste visible sur fond blanc : c'est le bleu qui
    // décide, pas la réserve blanche.
    const report = checkContrast({ id: 'fullColor' }, ['#ffffff', '#2680eb'])
    const white = report.results.find((entry) => entry.background.id === 'white')!

    expect(white.ratio).toBeCloseTo(contrastRatio('#2680eb', '#ffffff'), 10)
    expect(white.verdict).toBe('good')
  })

  it('retient le pire fond, celui qui décide', () => {
    const report = checkContrast({ id: 'fullColor' }, samples)
    const lowest = Math.min(...report.results.map((entry) => entry.ratio))

    expect(report.worst.ratio).toBeCloseTo(lowest, 10)
  })

  it('condamne un logo blanc sur fond blanc', () => {
    const report = checkContrast({ id: 'white' }, samples)
    const white = report.results.find((entry) => entry.background.id === 'white')!

    expect(white.verdict).toBe('critical')
    expect(report.worst.verdict).toBe('critical')
  })

  it('valide un logo noir sur fond blanc', () => {
    const report = checkContrast({ id: 'black' }, samples)
    const white = report.results.find((entry) => entry.background.id === 'white')!

    expect(white.verdict).toBe('good')
  })

  it('mesure la déclinaison, pas la couleur source', () => {
    // En blanc, la source bleue n'a plus aucune influence sur le verdict.
    const blue = checkContrast({ id: 'white' }, ['#2680eb'])
    const dark = checkContrast({ id: 'white' }, ['#000000'])

    expect(blue.worst.ratio).toBeCloseTo(dark.worst.ratio, 10)
  })

  it('accepte un fond personnalisé', () => {
    const report = checkContrast({ id: 'black' }, samples, 100, [
      { id: 'brand', label: 'Fond marque', hex: '#101010' },
    ])

    expect(report.results).toHaveLength(1)
    expect(report.results[0].verdict).toBe('critical')
  })

  it('tient compte du seuil d’inversion', () => {
    const none = checkContrast({ id: 'inverted' }, ['#101010'], 0)
    const full = checkContrast({ id: 'inverted' }, ['#101010'], 100)

    // À seuil nul l'encre reste sombre, à seuil plein elle devient claire :
    // le verdict sur fond blanc doit donc s'inverser.
    const dark = none.results.find((e) => e.background.id === 'white')!
    const light = full.results.find((e) => e.background.id === 'white')!
    expect(dark.verdict).toBe('good')
    expect(light.verdict).toBe('critical')
  })
})
