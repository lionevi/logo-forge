/**
 * Intègre les SVG de marque dans le panneau, au moment du build.
 *
 * Le panneau est livré en un seul fichier : une balise `<img src>` ne
 * suivrait pas le thème, et CEP ne charge pas toujours un chemin relatif. Les
 * SVG présents dans `src/assets/` sont donc insérés en ligne, dans un objet
 * `LF_BRAND` que le panneau lit.
 *
 * Ce qui manque ne casse rien : le panneau garde son apparence actuelle.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

/** Marqueur remplacé dans `panel-cep.html`. */
export const MARKER = '/* LF_BRAND */ {}'

/** Fichiers reconnus, et la clé sous laquelle le panneau les lit. */
export const BRAND_FILES = {
  'Icone-LF.svg': 'icon',
  'components-Illustration-LF.svg': 'illustration',
  'logo-LF.svg': 'logo',
  'wordmark-logo-LF.svg': 'wordmark',
}

/**
 * Prépare un SVG pour l'insertion en ligne.
 *
 * @returns le balisage, ou `null` avec la raison du refus.
 */
export function prepareSvg(source) {
  const stripped = source
    .replace(/<\?xml[\s\S]*?\?>/g, '')
    .replace(/<!DOCTYPE[\s\S]*?>/g, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .trim()

  const open = /<svg\b[^>]*>/i.exec(stripped)
  if (!open) return { markup: null, reason: 'aucune balise <svg>' }
  if (!/\bviewBox\s*=/i.test(open[0])) {
    return { markup: null, reason: 'attribut viewBox manquant' }
  }
  if (/<script\b/i.test(stripped))
    return { markup: null, reason: 'contient un <script>' }
  if (/<image\b/i.test(stripped))
    return { markup: null, reason: 'contient une <image>' }

  // La taille vient de la feuille de style ; la classe porte la couleur.
  const tag = open[0]
    .replace(/\s(width|height)\s*=\s*"[^"]*"/gi, '')
    .replace(/\sclass\s*=\s*"([^"]*)"/i, ' class="$1 lf-icon"')
  const withClass = /\sclass=/i.test(tag)
    ? tag
    : tag.replace(/^<svg\b/i, '<svg class="lf-icon"')

  return { markup: withClass + stripped.slice(open[0].length), reason: '' }
}

/** Lit les SVG déposés, et rend l'objet à insérer plus le journal du tri. */
export function collectBrand(assetsDir) {
  const brand = {}
  const notes = []
  if (!existsSync(assetsDir)) return { brand, notes }

  for (const name of readdirSync(assetsDir).sort()) {
    if (!name.endsWith('.svg')) continue
    const key = BRAND_FILES[name]
    if (!key) {
      notes.push(`${name} — nom inconnu, ignoré`)
      continue
    }
    const { markup, reason } = prepareSvg(readFileSync(join(assetsDir, name), 'utf8'))
    if (!markup) {
      notes.push(`${name} — écarté : ${reason}`)
      continue
    }
    brand[key] = markup
    notes.push(`${name} — intégré (${markup.length} octets)`)
  }
  return { brand, notes }
}

/** Remplace le marqueur du panneau par les éléments trouvés. */
export function inlineBrand(html, brand) {
  if (html.indexOf(MARKER) < 0) {
    throw new Error(`marqueur « ${MARKER} » absent de panel-cep.html`)
  }
  return html.replace(MARKER, JSON.stringify(brand))
}
