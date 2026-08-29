/**
 * Essai des trois exports.
 *
 * L'export n'était éprouvé qu'au bout d'une livraison entière : une option
 * refusée par une version d'Illustrator ne se voyait qu'après plusieurs
 * minutes de travail, et jamais pendant la mise au point. `lfTestExport`
 * écrit trois fichiers temporaires depuis le document ouvert et rend, pour
 * chacun, son chemin et sa taille — la seule preuve qu'un export a eu lieu.
 */

import { beforeEach, describe, expect, it } from 'vitest'

import {
  FakeDocument,
  FakeItem,
  loadExtendScript,
  parseResult,
  type Host,
} from './extendscriptHost'

let host: Host

/** Ouvre un document, tel qu'un designer en aurait un devant lui. */
function openDocument(name = 'brand.ai'): FakeDocument {
  const document_ = new FakeDocument(name, 'RGB', 200, 100)
  document_.layers[0].items = [new FakeItem('PathItem', [0, 100, 200, 0], 'marque')]
  host.app.documents.push(document_)
  host.app.activeDocument = document_
  return document_
}

/** Résultat de l'essai, un format par entrée. */
function trials(): Array<{ format: string; ok: boolean; path: string; detail: string }> {
  const result = parseResult(host.api.lfTestExport())
  const out = []
  for (let i = 0; i + 3 < result.fields.length; i += 4) {
    out.push({
      format: result.fields[i],
      ok: result.fields[i + 1] === 'OK',
      path: result.fields[i + 2],
      detail: result.fields[i + 3],
    })
  }
  return out
}

beforeEach(() => {
  host = loadExtendScript()
})

describe('essai des trois exports', () => {
  it('écrit un SVG, un PNG et un PDF', () => {
    openDocument()

    expect(trials().map((trial) => trial.format)).toEqual(['SVG', 'PNG', 'PDF'])
  })

  it('rend le chemin et la taille de chaque fichier', () => {
    openDocument()

    for (const trial of trials()) {
      expect(trial.ok).toBe(true)
      expect(trial.path).toContain('logo-forge-essai')
      expect(parseInt(trial.detail, 10)).toBeGreaterThan(0)
    }
  })

  it('écrit dans le dossier temporaire, jamais dans la livraison', () => {
    openDocument()

    for (const trial of trials()) expect(trial.path.indexOf('/tmp/')).toBe(0)
  })

  it('laisse le document de l’utilisateur ouvert', () => {
    const document_ = openDocument()
    trials()

    expect(document_.closed).toBe(false)
  })

  /**
   * Un format refusé ne doit pas emporter les deux autres : c'est justement
   * ce que l'essai cherche à distinguer.
   */
  it('poursuit après un format refusé', () => {
    const document_ = openDocument()
    document_.refuseExport = 'svg'
    const report = trials()

    expect(report[0]).toMatchObject({ format: 'SVG', ok: false })
    expect(report[0].detail).not.toBe('')
    expect(report[1].ok).toBe(true)
    expect(report[2].ok).toBe(true)
  })

  it('refuse clairement quand aucun document n’est ouvert', () => {
    const result = parseResult(host.api.lfTestExport())

    expect(result.ok).toBe(false)
    expect(result.value).toContain('aucun document ouvert')
  })
})
