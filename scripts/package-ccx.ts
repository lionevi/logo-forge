/**
 * Packaging du plugin au format `.ccx`.
 *
 * Un `.ccx` est une archive ZIP contenant le plugin construit, `manifest.json`
 * à la racine. L'archive est écrite ici à la main, à partir du seul `node:zlib`,
 * pour tenir l'exigence « zéro dépendance externe » : aucune bibliothèque de
 * compression n'est ajoutée au projet.
 *
 * Usage : `npm run package` (précédé du build), ou `tsx scripts/package-ccx.ts`.
 */

import { deflateRawSync } from 'node:zlib'
import { readFileSync, readdirSync, statSync, writeFileSync, mkdirSync } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'

const ROOT = resolve(import.meta.dirname, '..')
const DIST = join(ROOT, 'dist')
const BUILD = join(ROOT, 'build')

/** En-tête local ZIP. */
const SIGNATURE_LOCAL = 0x04034b50
/** En-tête d'entrée du répertoire central. */
const SIGNATURE_CENTRAL = 0x02014b50
/** Fin du répertoire central. */
const SIGNATURE_END = 0x06054b50
/** Méthode de compression « deflate ». */
const METHOD_DEFLATE = 8
/** Version minimale requise pour extraire (2.0). */
const VERSION_NEEDED = 20

/** Table CRC-32 précalculée, polynôme réfléchi standard (0xEDB88320). */
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

/** Calcule le CRC-32 d'un tampon, tel qu'exigé par le format ZIP. */
function crc32(data: Buffer): number {
  let crc = 0xffffffff
  for (const byte of data) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8)
  }
  return (crc ^ 0xffffffff) >>> 0
}

/** Convertit une date en couple (heure, date) au format MS-DOS. */
function toDosDateTime(date: Date): { time: number; date: number } {
  const time =
    (date.getHours() << 11) |
    (date.getMinutes() << 5) |
    (Math.floor(date.getSeconds() / 2) & 0x1f)
  const dosDate =
    ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()
  return { time, date: dosDate }
}

/** Parcourt récursivement un dossier et renvoie ses fichiers, chemins relatifs. */
function listFiles(directory: string, base = directory): string[] {
  const entries: string[] = []

  for (const name of readdirSync(directory).sort()) {
    const absolute = join(directory, name)
    if (statSync(absolute).isDirectory()) {
      entries.push(...listFiles(absolute, base))
    } else {
      // Le format ZIP impose `/` comme séparateur, y compris sous Windows.
      entries.push(relative(base, absolute).split(sep).join('/'))
    }
  }

  return entries
}

interface ZipEntry {
  name: string
  crc: number
  compressed: Buffer
  uncompressedSize: number
  offset: number
}

/** Construit une archive ZIP en mémoire à partir d'un dossier source. */
function buildZip(sourceDir: string, fileNames: string[]): Buffer {
  const chunks: Buffer[] = []
  const entries: ZipEntry[] = []
  const { time, date } = toDosDateTime(new Date())
  let offset = 0

  for (const name of fileNames) {
    const content = readFileSync(join(sourceDir, name))
    const compressed = deflateRawSync(content, { level: 9 })
    const nameBytes = Buffer.from(name, 'utf8')
    const crc = crc32(content)

    const header = Buffer.alloc(30)
    header.writeUInt32LE(SIGNATURE_LOCAL, 0)
    header.writeUInt16LE(VERSION_NEEDED, 4)
    header.writeUInt16LE(0, 6) // Indicateurs généraux.
    header.writeUInt16LE(METHOD_DEFLATE, 8)
    header.writeUInt16LE(time, 10)
    header.writeUInt16LE(date, 12)
    header.writeUInt32LE(crc, 14)
    header.writeUInt32LE(compressed.length, 18)
    header.writeUInt32LE(content.length, 22)
    header.writeUInt16LE(nameBytes.length, 26)
    header.writeUInt16LE(0, 28) // Longueur du champ « extra ».

    chunks.push(header, nameBytes, compressed)
    entries.push({
      name,
      crc,
      compressed,
      uncompressedSize: content.length,
      offset,
    })
    offset += header.length + nameBytes.length + compressed.length
  }

  const centralStart = offset
  for (const entry of entries) {
    const nameBytes = Buffer.from(entry.name, 'utf8')
    const record = Buffer.alloc(46)
    record.writeUInt32LE(SIGNATURE_CENTRAL, 0)
    record.writeUInt16LE(VERSION_NEEDED, 4) // Version d'écriture.
    record.writeUInt16LE(VERSION_NEEDED, 6) // Version requise.
    record.writeUInt16LE(0, 8)
    record.writeUInt16LE(METHOD_DEFLATE, 10)
    record.writeUInt16LE(time, 12)
    record.writeUInt16LE(date, 14)
    record.writeUInt32LE(entry.crc, 16)
    record.writeUInt32LE(entry.compressed.length, 20)
    record.writeUInt32LE(entry.uncompressedSize, 24)
    record.writeUInt16LE(nameBytes.length, 28)
    record.writeUInt16LE(0, 30) // Extra.
    record.writeUInt16LE(0, 32) // Commentaire.
    record.writeUInt16LE(0, 34) // Numéro de disque.
    record.writeUInt16LE(0, 36) // Attributs internes.
    record.writeUInt32LE(0, 38) // Attributs externes.
    record.writeUInt32LE(entry.offset, 42)

    chunks.push(record, nameBytes)
    offset += record.length + nameBytes.length
  }

  const end = Buffer.alloc(22)
  end.writeUInt32LE(SIGNATURE_END, 0)
  end.writeUInt16LE(0, 4) // Disque courant.
  end.writeUInt16LE(0, 6) // Disque du répertoire central.
  end.writeUInt16LE(entries.length, 8)
  end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(offset - centralStart, 12)
  end.writeUInt32LE(centralStart, 16)
  end.writeUInt16LE(0, 20) // Longueur du commentaire.
  chunks.push(end)

  return Buffer.concat(chunks)
}

function main(): void {
  const files = listFiles(DIST)

  if (files.length === 0) {
    throw new Error('dist/ est vide : lancez `npm run build` avant le packaging.')
  }
  if (!files.includes('manifest.json')) {
    throw new Error('manifest.json absent de dist/ : le plugin serait rejeté par UXP.')
  }

  const manifest = JSON.parse(readFileSync(join(DIST, 'manifest.json'), 'utf8')) as {
    id: string
    version: string
  }

  mkdirSync(BUILD, { recursive: true })
  const output = join(BUILD, `${manifest.id}-${manifest.version}.ccx`)
  const archive = buildZip(DIST, files)
  writeFileSync(output, archive)

  const kilobytes = (archive.length / 1024).toFixed(1)
  process.stdout.write(
    `${relative(ROOT, output)} — ${files.length} fichiers, ${kilobytes} Kio\n`,
  )
}

main()
