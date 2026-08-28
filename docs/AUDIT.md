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
