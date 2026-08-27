/**
 * Planificateur de pack multi-préréglages.
 *
 * Le planificateur de `planner.ts` calcule le plan d'*une* configuration. Ici,
 * on en calcule un par préréglage actif, puis on les réunit : un pack est
 * l'union de ses lots, jamais leur produit cartésien — sans quoi les tailles de
 * favicon se retrouveraient appliquées aux PDF d'imprimeur.
 */

import { collectDirectories, deduplicatePaths, slugify } from './folderManager'
import { planExport } from './planner'
import { ASSUMED_ARTBOARD_WIDTH } from './presets'
import type {
  ColorMode,
  ExportConfig,
  ExportPlan,
  ExportPreset,
  NamingOptions,
  PackageSelection,
  PlanIssue,
  PlannedFile,
} from './types'
import { RASTER_FORMATS, UNSUPPORTED_BY_ILLUSTRATOR } from './types'

/** Résolution de référence d'Illustrator : 1 pt = 1/72 pouce. */
const POINTS_PER_INCH = 72

/** Nommage commun à tous les préréglages. */
const BASE_NAMING: Omit<NamingOptions, 'brand' | 'packFolder'> = {
  strategy: 'format',
  namingCase: 'kebab',
  includeSize: true,
  includeColorSpace: false,
}

/**
 * Tailles en pixels d'un préréglage.
 *
 * Un préréglage sans taille explicite s'exprime en points par pouce : la taille
 * se déduit alors de la largeur du plan de travail. C'est ce qui permet à
 * « PNG 150 ppp » de produire réellement du 150 ppp, quelle que soit la taille
 * du logo.
 */
export function sizesForPreset(
  preset: ExportPreset,
  artboardWidthPoints: number,
): number[] {
  if (preset.sizes.length > 0) return preset.sizes

  const width = artboardWidthPoints > 0 ? artboardWidthPoints : ASSUMED_ARTBOARD_WIDTH
  return [Math.round((width * preset.resolution) / POINTS_PER_INCH)]
}

/** Construit la configuration d'un préréglage donné. */
export function configForPreset(
  preset: ExportPreset,
  colorModes: ColorMode[],
  packageName: string,
  artboardWidthPoints: number,
): ExportConfig {
  const needsSizes = preset.formats.some((format) => RASTER_FORMATS.includes(format))

  return {
    naming: {
      ...BASE_NAMING,
      brand: packageName,
      packFolder: preset.folder,
    },
    variants: [...preset.variants],
    colorModes: [...colorModes],
    formats: [...preset.formats],
    sizes: needsSizes ? sizesForPreset(preset, artboardWidthPoints) : [],
    usages: [preset.usage],
    background: '#ffffff',
    quality: 92,
  }
}

/** Préfixe un chemin relatif par le dossier racine du pack. */
function withRoot(root: string, path: string): string {
  return root.length > 0 ? `${root}/${path}` : path
}

/** Recalcule `directory` et `fileName` après un changement de chemin. */
function relocate(file: PlannedFile, path: string): PlannedFile {
  const lastSlash = path.lastIndexOf('/')
  return {
    ...file,
    path,
    directory: lastSlash === -1 ? '' : path.slice(0, lastSlash),
    fileName: lastSlash === -1 ? path : path.slice(lastSlash + 1),
  }
}

/**
 * Valide la sélection du panneau.
 *
 * Les deux règles d'interface — au moins un préréglage, au moins une
 * déclinaison — sont vérifiées ici plutôt que dans le composant, pour que le
 * message affiché et le refus d'export viennent de la même source.
 */
export function validateSelection(selection: PackageSelection): PlanIssue[] {
  const issues: PlanIssue[] = []

  if (selection.presets.length === 0) {
    issues.push({
      level: 'error',
      code: 'no-preset',
      message: 'Activez au moins un préréglage à exporter.',
    })
  }
  if (selection.colorModes.length === 0) {
    issues.push({
      level: 'error',
      code: 'no-color-scheme',
      message: 'Cochez au moins une déclinaison chromatique.',
    })
  }
  if (selection.packageName.trim().length === 0) {
    issues.push({
      level: 'error',
      code: 'no-package-name',
      message: 'Donnez un nom au package.',
    })
  }

  return issues
}

/**
 * Avertit des formats qu'Illustrator ne sait pas produire par script.
 *
 * Mieux vaut le dire avant l'export que de laisser l'utilisateur compter les
 * échecs après coup.
 */
function unsupportedFormatIssues(files: PlannedFile[]): PlanIssue[] {
  const present = new Set(
    files
      .map((file) => file.format)
      .filter((format) => UNSUPPORTED_BY_ILLUSTRATOR.includes(format)),
  )
  if (present.size === 0) return []

  const list = [...present].map((format) => format.toUpperCase()).join(', ')
  return [
    {
      level: 'warning',
      code: 'format-not-exportable',
      message:
        `Illustrator ne sait pas exporter ${list} par script : ces fichiers ` +
        'seront signalés en échec. Assemblez-les depuis les PNG produits.',
    },
  ]
}

/**
 * Calcule le plan complet d'un pack.
 *
 * En présence d'une erreur de sélection, le plan renvoyé est vide mais porte
 * les diagnostics : le panneau affiche alors ce qui manque.
 */
export function planPackage(selection: PackageSelection): ExportPlan {
  const issues = validateSelection(selection)
  if (issues.some((issue) => issue.level === 'error')) {
    return {
      files: [],
      issues,
      totalFiles: 0,
      countsByFormat: {},
      countsByVariant: {},
      directories: [],
    }
  }

  const root = slugify(selection.packageName)
  const collected: PlannedFile[] = []

  for (const preset of selection.presets) {
    const config = configForPreset(
      preset,
      selection.colorModes,
      selection.packageName,
      selection.artboardWidthPoints,
    )
    const plan = planExport(config)

    // Les erreurs propres à un préréglage sont des défauts de programmation :
    // les préréglages livrés sont valides par construction. On les remonte tout
    // de même plutôt que de produire un pack silencieusement incomplet.
    for (const issue of plan.issues) {
      if (issue.level === 'error') {
        issues.push({
          ...issue,
          message: `${preset.label} — ${issue.message}`,
        })
      }
    }

    for (const file of plan.files) {
      collected.push(relocate(file, withRoot(root, file.path)))
    }
  }

  const uniquePaths = deduplicatePaths(collected.map((file) => file.path))
  const files = collected.map((file, index) => relocate(file, uniquePaths[index]))

  const countsByFormat: Record<string, number> = {}
  const countsByVariant: Record<string, number> = {}
  for (const file of files) {
    countsByFormat[file.format] = (countsByFormat[file.format] ?? 0) + 1
    countsByVariant[file.variant] = (countsByVariant[file.variant] ?? 0) + 1
  }

  issues.push(...unsupportedFormatIssues(files))

  return {
    files,
    issues,
    totalFiles: files.length,
    countsByFormat,
    countsByVariant,
    directories: collectDirectories(files.map((file) => file.path)),
  }
}

/** Configuration représentative d'un pack, pour les réglages globaux de l'export. */
export function packageConfig(selection: PackageSelection): ExportConfig {
  const preset = selection.presets[0]
  if (!preset) {
    return configForPreset(
      {
        id: 'sources',
        emoji: '',
        label: '',
        summary: '',
        folder: '',
        formats: ['ai'],
        sizes: [],
        resolution: 72,
        usage: 'print',
        variants: ['primary'],
      },
      selection.colorModes.length > 0 ? selection.colorModes : ['full-color'],
      selection.packageName || 'logo',
      selection.artboardWidthPoints,
    )
  }
  return configForPreset(
    preset,
    selection.colorModes,
    selection.packageName,
    selection.artboardWidthPoints,
  )
}
