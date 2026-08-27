# Développement

## Mise en place

```bash
nvm use          # Node 22, cf. .nvmrc
npm ci
npm run verify   # lint + typecheck + tests + build
```

## Charger le plugin dans Illustrator

1. Installer [UXP Developer Tools](https://developer.adobe.com/photoshop/uxp/devtool/) (UDT).
2. `npm run build` — produit `dist/`, avec `manifest.json` à sa racine.
3. Dans UDT : **Add Plugin** → `dist/manifest.json` → **Load**.
4. Illustrator : _Fenêtre → Extensions → Logo Forge_.

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

Conventions :

- un fichier de test par module de `core/` ;
- des cas nommés en français, décrivant le comportement attendu et non
  l'implémentation ;
- les cas limites sont testés explicitement (entrée vide, valeur hors bornes,
  collision de noms, valeur levée non-`Error`).

## Contraintes UXP à connaître

| Contrainte                            | Conséquence                                                       |
| ------------------------------------- | ----------------------------------------------------------------- |
| Pas de modules ES                     | Build IIFE unique, `inlineDynamicImports: true`                   |
| Pas de `process`                      | `process.env.NODE_ENV` est remplacé à la compilation par `define` |
| `manifest.json` à la racine du plugin | Copié de `src/` vers `dist/` par un plugin Vite                   |
| Pas de `<script type="module">`       | `src/index.html` est écrit à la main et copié tel quel            |
| Système de fichiers permissionné      | `requiredPermissions.localFileSystem: "fullAccess"`               |
| Pas d'`eval`                          | `allowCodeGenerationFromStrings: false`                           |

## Style

Prettier et ESLint font foi ; `npm run format` corrige, `npm run lint:fix`
également. Points d'attention propres au projet :

- commentaires et messages d'interface **en français**, identifiants de code en
  anglais ;
- un commentaire explique _pourquoi_, jamais _ce que_ fait la ligne suivante ;
- `@typescript-eslint/no-explicit-any` est une **erreur** dans `src/` — préférer
  une interface locale décrivant le sous-ensemble d'API réellement utilisé,
  comme le fait `illustratorBridge.ts` pour les types UXP.

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
