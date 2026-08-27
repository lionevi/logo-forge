import { describe, expect, it, vi } from 'vitest'

import {
  createDirectories,
  createMemoryWriter,
  runExport,
  summarizeResult,
} from '../src/core/exporter'
import { planExport } from '../src/core/planner'
import type { DocumentRenderer, ExportConfig, PlannedFile } from '../src/core/types'

function config(overrides: Partial<ExportConfig> = {}): ExportConfig {
  return {
    naming: {
      brand: 'Ma Marque',
      strategy: 'usage-format',
      namingCase: 'kebab',
      includeSize: true,
      includeColorSpace: true,
      packFolder: 'logo-pack',
    },
    variants: ['primary'],
    colorModes: ['full-color', 'black'],
    formats: ['svg'],
    sizes: [],
    usages: ['web'],
    background: '#ffffff',
    quality: 90,
    ...overrides,
  }
}

/** Renderer déterministe : renvoie le chemin du fichier comme contenu. */
const echoRenderer: DocumentRenderer = {
  async render(file: PlannedFile) {
    return file.path
  },
}

describe('createDirectories', () => {
  it("crée chaque dossier du plan, parents d'abord", async () => {
    const plan = planExport(config())
    const writer = createMemoryWriter()

    await createDirectories(plan, writer)

    expect([...writer.directories]).toEqual(plan.directories)
  })
})

describe('runExport', () => {
  it('écrit tous les fichiers planifiés', async () => {
    const plan = planExport(config())
    const writer = createMemoryWriter()

    const result = await runExport(plan, writer, echoRenderer)

    expect(result.written).toHaveLength(plan.totalFiles)
    expect(result.failures).toEqual([])
    expect(result.cancelled).toBe(false)
    expect([...writer.files.keys()].sort()).toEqual(
      plan.files.map((file) => file.path).sort(),
    )
  })

  it('transmet le contenu rendu au writer', async () => {
    const plan = planExport(config())
    const writer = createMemoryWriter()

    await runExport(plan, writer, echoRenderer)

    for (const file of plan.files) {
      expect(writer.files.get(file.path)).toBe(file.path)
    }
  })

  it('rapporte la progression après chaque fichier', async () => {
    const plan = planExport(config())
    const writer = createMemoryWriter()
    const onProgress = vi.fn()

    await runExport(plan, writer, echoRenderer, { onProgress })

    expect(onProgress).toHaveBeenCalledTimes(plan.totalFiles)
    expect(onProgress.mock.calls.at(-1)?.[0]).toMatchObject({
      completed: plan.totalFiles,
      total: plan.totalFiles,
    })
  })

  it("refuse un plan porteur d'erreurs bloquantes", async () => {
    const plan = planExport(config({ formats: [] }))

    await expect(runExport(plan, createMemoryWriter(), echoRenderer)).rejects.toThrow(
      /bloquantes/,
    )
  })

  it('collecte les échecs sans interrompre le pack', async () => {
    const plan = planExport(config({ variants: ['primary', 'icon', 'wordmark'] }))
    const writer = createMemoryWriter()
    const renderer: DocumentRenderer = {
      async render(file) {
        if (file.variant === 'icon') throw new Error('rendu impossible')
        return file.path
      },
    }

    const result = await runExport(plan, writer, renderer)

    expect(result.failures).toHaveLength(2)
    expect(result.failures[0].message).toBe('rendu impossible')
    expect(result.written).toHaveLength(plan.totalFiles - 2)
    expect(result.cancelled).toBe(false)
  })

  it("s'arrête au premier échec quand stopOnError est demandé", async () => {
    const plan = planExport(config({ variants: ['primary', 'icon'] }))
    const renderer: DocumentRenderer = {
      async render() {
        throw new Error('boum')
      },
    }

    const result = await runExport(plan, createMemoryWriter(), renderer, {
      stopOnError: true,
    })

    expect(result.failures).toHaveLength(1)
    expect(result.written).toEqual([])
    expect(result.cancelled).toBe(true)
  })

  it("interrompt l'export quand le signal est levé", async () => {
    const plan = planExport(
      config({ variants: ['primary', 'horizontal', 'stacked', 'icon'] }),
    )
    const signal = { aborted: false }
    const renderer: DocumentRenderer = {
      async render(file) {
        signal.aborted = true
        return file.path
      },
    }

    const result = await runExport(plan, createMemoryWriter(), renderer, {
      signal,
    })

    expect(result.cancelled).toBe(true)
    expect(result.written).toHaveLength(1)
  })

  it('convertit une valeur levée non-Error en message lisible', async () => {
    const plan = planExport(config({ colorModes: ['full-color'] }))
    const renderer: DocumentRenderer = {
      async render() {
        throw 'panne disque'
      },
    }

    const result = await runExport(plan, createMemoryWriter(), renderer)

    expect(result.failures[0].message).toBe('panne disque')
  })
})

describe('summarizeResult', () => {
  it('résume un export réussi', () => {
    expect(
      summarizeResult({
        written: [{} as PlannedFile, {} as PlannedFile],
        failures: [],
        cancelled: false,
        durationMs: 1500,
      }),
    ).toBe('2 fichiers écrits en 1.5 s')
  })

  it("mentionne les échecs et l'interruption", () => {
    const summary = summarizeResult({
      written: [],
      failures: [{ file: {} as PlannedFile, message: 'x' }],
      cancelled: true,
      durationMs: 200,
    })

    expect(summary).toContain('1 échecs')
    expect(summary).toContain('export interrompu')
  })
})
