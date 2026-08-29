#!/usr/bin/env node
/**
 * Fait démarrer le panneau construit, et refuse de livrer un panneau vide.
 *
 * Le corps du panneau est rempli par son script : une exception au démarrage
 * laisse l'en-tête et un fond gris, sans rien dire. Les contrôles de mise en
 * page et de compatibilité ne voient pas ce cas — ils lisent le fichier, ils
 * ne l'exécutent pas.
 *
 * Celui-ci charge `dist/index.html` dans un DOM, avec un hôte CEP simulé, puis
 * regarde ce qui a réellement été rendu. Aucun navigateur n'est nécessaire :
 * il tourne partout où le build tourne, intégration continue comprise.
 *
 * Deux ouvertures sont éprouvées, car ce ne sont pas les mêmes chemins de
 * code : la première, stockage vide, et la seconde, après un redémarrage
 * d'Illustrator, où le panneau relit le projet enregistré. C'est la seconde
 * qui manquait : un panneau qui s'ouvre bien une fois peut rester vide à
 * toutes les suivantes.
 *
 *     node scripts/check-panel-boot.mjs
 */

import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { JSDOM, VirtualConsole } from 'jsdom'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const BUILT = resolve(ROOT, 'dist/index.html')

/** Réponses de l'hôte simulé, réduites à ce que le démarrage demande. */
const UNIT = String.fromCharCode(31)
const ANSWERS = {
  lfPing: 'OK|pong',
  lfGetLocale: 'OK|fr_FR',
  lfGetDocumentInfo: 'OK|' + ['brand.ai', '/tmp/brand.ai', 'rgb', '2'].join(UNIT),
  lfListColors: 'OK|' + ['#2680eb:12', '#1d1d1d:8'].join(UNIT),
  lfPathExists: 'OK|0',
}

/**
 * Remplace chaque `<script src>` par le fichier qu'il désigne.
 *
 * CEP sert le panneau depuis un dossier : `js/export-engine.js` est un vrai
 * fichier posé à côté de `index.html`. On le lit sur le disque et on l'insère,
 * ce qui reproduit le chargement de l'extension et signale un dossier `js/`
 * absent — la panne exacte qui vide le panneau chez un tiers.
 *
 * @param html document construit.
 * @param baseDirectory dossier livré, celui qui contient `index.html`.
 * @param faults journal des manques constatés.
 */
function inlineExternalScripts(html, baseDirectory, faults) {
  return html.replace(/<script\s+src="([^"]+)"\s*><\/script>/g, (whole, source) => {
    const file = resolve(baseDirectory, source.replace(/^\.\//, ''))
    if (!existsSync(file)) {
      faults.push(`script absent du paquet : ${source}`)
      return ''
    }
    return '<script>\n' + readFileSync(file, 'utf8') + '\n</script>'
  })
}

/**
 * Démarre le panneau et rend ce qu'il a produit.
 *
 * @param html document à éprouver.
 * @param options.baseDirectory dossier d'où proviennent ses scripts.
 * @param options.storage entrées à déposer avant le démarrage, comme les
 *   trouverait un panneau rouvert après un redémarrage d'Illustrator.
 * @param options.act geste à jouer une fois le panneau vivant, pour lui faire
 *   enregistrer un projet.
 */
export async function bootPanel(html, options) {
  const settings = options || {}
  const baseDirectory = settings.baseDirectory || dirname(BUILT)
  const faults = []
  const virtualConsole = new VirtualConsole()
  virtualConsole.on('jsdomError', (error) => {
    faults.push('exception au démarrage : ' + error.message)
  })

  const dom = new JSDOM(inlineExternalScripts(html, baseDirectory, faults), {
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    url: 'https://logo-forge.test/',
    virtualConsole,
    beforeParse(window) {
      for (const key of Object.keys(settings.storage || {})) {
        window.localStorage.setItem(key, settings.storage[key])
      }
      window.__adobe_cep__ = {
        getSystemPath: () => '/Extensions/logo-forge',
        evalScript(expression, callback) {
          const name = String(expression).split('(')[0]
          const answer = ANSWERS[name] || 'OK|'
          window.setTimeout(() => callback(answer), 0)
        },
      }
      window.cep = {
        encoding: { Base64: 'Base64', UTF8: 'UTF-8' },
        fs: {
          showOpenDialog: () => ({ err: 0, data: [] }),
          readFile: () => ({ err: 0, data: '' }),
        },
        util: { openURLInDefaultBrowser() {} },
      }
    },
  })

  // Le démarrage enchaîne plusieurs `setTimeout` : on laisse la file se vider.
  await new Promise((done) => dom.window.setTimeout(done, 250))

  if (settings.act) {
    try {
      settings.act(dom.window)
    } catch (error) {
      faults.push('geste refusé par le panneau : ' + error.message)
    }
    await new Promise((done) => dom.window.setTimeout(done, 100))
  }

  const document_ = dom.window.document
  const text = (selector) => {
    const node = document_.querySelector(selector)
    return node ? node.textContent.replace(/\s+/g, ' ').trim() : ''
  }

  const stored = {}
  for (let i = 0; i < dom.window.localStorage.length; i += 1) {
    const key = dom.window.localStorage.key(i)
    stored[key] = dom.window.localStorage.getItem(key)
  }

  const rendered = {
    cards: document_.querySelectorAll('.comp-card').length,
    tabs: document_.querySelectorAll('.tabs .tab').length,
    bodyLength: text('.panel-body').length,
    fatal: text('#fatal'),
    beacon: text('#lf-startup-check'),
    stored,
  }

  dom.window.close()
  return { faults, rendered }
}

/** Ce qu'un panneau vivant doit montrer. */
export function judge({ faults, rendered }) {
  const problems = [...faults]

  if (rendered.fatal) problems.push('cadre d erreur au démarrage : ' + rendered.fatal)
  // Le témoin porte la dernière étape franchie. Il s'efface quand le panneau
  // est prêt : le lire encore, c'est lire l'endroit exact où ça s'est arrêté.
  if (rendered.beacon) {
    problems.push('démarrage interrompu, dernière étape atteinte : ' + rendered.beacon)
  }
  if (rendered.cards === 0) problems.push('aucune carte de composant rendue')
  if (rendered.tabs === 0) problems.push('aucun onglet rendu')
  if (rendered.bodyLength < 200) {
    problems.push(`corps du panneau quasi vide (${rendered.bodyLength} caractères)`)
  }

  return problems
}

/**
 * Joue ce qu'un designer fait avant de quitter Illustrator.
 *
 * Le but n'est pas d'éprouver ces gestes, mais d'obtenir un enregistrement
 * réel — écrit par le panneau lui-même, pas fabriqué ici — que la seconde
 * ouverture aura à relire.
 */
function useThePanel(window) {
  const document_ = window.document
  const type = (id, value) => {
    const field = document_.getElementById(id)
    if (!field) return
    field.value = value
    field.dispatchEvent(new window.Event('input', { bubbles: true }))
    field.dispatchEvent(new window.Event('change', { bubbles: true }))
  }

  type('client-name', 'Atelier Nord')
  type('brand-name', 'Nova')
  const add = document_.getElementById('add-component')
  if (add) add.click()
}

if (process.argv[1] && process.argv[1].endsWith('check-panel-boot.mjs')) {
  if (!existsSync(BUILT)) {
    process.stderr.write('dist/index.html absent : lancez le build.\n')
    process.exit(1)
  }

  const html = readFileSync(BUILT, 'utf8')
  const first = await bootPanel(html, { act: useThePanel })
  const again = await bootPanel(html, { storage: first.rendered.stored })

  const rounds = [
    ['première ouverture', first],
    ['réouverture après redémarrage', again],
  ]

  let refused = false
  for (const [name, result] of rounds) {
    const problems = judge(result)
    if (problems.length === 0) {
      process.stdout.write(
        `${name} : ${result.rendered.cards} cartes, ${result.rendered.tabs} onglets, ` +
          `${result.rendered.bodyLength} caractères.\n`,
      )
      continue
    }
    refused = true
    process.stderr.write(`${name} :\n`)
    for (const problem of problems) process.stderr.write(`  ${problem}\n`)
  }

  if (refused) {
    process.stderr.write(
      '\nLe panneau serait vide dans Illustrator : le build refuse de le livrer.\n',
    )
    process.exit(1)
  }
  process.exit(0)
}
