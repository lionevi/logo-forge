import { describe, expect, it } from 'vitest'

import {
  configForPreset,
  packageConfig,
  planPackage,
  sizesForPreset,
  validateSelection,
} from '../src/core/packagePlanner'
import { PRESETS, getPreset, resolvePresets } from '../src/core/presets'
import type { PackageSelection } from '../src/core/types'

function selection(overrides: Partial<PackageSelection> = {}): PackageSelection {
  return {
    presets: resolvePresets(['sources', 'web']),
    colorModes: ['full-color'],
    packageName: 'Ma Marque',
    artboardWidthPoints: 512,
    ...overrides,
  }
}

/** Codes des diagnostics d'un plan, pour des assertions lisibles. */
function codes(input: PackageSelection): string[] {
  return planPackage(input).issues.map((issue) => issue.code)
}

describe('catalogue de préréglages', () => {
  it('livre les huit préréglages attendus', () => {
    expect(PRESETS.map((preset) => preset.id)).toEqual([
      'sources',
      'web',
      'print',
      'social',
      'favicon',
      'office',
      'appIcons',
      'video',
    ])
  })

  it('donne à chacun un pictogramme, un libellé et un dossier', () => {
    for (const preset of PRESETS) {
      expect(preset.emoji.length, preset.id).toBeGreaterThan(0)
      expect(preset.label.length, preset.id).toBeGreaterThan(0)
      expect(preset.folder.length, preset.id).toBeGreaterThan(0)
      expect(preset.formats.length, preset.id).toBeGreaterThan(0)
    }
  })

  it('donne à chacun un dossier distinct', () => {
    const folders = PRESETS.map((preset) => preset.folder)
    expect(new Set(folders).size).toBe(folders.length)
  })

  it('retrouve un préréglage par identifiant', () => {
    expect(getPreset('favicon')?.label).toBe('Favicon')
    expect(getPreset('inconnu' as never)).toBeUndefined()
  })

  it("résout une liste d'identifiants dans l'ordre d'affichage", () => {
    expect(resolvePresets(['video', 'sources']).map((p) => p.id)).toEqual([
      'sources',
      'video',
    ])
  })
})

describe('sizesForPreset', () => {
  it('rend les tailles explicites telles quelles', () => {
    expect(sizesForPreset(getPreset('favicon')!, 512)).toEqual([
      16, 32, 48, 64, 180, 192, 512,
    ])
  })

  it("déduit la taille de la résolution quand aucune n'est donnée", () => {
    // 150 ppp sur un plan de 512 pt : 512 x 150 / 72 arrondi.
    expect(sizesForPreset(getPreset('office')!, 512)).toEqual([1067])
  })

  it('retombe sur la largeur supposée sans document ouvert', () => {
    expect(sizesForPreset(getPreset('office')!, 0)).toEqual([1067])
  })

  it('suit la largeur réelle du plan de travail', () => {
    expect(sizesForPreset(getPreset('office')!, 1024)).toEqual([2133])
  })
})

describe('configForPreset', () => {
  it('reprend formats, variantes et usage du préréglage', () => {
    const config = configForPreset(getPreset('print')!, ['black'], 'Marque', 512)

    expect(config.formats).toEqual(['pdf', 'eps'])
    expect(config.usages).toEqual(['print'])
    expect(config.colorModes).toEqual(['black'])
    expect(config.naming.packFolder).toBe('Impression')
  })

  it("n'attribue aucune taille à un lot purement vectoriel", () => {
    expect(
      configForPreset(getPreset('sources')!, ['full-color'], 'M', 512).sizes,
    ).toEqual([])
  })

  it('ne partage aucun tableau avec le préréglage source', () => {
    const config = configForPreset(getPreset('web')!, ['full-color'], 'M', 512)
    config.formats.push('jpg')

    expect(getPreset('web')!.formats).not.toContain('jpg')
  })
})

describe('validateSelection', () => {
  it('ne signale rien sur une sélection valide', () => {
    expect(validateSelection(selection())).toEqual([])
  })

  it('exige au moins un préréglage', () => {
    expect(codes(selection({ presets: [] }))).toContain('no-preset')
  })

  it('exige au moins une déclinaison', () => {
    expect(codes(selection({ colorModes: [] }))).toContain('no-color-scheme')
  })

  it('exige un nom de package', () => {
    expect(codes(selection({ packageName: '   ' }))).toContain('no-package-name')
  })
})

describe('planPackage', () => {
  it('réunit les lots sans les croiser', () => {
    const sources = planPackage(selection({ presets: resolvePresets(['sources']) }))
    const web = planPackage(selection({ presets: resolvePresets(['web']) }))
    const both = planPackage(selection())

    expect(both.totalFiles).toBe(sources.totalFiles + web.totalFiles)
  })

  it('range chaque lot dans son propre sous-dossier', () => {
    const plan = planPackage(selection())

    // Le dossier suit la convention de nommage kebab, comme les fichiers.
    expect(plan.files.some((file) => file.path.includes('/sources/'))).toBe(true)
    expect(plan.files.some((file) => file.path.includes('/web/'))).toBe(true)
  })

  it('préfixe tous les chemins par le nom du package', () => {
    const plan = planPackage(selection({ packageName: 'Atelier Nord' }))

    for (const file of plan.files) {
      expect(file.path.startsWith('atelier-nord/')).toBe(true)
    }
  })

  it('multiplie les fichiers par les déclinaisons cochées', () => {
    const one = planPackage(selection({ colorModes: ['full-color'] }))
    const three = planPackage(
      selection({ colorModes: ['full-color', 'black', 'white'] }),
    )

    expect(three.totalFiles).toBe(one.totalFiles * 3)
  })

  it('garantit des chemins uniques sur un pack complet', () => {
    const plan = planPackage(
      selection({
        presets: PRESETS,
        colorModes: ['full-color', 'black', 'white', 'grayscale'],
      }),
    )
    const paths = plan.files.map((file) => file.path)

    expect(paths.length).toBeGreaterThan(150)
    expect(new Set(paths).size).toBe(paths.length)
  })

  it("renvoie un plan vide en présence d'une erreur de sélection", () => {
    const plan = planPackage(selection({ presets: [] }))

    expect(plan.totalFiles).toBe(0)
    expect(plan.files).toEqual([])
    expect(plan.directories).toEqual([])
  })

  it("avertit des formats qu'Illustrator ne sait pas exporter", () => {
    const plan = planPackage(selection({ presets: resolvePresets(['favicon']) }))
    const warning = plan.issues.find((issue) => issue.code === 'format-not-exportable')

    expect(warning?.level).toBe('warning')
    expect(warning?.message).toContain('ICO')
  })

  it("n'avertit pas quand tous les formats sont exportables", () => {
    expect(codes(selection({ presets: resolvePresets(['print']) }))).not.toContain(
      'format-not-exportable',
    )
  })

  it('compte les fichiers par format et par variante', () => {
    const plan = planPackage(selection({ presets: resolvePresets(['sources']) }))

    // Cinq variantes, une déclinaison, un seul format vectoriel.
    expect(plan.countsByFormat).toEqual({ ai: 5 })
    expect(Object.keys(plan.countsByVariant)).toHaveLength(5)
  })

  it('liste les dossiers à créer, racine du pack comprise', () => {
    const plan = planPackage(selection({ presets: resolvePresets(['sources']) }))

    expect(plan.directories).toEqual([
      'ma-marque',
      'ma-marque/sources',
      'ma-marque/sources/AI',
    ])
  })

  it('produit un plan valide pour chaque préréglage pris isolément', () => {
    for (const preset of PRESETS) {
      const plan = planPackage(selection({ presets: [preset] }))
      expect(
        plan.issues.filter((i) => i.level === 'error'),
        preset.id,
      ).toEqual([])
      expect(plan.totalFiles, preset.id).toBeGreaterThan(0)
    }
  })
})

describe('packageConfig', () => {
  it('reprend les réglages globaux du premier préréglage actif', () => {
    expect(packageConfig(selection()).naming.brand).toBe('Ma Marque')
  })

  it('reste utilisable sur une sélection vide', () => {
    const config = packageConfig(
      selection({ presets: [], colorModes: [], packageName: '' }),
    )

    expect(config.colorModes).toEqual(['full-color'])
    expect(config.naming.brand).toBe('logo')
  })
})
