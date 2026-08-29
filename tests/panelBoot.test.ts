/**
 * Démarrage du panneau, éprouvé hors d'Illustrator.
 *
 * Le panneau construit se remplit tout seul : son corps est écrit par son
 * script. Une exception au démarrage laisse donc l'en-tête et un fond gris —
 * le « panneau vide » signalé après chaque redémarrage d'Illustrator — sans
 * qu'aucun contrôle de fichier ne puisse le voir : ils lisent le document,
 * ils ne l'exécutent pas.
 *
 * `scripts/check-panel-boot.mjs` l'exécute, dans un DOM, face à un hôte CEP
 * simulé. Ces épreuves-ci portent sur le contrôle lui-même : il ne servirait
 * à rien s'il déclarait vivant un panneau mort.
 */

import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { bootPanel, judge } from '../scripts/check-panel-boot.mjs'

/** Panneau minimal, monté par son script comme le vrai. */
const LIVING = `<div class="panel"><div class="tabs"></div>
  <div class="panel-body"></div></div>
  <div id="lf-startup-check">Logo Forge — script non exécuté</div>
  <script src="./js/moteur.js"></script>
  <script>
    var body = document.querySelector('.panel-body')
    var tabs = document.querySelector('.tabs')
    for (var i = 0; i < 12; i += 1) {
      var tab = document.createElement('button')
      tab.className = 'tab'
      tabs.appendChild(tab)
    }
    for (var c = 0; c < 4; c += 1) {
      var card = document.createElement('div')
      card.className = 'comp-card'
      card.textContent = Moteur.libellé() + ' — composant numéro ' + c + ', ' +
        'décrit sur assez de caractères pour qu un corps rempli se distingue ' +
        'd un corps vide.'
      body.appendChild(card)
    }
    var witness = document.getElementById('lf-startup-check')
    witness.parentNode.removeChild(witness)
  </script>`

/** Écrit un paquet livrable, et rend son dossier. */
function pack(
  html: string,
  engine = 'var Moteur = { libellé: function () { return "Logo Forge" } }',
): string {
  const directory = mkdtempSync(join(tmpdir(), 'logo-forge-boot-'))
  mkdirSync(join(directory, 'js'))
  writeFileSync(join(directory, 'js/moteur.js'), engine)
  writeFileSync(join(directory, 'index.html'), html)
  return directory
}

const boot = (html: string, directory: string) =>
  bootPanel(html, { baseDirectory: directory })

describe('ce que le contrôle accepte', () => {
  it('laisse passer un panneau qui se monte', async () => {
    const directory = pack(LIVING)

    expect(judge(await boot(LIVING, directory))).toEqual([])
  })

  it('charge le moteur depuis le dossier livré', async () => {
    const directory = pack(LIVING)
    const result = await boot(LIVING, directory)

    expect(result.rendered.bodyLength).toBeGreaterThan(200)
    expect(result.rendered.cards).toBe(4)
  })
})

describe('ce que le contrôle refuse', () => {
  it('un dossier js/ oublié dans la copie', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'logo-forge-boot-'))
    writeFileSync(join(directory, 'index.html'), LIVING)
    const problems = judge(await boot(LIVING, directory))

    expect(problems.join(' ')).toContain('script absent du paquet')
  })

  it('un moteur périmé, sans la fonction attendue', async () => {
    // Un moteur d'une version antérieure n'a pas la fonction que le panneau
    // appelle : l'exception survient au milieu du rendu.
    const directory = pack(LIVING, 'var Moteur = {}')
    const problems = judge(await boot(LIVING, directory))

    expect(problems.join(' ')).toContain('exception au démarrage')
    expect(problems.join(' ')).toContain('aucune carte de composant rendue')
  })

  it('une exception au démarrage', async () => {
    const cassé = LIVING.replace('var body =', 'pasUneFonction(); var body =')
    const directory = pack(cassé)
    const problems = judge(await boot(cassé, directory))

    expect(problems.join(' ')).toContain('exception au démarrage')
  })

  it('un corps rendu presque vide', async () => {
    const maigre = LIVING.replace(/for \(var c = 0; c < 4/, 'for (var c = 0; c < 0')
    const directory = pack(maigre)
    const problems = judge(await boot(maigre, directory))

    expect(problems.join(' ')).toContain('aucune carte de composant rendue')
  })

  it('un cadre d’erreur affiché par le panneau lui-même', async () => {
    const criant = LIVING.replace(
      'var witness =',
      'var box = document.createElement("div");' +
        'box.id = "fatal";' +
        'box.textContent = "Moteur introuvable";' +
        'document.querySelector(".panel-body").appendChild(box);' +
        'var witness =',
    )
    const directory = pack(criant)
    const problems = judge(await boot(criant, directory))

    expect(problems.join(' ')).toContain('Moteur introuvable')
  })
})

describe('témoin de démarrage', () => {
  /**
   * Le témoin est écrit dans le HTML et retiré à la fin du démarrage : tant
   * qu'il est là, il nomme l'étape où le panneau s'est arrêté. C'est le seul
   * message disponible dans un panneau CEP livré, qui n'a pas de console.
   */
  it('reste visible et nomme l’étape atteinte quand le démarrage échoue', async () => {
    const cassé = LIVING.replace(
      'var witness =',
      'document.getElementById("lf-startup-check").textContent =' +
        ' "Logo Forge — rendu de l interface";' +
        'throw new Error("panne");' +
        'var witness =',
    )
    const directory = pack(cassé)
    const result = await boot(cassé, directory)

    expect(result.rendered.beacon).toContain('rendu de l interface')
    expect(judge(result).join(' ')).toContain('dernière étape atteinte')
  })

  it('disparaît quand le panneau est monté', async () => {
    const directory = pack(LIVING)

    expect((await boot(LIVING, directory)).rendered.beacon).toBe('')
  })
})

describe('place dans le build', () => {
  /**
   * Un garde-fou qui ne s'exécute qu'en test laisse passer un build lancé à
   * la main — et c'est celui-là qui part chez un tiers.
   */
  it('est exécuté par le build, pas seulement par les tests', () => {
    const manifest = JSON.parse(
      readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
    )

    expect(manifest.scripts.build).toContain('check-panel-boot.mjs')
  })
})
