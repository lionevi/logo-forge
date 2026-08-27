/**
 * Préréglages livrés avec le plugin.
 *
 * Chaque préréglage couvre un besoin réel de studio : livraison client
 * complète, kit web léger, dossier d'impression, ou export réseaux sociaux.
 */

import type { ExportConfig, Preset } from './types'
import { DEFAULT_NAMING } from './types'

export const PRESETS: Preset[] = [
  {
    id: 'brand-delivery',
    label: 'Livraison client complète',
    description:
      'Toutes les variantes, toutes les déclinaisons, vecteur et matriciel, web et print.',
    config: {
      naming: {
        strategy: 'usage-format',
        namingCase: 'kebab',
        includeSize: true,
        includeColorSpace: true,
        packFolder: 'logo-pack',
      },
      variants: ['primary', 'horizontal', 'stacked', 'icon', 'wordmark'],
      colorModes: ['full-color', 'black', 'white', 'grayscale'],
      formats: ['ai', 'eps', 'pdf', 'svg', 'png', 'jpg'],
      sizes: [256, 512, 1024, 2048],
      usages: ['web', 'print'],
      background: '#ffffff',
      quality: 92,
    },
  },
  {
    id: 'web-kit',
    label: 'Kit web',
    description: "SVG et PNG transparents, RVB uniquement, tailles d'écran usuelles.",
    config: {
      naming: {
        strategy: 'format',
        namingCase: 'kebab',
        includeSize: true,
        includeColorSpace: false,
        packFolder: 'web',
      },
      variants: ['primary', 'horizontal', 'icon'],
      colorModes: ['full-color', 'white'],
      formats: ['svg', 'png', 'webp'],
      sizes: [64, 128, 256, 512],
      usages: ['web'],
      background: '#ffffff',
      quality: 90,
    },
  },
  {
    id: 'print-pack',
    label: "Dossier d'impression",
    description: 'Vecteurs CMJN pour imprimeur : AI, EPS et PDF, sans matriciel.',
    config: {
      naming: {
        strategy: 'variant',
        namingCase: 'kebab',
        includeSize: false,
        includeColorSpace: true,
        packFolder: 'print',
      },
      variants: ['primary', 'horizontal', 'stacked'],
      colorModes: ['full-color', 'black', 'white'],
      formats: ['ai', 'eps', 'pdf'],
      sizes: [],
      usages: ['print'],
      background: '#ffffff',
      quality: 100,
    },
  },
  {
    id: 'social',
    label: 'Réseaux sociaux',
    description:
      'Icônes carrées matricielles aux tailles attendues par les plateformes.',
    config: {
      naming: {
        strategy: 'flat',
        namingCase: 'kebab',
        includeSize: true,
        includeColorSpace: false,
        packFolder: 'social',
      },
      variants: ['icon'],
      colorModes: ['full-color', 'white'],
      formats: ['png', 'jpg'],
      sizes: [180, 400, 512, 1024],
      usages: ['web'],
      background: '#ffffff',
      quality: 88,
    },
  },
]

/** Configuration par défaut du panneau, dérivée du préréglage de livraison. */
export const DEFAULT_CONFIG: ExportConfig = applyPreset(
  PRESETS[0],
  DEFAULT_NAMING.brand,
)

/** Instancie une configuration complète à partir d'un préréglage et d'une marque. */
export function applyPreset(preset: Preset, brand: string): ExportConfig {
  return {
    ...preset.config,
    variants: [...preset.config.variants],
    colorModes: [...preset.config.colorModes],
    formats: [...preset.config.formats],
    sizes: [...preset.config.sizes],
    usages: [...preset.config.usages],
    naming: { ...preset.config.naming, brand },
  }
}

/** Retrouve un préréglage par identifiant. */
export function getPreset(id: string): Preset | undefined {
  return PRESETS.find((preset) => preset.id === id)
}
