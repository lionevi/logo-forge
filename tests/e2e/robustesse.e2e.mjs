/**
 * Conditions dégradées.
 *
 * Un enregistrement abîmé, un stockage qui refuse d'écrire, un hôte absent :
 * rien de tout cela ne doit laisser le panneau inutilisable — et surtout pas
 * de façon durable, puisque l'état fautif est relu à chaque ouverture.
 */

import { Scenario } from './assert.mjs'
import { hostScript, PANEL } from './harness.mjs'

export const title = 'Conditions dégradées'

/** Ouvre le panneau après avoir semé ce qu'il faut dans le stockage. */
async function panelWith(browser, seed, options) {
  const page = await browser.newPage({ viewport: { width: 320, height: 640 } })
  const faults = []
  page.on('pageerror', (error) => faults.push('pageerror: ' + error.message))

  if (!options || options.host !== false) await page.addInitScript(hostScript())
  if (seed) await page.addInitScript(seed)

  await page.goto('file://' + PANEL)
  await page.waitForTimeout(700)
  return { page, faults }
}

const fatal = (page) =>
  page.evaluate(() => {
    const box = document.getElementById('fatal')
    return box ? box.innerText : ''
  })

export async function run(browser) {
  const scenario = new Scenario(title)

  /* --- Enregistrement illisible --- */
  {
    const { page, faults } = await panelWith(browser, () => {
      localStorage.setItem('logo-forge-project', '{ ceci n est pas du JSON')
    })
    scenario.equal('un enregistrement illisible est ignoré', await fatal(page), '')
    scenario.equal(
      'le panneau repart des valeurs par défaut',
      await page.locator('#comp-count').innerText(),
      '0 / 4',
    )
    scenario.ok('aucune erreur de page', faults.length === 0, faults.join(' | '))
    await page.close()
  }

  /* --- Enregistrement lisible, mais de la mauvaise forme --- */
  {
    const { page, faults } = await panelWith(browser, () => {
      localStorage.setItem(
        'logo-forge-project',
        JSON.stringify({
          version: 2,
          settings: {
            formats: 'plus un objet',
            scales: { plus: 'un tableau' },
            padding: 42,
            studio: 'texte',
            clientName: 12,
            separator: null,
          },
          components: [
            { name: 'Logo', path: '/tmp/lf/Logo.ai', width: 'large', height: null },
            { path: '/tmp/sans-nom.ai' },
            null,
          ],
        }),
      )
    })

    scenario.equal('une forme inattendue ne bloque pas', await fatal(page), '')
    const card = await page.locator('.comp-card').first().innerText()
    scenario.ok(
      'les dimensions relues restent des nombres',
      card.indexOf('NaN') < 0,
      card.replace(/\n/g, ' | '),
    )
    scenario.ok(
      'une entrée sans nom est écartée',
      (await page.locator('.comp-card').count()) === 1,
    )
    scenario.ok('aucune erreur de page', faults.length === 0, faults.join(' | '))
    await page.close()
  }

  /* --- Stockage qui refuse d'écrire --- */
  {
    const { page, faults } = await panelWith(browser, () => {
      const refuse = () => {
        throw new Error('QuotaExceededError')
      }
      Object.defineProperty(window.localStorage, 'setItem', { value: refuse })
    })
    scenario.equal('un stockage en refus ne bloque pas', await fatal(page), '')
    await page.locator('button:has-text("Set Component")').first().click()
    await page.waitForTimeout(300)
    scenario.equal(
      'et le travail continue',
      await page.locator('#comp-count').innerText(),
      '1 / 4',
    )
    scenario.ok('aucune erreur de page', faults.length === 0, faults.join(' | '))
    await page.close()
  }

  /* --- Aucun hôte : le panneau doit s'ouvrir quand même --- */
  {
    const { page, faults } = await panelWith(browser, null, { host: false })
    scenario.equal('sans hôte, le panneau s ouvre', await fatal(page), '')
    scenario.contains(
      'et il annonce l absence de document',
      await page.locator('#document-card').innerText(),
      'Aucun document ouvert',
    )
    scenario.ok('aucune erreur de page', faults.length === 0, faults.join(' | '))
    await page.close()
  }

  /* --- Un élément d interface manquant --- */
  {
    const { page, faults } = await panelWith(browser, () => {
      // Un élément attendu disparaît. Le panneau câble ses gestionnaires hors
      // de tout garde-fou : sans précaution, le script s arrêtait là, écran
      // vide et aucun message.
      const real = document.getElementById.bind(document)
      document.getElementById = (id) => (id === 'open-settings' ? null : real(id))
      // Semé une seule fois : le script d initialisation rejoue à chaque
      // navigation, et remettrait le marqueur juste après l avoir effacé.
      if (localStorage.getItem('__seme') !== '1') {
        localStorage.setItem('__seme', '1')
        localStorage.setItem(
          'logo-forge-project',
          JSON.stringify({ version: 2, settings: { brandName: 'MARQUEUR' } }),
        )
      }
    })

    scenario.contains('l absence est dite', await fatal(page), 'Interface incomplète')
    scenario.contains('elle nomme l élément', await fatal(page), 'open-settings')
    scenario.equal(
      'le reste du panneau fonctionne',
      await page.locator('#comp-count').innerText(),
      '0 / 4',
    )
    scenario.ok(
      'une porte de sortie est proposée',
      (await page.locator('#forget-project').count()) === 1,
    )

    await page.click('#forget-project')
    await page.waitForTimeout(900)
    const stored = await page.evaluate(() => localStorage.getItem('logo-forge-project'))
    scenario.ok(
      'elle efface l état enregistré',
      String(stored).indexOf('MARQUEUR') < 0,
      String(stored).slice(0, 120),
    )
    scenario.ok('aucune erreur de page', faults.length === 0, faults.join(' | '))
    await page.close()
  }

  return scenario
}
