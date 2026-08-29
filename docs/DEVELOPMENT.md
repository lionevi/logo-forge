# Développement

## Mise en place

```bash
nvm use          # Node 22, cf. .nvmrc
npm ci
npm run verify   # lint + typecheck + tests + build
```

## Charger le plugin dans Illustrator

Marche à suivre détaillée, macOS et Windows :
**[docs/LOADING-UXP.md](LOADING-UXP.md)**. En résumé :

1. Installer UXP Developer Tool depuis l'application Creative Cloud.
2. `npm run build` — produit `dist/`, manifest, bundle et icônes compris.
3. Lancer Illustrator, **puis** UDT (UDT ne voit que les hôtes déjà ouverts).
4. Dans UDT : **Add Plugin** → `dist/manifest.json` → **Load**.
5. Illustrator : _Fenêtre → Extensions → Logo Forge_.

Pendant le développement, `npm run dev` relance le build à chaque sauvegarde ;
un **Reload** dans UDT recharge le panneau. UDT ouvre aussi une console de
débogage (**Debug**) qui affiche les erreurs du panneau.

## Organisation du code

### La règle structurante

`src/core/` ne doit jamais importer `uxp` ni `illustrator`, directement ou
indirectement. C'est ce qui rend la totalité de la logique testable en Node.

Le seul point de contact avec l'hôte est `src/ui/illustratorBridge.ts`. Tout
nouveau besoin d'API Illustrator y passe, derrière une interface définie dans
`core/types.ts`.

### Injection de dépendances

`runExport` reçoit deux collaborateurs :

- **`FileWriter`** — `ensureDirectory` et `writeFile`. En production,
  `createUxpWriter` l'adosse à `uxp.storage.localFileSystem` ; en test,
  `createMemoryWriter` enregistre en mémoire ce qui aurait été écrit.
- **`DocumentRenderer`** — `render(file)` renvoie les octets d'un fichier
  planifié. C'est le point d'extension pour brancher l'export Illustrator réel.

Pour ajouter un format, il suffit d'étendre `FileFormat` et de compléter le
renderer : le planificateur, le nommage et le moteur n'ont pas à changer.

## Tests

```bash
npm test                 # suite complète
npm run test:watch       # en continu
npm run test:coverage    # couverture, avec seuils appliqués
```

Les tests couvrent `src/core/` uniquement, et n'ont besoin ni de DOM ni
d'Illustrator (`environment: 'node'`). Les seuils de couverture sont appliqués
par `vitest.config.ts` : un cœur métier sous-testé fait échouer la CI.

### Déploiement sur macOS

```bash
npm run deploy:mac        # /Library/…  (sudo)
npm run deploy:mac:user   # ~/Library/… (sans privilèges)
```

`scripts/deploy-mac.sh` refuse de travailler si Illustrator est ouvert — une
extension remplacée sous ses pieds laisse le panneau sur l'ancien code sans le
dire, et c'est la moitié des faux diagnostics. Il construit, **remplace** le
dossier (`rsync --delete`, pour qu'aucun fichier périmé ne subsiste), remet les
permissions, puis compare taille par taille ce qui est arrivé à ce qui est
parti. Au moindre écart il sort en erreur : une vérification qui ne peut pas
échouer ne vérifie rien.

`LF_EXT_DIR` permet de viser un autre dossier — utile pour éprouver le script
sans toucher à l'installation.

### Compatibilité ExtendScript

```bash
npm run check:jsx
```

`src/jsx/` vise un moteur **ECMA-262 3e édition**, et ExtendScript ne charge
pas un fichier à moitié : la moindre construction refusée emporte le fichier
entier, et aucune fonction n'existe plus dans Illustrator.

Un parseur ne suffit pas — acorn imite les navigateurs, pas ExtendScript.
`scripts/check-jsx-es3.mjs` interroge donc l'arbre et interdit nommément :
`for…of`, décomposition, décomposition/reste, gabarits, fonctions fléchées,
classes, propriétés raccourcies, **fonctions déclarées dans un bloc**,
**`continue`/`break`/`return` sans point-virgule**, virgules finales, et les
méthodes absentes du moteur (`forEach`, `map`, `filter`, `trim`, `JSON`,
`Object.keys`, `Array.isArray`, `Date.now`, `bind`).

Le style de cette couche n'est pas négociable : **point-virgules obligatoires**
(`semi: true`), **virgules finales interdites**. Prettier les applique,
`format:check` les impose.

Quand Illustrator refuse quand même de charger le fichier : Réglages →
Diagnostics → **« Vérifier jsx/main.jsx »**. Le moteur relit le fichier et rend
l'erreur avec son numéro de ligne.

### Scénarios de bout en bout

```bash
npm run build && npm run test:e2e
```

Ces scénarios (`tests/e2e/`) ouvrent le panneau **construit** dans Chromium,
face à un hôte CEP simulé qui tient un disque : capture, couleurs, contrôle de
production, export, contrôle du pack, reprise après interruption, kit réseaux
sociaux. Ils vérifient l'enchaînement complet, du clic à l'appel ExtendScript.

Ils ne font pas partie de `npm test` : ils demandent un navigateur, que
l'intégration continue n'a pas. Prérequis, à installer soi-même :

```bash
npm i -D playwright-core
# et un Chromium sur la machine, sinon :
LOGO_FORGE_CHROMIUM=/chemin/vers/chrome npm run test:e2e
```

Sans l'un ou l'autre, la commande le dit et s'arrête : elle ne télécharge rien
et ne prétend pas avoir vérifié quoi que ce soit.

**Ce qu'ils ne prouvent pas** : le comportement d'Illustrator. La doublure
répond ce que la couche ExtendScript est censée renvoyer, pas ce
qu'Illustrator renverrait. Le premier essai réel suit le protocole de
[TEST-ILLUSTRATOR.md](TEST-ILLUSTRATOR.md).

Conventions :

- un fichier de test par module de `core/` ;
- des cas nommés en français, décrivant le comportement attendu et non
  l'implémentation ;
- les cas limites sont testés explicitement (entrée vide, valeur hors bornes,
  collision de noms, valeur levée non-`Error`).

## Contraintes UXP à connaître

| Contrainte                                       | Conséquence                                                       |
| ------------------------------------------------ | ----------------------------------------------------------------- |
| Pas de modules ES                                | Build IIFE unique (`dist/index.js`), `inlineDynamicImports: true` |
| Pas de `process`                                 | `process.env.NODE_ENV` est remplacé à la compilation par `define` |
| `manifest.json` à la racine du plugin            | Copié de `src/` vers `dist/` par un plugin Vite                   |
| Pas de `<script type="module">`                  | `src/index.html` est écrit à la main et copié tel quel            |
| Système de fichiers permissionné                 | `requiredPermissions.localFileSystem: "fullAccess"`               |
| Pas d'`eval`                                     | `allowCodeGenerationFromStrings: false`                           |
| Icône déclarée introuvable = échec du chargement | `scripts/generate-icons.ts`, enchaîné par `npm run build`         |

## Style

Prettier et ESLint font foi ; `npm run format` corrige, `npm run lint:fix`
également. Points d'attention propres au projet :

- commentaires et messages d'interface **en français**, identifiants de code en
  anglais ;
- un commentaire explique _pourquoi_, jamais _ce que_ fait la ligne suivante ;
- `@typescript-eslint/no-explicit-any` est une **erreur** dans `src/` — préférer
  une interface locale décrivant le sous-ensemble d'API réellement utilisé,
  comme le fait `illustratorBridge.ts` pour les types UXP.

## Icônes

`scripts/generate-icons.ts` encode les PNG à la main avec le seul `node:zlib` —
signature, IHDR, IDAT, IEND, en RGBA 8 bits — et trace le monogramme depuis une
fonte bitmap 5x7 intégrée. Le module `canvas` aurait imposé une compilation
native, contraire à l'exigence « zéro dépendance externe » et fragile en CI.

Le script est enchaîné par `npm run build` ; `npm run icons` le rejoue seul. Il
produit les six fichiers déclarés par le manifest, variantes `@2x` comprises,
car `scale: [1, 2]` fait chercher les deux à UXP.

Node exécute ce script directement (`node scripts/generate-icons.ts`) grâce au
retrait natif des types, disponible depuis Node 22.18. C'est aussi la raison
pour laquelle `package.json` déclare `"type": "module"`.

## Packaging

```bash
npm run package   # build + archive .ccx dans build/
```

`scripts/package-ccx.ts` écrit l'archive ZIP à la main via `node:zlib`, pour
tenir l'exigence « zéro dépendance externe ». Le script échoue si `dist/` est
vide ou si `manifest.json` en est absent — deux erreurs qui produiraient un
`.ccx` rejeté par UXP.

## Intégration continue

`.github/workflows/ci.yml` exécute, sur `main` et `develop` ainsi que sur chaque
pull request : formatage, lint, typecheck, tests, build, vérification que le
bundle ne contient aucun module ES, packaging `.ccx`, et publication de
l'archive en artefact de build.
