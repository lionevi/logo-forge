/**
 * Parcours complet : de la capture à la livraison vérifiée.
 *
 * C'est le scénario du designer qui livre un logo : il capture, contrôle les
 * couleurs, passe le contrôle de production, nomme, exporte, puis vérifie ce
 * qui est réellement sur le disque.
 */

import { Scenario } from './assert.mjs'
import { calls, openPanel } from './harness.mjs'

export const title = 'Parcours complet'

export async function run(browser) {
  const scenario = new Scenario(title)
  const { page, faults } = await openPanel(browser)
  page.on('dialog', (dialog) => dialog.accept())

  /* --- Une erreur doit se lire, et se rejouer --- */
  await page.evaluate(() => {
    window.__lfFail.lfSetComponent =
      'selectionnez un objet dans Illustrator avant de definir le composant'
  })
  await page.locator('button:has-text("Set Component")').first().click()
  await page.waitForTimeout(250)

  const fault = await page.locator('#messages .fault').innerText()
  scenario.contains('l erreur dit quoi faire', fault, 'À faire :')
  scenario.ok(
    'le message brut reste replié',
    await page.evaluate(() => document.querySelector('#messages .detail').hidden),
  )
  await page.click('[data-details]')
  scenario.ok(
    'le message brut se déplie',
    await page.evaluate(() => !document.querySelector('#messages .detail').hidden),
  )

  await page.evaluate(() => {
    window.__lfFail = {}
  })
  await page.click('[data-retry]')
  await page.waitForTimeout(300)
  scenario.equal(
    'réessayer rejoue la capture',
    await page.locator('#comp-count').innerText(),
    '1 / 4',
  )

  /* --- Capture : vignette réelle et décompte --- */
  const thumb = await page.evaluate(() => {
    const image = document.querySelector('.comp-thumb')
    return image ? image.getAttribute('src') : ''
  })
  scenario.contains(
    'la vignette vient du fichier exporté',
    thumb,
    'data:image/png;base64,',
  )
  scenario.contains(
    'la carte décrit la capture',
    await page.locator('.comp-card.set .comp-meta').first().innerText(),
    'pt',
  )
  scenario.ok(
    'les icônes sont des SVG, pas des glyphes',
    (await page.evaluate(
      () => document.querySelectorAll('.header-tools svg.icon').length,
    )) > 0,
  )

  /* --- Planche de revue --- */
  await page.click('#build-package')
  await page.waitForTimeout(600)
  scenario.contains(
    'la planche rend compte du remplissage',
    await page.locator('#package-result').innerText(),
    'cellule',
  )

  /* --- Couleurs : contraste et correspondance --- */
  await page.click('[data-tab="colors"]')
  await page.waitForTimeout(150)
  scenario.ok(
    'le contraste est mesuré sur plusieurs fonds',
    (await page.locator('#contrast-list .verdict').count()) >= 3,
  )
  await page.fill('#custom-name', 'Bleu marque')
  await page.click('#add-custom')
  await page.waitForTimeout(150)
  await page.click('[data-map="0"]')
  await page.waitForTimeout(250)
  scenario.contains(
    'la correspondance part des couleurs du document',
    await page.locator('.map-row .map-text').innerText(),
    '#',
  )

  /* --- Contrôle de production --- */
  await page.click('[data-tab="preflight"]')
  await page.waitForTimeout(120)
  await page.click('#run-preflight')
  await page.waitForTimeout(300)
  scenario.ok(
    'le contrôle propose des corrections',
    (await page.locator('.button.fix').count()) > 0,
  )
  await page.click('.button.fix')
  await page.waitForTimeout(300)
  scenario.ok(
    'une correction passe par Illustrator',
    (await calls(page, 'lfClean')).length +
      (await calls(page, 'lfFitArtboard')).length >
      0,
  )

  /* --- Export --- */
  await page.click('[data-tab="components"]')
  await page.click('#open-export')
  await page.waitForTimeout(150)
  await page.fill('#client-name', 'Acme')
  await page.click('#choose-folder')
  await page.waitForTimeout(200)
  const summary = await page.locator('#export-summary').innerText()
  scenario.contains('le nombre de fichiers est annoncé', summary, 'fichiers')

  await page.click('#start-export')
  await page.waitForTimeout(4000)
  const done = await page.locator('#done-panel').innerText()
  scenario.contains(
    'le pack est contrôlé sur le disque',
    done,
    'vérifiés sur le disque',
  )
  scenario.contains('le rapport est écrit', done, 'export-rapport.html')
  scenario.contains('la documentation est écrite', done, 'LISEZ-MOI.md')
  scenario.ok(
    'le favicon.ico est assemblé',
    (await calls(page, 'lfWriteIco')).length === 1,
  )

  /* --- Persistance --- */
  await page.reload()
  await page.waitForTimeout(900)
  scenario.equal(
    'les captures survivent à la fermeture',
    await page.locator('#comp-count').innerText(),
    '1 / 4',
  )

  scenario.ok('aucune erreur de page', faults.length === 0, faults.join(' | '))
  await page.close()
  return scenario
}
