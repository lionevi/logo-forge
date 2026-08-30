/**
 * Sélecteur de couleur du panneau.
 *
 * `input[type=color]` ouvre, dans CEP, une fenêtre native qui n'y est pas
 * gréée : la pipette reste inerte et les champs RVB refusent la frappe. Le
 * sélecteur est donc dessiné dans le panneau. Ce fichier éprouve ses calculs
 * — extraits du panneau et exécutés tels quels — et son câblage.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const HTML = readFileSync(resolve(import.meta.dirname, '../src/panel-cep.html'), 'utf8')

const SCRIPT = [
  ...HTML.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g),
].map((match) => match[1])[0]

/**
 * Extrait une fonction du panneau et l'exécute.
 *
 * Recopier ces calculs dans l'épreuve n'aurait rien prouvé : c'est le code
 * livré qui doit être juste, pas une copie qui lui ressemble.
 */
function takeFunctions<T>(...names: string[]): T {
  const bodies = names.map((name) => {
    const start = SCRIPT.indexOf('function ' + name + '(')
    expect(start, name).toBeGreaterThan(-1)
    // La fonction s'arrête à la première accolade fermante en début de ligne
    // à son niveau d'indentation.
    const end = SCRIPT.indexOf('\n        }', start)
    return SCRIPT.slice(start, end + '\n        }'.length)
  })
  return new Function(
    bodies.join('\n') + '\nreturn { ' + names.join(', ') + ' }',
  )() as T
}

const { hsvToRgb, rgbToHsv, normalizeHex } = takeFunctions<{
  hsvToRgb: (h: number, s: number, v: number) => number[]
  rgbToHsv: (rgb: number[]) => { h: number; s: number; v: number }
  normalizeHex: (text: string) => string | null
}>('hsvToRgb', 'rgbToHsv', 'normalizeHex')

describe('conversion teinte / saturation / luminosité', () => {
  it('rend les six sommets du cercle chromatique', () => {
    expect(hsvToRgb(0, 1, 1)).toEqual([255, 0, 0])
    expect(hsvToRgb(60, 1, 1)).toEqual([255, 255, 0])
    expect(hsvToRgb(120, 1, 1)).toEqual([0, 255, 0])
    expect(hsvToRgb(180, 1, 1)).toEqual([0, 255, 255])
    expect(hsvToRgb(240, 1, 1)).toEqual([0, 0, 255])
    expect(hsvToRgb(300, 1, 1)).toEqual([255, 0, 255])
  })

  it('rend le noir et le blanc', () => {
    expect(hsvToRgb(210, 0.5, 0)).toEqual([0, 0, 0])
    expect(hsvToRgb(210, 0, 1)).toEqual([255, 255, 255])
  })

  it('accepte une teinte hors bornes, dans les deux sens', () => {
    expect(hsvToRgb(360, 1, 1)).toEqual([255, 0, 0])
    expect(hsvToRgb(-60, 1, 1)).toEqual([255, 0, 255])
    expect(hsvToRgb(420, 1, 1)).toEqual([255, 255, 0])
  })

  it('revient à la couleur de départ après un aller-retour', () => {
    for (const rgb of [
      [38, 128, 235],
      [255, 136, 0],
      [123, 97, 255],
      [29, 29, 29],
      [0, 168, 107],
    ]) {
      const hsv = rgbToHsv(rgb)
      expect(hsvToRgb(hsv.h, hsv.s, hsv.v)).toEqual(rgb)
    }
  })

  it('donne une saturation nulle à un gris', () => {
    expect(rgbToHsv([128, 128, 128]).s).toBe(0)
  })
})

describe('lecture d’une saisie hexadécimale', () => {
  it('accepte la forme longue, avec ou sans dièse', () => {
    expect(normalizeHex('#2680EB')).toBe('#2680eb')
    expect(normalizeHex('2680eb')).toBe('#2680eb')
  })

  it('développe la forme courte', () => {
    expect(normalizeHex('#f80')).toBe('#ff8800')
  })

  it('rend null tant que la saisie est incomplète', () => {
    // Repeindre à chaque frappe rendrait le champ intapable.
    expect(normalizeHex('#26')).toBeNull()
    expect(normalizeHex('')).toBeNull()
    expect(normalizeHex('#2680ebff')).toBeNull()
  })

  it('écarte ce qui n’est pas hexadécimal', () => {
    expect(normalizeHex('couleur')).toBeNull()
  })
})

describe('câblage dans le panneau', () => {
  it('ne laisse plus aucun champ couleur natif', () => {
    expect(HTML).not.toContain("type=\"color\"")
  })

  it('remplace chaque champ par une pastille', () => {
    for (const id of ['custom-hex', 'contrast-custom', 'social-background']) {
      expect(HTML).toContain('id="' + id + '"')
      expect(HTML).toMatch(
        new RegExp('class="swatch-field"[\\s\\S]{0,80}id="' + id + '"'),
      )
    }
  })

  it('garde l’équivalence « .value » attendue par le reste du panneau', () => {
    // Sans elle, chaque appelant serait à réécrire — et le prochain oublié
    // serait muet.
    expect(SCRIPT).toContain("Object.defineProperty(element, 'value'")
    expect(SCRIPT).toContain('function colorField(id, title)')
  })

  it('déclare les trois champs avant tout rendu', () => {
    const startup = SCRIPT.slice(SCRIPT.indexOf("startup('démarrage'"))

    expect(startup.indexOf("colorField('social-background'")).toBeLessThan(
      startup.indexOf('renderAll()'),
    )
  })

  it('offre le carré, la glissière, l’aperçu et les quatre champs', () => {
    for (const id of [
      'cp-area',
      'cp-hue',
      'cp-preview',
      'cp-hex',
      'cp-r',
      'cp-g',
      'cp-b',
    ]) {
      expect(HTML).toContain('id="' + id + '"')
    }
  })

  it('suit le glissement hors du carré', () => {
    // La souris sort du carré bien avant que le doigt ne se relève.
    expect(SCRIPT).toContain('document.onmousemove')
    expect(SCRIPT).toContain('document.onmouseup')
  })

  it('se règle aussi aux flèches', () => {
    expect(SCRIPT).toContain("byId('cp-area').onkeydown")
    expect(SCRIPT).toContain("byId('cp-hue').onkeydown")
  })

  it('n’applique rien tant que le designer n’a pas validé', () => {
    const cancel = SCRIPT.slice(
      SCRIPT.indexOf("byId('cp-cancel').onclick"),
      SCRIPT.indexOf("byId('cp-cancel').onclick") + 200,
    )

    expect(cancel).toContain('closeColorPicker()')
    expect(cancel).not.toContain('commit')
  })

  it('n’emprunte aucune librairie', () => {
    expect(HTML).not.toMatch(/<script[^>]+src="https?:/)
  })
})
