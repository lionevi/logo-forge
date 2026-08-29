/**
 * Sonde minimale du pont ExtendScript.
 *
 * Elle sert à trancher une question, et une seule : est-ce que CEP charge et
 * exécute le fichier désigné par `<ScriptPath>` du manifeste ?
 *
 * Mode d'emploi — dans `src/cep/manifest.xml`, remplacer temporairement :
 *
 *     <ScriptPath>./jsx/main.jsx</ScriptPath>
 * par
 *     <ScriptPath>./jsx/test-minimal.jsx</ScriptPath>
 *
 * puis `npm run build`, redéployer, rouvrir le panneau et lancer le contrôle
 * système (Réglages → Diagnostics).
 *
 * - `lfPing` répond « pong » → le chargement fonctionne ; la panne est dans
 *   `main.jsx` lui-même.
 * - `lfPing` reste introuvable → la panne est dans le manifeste, le chemin, ou
 *   le déploiement — le fichier n'a jamais atteint Illustrator.
 *
 * Ce fichier n'a aucune dépendance et ne touche à rien : il ne peut pas
 * échouer pour une autre raison que celle qu'il mesure. Il n'est jamais chargé
 * en fonctionnement normal.
 */

function lfPing() {
  return 'pong'
}

function lfGetDocumentName() {
  try {
    if (app.documents.length > 0) {
      return 'OK|' + app.activeDocument.name
    }
    return 'OK|no-doc'
  } catch (e) {
    return 'ERR|' + (e && e.message ? e.message : String(e))
  }
}

/**
 * Décrit le moteur qui exécute ce fichier.
 *
 * Sa version dit quelles constructions il accepte : c'est l'information qui
 * manquait pour trancher entre « ES3 » et « ES5 » sans deviner.
 */
function lfEngineInfo() {
  try {
    return (
      'OK|' + $.version + ' · ' + $.os + ' · ' + app.name + ' ' + app.version
    )
  } catch (e) {
    return 'ERR|' + (e && e.message ? e.message : String(e))
  }
}
