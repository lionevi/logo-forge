import { describe, expect, it } from 'vitest'

import {
  applyCase,
  buildFileName,
  buildFilePath,
  buildFolderPath,
  collectDirectories,
  deduplicatePaths,
  joinPath,
  sanitizeSegment,
  slugify,
} from '../src/core/folderManager'
import type { NamingOptions } from '../src/core/types'
import { DEFAULT_NAMING } from '../src/core/types'

const naming: NamingOptions = { ...DEFAULT_NAMING, brand: 'Ma Marque' }

describe('slugify', () => {
  it('retire les accents et met en kebab-case', () => {
    expect(slugify('Éditions Créatives')).toBe('editions-creatives')
  })

  it('découpe le camelCase', () => {
    expect(slugify('LogoForgePro')).toBe('logo-forge-pro')
  })

  it('supprime les caractères interdits', () => {
    expect(slugify('A/B: test?')).toBe('a-b-test')
  })

  it('renvoie une chaîne vide pour une entrée sans lettre', () => {
    expect(slugify('   ///   ')).toBe('')
  })
})

describe('applyCase', () => {
  it('produit du kebab-case', () => {
    expect(applyCase(['Ma Marque', 'icone'], 'kebab')).toBe('ma-marque-icone')
  })

  it('produit du snake_case', () => {
    expect(applyCase(['Ma Marque', 'icone'], 'snake')).toBe('ma_marque_icone')
  })

  it('produit du PascalCase', () => {
    expect(applyCase(['ma marque', 'icone'], 'pascal')).toBe('MaMarqueIcone')
  })

  it('renvoie une chaîne vide sans mot exploitable', () => {
    expect(applyCase(['', '  '], 'kebab')).toBe('')
  })
})

describe('sanitizeSegment', () => {
  it('retire les caractères interdits par le système de fichiers', () => {
    expect(sanitizeSegment('logo<>:"|?*.ai')).toBe('logo.ai')
  })

  it('supprime les points et espaces de fin', () => {
    expect(sanitizeSegment('dossier...  ')).toBe('dossier')
  })

  it('préfixe les noms réservés par Windows', () => {
    expect(sanitizeSegment('CON')).toBe('_CON')
    expect(sanitizeSegment('lpt1')).toBe('_lpt1')
  })

  it('remplace un segment vide par une valeur sûre', () => {
    expect(sanitizeSegment('   ')).toBe('sans-nom')
  })
})

describe('joinPath', () => {
  it('ignore les segments vides et les doublons de séparateur', () => {
    expect(joinPath('a', '', 'b/', '/c')).toBe('a/b/c')
  })

  it('renvoie une chaîne vide sans segment utile', () => {
    expect(joinPath('', '  ')).toBe('')
  })
})

describe('buildFolderPath', () => {
  it('classe par usage puis par format', () => {
    expect(
      buildFolderPath('usage-format', {
        variant: 'primary',
        format: 'png',
        usage: 'web',
      }),
    ).toBe('Web/PNG')
  })

  it('classe par format seul', () => {
    expect(
      buildFolderPath('format', {
        variant: 'icon',
        format: 'svg',
        usage: 'web',
      }),
    ).toBe('SVG')
  })

  it('classe par variante puis format', () => {
    expect(
      buildFolderPath('variant', {
        variant: 'icon',
        format: 'eps',
        usage: 'print',
      }),
    ).toBe('Icone/EPS')
  })

  it('ne crée aucun dossier en mode plat', () => {
    expect(
      buildFolderPath('flat', {
        variant: 'primary',
        format: 'ai',
        usage: 'print',
      }),
    ).toBe('')
  })
})

describe('buildFileName', () => {
  it('compose marque, variante, déclinaison, taille et extension', () => {
    expect(
      buildFileName(
        {
          variant: 'primary',
          colorMode: 'full-color',
          format: 'png',
          colorSpace: 'rgb',
          size: 512,
        },
        naming,
      ),
    ).toBe('ma-marque-principal-couleur-512px.png')
  })

  it('omet la taille pour un format vectoriel', () => {
    expect(
      buildFileName(
        {
          variant: 'icon',
          colorMode: 'black',
          format: 'svg',
          colorSpace: 'rgb',
          size: null,
        },
        naming,
      ),
    ).toBe('ma-marque-icone-noir.svg')
  })

  it("suffixe l'espace colorimétrique hors RVB", () => {
    expect(
      buildFileName(
        {
          variant: 'primary',
          colorMode: 'full-color',
          format: 'eps',
          colorSpace: 'cmyk',
          size: null,
        },
        naming,
      ),
    ).toBe('ma-marque-principal-couleur-cmyk.eps')
  })

  it('respecte les options de nommage', () => {
    expect(
      buildFileName(
        {
          variant: 'wordmark',
          colorMode: 'white',
          format: 'png',
          colorSpace: 'rgb',
          size: 256,
        },
        { ...naming, namingCase: 'pascal', includeSize: false },
      ),
    ).toBe('MaMarqueTypographiqueBlanc.png')
  })

  it('retombe sur « logo » si la marque ne produit aucun mot', () => {
    expect(
      buildFileName(
        {
          variant: 'icon',
          colorMode: 'full-color',
          format: 'png',
          colorSpace: 'rgb',
          size: null,
        },
        { ...naming, brand: '///' },
      ),
    ).toBe('icone-couleur.png')
  })
})

describe('buildFilePath', () => {
  it('assemble dossier du pack, arborescence et nom de fichier', () => {
    const result = buildFilePath(
      {
        variant: 'primary',
        colorMode: 'full-color',
        format: 'png',
        colorSpace: 'rgb',
        usage: 'web',
        size: 1024,
      },
      naming,
    )

    expect(result.directory).toBe('logo-pack/Web/PNG')
    expect(result.fileName).toBe('ma-marque-principal-couleur-1024px.png')
    expect(result.path).toBe('logo-pack/Web/PNG/ma-marque-principal-couleur-1024px.png')
  })

  it('place le fichier à la racine du pack en mode plat', () => {
    const result = buildFilePath(
      {
        variant: 'icon',
        colorMode: 'black',
        format: 'svg',
        colorSpace: 'rgb',
        usage: 'web',
        size: null,
      },
      { ...naming, strategy: 'flat' },
    )

    expect(result.directory).toBe('logo-pack')
    expect(result.path).toBe('logo-pack/ma-marque-icone-noir.svg')
  })

  it('omet le dossier racine quand il est vide', () => {
    const result = buildFilePath(
      {
        variant: 'icon',
        colorMode: 'black',
        format: 'svg',
        colorSpace: 'rgb',
        usage: 'web',
        size: null,
      },
      { ...naming, strategy: 'flat', packFolder: '' },
    )

    expect(result.directory).toBe('')
    expect(result.path).toBe('ma-marque-icone-noir.svg')
  })
})

describe('collectDirectories', () => {
  it('remonte tous les parents sans doublon', () => {
    expect(
      collectDirectories([
        'pack/Web/PNG/a.png',
        'pack/Web/PNG/b.png',
        'pack/Print/EPS/c.eps',
      ]),
    ).toEqual(['pack', 'pack/Print', 'pack/Web', 'pack/Print/EPS', 'pack/Web/PNG'])
  })

  it("trie du parent vers l'enfant", () => {
    const directories = collectDirectories(['a/b/c/d.png'])
    expect(directories).toEqual(['a', 'a/b', 'a/b/c'])
  })

  it('ne renvoie rien pour un fichier à la racine', () => {
    expect(collectDirectories(['logo.png'])).toEqual([])
  })
})

describe('deduplicatePaths', () => {
  it('laisse intacts des chemins distincts', () => {
    const paths = ['a/x.png', 'a/y.png']
    expect(deduplicatePaths(paths)).toEqual(paths)
  })

  it('suffixe les doublons de façon incrémentale', () => {
    expect(deduplicatePaths(['a/x.png', 'a/x.png', 'a/x.png'])).toEqual([
      'a/x.png',
      'a/x-2.png',
      'a/x-3.png',
    ])
  })

  it('traite la collision insensible à la casse', () => {
    expect(deduplicatePaths(['a/Logo.png', 'a/logo.png'])).toEqual([
      'a/Logo.png',
      'a/logo-2.png',
    ])
  })

  it('gère un fichier sans extension', () => {
    expect(deduplicatePaths(['README', 'README'])).toEqual(['README', 'README-2'])
  })
})
