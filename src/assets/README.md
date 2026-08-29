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

Le fond du panneau est sombre (`#252525`, texte `#e3e3e3`). Une marque noire
y serait invisible — et un export d'Illustrator porte presque toujours ses
couleurs en dur, soit en attributs (`fill="#231f20"`), soit dans un bloc
`<style>` (`.cls-1 { fill: #231f20; }`), que `fill: currentColor` posé sur la
racine ne peut pas surcharger.

Le build tranche donc lui-même, et le dit à chaque construction :

- **Marque monochrome** — une seule couleur dans tout le fichier : elle est
  remplacée par `currentColor`, attributs et bloc `<style>` compris. La marque
  suit le thème, claire sur fond sombre. C'est le cas des marques Logo Forge.
- **Marque polychrome** — deux couleurs ou plus : rien n'est touché.
  L'aplatir la défigurerait.

`none`, `transparent` et les dégradés (`url(#…)`) ne sont jamais convertis :
retirer la couleur d'un contour le ramènerait à `none` et effacerait le
tracé.

## Contraintes

- Un attribut `viewBox` est nécessaire : c'est lui qui permet la mise à
  l'échelle. Sans lui, l'élément est écarté et le build le signale.
- Pas de `<script>`, pas de `<image>` externe : le panneau est hors ligne, et
  la politique de sécurité de CEP les bloquerait.
- Les dimensions `width`/`height` de la racine sont retirées ; la taille vient
  de la feuille de style.
