/**
 * Planche de prévisualisation.
 *
 * Elle se construit au fur et à mesure des captures : une ligne par
 * déclinaison, une colonne par composant. Elle reste ouverte entre deux
 * captures — c'est ce qui la distingue de la planche de revue, produite d'un
 * bloc à la demande.
 */

import { beforeEach, describe, expect, it } from 'vitest'

import {
  FakeDocument,
  FakeItem,
  loadExtendScript,
  parseResult,
  type Host,
} from './extendscriptHost'

const UNIT = String.fromCharCode(31)

let host: Host

/** Déclinaisons, dans la forme que le panneau transmet. */
function rows(...specs: string[]): string {
  return specs.join(UNIT)
}

/** Enregistre un composant lisible, et le document qu'`open` rendra. */
function component(path: string, labels: string[] = ['marque']): void {
  host.filesystem.write(path, 4096)
  const opened = new FakeDocument('Logo.ai', 'RGB', 200, 100)
  opened.layers[0].items = labels.map(
    (label) => new FakeItem('PathItem', [0, 100, 200, 0], label),
  )
  host.app.nextOpened = opened
}

const build = (path: string, spec: string, name = 'Logo') =>
  parseResult(host.api.lfBuildPreview(name, path, spec, 100, ''))

beforeEach(() => {
  host = loadExtendScript()
})

describe('ouverture de la planche', () => {
  it('crée un plan de travail par déclinaison', () => {
    component('/tmp/Logo.ai')
    const result = build(
      '/tmp/Logo.ai',
      rows('fullColor::Master Logos', 'black::Black', 'white::White:1d1d1d'),
    )
    const preview = host.app.created[0]

    expect(result.ok).toBe(true)
    expect(preview.artboards).toHaveLength(3)
    expect(result.fields[0]).toBe('3')
  })

  it('nomme chaque plan de travail par sa déclinaison', () => {
    component('/tmp/Logo.ai')
    build('/tmp/Logo.ai', rows('fullColor::Master Logos', 'black::Black'))
    const preview = host.app.created[0]

    expect(preview.artboards.map((board) => board.name)).toEqual([
      'Master Logos',
      'Black',
    ])
  })

  it('empile les lignes vers le bas', () => {
    component('/tmp/Logo.ai')
    build('/tmp/Logo.ai', rows('fullColor::A', 'black::B'))
    const [first, second] = host.app.created[0].artboards

    // Le repère d'Illustrator descend vers les valeurs négatives.
    expect(first.artboardRect[1]).toBe(0)
    expect(second.artboardRect[1]).toBeLessThan(first.artboardRect[1])
  })

  it('écrit un libellé par ligne', () => {
    component('/tmp/Logo.ai')
    build('/tmp/Logo.ai', rows('fullColor::Master Logos', 'black::Black'))
    const preview = host.app.created[0]

    expect(preview.textFrames.map((frame) => frame.contents)).toEqual([
      'Master Logos',
      'Black',
    ])
  })

  it('pose un fond sombre là où la déclinaison serait invisible', () => {
    // Une version blanche sur un plan blanc ne se voit pas : la planche
    // mentirait par omission.
    component('/tmp/Logo.ai')
    build('/tmp/Logo.ai', rows('fullColor::Color', 'white::White:1d1d1d'))
    const preview = host.app.created[0]
    const grounds = preview.pathItems.filter((item) => item.filled)

    expect(grounds).toHaveLength(1)
    expect(grounds[0].zOrderCalls).toContain('sendToBack')
  })

  it('refuse de travailler sans déclinaison', () => {
    component('/tmp/Logo.ai')

    expect(build('/tmp/Logo.ai', '').ok).toBe(false)
  })

  it('refuse un composant introuvable', () => {
    const result = build('/tmp/absent.ai', rows('fullColor::Color'))

    expect(result.ok).toBe(false)
    expect(result.value).toContain('introuvable')
  })
})

describe('colonnes successives', () => {
  it('ajoute une colonne sans rouvrir de planche', () => {
    component('/tmp/Logo.ai')
    build('/tmp/Logo.ai', rows('fullColor::Color', 'black::Black'))
    component('/tmp/Mark.ai')
    const second = build(
      '/tmp/Mark.ai',
      rows('fullColor::Color', 'black::Black'),
      'Logo Mark',
    )

    // Un seul document créé : la planche a été retrouvée, pas refaite.
    expect(host.app.created).toHaveLength(1)
    expect(second.fields[1]).toBe('2')
    expect(second.fields[4]).toBe('mise a jour')
  })

  it('élargit les plans de travail pour la nouvelle colonne', () => {
    component('/tmp/Logo.ai')
    build('/tmp/Logo.ai', rows('fullColor::Color'))
    const narrow = host.app.created[0].artboards[0].artboardRect[2]

    component('/tmp/Mark.ai')
    build('/tmp/Mark.ai', rows('fullColor::Color'), 'Logo Mark')
    const wide = host.app.created[0].artboards[0].artboardRect[2]

    expect(wide).toBeGreaterThan(narrow)
  })

  it('dit qu’elle vient d’ouvrir la planche, la première fois', () => {
    component('/tmp/Logo.ai')

    expect(build('/tmp/Logo.ai', rows('fullColor::Color')).fields[4]).toBe('nouvelle')
  })

  it('rouvre une planche que le designer a fermée', () => {
    component('/tmp/Logo.ai')
    build('/tmp/Logo.ai', rows('fullColor::Color'))
    host.app.created[0].closed = true
    host.app.documents.length = 0

    component('/tmp/Mark.ai')
    const again = build('/tmp/Mark.ai', rows('fullColor::Color'), 'Logo Mark')

    expect(again.fields[4]).toBe('nouvelle')
    expect(host.app.created).toHaveLength(2)
  })
})

describe('placement dans la cellule', () => {
  it('groupe le composant, une fois par cellule', () => {
    component('/tmp/Logo.ai', ['fond', 'marque'])
    build('/tmp/Logo.ai', rows('fullColor::Color', 'black::Black'))
    const preview = host.app.created[0]

    expect(preview.groupItems).toHaveLength(2)
    expect(preview.groupItems[0].pageItems).toHaveLength(2)
  })

  it('réduit ce qui dépasse, sans jamais agrandir', () => {
    // Un petit composant grossi paraîtrait plus imposant qu'il n'est, et la
    // planche sert précisément à comparer.
    component('/tmp/Logo.ai')
    build('/tmp/Logo.ai', rows('fullColor::Color'))
    const group = host.app.created[0].groupItems[0]

    // `scale` part de 100 et suit chaque redimensionnement.
    expect(group.scale).toBeLessThanOrEqual(100)
  })

  it('décale la seconde colonne vers la droite', () => {
    component('/tmp/Logo.ai')
    build('/tmp/Logo.ai', rows('fullColor::Color'))
    component('/tmp/Mark.ai')
    build('/tmp/Mark.ai', rows('fullColor::Color'), 'Logo Mark')

    const [first, second] = host.app.created[0].groupItems
    expect(second.position[0]).toBeGreaterThan(first.position[0])
  })

  it('compte les cellules remplies et nomme celles qui manquent', () => {
    component('/tmp/Logo.ai')
    const result = build('/tmp/Logo.ai', rows('fullColor::Color', 'black::Black'))

    expect(result.fields[2]).toBe('2')
    expect(result.fields[3]).toBe('')
  })
})

describe('fermeture', () => {
  it('referme la planche sans l’enregistrer', () => {
    component('/tmp/Logo.ai')
    build('/tmp/Logo.ai', rows('fullColor::Color'))

    expect(parseResult(host.api.lfClosePreview()).ok).toBe(true)
    expect(host.app.created[0].closed).toBe(true)
  })

  it('ne se plaint pas quand il n’y a rien à fermer', () => {
    expect(parseResult(host.api.lfClosePreview()).ok).toBe(true)
  })
})
