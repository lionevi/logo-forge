/** Déclarations du contrôle de compatibilité ExtendScript. */

export interface Es3Fault {
  file: string
  line: number
  message: string
}

export function checkSource(source: string, label: string): Es3Fault[]
export function checkAll(): Es3Fault[]
