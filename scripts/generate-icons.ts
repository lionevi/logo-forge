/**
 * Génération des icônes du plugin.
 *
 * Le module `canvas` exige une compilation native, incompatible avec l'exigence
 * « zéro dépendance externe » et fragile en CI. Les PNG sont donc encodés ici à
 * la main, avec le seul `node:zlib` : signature, IHDR, IDAT et IEND, en RGBA
 * 8 bits. Les lettres sont tracées depuis une petite fonte bitmap 5x7, ce qui
 * évite tout besoin de rastérisation de police.
 *
 * Usage : `node scripts/generate-icons.ts` (enchaîné après `vite build`).
 */

import { deflateSync } from 'node:zlib'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

const ROOT = resolve(import.meta.dirname, '..')
const ICONS_DIR = join(ROOT, 'dist', 'icons')

/** Signature PNG, invariante (§5.2 de la spécification). */
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

/** Profondeur de 8 bits par canal, en RGBA (type couleur 6). */
const BIT_DEPTH = 8
const COLOR_TYPE_RGBA = 6

/** Couleur RGBA, chaque composante de 0 à 255. */
interface Rgba {
  r: number
  g: number
  b: number
  a: number
}

/** Table CRC-32, polynôme réfléchi 0xEDB88320, exigée par le format PNG. */
const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let i = 0; i < 256; i += 1) {
    let value = i
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
    }
    table[i] = value >>> 0
  }
  return table
})()

function crc32(data: Buffer): number {
  let crc = 0xffffffff
  for (const byte of data) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8)
  }
  return (crc ^ 0xffffffff) >>> 0
}

/**
 * Assemble un chunk PNG : longueur, type, données, CRC.
 * Le CRC porte sur le type *et* les données, jamais sur la longueur.
 */
function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length, 0)

  const typeAndData = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(typeAndData), 0)

  return Buffer.concat([length, typeAndData, crc])
}

/**
 * Encode un tampon de pixels RGBA en PNG.
 *
 * Chaque scanline est précédée d'un octet de filtre à 0 (aucun filtrage) :
 * sur des images de cette taille, le gain d'un filtre serait négligeable.
 */
function encodePng(width: number, height: number, pixels: Uint8Array): Buffer {
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0)
  header.writeUInt32BE(height, 4)
  header.writeUInt8(BIT_DEPTH, 8)
  header.writeUInt8(COLOR_TYPE_RGBA, 9)
  header.writeUInt8(0, 10) // Compression : deflate, seule valeur admise.
  header.writeUInt8(0, 11) // Méthode de filtrage : adaptative, seule admise.
  header.writeUInt8(0, 12) // Entrelacement : aucun.

  const stride = width * 4
  const raw = Buffer.alloc((stride + 1) * height)
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0 // Type de filtre de la scanline.
    Buffer.from(pixels.buffer, pixels.byteOffset + y * stride, stride).copy(
      raw,
      y * (stride + 1) + 1,
    )
  }

  return Buffer.concat([
    PNG_SIGNATURE,
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

/** Fonte bitmap 5x7, limitée aux deux lettres du monogramme. */
const GLYPH_WIDTH = 5
const GLYPH_HEIGHT = 7

const GLYPHS: Record<string, string[]> = {
  L: ['10000', '10000', '10000', '10000', '10000', '10000', '11111'],
  F: ['11111', '10000', '10000', '11110', '10000', '10000', '10000'],
}

/** Espace entre deux lettres, en pixels de la fonte. */
const GLYPH_GAP = 1

/** Largeur totale du monogramme dans l'espace de la fonte. */
function monogramWidth(text: string): number {
  return text.length * GLYPH_WIDTH + (text.length - 1) * GLYPH_GAP
}

interface IconSpec {
  /** Nom du fichier produit, dans `dist/icons/`. */
  name: string
  size: number
  background: Rgba
  foreground: Rgba
}

const TRANSPARENT: Rgba = { r: 0, g: 0, b: 0, a: 0 }
const WHITE: Rgba = { r: 255, g: 255, b: 255, a: 255 }
/** Gris Spectrum 800, lisible sur les thèmes clairs d'Illustrator. */
const DARK: Rgba = { r: 29, g: 29, b: 29, a: 255 }
/** Bleu Spectrum 500, couleur d'accent du panneau. */
const ACCENT: Rgba = { r: 38, g: 128, b: 235, a: 255 }

/**
 * Dessine le monogramme « LF » centré sur un fond uni ou transparent.
 *
 * L'échelle est dictée par la largeur : le monogramme étant plus large que haut,
 * c'est toujours la largeur qui sature en premier.
 */
function renderIcon(spec: IconSpec): Buffer {
  const { size, background, foreground } = spec
  const pixels = new Uint8Array(size * size * 4)

  for (let i = 0; i < size * size; i += 1) {
    pixels[i * 4] = background.r
    pixels[i * 4 + 1] = background.g
    pixels[i * 4 + 2] = background.b
    pixels[i * 4 + 3] = background.a
  }

  const text = 'LF'
  const scale = Math.max(1, Math.floor(size / monogramWidth(text)))
  const drawnWidth = monogramWidth(text) * scale
  const drawnHeight = GLYPH_HEIGHT * scale
  const originX = Math.floor((size - drawnWidth) / 2)
  const originY = Math.floor((size - drawnHeight) / 2)

  text.split('').forEach((character, index) => {
    const glyph = GLYPHS[character]
    if (!glyph) throw new Error(`Glyphe absent de la fonte bitmap : ${character}`)

    const offsetX = originX + index * (GLYPH_WIDTH + GLYPH_GAP) * scale

    for (let row = 0; row < GLYPH_HEIGHT; row += 1) {
      for (let column = 0; column < GLYPH_WIDTH; column += 1) {
        if (glyph[row][column] !== '1') continue

        // Chaque pixel de la fonte devient un carré de `scale` côté.
        for (let dy = 0; dy < scale; dy += 1) {
          for (let dx = 0; dx < scale; dx += 1) {
            const x = offsetX + column * scale + dx
            const y = originY + row * scale + dy
            if (x < 0 || x >= size || y < 0 || y >= size) continue

            const offset = (y * size + x) * 4
            pixels[offset] = foreground.r
            pixels[offset + 1] = foreground.g
            pixels[offset + 2] = foreground.b
            pixels[offset + 3] = foreground.a
          }
        }
      }
    }
  })

  return encodePng(size, size, pixels)
}

/**
 * Icônes déclarées par `manifest.json`.
 *
 * Le manifest annonce `scale: [1, 2]` : UXP attend donc, pour chaque icône, la
 * variante nominale et sa version `@2x` pour les écrans à haute densité.
 */
const ICONS: IconSpec[] = [
  // Panneau, thèmes clairs : monogramme sombre sur fond blanc.
  { name: 'panel-light.png', size: 23, background: WHITE, foreground: DARK },
  { name: 'panel-light@2x.png', size: 46, background: WHITE, foreground: DARK },
  // Panneau, thèmes sombres : monogramme blanc sur fond transparent.
  { name: 'panel-dark.png', size: 23, background: TRANSPARENT, foreground: WHITE },
  { name: 'panel-dark@2x.png', size: 46, background: TRANSPARENT, foreground: WHITE },
  // Liste des plugins : pastille d'accent, visible sur tous les thèmes.
  { name: 'plugin.png', size: 48, background: ACCENT, foreground: WHITE },
  { name: 'plugin@2x.png', size: 96, background: ACCENT, foreground: WHITE },
]

function main(): void {
  mkdirSync(ICONS_DIR, { recursive: true })

  for (const spec of ICONS) {
    const png = renderIcon(spec)
    const target = join(ICONS_DIR, spec.name)
    writeFileSync(target, png)
    process.stdout.write(
      `${relative(ROOT, target)} — ${spec.size}x${spec.size}, ${png.length} octets\n`,
    )
  }
}

main()
