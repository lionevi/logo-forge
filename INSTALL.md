# Installation de Logo Forge

Extension Adobe Illustrator. L'installation copie un dossier et autorise les
extensions non signées — rien d'autre.

> **À savoir avant de commencer.** Ce plugin n'a jamais été exécuté dans
> Illustrator par ses auteurs : il est vérifié de bout en bout hors
> Illustrator, contre une doublure fidèle du modèle objet. Attendez-vous à
> rencontrer des écarts, et voyez [Dépannage](#dépannage) — le panneau sait
> dire ce qui ne va pas.

## Prérequis

- Adobe Illustrator CC 2019 (23.0) ou plus récent
- macOS 10.14 ou plus récent, ou Windows 10 ou plus récent
- **Illustrator fermé** pendant l'installation

## macOS

```bash
bash scripts/install-mac.sh
```

Le script vérifie qu'Illustrator est installé et fermé, autorise les
extensions non signées, remplace le dossier d'extension, remet les
permissions, puis **compare fichier par fichier ce qui est arrivé à ce qui
devait partir**. Au moindre écart, il s'arrête en erreur : une installation à
moitié faite donne un panneau vide, et rien n'en dirait la cause.

Il demande le mot de passe administrateur pour écrire dans
`/Library/Application Support/…`. Sans privilèges, il installe dans le dossier
de l'utilisateur, qu'Illustrator lit aussi bien.

## Windows

Double-cliquez sur `scripts\install-win.bat`.

Les droits administrateur ne sont **pas** nécessaires : l'extension va dans
`%APPDATA%\Adobe\CEP\extensions\`, que Illustrator lit également.

## Ensuite

Lancez Illustrator, puis **Fenêtre → Extensions → Logo Forge**.

Le panneau suit la langue d'Illustrator pour sa navigation et ses actions
principales ; le reste de l'interface est en français.

## Dépannage

### Le panneau n'apparaît pas dans le menu Extensions

Redémarrez Illustrator : il ne relit ses extensions qu'au lancement. Si le
menu reste vide, l'autorisation des extensions non signées n'a pas pris —
relancez le script d'installation, Illustrator fermé.

### Le panneau s'ouvre mais reste vide

Le panneau **dit lui-même** ce qui manque, dans un cadre rouge en haut :

- **« Moteur périmé »** — `js/export-engine.js` ne correspond pas à
  `index.html`. Une copie partielle : réinstallez, le script copie tout.
- **« Interface incomplète »** — un élément manque dans le fichier livré.
  Réinstallez depuis un `dist/` complet.
- **« Moteur introuvable »** — le dossier `js/` n'accompagne pas
  `index.html`. Même cause, même remède.

Si le cadre est vide de tout message, envoyez une capture : ce cas n'est pas
prévu, et c'est une information en soi.

### Les fonctions Illustrator ne répondent pas

Symptôme : chaque action répond « `lf…` n'est pas une fonction ».

**Réglages → Diagnostics → « Vérifier jsx/main.jsx »**. Ce contrôle fait
relire le fichier par Illustrator et rend son verdict, avec le numéro de
ligne. C'est cette ligne qu'il faut transmettre — elle nomme la cause, là où
le symptôme n'en dit rien.

### Vérifier que tout répond

**Réglages → Diagnostics → « Lancer le contrôle système »** : six sondes en
lecture seule — le pont, le document, la sélection, les couleurs, le contrôle
de production, l'écriture disque. Aucune n'écrit quoi que ce soit.

Le **journal**, sur le même écran, garde chaque opération avec sa durée et son
résultat. C'est ce qu'il faut joindre à tout signalement.

## Désinstallation

macOS :

```bash
sudo rm -rf "/Library/Application Support/Adobe/CEP/extensions/com.lionevi.logoforge"
rm -rf "$HOME/Library/Application Support/Adobe/CEP/extensions/com.lionevi.logoforge"
```

Windows : supprimez
`%APPDATA%\Adobe\CEP\extensions\com.lionevi.logoforge`.

Les réglages du panneau vivent dans le stockage local de l'extension et
partent avec elle. Les packs déjà livrés ne sont jamais touchés.
