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
- [x] Interface React : préréglages, options, aperçu du pack, progression
- [x] Quatre préréglages livrés
- [x] Build UXP en IIFE, manifest v5, packaging `.ccx` sans dépendance
- [x] CI : format, lint, typecheck, 108 tests, build, packaging, artefact

**Limite connue**

Le `DocumentRenderer` branché sur le panneau est un adaptateur de démonstration :
il écrit un descriptif texte de chaque fichier planifié plutôt que le fichier
réel. Toute l'arborescence d'un pack est donc inspectable, mais les fichiers ne
sont pas encore rendus par Illustrator. C'est le premier chantier ci-dessous.

## v0.2 — Rendu Illustrator réel

- [ ] `IllustratorRenderer` adossé à l'API document d'Illustrator
- [ ] Export vectoriel : AI, EPS, PDF, avec profil colorimétrique du document
- [ ] Export matriciel : PNG, JPEG, WebP, avec transparence et qualité
- [ ] Détection des calques de variantes dans le document ouvert
- [ ] Application réelle des déclinaisons chromatiques aux nuances du document

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
