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

import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'

/** Marqueur remplacé dans `panel-cep.html`. */
export const MARKER = '/* LF_BUILD */ {}'

/** Empreinte courte d'un contenu. */
export function fingerprint(text) {
  return createHash('sha1').update(text, 'utf8').digest('hex').slice(0, 7)
}

/**
 * Commit d'où sort le panneau, s'il y en a un.
 *
 * L'empreinte dit si deux panneaux diffèrent ; le commit dit **lequel** on
 * regarde. C'est ce qui manquait pour trancher entre « le défaut n'est pas
 * corrigé » et « ce dossier a été construit avant le correctif » : le second
 * cas se lit désormais sur le panneau lui-même.
 *
 * Un `+` signale un arbre de travail modifié : le panneau ne correspond alors
 * exactement à aucun commit.
 */
export function sourceRevision(root) {
  try {
    const run = (...args) =>
      execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
    const head = run('rev-parse', '--short', 'HEAD')
    const dirty = run('status', '--porcelain') !== ''
    return head + (dirty ? '+' : '')
  } catch (error) {
    // Pas de dépôt, ou pas de git : l'empreinte seule fait l'affaire.
    return ''
  }
}

/**
 * Pose l'empreinte dans le panneau.
 *
 * @param html panneau, marque déjà intégrée.
 * @param date jour de construction, au format ISO court.
 * @param revision commit d'où sort le panneau, éventuellement vide.
 */
export function stampBuild(html, date, revision) {
  if (html.indexOf(MARKER) < 0) {
    throw new Error(`marqueur « ${MARKER} » absent de panel-cep.html`)
  }
  // L'empreinte porte sur le document sans son marqueur : la poser ne doit
  // pas changer ce qu'elle mesure.
  const stamp = fingerprint(html.replace(MARKER, ''))
  return {
    html: html.replace(
      MARKER,
      JSON.stringify({ stamp: stamp, date: date, commit: revision || '' }),
    ),
    stamp: stamp,
  }
}

/** Empreinte lisible dans un panneau déjà construit. */
export function readStamp(html) {
  const found = /"stamp"\s*:\s*"([0-9a-f]{7})"/.exec(html)
  return found ? found[1] : ''
}
