# Premier essai dans Illustrator — protocole

Tout ce que la suite automatisée vérifie, elle le vérifie **contre une
doublure**. Elle prouve l'enchaînement du panneau au pont ExtendScript ; elle
ne prouve rien du comportement d'Illustrator, qui n'a encore jamais exécuté
une ligne de `src/jsx/main.jsx`.

Ce document sert à rendre le premier essai réel concluant : chaque étape dit
quoi faire, ce qui prouve que ça marche, et quoi relever si ça échoue. Les
étapes sont classées par risque décroissant — les premières sont celles dont
l'API est la plus incertaine, et un échec y invalide tout ce qui suit.

## Avant de commencer

1. `npm run build`, puis copier `dist/` dans le dossier des extensions CEP :
   - macOS : `~/Library/Application Support/Adobe/CEP/extensions/logo-forge/`
   - Windows : `%APPDATA%\Adobe\CEP\extensions\logo-forge\`
2. Autoriser les extensions non signées (`PlayerDebugMode`, voir
   `docs/DEVELOPMENT.md`).
3. Ouvrir un document contenant un logo vectoriel, sur plusieurs objets, dont
   au moins un groupe.
4. Ouvrir **Fenêtre → Extensions → Logo Forge**.

À chaque étape : ouvrir l'onglet **Réglages → Diagnostics**, et copier le
**journal** avant de passer à la suivante. Il porte l'appel, son résultat et
sa durée — c'est ce qui rendra un échec analysable sans deviner.

## 1. Le pont répond

**Faire** : Diagnostics → « Lancer le contrôle système ».

**Preuve** : les six sondes répondent, la première (« Pont CEP ») en quelques
millisecondes.

**Si ça échoue** — typiquement « `lfPing` n'est pas une fonction », et de la
même façon pour les quarante autres : `main.jsx` n'a pas été chargé. Une
erreur de syntaxe y suffit, et elle emporte le fichier entier : ExtendScript
ne charge pas à moitié.

Pour trancher entre « le fichier n'arrive pas » et « le fichier arrive mais ne
parse pas », basculer le `ScriptPath` du manifeste vers la sonde minimale :

```xml
<ScriptPath>./jsx/test-minimal.jsx</ScriptPath>
```

puis `npm run build`, redéployer, rouvrir le panneau.

- `lfPing` répond « pong » → le chargement fonctionne, la panne est **dans**
  `main.jsx`. Lancer `npx acorn --ecma3 src/jsx/main.jsx` : il nomme la ligne.
- `lfPing` reste introuvable → la panne est dans le manifeste, le chemin ou le
  déploiement. Vérifier que `jsx/main.jsx` est bien présent **dans le dossier
  d'extension installé**, et non seulement dans `dist/`.

`lfEngineInfo` de la sonde rend la version du moteur, celle d'Illustrator et
le système : c'est ce qu'il faut joindre à tout rapport.

Rétablir ensuite `<ScriptPath>./jsx/main.jsx</ScriptPath>` — un test le
vérifie, mais il ne s'exécute pas à votre place.

## 2. Set Component

C'est l'opération la plus incertaine : elle duplique des objets **d'un
document vers un autre**, ce qu'aucun test hors Illustrator ne peut valider.

**Faire** : sélectionner tout le logo (Cmd/Ctrl+A), cliquer « Set Component ».

**Preuve** :

- la carte affiche une vignette qui **ressemble au logo** — pas un carré vide ;
- elle indique des dimensions plausibles en points ;
- elle indique le nombre d'objets copiés, et zéro refusé ;
- l'ordre de superposition est respecté (ce qui était devant reste devant).

**Points de rupture connus** :

- `item.duplicate(cible, ElementPlacement.PLACEATEND)` entre deux documents ;
- objets masqués ou verrouillés : ils doivent être **comptés comme refusés**,
  pas ignorés en silence ;
- `app.activeDocument = source` avant duplication.

**Relever** : le message d'erreur, le nombre copié/refusé, et si la vignette
est vide alors que le compte est bon.

## 3. Vignette

**Faire** : rien de plus — elle est produite par l'étape 2.

**Preuve** : l'image affichée est bien le logo. Une vignette absente mais un
composant défini signale un échec de `cep.fs.readFile` en Base64, pas de
l'export.

## 4. Déclinaisons de couleur

**Faire** : onglet Colors, cocher Black, White et Inverted, puis « Planche de
revue ».

**Preuve** : la planche s'ouvre, chaque cellule porte le logo dans sa
déclinaison, les libellés sont lisibles.

**Points de rupture connus** : `group.resize()` et `group.position`,
la lecture des couleurs de nuancier (`swatch.color`), les objets à dégradé ou
à motif — qui ne se recolorent pas et doivent être signalés, non ignorés.

## 5. Mode colorimétrique

**Faire** : lancer un export avec la passe Impression cochée.

**Preuve** : les fichiers d'impression sont en CMJN.

**Point de rupture connu** : `app.executeMenuCommand('doc-color-cmyk')`.
L'identifiant de commande change entre versions. Un échec doit apparaître en
**réserve** sur le fichier concerné, pas passer inaperçu.

## 6. Les six formats

**Faire** : un export avec AI, PDF, EPS, SVG, PNG et JPEG cochés.

**Preuve** : les six fichiers existent, s'ouvrent, et le panneau affiche leur
poids. Ouvrir le PDF et l'EPS dans un logiciel tiers.

**Points de rupture connus** : les noms de propriétés des `ExportOptions*`
diffèrent d'une version à l'autre ; `saveAs` **réassocie le document** — le
document de travail ne doit pas se retrouver renommé.

**Relever** : pour chaque format en échec, le message exact et la version
d'Illustrator.

## 7. Contrôle du pack

**Faire** : laisser l'export aller à son terme.

**Preuve** : « N fichiers vérifiés sur le disque », sans écart entre attendu
et présent.

**Point de rupture connu** : `Folder.getFiles()` et sa récursion, dont le
comportement varie selon la plateforme.

## 8. favicon.ico

**Faire** : cocher « Favicons » avant l'export.

**Preuve** : `favicon.ico` existe, et **s'ouvre dans un navigateur** — le
déposer dans un onglet suffit. Un fichier présent mais illisible signale un
conteneur mal formé.

**Point de rupture connu** : lecture et écriture en `encoding = 'BINARY'`.
C'est la seule opération du plugin qui manipule des octets.

## 9. Kit réseaux sociaux

**Faire** : Réglages → Réseaux sociaux, cocher deux formats, « Produire le
kit ».

**Preuve** : les PNG font exactement les dimensions annoncées, le logo est
centré, le fond est celui demandé.

**Points de rupture connus** : `pathItems.rectangle` et
`zOrder(ZOrderMethod.SENDTOBACK)` — si le fond passe devant le logo, c'est
là.

## 10. Reprise

**Faire** : lancer un export d'au moins vingt fichiers, puis **fermer
Illustrator** en cours de route. Le rouvrir, rouvrir le panneau.

**Preuve** : le panneau propose de reprendre, annonce un nombre de fichiers
déjà présents cohérent avec le dossier, et la reprise ne réécrit que le
reste.

## 11. Robustesse

À faire une fois le reste vert :

| Situation                                | Attendu                                             |
| ---------------------------------------- | --------------------------------------------------- |
| Aucun document ouvert                    | le panneau le dit, aucun bouton d'export actif      |
| Document jamais enregistré               | erreur explicite avant tout export                  |
| Sélection vide                           | erreur avec le geste à faire, et « Réessayer »      |
| Sélection en mode édition de texte       | erreur nommant la touche Échap                      |
| Dossier de livraison en lecture seule    | échec par fichier, le lot continue, rapport complet |
| Disque plein en cours d'export           | échecs consignés, trace de reprise conservée        |
| Fermeture du panneau pendant un export   | à la réouverture, reprise proposée                  |
| Document verrouillé sur tous ses calques | Set Component signale des objets refusés            |

## Relevé

Pour chaque étape, noter : version d'Illustrator, système, résultat, message
d'erreur intégral, et l'extrait de journal correspondant. Un échec sans son
message ne se corrige pas.
