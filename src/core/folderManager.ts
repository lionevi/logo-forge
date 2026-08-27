/**
 * Construction des noms de fichiers et de l'arborescence du pack.
 *
 * Toutes les fonctions sont pures : elles n'écrivent rien sur le disque, elles
 * calculent uniquement des chemins relatifs, séparés par `/`.
 */

import type {
  ColorMode,
  ColorSpace,
  FileFormat,
  FolderStrategy,
  LogoVariant,
  NamingCase,
  NamingOptions,
  Usage,
} from './types'

/** Libellés de dossier lisibles, par variante. */
const VARIANT_FOLDER: Record<LogoVariant, string> = {
  primary: 'Principal',
  horizontal: 'Horizontal',
  stacked: 'Vertical',
  icon: 'Icone',
  wordmark: 'Typographique',
}

/** Segments de nom de fichier, par déclinaison chromatique. */
const COLOR_MODE_SLUG: Record<ColorMode, string> = {
  'full-color': 'couleur',
  black: 'noir',
  white: 'blanc',
  grayscale: 'niveaux-de-gris',
  knockout: 'reserve',
}

/** Segments de nom de fichier, par variante. */
const VARIANT_SLUG: Record<LogoVariant, string> = {
  primary: 'principal',
  horizontal: 'horizontal',
  stacked: 'vertical',
  icon: 'icone',
  wordmark: 'typographique',
}

/** Libellés de dossier lisibles, par usage. */
const USAGE_FOLDER: Record<Usage, string> = {
  web: 'Web',
  print: 'Print',
}

/**
 * Caractères interdits dans un nom de fichier sur Windows et macOS.
 * Ils sont convertis en séparateurs avant toute construction de chemin.
 */
const ILLEGAL_FILENAME_CHARS = /[<>:"/\\|?*]/g

/** Marques diacritiques combinantes, retirées par `stripDiacritics`. */
const COMBINING_MARKS = /[\u0300-\u036f]/g

/** Noms réservés par Windows, quelle que soit l'extension. */
const RESERVED_NAMES = new Set([
  'con',
  'prn',
  'aux',
  'nul',
  ...Array.from({ length: 9 }, (_, i) => `com${i + 1}`),
  ...Array.from({ length: 9 }, (_, i) => `lpt${i + 1}`),
])

/**
 * Retire les diacritiques d'une chaîne (« Élan » devient « Elan »).
 *
 * `normalize('NFD')` sépare chaque lettre de son accent, que la plage Unicode
 * des marques combinantes permet ensuite de supprimer.
 */
function stripDiacritics(input: string): string {
  return input.normalize('NFD').replace(COMBINING_MARKS, '')
}

/**
 * Découpe une chaîne en mots, en tenant compte du camelCase et des
 * séparateurs usuels.
 */
function toWords(input: string): string[] {
  return stripDiacritics(input)
    .replace(ILLEGAL_FILENAME_CHARS, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[\s._+-]+/)
    .map((word) => word.replace(/[^a-zA-Z0-9]/g, ''))
    .filter((word) => word.length > 0)
}

/** Transforme une chaîne en `kebab-case` sûr pour un système de fichiers. */
export function slugify(input: string): string {
  return toWords(input).join('-').toLowerCase()
}

/** Applique une convention de nommage à une liste de segments. */
export function applyCase(segments: string[], namingCase: NamingCase): string {
  const words = segments.flatMap((segment) => toWords(segment))
  if (words.length === 0) return ''

  switch (namingCase) {
    case 'kebab':
      return words.join('-').toLowerCase()
    case 'snake':
      return words.join('_').toLowerCase()
    case 'pascal':
      return words
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
        .join('')
  }
}

/**
 * Rend un segment de chemin sûr : caractères illégaux retirés, points et
 * espaces de fin supprimés, noms réservés Windows préfixés.
 */
export function sanitizeSegment(segment: string): string {
  const cleaned = segment
    .replace(ILLEGAL_FILENAME_CHARS, '')
    .replace(/[.\s]+$/g, '')
    .trim()

  if (cleaned.length === 0) return 'sans-nom'
  if (RESERVED_NAMES.has(cleaned.toLowerCase())) return `_${cleaned}`
  return cleaned
}

/** Assemble des segments en chemin relatif, en ignorant les segments vides. */
export function joinPath(...segments: string[]): string {
  return segments
    .flatMap((segment) => segment.split('/'))
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0)
    .join('/')
}

/**
 * Calcule le dossier relatif d'un fichier selon la stratégie retenue.
 * Le dossier racine du pack n'est pas inclus : {@link buildFilePath} l'ajoute.
 */
export function buildFolderPath(
  strategy: FolderStrategy,
  descriptor: { variant: LogoVariant; format: FileFormat; usage: Usage },
): string {
  const { variant, format, usage } = descriptor

  switch (strategy) {
    case 'usage-format':
      return joinPath(USAGE_FOLDER[usage], format.toUpperCase())
    case 'format':
      return format.toUpperCase()
    case 'variant':
      return joinPath(VARIANT_FOLDER[variant], format.toUpperCase())
    case 'flat':
      return ''
  }
}

/** Descripteur minimal nécessaire pour nommer un fichier. */
export interface FileNameDescriptor {
  variant: LogoVariant
  colorMode: ColorMode
  format: FileFormat
  colorSpace: ColorSpace
  /** Côté le plus long en pixels, `null` pour un format vectoriel. */
  size: number | null
}

/**
 * Construit le nom d'un fichier, extension comprise.
 *
 * Exemple : `ma-marque-principal-couleur-512px.png`
 */
export function buildFileName(
  descriptor: FileNameDescriptor,
  options: NamingOptions,
): string {
  const segments: string[] = [
    options.brand,
    VARIANT_SLUG[descriptor.variant],
    COLOR_MODE_SLUG[descriptor.colorMode],
  ]

  if (options.includeSize && descriptor.size !== null) {
    segments.push(`${descriptor.size}px`)
  }
  if (options.includeColorSpace && descriptor.colorSpace !== 'rgb') {
    segments.push(descriptor.colorSpace)
  }

  const stem = applyCase(segments, options.namingCase) || 'logo'
  return `${sanitizeSegment(stem)}.${descriptor.format}`
}

/** Construit le chemin relatif complet d'un fichier, dossier du pack inclus. */
export function buildFilePath(
  descriptor: FileNameDescriptor & { usage: Usage },
  options: NamingOptions,
): { directory: string; fileName: string; path: string } {
  const packFolder = options.packFolder
    ? sanitizeSegment(applyCase([options.packFolder], options.namingCase))
    : ''

  const folder = buildFolderPath(options.strategy, {
    variant: descriptor.variant,
    format: descriptor.format,
    usage: descriptor.usage,
  })

  const directory = joinPath(
    packFolder,
    ...folder.split('/').filter(Boolean).map(sanitizeSegment),
  )
  const fileName = buildFileName(descriptor, options)

  return { directory, fileName, path: joinPath(directory, fileName) }
}

/**
 * Renvoie tous les dossiers à créer pour une liste de chemins de fichiers,
 * parents inclus et sans doublon, triés du plus court au plus long pour que la
 * création soit possible dans l'ordre.
 */
export function collectDirectories(paths: string[]): string[] {
  const directories = new Set<string>()

  for (const path of paths) {
    const segments = path.split('/').filter(Boolean)
    // Le dernier segment est le nom du fichier : il n'est pas un dossier.
    for (let i = 1; i < segments.length; i += 1) {
      directories.add(segments.slice(0, i).join('/'))
    }
  }

  return [...directories].sort(
    (a, b) => a.split('/').length - b.split('/').length || a.localeCompare(b),
  )
}

/**
 * Rend une liste de chemins unique en suffixant les doublons (`-2`, `-3`, …).
 * Deux fichiers ne peuvent ainsi jamais s'écraser silencieusement dans un pack.
 */
export function deduplicatePaths(paths: string[]): string[] {
  const seen = new Map<string, number>()

  return paths.map((path) => {
    const key = path.toLowerCase()
    const count = seen.get(key) ?? 0
    seen.set(key, count + 1)
    if (count === 0) return path

    const lastSlash = path.lastIndexOf('/')
    const directory = lastSlash === -1 ? '' : path.slice(0, lastSlash)
    const fileName = lastSlash === -1 ? path : path.slice(lastSlash + 1)
    const dot = fileName.lastIndexOf('.')
    const stem = dot === -1 ? fileName : fileName.slice(0, dot)
    const extension = dot === -1 ? '' : fileName.slice(dot)

    return joinPath(directory, `${stem}-${count + 1}${extension}`)
  })
}
