# Logo Forge — Rapport d'audit

**Date :** 28 août 2026
**Révision auditée :** `cf6e8ef` (branche `develop`)
**Périmètre :** intégralité du dépôt, avant toute modification.

Ce rapport distingue systématiquement deux niveaux de preuve :

| Marque  | Signification                                                                                           |
| ------- | ------------------------------------------------------------------------------------------------------- |
| **[P]** | Prouvé par lecture du code ou exécution locale — le défaut existe, indépendamment d'Illustrator.        |
| **[H]** | Hypothèse à confirmer dans un vrai Illustrator — le code est plausible mais rien ne l'a jamais exécuté. |

Aucune ligne de ce dépôt n'a jamais tourné dans Adobe Illustrator. Tout ce qui
touche au modèle objet d'Illustrator relève donc au mieux de **[H]**, sauf
lorsque le défaut est de pure logique.

---

## A. Architecture

### A.1 Cartographie réelle

Le dépôt contient **deux plugins superposés**, dont un seul est livré :

```text
CHAÎNE LIVRÉE (CEP) — celle qui tourne dans Illustrator
  src/panel-cep.html      2024 l.  UI + état + orchestration UI (vanilla ES5)
        │  window.__adobe_cep__.evalScript()
  src/js/export-engine.js  874 l.  planification + file d'export (ES5)
        │  evalScript()
  src/jsx/main.jsx         966 l.  seule couche parlant à Illustrator (ES3)
        │
  Illustrator DOM → système de fichiers

CHAÎNE MORTE (UXP) — construite, testée, jamais chargée
  src/main.tsx, src/App.tsx, src/ui/*.tsx (8 composants + ErrorBoundary)
  src/core/*.ts (planner, packagePlanner, exporter, exportOrchestrator,
                 colorManager, folderManager, presets, types)
  src/illustrator/host.ts, illustratorEngine.ts
  → bundle dist/index.js (177 Ko), copié en dist/panel-react.html
  → jamais référencé par CSXS/manifest.xml
```

`src/cep/manifest.xml` déclare `<MainPath>./index.html</MainPath>`, et le build
copie `panel-cep.html` vers `dist/index.html`. **La totalité de `src/core/`,
`src/ui/` et `src/illustrator/` est donc du code mort en production** : 2 400
lignes et 177 tests qui ne protègent rien de ce que l'utilisateur exécute.

### A.2 Écart avec l'architecture cible

| Couche exigée (LOGO_FORGE_ARCHITECTURE.md) | Existe        | Où                                                           |
| ------------------------------------------ | ------------- | ------------------------------------------------------------ |
| UI Layer                                   | oui           | `panel-cep.html` (mêlée à l'état)                            |
| Application Controller / Commands          | **non**       | les `onclick` appellent directement le moteur                |
| State Store                                | partiel       | objet `state` global, sans événements ni invariants          |
| Domain Engines                             | partiel       | un seul : la planification d'export                          |
| Illustrator Adapter                        | oui           | `jsx/main.jsx` (bien isolé — le point fort du dépôt)         |
| Filesystem Adapter                         | **non**       | dispersé entre `lfCreateFolder`, `cep.fs`, `lfWriteTextFile` |
| Persistence Layer                          | **quasi nul** | `localStorage` pour les seules déclinaisons                  |
| QA Layer                                   | **non**       | —                                                            |
| Diagnostics Layer                          | **non**       | —                                                            |
| Logging                                    | **non**       | —                                                            |

**Ce qui tient déjà** : la séparation « une seule couche parle à Illustrator »
est réellement respectée, le protocole `OK|charge` / `ERR|message` est cohérent
et systématique, et la file d'export est séquentielle et non bloquante.

**Ce qui manque structurellement** : tout ce qui vérifie. Il n'existe aucun
point du système où l'on compare ce qui était attendu à ce qui a été produit.

---

## B. Inventaire fonctionnel

Colonnes : UI = le contrôle existe · Moteur = du code s'exécute ·
Réel = l'effet est produit dans Illustrator/le disque · Vérif = le résultat est
contrôlé · Persist = survit à la fermeture du panneau.

| Fonctionnalité                     | UI      | Moteur | Réel            | Vérif   | Persist | Test    | Prio   |
| ---------------------------------- | ------- | ------ | --------------- | ------- | ------- | ------- | ------ |
| Set Component                      | oui     | oui    | **[H] douteux** | **non** | **non** | mock    | **P0** |
| Add / Delete Component             | oui     | n/a    | oui             | n/a     | **non** | oui     | P0     |
| Rename Component                   | oui     | n/a    | oui             | n/a     | **non** | non     | P1     |
| Réassigner (replace)               | oui     | oui    | [H]             | non     | **non** | non     | P1     |
| Duplicate / Reorder                | **non** | non    | —               | —       | —       | —       | P1     |
| Miniature composant                | oui     | oui    | **[P] factice** | non     | non     | non     | **P0** |
| Contraste clair/sombre (carte)     | oui     | n/a    | aperçu seul     | n/a     | non     | non     | P2     |
| Déclinaisons (5)                   | oui     | oui    | [H]             | non     | oui     | oui     | P0     |
| Couleurs personnalisées            | oui     | oui    | [H]             | non     | oui     | oui     | P0     |
| Seuil d'inversion                  | oui     | oui    | [H]             | non     | oui     | oui     | P1     |
| Package document / grille          | **non** | non    | —               | —       | —       | —       | **P0** |
| Preflight                          | **non** | non    | —               | —       | —       | —       | **P0** |
| Contrast checker                   | **non** | non    | —               | —       | —       | —       | P1     |
| Export Print (AI/PDF/EPS/JPEG)     | oui     | oui    | [H]             | **non** | n/a     | mock    | P0     |
| Export Web (SVG/PNG/JPEG/AI)       | oui     | oui    | [H]             | **non** | n/a     | mock    | P0     |
| Favicon multi-tailles              | oui     | oui    | [H]             | non     | non     | oui     | P2     |
| Portée d'export (scope fin)        | **non** | non    | —               | —       | —       | —       | P0     |
| Nommage                            | partiel | oui    | oui             | non     | **non** | oui     | P0     |
| Structure de dossiers              | figée   | oui    | oui             | **non** | **non** | oui     | P0     |
| Collisions de fichiers             | **non** | non    | —               | —       | —       | —       | P0     |
| Documentation client               | **non** | non    | —               | —       | —       | —       | P0     |
| Manifest                           | **non** | non    | —               | —       | —       | —       | P1     |
| Package QA                         | **non** | non    | —               | —       | —       | —       | P0     |
| Rapport d'export                   | oui     | oui    | oui (HTML)      | non     | n/a     | oui     | P1     |
| Réglages (formats/échelles/marges) | oui     | oui    | oui             | non     | **non** | partiel | P1     |
| Diagnostics                        | **non** | non    | —               | —       | —       | —       | P1     |
| Journalisation                     | **non** | non    | —               | —       | —       | —       | P1     |
| Multilingue                        | **non** | non    | —               | —       | —       | —       | P1     |
| Récupération après crash           | **non** | non    | —               | —       | —       | —       | P1     |

**Synthèse :** 3 fonctionnalités sur 29 satisfont la définition de `DONE` du
cahier des charges (UI → State → Engine → Illustrator → Output → Vérification),
et aucune des trois n'est critique.

---

## C. Bugs

Format imposé par la mission. Classés par gravité.

---

### BUG-001 — L'ordre de superposition est inversé à la copie du composant

```text
BUG:      Les objets dupliqués dans le document du composant sont empilés
          dans l'ordre inverse de l'original.
Cause:    Boucle à rebours combinée à PLACEATEND. Chaque itération ajoute en
          FIN de calque (= dessous de la pile). En partant de selection[n-1]
          pour finir à selection[0], l'élément le plus haut se retrouve le plus
          bas. Le commentaire « dupliquer en tête décale les index restants »
          décrit PLACEATBEGINNING, pas PLACEATEND : le raisonnement d'origine
          ne correspond pas au code écrit.
Fichier:  src/jsx/main.jsx
Fonction: setComponent(), boucle ligne ~759
Impact:   [P] Un logo comportant une forme de fond, un aplat de repérage ou un
          masque passe au premier plan et masque tout le reste. Symptôme
          observé par l'utilisateur : « le plan de travail est vide ».
          C'est le candidat le plus probable au P0 signalé.
Solution: Parcourir la sélection dans l'ordre croissant avec PLACEATEND
          (ou décroissant avec PLACEATBEGINNING), et vérifier ensuite que le
          nombre de copies égale le nombre d'objets sélectionnés.
Test:     Doublure ExtendScript enregistrant l'ordre d'insertion ; le test
          échoue sur le code actuel et passe après correction.
```

---

### BUG-002 — Les objets masqués ou verrouillés produisent un composant vide

```text
BUG:      Un composant peut ne contenir que des objets invisibles, ou n'être
          pas créé du tout.
Cause:    setComponent() ne consulte ni ne neutralise `hidden` / `locked`,
          ni sur les objets ni sur leurs calques. Un objet masqué est dupliqué
          masqué ; un objet sur calque verrouillé fait lever duplicate().
          applyColorScheme() déverrouille et démasque bien les calques de sa
          copie de travail — setComponent() ne le fait pas : l'incohérence est
          interne au fichier.
Fichier:  src/jsx/main.jsx
Fonction: setComponent()
Impact:   [H] Plan de travail visuellement vide alors que pageItems.length > 0,
          donc le garde-fou existant ne détecte rien. Ou échec total de la
          duplication sur un calque verrouillé.
Solution: Démasquer et déverrouiller les COPIES (jamais l'original), calques
          compris ; compter séparément les objets copiés et les objets refusés,
          et remonter ce décompte au panneau.
Test:     Doublure exposant des items hidden/locked ; vérifier que les copies
          ressortent visibles et que les refus sont comptés, pas avalés.
```

---

### BUG-003 — Aucune vérification après Set Component

```text
BUG:      Set Component déclare un succès sans avoir vérifié quoi que ce soit.
Cause:    Le seul garde-fou est `created.pageItems.length === 0`. Rien ne
          vérifie : le nombre de copies face au nombre d'objets sélectionnés,
          la validité du cadrage, l'existence du fichier .ai écrit, sa taille.
Fichier:  src/jsx/main.jsx
Fonction: setComponent()
Impact:   [P] Viole la règle « 0 succès affiché avant vérification » et rend le
          P0 signalé indiagnosticable : l'utilisateur voit « défini », le
          moteur n'en sait rien.
Solution: Vérifier chaque étape et renvoyer le décompte réel (objets copiés,
          objets refusés, dimensions, octets écrits), affiché dans la carte.
Test:     Doublure renvoyant un fichier de taille nulle → statut ERR attendu.
```

---

### BUG-004 — La miniature ne représente pas l'artwork

```text
BUG:      La vignette d'un composant est un dessin synthétique — un rectangle
          bleu et deux barres grises — identique pour tous les logos.
Cause:    drawPreview() dessine une figure abstraite sur un canvas 2D à partir
          des seules proportions du composant. Aucune image du logo n'est
          jamais produite.
Fichier:  src/panel-cep.html
Fonction: drawPreview(), ligne ~1168
Impact:   [P] Le designer ne peut pas constater visuellement que le composant
          est correct — c'est exactement le contrôle qui aurait révélé le
          P0. Interdit par la mission (§38) et par l'architecture (§10) :
          un placeholder ne peut pas tenir lieu de résultat.
Solution: Exporter un vrai PNG du composant vers un temporaire, le relire en
          Base64 (cep.fs.readFile) et l'afficher. Conserver le dessin actuel
          uniquement comme état « aperçu indisponible », explicitement nommé.
Test:     Bout en bout Chromium : la carte contient une <img data:image/png>
          dont la source vient de l'hôte, pas du canvas.
```

---

### BUG-005 — Un fichier est déclaré écrit sans être vérifié sur le disque

```text
BUG:      L'export compte un fichier comme réussi dès qu'ExtendScript répond OK.
Cause:    `if (result.ok) written.push(task)` — aucun contrôle d'existence,
          de taille ni de nom sur le fichier final.
Fichier:  src/js/export-engine.js, ligne ~699
Fonction: runTask()
Impact:   [P] Un fichier vide ou absent est annoncé comme livré. Le compteur
          « 18 fichiers » de l'écran de fin est un compteur de tâches, pas de
          fichiers. Viole « 0 fichier vide déclaré comme SUCCESS ».
Solution: Après chaque écriture, interroger l'hôte sur l'existence ET la
          taille ; taille nulle = échec. Puis Package QA en fin de lot,
          comparant l'attendu au réel.
Test:     Doublure renvoyant une taille de 0 → la tâche doit basculer en échec.
```

---

### BUG-006 — Le changement de mode colorimétrique échoue en silence

```text
BUG:      Un échec de conversion CMJN/RVB ne produit ni erreur ni avertissement.
Cause:    Dans la branche « changement de couleur seul », le callback de
          lfSetColorMode ignore son résultat.
Fichier:  src/js/export-engine.js, ligne ~805
Fonction: step()
Impact:   [P] Des fichiers « Pour_Impression » peuvent sortir en RVB sans que
          rien ne le signale. Viole « aucune erreur silencieuse ».
Solution: Traiter le résultat comme partout ailleurs : échec consigné,
          tâche marquée en avertissement, lot poursuivi.
Test:     Doublure faisant échouer lfSetColorMode → un warning doit apparaître.
```

---

### BUG-007 — saveAs relie le document de travail à un fichier supprimé

```text
BUG:      Après un export AI, PDF ou EPS, le document de travail pointe vers un
          fichier temporaire que le code vient d'effacer.
Cause:    exportThenRename() écrit dans un dossier d'attente puis le supprime
          dans son `finally`. Or saveAs() ré-associe le document Illustrator
          au fichier écrit — contrairement à exportFile(), utilisé pour PNG et
          JPEG. Le document survit donc rattaché à un chemin inexistant.
Fichier:  src/jsx/main.jsx
Fonction: exportThenRename() + exportAsAI/PDF/EPS
Impact:   [H] Comportement indéfini sur les exports suivants du même document.
          Le contournement par dossier d'attente est en outre inutile ici :
          un document de composant n'a qu'UN plan de travail, donc
          saveMultipleArtboards — seule cause du suffixage — est superflu.
Solution: Pour les composants mono-plan, écrire directement à la destination
          sans dossier d'attente ni saveMultipleArtboards.
Test:     Doublure vérifiant qu'aucun saveAs ne vise un chemin ensuite détruit.
```

---

### BUG-008 — L'état du projet ne survit pas à la fermeture du panneau

```text
BUG:      Composants, réglages, formats, échelles, marges et nom du client sont
          perdus dès que le panneau est refermé.
Cause:    Seules les déclinaisons sont persistées, sous
          STORAGE_KEY = 'logo-forge-color-schemes'.
Fichier:  src/panel-cep.html, ligne ~1027
Impact:   [P] Viole « aucune donnée conservée uniquement en mémoire » et rend
          impossible le scénario de reprise après redémarrage d'Illustrator.
Solution: Persister l'intégralité du projet, sous version de schéma, avec
          revalidation des références de composants au chargement.
Test:     Recharger la page dans Chromium et vérifier la restauration.
```

---

### BUG-009 — Des glyphes typographiques tiennent lieu d'icônes

```text
BUG:      Les actions du panneau sont désignées par ⚙ (U+2699), ↻ (U+21BB),
          ◑ (U+25D1) et □ (U+25A1).
Fichier:  src/panel-cep.html
Impact:   [P] Interdit par la mission (§34) : rendu dépendant des polices
          système, aucune cohérence, aucune signification accessible.
Solution: Un seul jeu SVG open source intégré en ligne (Lucide, licence ISC),
          avec libellé accessible sur chaque contrôle.
Test:     Garde-fou : aucun glyphe pictographique dans le balisage.
```

---

### BUG-010 — Le code livré n'est pas celui qui est testé

```text
BUG:      175 des 352 tests portent sur src/core/, src/ui/ et src/illustrator/,
          qui ne sont jamais chargés par l'extension CEP.
Impact:   [P] Le taux de couverture donne une confiance imméritée ; une
          régression dans le panneau ou le moteur ES5 passe inaperçue.
Solution: Décider explicitement : soit la chaîne UXP est une cible v2 assumée
          et documentée comme telle, soit elle est retirée. Ne pas la laisser
          se faire passer pour de la couverture.
```

---

## D. Set Component — diagnostic détaillé

Chaîne réelle, telle qu'écrite :

```text
[UI]   carte → onclick → setComponent(index)                 panel-cep.html:~1590
[BR]   engine.call('lfSetComponent', ['c0'])                 export-engine.js
[CEP]  __adobe_cep__.evalScript('lfSetComponent("c0")')
[ES]   selection = source.selection                          main.jsx:744
       bounds = selectionBounds(selection)                   main.jsx:751
       created = documents.add(space, w, h)                  main.jsx:757  ← doc actif change
       selection[i].duplicate(layer, PLACEATEND)   i = n-1→0 main.jsx:759  ← BUG-001
       garde : created.pageItems.length === 0                main.jsx:763
       artboardRect = selectionBounds(created.pageItems)      main.jsx:775
       saveAs(temp.ai)                                        main.jsx:788
       close ; app.activeDocument = source                    main.jsx:795
[UI]   carte marquée « définie », vignette synthétique        ← BUG-004
```

**Points de rupture, classés par probabilité :**

1. **[P] Inversion de la pile (BUG-001).** Explique exactement le symptôme
   « plan de travail vide » sur tout logo comportant un aplat de fond.
2. **[H] Objets masqués ou verrouillés (BUG-002).** Le garde-fou compte des
   objets présents mais invisibles : « vide » à l'œil, non vide au compteur.
3. **[H] Duplication depuis un document non actif.** `documents.add()` rend le
   nouveau document actif ; la boucle duplique ensuite depuis un document qui
   ne l'est plus. Plusieurs versions d'Illustrator exigent que le document
   source soit actif pour `duplicate()`. Coût de la parade : deux lignes.
4. **[H] Sélection non composée de PageItem.** En mode édition de texte,
   `selection` contient des `TextRange`, sans `visibleBounds` :
   `selectionBounds` lève, l'erreur remonte — comportement acceptable, mais le
   message n'oriente pas l'utilisateur.
5. **[H] Masques d'écrêtage.** Un tracé de masque dupliqué seul est un objet
   sans fond ni contour : présent au compteur, invisible à l'écran.
6. **[H] Cadrage hors limites.** Illustrator refuse un plan de travail au-delà
   de 16 383 pt ; l'affectation lèverait et l'erreur remonterait.

**Ce qui empêche aujourd'hui de trancher :** rien ne mesure. Le correctif P0
doit donc livrer, en plus des corrections, un compte rendu exploitable —
objets sélectionnés, copiés, refusés, masqués, dimensions obtenues, octets
écrits — pour que le premier essai réel soit conclusif du premier coup.

---

## E. Moteur d'export

**Solide :** planification complète avant écriture (le nombre de fichiers est
connu d'avance), file strictement séquentielle, `setTimeout` rendant la main au
navigateur, échec par fichier consigné sans interrompre le lot, regroupement
par (passe, composant, déclinaison) évitant de rouvrir et recolorer inutilement.

**Défaillant :** aucune vérification a posteriori (BUG-005), erreurs de mode
colorimétrique silencieuses (BUG-006), ré-association de document (BUG-007),
aucune gestion de collision, aucun statut par tâche au sens du cahier des
charges (`PENDING/PROCESSING/SUCCESS/WARNING/FAILED/SKIPPED`) — seulement deux
listes, `written` et `failures`. Pas de reprise, pas de nouvelle tentative.

**Portée d'export :** modèle tout-ou-rien. Impossible d'exclure un composant ou
une déclinaison d'un lot sans le désactiver globalement — l'amélioration
explicitement demandée (SCOPE-001 à 010) est absente.

---

## F. Réglages

Les réglages exposés (formats Print/Web, échelles, séparateur, marges, favicon,
passes) sont **réellement lus par le moteur** — c'est vérifié par les tests du
planificateur. Mais :

- aucun n'est persisté (BUG-008) ;
- aucun n'est validé (une échelle à 0 ou négative traverse la chaîne) ;
- il manque : langue, unités, profils colorimétriques, taille de lot,
  comportement en cas de collision, règles de preflight, réinitialisation.

---

## G. Persistance

État actuel : `localStorage['logo-forge-color-schemes']`, contenant les cinq
cases à cocher, les couleurs personnalisées et le seuil d'inversion — le tout
conditionné à la case « Remember color scheme settings ».

Manquent : composants, projet, client, destination, réglages, journaux,
récupération après interruption. Les trois scénarios de persistance exigés
(panneau, Illustrator, crash) échouent tous les trois aujourd'hui.

---

## H. Preflight

**Inexistant.** Aucun des 22 contrôles (PF-001 → PF-022) n'est implémenté.
La checklist de production fournie ne se traduit par aucune ligne de code.

À noter : deux contrôles sont déjà à portée immédiate parce que la couche
ExtendScript sait les lire — mode colorimétrique du document et cadrage du plan
de travail sur l'artwork. Les autres (expansion, vectorisation, surimpression,
points isolés, nuanciers) demandent un vrai parcours de l'arbre du document.

---

## I. Documentation

**Inexistante côté livrable.** Le seul document produit est
`Rapport/export-rapport.html`, un rapport technique destiné au designer.
Rien pour le client : ni README, ni guide des fichiers, ni explication des
formats, ni variables de studio, ni localisation.

Le dépôt lui-même est correctement documenté (README, DEVELOPMENT, ROADMAP,
LOADING-UXP) — mais `LOADING-UXP.md` décrit le chargement de la chaîne morte,
et aucun document n'explique le chargement CEP réellement utilisé.

---

## J. Structure de dossiers

Figée dans le code :

```text
{client}/Pour_Impression/{composant}/{couleur}/
{client}/Pour_Web/{composant}/{couleur}/
{client}/Rapport/
```

Ni template, ni renommage, ni numérotation, ni mode Designer/Client/Agence.
`FOLDERS` est une constante de module. Les modèles de structure demandés
(FOL-009 à 012, CLI-001 à 008) sont absents.

Le nommage `{Client}_{Composant}_{Couleur}_{Taille}.{ext}` fonctionne et est
testé, mais n'est pas un moteur de gabarit : les variables `{{project}}`,
`{{brand}}`, `{{profile}}`, `{{version}}`, `{{date}}` n'existent pas, et aucun
aperçu du nom n'est affiché avant export.

---

## K. UI / UX

**Acquis :** mise en page ancrée en positionnement absolu (le piège `vh` de CEP
est traité), compatibilité Chromium 61 vérifiée par garde-fou automatique,
onglets, modales, barre de progression réelle, écran de fin actionnable,
états vides rédigés.

**Manques :** icônes glyphiques (BUG-009), aucun état `loading` sur les actions
unitaires (Set Component reste inerte pendant l'appel), aucun état `focus`
visible, aucune confirmation avant les actions destructrices (« Réinitialiser »
efface sans demander), aucune traduction (chaînes françaises en dur), messages
d'erreur sans cause ni remède ni bouton « Réessayer ».

---

## L. Diagnostics

**Inexistants.** Le seul indicateur est la pastille d'état de l'en-tête, qui ne
teste qu'une chose : la présence de `window.__adobe_cep__`. Elle n'appelle même
pas `lfPing`. Un ExtendScript non chargé — cas le plus fréquent en CEP — est
donc affiché comme « Illustrator connecté ».

Aucune journalisation : ni horodatage, ni action, ni entrée, ni résultat.

---

## M. Fonctionnalités manquantes

Par priorité, en reprenant la matrice produit :

**P0** — Package document + grille · Preflight · Portée d'export fine ·
Vérification des fichiers · Package QA · Documentation client · Gestion des
collisions · Persistance du projet · Vraies miniatures.

**P1** — Diagnostics · Journalisation · Multilingue (fr/en) · Templates de
structure · Moteur de nommage à variables · Contrast checker · Lockups ·
Manifest · Statuts de tâches et reprise · Récupération après crash ·
Système d'icônes.

**P2** — Favicon ICO · WebP · Mockups · Historique de versions ·
Kit réseaux sociaux · Brand Guide.

**P3** — Assistant couleur, cloud, Figma, API.

---

## N. Risques

1. **Aucune exécution réelle.** Toute l'API Illustrator utilisée est
   documentaire. Les noms de propriétés d'options d'export, l'écriture de
   `artboardRect`, les identifiants `executeMenuCommand`, la duplication
   inter-documents : rien n'est confirmé. **C'est le risque dominant du
   projet** — il se réduit par une seule chose, un essai instrumenté.
2. **Deux plugins pour un.** Chaque évolution demande de choisir sa cible ; la
   chaîne morte capte l'essentiel des tests.
3. **Destruction du document source.** L'architecture actuelle est correcte
   (copies temporaires partout), mais `setComponent` manipule la sélection du
   document de l'utilisateur : toute correction doit rester non destructive.
4. **Volume.** 4 composants × 6 déclinaisons × 2 passes ≈ 200 fichiers, chacun
   précédé d'une réouverture de document. Aucune mesure de durée n'existe.
5. **Chromium 61.** Toute dépendance moderne est exclue ; les garde-fous
   existants doivent être maintenus.

---

## O. Plan de correction

Ordre imposé par la mission, avec ce qui est réellement livrable et vérifiable.

| Phase     | Contenu                                                                  | Vérifiable sans Illustrator ? |
| --------- | ------------------------------------------------------------------------ | ----------------------------- |
| **1–2**   | Audit, cartographie                                                      | fait                          |
| **3**     | **Set Component** : BUG-001 à 004, sonde de sélection, vraies miniatures | oui, par doublure fidèle      |
| **4**     | Document/plan de travail : cadrage, marges, garde-fous                   | partiellement                 |
| **5**     | Composants/variantes : persistance, réassignation, ordre                 | oui                           |
| **6**     | Couleurs : mapping source→cible, contraste                               | oui                           |
| **7**     | Preflight : moteur + contrôles lisibles                                  | oui pour la logique           |
| **8**     | Export : statuts, vérification fichier, BUG-005 à 007, portée fine       | oui                           |
| **9**     | Nommage : gabarit à variables, aperçu, collisions                        | oui                           |
| **10**    | Structure : templates Designer/Client/Agence                             | oui                           |
| **11**    | Documentation client fr/en                                               | oui                           |
| **12**    | Package QA : attendu vs réel                                             | oui                           |
| **13–14** | Réglages + persistance complète                                          | oui                           |
| **15–16** | UI/UX, icônes, diagnostics, journalisation                               | oui                           |
| **17–20** | Avancé, E2E, robustesse, nettoyage                                       | dépend d'Illustrator          |

**Décision d'ordonnancement.** Les phases 3 à 16 sont toutes vérifiables hors
Illustrator, à une réserve près : ce qui est vérifié, c'est le contrat passé
avec Illustrator, pas Illustrator lui-même. Chaque phase doit donc livrer, en
plus du code, de quoi rendre le premier essai réel conclusif : décomptes,
messages orientés, journal consultable.

**Ce qui est engagé immédiatement (P0, phase 3) :** BUG-001, BUG-002, BUG-003,
BUG-004, plus une sonde de sélection pour rendre le diagnostic définitif au
premier essai dans Illustrator.

---

## P. Défauts trouvés après l'audit

L'audit portait sur le code tel qu'il était. Ces défauts-là ne s'y trouvaient
pas : ils sont apparus en éprouvant les corrections — la plupart en écrivant
un scénario qui exerçait un chemin que rien n'avait encore parcouru. Ils sont
consignés ici pour que le dossier reste le récit complet.

### BUG-011 — La persistance des composants était sans effet

**Cause :** le démarrage réamorçait `state.components` avec quatre composants
neufs, juste après que `restoreProject()` eut restauré ceux du projet.
**Fichier :** `src/panel-cep.html`.
**Fonction :** bloc de démarrage.
**Impact :** toute capture était perdue à la fermeture du panneau — c'est-à-dire
exactement ce que la phase 13–14 prétendait avoir corrigé.
**Solution :** ne semer les quatre composants par défaut que si la restauration
n'en a rendu aucun.
**Test :** `tests/panelCep.test.ts`, et le scénario de bout en bout, dont le
compteur passe de 0/4 à 2/4 après rechargement.

**Pourquoi il n'avait pas été vu :** la doublure du scénario répondait « absent »
à toute vérification d'existence de fichier. Les composants restaurés étaient
donc marqués manquants, et le compteur à zéro paraissait normal. Une doublure
trop complaisante masque exactement ce qu'elle est censée révéler.

### BUG-012 — Cinq réglages changeaient l'état sans l'enregistrer

**Cause :** les gestionnaires du dossier de livraison, du nom du client, des
passes, du séparateur et de la case Favicons appelaient un rendu, jamais
`persistProject()`.
**Fichier :** `src/panel-cep.html`.
**Impact :** le dossier de livraison — le réglage le plus pénible à ressaisir —
était perdu à chaque ouverture. La reprise d'un lot devenait impossible, son
empreinte ne pouvant plus correspondre.
**Solution :** enregistrer dans chacun des cinq gestionnaires.
**Test :** scénario de reprise, qui échoue sans cela.

### BUG-013 — Un appel sans réponse suspendait le panneau indéfiniment

**Cause :** aucune borne sur `evalScript`. Illustrator peut ne jamais rappeler :
boîte de dialogue modale ouverte par un script, hôte planté.
**Fichier :** `src/js/export-engine.js`.
**Fonction :** `call`.
**Impact :** bouton grisé, aucune erreur, aucun recours — l'inverse exact de
l'exigence « aucune erreur silencieuse ».
**Solution :** un délai de garde par appel, et un appel qui ne se règle qu'une
fois — ni la réponse tardive d'un appel abandonné, ni un hôte qui rappellerait
deux fois ne relancent la suite du lot.
**Test :** `tests/robustness.test.ts`, horloge simulée.

### BUG-014 — Un enregistrement abîmé rendait le panneau inutilisable, durablement

**Cause :** `restoreProject()` recopiait les valeurs enregistrées sans vérifier
leur forme. Un `formats` devenu chaîne faisait lever le démarrage.
**Fichier :** `src/panel-cep.html`.
**Impact :** l'état fautif étant relu à chaque ouverture, le panneau restait
mort tant que le stockage local n'était pas vidé à la main — ce qu'un designer
n'a aucune raison de savoir faire.
**Solution :** vérifier la forme de chaque valeur relue, ramener les champs
calculés à des nombres, et proposer sur place de repartir des réglages par
défaut quand le démarrage échoue malgré tout.
**Test :** `tests/robustness.test.ts` et le scénario « conditions dégradées ».

### BUG-015 — Un élément d'interface manquant arrêtait le script en silence

**Cause :** les gestionnaires sont câblés au chargement, hors de tout
garde-fou ; `byId()` rendait `null`, et l'affectation levait.
**Fichier :** `src/panel-cep.html`.
**Fonction :** `byId`, et le câblage au niveau du module.
**Impact :** panneau vide, aucun message — le symptôme même qui avait motivé
l'audit.
**Solution :** un élément absent rend un substitut inerte ; le reste du panneau
continue de fonctionner, et l'absence est nommée à l'écran.
**Test :** `tests/panelCep.test.ts` et le scénario « conditions dégradées ».

### Deux imprécisions corrigées sans être des bugs

- **Le journal séparait ses colonnes par une flèche.** Un glyphe pictographique,
  interdit comme icône fonctionnelle ; remplacé par un point médian. Trouvé par
  le garde-fou d'iconographie, sur du code que j'avais écrit après lui.
- **`state.runTraceLost` était posé et jamais lu.** Un drapeau que personne ne
  regarde ne protège de rien : la perte de la trace est maintenant annoncée à
  la fin du lot.

### BUG-016 — Une virgule finale rendait tout le plugin inopérant dans Illustrator

**Cause :** deux littéraux d'objet de `src/jsx/main.jsx` portaient une virgule
finale. ES3 les refuse. ExtendScript ne charge pas un fichier à moitié : le
fichier entier était rejeté, et aucune fonction globale n'était définie.
**Fichier :** `src/jsx/main.jsx`, lignes 520 et 2120.
**Fonction :** aucune en particulier — c'est le chargement qui échoue.
**Impact :** total. Chaque appel répondait « `lf*` n'est pas une fonction »,
pour les quarante fonctions. Le panneau s'ouvrait normalement, ce qui rendait
la panne d'autant plus déroutante : l'interface allait bien, seul l'hôte était
absent.
**Solution :** virgules retirées ; toutes, y compris les sept d'un littéral de
tableau, légales en ES3 mais bannies par uniformité — le parseur d'ExtendScript
n'est pas celui du contrôle, et la distinction ne se vérifierait qu'en
production.
**Test :** `tests/exportEngine.test.ts` parse désormais `main.jsx` en **ES3**,
et non plus en ES5.

**Pourquoi il n'avait pas été vu :** le contrôle de compatibilité parsait la
couche ExtendScript avec `ecmaVersion: 5`. ES5 accepte les virgules finales ;
ES3 non. Un garde-fou réglé une marche trop haut ne garde rien — il valide
exactement ce qu'il devrait refuser, et le fait avec l'autorité d'un test vert.
Le même contrôle interdit maintenant les méthodes absentes du moteur ES3
(`forEach`, `map`, `filter`, `trim`, `JSON`, `Object.keys`, `Array.isArray`,
`Date.now`, `bind`), qui ne se manifesteraient qu'à l'exécution.

### BUG-017 — Une fonction déclarée dans un bloc faisait rejeter le fichier

**Cause :** deux fonctions étaient déclarées à l'intérieur d'un bloc `try`
(`record`, `report`). En ES3, une déclaration de fonction est un
_SourceElement_ : elle n'est légale qu'au niveau d'un programme ou d'un corps
de fonction. Dans un bloc, elle sort de la grammaire.
**Fichier :** `src/jsx/main.jsx`, lignes 593 et 1135.
**Impact :** identique à BUG-016 — le fichier entier rejeté, aucune fonction
globale définie, « `lf*` n'est pas une fonction » partout.
**Solution :** expressions de fonction affectées à une variable, forme
indiscutable en ES3.
**Test :** `tests/exportEngine.test.ts` parcourt l'arbre syntaxique et refuse
toute déclaration de fonction hors _SourceElement_.

**Pourquoi il n'avait pas été vu :** acorn accepte cette construction même en
`ecmaVersion: 3`, parce que tous les navigateurs l'acceptent. Un parseur
n'applique pas une norme, il imite un moteur — et celui qu'il imite n'est pas
celui qui exécute. Le contrôle ne pouvait donc pas venir du parseur seul : il
fallait interroger l'arbre.

**Deux durcissements associés**, sans preuve qu'ils étaient en cause :

- `'use strict'` retiré de l'IIFE — sans effet en ES3, une singularité de
  moins au chargement.
- `try { ... } finally { ... }` avec un `return` dans le `try` : remplacé par
  un nettoyage explicite sur chaque issue. Le moteur ExtendScript est réputé
  perdre la valeur de retour dans cette configuration.

### Ce qui manquait vraiment : un diagnostic qui vienne d'Illustrator

Deux causes successives ont été trouvées par lecture statique, et la seconde
ne l'a été qu'en écrivant un contrôle sur mesure. Cette méthode a une limite
de principe : elle devine ce que le moteur refuse, depuis un environnement qui
n'a pas le moteur.

`evalScript` évalue **n'importe quelle expression**, pas seulement les
fonctions déclarées. Le panneau peut donc envoyer un fragment autonome qui lit
`jsx/main.jsx`, l'évalue, et rapporte l'erreur telle que le moteur la formule,
avec son numéro de ligne — sans dépendre d'aucune fonction `lf*`, donc
utilisable précisément quand aucune n'existe.

C'est le bouton « Vérifier jsx/main.jsx », dans Réglages → Diagnostics. La
prochaine panne de ce genre se diagnostique en un clic, sans redéploiement et
sans bissection : le verdict vient d'Illustrator, pas d'une hypothèse.

### BUG-018 — Un moteur périmé laissait le panneau à moitié construit

**Cause :** `index.html` et `js/export-engine.js` évoluent ensemble mais se
déploient séparément. Recopier le premier sans le second laissait le panneau
appeler des fonctions qui n'existaient pas encore dans le moteur installé.
**Fichier :** `src/panel-cep.html`.
**Impact :** exception au démarrage, `renderAll` interrompu à mi-parcours, et
tout ce qui suivait — interrogation du document, sondage, reprise proposée —
jamais exécuté. À l'écran : l'en-tête, et un corps quasi vide. Le défaut
revenait à **chaque build ajoutant une fonction au moteur**, ce qui le faisait
ressembler à une régression de mise en page.
**Solution :** le panneau déclare les 38 symboles qu'il attend et refuse de
démarrer sans eux, en nommant les manquants et le geste à faire. Et chaque
rendu est isolé : un rendu qui échoue n'emporte plus les suivants.
**Test :** `tests/panelCep.test.ts` compare la liste déclarée aux appels
réellement présents dans la source, et aux exports du moteur. La liste ne peut
donc pas vieillir en silence.

**Reproduit avant correction**, avec le moteur de `fcc9eba` à côté du panneau
courant : `TypeError: Cannot read properties of undefined (reading 'length')
at renderSocialPresets`. Après correction, le même montage rend :
« Moteur périmé : js/export-engine.js ne correspond pas à ce panneau —
6 fonction(s) manquante(s) : SOCIAL_PRESETS, checkHostScript, planSocialKit,
runSocialKit, snapshotMatches, verifySnapshot ».

**Sur la piste CSS.** L'hypothèse examinée était une propriété incompatible
réintroduite à chaque phase. Elle ne l'était pas : `100vh`, `100dvh`, `100svh`,
`calc(100v` et `position: fixed` sont absents de la source comme du fichier
livré, et la mise en page est en positionnement absolu borné depuis le début.
Le garde-fou demandé a été ajouté quand même — la régression est plausible, le
contrôle coûte trois lignes, et il vaut mieux qu'il existe avant.

### BUG-019 — ExtendScript n'insère pas le point-virgule d'un `continue` en corps d'`if`

**Cause :** `if (!paths[i]) continue`, sans point-virgule. En ES3, `continue`,
`break` et `return` sont des _productions restreintes_ : la norme veut qu'un
point-virgule soit inséré à la fin de la ligne. ExtendScript ne le fait pas
dans ce cas ; il continue de lire, tombe sur l'instruction suivante, et rend
**« Attendu : ; »**.
**Fichier :** `src/jsx/main.jsx`, ligne 266 de la révision déployée.
**Impact :** identique aux deux précédents — fichier entier rejeté, aucune
fonction globale, « `lf*` n'est pas une fonction » partout.
**Solution :** la couche ExtendScript n'est plus mise en forme sans
point-virgule. `src/jsx/` sort de `.prettierignore`, avec une exception
`semi: true, trailingComma: none` : Prettier les pose et `npm run format:check`
les impose. La classe entière disparaît, plutôt qu'une occurrence.
**Test :** `scripts/check-jsx-es3.mjs`, appelé par la suite et par
`npm run verify`.

**Ce qui a permis de le trouver.** Le bouton « Vérifier jsx/main.jsx » a rendu
« ligne 266 : Attendu : ; » — le verdict d'Illustrator, pas une hypothèse. La
lecture seule aurait pu continuer longtemps : les quatre `continue` nus des
lignes 172, 182, 1238 et 1759 sont **suivis d'une accolade fermante** et ne
gênent pas le moteur ; le premier suivi d'une vraie instruction est
exactement celui qui l'arrête. Rien, dans le code, ne distinguait les uns des
autres à l'œil.

### Ce que trois pannes de suite ont appris

Trois causes, trois classes différentes, un seul symptôme, et à chaque fois un
garde-fou vert :

| Défaut                | Ce que le contrôle faisait | Ce qu'il fallait                                 |
| --------------------- | -------------------------- | ------------------------------------------------ |
| Virgule finale        | parsait en ES5             | parser en ES3                                    |
| Fonction dans un bloc | parsait en ES3             | interroger l'arbre — acorn imite les navigateurs |
| `continue` sans `;`   | parsait en ES3             | interdire l'ASI — le moteur ne l'applique pas    |

La leçon n'est pas « il fallait un meilleur parseur » : c'est qu'**un parseur
n'applique pas une norme, il imite un moteur** — et celui qu'il imite n'est pas
celui qui exécute. D'où deux conséquences, désormais tenues :

1. `scripts/check-jsx-es3.mjs` interdit **nommément** ce que le moteur a
   réellement refusé, en plus de ce que la grammaire refuse. Chacune des onze
   classes est éprouvée par injection.
2. La mise en forme ne laisse plus le choix : point-virgules obligatoires,
   virgules finales interdites, appliqués par `format:check`.

### BUG-020 — Le ping du contrôle système répondait un autre mot

**Cause :** `lfPing` rendait `OK|logo-forge` ; la sonde du panneau exige
`pong`, et refuse toute autre réponse — un hôte qui dirait « OK » à tout ne
prouverait rien.
**Fichier :** `src/jsx/main.jsx`.
**Impact :** la première sonde du contrôle système échouait sur un hôte
parfaitement sain, ce qui jetait le doute sur les cinq autres.
**Solution :** `return 'OK|pong'`.
**Test :** `tests/exportEngine.test.ts` lit le mot exigé dans le plan de
diagnostic du moteur, le confronte à ce que rend `lfPing` **dans le vrai
fichier**, et échoue si les deux divergent.

**Pourquoi il n'avait pas été vu :** toutes les doublures répondaient
`OK|pong`. Elles décrivaient le contrat tel qu'il aurait dû être, et personne
ne confrontait le fichier réel à ce que le moteur demande. Une doublure qui
énonce le contrat des deux côtés ne vérifie plus rien : elle se contente
d'être d'accord avec elle-même.

### BUG-021 — Duplication vers un groupe d'un autre document

**Cause :** `placeComponentAt` dupliquait chaque objet du composant vers un
`GroupItem` de la planche — donc une cible appartenant à **un autre
document**. Illustrator refuse, sans message.
**Fichier :** `src/jsx/main.jsx`, `placeComponentAt`.
**Impact :** planche de revue vide, et « aucun objet placé pour <chemin> »
comme seule explication.
**Solution :** duplication vers le **calque** de la planche — une cible
`Layer` est acceptée d'un document à l'autre — puis regroupement à
l'intérieur du même document, où le déplacement est sûr. En dernier recours,
un repli par le presse-papiers, employé uniquement si la duplication ne rend
rien : il écrase ce que l'utilisateur y avait mis, ce qui ne se justifie que
pour éviter une planche vide.
**Test :** quatre cas dans `tests/packageDocument.test.ts`, dont un où la
doublure **refuse** une cible d'un autre document, comme Illustrator.

**Ce qui a coûté le plus cher ici n'est pas le défaut, c'est le silence.** Le
`catch` autour de `duplicate()` jetait la raison, et l'erreur finale ne
nommait que le chemin du fichier. Le diagnostic a donc porté d'abord sur
`setComponent`, qui n'y était pour rien — il vérifie déjà que des objets ont
été copiés et que le fichier n'est pas vide, et aurait refusé de définir le
composant. Les causes sont désormais collectées et jointes au message.

### Planche vivante — ce que le dépôt avait déjà, et ce qui manquait

La grille composants × déclinaisons existait : c'est la **planche de revue**,
produite d'un bloc par `lfCreatePackage` / `lfPlaceComponent` / `lfAddLabel`.
Ce qui manquait n'était pas la grille, c'était son **rythme** : une planche qui
s'ouvre à la première capture et se complète d'une colonne à chaque suivante,
sans se refermer.

La fonctionnalité est donc bâtie sur les primitives existantes —
`openComponent` (copie de travail : le fichier du composant n'est jamais
recoloré), `applyColorScheme` (déjà éprouvé), et les aides de placement — plutôt
qu'en parallèle.

**Trois écarts à la proposition reçue, chacun pour une raison mesurée :**

- **Le document ne peut pas se retrouver par son nom.** `document.name` n'est
  pas assignable dans Illustrator ; un document non enregistré s'appelle
  « sans-titre ». Chercher par préfixe n'aurait jamais rien trouvé, et chaque
  capture aurait ouvert une planche de plus. La planche est donc tenue par
  référence, comme `session` et `packageDocument` le sont déjà, avec une
  vérification qu'elle est encore ouverte — le designer a pu la fermer.
- **`app.executeMenuCommand('undo')` pour rétablir les couleurs** aurait porté
  sur le document actif, qui n'est plus le bon à ce moment-là, et l'annulation
  scriptée est réputée imprévisible. Ouvrir une copie de travail par ligne
  supprime la question : il n'y a rien à annuler.
- **Positionner `pasted[0]` seul** aurait laissé les autres objets d'un logo
  multi-tracés là où le collage les avait mis. Les copies sont regroupées, puis
  le groupe est mis à l'échelle et centré.

**Un défaut trouvé en éprouvant, pas en relisant :** la règle qui décide du
fond sombre appelait `perceivedLuminance` avec un hexadécimal, alors qu'elle
attend un triplet. Le résultat était `NaN`, la comparaison toujours fausse, et
**aucune ligne blanche n'aurait reçu de fond** — la planche aurait montré des
cellules vides en affirmant les avoir remplies. Mesuré depuis, sur une encre
sombre : noir 0, couleur 29, réserve 226, blanc 255. Le seuil est posé à 140,
sur ces valeurs.

## BUG-022 — Le panneau vide n'était vu par aucun contrôle

Deux garde-fous lisaient déjà `dist/index.html` : la compatibilité CEP de la
CSS et la compatibilité ES3 de la couche ExtendScript. Aucun ne l'**exécutait**.
Or le corps du panneau est écrit par son script : une exception au démarrage
laisse l'en-tête, un fond gris, et rien d'autre — précisément le « panneau
vide » signalé après chaque redémarrage d'Illustrator.

`scripts/check-panel-boot.mjs` fait démarrer le panneau construit dans un DOM,
face à un hôte CEP simulé, et refuse la livraison s'il ne rend rien. Il est
branché sur `npm run build`, aux côtés des deux autres.

**Deux ouvertures y sont éprouvées, pas une.** La première part d'un stockage
vide ; la seconde relit l'enregistrement écrit par la première — c'est le
chemin que suit un panneau rouvert après un redémarrage, et il ne passe pas par
le même code. Le geste joué entre les deux (un nom saisi, un composant ajouté)
sert à obtenir un enregistrement réel, écrit par le panneau lui-même.

Le contrôle a été éprouvé sur quatre pannes injectées : dossier `js/` oublié
dans la copie, moteur d'une version antérieure, exception au démarrage, corps
rendu vide. Chacune est refusée, et nommée.

**Le témoin `#lf-startup-check`** complète le contrôle là où il ne va pas :
chez le tiers, dans Illustrator. Il est écrit dans le HTML, donc affiché avant
toute exécution ; le script le fait avancer d'étape en étape (« script
démarré », « projet enregistré relu », « rendu de l'interface », « lecture du
document ») et le retire quand le panneau est monté. S'il reste visible, il
nomme l'endroit exact où le démarrage s'est arrêté — et s'il porte encore
« script non exécuté », c'est que le JavaScript n'a pas tourné du tout. Un
panneau CEP n'a pas de console : c'est le seul message disponible.

## BUG-023 — Les couleurs personnalisées n'atteignaient jamais la planche

Défaut confirmé, reproduit, corrigé.

La teinte partait vers deux destinations par deux chemins différents :
l'export l'envoyait telle que saisie, `#2680eb` ; la planche de
prévisualisation la dépouillait de son dièse, `2680eb`. Et
`applyColorScheme` exigeait sept caractères :

```js
if (!hex || String(hex).length < 7) return err('couleur personnalisee manquante')
```

Six caractères, donc refus. La ligne était comptée dans les « cellules
manquées » et la couleur personnalisée n'apparaissait jamais sur la planche —
alors qu'elle fonctionnait à l'export. Reproduit par la doublure :

```
résultat : ["2","1","1","Bleu marque : recolorage","nouvelle","Logo"]
```

Corrigé des deux côtés : la validation accepte désormais les deux formes et
refuse ce qui n'est pas six chiffres hexadécimaux (en le disant), et le panneau
transmet à la planche exactement la valeur qu'il transmet à l'export. Après
correction, la même construction rend `["2","1","2","", …]` : les deux cellules
sont posées.

**Ce que le panneau faisait bien, et qui a été mesuré avant d'être mis en
cause :** le formulaire valide le nom, l'ajoute à l'état, le persiste, le
réaffiche après rechargement, et la couleur entre bien dans les déclinaisons
actives. Une première lecture semblait montrer un nom perdu — c'était la
mesure qui était fausse (`innerText` n'inclut pas la valeur d'un `<input>`).
Le seul défaut d'interface trouvé est réel mais discret : le refus « Donnez un
nom à la couleur » s'affichait au bas du panneau, loin du formulaire. Il se lit
désormais sous le bouton, et le curseur revient dans le champ.

## BUG-024 — La planche se construisait sans laisser de trace

La planche est fabriquée dans Illustrator, hors de portée du panneau : un échec
ne rendait qu'un message final, sans dire si le document avait été créé ni
combien de colonnes avaient tenu.

`buildPreviewColumn` tient désormais un journal — « début », « document créé
(N lignes) » ou « document retrouvé », « colonne X ajoutée (n/N cellules) »,
« ERR — message exact » — que `lfPreviewTrace` rend au panneau. Celui-ci le
recopie dans son propre journal, sous le préfixe `preview-doc:`, **après chaque
construction, réussie ou non** : c'est justement quand elle échoue qu'il faut
savoir jusqu'où elle était allée. C'est ce journal qui a livré BUG-023 :

```
début | document créé (2 lignes) | colonne Logo ajoutée (1/2 cellules,
manquées : Bleu marque : recolorage)
```

## BUG-025 — L'export n'était éprouvé qu'au bout d'une livraison entière

Une option d'export refusée par une version d'Illustrator ne se voyait qu'après
plusieurs minutes de travail, et jamais pendant la mise au point.

Le bouton « Essayer les trois exports », dans les diagnostics, écrit le
document ouvert en SVG, PNG et PDF dans le dossier temporaire et rend, pour
chaque format, son chemin et sa taille — la seule preuve qu'un export a eu
lieu. Un format refusé n'emporte pas les deux autres : c'est précisément ce que
l'essai sert à distinguer. Rien n'est écrit dans le dossier de livraison.

### Ce que les doublures cachaient

Trois écarts entre la doublure Illustrator et le vrai DOM ont été trouvés en
écrivant ces épreuves, et corrigés dans la doublure :

- `artboards` n'avait pas `setActiveArtboardIndex` : **aucun export n'avait
  jamais été exercé** de bout en bout.
- `document.pathItems` ne contenait que les tracés créés par `rectangle`, pas
  ceux des calques : un recolorage paraissait sans effet sur un document
  ouvert.
- `duplicate()` ne recopiait pas la peinture : la planche paraissait n'avoir
  rien recoloré.

Une doublure trop indulgente ne fait pas échouer les épreuves — elle les fait
réussir pour rien.
