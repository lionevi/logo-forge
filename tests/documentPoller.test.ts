/**
 * Tests du sondage du document actif.
 *
 * Le sondage tourne toutes les deux secondes dans un hôte dont on ne maîtrise
 * rien : il doit survivre à tout, et renoncer proprement plutôt que de
 * s'acharner.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'

import { setIllustratorHost } from '../src/illustrator/host'
import { POLL_FAILURE_LIMIT, createDocumentPoller } from '../src/ui/illustratorBridge'

/** Minuteur manuel : chaque `tick()` déclenche un tour de sondage. */
function manualTimer() {
  let callback: (() => void) | null = null
  let cancelled = false

  return {
    get cancelled() {
      return cancelled
    },
    tick() {
      callback?.()
    },
    schedule: (fn: () => void) => {
      callback = fn
      return 1
    },
    cancel: () => {
      cancelled = true
      callback = null
    },
  }
}

afterEach(() => {
  setIllustratorHost(null)
  vi.restoreAllMocks()
})

describe('createDocumentPoller', () => {
  it('transmet le document lu à chaque tour', () => {
    const timer = manualTimer()
    const onDocument = vi.fn()

    createDocumentPoller({
      intervalMs: 2000,
      onDocument,
      schedule: timer.schedule,
      cancel: timer.cancel,
    })

    timer.tick()
    timer.tick()

    // Hors Illustrator, la lecture renvoie null sans lever.
    expect(onDocument).toHaveBeenCalledTimes(2)
    expect(onDocument).toHaveBeenCalledWith(null)
  })

  it('ne laisse pas une erreur du consommateur interrompre le minuteur', () => {
    const timer = manualTimer()
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    let calls = 0

    createDocumentPoller({
      intervalMs: 2000,
      onDocument: () => {
        calls += 1
        throw new Error('rendu impossible')
      },
      schedule: timer.schedule,
      cancel: timer.cancel,
    })

    timer.tick()
    timer.tick()

    expect(calls).toBe(2)
    expect(timer.cancelled).toBe(false)
  })

  it(`renonce après ${POLL_FAILURE_LIMIT} échecs consécutifs`, () => {
    const timer = manualTimer()
    const onDisabled = vi.fn()
    vi.spyOn(console, 'warn').mockImplementation(() => {})

    createDocumentPoller({
      intervalMs: 2000,
      onDocument: () => {
        throw new Error('API absente')
      },
      onDisabled,
      schedule: timer.schedule,
      cancel: timer.cancel,
    })

    for (let i = 0; i < POLL_FAILURE_LIMIT; i += 1) timer.tick()

    expect(timer.cancelled).toBe(true)
    expect(onDisabled).toHaveBeenCalledTimes(1)
    expect(onDisabled).toHaveBeenCalledWith('API absente')
    expect(console.warn).toHaveBeenCalledWith(
      '[Logo Forge] CEP mode - polling disabled',
    )
  })

  it('remet le compteur à zéro après un tour réussi', () => {
    const timer = manualTimer()
    const onDisabled = vi.fn()
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    let shouldFail = true

    createDocumentPoller({
      intervalMs: 2000,
      onDocument: () => {
        if (shouldFail) throw new Error('échec transitoire')
      },
      onDisabled,
      schedule: timer.schedule,
      cancel: timer.cancel,
    })

    timer.tick()
    timer.tick()
    shouldFail = false
    timer.tick()
    shouldFail = true
    timer.tick()
    timer.tick()

    // Deux échecs, un succès, puis deux échecs : jamais trois d'affilée.
    expect(timer.cancelled).toBe(false)
    expect(onDisabled).not.toHaveBeenCalled()
  })

  it("n'ébruite pas une erreur levée par onDisabled", () => {
    const timer = manualTimer()
    vi.spyOn(console, 'warn').mockImplementation(() => {})

    createDocumentPoller({
      intervalMs: 2000,
      onDocument: () => {
        throw new Error('API absente')
      },
      onDisabled: () => {
        throw new Error('interface cassée')
      },
      schedule: timer.schedule,
      cancel: timer.cancel,
    })

    expect(() => {
      for (let i = 0; i < POLL_FAILURE_LIMIT; i += 1) timer.tick()
    }).not.toThrow()
  })

  it('cesse tout appel une fois arrêté', () => {
    const timer = manualTimer()
    const onDocument = vi.fn()

    const poller = createDocumentPoller({
      intervalMs: 2000,
      onDocument,
      schedule: timer.schedule,
      cancel: timer.cancel,
    })

    timer.tick()
    poller.stop()
    timer.tick()

    expect(onDocument).toHaveBeenCalledTimes(1)
    expect(timer.cancelled).toBe(true)
  })

  it('supporte plusieurs arrêts successifs', () => {
    const timer = manualTimer()
    const poller = createDocumentPoller({
      intervalMs: 2000,
      onDocument: vi.fn(),
      schedule: timer.schedule,
      cancel: timer.cancel,
    })

    expect(() => {
      poller.stop()
      poller.stop()
    }).not.toThrow()
  })
})
