/**
 * Kit réseaux sociaux.
 *
 * Ce qui est vérifié : que chaque canevas est créé à la taille de sa
 * plateforme, peint, rempli puis refermé, et que le fond transparent est bien
 * un choix qui se voit dans les appels.
 */

import { Scenario } from './assert.mjs'
import { calls, openPanel } from './harness.mjs'

export const title = 'Kit réseaux sociaux'

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
  await page.click('#cancel-export')
  await page.waitForTimeout(150)

  await page.click('#open-settings')
  await page.waitForTimeout(150)
  await page.click('[data-sub="social"]')
  await page.waitForTimeout(150)

  scenario.ok(
    'les formats des plateformes sont proposés',
    (await page.locator('#social-presets .check').count()) >= 6,
  )
  await page.click('[data-social="xHeader"]')
  await page.waitForTimeout(150)
  scenario.contains(
    'le nombre de canevas est annoncé',
    await page.locator('#social-result').innerText(),
    'canevas seront produits',
  )

  await page.click('#build-social')
  await page.waitForTimeout(3000)
  scenario.contains(
    'les canevas sont produits, avec leur poids',
    await page.locator('#social-result').innerText(),
    'canevas produits',
  )

  const exported = (await calls(page, 'lfExportPNG')).map(
    (call) => (call.match(/"([^"]+\.png)"/) || [])[1] || '',
  )
  scenario.ok(
    'la bannière porte les dimensions de la plateforme',
    exported.some((path) => path.indexOf('xHeader_1500x500.png') >= 0),
    exported.join(' '),
  )

  const sequence = (await calls(page))
    .map((call) => call.split('(')[0])
    .filter((name) =>
      [
        'lfCreatePackage',
        'lfPackageBackground',
        'lfPlaceComponent',
        'lfExportPNG',
        'lfAbortPackage',
      ].includes(name),
    )
  scenario.equal(
    'chaque canevas est créé, peint, rempli, exporté, refermé',
    sequence.slice(0, 5).join(' '),
    'lfCreatePackage lfPackageBackground lfPlaceComponent lfExportPNG lfAbortPackage',
  )

  await page.evaluate(() => {
    window.__lfCalls.length = 0
  })
  await page.click('#social-transparent')
  await page.waitForTimeout(150)
  scenario.ok(
    'la couleur de fond est désactivée quand il est transparent',
    await page.evaluate(() => document.getElementById('social-background').disabled),
  )
  await page.click('#build-social')
  await page.waitForTimeout(3000)
  scenario.equal(
    'aucun fond n est peint',
    (await calls(page, 'lfPackageBackground')).length,
    0,
  )

  scenario.ok('aucune erreur de page', faults.length === 0, faults.join(' | '))
  await page.close()
  return scenario
}
