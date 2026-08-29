/**
 * Ce que contient l'extension livrée.
 *
 * `dist/` porte deux plugins : celui que CEP charge, et la chaîne UXP gardée
 * pour un portage. L'archive ne doit emporter que le premier — emporter le
 * second ajouterait un bundle React entier à une extension qui ne s'en sert
 * pas.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const SCRIPT = readFileSync(
  resolve(import.meta.dirname, '../scripts/package-ccx.ts'),
  'utf8',
)
const MANIFEST = readFileSync(
  resolve(import.meta.dirname, '../src/cep/manifest.xml'),
  'utf8',
)

describe('archive de l’extension', () => {
  it('exige les fichiers sans lesquels rien ne se charge', () => {
    for (const file of [
      'CSXS/manifest.xml',
      'index.html',
      'js/export-engine.js',
      'jsx/main.jsx',
    ]) {
      expect(SCRIPT, file).toContain(`'${file}'`)
    }
    expect(SCRIPT).toContain('l extension ne se chargerait pas')
  })

  it('écarte la chaîne UXP, que le descripteur ne mentionne pas', () => {
    expect(SCRIPT).toContain('UXP_ONLY')
    for (const file of ['index.js', 'manifest.json', 'panel-react.html']) {
      expect(SCRIPT, file).toContain(`'${file}'`)
    }
    expect(SCRIPT).toContain("name.startsWith('assets/')")
  })

  it('prend la version là où l’hôte la lit', () => {
    // Le descripteur CEP fait foi : c'est lui qu'Illustrator ouvre.
    expect(SCRIPT).toContain('ExtensionBundleVersion="([^"]+)"')
    expect(MANIFEST).toContain('ExtensionBundleVersion=')
  })

  it('le descripteur désigne bien le panneau vanilla', () => {
    expect(MANIFEST).toContain('<MainPath>./index.html</MainPath>')
    expect(MANIFEST).toContain('<ScriptPath>./jsx/main.jsx</ScriptPath>')
    expect(MANIFEST).not.toContain('panel-react')
  })
})
