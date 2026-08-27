import { afterEach, describe, expect, it } from 'vitest'

import {
  isIllustratorAvailable,
  loadIllustratorHost,
  setIllustratorHost,
} from '../src/illustrator/host'
import { createMockHost } from './illustratorHostMock'

afterEach(() => {
  setIllustratorHost(null)
})

describe('setIllustratorHost', () => {
  it('rend la doublure disponible', () => {
    const host = createMockHost()
    setIllustratorHost(host)

    expect(isIllustratorAvailable()).toBe(true)
    expect(loadIllustratorHost()).toBe(host)
  })

  it('restaure le chargement normal quand on repasse null', () => {
    setIllustratorHost(createMockHost())
    setIllustratorHost(null)

    // Hors d'Illustrator, aucun module « illustrator » n'est résoluble.
    expect(isIllustratorAvailable()).toBe(false)
  })
})

describe('loadIllustratorHost', () => {
  it("échoue avec un message exploitable hors d'Illustrator", () => {
    setIllustratorHost(null)

    expect(() => loadIllustratorHost()).toThrow(/illustrator/i)
  })

  it('accepte une doublure remplacée en cours de route', () => {
    const first = createMockHost()
    const second = createMockHost()

    setIllustratorHost(first)
    expect(loadIllustratorHost()).toBe(first)

    setIllustratorHost(second)
    expect(loadIllustratorHost()).toBe(second)
  })
})
