/**
 * Tests du panneau.
 *
 * Le pont Illustrator est remplacé par une doublure : ces tests portent sur le
 * comportement de l'interface — ce qui s'affiche, ce qui s'active, ce qui se
 * désactive — et non sur l'export lui-même, couvert par `tests/`.
 */

import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ActiveDocumentInfo } from '../core/types'
import type { HostEnvironment } from '../illustrator/host'

/** Document actif renvoyé par la doublure ; modifiable par chaque test. */
let activeDocument: ActiveDocumentInfo | null = null
let illustratorReady = true
let panelEnvironment: HostEnvironment = 'uxp'

vi.mock('./illustratorBridge', () => ({
  readActiveDocument: () => activeDocument,
  isIllustratorReady: () => illustratorReady,
  getPanelEnvironment: () => panelEnvironment,
  isUxpAvailable: () => true,
  getIllustratorEngine: () => ({
    getActiveDocument: () => activeDocument,
    duplicateActiveDocument: vi.fn(),
    applyColorScheme: vi.fn(),
    exportDocument: vi.fn(),
    closeDocument: vi.fn(),
  }),
  pickDestinationFolder: vi.fn(async () => null),
  createUxpWriter: vi.fn(),
  revealInFileManager: vi.fn(async () => true),
  folderPath: (entry: { nativePath?: string } | null) => entry?.nativePath ?? null,
  POLL_FAILURE_LIMIT: 3,
  // Sondage inerte : la relecture périodique est couverte par
  // tests/documentPoller.test.ts, elle n'a rien à faire ici.
  createDocumentPoller: () => ({ stop: () => {} }),
}))

const { Panel } = await import('./Panel')

function aDocument(overrides: Partial<ActiveDocumentInfo> = {}): ActiveDocumentInfo {
  return {
    name: 'test-logo.ai',
    path: '/tmp/test-logo.ai',
    artboardCount: 2,
    artboardWidthPoints: 512,
    ...overrides,
  }
}

/** Bouton d'export principal. */
function exportButton(): HTMLButtonElement {
  return screen.getByRole('button', { name: /Exporter le package logo/i })
}

/** Tuile d'un préréglage, retrouvée par son libellé. */
function presetTile(label: string): HTMLElement {
  return screen.getByRole('switch', { name: new RegExp(label, 'i') })
}

beforeEach(() => {
  activeDocument = aDocument()
  illustratorReady = true
  panelEnvironment = 'uxp'
  vi.useFakeTimers({ shouldAdvanceTime: true })
})

afterEach(() => {
  vi.useRealTimers()
  vi.clearAllMocks()
})

describe('Panel — document', () => {
  it('affiche « Aucun document ouvert » sans document actif', () => {
    activeDocument = null
    render(<Panel />)

    expect(screen.getByText('Aucun document ouvert')).toBeInTheDocument()
  })

  it('affiche le nom du document actif', () => {
    render(<Panel />)

    expect(screen.getByText('test-logo.ai')).toBeInTheDocument()
  })

  it('affiche le nombre de plans de travail', () => {
    render(<Panel />)

    expect(screen.getByText('2 plans de travail')).toBeInTheDocument()
  })

  it('accorde le libellé au singulier pour un seul plan de travail', () => {
    activeDocument = aDocument({ artboardCount: 1 })
    render(<Panel />)

    expect(screen.getByText('1 plan de travail')).toBeInTheDocument()
  })

  it("re-détecte le document au clic sur le bouton d'actualisation", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    activeDocument = null
    render(<Panel />)

    expect(screen.getByText('Aucun document ouvert')).toBeInTheDocument()

    activeDocument = aDocument({ name: 'marque.ai' })
    await user.click(
      screen.getByRole('button', { name: /Re-détecter le document actif/i }),
    )

    expect(screen.getByText('marque.ai')).toBeInTheDocument()
  })

  it('déduit le nom du package du nom du document, sans extension', () => {
    render(<Panel />)

    expect(screen.getByLabelText('Nom du package')).toHaveValue('test-logo')
  })
})

describe('Panel — en-tête', () => {
  it('affiche un point vert quand Illustrator répond', () => {
    render(<Panel />)

    expect(screen.getByLabelText('Illustrator connecté')).toBeInTheDocument()
  })

  it('affiche un point rouge quand Illustrator est injoignable', () => {
    illustratorReady = false
    panelEnvironment = 'none'
    render(<Panel />)

    expect(screen.getByLabelText('Illustrator injoignable')).toBeInTheDocument()
  })

  it('signale le mode CEP sans prétendre être connecté', () => {
    illustratorReady = false
    panelEnvironment = 'cep'
    render(<Panel />)

    expect(
      screen.getByLabelText('Mode CEP — API Illustrator indisponible'),
    ).toBeInTheDocument()
    expect(screen.getByText('CEP')).toBeInTheDocument()
  })

  it('affiche la version du plugin', () => {
    render(<Panel />)

    expect(screen.getByText(/^v\d+\.\d+\.\d+$/)).toBeInTheDocument()
  })
})

describe('Panel — préréglages', () => {
  it('propose les huit préréglages', () => {
    render(<Panel />)

    expect(screen.getAllByRole('switch')).toHaveLength(8)
  })

  it('active Sources et Web par défaut', () => {
    render(<Panel />)

    expect(presetTile('Sources')).toHaveAttribute('aria-checked', 'true')
    expect(presetTile('Web')).toHaveAttribute('aria-checked', 'true')
    expect(presetTile('Favicon')).toHaveAttribute('aria-checked', 'false')
  })

  it('bascule un préréglage au clic', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    render(<Panel />)

    const favicon = presetTile('Favicon')
    expect(favicon).toHaveAttribute('aria-checked', 'false')

    await user.click(favicon)
    expect(presetTile('Favicon')).toHaveAttribute('aria-checked', 'true')

    await user.click(presetTile('Favicon'))
    expect(presetTile('Favicon')).toHaveAttribute('aria-checked', 'false')
  })

  it('tient le compte des préréglages actifs', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    render(<Panel />)

    expect(screen.getByText('2 / 8')).toBeInTheDocument()

    await user.click(presetTile('Social'))
    expect(screen.getByText('3 / 8')).toBeInTheDocument()
  })
})

describe('Panel — déclinaisons', () => {
  it('coche Full Color par défaut', () => {
    render(<Panel />)

    expect(screen.getByLabelText('Full Color')).toBeChecked()
    expect(screen.getByLabelText('Black')).not.toBeChecked()
  })

  it('laisse « Custom » désactivé, avec son badge de version', () => {
    render(<Panel />)

    // Le libellé accessible inclut le badge de version : « Custom v1.1 ».
    expect(screen.getByLabelText(/Custom/)).toBeDisabled()
    expect(screen.getByText('v1.1')).toBeInTheDocument()
  })

  it('bascule une déclinaison au clic', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    render(<Panel />)

    await user.click(screen.getByLabelText('Black'))
    expect(screen.getByLabelText('Black')).toBeChecked()
  })
})

describe("Panel — activation du bouton d'export", () => {
  it('est actif avec un document, un préréglage et une déclinaison', () => {
    render(<Panel />)

    expect(exportButton()).toBeEnabled()
  })

  it('est désactivé sans document ouvert', () => {
    activeDocument = null
    render(<Panel />)

    expect(exportButton()).toBeDisabled()
  })

  it("est désactivé quand aucun préréglage n'est actif", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    render(<Panel />)

    await user.click(presetTile('Sources'))
    await user.click(presetTile('Web'))

    expect(exportButton()).toBeDisabled()
    expect(screen.getByText('Activez au moins un préréglage.')).toBeInTheDocument()
  })

  it("est désactivé quand aucune déclinaison n'est cochée", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    render(<Panel />)

    await user.click(screen.getByLabelText('Full Color'))

    expect(exportButton()).toBeDisabled()
    expect(screen.getByText('Cochez au moins une déclinaison.')).toBeInTheDocument()
  })

  it('est désactivé quand le nom du package est vide', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    render(<Panel />)

    await user.clear(screen.getByLabelText('Nom du package'))

    expect(exportButton()).toBeDisabled()
  })
})

describe('Panel — destination et aperçu', () => {
  it("indique qu'aucun dossier n'est choisi", () => {
    render(<Panel />)

    expect(screen.getByText('Aucun dossier choisi')).toBeInTheDocument()
  })

  it('résume le plan du pack', () => {
    render(<Panel />)

    expect(screen.getByText(/fichiers · \d+ dossiers/)).toBeInTheDocument()
  })

  it("avertit des formats qu'Illustrator ne sait pas exporter", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    render(<Panel />)

    await user.click(presetTile('Favicon'))

    const warnings = screen.getByRole('list', { name: 'Avertissements' })
    expect(within(warnings).getByText(/ICO/)).toBeInTheDocument()
  })
})
