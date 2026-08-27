# Feuille de route

## État actuel — v0.1.0

Le socle est en place et vérifié par la CI.

**Fait**

- [x] Cœur métier complet et testé : planification, nommage, couleur, export
- [x] Conversions RVB ↔ CMJN et contraste WCAG, sans dépendance externe
- [x] Nommage sûr : accents, caractères interdits, noms réservés Windows, collisions
- [x] Quatre stratégies d'arborescence (usage/format, format, variante, à plat)
- [x] Moteur d'export résilient, annulable, avec rapport de progression
- [x] Diagnostics avant export (erreurs bloquantes et avertissements)
- [x] Moteur Illustrator UXP : SVG, PNG24, JPEG, PDF, EPS, AI
- [x] Duplication du document et déclinaisons chromatiques appliquées aux tracés
- [x] Interface React : document actif, préréglages, aperçu du pack, progression
- [x] Quatre préréglages livrés
- [x] Build UXP en IIFE, manifest v5, packaging `.ccx` sans dépendance
- [x] CI : format, lint, typecheck, 177 tests, build, packaging, artefact

**Limite connue**

Le moteur n'a jamais tourné dans Illustrator : cet environnement de
développement n'y a pas accès. Le code suit le modèle objet documenté et se
protège des écarts de version (`assignIfSupported` n'écrit que les propriétés
que l'hôte déclare), mais la première exécution réelle reste à faire.

Le WebP est refusé explicitement : Illustrator ne l'expose pas au script.

## v0.2 — Validation dans Illustrator

- [ ] Première exécution réelle dans Illustrator 2021 et 2024
- [ ] Vérification des noms d'options d'export selon la version de l'hôte
- [ ] Détection des calques de variantes dans le document ouvert
- [ ] Conversion des dégradés et motifs en niveaux de gris
- [ ] Choix du plan de travail par variante, plutôt qu'un index global

## v0.3 — Qualité du pack livré

- [ ] Génération d'un `README` de pack (usages, couleurs, zones de protection)
- [ ] Planche de contrôle PDF récapitulant toutes les variantes
- [ ] Zones de protection et tailles minimales paramétrables
- [ ] Vérification automatique des tracés (contours non vectorisés, texte non converti)
- [ ] Export des nuances en `.ase`

## v0.4 — Productivité

- [ ] Préréglages personnalisés, enregistrés et exportables
- [ ] Traitement par lot sur plusieurs documents
- [ ] Reprise d'un export interrompu
- [ ] Historique des exports par projet

## v1.0 — Distribution

- [ ] Icônes du panneau et de la liste des plugins
- [ ] Localisation anglaise complète
- [ ] Signature et soumission à Adobe Exchange
- [ ] Documentation utilisateur illustrée

## Non prévu

- Support d'ExtendScript. UXP est la plateforme cible, sans repli.
- Édition ou création de logo. Logo Forge exporte ; il ne dessine pas.
