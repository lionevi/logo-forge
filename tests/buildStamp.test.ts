/**
 * Empreinte du panneau construit.
 *
 * Plusieurs mises au point ont porté sur un panneau qui n'était pas celui
 * qu'on venait de construire : une copie ancienne restée dans le dossier des
 * extensions se comporte exactement comme un défaut non corrigé, et rien à
 * l'écran ne les distingue. L'empreinte tranche — et le déploiement la
 * compare, ce que les tailles de fichiers ne suffisent pas à faire.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  MARKER,
  fingerprint,
  readStamp,
  sourceRevision,
  stampBuild,
} from '../scripts/stamp-build.mjs'

const HERE = import.meta.dirname
const PANEL = readFileSync(resolve(HERE, '../src/panel-cep.html'), 'utf8')
const VITE = readFileSync(resolve(HERE, '../vite.config.ts'), 'utf8')
const DEPLOY = readFileSync(resolve(HERE, '../scripts/deploy-mac.sh'), 'utf8')

describe('calcul de l’empreinte', () => {
  it('rend sept caractères hexadécimaux', () => {
    expect(fingerprint('Logo Forge')).toMatch(/^[0-9a-f]{7}$/)
  })

  it('donne la même empreinte au même contenu', () => {
    // Sinon elle daterait le build plutôt que de décrire le panneau, et
    // deux constructions du même code sembleraient différentes.
    expect(fingerprint('Logo Forge')).toBe(fingerprint('Logo Forge'))
  })

  it('change dès qu’un caractère change', () => {
    expect(fingerprint('Logo Forge')).not.toBe(fingerprint('Logo Forgé'))
  })
})

describe('pose de l’empreinte', () => {
  const document_ = '<html><script>var LF_BUILD = ' + MARKER + '</script></html>'

  it('remplace le marqueur par l’empreinte, la date et le commit', () => {
    const stamped = stampBuild(document_, '2026-08-30', 'abc1234')

    expect(stamped.html).toContain('"stamp":"' + stamped.stamp + '"')
    expect(stamped.html).toContain('"date":"2026-08-30"')
    expect(stamped.html).toContain('"commit":"abc1234"')
    expect(stamped.html).not.toContain(MARKER)
  })

  it('accepte un panneau construit hors dépôt', () => {
    // Une archive dézippée n'a pas de commit : ce n'est pas une raison de
    // refuser de construire.
    expect(stampBuild(document_, '2026-08-30').html).toContain('"commit":""')
  })

  it('ne mesure pas le marqueur qu’elle remplace', () => {
    // L'empreinte porte sur le panneau, pas sur l'endroit où on l'écrit.
    expect(stampBuild(document_, '2026-08-30').stamp).toBe(
      fingerprint(document_.replace(MARKER, '')),
    )
  })

  it('se relit dans un panneau construit', () => {
    const stamped = stampBuild(document_, '2026-08-30')

    expect(readStamp(stamped.html)).toBe(stamped.stamp)
  })

  it('ne trouve rien dans un panneau non construit', () => {
    expect(readStamp(document_)).toBe('')
  })

  it('refuse un panneau sans marqueur, plutôt que de se taire', () => {
    expect(() => stampBuild('<html></html>', '2026-08-30')).toThrow('marqueur')
  })
})

describe('commit d’origine', () => {
  /**
   * L'empreinte dit si deux panneaux diffèrent ; le commit dit lequel on
   * regarde. C'est ce qui tranche entre « le défaut n'est pas corrigé » et
   * « ce dossier a été construit avant le correctif ».
   */
  it('rend le commit court du dépôt', () => {
    expect(sourceRevision(resolve(HERE, '..'))).toMatch(/^[0-9a-f]{7,}\+?$/)
  })

  it('rend une chaîne vide hors d’un dépôt, sans lever', () => {
    expect(sourceRevision('/')).toBe('')
  })
})

describe('branchement', () => {
  it('le panneau porte le marqueur', () => {
    expect(PANEL).toContain('var LF_BUILD = ' + MARKER)
  })

  it('le build la pose', () => {
    expect(VITE).toContain('stampBuild(')
  })

  it('le déploiement la compare', () => {
    // Sept caractères changés ne changent pas la taille d'un fichier : la
    // comparaison des tailles laisserait passer une copie ancienne.
    expect(DEPLOY).toContain('(empreinte)')
    expect(DEPLOY).toContain('SOURCE_STAMP')
    expect(DEPLOY).toContain('SOURCE_COMMIT')
  })

  it('le panneau l’affiche dans ses diagnostics, commit compris', () => {
    expect(PANEL).toContain('id="build-stamp"')
    expect(PANEL).toContain('function renderBuildStamp()')
    expect(PANEL).toContain('LF_BUILD.commit')
  })
})
