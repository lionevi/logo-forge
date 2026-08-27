/**
 * Préréglages livrés avec le plugin.
 *
 * Ils sont **combinables** : l'utilisateur en active autant qu'il veut, et le
 * pack final est leur union. Chacun décrit un lot de livrables cohérent, avec
 * son propre sous-dossier, ses formats et ses tailles.
 */

import type { ExportPreset, PresetId } from './types'

/**
 * Largeur de plan de travail supposée quand aucun document n'est ouvert, en
 * points. Elle ne sert qu'à donner un aperçu des tailles dans le panneau :
 * l'export réel lit toujours la largeur du document actif.
 */
export const ASSUMED_ARTBOARD_WIDTH = 512

export const PRESETS: ExportPreset[] = [
  {
    id: 'sources',
    emoji: '📦',
    label: 'Sources',
    summary: 'AI natif',
    folder: 'Sources',
    formats: ['ai'],
    sizes: [],
    resolution: 72,
    usage: 'print',
    variants: ['primary', 'horizontal', 'stacked', 'icon', 'wordmark'],
  },
  {
    id: 'web',
    emoji: '🌐',
    label: 'Web',
    summary: 'SVG + PNG 72 ppp',
    folder: 'Web',
    formats: ['svg', 'png'],
    sizes: [],
    resolution: 72,
    usage: 'web',
    variants: ['primary', 'horizontal', 'icon'],
  },
  {
    id: 'print',
    emoji: '🖨️',
    label: 'Impression',
    summary: 'PDF + EPS 300 ppp',
    folder: 'Impression',
    formats: ['pdf', 'eps'],
    sizes: [],
    resolution: 300,
    usage: 'print',
    variants: ['primary', 'horizontal', 'stacked'],
  },
  {
    id: 'social',
    emoji: '📱',
    label: 'Social',
    summary: 'PNG par plateforme',
    folder: 'Social',
    // Tailles carrées attendues par les principales plateformes.
    formats: ['png'],
    sizes: [400, 800, 1080, 1200],
    resolution: 72,
    usage: 'web',
    variants: ['icon', 'horizontal'],
  },
  {
    id: 'favicon',
    emoji: '⭐',
    label: 'Favicon',
    summary: 'ICO + PNG multi-tailles',
    folder: 'Favicon',
    formats: ['ico', 'png'],
    sizes: [16, 32, 48, 64, 180, 192, 512],
    resolution: 72,
    usage: 'web',
    variants: ['icon'],
  },
  {
    id: 'office',
    emoji: '📄',
    label: 'Bureautique',
    summary: 'PNG 150 ppp',
    folder: 'Bureautique',
    formats: ['png'],
    sizes: [],
    resolution: 150,
    usage: 'print',
    variants: ['primary', 'horizontal'],
  },
  {
    id: 'appIcons',
    emoji: '📲',
    label: 'Icônes App',
    summary: 'PNG multi-tailles',
    folder: 'Icones-App',
    // Tailles iOS et Android usuelles.
    formats: ['png'],
    sizes: [60, 87, 120, 180, 512, 1024],
    resolution: 72,
    usage: 'web',
    variants: ['icon'],
  },
  {
    id: 'video',
    emoji: '🎬',
    label: 'Vidéo',
    summary: 'PNG 1920 × 1080',
    folder: 'Video',
    formats: ['png'],
    sizes: [1920],
    resolution: 72,
    usage: 'web',
    variants: ['primary', 'horizontal'],
  },
]

/** Préréglages actifs à l'ouverture du panneau. */
export const DEFAULT_PRESET_IDS: readonly PresetId[] = ['sources', 'web']

const BY_ID = new Map(PRESETS.map((preset) => [preset.id, preset]))

/** Retrouve un préréglage par identifiant. */
export function getPreset(id: PresetId): ExportPreset | undefined {
  return BY_ID.get(id)
}

/** Renvoie les préréglages correspondant aux identifiants donnés, dans l'ordre d'affichage. */
export function resolvePresets(ids: readonly PresetId[]): ExportPreset[] {
  const selected = new Set(ids)
  return PRESETS.filter((preset) => selected.has(preset.id))
}
