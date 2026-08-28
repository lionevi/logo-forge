/**
 * Nommage des livrables et gestion des collisions.
 *
 * Le nom d'un fichier est ce que le client voit en premier, et le seul
 * repère dont il dispose pour choisir. Une collision mal gérée, elle, écrase
 * une livraison précédente sans le dire.
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

const render = engine.renderNameTemplate as unknown as (
  template: string,
  values: Record<string, string>,
  separator?: string,
) => string

const deliveryName = engine.deliveryName as unknown as (
  config: Record<string, unknown>,
  component: Record<string, unknown>,
  scheme: Record<string, unknown>,
  size: number,
  extension: string,
  pass?: string,
) => string

const versionedName = engine.versionedName as unknown as (
  fileName: string,
  attempt: number,
) => string

interface Decision {
  action: string
  path?: string
  fileName?: string
  message?: string
}

/** Résout une collision contre un ensemble de chemins déjà pris. */
function resolve_(
  path: string,
  fileName: string,
  policy: string,
  taken: string[],
): Decision {
  let outcome: Decision = { action: 'none' }
  ;(
    engine.resolveCollision as unknown as (
      p: string,
      f: string,
      pol: string,
      exists: (candidate: string, done: (used: boolean) => void) => void,
      done: (decision: Decision) => void,
    ) => void
  )(
    path,
    fileName,
    policy,
    (candidate, done) => done(taken.indexOf(candidate) !== -1),
    (decision) => {
      outcome = decision
    },
  )
  return outcome
}

describe('gabarit de nommage', () => {
  it('remplace les variables déclarées', () => {
    expect(
      render('{{client}}_{{component}}_{{scheme}}', {
        client: 'Acme',
        component: 'Logo',
        scheme: 'Black',
      }),
    ).toBe('Acme_Logo_Black')
  })

  it('tolère les espaces autour d’une variable', () => {
    expect(render('{{ client }}-{{component}}', { client: 'A', component: 'B' })).toBe(
      'A-B',
    )
  })

  it('vide une variable inconnue plutôt que de la laisser paraître', () => {
    expect(render('{{client}}_{{inexistant}}', { client: 'Acme' })).toBe('Acme')
  })

  it('résorbe les séparateurs orphelins d’une variable vide', () => {
    // Un fichier vectoriel n'a pas de taille : le nom ne doit pas s'en
    // ressentir.
    expect(
      render('{{client}}_{{component}}_{{size}}_{{scheme}}', {
        client: 'Acme',
        component: 'Logo',
        size: '',
        scheme: 'Black',
      }),
    ).toBe('Acme_Logo_Black')
  })

  it('ne laisse aucun séparateur en bord de nom', () => {
    expect(render('{{size}}_{{client}}_{{size}}', { client: 'Acme', size: '' })).toBe(
      'Acme',
    )
  })

  it('préserve un séparateur doublé délibérément', () => {
    expect(
      render('{{client}}--{{component}}', { client: 'Acme', component: 'Logo' }),
    ).toBe('Acme--Logo')
  })

  it('traite un séparateur régulier comme un caractère ordinaire', () => {
    // Un point est un métacaractère d'expression régulière.
    expect(
      render('{{client}}.{{size}}.{{component}}', {
        client: 'Acme',
        size: '',
        component: 'Logo',
      }),
    ).toBe('Acme.Logo')
  })

  it('retire les caractères interdits par le système de fichiers', () => {
    expect(render('{{client}}', { client: 'Ac/me:*?' })).toBe('Acme')
  })

  it('déclare chaque variable qu’il accepte', () => {
    const tokens = (
      engine.NAME_VARIABLES as unknown as Array<{ token: string; label: string }>
    ).map((entry) => entry.token)

    for (const token of ['client', 'component', 'scheme', 'format', 'date']) {
      expect(tokens, token).toContain(token)
    }
  })
})

describe('nom de livraison', () => {
  const component = { name: 'Logo Mark', type: 'logoMark' }
  const scheme = { id: 'black' }

  it('suit le séparateur tant qu’aucun gabarit n’est écrit', () => {
    expect(
      deliveryName({ clientName: 'Acme', separator: '-' }, component, scheme, 0, 'pdf'),
    ).toBe('Acme-LogoMark-Black.pdf')
  })

  it('obéit au gabarit dès qu’il en existe un', () => {
    expect(
      deliveryName(
        {
          clientName: 'Acme',
          nameTemplate: '{{component}}--{{scheme}}--{{format}}',
        },
        component,
        scheme,
        0,
        'pdf',
      ),
    ).toBe('LogoMark--Black--PDF.pdf')
  })

  it('expose le profil colorimétrique de la passe', () => {
    expect(
      deliveryName(
        { clientName: 'Acme', nameTemplate: '{{component}}_{{profile}}' },
        component,
        scheme,
        0,
        'pdf',
        'print',
      ),
    ).toBe('LogoMark_CMJN.pdf')
    expect(
      deliveryName(
        { clientName: 'Acme', nameTemplate: '{{component}}_{{profile}}' },
        component,
        scheme,
        0,
        'svg',
        'web',
      ),
    ).toBe('LogoMark_RVB.svg')
  })

  it('retombe sur la marque quand elle est renseignée', () => {
    expect(
      deliveryName(
        { clientName: 'Acme', brandName: 'Nova', nameTemplate: '{{brand}}' },
        component,
        scheme,
        0,
        'svg',
      ),
    ).toBe('Nova.svg')
  })

  it('reprend le client à défaut de marque', () => {
    expect(
      deliveryName(
        { clientName: 'Acme', nameTemplate: '{{brand}}' },
        component,
        scheme,
        0,
        'svg',
      ),
    ).toBe('Acme.svg')
  })

  it('date la livraison au format trié', () => {
    const name = deliveryName(
      { clientName: 'Acme', nameTemplate: '{{date}}' },
      component,
      scheme,
      0,
      'svg',
    )
    expect(name).toMatch(/^\d{4}-\d{2}-\d{2}\.svg$/)
  })

  it('ne laisse jamais un fichier sans nom', () => {
    // Un gabarit ne produisant que des variables vides reste un gabarit.
    expect(
      deliveryName(
        { clientName: '', nameTemplate: '{{version}}{{project}}' },
        component,
        scheme,
        0,
        'svg',
      ),
    ).toBe('LogoMark.svg')
  })
})

describe('collisions', () => {
  const path = '/pack/Print/Logo/Acme_Logo_Black.pdf'
  const fileName = 'Acme_Logo_Black.pdf'

  it('écrit sans détour quand la place est libre', () => {
    const decision = resolve_(path, fileName, 'version', [])

    expect(decision.action).toBe('write')
    expect(decision.path).toBe(path)
  })

  it('écrase quand c’est la politique retenue', () => {
    const decision = resolve_(path, fileName, 'overwrite', [path])

    expect(decision.action).toBe('write')
    expect(decision.path).toBe(path)
  })

  it('renonce quand la politique est de ne pas réécrire', () => {
    expect(resolve_(path, fileName, 'skip', [path]).action).toBe('skip')
  })

  it('verse une nouvelle version à côté de l’existante', () => {
    const decision = resolve_(path, fileName, 'version', [path])

    expect(decision.fileName).toBe('Acme_Logo_Black-v2.pdf')
    expect(decision.path).toBe('/pack/Print/Logo/Acme_Logo_Black-v2.pdf')
  })

  it('poursuit la numérotation jusqu’à trouver une place', () => {
    const decision = resolve_(path, fileName, 'version', [
      path,
      '/pack/Print/Logo/Acme_Logo_Black-v2.pdf',
      '/pack/Print/Logo/Acme_Logo_Black-v3.pdf',
    ])

    expect(decision.fileName).toBe('Acme_Logo_Black-v4.pdf')
  })

  it('abandonne plutôt que de boucler sur un dossier saturé', () => {
    const taken = [path]
    for (let attempt = 2; attempt <= 99; attempt += 1) {
      taken.push('/pack/Print/Logo/Acme_Logo_Black-v' + attempt + '.pdf')
    }

    const decision = resolve_(path, fileName, 'version', taken)
    expect(decision.action).toBe('fail')
    expect(decision.message).toContain('trop de versions')
  })

  it('insère la version avant l’extension, jamais après', () => {
    expect(versionedName('logo.svg', 2)).toBe('logo-v2.svg')
    expect(versionedName('sans-extension', 3)).toBe('sans-extension-v3')
  })

  it('déclare les politiques offertes', () => {
    const ids = (engine.COLLISION_POLICIES as unknown as Array<{ id: string }>).map(
      (entry) => entry.id,
    )

    expect(ids).toEqual(['overwrite', 'version', 'skip'])
  })
})
