/**
 * Garde-fous sur le panneau CEP vanilla.
 *
 * Ce fichier est autonome par construction : rien ne le compile, rien ne le
 * vérifie au build. Sans ces contrôles, une syntaxe trop récente ou un élément
 * manquant ne se découvrirait qu'une fois déployé dans Illustrator — et le
 * symptôme y est un panneau muet.
 */

import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import * as acorn from 'acorn'
import { describe, expect, it } from 'vitest'

const HTML = readFileSync(resolve(import.meta.dirname, '../src/panel-cep.html'), 'utf8')

const ENGINE = readFileSync(
  resolve(import.meta.dirname, '../src/js/export-engine.js'),
  'utf8',
)

/** Scripts inline du document, hors balises à `src`. */
const INLINE_SCRIPTS = [
  ...HTML.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g),
].map((match) => match[1])

const SCRIPT = INLINE_SCRIPTS.join('\n;\n')

/**
 * Document dépouillé de ses commentaires.
 *
 * Un commentaire n'est jamais rendu : les contrôles portant sur ce que
 * l'utilisateur voit doivent l'ignorer, sinon ils interdisent d'écrire en
 * français dans le code.
 */
const RENDERED = HTML.replace(/<!--[\s\S]*?-->/g, '')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '')
  .replace(/^\s*\*.*$/gm, '')

/** Feuille de style inline, dépouillée de ses commentaires. */
const STYLE = (/<style>([\s\S]*?)<\/style>/.exec(HTML)?.[1] ?? '').replace(
  /\/\*[\s\S]*?\*\//g,
  '',
)

describe('autonomie', () => {
  it('ne contient aucun module ES', () => {
    expect(SCRIPT).not.toMatch(/\bimport\s+[\w{*]/)
    expect(SCRIPT).not.toMatch(/\bexport\s+(default|const|function|\{)/)
  })

  it("n'utilise ni React ni aucun bundle", () => {
    expect(HTML).not.toMatch(/\breact\b/i)
    expect(HTML).not.toMatch(/src="\.\/index\.js"/)
  })

  it('charge le moteur d export depuis js/export-engine.js', () => {
    expect(HTML).toContain('src="./js/export-engine.js"')
  })

  it('signale un moteur manquant plutot que de laisser un bouton inerte', () => {
    expect(SCRIPT).toContain("typeof LogoForgeEngine === 'undefined'")
  })

  it('embarque exactement un script inline et sa feuille de style', () => {
    expect(INLINE_SCRIPTS).toHaveLength(1)
    expect(STYLE.length).toBeGreaterThan(1000)
  })
})

describe('compatibilité Chromium 61', () => {
  it('parse intégralement en ES5', () => {
    expect(() =>
      acorn.parse(SCRIPT, { ecmaVersion: 5, sourceType: 'script' }),
    ).not.toThrow()
  })

  it("n'utilise pas d'unité vh", () => {
    expect(STYLE).not.toMatch(/\d\s*vh\b/)
  })

  it("n'utilise pas de syntaxe CSS postérieure à Chromium 61", () => {
    // `gap` en flexbox demande Chrome 84, `inset` Chrome 87,
    // `rgb(r g b / a%)` Chrome 65.
    expect(STYLE).not.toMatch(/[\s;{]gap:/)
    expect(STYLE).not.toMatch(/[\s;{]inset:/)
    expect(STYLE).not.toMatch(/rgb\(\s*\d+\s+\d+\s+\d+/)
    // `:focus-visible` demande Chrome 86, `accent-color` Chrome 93 : un
    // sélecteur inconnu fait ignorer la règle entière, en silence.
    expect(STYLE).not.toMatch(/:focus-visible/)
    expect(STYLE).not.toMatch(/accent-color/)
    expect(STYLE).not.toMatch(/aspect-ratio\s*:/)
  })

  it('ancre la mise en page en positionnement absolu', () => {
    for (const selector of [
      '.panel',
      '.panel-header',
      '.panel-body',
      '.panel-footer',
    ]) {
      const block = STYLE.slice(STYLE.indexOf(`\n      ${selector} {`)).slice(0, 400)
      expect(block, selector).toMatch(/position: absolute/)
    }
  })
})

describe('éléments attendus par le script', () => {
  const IDS = [
    'status-dot',
    'document-card',
    'refresh',
    'tabs',
    'subtabs',
    'comp-grid',
    'comp-count',
    'add-component',
    'scheme-list',
    'custom-list',
    'add-custom',
    'print-formats',
    'web-formats',
    'scale-list',
    'add-scale',
    'separator',
    'padding-fields',
    'client-name',
    'choose-folder',
    'destination',
    'messages',
    'open-export',
    'start-export',
    'cancel-export',
    'abort-export',
    'progress-bar',
    'progress-label',
    'progress-title',
    'export-veil',
    'progress-veil',
    'open-settings',
    'settings-veil',
    'threshold',
    'remember-schemes',
    'done-panel',
    'done-count',
    'open-folder',
    'reset-all',
    'invert-before',
    'invert-after',
    'pass-print',
    'pass-web',
  ]

  it.each(IDS)('déclare #%s dans le balisage', (id) => {
    expect(HTML).toContain(`id="${id}"`)
  })

  it('référence les cinq déclinaisons', () => {
    for (const id of ['fullColor', 'black', 'white', 'inverted', 'grayscale']) {
      expect(SCRIPT, id).toContain(`id: '${id}'`)
    }
  })

  it('référence les cinq formats exportables', () => {
    for (const id of ['ai', 'svg', 'png', 'pdf', 'eps']) {
      expect(SCRIPT, id).toContain(`id: '${id}'`)
    }
  })

  it('propose quatre composants par défaut, chacun typé', () => {
    const defaults: Array<[string, string]> = [
      ['Logo', 'logo'],
      ['Logo Mark', 'logoMark'],
      ['Logotype', 'logotype'],
      ['Stacked Logo', 'stacked'],
    ]
    for (const [name, type] of defaults) {
      expect(SCRIPT, name).toContain(`newComponent('${name}', '${type}')`)
    }
  })

  it('déclare les deux onglets et les quatre sous-onglets de réglages', () => {
    // Les réglages sont une fenêtre modale ouverte par l'engrenage, pas un
    // onglet : ils ne doivent pas voler la place aux composants.
    for (const tab of ['components', 'colors']) {
      expect(HTML, tab).toContain(`data-tab="${tab}"`)
    }
    expect(HTML).not.toContain('data-tab="settings"')
    for (const sub of ['files', 'names', 'scales', 'padding']) {
      expect(HTML, sub).toContain(`data-sub="${sub}"`)
    }
  })
})

describe('iconographie', () => {
  it("n'utilise aucun glyphe pictographique comme icône", () => {
    // Un glyphe dépend des polices installées et ne porte aucune
    // signification accessible : les icônes sont des SVG au trait.
    for (const glyph of ['&#9881;', '&#8635;', '&#9681;', '&#9633;', '&times;']) {
      expect(HTML, glyph).not.toContain(glyph)
    }
    expect(RENDERED).not.toMatch(/[\u2190-\u2BFF\u{1F300}-\u{1FAFF}]/u)
  })

  it('dessine les icônes en SVG héritant de la couleur du texte', () => {
    expect(SCRIPT).toContain('var ICONS = {')
    expect(SCRIPT).toContain('stroke="currentColor"')
    expect(SCRIPT).toContain('aria-hidden="true"')
  })

  it('donne un nom accessible aux boutons purement iconographiques', () => {
    const iconButtons = HTML.match(/<button[^>]*class="icon-button"[^>]*>/g) ?? []
    expect(iconButtons.length).toBeGreaterThan(0)
    for (const button of iconButtons) {
      expect(button, button).toContain('aria-label=')
    }
  })
})

describe('flux Logo Package Express', () => {
  it('affecte un composant depuis la sélection', () => {
    expect(SCRIPT).toContain("'lfSetComponent'")
  })

  it('transmet le seuil d inversion au moteur', () => {
    expect(SCRIPT).toMatch(/threshold: state\.threshold/)
  })

  it('prévisualise les couleurs sans passer par Illustrator', () => {
    expect(SCRIPT).toContain('function previewColor(')
    expect(SCRIPT).toContain("getContext('2d')")
  })

  it('ne tient aucun second calcul de couleur', () => {
    // Le panneau délègue au moteur : deux implémentations finiraient par
    // diverger, et l'aperçu mentirait sur ce que l'export produit.
    expect(SCRIPT).toContain('engine.inkColor(')
    expect(SCRIPT).not.toMatch(/function (hexToRgb|rgbToHex|luminance)\(/)
  })

  it('propose les deux passes d export', () => {
    expect(HTML).toContain('id="pass-print"')
    expect(HTML).toContain('id="pass-web"')
  })

  it('affiche un écran de fin actionnable', () => {
    expect(HTML).toContain('Package terminé')
    expect(HTML).toContain('Ouvrir le dossier')
    expect(HTML).toContain('Réinitialiser')
  })
})

describe('Set Component', () => {
  it('affiche une vignette exportée par Illustrator, pas un dessin', () => {
    // La vignette est la seule preuve visuelle qu'un composant contient bien
    // l'artwork attendu.
    expect(SCRIPT).toContain("'lfRenderThumbnail'")
    expect(SCRIPT).toContain('data:image/png;base64,')
    expect(SCRIPT).toContain('class="comp-thumb"')
  })

  it('annonce explicitement un aperçu de substitution', () => {
    expect(SCRIPT).toContain('aperçu indisponible')
  })

  it('relit la vignette par l API fichier de CEP', () => {
    expect(SCRIPT).toContain('cep.fs.readFile')
    expect(SCRIPT).toContain('cep.encoding')
  })

  it('affiche le décompte réel des objets capturés', () => {
    expect(SCRIPT).toContain('function componentSummary(')
    expect(SCRIPT).toContain("' objets'")
    expect(SCRIPT).toContain("' refusés'")
  })

  it('remonte les erreurs et les refus au lieu de les avaler', () => {
    expect(SCRIPT).toContain('state.lastError')
    expect(SCRIPT).toMatch(/notice error/)
  })

  it('désactive la carte pendant la capture', () => {
    expect(SCRIPT).toContain('function setComponentBusy(')
    expect(SCRIPT).toContain("'Capture…'")
  })
})

describe('gestion des composants', () => {
  it('propose une taxonomie extensible, ouverte sur « personnalisé »', () => {
    expect(SCRIPT).toContain('var COMPONENT_TYPES = [')
    for (const id of ['logo', 'logoMark', 'logotype', 'tagline', 'custom']) {
      expect(SCRIPT, id).toContain(`id: '${id}'`)
    }
  })

  it('donne à chaque composant une identité et un horodatage', () => {
    expect(SCRIPT).toContain('function nextComponentId(')
    expect(SCRIPT).toMatch(/id: nextComponentId\(\)/)
    expect(SCRIPT).toContain('createdAt:')
    expect(SCRIPT).toContain('updatedAt:')
  })

  it('offre duplication, réordonnancement et suppression', () => {
    expect(SCRIPT).toContain('function duplicateComponent(')
    expect(SCRIPT).toContain('function moveComponent(')
    expect(SCRIPT).toContain('function removeComponent(')
    expect(SCRIPT).toContain('data-duplicate=')
    expect(SCRIPT).toContain('data-move=')
  })

  it('demande confirmation avant une suppression destructrice', () => {
    expect(SCRIPT).toContain('window.confirm')
    expect(SCRIPT).toContain('Sa capture sera perdue')
  })

  it('vérifie que les captures existent encore', () => {
    expect(SCRIPT).toContain('function verifyComponents(')
    expect(SCRIPT).toContain("'lfPathExists'")
    expect(SCRIPT).toContain('function missingComponents(')
  })

  it('exclut du plan un composant dont la capture a disparu', () => {
    // Le compter reviendrait à annoncer des fichiers qui ne seront pas écrits.
    const defined = SCRIPT.slice(
      SCRIPT.indexOf('function definedComponents('),
      SCRIPT.indexOf('function missingComponents('),
    )
    expect(defined).toContain('!component.missing')
    expect(SCRIPT).toContain('components: definedComponents()')
  })

  it('garde le bouton de suppression au-dessus de la vignette', () => {
    // Sans plan supérieur, l'image intercepte le clic et la carte devient
    // impossible à supprimer.
    const block = STYLE.slice(STYLE.indexOf('.comp-remove {'))
    expect(block.slice(0, 400)).toMatch(/z-index:\s*2/)
  })
})

describe('planche de revue', () => {
  it('expose la commande de construction et son compte rendu', () => {
    for (const id of ['build-package', 'package-summary', 'package-result']) {
      expect(HTML, id).toContain(`id="${id}"`)
    }
  })

  it('règle la grille depuis les paramètres', () => {
    expect(HTML).toContain('data-sub="grid"')
    for (const field of [
      'grid-cellWidth',
      'grid-cellHeight',
      'grid-margin',
      'grid-columnGap',
      'grid-rowGap',
      'grid-labelSize',
    ]) {
      expect(HTML, field).toContain(`id="${field}"`)
    }
  })

  it('délègue la construction au moteur, sans rien recalculer', () => {
    expect(SCRIPT).toContain('engine.runPackageBuild(')
    expect(SCRIPT).toContain('engine.planPackageGrid(')
    expect(SCRIPT).toContain('engine.gridSettings(')
  })

  it('rend compte des cellules vides et des débordements', () => {
    expect(SCRIPT).toContain('Cellules vides')
    expect(SCRIPT).toContain('débordent du plan de travail')
  })

  it('distingue visuellement un succès d un avertissement', () => {
    expect(STYLE).toContain('.notice.done')
    expect(SCRIPT).toMatch(/result\.ok \? 'done' : 'error'/)
  })

  it('regroupe les rendus dérivés pour qu aucune section ne reste en arrière', () => {
    expect(SCRIPT).toContain('function renderDerived(')
    // Un appelant qui oublierait la planche laisserait un compte rendu périmé.
    expect(SCRIPT.match(/renderExportButton\(\)/g) ?? []).toHaveLength(2)
  })
})

describe('persistance', () => {
  it('déclare ce qui survit à la fermeture', () => {
    expect(SCRIPT).toContain('var PERSISTED_SETTINGS = {')
    expect(SCRIPT).toContain('var PERSISTED_COMPONENT = [')
    for (const setting of [
      'folderTemplate',
      'nameTemplate',
      'collision',
      'docLanguage',
      'studio',
    ]) {
      expect(SCRIPT, setting).toContain(`${setting}:`)
    }
  })

  it('conserve les composants capturés, pas seulement les couleurs', () => {
    expect(SCRIPT).toContain('function persistProject(')
    expect(SCRIPT).toContain('function restoreProject(')
    expect(SCRIPT).toContain("'logo-forge-project'")
  })

  it('ne stocke pas les vignettes, seulement leur chemin', () => {
    // Des images encodées satureraient le stockage.
    const block = SCRIPT.slice(
      SCRIPT.indexOf('var PERSISTED_COMPONENT = ['),
      SCRIPT.indexOf('function persistProject('),
    )
    expect(block).toContain("'thumbnailPath'")
    expect(block).not.toContain("'thumbnail'")
  })

  it('ignore un enregistrement d une autre version', () => {
    expect(SCRIPT).toContain('var STORAGE_VERSION')
    expect(SCRIPT).toContain('saved.version !== STORAGE_VERSION')
  })

  it('replace les valeurs restaurées dans les champs', () => {
    // Un réglage actif mais invisible ferait croire à une perte.
    expect(SCRIPT).toContain('function applyRestoredSettings(')
  })

  it('sépare la remise à zéro du projet de celle des réglages', () => {
    expect(SCRIPT).toContain("byId('reset-settings').onclick")
    expect(SCRIPT).toContain('Vos composants sont')
    expect(SCRIPT).toContain('vos réglages sont conservés')
  })

  it('refuse une marge négative', () => {
    expect(SCRIPT).toContain('function positiveField(')
  })
})

describe('contrôle du pack livré', () => {
  it('affiche un verdict fondé sur la relecture du disque', () => {
    expect(SCRIPT).toContain('function renderAudit(')
    expect(SCRIPT).toContain('result.audit')
    expect(SCRIPT).toContain('vérifiés sur le disque')
  })

  it("dit quand le contrôle lui-même n'a pas pu avoir lieu", () => {
    // Un contrôle impossible n'est pas un contrôle réussi.
    expect(SCRIPT).toContain('result.auditError')
    expect(SCRIPT).toContain('Contrôle du pack impossible')
  })

  it('détaille chaque anomalie, sans noyer les contrôles satisfaits', () => {
    const block = SCRIPT.slice(SCRIPT.indexOf('function renderAudit('))
    expect(block.slice(0, 1400)).toContain('if (check.ok) continue')
  })
})

describe('documentation du pack', () => {
  it('laisse activer, traduire et personnaliser la documentation', () => {
    expect(HTML).toContain('data-sub="doc"')
    for (const id of [
      'doc-enabled',
      'doc-language',
      'doc-message',
      'doc-variables',
      'studio-name',
      'designer-name',
      'studio-email',
      'studio-website',
    ]) {
      expect(HTML, id).toContain(`id="${id}"`)
    }
  })

  it('transmet studio et message au moteur', () => {
    expect(SCRIPT).toContain('docLanguage: state.docLanguage')
    expect(SCRIPT).toContain('docMessage: state.docMessage')
    expect(SCRIPT).toContain('studio: state.studio')
    expect(SCRIPT).toContain('engine.DOC_VARIABLES')
  })

  it("annonce les documents et le poids à la fin de l'export", () => {
    expect(SCRIPT).toContain('result.documents')
    expect(SCRIPT).toContain('engine.totalBytes(')
    expect(SCRIPT).toContain('engine.countFailures(')
    expect(SCRIPT).toContain('engine.countWarnings(')
  })

  it('nomme le dossier de rapport selon le modèle retenu', () => {
    // Le chemin annoncé doit être celui où le fichier a été écrit.
    expect(SCRIPT).toContain('engine.folderTemplate(state.folderTemplate)')
    expect(SCRIPT).not.toContain('engine.FOLDERS.report')
  })
})

describe('arborescence livrée', () => {
  it('laisse choisir un modèle et le décrit', () => {
    expect(HTML).toContain('data-sub="folders"')
    for (const id of ['folder-template', 'folder-description', 'folder-preview']) {
      expect(HTML, id).toContain(`id="${id}"`)
    }
  })

  it("construit l'aperçu depuis le plan réel", () => {
    // Montrer une arborescence idéale se découvrirait faux en ouvrant le
    // dossier livré.
    expect(SCRIPT).toContain('engine.planDirectories(')
    expect(SCRIPT).toContain('engine.FOLDER_TEMPLATES')
    expect(SCRIPT).toContain('folderTemplate: state.folderTemplate')
  })

  it('rafraîchit l aperçu avec les composants et les déclinaisons', () => {
    const block = SCRIPT.slice(
      SCRIPT.indexOf('function renderDerived('),
      SCRIPT.indexOf('function renderAll('),
    )
    expect(block).toContain('renderFolderTemplate()')
    expect(block).toContain('renderNamePreview()')
  })

  it('répète sans String.repeat, absent de Chromium 61', () => {
    expect(SCRIPT).toContain('function repeat(')
    expect(SCRIPT).not.toMatch(/\.repeat\(/)
  })
})

describe('nommage', () => {
  it('expose le gabarit, ses variables et sa remise à zéro', () => {
    for (const id of [
      'name-template',
      'name-variables',
      'name-preview',
      'reset-template',
      'collision-policy',
    ]) {
      expect(HTML, id).toContain(`id="${id}"`)
    }
  })

  it('recueille marque, projet et version', () => {
    for (const id of ['brand-name', 'project-name', 'pack-version']) {
      expect(HTML, id).toContain(`id="${id}"`)
    }
  })

  it("calcule l'aperçu avec la fonction qui nomme les fichiers", () => {
    // Un aperçu calculé à part promettrait un nom que le pack ne porte pas.
    expect(SCRIPT).toContain('engine.deliveryName(')
    expect(SCRIPT).toContain('engine.defaultTemplate(')
    expect(SCRIPT).toContain('engine.NAME_VARIABLES')
  })

  it('intercale le séparateur en composant le gabarit', () => {
    const block = SCRIPT.slice(SCRIPT.indexOf("byId('name-variables').onclick"))
    expect(block.slice(0, 700)).toContain('state.separator')
  })

  it('laisse choisir la conduite à tenir devant un fichier existant', () => {
    expect(SCRIPT).toContain('engine.COLLISION_POLICIES')
    expect(SCRIPT).toContain('collision: state.collision')
  })
})

describe("portée d'export", () => {
  it('laisse choisir composants et déclinaisons du lot', () => {
    for (const id of ['scope-components', 'scope-schemes']) {
      expect(HTML, id).toContain(`id="${id}"`)
    }
    expect(HTML).toContain('data-scope-all="components"')
    expect(HTML).toContain('data-scope-none="schemes"')
  })

  it('retient tout par défaut', () => {
    // Une portée vide au premier lancement ferait croire à un plugin cassé.
    const block = SCRIPT.slice(SCRIPT.indexOf('function inScope('))
    expect(block.slice(0, 200)).toContain('!== false')
  })

  it('applique la portée au plan, pas aux réglages globaux', () => {
    expect(SCRIPT).toContain('function exportConfig(')
    expect(SCRIPT).toContain('engine.planExport(exportConfig())')
    // L'export part de la configuration lue à l'écran, éventuellement
    // complétée des fichiers déjà écrits d'un lot repris.
    expect(SCRIPT).toContain('var config = exportConfig()')
    expect(SCRIPT).toContain('engine.runFullExport(config, {')
    // La planche de revue reste hors portée : elle montre tout le projet.
    expect(SCRIPT).toContain('engine.runPackageBuild(buildConfig()')
  })

  it('distingue une couleur personnalisée par son nom', () => {
    expect(SCRIPT).toContain('function schemeKey(')
    expect(SCRIPT).toContain("'custom:'")
  })
})

describe('contrôle de production', () => {
  it('expose un onglet dédié et sa commande', () => {
    expect(HTML).toContain('data-tab="preflight"')
    for (const id of [
      'pane-preflight',
      'run-preflight',
      'preflight-mode',
      'preflight-result',
      'preflight-manual',
    ]) {
      expect(HTML, id).toContain(`id="${id}"`)
    }
  })

  it('délègue règles et gravités au moteur', () => {
    expect(SCRIPT).toContain("'lfPreflight'")
    expect(SCRIPT).toContain('engine.evaluatePreflight(')
    expect(SCRIPT).toContain('engine.PREFLIGHT_MANUAL')
  })

  it('demande confirmation avant toute correction', () => {
    // La correction porte sur le document ouvert du designer.
    const block = SCRIPT.slice(SCRIPT.indexOf('function applyPreflightFix('))
    expect(block.slice(0, 900)).toContain('window.confirm')
  })

  it('recontrôle après correction plutôt que de croire le décompte', () => {
    const block = SCRIPT.slice(
      SCRIPT.indexOf('function applyPreflightFix('),
      SCRIPT.indexOf('function renderPreflight('),
    )
    expect(block).toContain('runPreflight()')
  })

  it('invalide le rapport quand la destination change', () => {
    const block = SCRIPT.slice(SCRIPT.indexOf("byId('preflight-mode').onchange"))
    expect(block.slice(0, 400)).toContain('state.preflight = null')
  })

  it('peut refuser l export, sur réglage explicite', () => {
    expect(HTML).toContain('id="block-on-preflight"')
    expect(SCRIPT).toContain('function preflightBlocks(')
    expect(SCRIPT).toContain('!preflightBlocks()')
  })

  it('distingue les cinq états à la pastille', () => {
    for (const status of ['pass', 'info', 'warning', 'error', 'unknown']) {
      expect(STYLE, status).toContain(`.dot.${status}`)
    }
  })
})

describe('couleurs', () => {
  it('lit les couleurs réellement présentes dans le document', () => {
    expect(SCRIPT).toContain("'lfListColors'")
    expect(SCRIPT).toContain('function readDocumentColors(')
  })

  it('nourrit la table de correspondance depuis le document', () => {
    // Une source absente de l'artwork ne serait jamais remplacée.
    expect(SCRIPT).toContain('function addColorMapping(')
    expect(SCRIPT).toContain('data-map=')
    expect(SCRIPT).toContain('data-unmap=')
  })

  it('permet de renommer et de dupliquer une couleur personnalisée', () => {
    expect(SCRIPT).toContain('data-custom-name=')
    expect(SCRIPT).toContain('data-duplicate-custom=')
    expect(SCRIPT).toContain('function cloneMap(')
  })

  it('contrôle le contraste sur quatre fonds, dont un au choix', () => {
    expect(HTML).toContain('id="contrast-custom"')
    expect(HTML).toContain('id="contrast-list"')
    expect(SCRIPT).toContain('engine.checkContrast(')
    expect(SCRIPT).toContain('function contrastBackgrounds(')
  })

  it('avertit avant export sur une déclinaison illisible', () => {
    expect(SCRIPT).toContain('function criticalSchemes(')
    expect(SCRIPT).toContain('Illisible sur au moins un fond')
  })

  it('distingue les trois verdicts à la bordure, pas au seul fond', () => {
    for (const verdict of ['.verdict.good', '.verdict.warning', '.verdict.critical']) {
      expect(STYLE, verdict).toContain(verdict)
    }
    expect(STYLE).toMatch(/\.verdict\.good \{\s*border-color/)
  })
})

describe('pont Illustrator', () => {
  it("parle à l'hôte par __adobe_cep__", () => {
    expect(SCRIPT).toContain('__adobe_cep__')
  })

  it("n'embarque aucune bibliothèque tierce", () => {
    // Charger CSInterface sans le livrer ne donnerait qu'un 404 rouge dans la
    // console de l'extension : __adobe_cep__ suffit.
    expect(HTML).not.toContain('CSInterface.js')
    expect(HTML).not.toMatch(/<script src="(?!\.\/js\/export-engine\.js)/)
  })

  it('arrête la relecture après trois échecs consécutifs', () => {
    expect(SCRIPT).toContain('POLL_FAILURE_LIMIT')
    expect(SCRIPT).toContain('CEP mode - polling disabled')
  })

  it('sonde toutes les trois secondes', () => {
    expect(SCRIPT).toMatch(/POLL_MS = 3000/)
  })
})

describe('erreurs actionnables', () => {
  it('affiche une erreur en trois temps plutôt qu’un message brut', () => {
    expect(SCRIPT).toContain('function renderError(')
    expect(SCRIPT).toContain('engine.describeError(')
    expect(SCRIPT).toContain('À faire :')
  })

  it('offre de rejouer exactement l’opération échouée', () => {
    // Sans l'action mémorisée, « Réessayer » obligerait le designer à
    // retrouver lui-même par où reprendre.
    expect(SCRIPT).toContain('state.lastAction = retry || null')
    expect(SCRIPT).toContain('data-retry="1"')
    expect(SCRIPT).toContain("data-retry') !== null")
  })

  it('ne propose pas de réessayer ce qui ne peut pas réussir', () => {
    expect(SCRIPT).toContain('error.retryable')
  })

  it('garde le message d’Illustrator, replié', () => {
    expect(SCRIPT).toContain('data-details="1"')
    expect(SCRIPT).toContain('<span class="detail" hidden>')
    expect(STYLE).toContain('.fault')
  })

  it('efface l’erreur avant de rejouer', () => {
    const block = SCRIPT.slice(SCRIPT.indexOf("data-retry') !== null"))
    expect(block.slice(0, 300)).toContain('clearError()')
  })

  it('journalise chaque échec signalé au designer', () => {
    const block = SCRIPT.slice(SCRIPT.indexOf('function fail('))
    expect(block.slice(0, 400)).toContain('engine.log(')
    expect(block.slice(0, 400)).toContain("'fail'")
  })

  it('donne la priorité à l’erreur sur les autres indications', () => {
    const block = SCRIPT.slice(SCRIPT.indexOf('function renderMessages('))
    expect(block.indexOf('state.lastError')).toBeLessThan(
      block.indexOf('state.refusedNotice'),
    )
  })
})

describe('diagnostics et journal', () => {
  it('offre un onglet dédié', () => {
    expect(HTML).toContain('data-sub="diag"')
    expect(HTML).toContain('id="sub-diag"')
  })

  it('interroge Illustrator sans rien écrire de définitif', () => {
    expect(HTML).toContain('id="run-diagnostics"')
    expect(SCRIPT).toContain('engine.runDiagnostics(')
    // Une sonde qui écrirait dans le document ne serait plus un diagnostic.
    expect(HTML).toContain("Aucune n'écrit")
  })

  it('montre l’avancement sonde par sonde', () => {
    expect(SCRIPT).toContain('onStep:')
    expect(SCRIPT).toContain("done + ' / ' + total")
  })

  it('accompagne une sonde en échec du geste à faire', () => {
    const block = SCRIPT.slice(SCRIPT.indexOf('function renderDiagnostics('))
    expect(block.slice(0, 1600)).toContain('check.hint')
    expect(block.slice(0, 1600)).toContain('check.detail')
  })

  it('n’annonce rien avant d’avoir contrôlé', () => {
    expect(SCRIPT).toContain('Aucun contrôle effectué.')
  })

  it('affiche le journal du plus récent au plus ancien', () => {
    expect(HTML).toContain('id="log-view"')
    expect(HTML).toContain('id="log-summary"')
    expect(SCRIPT).toContain('engine.logHistory()')
    expect(SCRIPT).toContain('la plus récente en tête')
  })

  it('relit le journal à la demande, pas en continu', () => {
    // Rafraîchir pendant un export ralentirait ce qu'on cherche à observer.
    expect(HTML).toContain('id="refresh-log"')
    expect(HTML).toContain('id="clear-log"')
    expect(SCRIPT).toContain('engine.clearLog()')
  })

  it('borne l’extrait affiché', () => {
    expect(SCRIPT).toMatch(/i < history\.length && i < \d+/)
  })
})

describe('reprise d’un export interrompu', () => {
  it('laisse une trace après chaque fichier écrit', () => {
    expect(SCRIPT).toContain('onSnapshot: persistRun')
    expect(SCRIPT).toContain("var RUN_KEY = 'logo-forge-run'")
  })

  it('range la trace hors du projet', () => {
    // Oublier le projet ne doit pas faire perdre un lot en cours, ni l'inverse.
    expect(SCRIPT).toContain('window.localStorage.removeItem(RUN_KEY)')
    expect(SCRIPT).toContain('window.localStorage.removeItem(STORAGE_KEY)')
    expect(SCRIPT).not.toContain('RUN_KEY = STORAGE_KEY')
  })

  it('confronte la trace au disque avant de proposer quoi que ce soit', () => {
    const block = SCRIPT.slice(SCRIPT.indexOf('function lookForInterruptedRun('))
    expect(block.slice(0, 1200)).toContain('engine.verifySnapshot(')
    expect(block.slice(0, 1200)).toContain("'lfPathExists'")
  })

  it('écarte une trace qui ne correspond plus au plan', () => {
    const block = SCRIPT.slice(SCRIPT.indexOf('function lookForInterruptedRun('))
    expect(block.slice(0, 600)).toContain('engine.snapshotMatches(')
    expect(block.slice(0, 600)).toContain('forgetRun()')
  })

  it('ne jette pas la trace sur une sonde muette', () => {
    // Zéro fichier retrouvé peut vouloir dire « hôte absent », pas « rien ».
    const block = SCRIPT.slice(SCRIPT.indexOf('if (total === 0) {'))
    expect(block.slice(0, 300)).toContain('state.resume = null')
    expect(block.slice(0, 300)).not.toContain('forgetRun()')
  })

  it('dit combien de fichiers restent, et laisse le choix', () => {
    expect(HTML).toContain('id="resume-run"')
    expect(SCRIPT).toContain('Export interrompu.')
    expect(SCRIPT).toContain('id="do-resume"')
    expect(SCRIPT).toContain('id="drop-resume"')
  })

  it('n’oublie la trace que si le pack est complet', () => {
    expect(SCRIPT).toContain(
      'if (!result.cancelled && engine.countFailures(result.failures) === 0)',
    )
  })

  it('garde la trace d’un lot qui laisse des échecs derrière lui', () => {
    // Aller au bout du plan ne veut pas dire avoir tout écrit : ce sont
    // justement ces fichiers-là qu'une reprise doit reprendre.
    const block = SCRIPT.slice(
      SCRIPT.indexOf('if (!result.cancelled && engine.countFailures'),
    )
    expect(block.slice(0, 300)).toContain('lookForInterruptedRun()')
  })

  it('ne réamorce pas un projet restauré avec les composants par défaut', () => {
    // Sans cette garde, la persistance des composants n'avait aucun effet.
    const block = SCRIPT.slice(
      SCRIPT.indexOf('restoreProject()\n          applyRestoredSettings()'),
    )
    expect(block.slice(0, 700)).toContain('if (!state.components.length) {')
  })
})

describe('kit réseaux sociaux', () => {
  it('offre un onglet et les formats du moteur', () => {
    expect(HTML).toContain('data-sub="social"')
    expect(HTML).toContain('id="sub-social"')
    expect(SCRIPT).toContain('engine.SOCIAL_PRESETS')
    expect(SCRIPT).toContain('data-social=')
  })

  it('annonce les dimensions de chaque plateforme', () => {
    // Le designer choisit une bannière LinkedIn, pas un « 1128 × 191 ».
    const block = SCRIPT.slice(SCRIPT.indexOf('function renderSocialPresets('))
    expect(block.slice(0, 1200)).toContain('preset.width')
    expect(block.slice(0, 1200)).toContain('preset.use')
  })

  it('laisse choisir le fond, et le justifie', () => {
    expect(HTML).toContain('id="social-transparent"')
    expect(HTML).toContain('id="social-background"')
    expect(HTML).toContain('fond qu elles')
  })

  it('désactive la couleur quand le fond est transparent', () => {
    // Un réglage sans effet visible est un réglage qui ment.
    expect(SCRIPT).toContain("byId('social-background').disabled")
  })

  it('compte les canevas avant de les produire', () => {
    expect(SCRIPT).toContain('engine.planSocialKit(socialConfig())')
    expect(SCRIPT).toContain('canevas seront produits')
  })

  it('exige un dossier de livraison', () => {
    const block = SCRIPT.slice(SCRIPT.indexOf('function buildSocialKit('))
    expect(block.slice(0, 300)).toContain('!state.destination')
  })

  it('montre l’avancement puis le résultat réel', () => {
    expect(SCRIPT).toContain('engine.runSocialKit(socialConfig()')
    const block = SCRIPT.slice(SCRIPT.indexOf('function renderSocialResult('))
    expect(block.slice(0, 1200)).toContain('result.written.length')
    expect(block.slice(0, 1200)).toContain('result.failures')
  })

  it('enregistre les réglages du kit', () => {
    expect(SCRIPT).toMatch(/PERSISTED_SETTINGS = \{[\s\S]*social: null/)
  })
})

describe('conditions dégradées', () => {
  it('ne meurt pas sur un élément d’interface manquant', () => {
    // Les gestionnaires sont câblés hors de tout garde-fou : une exception y
    // arrêtait le script en silence, écran vide et aucun message.
    const block = SCRIPT.slice(SCRIPT.indexOf('function byId('))
    expect(block.slice(0, 400)).toContain('missingElements')
    expect(block.slice(0, 400)).toContain("document.createElement('div')")
  })

  it('signale les éléments absents au lieu de les taire', () => {
    expect(SCRIPT).toContain('Interface incomplète')
    expect(SCRIPT).toContain('missingElements.join')
  })
})

describe('contrôle du chargement de la couche Illustrator', () => {
  it('offre le contrôle là où la panne se constate', () => {
    expect(HTML).toContain('id="check-host-script"')
    expect(HTML).toContain('id="host-script-result"')
    expect(SCRIPT).toContain('engine.checkHostScript(')
  })

  it('explique le symptôme qu’il sert à lever', () => {
    expect(HTML).toContain("n'est pas une")
    expect(HTML).toContain('jsx/main.jsx')
  })

  it('rend l’erreur du moteur et le geste qui suit', () => {
    const block = SCRIPT.slice(SCRIPT.indexOf('function renderHostScript('))
    expect(block.slice(0, 1400)).toContain('result.message')
    expect(block.slice(0, 1400)).toContain('À faire :')
  })

  it('distingue « fichier relu » de « fonctions définies »', () => {
    const block = SCRIPT.slice(SCRIPT.indexOf('function renderHostScript('))
    expect(block.slice(0, 1600)).toContain('result.defined')
    expect(block.slice(0, 1600)).toContain('ScriptPath')
  })
})

describe('mise en page compatible CEP', () => {
  /**
   * Unités et positionnements qui ont déjà vidé le panneau.
   *
   * `vh` ne se résout pas sur la fenêtre d'un panneau CEP : une hauteur qui
   * en dépend s'effondre à zéro, et il ne reste que l'en-tête sur un fond
   * gris. Le panneau se dimensionne donc en positionnement absolu, borné par
   * `top` et `bottom`.
   */
  const FORBIDDEN = [
    '100vh',
    '100dvh',
    '100svh',
    'min-height: 100v',
    'min-height:100v',
    'calc(100v',
    'position: fixed',
    'position:fixed',
  ]

  it('n’emploie aucune unité ni position proscrite', () => {
    for (const property of FORBIDDEN) {
      expect(STYLE, property).not.toContain(property)
    }
  })

  it('ne les laisse pas non plus passer dans le fichier livré', () => {
    // Le panneau est copié tel quel, mais le vérifier ici garde le contrôle
    // vrai même si le build venait à transformer la feuille de style.
    const built = resolve(import.meta.dirname, '../dist/index.html')
    if (!existsSync(built)) return

    const contents = readFileSync(built, 'utf8')
    for (const property of FORBIDDEN) {
      expect(contents, property).not.toContain(property)
    }
  })

  it('borne le panneau et son corps par leurs quatre côtés', () => {
    // C'est ce qui remplace `height: 100vh` : une hauteur déduite du bloc
    // conteneur, que CEP résout toujours.
    expect(STYLE).toMatch(/html,\s*body\s*\{[^}]*height:\s*100%/)
    expect(STYLE).toMatch(
      /\.panel\s*\{[^}]*position:\s*absolute[^}]*top:\s*0[^}]*bottom:\s*0/,
    )
    expect(STYLE).toMatch(
      /\.panel-body\s*\{[^}]*position:\s*absolute[^}]*top:[^}]*bottom:\s*0/,
    )
  })
})

describe('accord entre le panneau et le moteur', () => {
  /**
   * Ce que le panneau appelle réellement, relevé dans sa source.
   *
   * La négation en tête écarte `export-engine.js`, qui ressemble à un appel
   * sans en être un.
   */
  const USED = [
    ...new Set(
      [...SCRIPT.matchAll(/(?<![-\w])engine\.([A-Za-z_$][\w$]*)/g)].map((m) => m[1]),
    ),
  ]

  const DECLARED = (() => {
    const block = /var REQUIRED_ENGINE = \[([\s\S]*?)\]/.exec(SCRIPT)
    return block ? [...block[1].matchAll(/'([^']+)'/g)].map((m) => m[1]) : []
  })()

  const EXPORTED = new Set(
    [...ENGINE.matchAll(/^ {4}([A-Za-z_$][\w$]*):\s/gm)].map((m) => m[1]),
  )

  it('déclare tout ce qu’il appelle', () => {
    // Sans cela, la liste vieillirait en silence et le contrôle de version
    // laisserait passer précisément ce qu'il doit attraper.
    expect([...USED].sort()).toEqual([...DECLARED].sort())
  })

  it('n’attend rien que le moteur n’exporte', () => {
    for (const name of DECLARED) {
      expect(EXPORTED.has(name), name).toBe(true)
    }
  })

  it('refuse de démarrer sur un moteur incomplet', () => {
    // Deux fichiers qui évoluent ensemble et se déploient séparément : un
    // index.html recopié sans son moteur laissait le panneau à moitié
    // construit, sans rien dire.
    expect(SCRIPT).toContain('function missingEngineSymbols(')
    expect(SCRIPT).toContain('Moteur périmé :')
    expect(SCRIPT).toContain('dossiers js/ et jsx/ compris')
  })

  it('isole chaque rendu du panneau', () => {
    const block = SCRIPT.slice(SCRIPT.indexOf('function renderAll('))
    expect(block.slice(0, 1400)).toContain("guard('affichage — '")
  })
})

describe('langue de l’hôte', () => {
  it('demande sa langue à Illustrator au démarrage', () => {
    expect(SCRIPT).toContain("engine.call('lfGetLocale'")
    expect(SCRIPT).toContain('detectLanguage(renderAll)')
  })

  it('ne retient que les deux premières lettres', () => {
    // `fr_FR`, `fr_CA`, `fr` : c'est la même langue.
    expect(SCRIPT).toContain('locale.substring(0, 2).toLowerCase()')
  })

  it('retombe sur le français devant une langue inconnue', () => {
    const block = SCRIPT.slice(SCRIPT.indexOf('function applyTranslations('))
    expect(block.slice(0, 400)).toContain("TRANSLATIONS[lang] ? lang : 'fr'")
  })

  it('donne à chaque clé française sa contrepartie anglaise', () => {
    const table = /var TRANSLATIONS = \{([\s\S]*?)\n {8}\}/.exec(SCRIPT)![1]
    const [french, english] = table.split(/\n\s+en: \{/)
    const keys = (block: string) =>
      [...block.matchAll(/^\s{12}(\w+):/gm)].map((match) => match[1]).sort()

    expect(keys(english)).toEqual(keys(french))
    expect(keys(french).length).toBeGreaterThan(10)
  })

  it('traduit ce qui est marqué, et seulement cela', () => {
    // La portée est assumée : un mélange visible vaut mieux qu'une traduction
    // partielle qu'on croirait complète.
    expect(HTML).toContain('data-t="components"')
    expect(HTML).toContain('data-t="export"')
    expect(SCRIPT).toContain("document.querySelectorAll('[data-t]')")
    expect(SCRIPT).toContain('**Portée assumée.**')
  })

  it('nomme les déclinaisons dans la langue retenue', () => {
    expect(SCRIPT).toContain('function schemeLabelFor(')
    expect(SCRIPT).toContain('SCHEME_KEYS')
  })
})

describe('silhouettes des types de composant', () => {
  it('dessine plutôt que d’emprunter un glyphe', () => {
    // Un pictogramme Unicode se rend différemment d'un système à l'autre —
    // quand il se rend — et le projet s'interdit d'en faire une icône.
    expect(SCRIPT).toContain('var TYPE_SHAPES = {')
    expect(SCRIPT).toContain('function typeShape(')
  })

  it('couvre chaque type proposé au designer', () => {
    // Bornée au tableau lui-même : au-delà viennent les déclinaisons, qui ne
    // sont pas des types de composant.
    const declaration = SCRIPT.slice(SCRIPT.indexOf('var COMPONENT_TYPES = ['))
    const types = [
      ...declaration
        .slice(0, declaration.indexOf('\n        ]'))
        .matchAll(/\{ id: '(\w+)'/g),
    ].map((match) => match[1])
    const shapes = SCRIPT.slice(
      SCRIPT.indexOf('var TYPE_SHAPES = {'),
      SCRIPT.indexOf('function typeShape('),
    )

    expect(types.length).toBeGreaterThan(10)
    for (const type of types) {
      expect(shapes, type).toContain(type + ':')
    }
  })

  it('suit la couleur du thème', () => {
    const block = SCRIPT.slice(SCRIPT.indexOf('function shape('))
    expect(block.slice(0, 400)).toContain('stroke="currentColor"')
  })
})

describe('planche vivante', () => {
  it('se met à jour après chaque capture', () => {
    const block = SCRIPT.slice(SCRIPT.indexOf('component.method = fields[9]'))
    expect(block.slice(0, 900)).toContain('updatePreview(component)')
    expect(SCRIPT).toContain("engine.call(\n            'lfBuildPreview'")
  })

  it('décrit une ligne par déclinaison retenue', () => {
    const block = SCRIPT.slice(SCRIPT.indexOf('function previewRows('))
    expect(block.slice(0, 1400)).toContain('activeSchemes()')
    expect(block.slice(0, 1400)).toContain('engine.schemeTitle(scheme)')
  })

  it('pose un fond sombre là où la déclinaison serait invisible', () => {
    // Mesuré sur une encre sombre : noir 0, couleur 29, réserve 226, blanc 255.
    const block = SCRIPT.slice(SCRIPT.indexOf('function previewRows('))
    expect(block.slice(0, 1400)).toContain('engine.hexToRgb(')
    expect(block.slice(0, 1400)).toContain('perceivedLuminance(ink) > 140')
  })

  it('donne à chaque déclinaison sa propre table de correspondance', () => {
    // Deux couleurs personnalisées n'ont pas la même : une table unique pour
    // toute la planche en aurait recoloré une de travers.
    const block = SCRIPT.slice(SCRIPT.indexOf('function previewRows('))
    expect(block.slice(0, 1400)).toContain('engine.formatColorMap(scheme.map)')
  })

  it('n’échoue jamais la capture pour une planche ratée', () => {
    // Le composant est défini : la planche se signale à part.
    // Bornée à la fonction : au-delà commencent les autres, qui échouent
    // légitimement.
    const from = SCRIPT.indexOf('function updatePreview(')
    const body = SCRIPT.slice(from, SCRIPT.indexOf('\n        function ', from + 10))

    expect(body).toContain('state.previewNotice')
    expect(body).not.toContain('fail(')
  })

  it('se commande, et le réglage est retenu', () => {
    // Un état sans commande serait un réglage fantôme.
    expect(HTML).toContain('id="live-preview"')
    expect(SCRIPT).toContain('state.livePreview = this.checked')
    expect(SCRIPT).toContain("['live-preview', state.livePreview !== false]")
    expect(SCRIPT).toMatch(/PERSISTED_SETTINGS = \{[\s\S]*livePreview: true/)
  })

  it('laisse refermer la planche', () => {
    expect(HTML).toContain('id="close-preview"')
    expect(SCRIPT).toContain("'lfClosePreview'")
  })
})
