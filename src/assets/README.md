# Éléments de marque

Déposez ici les SVG de Logo Forge. Le build les intègre **en ligne** dans le
panneau — pas en `<img src>` : une balise `img` empêcherait la couleur de
suivre le thème, et CEP ne charge pas toujours les fichiers relatifs.

| Fichier                          | Où il apparaît                              |
| -------------------------------- | ------------------------------------------- |
| `Icone-LF.svg`                   | En-tête, à gauche de « Logo Forge », 20 px  |
| `components-Illustration-LF.svg` | Cartes de composant vides, à 30 % d opacité |
| `logo-LF.svg`                    | Réservé — non employé pour l instant        |
| `wordmark-logo-LF.svg`           | Réservé — non employé pour l instant        |

Aucun n'est obligatoire : ce qui manque laisse le panneau tel qu'il est
aujourd'hui, sans erreur ni trou. `npm run build` suffit après dépôt.

## Couleur

La racine `<svg>` reçoit `class="lf-icon"`, et la feuille de style pose
`fill: currentColor`. Sur le fond sombre du panneau (`#252525`, texte
`#e3e3e3`), un tracé sans `fill` propre devient donc clair de lui-même.

Un tracé qui porte son **propre** `fill` le garde : c'est voulu, un logo
polychrome ne doit pas être aplati. Pour qu'une marque suive le thème,
livrez-la sans attribut `fill`, ou avec `fill="currentColor"`.

## Contraintes

- Un attribut `viewBox` est nécessaire : c'est lui qui permet la mise à
  l'échelle. Sans lui, l'élément est écarté et le build le signale.
- Pas de `<script>`, pas de `<image>` externe : le panneau est hors ligne, et
  la politique de sécurité de CEP les bloquerait.
- Les dimensions `width`/`height` de la racine sont retirées ; la taille vient
  de la feuille de style.
