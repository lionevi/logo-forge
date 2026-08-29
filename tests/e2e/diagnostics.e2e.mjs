/**
 * Diagnostics, planche de prévisualisation et couleurs personnalisées.
 *
 * Ce qui est vérifié : que le témoin de démarrage disparaît quand le panneau
 * est monté, que l'essai d'export écrit et rend des tailles, que le journal
 * recopie les étapes de la planche, et qu'une couleur personnalisée parvient
 * bien jusqu'à Illustrator — avec la teinte exacte, celle qu'attend la couche
 * ExtendScript.
 */

import { Scenario } from './assert.mjs'
import { calls, openPanel } from './harness.mjs'

export const title = 'Diagnostics, planche et couleurs personnalisées'

export async function run(browser) {
  const scenario = new Scenario(title)
  const { page, faults } = await openPanel(browser)

  scenario.equal(
    'le témoin de démarrage a disparu, le panneau est monté',
    await page.locator('#lf-startup-check').count(),
    0,
  )

  /* ------------------------------------------------------------------ *
   * Couleur personnalisée, jusqu'à Illustrator
   * ------------------------------------------------------------------ */

  await page.click('.tab[data-tab="colors"]')
  await page.waitForTimeout(150)
  await page.click('#add-custom')
  await page.waitForTimeout(150)
  scenario.equal(
    'un nom vide est refusé, sans rien ajouter',
    await page.locator('.custom-entry').count(),
    0,
  )
  scenario.contains(
    'le refus se lit à côté du formulaire',
    await page.locator('#custom-refusal').innerText(),
    'Donnez un nom',
  )

  await page.fill('#custom-name', 'Bleu marque')
  await page.fill('#custom-hex', '#2680eb')
  await page.click('#add-custom')
  await page.waitForTimeout(200)
  scenario.equal(
    'la couleur nommée est ajoutée',
    await page.locator('.custom-entry').count(),
    1,
  )
  scenario.contains(
    'elle garde son nom',
    await page.locator('.custom-entry .row-name').inputValue(),
    'Bleu marque',
  )

  await page.evaluate(() => {
    window.__lfCalls.length = 0
  })
  await page.click('.tab[data-tab="components"]')
  await page.waitForTimeout(150)
  await page.locator('[data-set]').first().click()
  await page.waitForTimeout(500)

  const built = (await calls(page, 'lfBuildPreview'))[0] || ''
  scenario.contains(
    'la planche reçoit la couleur personnalisée',
    built,
    'custom:#2680eb:Bleu marque',
  )

  /* ------------------------------------------------------------------ *
   * Journal de la planche
   * ------------------------------------------------------------------ */

  await page.click('#open-settings')
  await page.waitForTimeout(150)
  await page.click('[data-sub="diag"]')
  await page.waitForTimeout(150)
  await page.click('#refresh-log')
  await page.waitForTimeout(200)

  const journal = await page.locator('#log-view').innerText()
  for (const step of ['preview-doc: début', 'preview-doc: document créé']) {
    scenario.contains('le journal porte « ' + step + ' »', journal, step)
  }

  /* ------------------------------------------------------------------ *
   * Essai d'export
   * ------------------------------------------------------------------ */

  await page.click('#test-export')
  await page.waitForTimeout(500)

  const report = await page.locator('#test-export-result').innerText()
  scenario.contains('le SVG est écrit, avec sa taille', report, 'SVG')
  scenario.contains('la taille est lisible', report, 'Ko')
  scenario.contains(
    'le format refusé est nommé, pas masqué',
    report,
    'format refusé par cette version',
  )
  scenario.contains('l échec est compté', report, '1 export(s) sur 3 en échec')

  scenario.ok('aucune erreur de page', faults.length === 0, faults.join(' | '))
  await page.close()
  return scenario
}
