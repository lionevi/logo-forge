#!/bin/bash
#
# Déploiement de Logo Forge vers le dossier d'extensions CEP, sur macOS.
#
# Deux pannes de ce projet venaient d'un déploiement partiel : `index.html`
# recopié sans son moteur, ou sans le dossier `jsx/`. Ce script copie tout,
# supprime ce qui traîne, puis **vérifie que ce qui est arrivé est bien ce qui
# est parti** — et sort en erreur sinon. Une vérification qui ne peut pas
# échouer ne vérifie rien.
#
#     npm run deploy:mac              # dossier système, avec sudo
#     LF_USER_SCOPE=1 npm run deploy:mac   # dossier utilisateur, sans sudo
#
set -euo pipefail

BUNDLE="com.lionevi.logoforge"
SYSTEM_EXT="/Library/Application Support/Adobe/CEP/extensions/$BUNDLE"
USER_EXT="$HOME/Library/Application Support/Adobe/CEP/extensions/$BUNDLE"

# Le dossier utilisateur ne demande pas de privilèges : c'est le choix par
# défaut dès qu'il existe déjà, ou quand on le demande explicitement.
if [ "${LF_USER_SCOPE:-}" = "1" ] || { [ -d "$USER_EXT" ] && [ ! -d "$SYSTEM_EXT" ]; }; then
  EXT="$USER_EXT"
  SUDO=""
else
  EXT="${LF_EXT_DIR:-$SYSTEM_EXT}"
  SUDO="sudo"
  [ -w "$(dirname "$EXT")" ] && SUDO=""
fi

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

echo "=== Logo Forge — Déploiement ==="
echo "    source : $ROOT/dist"
echo "    cible  : $EXT"
echo

# --- 1. Illustrator doit être fermé -----------------------------------------
# Une extension remplacée sous les pieds d'Illustrator laisse le panneau sur
# l'ancien code, sans le dire : c'est la moitié des faux diagnostics.
if pgrep -x "Adobe Illustrator" >/dev/null 2>&1 ||
   pgrep -f "Adobe Illustrator.app/Contents/MacOS" >/dev/null 2>&1; then
  echo "ARRET  Illustrator est ouvert."
  echo "       Fermez-le puis relancez : il garde en mémoire l ancienne"
  echo "       extension, et le déploiement passerait inaperçu."
  exit 1
fi

# --- 2. Build ---------------------------------------------------------------
echo "1/4  Construction..."
npm run build >/dev/null
[ -d dist ] || { echo "ERREUR  dist/ absent après le build."; exit 1; }

# --- 3. Déploiement ---------------------------------------------------------
echo "2/4  Copie vers l extension..."

# Le dossier est remplacé, pas complété : un fichier périmé oublié dedans est
# exactement ce qui fait croire à une régression. rsync est fourni par macOS ;
# le repli sert aux installations qui ne l'ont pas.
case "$EXT" in
  */"$BUNDLE")
    ;;
  *)
    echo "ERREUR  cible inattendue : $EXT"
    echo "        Elle doit se terminer par $BUNDLE."
    exit 1
    ;;
esac

if command -v rsync >/dev/null 2>&1; then
  $SUDO mkdir -p "$EXT"
  $SUDO rsync -a --delete dist/ "$EXT/"
else
  echo "        rsync absent : remplacement du dossier par copie."
  $SUDO rm -rf "$EXT"
  $SUDO mkdir -p "$EXT"
  $SUDO cp -R dist/. "$EXT/"
fi

# --- 4. Permissions ---------------------------------------------------------
# Après un rsync en sudo, tout appartient à root. Illustrator tourne sous le
# compte de l'utilisateur : il lui faut au moins la lecture, et le parcours
# des dossiers.
echo "3/4  Permissions..."
$SUDO find "$EXT" -type d -exec chmod 755 {} +
$SUDO find "$EXT" -type f -exec chmod 644 {} +

# --- 5. Vérification --------------------------------------------------------
# Comparaison octet à octet des tailles : c'est ce qui distingue « copié » de
# « cru copié ».
echo "4/4  Vérification..."
echo
FAILED=0
for f in index.html jsx/main.jsx js/export-engine.js CSXS/manifest.xml .debug; do
  if [ ! -f "$EXT/$f" ]; then
    printf '   ABSENT  %-24s\n' "$f"
    FAILED=1
    continue
  fi
  deployed=$(wc -c < "$EXT/$f" | tr -d ' ')
  source=$(wc -c < "dist/$f" | tr -d ' ')
  if [ "$deployed" != "$source" ]; then
    printf '   ECART   %-24s %s octets sur place, %s attendus\n' "$f" "$deployed" "$source"
    FAILED=1
  else
    printf '   OK      %-24s %s octets\n' "$f" "$deployed"
  fi
done

# Les vignettes du panneau et le moteur React dormant ne sont pas listés
# ci-dessus ; ce décompte dit si le reste est arrivé.
deployed_count=$(find "$EXT" -type f | wc -l | tr -d ' ')
source_count=$(find dist -type f | wc -l | tr -d ' ')
if [ "$deployed_count" != "$source_count" ]; then
  printf '   ECART   %-24s %s fichiers sur place, %s attendus\n' "(total)" "$deployed_count" "$source_count"
  FAILED=1
else
  printf '   OK      %-24s %s fichiers\n' "(total)" "$deployed_count"
fi

# L'empreinte dit la même chose que les tailles, mais elle est lisible depuis
# le panneau : c'est elle qu'on compare quand Illustrator semble servir une
# ancienne version.
STAMP=$(grep -o '"stamp":"[0-9a-f]*"' "$EXT/index.html" 2>/dev/null | head -1 | cut -d'"' -f4)
SOURCE_STAMP=$(grep -o '"stamp":"[0-9a-f]*"' dist/index.html | head -1 | cut -d'"' -f4)
if [ -z "$STAMP" ] || [ "$STAMP" != "$SOURCE_STAMP" ]; then
  printf '   ECART   %-24s « %s » sur place, « %s » attendue\n' \
    "(empreinte)" "$STAMP" "$SOURCE_STAMP"
  FAILED=1
else
  printf '   OK      %-24s %s\n' "(empreinte)" "$STAMP"
fi

echo
if [ "$FAILED" != "0" ]; then
  echo "=== ECHEC : le dossier déployé ne correspond pas à dist/ ==="
  echo "Relancez, ou copiez à la main : rsync -a --delete dist/ \"$EXT/\""
  exit 1
fi

echo "=== Déploiement terminé ==="
echo
echo "Illustrator → Fenêtre → Extensions → Logo Forge"
echo
echo "Empreinte déployée : $SOURCE_STAMP"
echo "Réglages → Diagnostics affiche la même en tête du volet. Si elle diffère,"
echo "Illustrator sert une copie ancienne — ce n est pas le code qui est en cause."
echo
echo "Puis « Vérifier jsx/main.jsx » pour confirmer que la couche ExtendScript"
echo "est bien chargée."
