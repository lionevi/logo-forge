/**
 * Documentation destinée au client.
 *
 * Le destinataire n'est pas designer : il ne sait pas ce qu'est un vectoriel,
 * il sait qu'il doit envoyer un logo à un imprimeur. Ces cas vérifient que la
 * documentation décrit le pack réellement livré, dans sa langue, sans jargon
 * imposé.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const ENGINE_SOURCE = readFileSync(
  resolve(import.meta.dirname, '../src/js/export-engine.js'),
  'utf8',
)

type EngineFn = (...args: never[]) => never

function loadEngine(): Record<string, EngineFn> {
  const holder = { exports: {} as Record<string, EngineFn> }
  const factory = new Function('module', 'window', 'setTimeout', ENGINE_SOURCE)
  factory(holder, globalThis, setTimeout)
  return holder.exports
}

const engine = loadEngine()

interface Document {
  path: string
  contents: string
}

const build = (
  config: Record<string, unknown>,
  result: Record<string, unknown>,
): Document[] =>
  (engine.buildDocumentation as unknown as (c: unknown, r: unknown) => Document[])(
    config,
    result,
  )

/** Fichier livré, tel que le moteur d'export le décrit. */
function file(format: string, folder: string, fileName: string) {
  return {
    format,
    folder,
    fileName,
    component: { name: 'Logo' },
    scheme: { id: 'fullColor' },
    status: 'success',
    bytes: 2048,
  }
}

const written = [
  file('ai', 'Pour_Impression/Logo/FullColor', 'Acme_Logo_FullColor.ai'),
  file('pdf', 'Pour_Impression/Logo/FullColor', 'Acme_Logo_FullColor.pdf'),
  file('svg', 'Pour_Web/Logo/FullColor', 'Acme_Logo_FullColor.svg'),
  file('png', 'Pour_Web/Logo/FullColor', 'Acme_Logo_FullColor_900px.png'),
]

const baseConfig = { clientName: 'Acme', brandName: 'Nova' }

describe('composition du dossier', () => {
  it('produit un document balisé et sa version texte', () => {
    const documents = build(baseConfig, { written })

    expect(documents).toHaveLength(2)
    expect(documents[0].path).toBe('Documentation/LISEZ-MOI.md')
    expect(documents[1].path).toBe('Documentation/GUIDE_DES_FICHIERS.txt')
  })

  it('dépouille la version texte de son balisage', () => {
    const [, plain] = build(baseConfig, { written })

    expect(plain.contents).not.toContain('##')
    expect(plain.contents).not.toContain('**')
    expect(plain.contents).not.toContain('`')
    expect(plain.contents).toContain('Votre logo')
  })

  it("suit le modèle d'arborescence retenu", () => {
    const documents = build({ ...baseConfig, folderTemplate: 'agency' }, { written })

    expect(documents[0].path).toBe('04_Documentation/LISEZ-MOI.md')
  })
})

describe('contenu', () => {
  it('décrit les dossiers réellement écrits', () => {
    const [readme] = build(baseConfig, { written })

    expect(readme.contents).toContain('Pour_Impression/Logo/FullColor')
    expect(readme.contents).toContain('Pour_Web/Logo/FullColor')
  })

  it('recommande un fichier précis pour chaque usage', () => {
    const [readme] = build(baseConfig, { written })

    expect(readme.contents).toContain('Acme_Logo_FullColor.pdf')
    expect(readme.contents).toContain('Acme_Logo_FullColor.svg')
    expect(readme.contents).toContain('Acme_Logo_FullColor.ai')
  })

  it("annonce l'absence plutôt que de recommander un fichier inexistant", () => {
    const [readme] = build(baseConfig, {
      written: [file('png', 'Pour_Web/Logo', 'logo.png')],
    })

    expect(readme.contents).toContain('Aucun fichier de ce type')
  })

  it("n'explique que les formats présents dans le pack", () => {
    const [readme] = build(baseConfig, {
      written: [file('svg', 'Pour_Web/Logo', 'logo.svg')],
    })

    expect(readme.contents).toContain('**SVG**')
    expect(readme.contents).not.toContain('**EPS**')
  })

  it('explique la transparence et les déclinaisons', () => {
    const [readme] = build(baseConfig, { written })

    expect(readme.contents).toContain('fond transparent')
    expect(readme.contents).toContain('version noire')
  })

  it('compte les fichiers livrés', () => {
    const [readme] = build(baseConfig, { written })

    expect(readme.contents).toContain('4 fichiers')
  })

  it('évite le jargon technique dans les recommandations', () => {
    const [readme] = build(baseConfig, { written })
    const recommendations = readme.contents.slice(
      readme.contents.indexOf('Quel fichier utiliser'),
      readme.contents.indexOf('À quoi sert chaque format'),
    )

    for (const jargon of ['CMJN', 'RVB', 'vectoriel', 'prépresse']) {
      expect(recommendations, jargon).not.toContain(jargon)
    }
  })
})

describe('langue', () => {
  it('écrit en français par défaut', () => {
    const [readme] = build(baseConfig, { written })

    expect(readme.path).toContain('LISEZ-MOI')
    expect(readme.contents).toContain('Votre logo')
  })

  it('écrit en anglais sur demande', () => {
    const documents = build({ ...baseConfig, docLanguage: 'en' }, { written })

    expect(documents[0].path).toBe('Documentation/README.md')
    expect(documents[1].path).toBe('Documentation/FILE_GUIDE.txt')
    expect(documents[0].contents).toContain('Your logo')
    expect(documents[0].contents).toContain('For a printer')
  })

  it('retombe sur le français devant une langue inconnue', () => {
    const [readme] = build({ ...baseConfig, docLanguage: 'de' }, { written })

    expect(readme.contents).toContain('Votre logo')
  })
})

describe('texte du designer', () => {
  it('insère le message personnalisé', () => {
    const [readme] = build(
      { ...baseConfig, docMessage: 'Merci de votre confiance.' },
      { written },
    )

    expect(readme.contents).toContain('Merci de votre confiance.')
  })

  it('remplace les variables du message', () => {
    const [readme] = build(
      {
        ...baseConfig,
        projectName: 'Refonte',
        docMessage: 'Bonjour {{CLIENT_NAME}}, voici {{BRAND_NAME}} ({{PROJECT_NAME}}).',
      },
      { written },
    )

    expect(readme.contents).toContain('Bonjour Acme, voici Nova (Refonte).')
  })

  it('efface une variable inconnue plutôt que de la montrer au client', () => {
    const [readme] = build(
      { ...baseConfig, docMessage: 'Contact : {{INEXISTANT}}.' },
      { written },
    )

    expect(readme.contents).toContain('Contact : .')
    expect(readme.contents).not.toContain('INEXISTANT')
  })

  it('reprend le client quand la marque est absente', () => {
    const values = (
      engine.documentValues as unknown as (c: unknown) => Record<string, string>
    )({ clientName: 'Acme' })

    expect(values.BRAND_NAME).toBe('Acme')
  })

  it('publie les coordonnées du studio quand elles existent', () => {
    const [readme] = build(
      {
        ...baseConfig,
        studio: {
          name: 'Atelier Nord',
          designer: 'Léa Martin',
          email: 'lea@atelier-nord.fr',
          website: 'atelier-nord.fr',
        },
      },
      { written },
    )

    expect(readme.contents).toContain('Atelier Nord')
    expect(readme.contents).toContain('lea@atelier-nord.fr')
  })

  it('omet la section contact quand rien n’est renseigné', () => {
    const [readme] = build(baseConfig, { written })

    expect(readme.contents).not.toContain('Une question')
  })

  it('déclare les variables offertes au designer', () => {
    const tokens = engine.DOC_VARIABLES as unknown as string[]

    for (const token of ['CLIENT_NAME', 'STUDIO_NAME', 'DELIVERY_DATE']) {
      expect(tokens, token).toContain(token)
    }
  })
})
