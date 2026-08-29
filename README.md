# Logo Forge

Plugin **Adobe Illustrator** qui produit un pack de logos livrable : toutes
les déclinaisons d'une identité — composants, couleurs, formats, tailles —
écrites dans une arborescence prête à être envoyée au client, avec sa
documentation et son rapport.

> **État.** Le plugin est complet et vérifié de bout en bout **hors
> Illustrator** : suite de tests, scénarios en navigateur sur le panneau
> construit, doublure fidèle du modèle objet. Il n'a **jamais été exécuté
> dans Illustrator** — cet environnement de développement n'y a pas accès.
> Le premier essai réel suit le protocole de
> [docs/TEST-ILLUSTRATOR.md](docs/TEST-ILLUSTRATOR.md).

## Ce que fait le plugin

Un pack livrable est le produit de quatre axes — composants × déclinaisons ×
formats × tailles — soit couramment plus de deux cents fichiers. Logo Forge
calcule ce produit, l'affiche avant d'écrire, puis le produit et le vérifie.

| Axe              | Valeurs                                                         |
| ---------------- | --------------------------------------------------------------- |
| **Composants**   | 14 types : logo, mark, logotype, lockups, favicon, tampon…      |
| **Déclinaisons** | Couleur, Noir, Blanc, Réserve, plus les couleurs personnalisées |
| **Formats**      | AI, EPS, PDF, SVG, PNG, JPEG, plus `favicon.ico`                |
| **Tailles**      | Toute liste de largeurs, avec leur résolution                   |

### Ce qui est réellement livré

- **Capture depuis la sélection.** « Set Component » copie la sélection dans
  un document autonome, compte les objets copiés **et refusés**, cadre le
  plan de travail et rend une vignette issue d'un vrai export — pas un
  dessin d'approximation.
- **Couleurs contrôlées.** Déclinaisons appliquées aux tracés, correspondance
  source → cible par couleur, seuil d'inversion réglable, et contraste mesuré
  sur quatre fonds avant d'exporter quoi que ce soit.
- **Contrôle de production.** Douze contrôles automatiques (mode
  colorimétrique, points isolés, contours non vectorisés, surimpression, noir
  riche, texte vivant, nuances inutilisées…), deux réserves qui ne se voient
  qu'à l'œil, et des corrections classées : sûres ou à valider.
- **Export vérifié.** Chaque fichier est confronté au disque : chemin **et**
  taille. Un fichier vide est un échec, pas un succès. L'échec d'un fichier
  n'arrête pas les deux cents autres.
- **Nommage à variables.** Gabarit composable (11 variables), aperçu en
  direct, séparateur au choix, politique de collision explicite.
- **Trois arborescences** — client, designer, agence — et la documentation du
  pack en français ou en anglais, écrite pour un destinataire qui n'est pas
  designer.
- **Contrôle du pack.** À la fin, le dossier livré est **relu sur le disque**
  et confronté au manifeste : manquants, vides, doublons, intrus.
- **Reprise.** Un lot interrompu — panne, panneau fermé, machine éteinte —
  se reprend là où il s'est arrêté, après vérification de ce qui est
  réellement présent.
- **Kit réseaux sociaux.** Huit canevas aux dimensions exactes des
  plateformes, logo centré, fond assumé.
- **Diagnostics et journal.** Six sondes en lecture seule, et un journal de
  toutes les opérations avec leur durée — de quoi rendre un échec analysable.

## Deux chaînes dans un même dépôt

Le dépôt porte **deux** implémentations. Une seule est chargée par
Illustrator :

| Chaîne                                                                | Rôle                                                                                             |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `src/panel-cep.html` + `src/js/export-engine.js` + `src/jsx/main.jsx` | **Ce qui est livré.** Extension CEP, panneau en JavaScript ES5, couche ExtendScript.             |
| `src/core/` + `src/ui/` + `src/illustrator/`                          | Chaîne UXP/React, **conservée pour un portage ultérieur**. `CSXS/manifest.xml` ne la charge pas. |

Le panneau CEP vise Chromium 61 : pas de syntaxe postérieure à ES5, pas de
`gap` ni de `inset` en CSS. La couche ExtendScript est un moteur ES3 sans
`JSON` — d'où le protocole texte `OK|charge`. Ces contraintes sont vérifiées
par des tests, pas seulement documentées.

## Installation en développement

Prérequis : Node 22 (voir `.nvmrc`) et Adobe Illustrator.

```bash
npm ci
npm run build          # produit dist/
```

Puis, sur macOS, avec Illustrator fermé :

```bash
npm run deploy:mac        # dossier système (demande sudo)
npm run deploy:mac:user   # dossier utilisateur, sans privilèges
```

Le script construit, **remplace** le dossier d'extension, remet les
permissions, puis compare les tailles déployées à celles de `dist/` et sort en
erreur au moindre écart — deux pannes de ce projet venaient d'une copie
partielle.

Reste à autoriser les extensions non signées : la marche à suivre, par système,
est dans [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md). Le panneau apparaît sous
_Fenêtre → Extensions → Logo Forge_.

## Commandes

| Commande                | Rôle                                             |
| ----------------------- | ------------------------------------------------ |
| `npm run build`         | Construit `dist/`                                |
| `npm test`              | Suite complète (825 cas)                         |
| `npm run test:e2e`      | Scénarios en navigateur sur le panneau construit |
| `npm run test:coverage` | Couverture du cœur métier, seuils appliqués      |
| `npm run lint`          | ESLint                                           |
| `npm run typecheck`     | TypeScript strict, sans émission                 |
| `npm run format:check`  | Vérification Prettier                            |
| `npm run check:jsx`     | Compatibilité ExtendScript de `src/jsx/`         |
| `npm run deploy:mac`    | Build, déploiement CEP et vérification (macOS)   |
| `npm run package`       | Build puis archive `.ccx` dans `build/`          |
| `npm run verify`        | Lint, typecheck, ES3, tests, build               |

## Documentation

- [INSTALL.md](INSTALL.md) — installation, pour qui n'a pas le dépôt

- [docs/AUDIT.md](docs/AUDIT.md) — l'audit d'origine et les défauts corrigés
- [docs/TEST-ILLUSTRATOR.md](docs/TEST-ILLUSTRATOR.md) — protocole du premier essai réel
- [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) — mise en place, conventions, débogage
- [docs/ROADMAP.md](docs/ROADMAP.md) — état et suite des travaux
- [docs/LOADING-UXP.md](docs/LOADING-UXP.md) — chargement de la chaîne UXP, dormante

## Licence

MIT.
