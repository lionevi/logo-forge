/**
 * Marque le panneau construit de son empreinte.
 *
 * Plusieurs mises au point ont porté sur un panneau qui n'était pas celui
 * qu'on venait de construire : une copie ancienne restée dans le dossier des
 * extensions se comporte exactement comme un défaut non corrigé, et rien à
 * l'écran ne les distingue. L'empreinte tranche : elle est affichée dans les
 * diagnostics, écrite à la fin du build, et relue par le script de
 * déploiement.
 *
 * Elle est calculée sur le contenu du panneau, pas sur l'heure : deux builds
 * du même code portent la même empreinte, et un panneau modifié la change.
 */

import { createHash } from 'node:crypto'

/** Marqueur remplacé dans `panel-cep.html`. */
export const MARKER = '/* LF_BUILD */ {}'

/** Empreinte courte d'un contenu. */
export function fingerprint(text) {
  return createHash('sha1').update(text, 'utf8').digest('hex').slice(0, 7)
}

/**
 * Pose l'empreinte dans le panneau.
 *
 * @param html panneau, marque déjà intégrée.
 * @param date jour de construction, au format ISO court.
 */
export function stampBuild(html, date) {
  if (html.indexOf(MARKER) < 0) {
    throw new Error(`marqueur « ${MARKER} » absent de panel-cep.html`)
  }
  // L'empreinte porte sur le document sans son marqueur : la poser ne doit
  // pas changer ce qu'elle mesure.
  const stamp = fingerprint(html.replace(MARKER, ''))
  return {
    html: html.replace(MARKER, JSON.stringify({ stamp: stamp, date: date })),
    stamp: stamp,
  }
}

/** Empreinte lisible dans un panneau déjà construit. */
export function readStamp(html) {
  const found = /"stamp"\s*:\s*"([0-9a-f]{7})"/.exec(html)
  return found ? found[1] : ''
}
