/**
 * Reprise d'un lot interrompu.
 *
 * Le disque tombe en panne au milieu d'un export ; le panneau est rechargé,
 * comme après un plantage d'Illustrator. Ce qui est vérifié : que la trace
 * survit, qu'elle est confrontée au disque, et que la reprise ne réécrit que
 * ce qui manque.
 */

import { Scenario } from './assert.mjs'
import { calls, openPanel } from './harness.mjs'

export const title = 'Reprise après interruption'

export async function run(browser) {
  const scenario = new Scenario(title)
  const { page, faults } = await openPanel(browser)

  await page.locator('button:has-text("Set Component")').first().click()
  await page.waitForTimeout(300)
  await page.click('#open-export')
  await page.waitForTimeout(150)
  await page.fill('#client-name', 'Acme')
  await page.click('#choose-folder')
  await page.waitForTimeout(200)

  // Le disque refuse d'écrire après cinq fichiers.
  await page.evaluate(() => {
    window.__lfDiskFull = 5
  })
  await page.click('#start-export')
  await page.waitForTimeout(4000)

  const trace = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('logo-forge-run') || 'null'),
  )
  scenario.ok('le lot laisse une trace', trace !== null)
  scenario.ok(
    'la trace décrit le lot entier',
    trace && trace.total > trace.done.length,
    trace ? trace.done.length + ' / ' + trace.total : '',
  )
  const firstPass = (await calls(page, 'lfExport')).length

  await page.evaluate(() => {
    delete window.__lfDiskFull
  })
  await page.reload()
  await page.waitForTimeout(1200)

  const offer = await page.locator('#resume-run').innerText()
  scenario.contains('la reprise est proposée', offer, 'Export interrompu')
  scenario.contains('elle dit ce qui reste', offer, 'à produire')

  await page.click('#do-resume')
  await page.waitForTimeout(5000)

  const secondPass = (await calls(page, 'lfExport')).length
  scenario.ok(
    'la reprise ne réécrit que le reste',
    secondPass > 0 && secondPass < firstPass,
    secondPass + ' exports contre ' + firstPass + ' au premier essai',
  )
  scenario.contains(
    'le pack est complet et vérifié',
    await page.locator('#done-panel').innerText(),
    'vérifiés sur le disque',
  )
  scenario.ok(
    'la trace disparaît une fois le pack complet',
    (await page.evaluate(() => localStorage.getItem('logo-forge-run'))) === null,
  )

  scenario.ok('aucune erreur de page', faults.length === 0, faults.join(' | '))
  await page.close()
  return scenario
}
