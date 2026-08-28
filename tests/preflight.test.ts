/**
 * Contrôle de production : règles, gravités et corrections.
 *
 * L'inspection Illustrator compte ; c'est ici qu'on décide ce que ces
 * décomptes signifient. Un contrôle trop indulgent laisse livrer un fichier
 * inutilisable, un contrôle trop sévère finit ignoré : ces cas fixent la
 * frontière.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { beforeEach, describe, expect, it } from 'vitest'

import {
  FakeDocument,
  FakeItem,
  loadExtendScript,
  parseResult,
} from './extendscriptHost'

const UNIT = String.fromCharCode(31)

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

interface Check {
  rule: { id: string; label: string; severity: string; fix?: string }
  status: string
  count?: number
  detail?: string
  message: string
  fix: string | null
}

interface Report {
  checks: Check[]
  manual: Array<{ id: string; label: string }>
  counts: Record<string, number>
  status: string
  ready: boolean
  items: number
}

const evaluate = (payload: string): Report =>
  (engine.evaluatePreflight as unknown as (p: string) => Report)(payload)

const find = (report: Report, id: string): Check =>
  report.checks.find((check) => check.rule.id === id)!

/** Charge utile d'un document sain, en impression. */
function cleanPayload(overrides: Record<string, string> = {}): string {
  const base: Record<string, string> = {
    colorMode: '0:cmyk/cmyk',
    strayPoints: '0:',
    unpainted: '0:',
    strokes: '0:',
    overprint: '0:',
    richBlack: '0:',
    emptyText: '0:',
    liveText: '0:',
    lockedLayers: '0:',
    hiddenLayers: '0:',
    unusedSwatches: '0:',
    whitespace: '0:8',
    items: '12:',
  }
  const merged = { ...base, ...overrides }
  return Object.keys(merged)
    .map((id) => id + ':' + merged[id])
    .join(UNIT)
}

describe('lecture du rapport', () => {
  it('relit les décomptes et leurs détails', () => {
    const findings = (
      engine.parsePreflight as unknown as (
        p: string,
      ) => Record<string, { count: number; detail: string }>
    )(['strayPoints:4:', 'whitespace:1:62'].join(UNIT))

    expect(findings.strayPoints.count).toBe(4)
    expect(findings.whitespace.detail).toBe('62')
  })

  it('ignore une ligne illisible plutôt que de la deviner', () => {
    const findings = (
      engine.parsePreflight as unknown as (p: string) => Record<string, unknown>
    )(['bruit', 'strayPoints:2:'].join(UNIT))

    expect(Object.keys(findings)).toEqual(['strayPoints'])
  })
})

describe('document conforme', () => {
  it('déclare la conformité et autorise l’export', () => {
    const report = evaluate(cleanPayload())

    expect(report.status).toBe('pass')
    expect(report.ready).toBe(true)
    expect(report.counts.error).toBe(0)
  })

  it('rend compte de chaque règle, même satisfaite', () => {
    const report = evaluate(cleanPayload())

    expect(report.checks.length).toBe(
      (engine.PREFLIGHT_RULES as unknown as unknown[]).length,
    )
    expect(find(report, 'strayPoints').status).toBe('pass')
    expect(find(report, 'strayPoints').message).toBe('conforme')
  })
})

describe('défauts bloquants', () => {
  it('bloque sur un mode colorimétrique inattendu', () => {
    const report = evaluate(cleanPayload({ colorMode: '1:rgb/cmyk' }))
    const check = find(report, 'colorMode')

    expect(check.status).toBe('error')
    expect(check.message).toContain('rgb')
    expect(check.message).toContain('cmyk')
    expect(report.ready).toBe(false)
  })

  it('bloque sur du texte non vectorisé', () => {
    const report = evaluate(cleanPayload({ liveText: '3:' }))

    expect(find(report, 'liveText').status).toBe('error')
    expect(find(report, 'liveText').message).toContain('3')
    expect(report.ready).toBe(false)
  })

  it('bloque sur les points isolés et propose de les retirer', () => {
    const check = find(evaluate(cleanPayload({ strayPoints: '4:' })), 'strayPoints')

    expect(check.status).toBe('error')
    expect(check.fix).toBe('strayPoints')
  })

  it('bloque sur les objets non peints et sur les blocs vides', () => {
    const report = evaluate(cleanPayload({ unpainted: '2:', emptyText: '1:' }))

    expect(find(report, 'unpainted').fix).toBe('unpainted')
    expect(find(report, 'emptyText').fix).toBe('emptyText')
    expect(report.counts.error).toBe(2)
  })
})

describe('avertissements', () => {
  it('signale les contours sans bloquer', () => {
    const report = evaluate(cleanPayload({ strokes: '5:' }))

    expect(find(report, 'strokes').status).toBe('warning')
    expect(report.status).toBe('warning')
    expect(report.ready).toBe(true)
  })

  it('signale la surimpression et le noir composé', () => {
    const report = evaluate(cleanPayload({ overprint: '1:', richBlack: '2:' }))

    expect(find(report, 'overprint').status).toBe('warning')
    expect(find(report, 'richBlack').status).toBe('warning')
  })

  it('signale un plan de travail trop large et propose de l’ajuster', () => {
    const check = find(evaluate(cleanPayload({ whitespace: '1:62' })), 'whitespace')

    expect(check.status).toBe('warning')
    expect(check.message).toContain('62')
    expect(check.fix).toBe('fitArtboard')
  })

  it('classe en information ce qui ne compromet pas la livraison', () => {
    const report = evaluate(cleanPayload({ unusedSwatches: '7:', lockedLayers: '1:' }))

    expect(find(report, 'unusedSwatches').status).toBe('info')
    expect(find(report, 'lockedLayers').status).toBe('info')
    expect(report.status).toBe('pass')
    expect(report.ready).toBe(true)
  })
})

describe('honnêteté du rapport', () => {
  it("n'invente pas un contrôle absent de la charge utile", () => {
    const report = evaluate('strayPoints:0:')
    const check = find(report, 'liveText')

    expect(check.status).toBe('unknown')
    expect(check.message).toContain('non effectué')
  })

  it('déclare les contrôles qu’aucun script ne peut trancher', () => {
    const report = evaluate(cleanPayload())

    expect(report.manual.map((entry) => entry.id)).toContain('appearance')
    for (const entry of report.manual) {
      expect(entry, entry.id).toHaveProperty('manual')
    }
  })

  it('accompagne chaque règle d’une consigne manuelle', () => {
    for (const rule of engine.PREFLIGHT_RULES as unknown as Array<{
      id: string
      manual: string
    }>) {
      expect(rule.manual, rule.id).toBeTruthy()
    }
  })
})

/* ------------------------------------------------------------------ *
 * Inspection réelle, contre la doublure d'Illustrator
 * ------------------------------------------------------------------ */

type Host = ReturnType<typeof loadExtendScript>

let host: Host

function openDocument(): FakeDocument {
  const doc = new FakeDocument('brand.ai', 'RGB', 400, 300)
  host.app.documents.push(doc)
  host.app.activeDocument = doc
  return doc
}

/** Tracé conforme : deux points, un fond. */
function path(label: string, extra: Partial<FakeItem> = {}): FakeItem {
  const item = new FakeItem('PathItem', [0, 100, 100, 0], label)
  Object.assign(item, { pathPoints: [{}, {}], filled: true, stroked: false }, extra)
  return item
}

beforeEach(() => {
  host = loadExtendScript()
})

describe('inspection du document', () => {
  it('refuse de contrôler sans document', () => {
    const result = parseResult(host.api.lfPreflight('print'))

    expect(result.ok).toBe(false)
    expect(result.value).toContain('aucun document')
  })

  it('compare le mode colorimétrique à la passe demandée', () => {
    openDocument()

    expect(evaluate(parseResult(host.api.lfPreflight('web')).value).ready).toBe(true)
    expect(
      find(evaluate(parseResult(host.api.lfPreflight('print')).value), 'colorMode')
        .status,
    ).toBe('error')
  })

  it('compte points isolés, objets non peints et contours', () => {
    const doc = openDocument()
    doc.pathItems = [
      path('bon'),
      path('isolé', { pathPoints: [{}] }),
      path('invisible', { filled: false, stroked: false }),
      path('contour', { stroked: true }),
    ]

    const report = evaluate(parseResult(host.api.lfPreflight('web')).value)

    expect(find(report, 'strayPoints').count).toBe(1)
    expect(find(report, 'unpainted').count).toBe(1)
    expect(find(report, 'strokes').count).toBe(1)
  })

  it('épargne un masque d’écrêtage, légitimement non peint', () => {
    const doc = openDocument()
    doc.pathItems = [path('masque', { filled: false, stroked: false, clipping: true })]

    const report = evaluate(parseResult(host.api.lfPreflight('web')).value)
    expect(find(report, 'unpainted').count).toBe(0)
  })

  it('distingue le texte vivant du bloc vide', () => {
    const doc = openDocument()
    doc.textFrames.add().contents = 'Marque'
    doc.textFrames.add().contents = '   '

    const report = evaluate(parseResult(host.api.lfPreflight('web')).value)

    expect(find(report, 'liveText').count).toBe(1)
    expect(find(report, 'emptyText').count).toBe(1)
  })

  it('mesure le blanc tournant du plan de travail', () => {
    const doc = openDocument()
    doc.artboards[0].artboardRect = [0, 0, 400, -400]
    doc.layers[0].items = [new FakeItem('PathItem', [0, 0, 100, -100], 'petit')]

    const report = evaluate(parseResult(host.api.lfPreflight('web')).value)
    const check = find(report, 'whitespace')

    // 100 × 100 dans 400 × 400 : 93 % du plan reste vide.
    expect(check.detail).toBe('94')
    expect(check.status).toBe('warning')
  })
})

describe('corrections sûres', () => {
  it('retire les points isolés et les compte', () => {
    const doc = openDocument()
    doc.pathItems = [path('bon'), path('isolé', { pathPoints: [{}] })]

    const result = parseResult(host.api.lfClean('strayPoints'))

    expect(result.ok).toBe(true)
    expect(result.value).toBe('1')
    expect(doc.pathItems).toHaveLength(1)
  })

  it('retire les blocs de texte vides sans toucher au texte', () => {
    const doc = openDocument()
    doc.textFrames.add().contents = 'Marque'
    doc.textFrames.add().contents = ''

    expect(parseResult(host.api.lfClean('emptyText')).value).toBe('1')
    expect(doc.textFrames).toHaveLength(1)
    expect(doc.textFrames[0].contents).toBe('Marque')
  })

  it('ne retire jamais un masque d’écrêtage', () => {
    const doc = openDocument()
    doc.pathItems = [path('masque', { filled: false, stroked: false, clipping: true })]

    expect(parseResult(host.api.lfClean('unpainted')).value).toBe('0')
    expect(doc.pathItems).toHaveLength(1)
  })

  it('refuse une correction inconnue plutôt que de ne rien faire en silence', () => {
    openDocument()
    const result = parseResult(host.api.lfClean('outlineText'))

    expect(result.ok).toBe(false)
    expect(result.value).toContain('inconnue')
  })
})
