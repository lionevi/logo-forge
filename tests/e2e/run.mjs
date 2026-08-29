#!/usr/bin/env node
/**
 * Lance les scénarios de bout en bout.
 *
 * Ils ne font pas partie de `npm test` : ils demandent un navigateur, que
 * l'intégration continue n'a pas. Ils se lancent à la main, après un build :
 *
 *     npm run build && npm run test:e2e
 *
 * Prérequis : `playwright-core` (ou `playwright`) installé, et un Chromium
 * sur la machine. À défaut, la commande le dit et s'arrête — elle ne
 * télécharge rien et ne prétend pas avoir vérifié quoi que ce soit.
 */

import { existsSync } from 'node:fs'

import { findChromium, loadPlaywright, PANEL } from './harness.mjs'
import * as parcours from './parcours.e2e.mjs'
import * as reprise from './reprise.e2e.mjs'
import * as robustesse from './robustesse.e2e.mjs'
import * as social from './social.e2e.mjs'

const SCENARIOS = [parcours, reprise, social, robustesse]

function stop(message) {
  console.error(message)
  process.exit(2)
}

if (!existsSync(PANEL)) {
  stop('Panneau introuvable : ' + PANEL + '\nLancez d abord « npm run build ».')
}

const playwright = await loadPlaywright()
if (!playwright) {
  stop(
    'playwright-core est absent.\n' +
      'Installez-le pour lancer ces scénarios : npm i -D playwright-core',
  )
}

const executablePath = findChromium()
if (!executablePath) {
  stop(
    'Aucun Chromium trouvé.\n' +
      'Indiquez-en un : LOGO_FORGE_CHROMIUM=/chemin/vers/chrome npm run test:e2e',
  )
}

console.log('Panneau   : ' + PANEL)
console.log('Navigateur: ' + executablePath)

// Selon le mode de chargement, `chromium` est exposé à la racine du module
// ou sous son export par défaut.
const chromium =
  playwright.chromium || (playwright.default && playwright.default.chromium)
if (!chromium) stop('Module Playwright inutilisable : « chromium » introuvable.')

const browser = await chromium.launch({ executablePath: executablePath })
let failed = 0

for (const scenario of SCENARIOS) {
  let report
  try {
    report = await scenario.run(browser)
  } catch (error) {
    console.log('\n' + scenario.title + '\n  [ECHEC] ' + error.message)
    failed += 1
    continue
  }
  console.log(report.report())
  failed += report.failures.length
}

await browser.close()

console.log('')
if (failed > 0) {
  console.error(failed + ' vérification(s) en échec.')
  process.exit(1)
}
console.log('Tous les scénarios passent.')
