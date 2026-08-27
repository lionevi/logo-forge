import { describe, expect, it } from 'vitest'

import {
  applyColorMode,
  clamp,
  cmykToRgb,
  colorSpaceForUsage,
  contrastRatio,
  describeColor,
  hexToRgb,
  isValidHex,
  pickReadableForeground,
  relativeLuminance,
  rgbToCmyk,
  rgbToHex,
  supportsColorSpace,
  supportsTransparency,
  toGrayscale,
  wcagLevel,
} from '../src/core/colorManager'

describe('clamp', () => {
  it("borne la valeur dans l'intervalle", () => {
    expect(clamp(5, 0, 10)).toBe(5)
    expect(clamp(-3, 0, 10)).toBe(0)
    expect(clamp(42, 0, 10)).toBe(10)
  })

  it('renvoie la borne basse pour NaN', () => {
    expect(clamp(Number.NaN, 2, 10)).toBe(2)
  })
})

describe('isValidHex', () => {
  it('accepte les notations 3 et 6 chiffres, avec ou sans dièse', () => {
    expect(isValidHex('#fff')).toBe(true)
    expect(isValidHex('abc123')).toBe(true)
    expect(isValidHex('#AABBCC')).toBe(true)
  })

  it('rejette les chaînes mal formées', () => {
    expect(isValidHex('#ff')).toBe(false)
    expect(isValidHex('#gggggg')).toBe(false)
    expect(isValidHex('rouge')).toBe(false)
    expect(isValidHex('')).toBe(false)
  })
})

describe('hexToRgb / rgbToHex', () => {
  it('développe la notation courte', () => {
    expect(hexToRgb('#f0a')).toEqual({ r: 255, g: 0, b: 170 })
  })

  it("fait l'aller-retour sans perte", () => {
    expect(rgbToHex(hexToRgb('#2680eb'))).toBe('#2680eb')
  })

  it('lève sur une couleur invalide', () => {
    expect(() => hexToRgb('#xyz')).toThrow(/invalide/i)
  })

  it('borne les composantes hors limites', () => {
    expect(rgbToHex({ r: 300, g: -20, b: 128 })).toBe('#ff0080')
  })
})

describe('rgbToCmyk / cmykToRgb', () => {
  it('convertit le noir pur', () => {
    expect(rgbToCmyk({ r: 0, g: 0, b: 0 })).toEqual({ c: 0, m: 0, y: 0, k: 100 })
  })

  it('convertit le blanc pur', () => {
    expect(rgbToCmyk({ r: 255, g: 255, b: 255 })).toEqual({
      c: 0,
      m: 0,
      y: 0,
      k: 0,
    })
  })

  it('convertit le rouge primaire', () => {
    expect(rgbToCmyk({ r: 255, g: 0, b: 0 })).toEqual({
      c: 0,
      m: 100,
      y: 100,
      k: 0,
    })
  })

  it("revient au RVB d'origine sur les primaires", () => {
    const source = { r: 0, g: 128, b: 255 }
    expect(cmykToRgb(rgbToCmyk(source))).toEqual(source)
  })
})

describe('contrastRatio et wcagLevel', () => {
  it('donne 21 pour noir sur blanc', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBe(21)
  })

  it('donne 1 pour deux couleurs identiques', () => {
    expect(contrastRatio('#2680eb', '#2680eb')).toBe(1)
  })

  it('est symétrique', () => {
    expect(contrastRatio('#123456', '#fedcba')).toBe(
      contrastRatio('#fedcba', '#123456'),
    )
  })

  it('classe les rapports selon les seuils WCAG', () => {
    expect(wcagLevel(21)).toBe('AAA')
    expect(wcagLevel(7)).toBe('AAA')
    expect(wcagLevel(4.5)).toBe('AA')
    expect(wcagLevel(3)).toBe('AA-large')
    expect(wcagLevel(2.9)).toBe('fail')
  })

  it('accepte indifféremment une chaîne ou un objet RVB', () => {
    expect(contrastRatio({ r: 0, g: 0, b: 0 }, '#ffffff')).toBe(21)
  })
})

describe('relativeLuminance', () => {
  it('vaut 0 pour le noir et 1 pour le blanc', () => {
    expect(relativeLuminance({ r: 0, g: 0, b: 0 })).toBe(0)
    expect(relativeLuminance({ r: 255, g: 255, b: 255 })).toBeCloseTo(1, 5)
  })
})

describe('pickReadableForeground', () => {
  it('choisit le noir sur un fond clair', () => {
    expect(pickReadableForeground('#ffffff')).toBe('#000000')
  })

  it('choisit le blanc sur un fond sombre', () => {
    expect(pickReadableForeground('#1d1d1d')).toBe('#ffffff')
  })

  it('respecte une liste de candidats personnalisée', () => {
    expect(pickReadableForeground('#ffffff', ['#767676', '#111111'])).toBe('#111111')
  })

  it("lève si aucun candidat n'est fourni", () => {
    expect(() => pickReadableForeground('#ffffff', [])).toThrow()
  })
})

describe('toGrayscale', () => {
  it('laisse le blanc et le noir inchangés', () => {
    expect(toGrayscale('#ffffff')).toBe('#ffffff')
    expect(toGrayscale('#000000')).toBe('#000000')
  })

  it('produit trois composantes égales', () => {
    const { r, g, b } = hexToRgb(toGrayscale('#2680eb'))
    expect(r).toBe(g)
    expect(g).toBe(b)
  })
})

describe('applyColorMode', () => {
  it('normalise la couleur en mode couleur', () => {
    expect(applyColorMode('#2680EB', 'full-color')).toBe('#2680eb')
  })

  it('force le noir, le blanc et la réserve', () => {
    expect(applyColorMode('#2680eb', 'black')).toBe('#000000')
    expect(applyColorMode('#2680eb', 'white')).toBe('#ffffff')
    expect(applyColorMode('#2680eb', 'knockout')).toBe('#ffffff')
  })

  it('désature en niveaux de gris', () => {
    expect(applyColorMode('#2680eb', 'grayscale')).toBe(toGrayscale('#2680eb'))
  })
})

describe('capacités par format', () => {
  it('associe chaque usage à son espace colorimétrique', () => {
    expect(colorSpaceForUsage('web')).toBe('rgb')
    expect(colorSpaceForUsage('print')).toBe('cmyk')
  })

  it('réserve la transparence aux formats qui la portent', () => {
    expect(supportsTransparency('png')).toBe(true)
    expect(supportsTransparency('svg')).toBe(true)
    expect(supportsTransparency('jpg')).toBe(false)
  })

  it('réserve le CMJN aux formats vectoriels imprimables', () => {
    expect(supportsColorSpace('pdf', 'cmyk')).toBe(true)
    expect(supportsColorSpace('ai', 'cmyk')).toBe(true)
    expect(supportsColorSpace('png', 'cmyk')).toBe(false)
    expect(supportsColorSpace('svg', 'cmyk')).toBe(false)
    expect(supportsColorSpace('png', 'rgb')).toBe(true)
  })
})

describe('describeColor', () => {
  it('rend les trois notations dans une seule ligne', () => {
    expect(describeColor('#ff0000')).toBe(
      'HEX #FF0000 · RVB 255 0 0 · CMJN 0 100 100 0',
    )
  })
})
