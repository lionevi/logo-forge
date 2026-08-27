import { describe, expect, it } from 'vitest'

import {
  LARGE_PACK_THRESHOLD,
  MAX_RASTER_SIZE,
  normalizeSizes,
  planExport,
  summarizePlan,
  validateConfig,
} from '../src/core/planner'
import { DEFAULT_CONFIG, PRESETS, applyPreset } from '../src/core/presets'
import type { ExportConfig } from '../src/core/types'

/** Configuration minimale et valide, servant de base aux variations. */
function baseConfig(overrides: Partial<ExportConfig> = {}): ExportConfig {
  return {
    naming: {
      brand: 'Ma Marque',
      strategy: 'usage-format',
      namingCase: 'kebab',
      includeSize: true,
      includeColorSpace: true,
      packFolder: 'logo-pack',
    },
    variants: ['primary'],
    colorModes: ['full-color'],
    formats: ['svg'],
    sizes: [512],
    usages: ['web'],
    background: '#ffffff',
    quality: 90,
    ...overrides,
  }
}

/** Codes des diagnostics d'un plan, pour des assertions lisibles. */
function codes(config: ExportConfig): string[] {
  return planExport(config).issues.map((issue) => issue.code)
}

describe('normalizeSizes', () => {
  it('trie, arrondit et déduplique', () => {
    expect(normalizeSizes([512, 256.4, 512, 128])).toEqual([128, 256, 512])
  })

  it('écarte les valeurs hors bornes', () => {
    expect(normalizeSizes([0, -10, MAX_RASTER_SIZE + 1, 64])).toEqual([64])
  })

  it('écarte les valeurs non finies', () => {
    expect(normalizeSizes([Number.NaN, Number.POSITIVE_INFINITY, 32])).toEqual([32])
  })
})

describe('validateConfig', () => {
  it('ne signale rien sur une configuration valide', () => {
    expect(validateConfig(baseConfig())).toEqual([])
  })

  it('exige un nom de marque', () => {
    const issues = validateConfig(
      baseConfig({ naming: { ...baseConfig().naming, brand: '  ' } }),
    )
    expect(issues.map((issue) => issue.code)).toContain('brand-required')
  })

  it('exige au moins une variante, une déclinaison, un format et un usage', () => {
    const issues = validateConfig(
      baseConfig({ variants: [], colorModes: [], formats: [], usages: [] }),
    )
    expect(issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining(['no-variant', 'no-color-mode', 'no-format', 'no-usage']),
    )
  })

  it('exige une taille quand un format matriciel est demandé', () => {
    const issues = validateConfig(baseConfig({ formats: ['png'], sizes: [] }))
    expect(issues.map((issue) => issue.code)).toContain('no-size')
  })

  it("n'exige aucune taille pour un pack purement vectoriel", () => {
    expect(validateConfig(baseConfig({ formats: ['svg', 'eps'], sizes: [] }))).toEqual(
      [],
    )
  })

  it('rejette une couleur de fond invalide', () => {
    const issues = validateConfig(baseConfig({ background: 'bleu' }))
    expect(issues.map((issue) => issue.code)).toContain('invalid-background')
  })

  it('rejette une qualité hors de 1-100', () => {
    expect(
      validateConfig(baseConfig({ quality: 0 })).map((issue) => issue.code),
    ).toContain('invalid-quality')
    expect(
      validateConfig(baseConfig({ quality: 101 })).map((issue) => issue.code),
    ).toContain('invalid-quality')
  })

  it('avertit quand des tailles ont été écartées', () => {
    const issues = validateConfig(
      baseConfig({ formats: ['png'], sizes: [512, 512, -1] }),
    )
    expect(issues.map((issue) => issue.code)).toContain('invalid-size-dropped')
  })
})

describe('planExport — produit cartésien', () => {
  it('produit un fichier par combinaison variante × déclinaison × format', () => {
    const plan = planExport(
      baseConfig({
        variants: ['primary', 'icon'],
        colorModes: ['full-color', 'black'],
        formats: ['svg', 'eps'],
        sizes: [],
      }),
    )
    expect(plan.totalFiles).toBe(2 * 2 * 2)
  })

  it('multiplie les formats matriciels par le nombre de tailles', () => {
    const plan = planExport(baseConfig({ formats: ['png'], sizes: [128, 256, 512] }))
    expect(plan.totalFiles).toBe(3)
    expect(plan.files.map((file) => file.size)).toEqual([128, 256, 512])
  })

  it('ne multiplie pas les formats vectoriels par les tailles', () => {
    const plan = planExport(baseConfig({ formats: ['svg'], sizes: [128, 256] }))
    expect(plan.totalFiles).toBe(1)
    expect(plan.files[0].size).toBeNull()
  })

  it('produit une sortie RVB et une CMJN pour un vectoriel bi-usage', () => {
    const plan = planExport(
      baseConfig({ formats: ['pdf'], usages: ['web', 'print'], sizes: [] }),
    )
    expect(plan.totalFiles).toBe(2)
    expect(plan.files.map((file) => file.colorSpace).sort()).toEqual(['cmyk', 'rgb'])
  })

  it("ne produit qu'une sortie RVB pour un format incapable de CMJN", () => {
    const plan = planExport(
      baseConfig({ formats: ['png'], usages: ['web', 'print'], sizes: [512] }),
    )
    expect(plan.totalFiles).toBe(1)
    expect(plan.files[0].colorSpace).toBe('rgb')
  })

  it('retombe sur du RVB quand seul le print est demandé pour un format web', () => {
    const plan = planExport(
      baseConfig({ formats: ['png'], usages: ['print'], sizes: [512] }),
    )
    expect(plan.totalFiles).toBe(1)
    expect(plan.files[0].colorSpace).toBe('rgb')
    expect(plan.files[0].usage).toBe('web')
  })
})

describe('planExport — métadonnées du plan', () => {
  it('marque la transparence selon le format et la déclinaison', () => {
    const plan = planExport(
      baseConfig({
        formats: ['png', 'jpg'],
        colorModes: ['full-color', 'knockout'],
        sizes: [512],
      }),
    )
    const byKey = new Map(
      plan.files.map((file) => [`${file.format}-${file.colorMode}`, file.transparent]),
    )
    expect(byKey.get('png-full-color')).toBe(true)
    expect(byKey.get('png-knockout')).toBe(false)
    expect(byKey.get('jpg-full-color')).toBe(false)
  })

  it('compte les fichiers par format et par variante', () => {
    const plan = planExport(
      baseConfig({
        variants: ['primary', 'icon'],
        formats: ['svg', 'png'],
        sizes: [256, 512],
      }),
    )
    expect(plan.countsByFormat).toEqual({ svg: 2, png: 4 })
    expect(plan.countsByVariant).toEqual({ primary: 3, icon: 3 })
  })

  it('liste les dossiers à créer, parents inclus', () => {
    const plan = planExport(baseConfig({ formats: ['svg'], sizes: [] }))
    expect(plan.directories).toEqual([
      'logo-pack',
      'logo-pack/Web',
      'logo-pack/Web/SVG',
    ])
  })

  it('ordonne les variantes et les déclinaisons de façon stable', () => {
    const plan = planExport(
      baseConfig({
        variants: ['wordmark', 'primary', 'icon'],
        colorModes: ['black', 'full-color'],
        formats: ['svg'],
        sizes: [],
      }),
    )
    expect(plan.files.map((file) => file.variant)).toEqual([
      'primary',
      'primary',
      'icon',
      'icon',
      'wordmark',
      'wordmark',
    ])
    expect(plan.files.slice(0, 2).map((file) => file.colorMode)).toEqual([
      'full-color',
      'black',
    ])
  })

  it('garantit des chemins uniques', () => {
    const plan = planExport(applyPreset(PRESETS[0], 'Ma Marque'))
    const paths = plan.files.map((file) => file.path)
    expect(new Set(paths).size).toBe(paths.length)
  })
})

describe('planExport — diagnostics', () => {
  it("renvoie un plan vide en présence d'une erreur bloquante", () => {
    const plan = planExport(baseConfig({ formats: [] }))
    expect(plan.totalFiles).toBe(0)
    expect(plan.files).toEqual([])
    expect(plan.directories).toEqual([])
    expect(plan.issues.some((issue) => issue.level === 'error')).toBe(true)
  })

  it("avertit d'un contraste insuffisant sur un format opaque", () => {
    expect(
      codes(
        baseConfig({
          formats: ['jpg'],
          colorModes: ['white'],
          background: '#ffffff',
          sizes: [512],
        }),
      ),
    ).toContain('low-contrast')
  })

  it("n'avertit pas quand le format porte la transparence", () => {
    expect(
      codes(
        baseConfig({
          formats: ['png'],
          colorModes: ['white'],
          background: '#ffffff',
          sizes: [512],
        }),
      ),
    ).not.toContain('low-contrast')
  })

  it("n'avertit pas quand le contraste est suffisant", () => {
    expect(
      codes(
        baseConfig({
          formats: ['jpg'],
          colorModes: ['black'],
          background: '#ffffff',
          sizes: [512],
        }),
      ),
    ).not.toContain('low-contrast')
  })

  it('avertit au-delà du seuil de pack volumineux', () => {
    const plan = planExport(
      baseConfig({
        variants: ['primary', 'horizontal', 'stacked', 'icon', 'wordmark'],
        colorModes: ['full-color', 'black', 'white', 'grayscale', 'knockout'],
        formats: ['png', 'jpg', 'webp'],
        sizes: [64, 128, 256, 512, 1024],
      }),
    )
    expect(plan.totalFiles).toBeGreaterThan(LARGE_PACK_THRESHOLD)
    expect(plan.issues.map((issue) => issue.code)).toContain('large-pack')
  })
})

describe('summarizePlan', () => {
  it('résume un plan non vide', () => {
    const plan = planExport(baseConfig({ formats: ['svg'], sizes: [] }))
    expect(summarizePlan(plan)).toBe('1 fichiers · 3 dossiers · 1 SVG')
  })

  it('signale un plan vide', () => {
    expect(summarizePlan(planExport(baseConfig({ formats: [] })))).toBe(
      'Aucun fichier à exporter.',
    )
  })
})

describe('préréglages', () => {
  it('produit un plan valide pour chaque préréglage livré', () => {
    for (const preset of PRESETS) {
      const plan = planExport(applyPreset(preset, 'Ma Marque'))
      expect(plan.issues.filter((issue) => issue.level === 'error')).toEqual([])
      expect(plan.totalFiles).toBeGreaterThan(0)
    }
  })

  it('conserve le nom de marque en changeant de préréglage', () => {
    expect(applyPreset(PRESETS[1], 'Atelier Nord').naming.brand).toBe('Atelier Nord')
  })

  it('ne partage aucun tableau avec le préréglage source', () => {
    const config = applyPreset(PRESETS[0], 'Ma Marque')
    config.formats.push('webp')
    expect(PRESETS[0].config.formats).not.toContain('webp')
  })

  it('fournit une configuration par défaut exploitable', () => {
    expect(planExport(DEFAULT_CONFIG).totalFiles).toBeGreaterThan(0)
  })
})
