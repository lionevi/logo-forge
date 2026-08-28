/**
 * Set Component, exécuté contre une doublure du modèle objet d'Illustrator.
 *
 * C'est le point le plus critique du plugin : une capture ratée produit un
 * composant vide, et tout l'export en aval livre des fichiers vides. Ces cas
 * couvrent les défauts relevés dans docs/AUDIT.md (BUG-001 à BUG-003).
 */

import { beforeEach, describe, expect, it } from 'vitest'

import {
  FakeDocument,
  FakeItem,
  FakeTextRange,
  loadExtendScript,
  parseResult,
} from './extendscriptHost'

type Host = ReturnType<typeof loadExtendScript>

let host: Host

/** Document source contenant `labels`, du premier plan vers l'arrière-plan. */
function openDocument(labels: string[]): FakeDocument {
  const doc = new FakeDocument('brand.ai', 'RGB', 600, 400)
  doc.layers[0].pageItems = labels.map(
    (label, index) =>
      new FakeItem(
        'PathItem',
        [index * 10, 100 - index * 10, 200 + index * 10, -100],
        label,
      ),
  )
  host.app.documents.push(doc)
  host.app.activeDocument = doc
  return doc
}

beforeEach(() => {
  host = loadExtendScript()
})

describe('sonde de sélection', () => {
  it('décrit une sélection vide sans lever', () => {
    openDocument(['fond'])
    const result = parseResult(host.api.lfDescribeSelection())

    expect(result.ok).toBe(true)
    expect(result.fields[0]).toBe('0')
  })

  it('compte les objets cadrables, masqués et verrouillés', () => {
    const doc = openDocument(['fond', 'marque', 'texte'])
    doc.layers[0].pageItems[0].hidden = true
    doc.layers[0].pageItems[1].locked = true
    doc.selection = [...doc.layers[0].pageItems, new FakeTextRange()]

    const result = parseResult(host.api.lfDescribeSelection())

    expect(result.ok).toBe(true)
    expect(result.fields[0]).toBe('4') // sélectionnés
    expect(result.fields[1]).toBe('3') // cadrables
    expect(result.fields[2]).toBe('1') // masqués
    // Le TextRange n'expose pas `locked` : il n'est donc pas comptabilisé.
    expect(result.fields[3]).toBe('1') // verrouillés
    expect(result.fields[4]).toContain('PathItem')
    expect(result.fields[4]).toContain('TextRange')
  })
})

describe('capture de la sélection', () => {
  it('refuse une sélection vide avec un message actionnable', () => {
    openDocument(['fond'])
    const result = parseResult(host.api.lfSetComponent('c0'))

    expect(result.ok).toBe(false)
    expect(result.value).toContain('selectionnez un objet')
  })

  it('refuse une sélection sans objet cadrable', () => {
    const doc = openDocument(['fond'])
    doc.selection = [new FakeTextRange()]

    const result = parseResult(host.api.lfSetComponent('c0'))

    expect(result.ok).toBe(false)
    expect(result.value).toContain('edition de texte')
  })

  it("préserve l'ordre de superposition de la sélection", () => {
    const doc = openDocument(['devant', 'milieu', 'derriere'])
    doc.selection = [...doc.layers[0].pageItems]

    expect(parseResult(host.api.lfSetComponent('c0')).ok).toBe(true)

    const created = host.app.created[0]
    expect(created.layers[0].pageItems.map((item) => item.label)).toEqual([
      'devant',
      'milieu',
      'derriere',
    ])
  })

  it('rend visibles les copies des objets masqués', () => {
    const doc = openDocument(['fond', 'marque'])
    doc.layers[0].pageItems[0].hidden = true
    doc.layers[0].pageItems[1].locked = true
    doc.selection = [...doc.layers[0].pageItems]

    expect(parseResult(host.api.lfSetComponent('c0')).ok).toBe(true)

    const copies = host.app.created[0].layers[0].pageItems
    expect(copies.every((item) => !item.hidden)).toBe(true)
    expect(copies.every((item) => !item.locked)).toBe(true)
  })

  it("ne modifie jamais les objets du document d'origine", () => {
    const doc = openDocument(['fond'])
    doc.layers[0].pageItems[0].hidden = true
    doc.layers[0].pageItems[0].locked = true
    doc.selection = [...doc.layers[0].pageItems]

    host.api.lfSetComponent('c0')

    expect(doc.layers[0].pageItems[0].hidden).toBe(true)
    expect(doc.layers[0].pageItems[0].locked).toBe(true)
  })

  it('poursuit malgré un objet refusé et le compte', () => {
    const doc = openDocument(['fond', 'verrouille', 'marque'])
    doc.layers[0].pageItems[1].refuseDuplicate = true
    doc.selection = [...doc.layers[0].pageItems]

    const result = parseResult(host.api.lfSetComponent('c0'))

    expect(result.ok).toBe(true)
    expect(result.fields[5]).toBe('2') // copiés
    expect(result.fields[6]).toBe('1') // refusés
  })

  it('échoue explicitement quand aucun objet ne peut être copié', () => {
    const doc = openDocument(['a', 'b'])
    for (const item of doc.layers[0].pageItems) item.refuseDuplicate = true
    doc.selection = [...doc.layers[0].pageItems]

    const result = parseResult(host.api.lfSetComponent('c0'))

    expect(result.ok).toBe(false)
    expect(result.value).toContain('aucun objet n a pu etre copie')
    expect(result.value).toContain('verrouille')
  })

  it('cadre le plan de travail sur les copies', () => {
    const doc = openDocument(['fond', 'marque'])
    doc.layers[0].pageItems[0].visibleBounds = [10, 90, 110, -10]
    doc.layers[0].pageItems[1].visibleBounds = [50, 120, 200, -40]
    doc.selection = [...doc.layers[0].pageItems]

    expect(parseResult(host.api.lfSetComponent('c0')).ok).toBe(true)

    expect(host.app.created[0].artboards[0].artboardRect).toEqual([10, 120, 200, -40])
  })

  it('renvoie les dimensions réelles du cadrage, pas celles de la sélection', () => {
    const doc = openDocument(['marque'])
    doc.layers[0].pageItems[0].visibleBounds = [0, 60, 480, -180]
    doc.selection = [...doc.layers[0].pageItems]

    const result = parseResult(host.api.lfSetComponent('c0'))

    expect(result.fields[2]).toBe('480')
    expect(result.fields[3]).toBe('240')
  })
})

describe('vérification du résultat', () => {
  it('écrit un fichier de composant et en rapporte la taille', () => {
    const doc = openDocument(['marque'])
    doc.selection = [...doc.layers[0].pageItems]

    const result = parseResult(host.api.lfSetComponent('c0'))

    expect(result.ok).toBe(true)
    const path = result.fields[1]
    expect(path).toMatch(/logo-forge-component-c0-\d+\.ai$/)
    expect(host.filesystem.files.get(path)?.bytes).toBeGreaterThan(0)
    expect(Number(result.fields[7])).toBeGreaterThan(0)
  })

  it('rejette un fichier de composant vide plutôt que de le déclarer défini', () => {
    const doc = openDocument(['marque'])
    doc.selection = [...doc.layers[0].pageItems]
    // Illustrator peut écrire un fichier sans contenu : le composant ne doit
    // alors pas être déclaré défini.
    host.app.defaultSaveBytes = 0

    const result = parseResult(host.api.lfSetComponent('c0'))

    expect(host.app.created.length).toBe(1)
    expect(result.ok).toBe(false)
    expect(result.value).toContain('vide')
  })

  it('produit une vignette PNG du composant', () => {
    const doc = openDocument(['marque'])
    doc.selection = [...doc.layers[0].pageItems]

    const result = parseResult(host.api.lfSetComponent('c0'))
    const thumbnail = result.fields[8]

    expect(thumbnail).toMatch(/\.png$/)
    expect(host.filesystem.files.has(thumbnail)).toBe(true)
    expect(host.app.created[0].exports[0].type).toBe('PNG24')
  })

  it('referme le document du composant et rend la main à la source', () => {
    const doc = openDocument(['marque'])
    doc.selection = [...doc.layers[0].pageItems]

    expect(parseResult(host.api.lfSetComponent('c0')).ok).toBe(true)

    expect(host.app.created[0].closed).toBe(true)
    expect(host.app.activeDocument).toBe(doc)
  })

  it('rend la main à la source même après un échec', () => {
    const doc = openDocument(['a'])
    doc.layers[0].pageItems[0].refuseDuplicate = true
    doc.selection = [...doc.layers[0].pageItems]

    expect(parseResult(host.api.lfSetComponent('c0')).ok).toBe(false)
    expect(host.app.activeDocument).toBe(doc)
  })
})

describe('régénération de vignette', () => {
  it('refuse un composant introuvable', () => {
    const result = parseResult(
      host.api.lfRenderThumbnail('/tmp/absent.ai', '/tmp/out.png'),
    )

    expect(result.ok).toBe(false)
    expect(result.value).toContain('introuvable')
  })

  it('signale un fichier de composant sans aucun objet', () => {
    host.filesystem.write('/tmp/vide.ai', 512)

    const result = parseResult(
      host.api.lfRenderThumbnail('/tmp/vide.ai', '/tmp/out.png'),
    )

    expect(result.ok).toBe(false)
    expect(result.value).toContain('aucun objet')
  })
})
