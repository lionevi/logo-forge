/**
 * Types du contrôle de démarrage du panneau.
 *
 * Le script est en JavaScript pour tourner sans compilation pendant le build ;
 * ses épreuves sont en TypeScript. Cette déclaration réconcilie les deux.
 */

export interface Rendered {
  cards: number
  nativeColorFields: number
  tabs: number
  bodyLength: number
  fatal: string
  beacon: string
  stored: Record<string, string>
}

export interface BootResult {
  faults: string[]
  rendered: Rendered
}

export interface BootOptions {
  baseDirectory?: string
  storage?: Record<string, string>
  act?: (window: unknown) => void
}

export function bootPanel(html: string, options?: BootOptions): Promise<BootResult>
export function judge(result: BootResult): string[]
