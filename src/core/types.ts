/**
 * Types partagés du cœur métier Logo Forge.
 *
 * Ce module ne dépend d'aucune API Illustrator ni UXP : il décrit uniquement
 * ce qu'est un pack de logo, comment il est nommé et comment il est exporté.
 * Cela permet de tester la totalité de la logique en Node, sans Illustrator.
 */

/** Variante structurelle d'un logo (la « forme » de la marque). */
export type LogoVariant = 'primary' | 'horizontal' | 'stacked' | 'icon' | 'wordmark'

export const LOGO_VARIANTS: readonly LogoVariant[] = [
  'primary',
  'horizontal',
  'stacked',
  'icon',
  'wordmark',
]

/** Déclinaison chromatique appliquée à une variante. */
export type ColorMode = 'full-color' | 'black' | 'white' | 'grayscale' | 'knockout'

export const COLOR_MODES: readonly ColorMode[] = [
  'full-color',
  'black',
  'white',
  'grayscale',
  'knockout',
]

/** Format de fichier exportable. */
export type FileFormat = 'ai' | 'eps' | 'pdf' | 'svg' | 'png' | 'jpg' | 'webp'

export const FILE_FORMATS: readonly FileFormat[] = [
  'ai',
  'eps',
  'pdf',
  'svg',
  'png',
  'jpg',
  'webp',
]

/** Formats matriciels : ils exigent une ou plusieurs tailles en pixels. */
export const RASTER_FORMATS: readonly FileFormat[] = ['png', 'jpg', 'webp']

/** Formats vectoriels : la notion de taille en pixels ne s'y applique pas. */
export const VECTOR_FORMATS: readonly FileFormat[] = ['ai', 'eps', 'pdf', 'svg']

/** Formats capables de porter un fond transparent. */
export const TRANSPARENT_FORMATS: readonly FileFormat[] = [
  'ai',
  'eps',
  'pdf',
  'svg',
  'png',
  'webp',
]

/** Espace colorimétrique du fichier produit. */
export type ColorSpace = 'rgb' | 'cmyk'

/** Destination d'usage, qui pilote l'espace colorimétrique par défaut. */
export type Usage = 'web' | 'print'

/** Stratégie d'organisation des dossiers du pack exporté. */
export type FolderStrategy =
  /** `Web/PNG/…` puis `Print/EPS/…` — le classement le plus courant. */
  | 'usage-format'
  /** `PNG/…`, `SVG/…` — un dossier par format. */
  | 'format'
  /** `Primary/…`, `Icon/…` — un dossier par variante. */
  | 'variant'
  /** Tous les fichiers à la racine du pack. */
  | 'flat'

export const FOLDER_STRATEGIES: readonly FolderStrategy[] = [
  'usage-format',
  'format',
  'variant',
  'flat',
]

/** Convention de nommage appliquée aux fichiers et dossiers. */
export type NamingCase = 'kebab' | 'snake' | 'pascal'

/** Réglages de nommage et d'arborescence. */
export interface NamingOptions {
  /** Nom de marque, source du préfixe de chaque fichier. */
  brand: string
  strategy: FolderStrategy
  namingCase: NamingCase
  /** Ajoute la taille en pixels au nom des fichiers matriciels. */
  includeSize: boolean
  /** Ajoute le suffixe d'espace colorimétrique (`-cmyk`) hors RVB. */
  includeColorSpace: boolean
  /** Dossier racine du pack, relatif au dossier choisi par l'utilisateur. */
  packFolder: string
}

export const DEFAULT_NAMING: NamingOptions = {
  brand: 'Ma Marque',
  strategy: 'usage-format',
  namingCase: 'kebab',
  includeSize: true,
  includeColorSpace: true,
  packFolder: 'logo-pack',
}

/** Configuration complète d'un export, telle que saisie dans le panneau. */
export interface ExportConfig {
  naming: NamingOptions
  variants: LogoVariant[]
  colorModes: ColorMode[]
  formats: FileFormat[]
  /** Tailles en pixels appliquées aux formats matriciels. */
  sizes: number[]
  /** Usages ciblés ; détermine les espaces colorimétriques produits. */
  usages: Usage[]
  /** Couleur de fond des formats sans transparence, au format `#rrggbb`. */
  background: string
  /** Qualité JPEG/WebP, de 1 à 100. */
  quality: number
}

/** Un fichier unique planifié, prêt à être écrit sur le disque. */
export interface PlannedFile {
  /** Chemin relatif complet, séparateurs `/`. */
  path: string
  /** Nom du fichier, extension comprise. */
  fileName: string
  /** Dossier relatif, sans le nom du fichier. */
  directory: string
  variant: LogoVariant
  colorMode: ColorMode
  format: FileFormat
  colorSpace: ColorSpace
  usage: Usage
  /** Côté le plus long en pixels, `null` pour les formats vectoriels. */
  size: number | null
  /** `true` si le fichier est produit avec un fond transparent. */
  transparent: boolean
}

/** Gravité d'un diagnostic émis par le planificateur. */
export type IssueLevel = 'error' | 'warning'

/** Diagnostic remonté à l'utilisateur avant lancement de l'export. */
export interface PlanIssue {
  level: IssueLevel
  /** Code stable, utilisable pour la traduction de l'interface. */
  code: string
  message: string
}

/** Résultat du calcul de pack : la liste exhaustive des fichiers à produire. */
export interface ExportPlan {
  files: PlannedFile[]
  issues: PlanIssue[]
  /** Nombre total de fichiers planifiés. */
  totalFiles: number
  /** Répartition du nombre de fichiers par format. */
  countsByFormat: Record<string, number>
  /** Répartition du nombre de fichiers par variante. */
  countsByVariant: Record<string, number>
  /** Dossiers à créer, triés, parents inclus. */
  directories: string[]
}

/** Écriture de fichiers, injectée pour découpler le moteur d'UXP. */
export interface FileWriter {
  /** Crée un dossier et tous ses parents ; idempotent. */
  ensureDirectory(path: string): Promise<void>
  /** Écrit un fichier, en écrasant une éventuelle version existante. */
  writeFile(path: string, data: Uint8Array | string): Promise<void>
}

/** Rendu d'un fichier planifié en octets, injecté depuis la couche Illustrator. */
export interface DocumentRenderer {
  render(file: PlannedFile): Promise<Uint8Array | string>
}

/** Avancement de l'export, transmis à l'interface. */
export interface ExportProgress {
  completed: number
  total: number
  /** Fichier qui vient d'être traité. */
  current: PlannedFile
}

/** Échec d'écriture d'un fichier donné. */
export interface ExportFailure {
  file: PlannedFile
  message: string
}

/** Bilan d'un export terminé, réussi, partiel ou annulé. */
export interface ExportResult {
  written: PlannedFile[]
  failures: ExportFailure[]
  /** `true` si l'export a été interrompu avant la fin. */
  cancelled: boolean
  /** Durée totale en millisecondes. */
  durationMs: number
}

/** Préréglage nommé, réutilisable d'un projet à l'autre. */
export interface Preset {
  id: string
  label: string
  description: string
  /** Réglages appliqués par-dessus la configuration courante. */
  config: Omit<ExportConfig, 'naming'> & { naming: Omit<NamingOptions, 'brand'> }
}
