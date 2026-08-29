/*
 * Logo Forge — couche ExtendScript.
 *
 * Chargée par CEP via <ScriptPath> et appelée depuis le panneau par
 * evalScript(). C'est la seule couche qui parle à Illustrator.
 *
 * Contraintes du moteur ExtendScript :
 *   - ES3 : `var` uniquement, pas de `let`, pas d'arrow, pas de `forEach` ;
 *   - pas de `JSON` natif — toutes les fonctions renvoient donc des chaînes
 *     délimitées, que la couche JS analyse ;
 *   - toute valeur renvoyée traverse evalScript en tant que chaîne. La
 *     convention est « OK|charge utile » en cas de succès, « ERR|message »
 *     sinon : le panneau n'a jamais à deviner si un appel a réussi.
 */

var LogoForge = (function () {
  /** Sépare le statut de la charge utile. */
  var SEP = '|';

  /**
   * Sépare les champs d'une charge utile composite.
   * 0x1F (« unit separator ») ne peut pas apparaître dans un nom de fichier.
   */
  var UNIT = String.fromCharCode(31);

  /** Largeur en pixels des vignettes de composant affichées par le panneau. */
  var THUMBNAIL_WIDTH = 320;

  /** Marque un succès, avec sa charge utile éventuelle. */
  function ok(payload) {
    return 'OK' + SEP + (payload === undefined ? '' : String(payload));
  }

  /** Marque un échec, avec un message lisible. */
  function err(message) {
    return 'ERR' + SEP + String(message);
  }

  /** Décrit une exception ExtendScript de façon exploitable. */
  function describe(e) {
    var text = e && e.message ? e.message : String(e);
    if (e && e.line) text += ' (ligne ' + e.line + ')';
    return text;
  }

  /**
   * Affecte une propriété d'options seulement si l'hôte la déclare.
   *
   * Les jeux d'options varient d'une version d'Illustrator à l'autre : une
   * affectation refusée ne doit pas faire échouer tout un export.
   */
  function assignIfSupported(target, name, value) {
    try {
      if (!(name in target)) return false;
      target[name] = value;
      return true;
    } catch (e) {
      return false;
    }
  }

  /* ---------------------------------------------------------------------- *
   * Document
   * ---------------------------------------------------------------------- */

  /** Renvoie le nom du document actif, ou une chaîne vide. */
  function getDocumentName() {
    try {
      if (app.documents.length === 0) return ok('');
      return ok(app.activeDocument.name);
    } catch (e) {
      return err(describe(e));
    }
  }

  /**
   * Renvoie les informations du document actif.
   * Charge utile : nom, chemin, largeur, hauteur, nombre de plans de travail.
   */
  function getDocumentInfo() {
    try {
      if (app.documents.length === 0) return ok('');

      var doc = app.activeDocument;
      var path = '';
      try {
        // `fullName` lève sur un document jamais enregistré.
        path = doc.fullName.fsName;
      } catch (unsaved) {
        path = '';
      }

      var rect = doc.artboards[0].artboardRect;
      var width = Math.abs(rect[2] - rect[0]);
      var height = Math.abs(rect[1] - rect[3]);

      return ok([doc.name, path, width, height, doc.artboards.length].join(UNIT));
    } catch (e) {
      return err(describe(e));
    }
  }

  /** Renvoie les noms des plans de travail. */
  function getArtboardNames() {
    try {
      if (app.documents.length === 0) return ok('');
      var doc = app.activeDocument;
      var names = [];
      for (var i = 0; i < doc.artboards.length; i += 1) {
        names.push(doc.artboards[i].name);
      }
      return ok(names.join(UNIT));
    } catch (e) {
      return err(describe(e));
    }
  }

  /* ---------------------------------------------------------------------- *
   * Système de fichiers
   * ---------------------------------------------------------------------- */

  /** Crée un dossier et tous ses parents. Idempotent. */
  function createFolder(path) {
    try {
      var folder = new Folder(path);
      if (folder.exists) return ok('exists');
      if (!folder.create()) return err('creation refusee : ' + path);
      return ok('created');
    } catch (e) {
      return err(describe(e));
    }
  }

  /** Indique si un chemin existe, fichier ou dossier. */
  function pathExists(path) {
    try {
      return ok(new File(path).exists || new Folder(path).exists ? '1' : '0');
    } catch (e) {
      return err(describe(e));
    }
  }

  /**
   * Liste les fichiers d'un dossier, récursivement.
   *
   * Le contrôle du pack a besoin de ce que le disque contient réellement, pas
   * de ce que l'export croit avoir écrit : c'est toute la différence entre
   * vérifier et se fier.
   *
   * Charge utile : « chemin relatif:octets », un par ligne.
   */
  function listFiles(root, limit) {
    try {
      var base = new Folder(root);
      if (!base.exists) return err('dossier introuvable : ' + root);

      var max = parseInt(limit, 10);
      if (isNaN(max) || max <= 0) max = 2000;

      var found = [];
      var queue = [{ folder: base, prefix: '' }];

      while (queue.length > 0 && found.length < max) {
        var current = queue.shift();
        var entries;
        try {
          entries = current.folder.getFiles();
        } catch (readError) {
          continue;
        }

        for (var i = 0; i < entries.length && found.length < max; i += 1) {
          var entry = entries[i];
          var name = decodeURI(entry.name);
          var relative = current.prefix ? current.prefix + '/' + name : name;

          if (entry instanceof Folder) {
            queue.push({ folder: entry, prefix: relative });
            continue;
          }
          found.push(relative + ':' + entry.length);
        }
      }

      return ok(found.join(UNIT));
    } catch (e) {
      return err(describe(e));
    }
  }

  /** Écrit un fichier texte en UTF-8. */
  function writeTextFile(path, contents) {
    try {
      var file = new File(path);
      file.encoding = 'UTF-8';
      if (!file.open('w')) return err('ouverture en ecriture refusee : ' + path);
      file.write(contents);
      file.close();
      return ok(path);
    } catch (e) {
      return err(describe(e));
    }
  }

  /* ---------------------------------------------------------------------- *
   * Assemblage d'un favicon.ico
   *
   * Illustrator n'exporte pas d'ICO. Le format est pourtant le seul que les
   * navigateurs réclament d'eux-mêmes, à la racine du site. Un ICO n'étant
   * qu'un conteneur, il est ici assemblé à partir des PNG déjà exportés :
   * un en-tête, une entrée par taille, puis les PNG tels quels.
   *
   * Les PNG sont recopiés sans être recompressés : le format le permet depuis
   * Windows Vista, et tous les navigateurs actuels le lisent. Un système
   * antérieur à Vista n'en verrait rien — c'est la limite assumée de cette
   * approche, la seule qui n'exige pas d'encodeur BMP.
   * ---------------------------------------------------------------------- */

  /** Entier sur deux octets, petit-boutiste. */
  function uint16(value) {
    return String.fromCharCode(value & 255, (value >> 8) & 255);
  }

  /** Entier sur quatre octets, petit-boutiste. */
  function uint32(value) {
    return String.fromCharCode(
      value & 255,
      (value >> 8) & 255,
      (value >> 16) & 255,
      (value >> 24) & 255
    );
  }

  /** Lit un fichier octet par octet, sans conversion d'encodage. */
  function readBinary(path) {
    var file = new File(path);
    if (!file.exists) return null;
    file.encoding = 'BINARY';
    if (!file.open('r')) return null;
    var data = file.read();
    file.close();
    return data;
  }

  /**
   * Assemble un ICO à partir de PNG existants.
   *
   * @param targetPath fichier à écrire.
   * @param sources chemins des PNG, séparés par UNIT, du plus petit au plus
   *   grand ; chacun doit être carré et d'au plus 256 pixels de côté.
   * @param sizes côtés correspondants, séparés par UNIT.
   * @returns `chemin | octets`.
   */
  function writeIco(targetPath, sources, sizes) {
    try {
      var paths = String(sources).split(UNIT);
      var sides = String(sizes).split(UNIT);
      var images = [];
      var i;

      for (i = 0; i < paths.length; i += 1) {
        if (!paths[i]) continue;
        var side = parseInt(sides[i], 10);
        if (!(side > 0) || side > 256) continue;
        var data = readBinary(paths[i]);
        // Un PNG absent ou vide est écarté : mieux vaut un ICO à deux
        // tailles qu'un ICO annonçant une image qu'il ne contient pas.
        if (!data || !data.length) continue;
        images.push({ side: side, data: data });
      }

      if (images.length === 0) return err('aucun PNG lisible pour le favicon');

      // L'en-tête est de 6 octets, chaque entrée de 16 : les images
      // commencent après le catalogue.
      var offset = 6 + images.length * 16;
      var header = String.fromCharCode(0, 0, 1, 0) + uint16(images.length);
      var catalog = '';
      var payload = '';

      for (i = 0; i < images.length; i += 1) {
        var image = images[i];
        // 256 s'écrit 0 : l'octet ne va que jusqu'à 255.
        var dimension = image.side === 256 ? 0 : image.side;
        catalog +=
          String.fromCharCode(dimension, dimension, 0, 0) +
          uint16(1) +
          uint16(32) +
          uint32(image.data.length) +
          uint32(offset);
        offset += image.data.length;
        payload += image.data;
      }

      var file = new File(targetPath);
      file.encoding = 'BINARY';
      if (!file.open('w')) return err('ouverture en ecriture refusee : ' + targetPath);
      file.write(header + catalog + payload);
      file.close();

      var written = new File(targetPath);
      if (!written.exists) return err('favicon.ico non ecrit : ' + targetPath);
      if (!written.length) return err('favicon.ico vide : ' + targetPath);
      return ok(targetPath + UNIT + written.length);
    } catch (e) {
      return err(describe(e));
    }
  }

  /* ---------------------------------------------------------------------- *
   * Session de travail
   *
   * Toute exportation passe par une copie temporaire du document. Deux raisons :
   * `saveAs` réassocie le document au fichier écrit — il rebaptiserait le
   * document de l'utilisateur — et les déclinaisons chromatiques sont
   * destructrices. La copie est ouverte, malmenée, puis jetée.
   * ---------------------------------------------------------------------- */

  /** Document de travail courant, ou `null` hors session. */
  var session = null;

  /**
   * Ouvre une copie de travail du document actif.
   *
   * Le document doit avoir été enregistré au moins une fois : la copie se fait
   * au niveau du fichier, seul moyen d'obtenir un duplicata qui conserve les
   * plans de travail.
   */
  function beginSession() {
    try {
      if (session) return err('une session est deja ouverte');
      if (app.documents.length === 0) return err('aucun document ouvert');

      var source = app.activeDocument;
      var sourceFile;
      try {
        sourceFile = source.fullName;
      } catch (unsaved) {
        return err(
          'enregistrez le document avant d exporter : Logo Forge travaille ' +
            'sur une copie du fichier'
        );
      }
      if (!sourceFile || !sourceFile.exists) {
        return err('fichier source introuvable sur le disque');
      }

      var stamp = new Date().getTime();
      var temp = new File(Folder.temp.fsName + '/logo-forge-' + stamp + '.ai');
      if (!sourceFile.copy(temp)) return err('copie temporaire impossible');

      var working = app.open(temp);
      session = { document: working, file: temp };
      return ok(temp.fsName);
    } catch (e) {
      session = null;
      return err(describe(e));
    }
  }

  /** Referme la copie de travail et supprime le fichier temporaire. */
  function endSession() {
    try {
      if (!session) return ok('idle');
      try {
        session.document.close(SaveOptions.DONOTSAVECHANGES);
      } catch (closeError) {
        // Un document déjà refermé n'est pas une erreur exploitable.
      }
      try {
        session.file.remove();
      } catch (removeError) {
        // Un temporaire résiduel est gênant, jamais fatal.
      }
      session = null;
      return ok('closed');
    } catch (e) {
      session = null;
      return err(describe(e));
    }
  }

  /**
   * Rétablit la copie de travail dans son état d'origine.
   * Appelé entre deux déclinaisons, le recolorage étant destructeur.
   */
  function resetSession() {
    try {
      if (!session) return err('aucune session ouverte');
      var file = session.file;
      try {
        session.document.close(SaveOptions.DONOTSAVECHANGES);
      } catch (closeError) {
        /* déjà refermé */
      }
      session.document = app.open(file);
      return ok('reset');
    } catch (e) {
      return err(describe(e));
    }
  }

  /** Document sur lequel travailler : la copie si une session est ouverte. */
  function workingDocument() {
    if (session) return session.document;
    if (app.documents.length === 0) return null;
    return app.activeDocument;
  }

  /* ---------------------------------------------------------------------- *
   * Déclinaisons chromatiques
   * ---------------------------------------------------------------------- */

  /** Construit un noir de renfort, CMJN 0/0/0/100. */
  function blackColor() {
    var color = new CMYKColor();
    color.cyan = 0;
    color.magenta = 0;
    color.yellow = 0;
    color.black = 100;
    return color;
  }

  /** Construit un blanc pur. */
  function whiteColor() {
    var color = new CMYKColor();
    color.cyan = 0;
    color.magenta = 0;
    color.yellow = 0;
    color.black = 0;
    return color;
  }

  /** Construit un gris, `level` de 0 (blanc) à 100 (noir). */
  function grayColor(level) {
    var color = new GrayColor();
    color.gray = Math.max(0, Math.min(100, level));
    return color;
  }

  /** Construit une couleur RVB. */
  function rgbColor(r, g, b) {
    var color = new RGBColor();
    color.red = Math.max(0, Math.min(255, r));
    color.green = Math.max(0, Math.min(255, g));
    color.blue = Math.max(0, Math.min(255, b));
    return color;
  }

  /**
   * Traduit une couleur Illustrator en triplet RVB.
   * @returns un tableau [r, g, b], ou `null` pour un dégradé ou un motif.
   */
  function toRgb(color) {
    if (!color) return null;
    try {
      if (color.typename === 'RGBColor') {
        return [color.red, color.green, color.blue];
      }
      if (color.typename === 'CMYKColor') {
        var c = color.cyan / 100;
        var m = color.magenta / 100;
        var y = color.yellow / 100;
        var k = color.black / 100;
        return [
          Math.round(255 * (1 - c) * (1 - k)),
          Math.round(255 * (1 - m) * (1 - k)),
          Math.round(255 * (1 - y) * (1 - k))
        ];
      }
      if (color.typename === 'GrayColor') {
        var level = Math.round(255 * (1 - color.gray / 100));
        return [level, level, level];
      }
      if (color.typename === 'SpotColor' && color.spot) {
        return toRgb(color.spot.color);
      }
    } catch (e) {
      return null;
    }
    return null;
  }

  /** Formate un triplet en #rrggbb minuscule. */
  function toHex(rgb) {
    var out = '#';
    for (var i = 0; i < 3; i += 1) {
      var value = Math.max(0, Math.min(255, Math.round(rgb[i]))).toString(16);
      out += value.length === 1 ? '0' + value : value;
    }
    return out;
  }

  /**
   * Relit une table « source>cible;source>cible ».
   *
   * Le pont ne transporte que des chaînes : la table arrive sous cette forme,
   * produite par le moteur du panneau.
   */
  function parseColorMap(text) {
    var map = [];
    if (!text) return map;
    var parts = String(text).split(';');
    for (var i = 0; i < parts.length; i += 1) {
      var pair = parts[i].split('>');
      if (pair.length !== 2) continue;
      var from = String(pair[0]).replace('#', '').toLowerCase();
      var to = String(pair[1]).replace('#', '');
      if (from.length !== 6 || to.length !== 6) continue;
      map.push({
        from: from,
        to: [
          parseInt(to.substring(0, 2), 16),
          parseInt(to.substring(2, 4), 16),
          parseInt(to.substring(4, 6), 16)
        ]
      });
    }
    return map;
  }

  /** Cherche la cible associée à une couleur source. */
  function mappedTarget(map, rgb) {
    if (!map || !map.length) return null;
    var wanted = toHex(rgb).replace('#', '');
    for (var i = 0; i < map.length; i += 1) {
      if (map[i].from === wanted) return map[i].to;
    }
    return null;
  }

  /**
   * Calcule la couleur de remplacement d'un élément.
   *
   * @param threshold seuil d'inversion, de 0 à 100 : une couleur dont la
   *   luminance dépasse le seuil est déjà assez claire pour rester lisible
   *   sur un fond sombre, elle n'est donc pas inversée. À 100 tout bascule,
   *   à 0 rien ne bascule.
   * @returns `null` quand l'élément doit rester tel quel.
   */
  function schemeColor(scheme, current, custom, threshold, map) {
    if (scheme === 'fullColor') return null;
    if (scheme === 'black') return blackColor();
    if (scheme === 'white') return whiteColor();

    var rgb = toRgb(current);

    if (scheme === 'custom') {
      // Une correspondance déclarée prime sur la couleur unique : c'est elle
      // qui permet de retoucher une teinte sans aplatir tout le logo.
      var target = rgb ? mappedTarget(map, rgb) : null;
      if (target) return rgbColor(target[0], target[1], target[2]);
      return rgbColor(custom[0], custom[1], custom[2]);
    }

    // Dégradés et motifs : on ne sait pas les convertir sans les dénaturer.
    if (!rgb) return null;

    if (scheme === 'grayscale') {
      var luminance = Math.round(0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2]);
      return grayColor(((255 - luminance) / 255) * 100);
    }
    if (scheme === 'inverted') {
      var level = 0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2];
      if (level >= (threshold / 100) * 255) return null;
      return rgbColor(255 - rgb[0], 255 - rgb[1], 255 - rgb[2]);
    }
    return null;
  }

  /**
   * Inventorie les couleurs employées par le document de travail.
   *
   * Sans cet inventaire, la table source → cible se remplirait à l'aveugle :
   * le designer ne peut pas deviner les valeurs exactes de son artwork.
   *
   * Charge utile : « hex:occurrences », de la plus fréquente à la plus rare.
   */
  function listDocumentColors(limit) {
    try {
      var doc = workingDocument();
      if (!doc) return err('aucun document de travail');

      var counts = {};
      var order = [];

      // Expression de fonction, et non déclaration : en ES3, une déclaration
      // de fonction n'est légale qu'au niveau d'un programme ou d'un corps de
      // fonction — jamais dans un bloc, et ceci est dans un `try`.
      var record = function (color) {
        var rgb = toRgb(color);
        if (!rgb) return;
        var hex = toHex(rgb);
        if (counts[hex] === undefined) {
          counts[hex] = 0;
          order.push(hex);
        }
        counts[hex] += 1;
      };

      var paths = doc.pathItems;
      for (var i = 0; i < paths.length; i += 1) {
        try {
          if (paths[i].filled) record(paths[i].fillColor);
          if (paths[i].stroked) record(paths[i].strokeColor);
        } catch (pathError) {
          /* élément inaccessible : on poursuit l'inventaire */
        }
      }

      var frames = doc.textFrames;
      for (var t = 0; t < frames.length; t += 1) {
        try {
          record(frames[t].textRange.characterAttributes.fillColor);
        } catch (frameError) {
          /* bloc inaccessible : on poursuit */
        }
      }

      // Tri par fréquence : les couleurs de marque arrivent en tête.
      order.sort(function (a, b) {
        return counts[b] - counts[a];
      });

      var max = parseInt(limit, 10);
      if (isNaN(max) || max <= 0) max = 24;

      var parts = [];
      for (var k = 0; k < order.length && k < max; k += 1) {
        parts.push(order[k] + ':' + counts[order[k]]);
      }
      return ok(parts.join(UNIT));
    } catch (e) {
      return err(describe(e));
    }
  }

  /** Applique une couleur aux tracés d'un document. */
  function recolorPaths(doc, scheme, custom, threshold, map) {
    var items = doc.pathItems;
    for (var i = 0; i < items.length; i += 1) {
      var item = items[i];
      try {
        if (item.filled) {
          var fill = schemeColor(scheme, item.fillColor, custom, threshold, map);
          if (fill) item.fillColor = fill;
        }
        if (item.stroked) {
          var stroke = schemeColor(scheme, item.strokeColor, custom, threshold, map);
          if (stroke) item.strokeColor = stroke;
        }
      } catch (itemError) {
        // Un élément verrouillé ou dans un calque masqué : on poursuit.
      }
    }
  }

  /** Applique une couleur aux blocs de texte d'un document. */
  function recolorText(doc, scheme, custom, threshold, map) {
    var frames = doc.textFrames;
    for (var i = 0; i < frames.length; i += 1) {
      try {
        var attributes = frames[i].textRange.characterAttributes;
        var fill = schemeColor(scheme, attributes.fillColor, custom, threshold, map);
        if (fill) attributes.fillColor = fill;
      } catch (frameError) {
        /* bloc inaccessible : on poursuit */
      }
    }
  }

  /**
   * Applique un schéma chromatique au document de travail.
   *
   * @param scheme fullColor, black, white, grayscale, inverted ou custom.
   * @param hex couleur au format #rrggbb, requise pour custom.
   * @param threshold seuil d'inversion de 0 à 100 ; 100 par défaut.
   * @param colorMap table « source>cible » des couleurs personnalisées.
   */
  function applyColorScheme(scheme, hex, threshold, colorMap) {
    try {
      var doc = workingDocument();
      if (!doc) return err('aucun document de travail');
      if (scheme === 'fullColor') return ok('unchanged');

      // `evalScript` transmet les arguments en texte : un seuil absent ou
      // illisible vaut 100, c'est-à-dire l'inversion complète.
      var level = parseFloat(threshold);
      if (isNaN(level)) level = 100;
      if (level < 0) level = 0;
      if (level > 100) level = 100;

      var custom = [0, 0, 0];
      if (scheme === 'custom') {
        if (!hex || String(hex).length < 7) {
          return err('couleur personnalisee manquante');
        }
        var clean = String(hex).replace('#', '');
        custom = [
          parseInt(clean.substring(0, 2), 16),
          parseInt(clean.substring(2, 4), 16),
          parseInt(clean.substring(4, 6), 16)
        ];
      }

      // Les éléments verrouillés ou masqués refusent toute modification :
      // on lève ces protections sur la copie, jamais sur l'original.
      try {
        for (var l = 0; l < doc.layers.length; l += 1) {
          doc.layers[l].locked = false;
          doc.layers[l].visible = true;
        }
      } catch (layerError) {
        /* certaines versions refusent : on tente quand même le recolorage */
      }

      var map = parseColorMap(colorMap);
      recolorPaths(doc, scheme, custom, level, map);
      recolorText(doc, scheme, custom, level, map);
      return ok(scheme);
    } catch (e) {
      return err(describe(e));
    }
  }

  /**
   * Élargit un plan de travail de la marge demandée, en points.
   *
   * `artboardRect` vaut [gauche, haut, droite, bas], l'axe vertical croissant
   * vers le haut : la marge haute s'ajoute, la marge basse se retranche.
   * L'opération n'a lieu que sur la copie de travail — jamais sur le document
   * de l'utilisateur.
   */
  function setArtboardPadding(artboardIndex, top, right, bottom, left) {
    try {
      var doc = workingDocument();
      if (!doc) return err('aucun document de travail');

      var index = parseInt(artboardIndex, 10);
      if (index < 0 || index >= doc.artboards.length) {
        return err('plan de travail ' + (index + 1) + ' inexistant');
      }

      var t = parseFloat(top) || 0;
      var r = parseFloat(right) || 0;
      var b = parseFloat(bottom) || 0;
      var l = parseFloat(left) || 0;
      if (!t && !r && !b && !l) return ok('unchanged');

      var board = doc.artboards[index];
      var rect = board.artboardRect;
      board.artboardRect = [rect[0] - l, rect[1] + t, rect[2] + r, rect[3] - b];
      return ok('padded');
    } catch (e) {
      return err(describe(e));
    }
  }

  /* ---------------------------------------------------------------------- *
   * Export
   * ---------------------------------------------------------------------- */

  /** Sélectionne le plan de travail actif, en base 0. */
  function selectArtboard(doc, index) {
    if (index < 0 || index >= doc.artboards.length) {
      throw new Error(
        'plan de travail ' +
          (index + 1) +
          ' inexistant (' +
          doc.artboards.length +
          ' disponibles)'
      );
    }
    doc.artboards.setActiveArtboardIndex(index);
  }

  /**
   * Vérifie qu'un fichier a bien été écrit, et renvoie sa taille.
   *
   * Un export « réussi » qui n'a rien produit, ou produit un fichier vide, est
   * un échec : sans cette vérification, le décompte final compterait des
   * intentions plutôt que des livrables.
   */
  function verifyWritten(path, extension) {
    var file = new File(path);
    if (!file.exists) {
      throw new Error('aucun fichier ' + extension + ' écrit : ' + path);
    }
    var size = file.length;
    if (!size) {
      throw new Error('fichier ' + extension + ' vide : ' + path);
    }
    return size;
  }

  /**
   * Un document à plan de travail unique s'écrit directement.
   *
   * Illustrator ne suffixe les noms que lorsque `saveMultipleArtboards` est
   * actif, ce qui n'a aucun sens sur un document qui n'en compte qu'un. Écrire
   * directement évite le dossier d'attente — et surtout évite que `saveAs`
   * relie le document de travail à un fichier que le nettoyage vient de
   * détruire.
   */
  function isSingleArtboard(doc) {
    try {
      return doc.artboards.length === 1;
    } catch (e) {
      return false;
    }
  }

  /**
   * Exécute une exportation dans un dossier temporaire, puis déplace l'unique
   * fichier produit vers `targetPath`.
   *
   * Réservé aux documents à plusieurs plans de travail, où le suffixage
   * d'Illustrator varie selon la version et rend le nom final imprévisible.
   */
  /** Vide et supprime un dossier de travail temporaire. */
  function clearStage(stage) {
    try {
      var leftovers = stage.getFiles();
      for (var i = 0; i < leftovers.length; i += 1) leftovers[i].remove();
      stage.remove();
    } catch (cleanupError) {
      /* un temporaire résiduel n'est jamais fatal */
    }
  }

  function exportThenRename(targetPath, extension, writer) {
    var target = new File(targetPath);
    var stage = new Folder(
      Folder.temp.fsName + '/logo-forge-stage-' + new Date().getTime()
    );
    if (!stage.exists && !stage.create()) {
      throw new Error('dossier temporaire impossible a creer');
    }

    // Ni `finally`, ni `return` traversant un `finally` : le moteur
    // ExtendScript est connu pour perdre la valeur de retour dans ce cas. Le
    // nettoyage est donc appelé explicitement sur les deux issues.
    var failure = null;
    var produced = null;

    try {
      var base = new File(stage.fsName + '/out.' + extension);
      writer(base);

      var files = stage.getFiles('*.' + extension);
      if (!files || files.length === 0) {
        failure = 'Illustrator n a produit aucun fichier ' + extension;
      } else {
        if (target.exists) target.remove();
        if (files[0].copy(target.fsName)) produced = target.fsName;
        else failure = 'copie vers ' + targetPath + ' impossible';
      }
    } catch (error) {
      failure = describe(error);
    }

    clearStage(stage);
    if (failure) throw new Error(failure);
    return produced;
  }

  /**
   * Écrit un fichier d'export, puis en vérifie la présence et la taille.
   *
   * @param writer reçoit le fichier de destination et un indicateur disant si
   *   plusieurs plans de travail doivent être gérés.
   * @returns « chemin | octets ».
   */
  function writeExport(doc, targetPath, extension, writer) {
    var written;
    if (isSingleArtboard(doc)) {
      writer(new File(targetPath), false);
      written = targetPath;
    } else {
      written = exportThenRename(targetPath, extension, function (stageFile) {
        writer(stageFile, true);
      });
    }
    return written + UNIT + verifyWritten(written, extension);
  }

  /**
   * Échelle d'export, en pourcentage.
   *
   * Illustrator raisonne en pourcentage, 100 % valant 72 ppp. Une largeur
   * voulue se traduit donc depuis la largeur du plan de travail.
   */
  function exportScale(boardWidth, width, resolution) {
    if (!boardWidth) throw new Error('plan de travail de largeur nulle');

    var targetWidth = parseFloat(width);
    var scale =
      targetWidth > 0
        ? (targetWidth / boardWidth) * 100
        : (parseFloat(resolution) / 72) * 100;

    if (!isFinite(scale) || scale <= 0) throw new Error('echelle invalide');
    // Illustrator refuse au-delà de 776,19 % dans certaines versions.
    return scale > 7761 ? 7761 : scale;
  }

  /** Largeur du plan de travail visé, après validation de son index. */
  function boardWidthAt(doc, index) {
    selectArtboard(doc, index);
    var rect = doc.artboards[index].artboardRect;
    return Math.abs(rect[2] - rect[0]);
  }

  /** Exporte un plan de travail en PNG. */
  function exportArtboardAsPNG(artboardIndex, outputPath, width, resolution) {
    try {
      var doc = workingDocument();
      if (!doc) return err('aucun document de travail');

      var index = parseInt(artboardIndex, 10);
      var scale = exportScale(boardWidthAt(doc, index), width, resolution);

      return ok(
        writeExport(doc, outputPath, 'png', function (file, multiple) {
          var options = new ExportOptionsPNG24();
          assignIfSupported(options, 'antiAliasing', true);
          assignIfSupported(options, 'transparency', true);
          assignIfSupported(options, 'artBoardClipping', true);
          assignIfSupported(options, 'horizontalScale', scale);
          assignIfSupported(options, 'verticalScale', scale);
          assignIfSupported(options, 'saveMultipleArtboards', multiple);
          if (multiple) {
            assignIfSupported(options, 'artboardRange', String(index + 1));
          }
          doc.exportFile(file, ExportType.PNG24, options);
        })
      );
    } catch (e) {
      return err(describe(e));
    }
  }

  /** Exporte un plan de travail en JPEG. */
  function exportArtboardAsJPEG(artboardIndex, outputPath, width, resolution) {
    try {
      var doc = workingDocument();
      if (!doc) return err('aucun document de travail');

      var index = parseInt(artboardIndex, 10);
      var scale = exportScale(boardWidthAt(doc, index), width, resolution);

      return ok(
        writeExport(doc, outputPath, 'jpg', function (file, multiple) {
          var options = new ExportOptionsJPEG();
          assignIfSupported(options, 'antiAliasing', true);
          assignIfSupported(options, 'artBoardClipping', true);
          assignIfSupported(options, 'qualitySetting', 90);
          assignIfSupported(options, 'horizontalScale', scale);
          assignIfSupported(options, 'verticalScale', scale);
          assignIfSupported(options, 'saveMultipleArtboards', multiple);
          if (multiple) {
            assignIfSupported(options, 'artboardRange', String(index + 1));
          }
          doc.exportFile(file, ExportType.JPEG, options);
        })
      );
    } catch (e) {
      return err(describe(e));
    }
  }

  /** Exporte un plan de travail en SVG. */
  function exportArtboardAsSVG(artboardIndex, outputPath) {
    try {
      var doc = workingDocument();
      if (!doc) return err('aucun document de travail');

      var index = parseInt(artboardIndex, 10);
      selectArtboard(doc, index);

      return ok(
        writeExport(doc, outputPath, 'svg', function (file, multiple) {
          var options = new ExportOptionsSVG();
          assignIfSupported(options, 'embedRasterImages', true);
          assignIfSupported(options, 'preserveEditability', false);
          // Les polices sont vectorisées : le logo doit s'afficher à
          // l'identique sans que la police soit installée chez le destinataire.
          assignIfSupported(options, 'fontType', SVGFontType.OUTLINEFONT);
          assignIfSupported(options, 'coordinatePrecision', 4);
          assignIfSupported(options, 'saveMultipleArtboards', multiple);
          if (multiple) {
            assignIfSupported(options, 'artboardRange', String(index + 1));
          }
          doc.exportFile(file, ExportType.SVG, options);
        })
      );
    } catch (e) {
      return err(describe(e));
    }
  }

  /** Écrit un plan de travail en PDF. */
  function exportArtboardAsPDF(artboardIndex, outputPath) {
    try {
      var doc = workingDocument();
      if (!doc) return err('aucun document de travail');

      var index = parseInt(artboardIndex, 10);
      selectArtboard(doc, index);

      return ok(
        writeExport(doc, outputPath, 'pdf', function (file, multiple) {
          var options = new PDFSaveOptions();
          assignIfSupported(options, 'preserveEditability', true);
          assignIfSupported(options, 'viewAfterSaving', false);
          assignIfSupported(options, 'saveMultipleArtboards', multiple);
          if (multiple) {
            assignIfSupported(options, 'artboardRange', String(index + 1));
          }
          doc.saveAs(file, options);
        })
      );
    } catch (e) {
      return err(describe(e));
    }
  }

  /** Écrit un plan de travail en EPS. */
  function exportArtboardAsEPS(artboardIndex, outputPath) {
    try {
      var doc = workingDocument();
      if (!doc) return err('aucun document de travail');

      var index = parseInt(artboardIndex, 10);
      selectArtboard(doc, index);

      return ok(
        writeExport(doc, outputPath, 'eps', function (file, multiple) {
          var options = new EPSSaveOptions();
          assignIfSupported(options, 'embedAllFonts', true);
          assignIfSupported(options, 'includeDocumentThumbnails', true);
          assignIfSupported(options, 'saveMultipleArtboards', multiple);
          if (multiple) {
            assignIfSupported(options, 'artboardRange', String(index + 1));
          }
          doc.saveAs(file, options);
        })
      );
    } catch (e) {
      return err(describe(e));
    }
  }

  /** Écrit le document de travail au format natif Illustrator. */
  function exportAsAI(outputPath) {
    try {
      var doc = workingDocument();
      if (!doc) return err('aucun document de travail');

      // `saveAs` en .ai ne suffixe jamais : l'écriture est directe, quel que
      // soit le nombre de plans de travail.
      var file = new File(outputPath);
      var options = new IllustratorSaveOptions();
      assignIfSupported(options, 'pdfCompatible', true);
      doc.saveAs(file, options);

      return ok(outputPath + UNIT + verifyWritten(outputPath, 'ai'));
    } catch (e) {
      return err(describe(e));
    }
  }

  /* ---------------------------------------------------------------------- *
   * Contrôle de production
   *
   * L'inspection ne modifie jamais rien : elle compte, elle décrit, elle rend
   * la main. Les corrections sont des fonctions distinctes, appelées une par
   * une et seulement sur demande explicite.
   * ---------------------------------------------------------------------- */

  /** Un tracé d'un seul point, vestige d'un clic manqué. */
  function isStrayPoint(item) {
    try {
      return item.typename === 'PathItem' && item.pathPoints.length < 2;
    } catch (e) {
      return false;
    }
  }

  /**
   * Un tracé sans fond ni contour.
   *
   * Un masque d'écrêtage est légitimement dépourvu des deux : le supprimer
   * révélerait tout ce qu'il masque. On l'écarte donc du décompte.
   */
  function isUnpainted(item) {
    try {
      if (item.typename !== 'PathItem') return false;
      if (item.clipping) return false;
      if (item.guides) return false;
      return !item.filled && !item.stroked;
    } catch (e) {
      return false;
    }
  }

  /** Un bloc de texte sans contenu visible. */
  function isEmptyText(frame) {
    try {
      var text = String(frame.contents);
      return text.replace(/^\s+|\s+$/g, '') === '';
    } catch (e) {
      return false;
    }
  }

  /**
   * Contrôle de production du document actif.
   *
   * @param mode `print` ou `web` : le mode colorimétrique attendu en dépend.
   * @returns une ligne par contrôle, « identifiant:décompte:détail ».
   */
  function preflightDocument(mode) {
    try {
      if (app.documents.length === 0) return err('aucun document ouvert');

      var doc = app.activeDocument;
      var wanted = String(mode).toLowerCase() === 'print' ? 'cmyk' : 'rgb';
      var actual = doc.documentColorSpace === DocumentColorSpace.CMYK ? 'cmyk' : 'rgb';

      var findings = [];
      // Expression de fonction : voir `record` — une déclaration dans un bloc
      // sort de la grammaire ES3.
      var report = function (id, count, detail) {
        findings.push(id + ':' + count + ':' + (detail === undefined ? '' : detail));
      };

      report('colorMode', actual === wanted ? 0 : 1, actual + '/' + wanted);

      var strays = 0;
      var unpainted = 0;
      var stroked = 0;
      var overprint = 0;
      var richBlack = 0;

      var paths = doc.pathItems;
      for (var i = 0; i < paths.length; i += 1) {
        var item = paths[i];
        try {
          if (isStrayPoint(item)) strays += 1;
          if (isUnpainted(item)) unpainted += 1;
          if (item.stroked) stroked += 1;
          if (item.fillOverprint || item.strokeOverprint) overprint += 1;
          if (item.filled) {
            var color = item.fillColor;
            if (
              color &&
              color.typename === 'CMYKColor' &&
              color.black > 90 &&
              (color.cyan > 0 || color.magenta > 0 || color.yellow > 0)
            ) {
              richBlack += 1;
            }
          }
        } catch (itemError) {
          /* élément inaccessible : il ne fausse aucun décompte */
        }
      }

      report('strayPoints', strays);
      report('unpainted', unpainted);
      report('strokes', stroked);
      report('overprint', overprint);
      if (wanted === 'print') report('richBlack', richBlack);

      var emptyText = 0;
      var frames = doc.textFrames;
      for (var t = 0; t < frames.length; t += 1) {
        if (isEmptyText(frames[t])) emptyText += 1;
      }
      report('emptyText', emptyText);
      report('liveText', frames.length - emptyText);

      var lockedLayers = 0;
      var hiddenLayers = 0;
      for (var l = 0; l < doc.layers.length; l += 1) {
        try {
          if (doc.layers[l].locked) lockedLayers += 1;
          if (!doc.layers[l].visible) hiddenLayers += 1;
        } catch (layerError) {
          /* calque inaccessible */
        }
      }
      report('lockedLayers', lockedLayers);
      report('hiddenLayers', hiddenLayers);

      // Nuanciers inutilisés : comparés aux couleurs réellement employées.
      var used = {};
      for (var u = 0; u < paths.length; u += 1) {
        try {
          if (paths[u].filled) {
            var fill = toRgb(paths[u].fillColor);
            if (fill) used[toHex(fill)] = true;
          }
          if (paths[u].stroked) {
            var line = toRgb(paths[u].strokeColor);
            if (line) used[toHex(line)] = true;
          }
        } catch (usedError) {
          /* élément inaccessible */
        }
      }

      var unusedSwatches = 0;
      try {
        for (var w = 0; w < doc.swatches.length; w += 1) {
          var swatch = doc.swatches[w];
          // « [Sans] » et le repérage ne sont pas des couleurs de travail.
          if (swatch.name === '[None]' || swatch.name === '[Registration]') {
            continue;
          }
          var rgb = toRgb(swatch.color);
          if (rgb && !used[toHex(rgb)]) unusedSwatches += 1;
        }
      } catch (swatchError) {
        /* nuancier inaccessible : le contrôle reste muet plutôt que faux */
      }
      report('unusedSwatches', unusedSwatches);

      // Blanc tournant : proportion du plan de travail que l'artwork n'occupe pas.
      var whitespace = 0;
      var items = topLevelItems(doc);
      if (items.length > 0) {
        var rect = doc.artboards[0].artboardRect;
        var boardArea = Math.abs(rect[2] - rect[0]) * Math.abs(rect[1] - rect[3]);
        var frame = selectionBounds(items);
        var artArea = Math.abs(frame[2] - frame[0]) * Math.abs(frame[1] - frame[3]);
        if (boardArea > 0) {
          whitespace = Math.round((1 - artArea / boardArea) * 100);
          if (whitespace < 0) whitespace = 0;
        }
      }
      report('whitespace', whitespace > 25 ? 1 : 0, String(whitespace));

      report('items', items.length);

      return ok(findings.join(UNIT));
    } catch (e) {
      return err(describe(e));
    }
  }

  /**
   * Corrections sûres, appliquées au document actif sur demande explicite.
   *
   * Chacune est réversible par l'annulation d'Illustrator, et aucune ne touche
   * à l'apparence de ce qui est visible : elles ne retirent que des objets qui
   * ne peignent rien.
   */
  function cleanDocument(what) {
    try {
      if (app.documents.length === 0) return err('aucun document ouvert');
      var doc = app.activeDocument;
      var kind = String(what);
      var removed = 0;

      if (kind === 'strayPoints' || kind === 'unpainted') {
        var paths = doc.pathItems;
        // Parcours à rebours : retirer un élément décale les suivants.
        for (var i = paths.length - 1; i >= 0; i -= 1) {
          var item = paths[i];
          var matches = kind === 'strayPoints' ? isStrayPoint(item) : isUnpainted(item);
          if (!matches) continue;
          try {
            item.remove();
            removed += 1;
          } catch (removeError) {
            /* élément verrouillé : compté par différence */
          }
        }
        return ok(String(removed));
      }

      if (kind === 'emptyText') {
        var frames = doc.textFrames;
        for (var t = frames.length - 1; t >= 0; t -= 1) {
          if (!isEmptyText(frames[t])) continue;
          try {
            frames[t].remove();
            removed += 1;
          } catch (frameError) {
            /* bloc verrouillé */
          }
        }
        return ok(String(removed));
      }

      return err('correction inconnue : ' + kind);
    } catch (e) {
      return err(describe(e));
    }
  }

  /* ---------------------------------------------------------------------- *
   * Composants
   *
   * Un composant est une sélection de l'utilisateur promue en document
   * autonome : Illustrator sait exporter un document entier bien plus
   * fidèlement qu'une portion de plan de travail, et chaque composant reçoit
   * ainsi son propre cadrage, indépendant de la mise en page du fichier source.
   * ---------------------------------------------------------------------- */

  /** Union des boîtes englobantes visibles d'une liste d'objets. */
  function selectionBounds(items) {
    var left = null;
    var top = null;
    var right = null;
    var bottom = null;

    for (var i = 0; i < items.length; i += 1) {
      var b = items[i].visibleBounds;
      if (left === null || b[0] < left) left = b[0];
      if (top === null || b[1] > top) top = b[1];
      if (right === null || b[2] > right) right = b[2];
      if (bottom === null || b[3] < bottom) bottom = b[3];
    }

    return [left, top, right, bottom];
  }

  /**
   * Indique si un objet peut être cadré, donc copié dans un composant.
   *
   * En mode édition de texte, `selection` contient des TextRange, dépourvus de
   * boîte englobante : les écarter ici donne un message utile plutôt qu'une
   * exception opaque.
   */
  function isPlaceable(item) {
    try {
      var b = item.visibleBounds;
      return !!b && b.length === 4;
    } catch (e) {
      return false;
    }
  }

  /**
   * Décrit la sélection courante sans rien modifier.
   *
   * Sonde de diagnostic : c'est elle qui permet de savoir, depuis le panneau,
   * ce qu'Illustrator considère réellement comme sélectionné.
   *
   * Charge utile : total, cadrables, masqués, verrouillés, puis les types
   * rencontrés, séparés par des virgules.
   */
  function describeSelection() {
    try {
      if (app.documents.length === 0) return err('aucun document ouvert');
      var selection = app.activeDocument.selection;
      if (!selection) return ok([0, 0, 0, 0, ''].join(UNIT));

      var placeable = 0;
      var hidden = 0;
      var locked = 0;
      var types = [];

      for (var i = 0; i < selection.length; i += 1) {
        var item = selection[i];
        if (isPlaceable(item)) placeable += 1;

        var kind = 'inconnu';
        try {
          kind = String(item.typename);
        } catch (typeError) {
          /* objet sans typename : on le compte sous « inconnu » */
        }
        var seen = false;
        for (var t = 0; t < types.length; t += 1) {
          if (types[t] === kind) seen = true;
        }
        if (!seen) types.push(kind);

        try {
          if (item.hidden) hidden += 1;
        } catch (hiddenError) {
          /* propriété absente sur certains types */
        }
        try {
          if (item.locked) locked += 1;
        } catch (lockedError) {
          /* idem */
        }
      }

      return ok(
        [selection.length, placeable, hidden, locked, types.join(',')].join(UNIT)
      );
    } catch (e) {
      return err(describe(e));
    }
  }

  /**
   * Rend une copie visible et modifiable.
   *
   * Un objet masqué dupliqué reste masqué : le composant contiendrait alors
   * des objets bien réels et un plan de travail visuellement vide. On ne
   * touche jamais à l'original, uniquement à la copie.
   */
  function reveal(item) {
    assignIfSupported(item, 'hidden', false);
    assignIfSupported(item, 'locked', false);
  }

  /**
   * Écrit une vignette PNG du premier plan de travail d'un document.
   *
   * La miniature du panneau doit montrer l'artwork réel : c'est le seul
   * contrôle visuel dont dispose le designer pour constater qu'un composant a
   * bien été capturé.
   */
  function writeThumbnail(doc, outputPath, targetWidth) {
    var rect = doc.artboards[0].artboardRect;
    var boardWidth = Math.abs(rect[2] - rect[0]);
    if (!boardWidth) throw new Error('plan de travail de largeur nulle');

    var scale = (parseFloat(targetWidth) / boardWidth) * 100;
    if (!isFinite(scale) || scale <= 0) scale = 100;
    if (scale > 7761) scale = 7761;

    var options = new ExportOptionsPNG24();
    assignIfSupported(options, 'antiAliasing', true);
    assignIfSupported(options, 'transparency', true);
    assignIfSupported(options, 'artBoardClipping', true);
    assignIfSupported(options, 'saveMultipleArtboards', false);
    assignIfSupported(options, 'horizontalScale', scale);
    assignIfSupported(options, 'verticalScale', scale);

    doc.exportFile(new File(outputPath), ExportType.PNG24, options);

    var produced = new File(outputPath);
    if (!produced.exists) throw new Error('vignette non produite');
    if (!produced.length) throw new Error('vignette vide');
    return produced.fsName;
  }

  /** Chemin temporaire dérivé d'un identifiant de composant. */
  function componentTempPath(componentId, extension) {
    return (
      Folder.temp.fsName +
      '/logo-forge-component-' +
      String(componentId).replace(/[^a-zA-Z0-9]/g, '') +
      '-' +
      new Date().getTime() +
      '.' +
      extension
    );
  }

  /**
   * Promeut la sélection courante en document autonome.
   *
   * Chaque étape est vérifiée et comptée : un composant n'est déclaré défini
   * que si des objets ont réellement été copiés, que le plan de travail les
   * encadre et que le fichier écrit n'est pas vide.
   *
   * @param componentId identifiant du composant, qui nomme le fichier temporaire.
   * @returns nom, chemin, largeur, hauteur, mode, copiés, refusés, octets,
   *   chemin de la vignette.
   */
  function setComponent(componentId) {
    var created = null;
    var source = null;
    try {
      if (app.documents.length === 0) return err('aucun document ouvert');

      source = app.activeDocument;
      var selection = source.selection;
      if (!selection || selection.length === 0) {
        return err(
          'selectionnez un objet dans Illustrator avant de definir le composant'
        );
      }

      // Les TextRange et autres objets sans boîte englobante sont écartés ici :
      // les garder ferait lever le calcul de cadrage sans rien expliquer.
      var items = [];
      for (var s = 0; s < selection.length; s += 1) {
        if (isPlaceable(selection[s])) items.push(selection[s]);
      }
      if (items.length === 0) {
        return err(
          'la selection ne contient aucun objet cadrable — sortez du mode ' +
            'edition de texte, puis selectionnez l objet entier'
        );
      }

      var bounds = selectionBounds(items);
      var width = Math.abs(bounds[2] - bounds[0]);
      var height = Math.abs(bounds[1] - bounds[3]);
      if (!width || !height) return err('selection de taille nulle');

      // Le nouveau document reprend le mode colorimétrique de la source : une
      // conversion à ce stade fausserait toutes les couleurs en aval.
      created = app.documents.add(source.documentColorSpace, width, height);
      var layer = created.layers[0];
      assignIfSupported(layer, 'locked', false);
      assignIfSupported(layer, 'visible', true);

      // `documents.add` a rendu le nouveau document actif. Plusieurs versions
      // d'Illustrator exigent que le document source le soit pour dupliquer
      // depuis lui : on le rétablit avant la copie.
      app.activeDocument = source;

      // Parcours dans l'ordre de la sélection : PLACEATEND ajoute en fin de
      // calque, donc au-dessous. Parcourir à rebours inverserait la pile et
      // ferait passer un aplat de fond devant le logo.
      var copies = [];
      var refusals = [];
      for (var i = 0; i < items.length; i += 1) {
        try {
          copies.push(items[i].duplicate(layer, ElementPlacement.PLACEATEND));
        } catch (dupError) {
          if (refusals.length < 3) refusals.push(describe(dupError));
        }
      }

      var refused = items.length - copies.length;
      if (copies.length === 0) {
        return err(
          'aucun objet n a pu etre copie' +
            (refusals.length ? ' : ' + refusals.join(' ; ') : '')
        );
      }

      for (var r = 0; r < copies.length; r += 1) reveal(copies[r]);

      // Les doublons gardent leurs coordonnées d'origine : on cadre le plan de
      // travail sur elles plutôt que de déplacer l'artwork.
      var frame = selectionBounds(copies);
      var frameWidth = Math.abs(frame[2] - frame[0]);
      var frameHeight = Math.abs(frame[1] - frame[3]);
      if (!frameWidth || !frameHeight) {
        return err('les objets copies n ont aucune etendue visible');
      }
      created.artboards[0].artboardRect = frame;

      app.activeDocument = created;

      var thumbnail = '';
      try {
        thumbnail = writeThumbnail(
          created,
          componentTempPath(componentId, 'png'),
          THUMBNAIL_WIDTH
        );
      } catch (thumbError) {
        // Une vignette manquante n'invalide pas le composant : le panneau
        // affiche alors un aperçu explicitement marqué comme indisponible.
        thumbnail = '';
      }

      var temp = new File(componentTempPath(componentId, 'ai'));
      var saveOptions = new IllustratorSaveOptions();
      saveOptions.pdfCompatible = true;
      created.saveAs(temp, saveOptions);

      var written = new File(temp.fsName);
      if (!written.exists) return err('fichier du composant non ecrit');
      var bytes = written.length;
      if (!bytes) return err('fichier du composant vide');

      var colorMode =
        created.documentColorSpace === DocumentColorSpace.CMYK ? 'cmyk' : 'rgb';
      var name = created.name;

      created.close(SaveOptions.DONOTSAVECHANGES);
      created = null;

      // Rend la main au document de l'utilisateur, jamais laissé en arrière-plan.
      app.activeDocument = source;

      return ok(
        [
          name,
          written.fsName,
          frameWidth,
          frameHeight,
          colorMode,
          copies.length,
          refused,
          bytes,
          thumbnail
        ].join(UNIT)
      );
    } catch (e) {
      if (created) {
        try {
          created.close(SaveOptions.DONOTSAVECHANGES);
        } catch (closeError) {
          /* déjà refermé */
        }
      }
      if (source) {
        try {
          app.activeDocument = source;
        } catch (restoreError) {
          /* le document source a pu être fermé entre-temps */
        }
      }
      return err(describe(e));
    }
  }

  /**
   * Régénère la vignette d'un composant depuis son fichier.
   *
   * Sert au bouton de rafraîchissement d'une carte, et vérifie au passage que
   * le fichier du composant contient toujours quelque chose.
   */
  function renderComponentThumbnail(path, outputPath) {
    var opened = null;
    var previous = null;
    try {
      var file = new File(path);
      if (!file.exists) return err('composant introuvable : ' + path);

      if (app.documents.length > 0) previous = app.activeDocument;
      opened = app.open(file);

      if (opened.pageItems.length === 0) {
        return err('le fichier du composant ne contient aucun objet');
      }

      var thumbnail = writeThumbnail(opened, outputPath, THUMBNAIL_WIDTH);
      var count = opened.pageItems.length;

      opened.close(SaveOptions.DONOTSAVECHANGES);
      opened = null;
      if (previous) app.activeDocument = previous;

      return ok([thumbnail, count].join(UNIT));
    } catch (e) {
      if (opened) {
        try {
          opened.close(SaveOptions.DONOTSAVECHANGES);
        } catch (closeError) {
          /* déjà refermé */
        }
      }
      return err(describe(e));
    }
  }

  /**
   * Objets de premier niveau d'un document.
   *
   * `document.pageItems` et `layer.pageItems` descendent dans les groupes :
   * les recopier tels quels dupliquerait le contenu des groupes en plus des
   * groupes eux-mêmes. Un objet de premier niveau se reconnaît à ce que son
   * parent est un calque.
   */
  function topLevelItems(doc) {
    var out = [];
    for (var l = 0; l < doc.layers.length; l += 1) {
      var layer = doc.layers[l];
      for (var i = 0; i < layer.pageItems.length; i += 1) {
        var item = layer.pageItems[i];
        var parent = null;
        try {
          parent = item.parent;
        } catch (parentError) {
          parent = null;
        }
        if (parent && parent.typename === 'Layer') out.push(item);
      }
    }
    return out;
  }

  /**
   * Ajuste un plan de travail à l'étendue visible de son contenu.
   *
   * Un plan de travail plus grand que le logo se traduit par du blanc autour
   * de chaque fichier exporté, et par un logo qui paraît minuscule chez le
   * client.
   */
  function fitArtboard(artboardIndex) {
    try {
      var doc = workingDocument();
      if (!doc) return err('aucun document de travail');

      var index = parseInt(artboardIndex, 10) || 0;
      if (index < 0 || index >= doc.artboards.length) {
        return err('plan de travail ' + (index + 1) + ' inexistant');
      }

      var items = topLevelItems(doc);
      if (items.length === 0) return err('le document ne contient aucun objet');

      var frame = selectionBounds(items);
      var width = Math.abs(frame[2] - frame[0]);
      var height = Math.abs(frame[1] - frame[3]);
      if (!width || !height) return err('contenu sans etendue visible');

      doc.artboards[index].artboardRect = frame;
      return ok([width, height, items.length].join(UNIT));
    } catch (e) {
      return err(describe(e));
    }
  }

  /**
   * Décrit un document de travail sans le modifier.
   *
   * Charge utile : objets de premier niveau, largeur et hauteur du plan de
   * travail, objets débordant du plan de travail, plans de travail vides.
   */
  function inspectDocument(artboardIndex) {
    try {
      var doc = workingDocument();
      if (!doc) return err('aucun document de travail');

      var index = parseInt(artboardIndex, 10) || 0;
      if (index < 0 || index >= doc.artboards.length) {
        return err('plan de travail ' + (index + 1) + ' inexistant');
      }

      var rect = doc.artboards[index].artboardRect;
      var items = topLevelItems(doc);
      var outside = 0;

      for (var i = 0; i < items.length; i += 1) {
        var b;
        try {
          b = items[i].visibleBounds;
        } catch (boundsError) {
          continue;
        }
        // Une tolérance d'un point absorbe les arrondis de rendu.
        if (
          b[0] < rect[0] - 1 ||
          b[2] > rect[2] + 1 ||
          b[1] > rect[1] + 1 ||
          b[3] < rect[3] - 1
        ) {
          outside += 1;
        }
      }

      return ok(
        [
          items.length,
          Math.abs(rect[2] - rect[0]),
          Math.abs(rect[1] - rect[3]),
          outside,
          doc.artboards.length
        ].join(UNIT)
      );
    } catch (e) {
      return err(describe(e));
    }
  }

  /* ---------------------------------------------------------------------- *
   * Document de package
   *
   * Une planche de revue : les composants en colonnes, les déclinaisons en
   * lignes. Elle reste un document Illustrator natif et modifiable — c'est ce
   * qui permet au designer de constater d'un coup d'œil ce que le client
   * recevra, avant d'écrire le moindre fichier.
   * ---------------------------------------------------------------------- */

  /** Document de package en cours de construction, ou `null`. */
  var packageDocument = null;

  /** Ouvre un document de package vide. */
  function createPackageDocument(width, height, colorMode) {
    try {
      var w = parseFloat(width);
      var h = parseFloat(height);
      if (!(w > 0) || !(h > 0)) return err('dimensions de planche invalides');

      var space =
        String(colorMode).toLowerCase() === 'cmyk'
          ? DocumentColorSpace.CMYK
          : DocumentColorSpace.RGB;

      packageDocument = app.documents.add(space, w, h);
      packageDocument.artboards[0].artboardRect = [0, 0, w, -h];
      return ok([packageDocument.name, w, h].join(UNIT));
    } catch (e) {
      packageDocument = null;
      return err(describe(e));
    }
  }

  /**
   * Peint un fond plein derrière la planche.
   *
   * Un logo livré sur fond transparent est juste sur un site, faux sur un
   * réseau social : la plupart des plateformes le posent sur un fond qu'elles
   * choisissent, et une version blanche y disparaît. Le fond est donc peint
   * dans le fichier, pas laissé au hasard.
   *
   * @param hex couleur du fond, `#rrggbb`.
   */
  function setPackageBackground(hex) {
    try {
      if (!packageDocument) return err('aucune planche ouverte');

      var clean = String(hex).replace(/^#/, '');
      if (!/^[0-9a-fA-F]{6}$/.test(clean)) {
        return err('couleur de fond invalide : ' + hex);
      }

      var board = packageDocument.artboards[0].artboardRect;
      var left = board[0];
      var top = board[1];
      var width = Math.abs(board[2] - board[0]);
      var height = Math.abs(board[1] - board[3]);

      var rect = packageDocument.pathItems.rectangle(top, left, width, height);
      var color = new RGBColor();
      color.red = parseInt(clean.substring(0, 2), 16);
      color.green = parseInt(clean.substring(2, 4), 16);
      color.blue = parseInt(clean.substring(4, 6), 16);
      rect.filled = true;
      rect.fillColor = color;
      rect.stroked = false;

      // Derrière tout le reste : le fond ne doit rien masquer.
      try {
        rect.zOrder(ZOrderMethod.SENDTOBACK);
      } catch (orderError) {
        // Version d'Illustrator sans zOrder sur cet objet : le fond ayant été
        // posé avant le logo, il est déjà au fond.
      }

      return ok([width, height].join(UNIT));
    } catch (e) {
      return err(describe(e));
    }
  }

  /**
   * Copie des objets d'un document vers un autre, par le presse-papiers.
   *
   * Recours quand `duplicate()` inter-documents ne donne rien : le
   * presse-papiers passe là où l'API échoue. Il n'est pas le chemin normal —
   * il écrase ce que l'utilisateur y avait mis, et le résultat dépend du
   * réglage « Presse-papiers » des préférences (AICB ou PDF).
   *
   * @param refusals reçoit la raison d'un échec, pour que l'erreur la nomme.
   * @returns les objets réellement collés dans `targetDoc`.
   */
  function copyThrough(sourceDoc, targetDoc, items, refusals) {
    try {
      app.activeDocument = sourceDoc;
      sourceDoc.selection = null;
      for (var i = 0; i < items.length; i += 1) {
        assignIfSupported(items[i], 'selected', true);
      }
      if (!sourceDoc.selection || sourceDoc.selection.length === 0) {
        refusals.push('selection impossible dans le composant');
        return [];
      }

      app.executeMenuCommand('copy');

      app.activeDocument = targetDoc;
      targetDoc.selection = null;
      app.executeMenuCommand('pasteFront');

      var pasted = targetDoc.selection;
      if (!pasted || pasted.length === 0) {
        refusals.push('le presse-papiers n a rien colle');
        return [];
      }

      var out = [];
      for (var p = 0; p < pasted.length; p += 1) out.push(pasted[p]);
      targetDoc.selection = null;
      return out;
    } catch (clipError) {
      refusals.push('presse-papiers : ' + describe(clipError));
      return [];
    }
  }

  /**
   * Place un composant recoloré dans une cellule de la planche.
   *
   * @returns nombre d'objets réellement placés, largeur et hauteur obtenues.
   */
  function placeComponentAt(
    path,
    scheme,
    hex,
    threshold,
    colorMap,
    left,
    top,
    cellWidth,
    cellHeight
  ) {
    try {
      if (!packageDocument) return err('aucune planche ouverte');

      var opened = openComponent(path);
      if (opened.indexOf('OK') !== 0) return opened;

      if (scheme && scheme !== 'fullColor') {
        var applied = applyColorScheme(scheme, hex, threshold, colorMap);
        if (applied.indexOf('OK') !== 0) {
          endSession();
          return applied;
        }
      }

      var doc = session.document;
      var items = topLevelItems(doc);
      if (items.length === 0) {
        endSession();
        return err('composant sans objet : ' + path);
      }

      // Le document source doit être actif pour que la duplication aboutisse.
      app.activeDocument = doc;

      // Duplication vers le CALQUE de la planche, jamais vers un groupe : une
      // cible « groupe » appartenant à un autre document est refusée par
      // plusieurs versions d'Illustrator, et sans message. Le regroupement se
      // fait ensuite, à l'intérieur d'un seul document, où il est sûr.
      var target = packageDocument.layers[0];
      assignIfSupported(target, 'locked', false);
      assignIfSupported(target, 'visible', true);

      var copies = [];
      var refusals = [];
      for (var i = 0; i < items.length; i += 1) {
        try {
          copies.push(items[i].duplicate(target, ElementPlacement.PLACEATEND));
        } catch (dupError) {
          if (refusals.length < 3) refusals.push(describe(dupError));
        }
      }

      // Repli : là où la duplication inter-documents ne donne rien, le
      // presse-papiers y parvient. Il n'est employé qu'ici — il écrase ce que
      // l'utilisateur y avait mis, ce qui ne se justifie que pour éviter une
      // planche vide.
      if (copies.length === 0) {
        copies = copyThrough(doc, packageDocument, items, refusals);
      }

      endSession();

      if (copies.length === 0) {
        // La cause est nommée : « aucun objet placé » seul avait déjà coûté
        // une session de diagnostic.
        return err(
          'aucun objet place pour ' +
            path +
            (refusals.length ? ' : ' + refusals.join(' ; ') : '')
        );
      }

      app.activeDocument = packageDocument;

      // Regroupement dans le document de la planche : un déplacement local,
      // que le moteur accepte sans réserve.
      var group = packageDocument.groupItems.add();
      var placed = 0;
      for (var c = 0; c < copies.length; c += 1) {
        try {
          copies[c].move(group, ElementPlacement.PLACEATEND);
          placed += 1;
        } catch (moveError) {
          // Une copie qui refuse d'entrer dans le groupe traînerait sur la
          // planche, hors de sa cellule : elle est retirée.
          if (refusals.length < 3) refusals.push(describe(moveError));
          try {
            copies[c].remove();
          } catch (removeError) {
            /* déjà retirée */
          }
        }
      }

      if (placed === 0) {
        try {
          group.remove();
        } catch (removeError) {
          /* groupe déjà retiré */
        }
        return err(
          'aucun objet regroupe pour ' +
            path +
            (refusals.length ? ' : ' + refusals.join(' ; ') : '')
        );
      }

      var bounds = group.visibleBounds;
      var width = Math.abs(bounds[2] - bounds[0]);
      var height = Math.abs(bounds[1] - bounds[3]);
      if (!width || !height) return err('composant sans etendue visible');

      var box = Math.min(
        parseFloat(cellWidth) / width,
        parseFloat(cellHeight) / height
      );
      if (isFinite(box) && box > 0 && box !== 1) group.resize(box * 100, box * 100);

      var placedBounds = group.visibleBounds;
      var placedWidth = Math.abs(placedBounds[2] - placedBounds[0]);
      var placedHeight = Math.abs(placedBounds[1] - placedBounds[3]);

      // Centré dans sa cellule : une grille alignée se relit d'un coup d'œil.
      group.position = [
        parseFloat(left) + (parseFloat(cellWidth) - placedWidth) / 2,
        parseFloat(top) - (parseFloat(cellHeight) - placedHeight) / 2
      ];

      return ok([placed, placedWidth, placedHeight].join(UNIT));
    } catch (e) {
      try {
        endSession();
      } catch (sessionError) {
        /* session déjà refermée */
      }
      return err(describe(e));
    }
  }

  /** Écrit un libellé sur la planche. */
  function addLabelAt(text, left, top, size) {
    try {
      if (!packageDocument) return err('aucune planche ouverte');

      var frame = packageDocument.textFrames.add();
      frame.contents = String(text);
      try {
        frame.textRange.characterAttributes.size = parseFloat(size) || 12;
      } catch (attributeError) {
        // Police manquante ou attribut refusé : le libellé reste lisible à sa
        // taille par défaut, ce qui vaut mieux qu'une planche sans repères.
      }
      frame.position = [parseFloat(left), parseFloat(top)];
      return ok('label');
    } catch (e) {
      return err(describe(e));
    }
  }

  /**
   * Termine la planche et la vérifie.
   *
   * Charge utile : objets de premier niveau, largeur et hauteur du plan de
   * travail, objets débordants.
   */
  function finishPackageDocument() {
    try {
      if (!packageDocument) return err('aucune planche ouverte');

      app.activeDocument = packageDocument;
      var doc = packageDocument;
      var items = topLevelItems(doc);
      if (items.length === 0) {
        return err('la planche est vide');
      }

      var rect = doc.artboards[0].artboardRect;
      var outside = 0;
      for (var i = 0; i < items.length; i += 1) {
        var b = items[i].visibleBounds;
        if (
          b[0] < rect[0] - 1 ||
          b[2] > rect[2] + 1 ||
          b[1] > rect[1] + 1 ||
          b[3] < rect[3] - 1
        ) {
          outside += 1;
        }
      }

      var name = doc.name;
      packageDocument = null;

      return ok(
        [
          items.length,
          Math.abs(rect[2] - rect[0]),
          Math.abs(rect[1] - rect[3]),
          outside,
          name
        ].join(UNIT)
      );
    } catch (e) {
      return err(describe(e));
    }
  }

  /** Referme la planche en cours après un échec. */
  function abortPackageDocument() {
    try {
      if (!packageDocument) return ok('idle');
      packageDocument.close(SaveOptions.DONOTSAVECHANGES);
      packageDocument = null;
      return ok('closed');
    } catch (e) {
      packageDocument = null;
      return err(describe(e));
    }
  }

  /** Ouvre le document d'un composant comme document de travail. */
  function openComponent(path) {
    try {
      if (session) endSession();
      var file = new File(path);
      if (!file.exists) return err('composant introuvable : ' + path);

      // La copie de travail protège le fichier du composant : le recolorage et
      // `saveAs` sont tous deux destructeurs.
      var temp = new File(
        Folder.temp.fsName + '/logo-forge-work-' + new Date().getTime() + '.ai'
      );
      if (!file.copy(temp)) return err('copie de travail impossible');

      session = { document: app.open(temp), file: temp };
      return ok(temp.fsName);
    } catch (e) {
      session = null;
      return err(describe(e));
    }
  }

  /**
   * Bascule le document de travail en CMJN ou en RVB.
   *
   * Le mode colorimétrique n'est pas modifiable par affectation : Illustrator
   * ne l'expose que par la commande de menu correspondante.
   */
  function setDocumentColorMode(mode) {
    try {
      var doc = workingDocument();
      if (!doc) return err('aucun document de travail');

      var wanted = String(mode).toLowerCase();
      var current = doc.documentColorSpace === DocumentColorSpace.CMYK ? 'cmyk' : 'rgb';
      if (current === wanted) return ok('unchanged');

      app.activeDocument = doc;
      app.executeMenuCommand(wanted === 'cmyk' ? 'doc-color-cmyk' : 'doc-color-rgb');
      return ok(wanted);
    } catch (e) {
      return err(describe(e));
    }
  }

  /** Supprime un fichier temporaire de composant. */
  function removeComponentFile(path) {
    try {
      var file = new File(path);
      if (file.exists) file.remove();
      return ok('removed');
    } catch (e) {
      return err(describe(e));
    }
  }

  return {
    getDocumentName: getDocumentName,
    getDocumentInfo: getDocumentInfo,
    getArtboardNames: getArtboardNames,
    createFolder: createFolder,
    pathExists: pathExists,
    writeTextFile: writeTextFile,
    writeIco: writeIco,
    setPackageBackground: setPackageBackground,
    listFiles: listFiles,
    beginSession: beginSession,
    endSession: endSession,
    resetSession: resetSession,
    applyColorScheme: applyColorScheme,
    listDocumentColors: listDocumentColors,
    preflightDocument: preflightDocument,
    cleanDocument: cleanDocument,
    describeSelection: describeSelection,
    setComponent: setComponent,
    renderComponentThumbnail: renderComponentThumbnail,
    fitArtboard: fitArtboard,
    inspectDocument: inspectDocument,
    createPackageDocument: createPackageDocument,
    placeComponentAt: placeComponentAt,
    addLabelAt: addLabelAt,
    finishPackageDocument: finishPackageDocument,
    abortPackageDocument: abortPackageDocument,
    openComponent: openComponent,
    setDocumentColorMode: setDocumentColorMode,
    removeComponentFile: removeComponentFile,
    setArtboardPadding: setArtboardPadding,
    exportArtboardAsPNG: exportArtboardAsPNG,
    exportArtboardAsJPEG: exportArtboardAsJPEG,
    exportArtboardAsSVG: exportArtboardAsSVG,
    exportArtboardAsPDF: exportArtboardAsPDF,
    exportArtboardAsEPS: exportArtboardAsEPS,
    exportAsAI: exportAsAI
  };
})();

/*
 * Fonctions globales.
 *
 * evalScript() évalue une expression : c'est par ces noms globaux que le
 * panneau appelle la couche ExtendScript.
 */

function lfPing() {
  // Le mot compte : la sonde du panneau l'exige tel quel. Un hôte qui
  // répondrait « OK » à tout ne prouverait rien.
  return 'OK|pong';
}
function lfGetDocumentName() {
  return LogoForge.getDocumentName();
}
function lfGetDocumentInfo() {
  return LogoForge.getDocumentInfo();
}
function lfGetArtboardNames() {
  return LogoForge.getArtboardNames();
}
function lfCreateFolder(path) {
  return LogoForge.createFolder(path);
}
function lfPathExists(path) {
  return LogoForge.pathExists(path);
}
function lfListFiles(root, limit) {
  return LogoForge.listFiles(root, limit);
}

function lfWriteTextFile(path, contents) {
  return LogoForge.writeTextFile(path, contents);
}
function lfWriteIco(targetPath, sources, sizes) {
  return LogoForge.writeIco(targetPath, sources, sizes);
}
function lfPackageBackground(hex) {
  return LogoForge.setPackageBackground(hex);
}
function lfBeginSession() {
  return LogoForge.beginSession();
}
function lfEndSession() {
  return LogoForge.endSession();
}
function lfResetSession() {
  return LogoForge.resetSession();
}
function lfPreflight(mode) {
  return LogoForge.preflightDocument(mode);
}

function lfClean(what) {
  return LogoForge.cleanDocument(what);
}

function lfListColors(limit) {
  return LogoForge.listDocumentColors(limit);
}

function lfApplyColorScheme(scheme, hex, threshold, colorMap) {
  return LogoForge.applyColorScheme(scheme, hex, threshold, colorMap);
}
function lfDescribeSelection() {
  return LogoForge.describeSelection();
}

function lfRenderThumbnail(path, outputPath) {
  return LogoForge.renderComponentThumbnail(path, outputPath);
}

function lfFitArtboard(index) {
  return LogoForge.fitArtboard(index);
}

function lfInspectDocument(index) {
  return LogoForge.inspectDocument(index);
}

function lfCreatePackage(width, height, colorMode) {
  return LogoForge.createPackageDocument(width, height, colorMode);
}

function lfPlaceComponent(path, scheme, hex, threshold, map, left, top, w, h) {
  return LogoForge.placeComponentAt(path, scheme, hex, threshold, map, left, top, w, h);
}

function lfAddLabel(text, left, top, size) {
  return LogoForge.addLabelAt(text, left, top, size);
}

function lfFinishPackage() {
  return LogoForge.finishPackageDocument();
}

function lfAbortPackage() {
  return LogoForge.abortPackageDocument();
}

function lfSetComponent(componentId) {
  return LogoForge.setComponent(componentId);
}
function lfOpenComponent(path) {
  return LogoForge.openComponent(path);
}
function lfSetColorMode(mode) {
  return LogoForge.setDocumentColorMode(mode);
}
function lfRemoveComponentFile(path) {
  return LogoForge.removeComponentFile(path);
}
function lfSetPadding(index, top, right, bottom, left) {
  return LogoForge.setArtboardPadding(index, top, right, bottom, left);
}
function lfExportPNG(index, path, width, resolution) {
  return LogoForge.exportArtboardAsPNG(index, path, width, resolution);
}
function lfExportJPEG(index, path, width, resolution) {
  return LogoForge.exportArtboardAsJPEG(index, path, width, resolution);
}
function lfExportSVG(index, path) {
  return LogoForge.exportArtboardAsSVG(index, path);
}
function lfExportPDF(index, path) {
  return LogoForge.exportArtboardAsPDF(index, path);
}
function lfExportEPS(index, path) {
  return LogoForge.exportArtboardAsEPS(index, path);
}
function lfExportAI(path) {
  return LogoForge.exportAsAI(path);
}
