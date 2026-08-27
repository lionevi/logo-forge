/**
 * Gestion des gamuts colorimétriques et du contraste WCAG.
 *
 * Zéro dépendance : toutes les conversions sont implémentées ici afin que le
 * cœur métier reste testable en Node et embarquable dans un bundle UXP.
 */

import type { ColorMode, ColorSpace, FileFormat, Usage } from './types'
import { TRANSPARENT_FORMATS } from './types'

export interface Rgb {
  /** Rouge, 0-255. */
  r: number
  /** Vert, 0-255. */
  g: number
  /** Bleu, 0-255. */
  b: number
}

export interface Cmyk {
  /** Cyan, 0-100. */
  c: number
  /** Magenta, 0-100. */
  m: number
  /** Jaune, 0-100. */
  y: number
  /** Noir, 0-100. */
  k: number
}

const HEX_PATTERN = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i

/** Borne une valeur dans l'intervalle `[min, max]`. */
export function clamp(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) return min
  return Math.min(max, Math.max(min, value))
}

/** Indique si une chaîne est une couleur hexadécimale à 3 ou 6 chiffres. */
export function isValidHex(hex: string): boolean {
  return HEX_PATTERN.test(hex.trim())
}

/**
 * Convertit `#rgb` ou `#rrggbb` en composantes RVB.
 * @throws {Error} si la chaîne n'est pas une couleur hexadécimale valide.
 */
export function hexToRgb(hex: string): Rgb {
  const match = HEX_PATTERN.exec(hex.trim())
  if (!match) throw new Error(`Couleur hexadécimale invalide : ${hex}`)

  let digits = match[1]
  if (digits.length === 3) {
    digits = digits
      .split('')
      .map((d) => d + d)
      .join('')
  }

  return {
    r: parseInt(digits.slice(0, 2), 16),
    g: parseInt(digits.slice(2, 4), 16),
    b: parseInt(digits.slice(4, 6), 16),
  }
}

/** Convertit des composantes RVB en `#rrggbb` minuscule. */
export function rgbToHex({ r, g, b }: Rgb): string {
  const part = (value: number) =>
    Math.round(clamp(value, 0, 255))
      .toString(16)
      .padStart(2, '0')
  return `#${part(r)}${part(g)}${part(b)}`
}

/**
 * Convertit RVB en CMJN par la formule de séparation naïve.
 *
 * Cette conversion ignore délibérément les profils ICC : elle sert à prévisualiser
 * et à documenter le pack, pas à produire la séparation finale, qu'Illustrator
 * réalise avec le profil du document.
 */
export function rgbToCmyk({ r, g, b }: Rgb): Cmyk {
  const rn = clamp(r, 0, 255) / 255
  const gn = clamp(g, 0, 255) / 255
  const bn = clamp(b, 0, 255) / 255

  const k = 1 - Math.max(rn, gn, bn)
  if (k === 1) return { c: 0, m: 0, y: 0, k: 100 }

  const round = (value: number) => Math.round(value * 1000) / 10
  return {
    c: round((1 - rn - k) / (1 - k)),
    m: round((1 - gn - k) / (1 - k)),
    y: round((1 - bn - k) / (1 - k)),
    k: round(k),
  }
}

/** Convertit CMJN en RVB, réciproque de {@link rgbToCmyk}. */
export function cmykToRgb({ c, m, y, k }: Cmyk): Rgb {
  const cn = clamp(c, 0, 100) / 100
  const mn = clamp(m, 0, 100) / 100
  const yn = clamp(y, 0, 100) / 100
  const kn = clamp(k, 0, 100) / 100

  return {
    r: Math.round(255 * (1 - cn) * (1 - kn)),
    g: Math.round(255 * (1 - mn) * (1 - kn)),
    b: Math.round(255 * (1 - yn) * (1 - kn)),
  }
}

/** Luminance relative d'une couleur, selon WCAG 2.1 (§ relative luminance). */
export function relativeLuminance({ r, g, b }: Rgb): number {
  const channel = (value: number) => {
    const v = clamp(value, 0, 255) / 255
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
}

/**
 * Rapport de contraste entre deux couleurs, de 1 (identiques) à 21
 * (noir sur blanc), selon WCAG 2.1.
 */
export function contrastRatio(a: string | Rgb, b: string | Rgb): number {
  const rgbA = typeof a === 'string' ? hexToRgb(a) : a
  const rgbB = typeof b === 'string' ? hexToRgb(b) : b

  const lumA = relativeLuminance(rgbA)
  const lumB = relativeLuminance(rgbB)
  const lighter = Math.max(lumA, lumB)
  const darker = Math.min(lumA, lumB)

  return Math.round(((lighter + 0.05) / (darker + 0.05)) * 100) / 100
}

/** Niveau WCAG atteint par un rapport de contraste, pour du texte normal. */
export function wcagLevel(ratio: number): 'AAA' | 'AA' | 'AA-large' | 'fail' {
  if (ratio >= 7) return 'AAA'
  if (ratio >= 4.5) return 'AA'
  if (ratio >= 3) return 'AA-large'
  return 'fail'
}

/**
 * Choisit, entre plusieurs couleurs candidates, celle qui contraste le mieux
 * avec le fond donné. Utilisé pour décider si un logo doit être posé en version
 * noire ou blanche sur un fond donné.
 */
export function pickReadableForeground(
  background: string,
  candidates: string[] = ['#000000', '#ffffff'],
): string {
  if (candidates.length === 0) {
    throw new Error('pickReadableForeground exige au moins une couleur candidate')
  }

  let best = candidates[0]
  let bestRatio = -1
  for (const candidate of candidates) {
    const ratio = contrastRatio(background, candidate)
    if (ratio > bestRatio) {
      best = candidate
      bestRatio = ratio
    }
  }
  return best
}

/** Convertit une couleur en niveau de gris par sa luminance perçue. */
export function toGrayscale(hex: string): string {
  const { r, g, b } = hexToRgb(hex)
  const level = Math.round(0.299 * r + 0.587 * g + 0.114 * b)
  return rgbToHex({ r: level, g: level, b: level })
}

/**
 * Applique une déclinaison chromatique à une couleur source.
 *
 * `knockout` produit du blanc : la marque est détourée pour être posée sur un
 * aplat de couleur.
 */
export function applyColorMode(hex: string, mode: ColorMode): string {
  switch (mode) {
    case 'full-color':
      return rgbToHex(hexToRgb(hex))
    case 'black':
      return '#000000'
    case 'white':
    case 'knockout':
      return '#ffffff'
    case 'grayscale':
      return toGrayscale(hex)
  }
}

/**
 * Espace colorimétrique attendu pour un usage donné.
 * Le print part en CMJN, le web en RVB.
 */
export function colorSpaceForUsage(usage: Usage): ColorSpace {
  return usage === 'print' ? 'cmyk' : 'rgb'
}

/** Indique si un format sait porter un canal alpha. */
export function supportsTransparency(format: FileFormat): boolean {
  return TRANSPARENT_FORMATS.includes(format)
}

/**
 * Indique si le couple format/espace colorimétrique est produisible.
 * Les formats web (PNG, JPEG, WebP, SVG) n'ont pas de CMJN exploitable.
 */
export function supportsColorSpace(format: FileFormat, space: ColorSpace): boolean {
  if (space === 'rgb') return true
  return format === 'ai' || format === 'eps' || format === 'pdf'
}

/** Description lisible d'une couleur, pour la documentation du pack. */
export function describeColor(hex: string): string {
  const rgb = hexToRgb(hex)
  const cmyk = rgbToCmyk(rgb)
  return [
    `HEX ${rgbToHex(rgb).toUpperCase()}`,
    `RVB ${rgb.r} ${rgb.g} ${rgb.b}`,
    `CMJN ${cmyk.c} ${cmyk.m} ${cmyk.y} ${cmyk.k}`,
  ].join(' · ')
}
