/**
 * Sélecteur de couleur, mené à la souris et au clavier.
 *
 * Ce qui est vérifié : qu'on peut réellement choisir une couleur dans le
 * panneau — glisser dans le carré, cliquer la teinte, taper un hexadécimal ou
 * trois composantes — et que la couleur validée arrive dans le projet. Ce
 * qu'aucune lecture de code ne prouve : les gestes.
 */

import { Scenario } from './assert.mjs'
import { openPanel } from './harness.mjs'

export const title = 'Sélecteur de couleur'

/** Valeurs affichées par le sélecteur, telles que l'écran les montre. */
function readPicker(page) {
  return page.evaluate(() => ({
    ouvert: document.getElementById('color-veil').className.indexOf('on') >= 0,
    hex: document.getElementById('cp-hex').value,
    rouge: document.getElementById('cp-r').value,
    vert: document.getElementById('cp-g').value,
    bleu: document.getElementById('cp-b').value,
    apercu: document.getElementById('cp-preview').style.background,
    teinte: document.getElementById('cp-hue').getAttribute('aria-valuenow'),
  }))
}

export async function run(browser) {
  const scenario = new Scenario(title)
  const { page, faults } = await openPanel(browser)

  await page.click('.tab[data-tab="colors"]')
  await page.waitForTimeout(150)

  scenario.equal(
    'aucun champ couleur natif ne subsiste',
    await page.locator('input[type=color]').count(),
    0,
  )

  await page.click('#custom-hex')
  await page.waitForTimeout(200)
  const opened = await readPicker(page)
  scenario.ok('la pastille ouvre le sélecteur', opened.ouvert)
  scenario.equal('il s ouvre sur la couleur du champ', opened.hex, '#2680eb')
  scenario.equal('les composantes suivent', opened.rouge + ',' + opened.vert + ',' + opened.bleu, '38,128,235')

  /* Glissement dans le carré saturation / luminosité. */
  const area = await page.locator('#cp-area').boundingBox()
  await page.mouse.move(area.x + 4, area.y + area.height - 4)
  await page.mouse.down()
  await page.mouse.move(area.x + area.width - 4, area.y + 4, { steps: 6 })
  await page.mouse.up()
  await page.waitForTimeout(120)
  const dragged = await readPicker(page)
  scenario.ok(
    'le glissement monte la saturation et la luminosité',
    parseInt(dragged.bleu, 10) > 200 && parseInt(dragged.rouge, 10) < 60,
    dragged.hex,
  )
  scenario.contains('l aperçu suit en temps réel', dragged.apercu, 'rgb(')

  /* Glissière de teinte. */
  const hue = await page.locator('#cp-hue').boundingBox()
  await page.mouse.click(hue.x + hue.width * 0.33, hue.y + hue.height / 2)
  await page.waitForTimeout(120)
  const green = await readPicker(page)
  scenario.ok(
    'un tiers de la glissière donne un vert',
    parseInt(green.vert, 10) > 200 && parseInt(green.rouge, 10) < 60,
    green.hex,
  )

  /* Saisie hexadécimale au clavier. */
  await page.fill('#cp-hex', '')
  await page.type('#cp-hex', '#ff8800')
  await page.waitForTimeout(150)
  const typed = await readPicker(page)
  scenario.equal(
    'la saisie hexadécimale met les composantes à jour',
    typed.rouge + ',' + typed.vert + ',' + typed.bleu,
    '255,136,0',
  )
  scenario.equal('et la teinte se replace', typed.teinte, '32')

  /* Saisie d'une composante au clavier. */
  await page.fill('#cp-g', '')
  await page.type('#cp-g', '200')
  await page.waitForTimeout(150)
  scenario.equal(
    'la saisie d une composante met l hexadécimal à jour',
    (await readPicker(page)).hex,
    '#ffc800',
  )

  /* Clavier sur la glissière. */
  await page.focus('#cp-hue')
  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('ArrowRight')
  scenario.equal(
    'les flèches déplacent la teinte',
    (await readPicker(page)).teinte,
    '49',
  )

  /* Annuler ne laisse aucune trace. */
  await page.click('#cp-cancel')
  await page.waitForTimeout(150)
  scenario.equal(
    '« Annuler » laisse le champ intact',
    await page.evaluate(() => document.getElementById('custom-hex').value),
    '#2680eb',
  )

  /* Valider applique. */
  await page.click('#custom-hex')
  await page.waitForTimeout(150)
  await page.fill('#cp-hex', '#7b61ff')
  await page.waitForTimeout(120)
  await page.click('#cp-apply')
  await page.waitForTimeout(150)
  scenario.equal(
    '« Valider » applique la couleur au champ',
    await page.evaluate(() => document.getElementById('custom-hex').value),
    '#7b61ff',
  )

  await page.fill('#custom-name', 'Violet')
  await page.click('#add-custom')
  await page.waitForTimeout(200)
  scenario.equal(
    'et la couleur choisie devient une déclinaison',
    await page.evaluate(
      () =>
        (JSON.parse(localStorage.getItem('logo-forge-project') || '{}')
          .customs || [])[0].hex,
    ),
    '#7b61ff',
  )

  /* La pastille d'une ligne existante rouvre le sélecteur sur sa couleur. */
  await page.click('.custom-entry .chip')
  await page.waitForTimeout(200)
  scenario.equal(
    'la pastille d une ligne ouvre le sélecteur sur sa couleur',
    (await readPicker(page)).hex,
    '#7b61ff',
  )
  await page.fill('#cp-hex', '#00a86b')
  await page.waitForTimeout(120)
  await page.click('#cp-apply')
  await page.waitForTimeout(250)
  scenario.equal(
    'et la ligne prend la nouvelle couleur',
    await page.evaluate(
      () =>
        JSON.parse(localStorage.getItem('logo-forge-project') || '{}')
          .customs[0].hex,
    ),
    '#00a86b',
  )

  /* Échap referme sans appliquer. */
  await page.click('.custom-entry .chip')
  await page.waitForTimeout(200)
  await page.keyboard.press('Escape')
  await page.waitForTimeout(150)
  scenario.ok(
    'Échap referme sans appliquer',
    !(await readPicker(page)).ouvert &&
      (await page.evaluate(
        () =>
          JSON.parse(localStorage.getItem('logo-forge-project') || '{}')
            .customs[0].hex,
      )) === '#00a86b',
  )

  scenario.ok('aucune erreur de page', faults.length === 0, faults.join(' | '))
  await page.close()
  return scenario
}
