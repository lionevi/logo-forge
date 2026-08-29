# Feuille de route

## État — après l'audit et la remise en état

Le plugin livré est l'**extension CEP** (`src/panel-cep.html`,
`src/js/export-engine.js`, `src/jsx/main.jsx`). La chaîne UXP/React est
conservée pour un portage ultérieur ; `CSXS/manifest.xml` ne la charge pas.

**Fait, et vérifié hors Illustrator**

- [x] Capture d'un composant : ordre de superposition, objets refusés
      comptés, cadrage, vignette issue d'un export réel, vérification du
      fichier écrit
- [x] Déclinaisons chromatiques, correspondance source → cible, seuil
      d'inversion, contraste mesuré sur quatre fonds
- [x] Contrôle de production : douze contrôles, deux réserves à l'œil,
      corrections classées sûres / à valider
- [x] Export des six formats, chacun confronté au disque (chemin et taille)
- [x] Portée d'export par composant et par déclinaison
- [x] Nommage à variables, aperçu, séparateur, politique de collision
- [x] Trois modèles d'arborescence, documentation client fr/en, manifeste
- [x] Contrôle du pack livré : manquants, vides, doublons, intrus
- [x] Persistance complète du projet, et reprise d'un lot interrompu
- [x] `favicon.ico` assemblé à partir des PNG du pack
- [x] Kit réseaux sociaux : huit canevas aux dimensions des plateformes
- [x] Erreurs actionnables, journal, six sondes système
- [x] Conditions dégradées : hôte muet, enregistrement abîmé, stockage en
      refus, élément d'interface manquant
- [x] Suite de 739 cas, quatre scénarios de bout en bout en navigateur,
      compatibilité ES5 et Chromium 61 vérifiées par des tests

**La limite, et elle est entière**

Rien n'a jamais tourné dans Illustrator. Ce qui est vérifié, c'est le
**contrat** passé avec Illustrator — une doublure fidèle du modèle objet —
pas Illustrator lui-même. Les usages les plus incertains sont énumérés,
classés par risque, dans [TEST-ILLUSTRATOR.md](TEST-ILLUSTRATOR.md).

## Suite — validation dans Illustrator

- [ ] Dérouler le protocole de `TEST-ILLUSTRATOR.md`, versions 2021 et 2024
- [ ] Corriger les écarts d'API relevés (options d'export, commandes de menu)
- [ ] Dégradés et motifs : les recolorer, ou les signaler explicitement
- [ ] Détection des composants depuis les calques du document

## Ensuite — qualité du pack

- [ ] Zones de protection et tailles minimales paramétrables
- [ ] Export des nuances en `.ase`
- [ ] Planche de contrôle PDF récapitulant toutes les déclinaisons

## Productivité

- [ ] Préréglages de projet, enregistrés et exportables
- [ ] Traitement par lot sur plusieurs documents
- [ ] Historique des livraisons par client

## Distribution

- [ ] Traduction de l'interface (la documentation client l'est déjà)
- [ ] Signature et soumission à Adobe Exchange
- [ ] Documentation utilisateur illustrée

## Non prévu

- Édition ou création de logo. Logo Forge exporte ; il ne dessine pas.
- WebP : Illustrator ne l'expose pas au script. Annoncer le format sans
  pouvoir l'écrire serait un mensonge de plus dans une case à cocher.
