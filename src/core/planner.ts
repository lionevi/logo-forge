/**
 * Planificateur de pack.
 *
 * Le planificateur transforme une configuration d'export en liste exhaustive de
 * fichiers, *avant* toute écriture. C'est lui qui garantit qu'un export est
 * prévisible : l'utilisateur voit le pack complet, avec ses avertissements,
 * avant de lancer quoi que ce soit.
 */

import {
  colorSpaceForUsage,
  contrastRatio,
  isValidHex,
  supportsColorSpace,
  supportsTransparency,
  wcagLevel,
} from './colorManager'
import { buildFilePath, collectDirectories, deduplicatePaths } from './folderManager'
import type {
  ColorMode,
  ExportConfig,
  ExportPlan,
  FileFormat,
  LogoVariant,
  PlanIssue,
  PlannedFile,
  Usage,
} from './types'
import { RASTER_FORMATS } from './types'

/** Nombre de fichiers au-delà duquel l'export est signalé comme volumineux. */
export const LARGE_PACK_THRESHOLD = 250

/** Taille matricielle maximale acceptée, en pixels. */
export const MAX_RASTER_SIZE = 8192

/** Ordre d'affichage stable des variantes dans le pack. */
const VARIANT_ORDER: Record<LogoVariant, number> = {
  primary: 0,
  horizontal: 1,
  stacked: 2,
  icon: 3,
  wordmark: 4,
}

/** Ordre d'affichage stable des déclinaisons chromatiques. */
const COLOR_MODE_ORDER: Record<ColorMode, number> = {
  'full-color': 0,
  black: 1,
  white: 2,
  grayscale: 3,
  knockout: 4,
}

/** Indique si un format est matriciel et exige donc une taille en pixels. */
function isRaster(format: FileFormat): boolean {
  return RASTER_FORMATS.includes(format)
}

/**
 * Normalise les tailles : entiers positifs uniques, bornés et triés.
 * Les valeurs invalides sont écartées ; l'appelant en est averti séparément.
 */
export function normalizeSizes(sizes: number[]): number[] {
  const valid = sizes
    .map((size) => Math.round(size))
    .filter((size) => Number.isFinite(size) && size > 0 && size <= MAX_RASTER_SIZE)

  return [...new Set(valid)].sort((a, b) => a - b)
}

/**
 * Valide une configuration et renvoie les problèmes détectés.
 *
 * Un problème `error` bloque l'export ; un `warning` est informatif.
 */
export function validateConfig(config: ExportConfig): PlanIssue[] {
  const issues: PlanIssue[] = []

  if (config.naming.brand.trim().length === 0) {
    issues.push({
      level: 'error',
      code: 'brand-required',
      message: 'Le nom de la marque est requis pour nommer les fichiers.',
    })
  }
  if (config.variants.length === 0) {
    issues.push({
      level: 'error',
      code: 'no-variant',
      message: 'Sélectionnez au moins une variante de logo.',
    })
  }
  if (config.colorModes.length === 0) {
    issues.push({
      level: 'error',
      code: 'no-color-mode',
      message: 'Sélectionnez au moins une déclinaison chromatique.',
    })
  }
  if (config.formats.length === 0) {
    issues.push({
      level: 'error',
      code: 'no-format',
      message: 'Sélectionnez au moins un format de fichier.',
    })
  }
  if (config.usages.length === 0) {
    issues.push({
      level: 'error',
      code: 'no-usage',
      message: 'Sélectionnez au moins un usage (web ou print).',
    })
  }

  const rasterSelected = config.formats.some(isRaster)
  const sizes = normalizeSizes(config.sizes)
  if (rasterSelected && sizes.length === 0) {
    issues.push({
      level: 'error',
      code: 'no-size',
      message:
        'Les formats matriciels (PNG, JPEG, WebP) exigent au moins une taille valide.',
    })
  }
  if (sizes.length < config.sizes.length) {
    issues.push({
      level: 'warning',
      code: 'invalid-size-dropped',
      message: `Tailles ignorées car hors de l'intervalle 1-${MAX_RASTER_SIZE} px ou en double.`,
    })
  }

  if (!isValidHex(config.background)) {
    issues.push({
      level: 'error',
      code: 'invalid-background',
      message: `Couleur de fond invalide : ${config.background}`,
    })
  }
  if (config.quality < 1 || config.quality > 100) {
    issues.push({
      level: 'error',
      code: 'invalid-quality',
      message: 'La qualité doit être comprise entre 1 et 100.',
    })
  }

  return issues
}

/**
 * Signale les combinaisons qui produiraient un fichier illisible : logo blanc
 * aplati sur fond blanc, logo noir sur fond noir, etc.
 *
 * Le contrôle ne porte que sur les formats sans transparence, seuls cas où le
 * fond est réellement aplati dans le fichier.
 */
function contrastIssues(config: ExportConfig): PlanIssue[] {
  const issues: PlanIssue[] = []
  if (!isValidHex(config.background)) return issues

  const opaqueFormats = config.formats.filter((format) => !supportsTransparency(format))
  if (opaqueFormats.length === 0) return issues

  for (const mode of config.colorModes) {
    if (mode !== 'black' && mode !== 'white') continue

    const inkColor = mode === 'black' ? '#000000' : '#ffffff'
    const ratio = contrastRatio(config.background, inkColor)
    if (wcagLevel(ratio) === 'fail') {
      issues.push({
        level: 'warning',
        code: 'low-contrast',
        message:
          `La déclinaison « ${mode} » sur le fond ${config.background} a un contraste de ` +
          `${ratio}:1, sous le seuil WCAG AA de 4.5:1. Les fichiers ` +
          `${opaqueFormats.join(', ').toUpperCase()} seront peu lisibles.`,
      })
    }
  }

  return issues
}

/**
 * Espaces colorimétriques à produire pour un format donné.
 *
 * Un format vectoriel print sort en CMJN ; un format web sort en RVB. Si les
 * deux usages sont demandés mais que le format ne sait pas porter le CMJN, une
 * seule sortie RVB est produite plutôt qu'un doublon inutile.
 */
function usagesForFormat(format: FileFormat, usages: Usage[]): Usage[] {
  const supported = usages.filter((usage) =>
    supportsColorSpace(format, colorSpaceForUsage(usage)),
  )
  // Un format incapable de porter le CMJN retombe sur une unique sortie RVB.
  return supported.length > 0 ? supported : ['web']
}

/**
 * Calcule le pack complet correspondant à une configuration.
 *
 * En présence d'une erreur bloquante, le plan renvoyé est vide mais les
 * diagnostics sont conservés : l'interface affiche alors ce qui manque.
 */
export function planExport(config: ExportConfig): ExportPlan {
  const issues = [...validateConfig(config), ...contrastIssues(config)]
  const blocking = issues.some((issue) => issue.level === 'error')

  if (blocking) {
    return {
      files: [],
      issues,
      totalFiles: 0,
      countsByFormat: {},
      countsByVariant: {},
      directories: [],
    }
  }

  const sizes = normalizeSizes(config.sizes)
  const variants = [...config.variants].sort(
    (a, b) => VARIANT_ORDER[a] - VARIANT_ORDER[b],
  )
  const colorModes = [...config.colorModes].sort(
    (a, b) => COLOR_MODE_ORDER[a] - COLOR_MODE_ORDER[b],
  )

  const draft: Omit<PlannedFile, 'path' | 'fileName' | 'directory'>[] = []

  for (const variant of variants) {
    for (const format of config.formats) {
      const formatUsages = usagesForFormat(format, config.usages)
      for (const usage of formatUsages) {
        const colorSpace = colorSpaceForUsage(usage)
        for (const colorMode of colorModes) {
          const applicableSizes = isRaster(format) ? sizes : [null]
          for (const size of applicableSizes) {
            draft.push({
              variant,
              colorMode,
              format,
              colorSpace,
              usage,
              size,
              transparent: supportsTransparency(format) && colorMode !== 'knockout',
            })
          }
        }
      }
    }
  }

  const rawPaths = draft.map((entry) => buildFilePath(entry, config.naming).path)
  const uniquePaths = deduplicatePaths(rawPaths)

  const files: PlannedFile[] = draft.map((entry, index) => {
    const path = uniquePaths[index]
    const lastSlash = path.lastIndexOf('/')
    return {
      ...entry,
      path,
      directory: lastSlash === -1 ? '' : path.slice(0, lastSlash),
      fileName: lastSlash === -1 ? path : path.slice(lastSlash + 1),
    }
  })

  const countsByFormat: Record<string, number> = {}
  const countsByVariant: Record<string, number> = {}
  for (const file of files) {
    countsByFormat[file.format] = (countsByFormat[file.format] ?? 0) + 1
    countsByVariant[file.variant] = (countsByVariant[file.variant] ?? 0) + 1
  }

  if (files.length > LARGE_PACK_THRESHOLD) {
    issues.push({
      level: 'warning',
      code: 'large-pack',
      message:
        `${files.length} fichiers seront produits. L'export peut prendre ` +
        'plusieurs minutes et immobiliser Illustrator.',
    })
  }

  return {
    files,
    issues,
    totalFiles: files.length,
    countsByFormat,
    countsByVariant,
    directories: collectDirectories(files.map((file) => file.path)),
  }
}

/** Résumé lisible d'un plan, affiché dans le panneau avant export. */
export function summarizePlan(plan: ExportPlan): string {
  if (plan.totalFiles === 0) return 'Aucun fichier à exporter.'

  const formats = Object.entries(plan.countsByFormat)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([format, count]) => `${count} ${format.toUpperCase()}`)
    .join(' · ')

  const folders = plan.directories.length
  return `${plan.totalFiles} fichiers · ${folders} dossiers · ${formats}`
}
