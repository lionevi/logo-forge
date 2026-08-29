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
    // Le fond se reconnaît à sa place dans la pile : les autres tracés de la
    // planche sont les copies du logo, elles n'y descendent jamais.
    const grounds = preview.pathItems.filter(
      (item) => item.zOrderCalls.indexOf('sendToBack') >= 0,
    )

    expect(grounds).toHaveLength(1)
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

describe('déclinaisons personnalisées', () => {
  /**
   * Le panneau envoyait la teinte sans son dièse, et la couche ExtendScript
   * exigeait sept caractères : chaque couleur personnalisée était écartée de
   * la planche, sans message ailleurs que dans le décompte des cellules
   * manquées. C'est ce que l'utilisateur voyait comme « les couleurs
   * personnalisées ne fonctionnent pas ».
   */
  it('place la cellule, que la teinte porte un dièse ou non', () => {
    for (const hex of ['2680eb', '#2680eb']) {
      host = loadExtendScript()
      component('/tmp/Logo.ai')
      const result = build(
        '/tmp/Logo.ai',
        rows('fullColor::Couleur', 'custom:' + hex + ':Bleu marque'),
      )

      expect(result.fields[3]).toBe('')
      expect(result.fields[2]).toBe('2')
    }
  })

  it('recolore la cellule à la teinte demandée', () => {
    component('/tmp/Logo.ai')
    build('/tmp/Logo.ai', rows('custom:2680eb:Bleu marque'))
    const item = host.app.created[0].groupItems[0].pageItems[0]

    expect(item.fillColor).toMatchObject({ red: 0x26, green: 0x80, blue: 0xeb })
  })

  it('refuse une teinte illisible en le disant', () => {
    component('/tmp/Logo.ai')
    const result = build('/tmp/Logo.ai', rows('custom:pasunecouleur:Bleu'))

    expect(result.fields[3]).toContain('Bleu')
  })
})

describe('journal de construction', () => {
  it('nomme chaque étape franchie', () => {
    component('/tmp/Logo.ai')
    build('/tmp/Logo.ai', rows('fullColor::Couleur', 'black::Noir'))
    const trace = parseResult(host.api.lfPreviewTrace())

    expect(trace.fields[0]).toBe('début')
    expect(trace.fields[1]).toContain('document créé')
    expect(trace.fields[2]).toContain('colonne Logo ajoutée')
  })

  it('dit « document retrouvé » à la deuxième colonne', () => {
    component('/tmp/Logo.ai')
    build('/tmp/Logo.ai', rows('fullColor::Couleur'))
    component('/tmp/Mark.ai')
    build('/tmp/Mark.ai', rows('fullColor::Couleur'), 'Logo Mark')

    expect(parseResult(host.api.lfPreviewTrace()).fields[1]).toContain(
      'document retrouvé',
    )
  })

  /**
   * L'échec est le cas qui compte : sans journal, il ne rendait qu'un message
   * final, sans dire jusqu'où la construction était allée.
   */
  it('inscrit l’erreur exacte quand la construction échoue', () => {
    const result = build('/tmp/absent.ai', rows('fullColor::Couleur'))
    const trace = parseResult(host.api.lfPreviewTrace())

    expect(result.ok).toBe(false)
    expect(trace.fields[0]).toBe('début')
    expect(trace.fields[1]).toContain('ERR — composant introuvable')
  })

  it('repart d’un journal vide à chaque construction', () => {
    component('/tmp/Logo.ai')
    build('/tmp/Logo.ai', rows('fullColor::Couleur'))
    component('/tmp/Logo.ai')
    build('/tmp/Logo.ai', rows('fullColor::Couleur'))

    expect(parseResult(host.api.lfPreviewTrace()).fields[0]).toBe('début')
    expect(
      parseResult(host.api.lfPreviewTrace()).fields.filter((f) => f === 'début'),
    ).toHaveLength(1)
  })
})
