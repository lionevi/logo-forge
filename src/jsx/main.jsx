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
  'use strict'

  /** Sépare le statut de la charge utile. */
  var SEP = '|'

  /**
   * Sépare les champs d'une charge utile composite.
   * 0x1F (« unit separator ») ne peut pas apparaître dans un nom de fichier.
   */
  var UNIT = String.fromCharCode(31)

  /** Marque un succès, avec sa charge utile éventuelle. */
  function ok(payload) {
    return 'OK' + SEP + (payload === undefined ? '' : String(payload))
  }

  /** Marque un échec, avec un message lisible. */
  function err(message) {
    return 'ERR' + SEP + String(message)
  }

  /** Décrit une exception ExtendScript de façon exploitable. */
  function describe(e) {
    var text = e && e.message ? e.message : String(e)
    if (e && e.line) text += ' (ligne ' + e.line + ')'
    return text
  }

  /* ---------------------------------------------------------------------- *
   * Document
   * ---------------------------------------------------------------------- */

  /** Renvoie le nom du document actif, ou une chaîne vide. */
  function getDocumentName() {
    try {
      if (app.documents.length === 0) return ok('')
      return ok(app.activeDocument.name)
    } catch (e) {
      return err(describe(e))
    }
  }

  /**
   * Renvoie les informations du document actif.
   * Charge utile : nom, chemin, largeur, hauteur, nombre de plans de travail.
   */
  function getDocumentInfo() {
    try {
      if (app.documents.length === 0) return ok('')

      var doc = app.activeDocument
      var path = ''
      try {
        // `fullName` lève sur un document jamais enregistré.
        path = doc.fullName.fsName
      } catch (unsaved) {
        path = ''
      }

      var rect = doc.artboards[0].artboardRect
      var width = Math.abs(rect[2] - rect[0])
      var height = Math.abs(rect[1] - rect[3])

      return ok(
        [doc.name, path, width, height, doc.artboards.length].join(UNIT)
      )
    } catch (e) {
      return err(describe(e))
    }
  }

  /** Renvoie les noms des plans de travail. */
  function getArtboardNames() {
    try {
      if (app.documents.length === 0) return ok('')
      var doc = app.activeDocument
      var names = []
      for (var i = 0; i < doc.artboards.length; i += 1) {
        names.push(doc.artboards[i].name)
      }
      return ok(names.join(UNIT))
    } catch (e) {
      return err(describe(e))
    }
  }

  /* ---------------------------------------------------------------------- *
   * Système de fichiers
   * ---------------------------------------------------------------------- */

  /** Crée un dossier et tous ses parents. Idempotent. */
  function createFolder(path) {
    try {
      var folder = new Folder(path)
      if (folder.exists) return ok('exists')
      if (!folder.create()) return err('creation refusee : ' + path)
      return ok('created')
    } catch (e) {
      return err(describe(e))
    }
  }

  /** Indique si un chemin existe, fichier ou dossier. */
  function pathExists(path) {
    try {
      return ok(new File(path).exists || new Folder(path).exists ? '1' : '0')
    } catch (e) {
      return err(describe(e))
    }
  }

  /** Écrit un fichier texte en UTF-8. */
  function writeTextFile(path, contents) {
    try {
      var file = new File(path)
      file.encoding = 'UTF-8'
      if (!file.open('w')) return err('ouverture en ecriture refusee : ' + path)
      file.write(contents)
      file.close()
      return ok(path)
    } catch (e) {
      return err(describe(e))
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
  var session = null

  /**
   * Ouvre une copie de travail du document actif.
   *
   * Le document doit avoir été enregistré au moins une fois : la copie se fait
   * au niveau du fichier, seul moyen d'obtenir un duplicata qui conserve les
   * plans de travail.
   */
  function beginSession() {
    try {
      if (session) return err('une session est deja ouverte')
      if (app.documents.length === 0) return err('aucun document ouvert')

      var source = app.activeDocument
      var sourceFile
      try {
        sourceFile = source.fullName
      } catch (unsaved) {
        return err(
          'enregistrez le document avant d exporter : Logo Forge travaille ' +
            'sur une copie du fichier'
        )
      }
      if (!sourceFile || !sourceFile.exists) {
        return err('fichier source introuvable sur le disque')
      }

      var stamp = new Date().getTime()
      var temp = new File(Folder.temp.fsName + '/logo-forge-' + stamp + '.ai')
      if (!sourceFile.copy(temp)) return err('copie temporaire impossible')

      var working = app.open(temp)
      session = { document: working, file: temp }
      return ok(temp.fsName)
    } catch (e) {
      session = null
      return err(describe(e))
    }
  }

  /** Referme la copie de travail et supprime le fichier temporaire. */
  function endSession() {
    try {
      if (!session) return ok('idle')
      try {
        session.document.close(SaveOptions.DONOTSAVECHANGES)
      } catch (closeError) {
        // Un document déjà refermé n'est pas une erreur exploitable.
      }
      try {
        session.file.remove()
      } catch (removeError) {
        // Un temporaire résiduel est gênant, jamais fatal.
      }
      session = null
      return ok('closed')
    } catch (e) {
      session = null
      return err(describe(e))
    }
  }

  /**
   * Rétablit la copie de travail dans son état d'origine.
   * Appelé entre deux déclinaisons, le recolorage étant destructeur.
   */
  function resetSession() {
    try {
      if (!session) return err('aucune session ouverte')
      var file = session.file
      try {
        session.document.close(SaveOptions.DONOTSAVECHANGES)
      } catch (closeError) {
        /* déjà refermé */
      }
      session.document = app.open(file)
      return ok('reset')
    } catch (e) {
      return err(describe(e))
    }
  }

  /** Document sur lequel travailler : la copie si une session est ouverte. */
  function workingDocument() {
    if (session) return session.document
    if (app.documents.length === 0) return null
    return app.activeDocument
  }

  /* ---------------------------------------------------------------------- *
   * Déclinaisons chromatiques
   * ---------------------------------------------------------------------- */

  /** Construit un noir de renfort, CMJN 0/0/0/100. */
  function blackColor() {
    var color = new CMYKColor()
    color.cyan = 0
    color.magenta = 0
    color.yellow = 0
    color.black = 100
    return color
  }

  /** Construit un blanc pur. */
  function whiteColor() {
    var color = new CMYKColor()
    color.cyan = 0
    color.magenta = 0
    color.yellow = 0
    color.black = 0
    return color
  }

  /** Construit un gris, `level` de 0 (blanc) à 100 (noir). */
  function grayColor(level) {
    var color = new GrayColor()
    color.gray = Math.max(0, Math.min(100, level))
    return color
  }

  /** Construit une couleur RVB. */
  function rgbColor(r, g, b) {
    var color = new RGBColor()
    color.red = Math.max(0, Math.min(255, r))
    color.green = Math.max(0, Math.min(255, g))
    color.blue = Math.max(0, Math.min(255, b))
    return color
  }

  /**
   * Traduit une couleur Illustrator en triplet RVB.
   * @returns un tableau [r, g, b], ou `null` pour un dégradé ou un motif.
   */
  function toRgb(color) {
    if (!color) return null
    try {
      if (color.typename === 'RGBColor') {
        return [color.red, color.green, color.blue]
      }
      if (color.typename === 'CMYKColor') {
        var c = color.cyan / 100
        var m = color.magenta / 100
        var y = color.yellow / 100
        var k = color.black / 100
        return [
          Math.round(255 * (1 - c) * (1 - k)),
          Math.round(255 * (1 - m) * (1 - k)),
          Math.round(255 * (1 - y) * (1 - k)),
        ]
      }
      if (color.typename === 'GrayColor') {
        var level = Math.round(255 * (1 - color.gray / 100))
        return [level, level, level]
      }
      if (color.typename === 'SpotColor' && color.spot) {
        return toRgb(color.spot.color)
      }
    } catch (e) {
      return null
    }
    return null
  }

  /**
   * Calcule la couleur de remplacement d'un élément.
   * @returns `null` quand l'élément doit rester tel quel.
   */
  function schemeColor(scheme, current, custom) {
    if (scheme === 'fullColor') return null
    if (scheme === 'black') return blackColor()
    if (scheme === 'white') return whiteColor()
    if (scheme === 'custom') return rgbColor(custom[0], custom[1], custom[2])

    var rgb = toRgb(current)
    // Dégradés et motifs : on ne sait pas les convertir sans les dénaturer.
    if (!rgb) return null

    if (scheme === 'grayscale') {
      var luminance = Math.round(
        0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2]
      )
      return grayColor(((255 - luminance) / 255) * 100)
    }
    if (scheme === 'inverted') {
      return rgbColor(255 - rgb[0], 255 - rgb[1], 255 - rgb[2])
    }
    return null
  }

  /** Applique une couleur aux tracés d'un document. */
  function recolorPaths(doc, scheme, custom) {
    var items = doc.pathItems
    for (var i = 0; i < items.length; i += 1) {
      var item = items[i]
      try {
        if (item.filled) {
          var fill = schemeColor(scheme, item.fillColor, custom)
          if (fill) item.fillColor = fill
        }
        if (item.stroked) {
          var stroke = schemeColor(scheme, item.strokeColor, custom)
          if (stroke) item.strokeColor = stroke
        }
      } catch (itemError) {
        // Un élément verrouillé ou dans un calque masqué : on poursuit.
      }
    }
  }

  /** Applique une couleur aux blocs de texte d'un document. */
  function recolorText(doc, scheme, custom) {
    var frames = doc.textFrames
    for (var i = 0; i < frames.length; i += 1) {
      try {
        var attributes = frames[i].textRange.characterAttributes
        var fill = schemeColor(scheme, attributes.fillColor, custom)
        if (fill) attributes.fillColor = fill
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
   */
  function applyColorScheme(scheme, hex) {
    try {
      var doc = workingDocument()
      if (!doc) return err('aucun document de travail')
      if (scheme === 'fullColor') return ok('unchanged')

      var custom = [0, 0, 0]
      if (scheme === 'custom') {
        if (!hex || String(hex).length < 7) {
          return err('couleur personnalisee manquante')
        }
        var clean = String(hex).replace('#', '')
        custom = [
          parseInt(clean.substring(0, 2), 16),
          parseInt(clean.substring(2, 4), 16),
          parseInt(clean.substring(4, 6), 16),
        ]
      }

      // Les éléments verrouillés ou masqués refusent toute modification :
      // on lève ces protections sur la copie, jamais sur l'original.
      try {
        for (var l = 0; l < doc.layers.length; l += 1) {
          doc.layers[l].locked = false
          doc.layers[l].visible = true
        }
      } catch (layerError) {
        /* certaines versions refusent : on tente quand même le recolorage */
      }

      recolorPaths(doc, scheme, custom)
      recolorText(doc, scheme, custom)
      return ok(scheme)
    } catch (e) {
      return err(describe(e))
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
      var doc = workingDocument()
      if (!doc) return err('aucun document de travail')

      var index = parseInt(artboardIndex, 10)
      if (index < 0 || index >= doc.artboards.length) {
        return err('plan de travail ' + (index + 1) + ' inexistant')
      }

      var t = parseFloat(top) || 0
      var r = parseFloat(right) || 0
      var b = parseFloat(bottom) || 0
      var l = parseFloat(left) || 0
      if (!t && !r && !b && !l) return ok('unchanged')

      var board = doc.artboards[index]
      var rect = board.artboardRect
      board.artboardRect = [rect[0] - l, rect[1] + t, rect[2] + r, rect[3] - b]
      return ok('padded')
    } catch (e) {
      return err(describe(e))
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
      )
    }
    doc.artboards.setActiveArtboardIndex(index)
  }

  /**
   * Exécute une exportation dans un dossier temporaire, puis déplace l'unique
   * fichier produit vers `targetPath`.
   *
   * Illustrator suffixe le nom des fichiers quand `saveMultipleArtboards` est
   * actif, et ce suffixe varie selon la version. Passer par un dossier vide
   * rend le nom final déterministe.
   */
  function exportThenRename(targetPath, extension, writer) {
    var target = new File(targetPath)
    var stage = new Folder(
      Folder.temp.fsName + '/logo-forge-stage-' + new Date().getTime()
    )
    if (!stage.exists && !stage.create()) {
      throw new Error('dossier temporaire impossible a creer')
    }

    try {
      var base = new File(stage.fsName + '/out.' + extension)
      writer(base)

      var produced = stage.getFiles('*.' + extension)
      if (!produced || produced.length === 0) {
        throw new Error('Illustrator n a produit aucun fichier ' + extension)
      }

      if (target.exists) target.remove()
      if (!produced[0].copy(target.fsName)) {
        throw new Error('copie vers ' + targetPath + ' impossible')
      }
      return target.fsName
    } finally {
      try {
        var leftovers = stage.getFiles()
        for (var i = 0; i < leftovers.length; i += 1) leftovers[i].remove()
        stage.remove()
      } catch (cleanupError) {
        /* un temporaire résiduel n'est jamais fatal */
      }
    }
  }

  /**
   * Exporte un plan de travail en PNG.
   *
   * Illustrator raisonne en pourcentage d'échelle, 100 % valant 72 ppp. La
   * largeur voulue est donc traduite en échelle depuis celle du plan.
   */
  function exportArtboardAsPNG(artboardIndex, outputPath, width, resolution) {
    try {
      var doc = workingDocument()
      if (!doc) return err('aucun document de travail')

      var index = parseInt(artboardIndex, 10)
      selectArtboard(doc, index)

      var rect = doc.artboards[index].artboardRect
      var artboardWidth = Math.abs(rect[2] - rect[0])
      if (!artboardWidth) return err('plan de travail de largeur nulle')

      var targetWidth = parseFloat(width)
      var scale
      if (targetWidth > 0) {
        scale = (targetWidth / artboardWidth) * 100
      } else {
        scale = (parseFloat(resolution) / 72) * 100
      }
      if (!isFinite(scale) || scale <= 0) return err('echelle invalide')
      // Illustrator refuse au-delà de 776,19 % dans certaines versions.
      if (scale > 7761) scale = 7761

      var options = new ExportOptionsPNG24()
      options.antiAliasing = true
      options.transparency = true
      options.artBoardClipping = true
      options.horizontalScale = scale
      options.verticalScale = scale

      var file = new File(outputPath)
      doc.exportFile(file, ExportType.PNG24, options)
      if (!file.exists) return err('PNG non produit : ' + outputPath)
      return ok(outputPath)
    } catch (e) {
      return err(describe(e))
    }
  }

  /** Exporte un plan de travail en SVG. */
  function exportArtboardAsSVG(artboardIndex, outputPath) {
    try {
      var doc = workingDocument()
      if (!doc) return err('aucun document de travail')

      var index = parseInt(artboardIndex, 10)
      selectArtboard(doc, index)

      var written = exportThenRename(outputPath, 'svg', function (stageFile) {
        var options = new ExportOptionsSVG()
        options.embedRasterImages = true
        options.preserveEditability = false
        // Les polices sont vectorisées : le logo doit s'afficher à l'identique
        // sans que la police soit installée chez le destinataire.
        options.fontType = SVGFontType.OUTLINEFONT
        options.coordinatePrecision = 4
        options.saveMultipleArtboards = true
        options.artboardRange = String(index + 1)
        doc.exportFile(stageFile, ExportType.SVG, options)
      })
      return ok(written)
    } catch (e) {
      return err(describe(e))
    }
  }

  /** Écrit un plan de travail en PDF. */
  function exportArtboardAsPDF(artboardIndex, outputPath) {
    try {
      var doc = workingDocument()
      if (!doc) return err('aucun document de travail')

      var index = parseInt(artboardIndex, 10)
      selectArtboard(doc, index)

      var written = exportThenRename(outputPath, 'pdf', function (stageFile) {
        var options = new PDFSaveOptions()
        options.preserveEditability = true
        options.viewAfterSaving = false
        options.saveMultipleArtboards = true
        options.artboardRange = String(index + 1)
        doc.saveAs(stageFile, options)
      })
      return ok(written)
    } catch (e) {
      return err(describe(e))
    }
  }

  /** Écrit un plan de travail en EPS. */
  function exportArtboardAsEPS(artboardIndex, outputPath) {
    try {
      var doc = workingDocument()
      if (!doc) return err('aucun document de travail')

      var index = parseInt(artboardIndex, 10)
      selectArtboard(doc, index)

      var written = exportThenRename(outputPath, 'eps', function (stageFile) {
        var options = new EPSSaveOptions()
        options.embedAllFonts = true
        options.includeDocumentThumbnails = true
        options.saveMultipleArtboards = true
        options.artboardRange = String(index + 1)
        doc.saveAs(stageFile, options)
      })
      return ok(written)
    } catch (e) {
      return err(describe(e))
    }
  }

  /** Écrit le document de travail au format natif Illustrator. */
  function exportAsAI(outputPath) {
    try {
      var doc = workingDocument()
      if (!doc) return err('aucun document de travail')

      var written = exportThenRename(outputPath, 'ai', function (stageFile) {
        var options = new IllustratorSaveOptions()
        options.pdfCompatible = true
        doc.saveAs(stageFile, options)
      })
      return ok(written)
    } catch (e) {
      return err(describe(e))
    }
  }

  return {
    getDocumentName: getDocumentName,
    getDocumentInfo: getDocumentInfo,
    getArtboardNames: getArtboardNames,
    createFolder: createFolder,
    pathExists: pathExists,
    writeTextFile: writeTextFile,
    beginSession: beginSession,
    endSession: endSession,
    resetSession: resetSession,
    applyColorScheme: applyColorScheme,
    setArtboardPadding: setArtboardPadding,
    exportArtboardAsPNG: exportArtboardAsPNG,
    exportArtboardAsSVG: exportArtboardAsSVG,
    exportArtboardAsPDF: exportArtboardAsPDF,
    exportArtboardAsEPS: exportArtboardAsEPS,
    exportAsAI: exportAsAI,
  }
})()

/*
 * Fonctions globales.
 *
 * evalScript() évalue une expression : c'est par ces noms globaux que le
 * panneau appelle la couche ExtendScript.
 */

function lfPing() {
  return 'OK|logo-forge'
}
function lfGetDocumentName() {
  return LogoForge.getDocumentName()
}
function lfGetDocumentInfo() {
  return LogoForge.getDocumentInfo()
}
function lfGetArtboardNames() {
  return LogoForge.getArtboardNames()
}
function lfCreateFolder(path) {
  return LogoForge.createFolder(path)
}
function lfPathExists(path) {
  return LogoForge.pathExists(path)
}
function lfWriteTextFile(path, contents) {
  return LogoForge.writeTextFile(path, contents)
}
function lfBeginSession() {
  return LogoForge.beginSession()
}
function lfEndSession() {
  return LogoForge.endSession()
}
function lfResetSession() {
  return LogoForge.resetSession()
}
function lfApplyColorScheme(scheme, hex) {
  return LogoForge.applyColorScheme(scheme, hex)
}
function lfSetPadding(index, top, right, bottom, left) {
  return LogoForge.setArtboardPadding(index, top, right, bottom, left)
}
function lfExportPNG(index, path, width, resolution) {
  return LogoForge.exportArtboardAsPNG(index, path, width, resolution)
}
function lfExportSVG(index, path) {
  return LogoForge.exportArtboardAsSVG(index, path)
}
function lfExportPDF(index, path) {
  return LogoForge.exportArtboardAsPDF(index, path)
}
function lfExportEPS(index, path) {
  return LogoForge.exportArtboardAsEPS(index, path)
}
function lfExportAI(path) {
  return LogoForge.exportAsAI(path)
}
