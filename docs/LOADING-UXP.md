# Charger Logo Forge dans Illustrator

Guide pas-à-pas pour charger le plugin en développement, sur **macOS** et sur
**Windows**. Comptez cinq minutes la première fois.

## Prérequis

| Élément                  | Version                       |
| ------------------------ | ----------------------------- |
| Adobe Illustrator        | 25.0 (CC 2021) ou plus récent |
| Adobe Creative Cloud     | à jour                        |
| UXP Developer Tool (UDT) | 1.6 ou plus récent            |
| Node                     | 22 (voir `.nvmrc`)            |

## Étape 0 — Construire le plugin

Le dossier `dist/` n'est pas versionné : il faut le produire avant tout
chargement.

```bash
npm ci
npm run build
```

À l'issue du build, `dist/` doit contenir exactement :

```
dist/
├── manifest.json          Manifest UXP (copié depuis src/)
├── index.html             HTML du panneau
├── index.js               Bundle IIFE (React + cœur métier)
├── assets/
│   └── style.css          Feuille de style
└── icons/
    ├── panel-light.png    23x23   Thèmes clairs
    ├── panel-light@2x.png 46x46
    ├── panel-dark.png     23x23   Thèmes sombres
    ├── panel-dark@2x.png  46x46
    ├── plugin.png         48x48   Liste des plugins
    └── plugin@2x.png      96x96
```

Si `icons/` est absent, lancez `npm run icons`. Un manifest qui déclare une
icône introuvable fait échouer le chargement dans UDT.

## Étape 1 — Installer UXP Developer Tool

UDT ne s'installe pas depuis le site d'Adobe : il se trouve dans l'application
Creative Cloud.

### macOS

1. Ouvrez **Adobe Creative Cloud** (icône dans la barre de menus, en haut à
   droite de l'écran).
2. Onglet **Applications** dans la colonne de gauche.
3. Section **Autres modules** (ou _Additional tools_ si votre CC est en anglais),
   tout en bas de la liste.
4. Repérez **UXP Developer Tool** et cliquez sur **Installer**.

### Windows

1. Ouvrez **Adobe Creative Cloud** (icône dans la zone de notification, en bas
   à droite de la barre des tâches).
2. Onglet **Applications**.
3. Section **Autres modules**, en bas de la liste.
4. Repérez **UXP Developer Tool** et cliquez sur **Installer**.

> **UDT n'apparaît pas dans la liste ?** Activez d'abord le mode développeur :
> Creative Cloud → menu **⋯** (en haut à droite) → **Préférences** → **Applications**
> → cochez **Autoriser les modules externes non certifiés** / _Enable developer
> tools_. Redémarrez Creative Cloud.

## Étape 2 — Lancer Illustrator

**Lancez Illustrator avant UDT.** UDT ne détecte que les applications déjà
ouvertes : si Illustrator démarre après, il n'apparaîtra pas dans la liste des
hôtes et le bouton **Load** restera inactif.

Ouvrez aussi un document (même vide) : certaines actions du panneau supposent un
document actif.

## Étape 3 — Lancer UXP Developer Tool

- **macOS** : Finder → **Applications** → **Adobe UXP Developer Tool** →
  double-clic. (Raccourci : Spotlight avec `⌘ + Espace`, tapez `UXP`.)
- **Windows** : menu **Démarrer** → tapez `UXP` → **Adobe UXP Developer Tool**.

Au premier lancement, UDT peut demander l'autorisation de communiquer avec les
applications Adobe : acceptez, sans quoi le chargement échouera.

Vérifiez en haut de la fenêtre que **Illustrator** figure bien parmi les
applications connectées, avec un point vert.

## Étape 4 — Ajouter le plugin

1. Cliquez sur **Add Plugin…**, en haut à gauche de la fenêtre UDT.
2. Une fenêtre de sélection de fichier s'ouvre.
3. Naviguez jusqu'à votre clone de `logo-forge`, entrez dans le dossier `dist/`
   et sélectionnez le fichier **`manifest.json`**.

   > Sélectionnez bien `dist/manifest.json`, et **non** `src/manifest.json` :
   > le manifest de `src/` décrit le plugin mais n'est pas accompagné du bundle
   > construit. UDT attend le manifest _à côté_ de `index.js` et `index.html`.
   - macOS : `~/…/logo-forge/dist/manifest.json`
   - Windows : `C:\…\logo-forge\dist\manifest.json`

4. Cliquez sur **Sélectionner** / **Ouvrir**.

`Logo Forge` apparaît alors dans la liste des plugins d'UDT, avec la mention
_Loaded: No_.

## Étape 5 — Charger dans Illustrator

Sur la ligne **Logo Forge**, dans la colonne **Actions**, cliquez sur **•••**
puis sur **Load**.

La colonne **Status** passe à **Loaded**. Illustrator charge le panneau.

Les autres actions du même menu, utiles ensuite :

| Action     | Effet                                        |
| ---------- | -------------------------------------------- |
| **Reload** | Recharge le panneau après un `npm run build` |
| **Debug**  | Ouvre la console de développement du panneau |
| **Unload** | Décharge le plugin d'Illustrator             |

## Étape 6 — Ouvrir le panneau dans Illustrator

Dans Illustrator :

**Fenêtre → Extensions → Logo Forge**

(en anglais : _Window → Extensions → Logo Forge_)

Le panneau s'ouvre, flottant. Vous pouvez l'ancrer en le faisant glisser sur un
bord de l'espace de travail. Vous devez voir :

- l'en-tête **Logo Forge**, avec le résumé du pack (nombre de fichiers, de
  dossiers, répartition par format) ;
- les quatre préréglages ;
- les options d'export : marque, variantes, déclinaisons, formats, usages,
  tailles, nommage ;
- l'aperçu de l'arborescence du pack ;
- le bouton d'export en pied de panneau.

## Boucle de développement

```bash
npm run dev      # reconstruit dist/ à chaque sauvegarde
```

Après chaque modification : **Reload** dans UDT, et le panneau se rafraîchit.
Nul besoin de le retirer et de le rajouter.

`npm run dev` n'exécute pas le générateur d'icônes. Les icônes ne changeant
qu'exceptionnellement, cela suffit ; si vous modifiez `scripts/generate-icons.ts`,
relancez `npm run icons`.

## Dépannage

| Symptôme                           | Cause probable                    | Solution                                                                  |
| ---------------------------------- | --------------------------------- | ------------------------------------------------------------------------- |
| Illustrator absent de la liste UDT | Lancé après UDT                   | Fermez UDT, vérifiez qu'Illustrator est ouvert, relancez UDT              |
| **Load** grisé                     | Aucun hôte compatible connecté    | Voir ci-dessus ; vérifiez aussi qu'Illustrator est en 25.0 ou plus récent |
| « Plugin failed to load »          | Icône ou fichier déclaré manquant | Relancez `npm run build`, vérifiez que `dist/icons/` contient les six PNG |
| Panneau absent du menu Extensions  | Plugin non chargé                 | Vérifiez que **Status** vaut _Loaded_ dans UDT                            |
| Panneau vide ou blanc              | Erreur JavaScript au démarrage    | **Debug** dans UDT, onglet Console                                        |
| Modifications sans effet           | Build non relancé                 | `npm run build`, puis **Reload**                                          |

## Distribution

Pour produire une archive installable plutôt que de charger depuis `dist/` :

```bash
npm run package   # écrit build/com.lionevi.logoforge-0.1.0.ccx
```

Un `.ccx` s'installe par double-clic via Creative Cloud. Notez qu'une
distribution hors Adobe Exchange exige un plugin signé ; le mode développeur
d'UDT reste la voie normale pendant le développement.
