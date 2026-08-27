# Logo Forge

Plugin **Adobe Illustrator (UXP)** d'export automatisé de packs de logo.
En un clic, il produit toutes les déclinaisons d'une identité — variantes,
couleurs, formats, tailles — dans une arborescence de dossiers propre et
prévisible, prête à être livrée au client.

> État : socle technique fonctionnel. Le cœur métier (planification, nommage,
> couleur, moteur d'export) est complet et testé ; le rendu des fichiers depuis
> Illustrator est branché sur un adaptateur de démonstration. Voir
> [docs/ROADMAP.md](docs/ROADMAP.md).

## Ce que fait le plugin

Un pack de logo livrable, c'est le produit cartésien de quatre axes :

| Axe              | Valeurs                                                       |
| ---------------- | ------------------------------------------------------------- |
| **Variantes**    | Principal, Horizontal, Vertical, Icône seule, Typographique   |
| **Déclinaisons** | Couleur, Noir, Blanc, Niveaux de gris, Réserve                |
| **Formats**      | AI, EPS, PDF, SVG, PNG, JPEG, WebP                            |
| **Tailles**      | Toute liste de tailles en pixels, pour les formats matriciels |

Logo Forge calcule ce produit, le déduplique, en déduit l'arborescence, puis
écrit les fichiers. Un pack de livraison complet représente couramment plus de
200 fichiers.

### Ce qui le distingue

- **Le plan avant l'export.** L'arborescence complète est calculée et affichée
  _avant_ la première écriture. Aucune surprise à l'arrivée.
- **Diagnostics en amont.** Contraste WCAG insuffisant, tailles invalides,
  combinaisons impossibles (CMJN sur PNG), pack anormalement volumineux : tout
  est signalé avant de lancer l'export, pas après.
- **Nommage sûr par construction.** Accents retirés, caractères interdits
  filtrés, noms réservés Windows échappés, collisions suffixées. Un pack ne peut
  pas contenir deux fichiers qui s'écrasent.
- **Export résilient.** L'échec d'un fichier n'annule pas les 200 autres : les
  erreurs sont collectées et rapportées à la fin.
- **UXP, pas ExtendScript.** Interface React moderne, API Illustrator actuelle.

## Architecture

Le principe structurant : **le cœur métier ne connaît ni Illustrator ni UXP.**

```
src/core/     Logique pure, testable en Node, sans aucune dépendance externe
  types.ts          Types partagés
  colorManager.ts   Conversions RVB/CMJN, contraste WCAG, déclinaisons
  folderManager.ts  Nommage des fichiers, arborescence, déduplication
  planner.ts        Calcul du pack complet + diagnostics
  exporter.ts       Moteur d'export (FileWriter/DocumentRenderer injectés)
  presets.ts        Préréglages livrés

src/ui/       Interface React et pont UXP
  Panel.tsx              Panneau principal, détient l'état
  ExportSettings.tsx     Options d'export (composant contrôlé)
  PresetSelector.tsx     Sélecteur de préréglages
  illustratorBridge.ts   Seul module qui touche à require('uxp')
```

`exporter.ts` reçoit un `FileWriter` et un `DocumentRenderer` par injection.
En production ils s'adossent au système de fichiers UXP ; en test ils sont
remplacés par des doublures en mémoire. C'est ce découplage qui permet de
couvrir la totalité de la logique d'export sans lancer Illustrator.

## Préréglages livrés

| Préréglage                    | Contenu                                                            |
| ----------------------------- | ------------------------------------------------------------------ |
| **Livraison client complète** | Toutes variantes et déclinaisons, vecteur + matriciel, web + print |
| **Kit web**                   | SVG, PNG, WebP transparents, RVB, tailles d'écran usuelles         |
| **Dossier d'impression**      | AI, EPS, PDF en CMJN, sans matriciel                               |
| **Réseaux sociaux**           | Icônes matricielles aux tailles attendues par les plateformes      |

## Installation en développement

Prérequis : Node 22 (voir `.nvmrc`), Adobe Illustrator 2023 (27.0) ou plus
récent, et [UXP Developer Tools](https://developer.adobe.com/photoshop/uxp/devtool/).

```bash
npm ci
npm run build          # produit dist/
```

Puis dans UXP Developer Tools : **Add Plugin** → sélectionner `dist/manifest.json`
→ **Load**. Le panneau apparaît dans Illustrator sous _Fenêtre → Extensions →
Logo Forge_.

`npm run dev` relance le build à chaque modification ; un **Reload** dans UXP
Developer Tools suffit alors à recharger le panneau.

## Commandes

| Commande                | Rôle                                         |
| ----------------------- | -------------------------------------------- |
| `npm run build`         | Bundle UXP dans `dist/`                      |
| `npm run dev`           | Build en watch                               |
| `npm test`              | Suite Vitest                                 |
| `npm run test:coverage` | Couverture du cœur métier (seuils appliqués) |
| `npm run lint`          | ESLint                                       |
| `npm run typecheck`     | TypeScript strict, sans émission             |
| `npm run format:check`  | Vérification Prettier                        |
| `npm run package`       | Build puis archive `.ccx` dans `build/`      |
| `npm run verify`        | Lint + typecheck + tests + build             |

## Contraintes techniques

**UXP ne charge pas de modules ES.** Le build produit donc un IIFE unique
(`dist/main.js`), sans import dynamique ni découpage de chunks. `src/index.html`
est écrit à la main et copié tel quel : Vite ne bundle un HTML que si son script
porte `type="module"`, ce que UXP refuse.

**Zéro dépendance externe pour le cœur métier.** Conversions colorimétriques,
calcul de contraste, manipulation de chemins et écriture ZIP (`scripts/package-ccx.ts`,
bâti sur le seul `node:zlib`) sont implémentés dans le dépôt. Les seules
dépendances d'exécution sont React et React DOM.

## Documentation

- [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) — mise en place, conventions, débogage
- [docs/ROADMAP.md](docs/ROADMAP.md) — état actuel et suite des travaux

## Licence

MIT.
