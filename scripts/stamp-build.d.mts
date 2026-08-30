/** Déclarations de l'empreinte de build. */

export const MARKER: string

export function fingerprint(text: string): string
export function stampBuild(html: string, date: string): { html: string; stamp: string }
export function readStamp(html: string): string
