#!/bin/bash
#
# Installation de Logo Forge pour Adobe Illustrator — macOS.
#
# Destiné à quelqu'un qui n'a pas le dépôt : il déploie `dist/` tel qu'il est
# fourni, sans rien construire. Pour installer depuis les sources après une
# modification, `npm run deploy:mac` construit d'abord.
#
#     bash scripts/install-mac.sh
#
set -uo pipefail

BUNDLE="com.lionevi.logoforge"
# `LF_EXT_DIR` vise un autre dossier : utile pour éprouver le script, ou pour
# une installation hors des emplacements standards.
SYSTEM_EXT="${LF_EXT_DIR:-/Library/Application Support/Adobe/CEP/extensions/$BUNDLE}"
USER_EXT="$HOME/Library/Application Support/Adobe/CEP/extensions/$BUNDLE"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

echo "=== Installation de Logo Forge ==="
echo

# --- 1. Ce qu'on installe doit exister ---------------------------------------
if [ ! -f "dist/index.html" ] || [ ! -f "dist/jsx/main.jsx" ]; then
  echo "ARRET  dist/ est absent ou incomplet."
  echo "       Depuis les sources : npm ci && npm run build"
  exit 1
fi

# --- 2. Illustrator doit être installé ---------------------------------------
# Recherche par motif : une liste figée oublierait la version de l'an prochain.
if ! ls -d /Applications/Adobe\ Illustrator*.app >/dev/null 2>&1; then
  echo "ARRET  Adobe Illustrator n a pas été trouvé dans /Applications."
  echo "       Installez-le, puis relancez."
  exit 1
fi
echo "Illustrator : $(ls -d /Applications/Adobe\ Illustrator*.app | head -1)"

# --- 3. Et il doit être fermé -------------------------------------------------
if pgrep -x "Adobe Illustrator" >/dev/null 2>&1 ||
   pgrep -f "Adobe Illustrator.app/Contents/MacOS" >/dev/null 2>&1; then
  echo
  echo "ARRET  Illustrator est ouvert."
  echo "       Fermez-le puis relancez : il garde en mémoire l ancienne"
  echo "       extension, et l installation passerait inaperçue."
  exit 1
fi

# --- 4. Extensions non signées ------------------------------------------------
# Le réglage appartient à l'utilisateur, jamais à root : écrit sous `sudo`, il
# s'appliquerait au compte administrateur et Illustrator ne le verrait pas.
RUN_AS="${SUDO_USER:-${USER:-$(id -un)}}"
echo "Autorisation des extensions non signées (compte $RUN_AS)..."
for version in 9 10 11 12 13; do
  sudo -u "$RUN_AS" defaults write "com.adobe.CSXS.$version" PlayerDebugMode -string 1 \
    2>/dev/null || true
done

# --- 5. Copie -----------------------------------------------------------------
# Dossier utilisateur si le système n'est pas accessible : une installation
# sans privilèges vaut mieux qu'une installation refusée.
if [ -w "$(dirname "$SYSTEM_EXT")" ]; then
  EXT="$SYSTEM_EXT"
  SUDO=""
elif command -v sudo >/dev/null 2>&1; then
  EXT="$SYSTEM_EXT"
  SUDO="sudo"
else
  EXT="$USER_EXT"
  SUDO=""
  echo "Sans privilèges : installation dans le dossier utilisateur."
fi

echo "Installation vers : $EXT"
$SUDO mkdir -p "$EXT"
if command -v rsync >/dev/null 2>&1; then
  $SUDO rsync -a --delete dist/ "$EXT/"
else
  # `dist/.` et non `dist/*` : l'étoile oublie les fichiers cachés, dont
  # `.debug`, sans lequel une extension non signée ne se charge pas.
  $SUDO rm -rf "${EXT:?}"
  $SUDO mkdir -p "$EXT"
  $SUDO cp -R dist/. "$EXT/"
fi

# Lisible par le compte qui lance Illustrator ; les fichiers ne sont pas
# exécutables, seuls les dossiers ont besoin d être parcourus.
$SUDO find "$EXT" -type d -exec chmod 755 {} +
$SUDO find "$EXT" -type f -exec chmod 644 {} +

# --- 6. Vérification ----------------------------------------------------------
echo
echo "Vérification..."
FAILED=0
for f in index.html jsx/main.jsx js/export-engine.js CSXS/manifest.xml .debug; do
  if [ ! -f "$EXT/$f" ]; then
    printf '   ABSENT  %s\n' "$f"
    FAILED=1
    continue
  fi
  here=$(wc -c < "$EXT/$f" | tr -d ' ')
  there=$(wc -c < "dist/$f" | tr -d ' ')
  if [ "$here" != "$there" ]; then
    printf '   ECART   %-22s %s octets sur place, %s attendus\n' "$f" "$here" "$there"
    FAILED=1
  else
    printf '   OK      %-22s %s octets\n' "$f" "$here"
  fi
done

echo
if [ "$FAILED" != "0" ]; then
  echo "=== ECHEC : l installation est incomplète ==="
  echo "Relancez, ou copiez à la main : rsync -a --delete dist/ \"$EXT/\""
  exit 1
fi

echo "=== Installation terminée ==="
echo
echo "Lancez Illustrator, puis Fenêtre → Extensions → Logo Forge."
echo "Si le panneau reste vide : Réglages → Diagnostics → Vérifier jsx/main.jsx."
