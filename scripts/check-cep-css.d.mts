/** Déclarations du contrôle de mise en page CEP. */

export interface CssFault {
  file: string
  message: string
  fixable: boolean
}

export const FORBIDDEN: Array<{ find: RegExp; fix: string | null; label: string }>
export const REQUIRED: Array<{ label: string; test: RegExp }>

export function checkPanel(html: string, label: string): CssFault[]
export function fixPanel(html: string): { html: string; applied: string[] }
