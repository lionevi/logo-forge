/*
 * Logo Forge — moteur d'export, couche panneau.
 *
 * Orchestre la couche ExtendScript depuis le Chromium de CEP : calcule le plan
 * du pack, crée l'arborescence, enchaîne les exportations et produit le rapport.
 *
 * Contraintes tenues dans tout ce fichier :
 *   - ES5 strict, pour le Chromium figé de CEP ;
 *   - evalScript est asynchrone : tout s'enchaîne par callbacks, jamais par
 *     boucle synchrone ;
 *   - un seul export à la fois, un seul fichier à la fois — Illustrator ne
 *     supporte pas les appels concurrents ;
 *   - l'échec d'un fichier est consigné et n'interrompt jamais le lot.
 */

var LogoForgeEngine = (function () {
  'use strict'

  /** Sépare le statut de la charge utile dans les réponses ExtendScript. */
  var SEP = '|'

  /**
   * Sépare les champs d'une charge utile composite.
   * 0x1F ne peut pas apparaître dans un nom de fichier.
   */
  var UNIT = String.fromCharCode(31)

  /**
   * Racines du pack.
   *
   * L'export se fait en deux passes, parce que le mode colorimétrique d'un
   * document est global : basculer entre CMJN et RVB à chaque fichier serait
   * lent et instable. Chaque passe a donc sa racine.
   */
  var FOLDERS = {
    print: 'Pour_Impression',
    web: 'Pour_Web',
    report: 'Rapport',
  }

  /** Formats de la passe print, produits en CMJN à 300 ppp. */
  var PRINT_FORMATS = ['ai', 'pdf', 'eps', 'jpeg']

  /** Formats de la passe web, produits en RVB à 72 ppp. */
  var WEB_FORMATS = ['svg', 'png', 'jpeg', 'ai']

  /** Résolution des fichiers de la passe print. */
  var PRINT_RESOLUTION = 300

  /** Tailles de favicon attendues par les navigateurs et les plateformes. */
  var FAVICON_SIZES = [16, 32, 128, 180, 192]

  /* ---------------------------------------------------------------------- *
   * Pont ExtendScript
   * ---------------------------------------------------------------------- */

  /** Échappe une valeur pour l'insérer dans une expression ExtendScript. */
  function quote(value) {
    var text = value === undefined || value === null ? '' : String(value)
    text = text.replace(/\\/g, '\\\\')
    text = text.replace(/"/g, '\\"')
    text = text.replace(/[\r]/g, '\\r')
    text = text.replace(/[\n]/g, '\\n')
    return '"' + text + '"'
  }

  /** Évalue une expression ExtendScript et remet sa réponse au callback. */
  function evalScript(expression, callback) {
    try {
      if (typeof window !== 'undefined' && window.__adobe_cep__) {
        window.__adobe_cep__.evalScript(expression, callback)
        return
      }
      if (typeof CSInterface !== 'undefined') {
        new CSInterface().evalScript(expression, callback)
        return
      }
      callback('ERR' + SEP + 'aucun pont ExtendScript disponible')
    } catch (error) {
      callback('ERR' + SEP + (error && error.message ? error.message : error))
    }
  }

  /**
   * Appelle une fonction ExtendScript.
   * @param callback reçoit `{ok: boolean, value: string}`.
   */
  function call(fn, args, callback) {
    var parts = []
    for (var i = 0; i < args.length; i += 1) parts.push(quote(args[i]))
    var expression = fn + '(' + parts.join(',') + ')'

    evalScript(expression, function (raw) {
      var text = raw === undefined || raw === null ? '' : String(raw)

      // Une erreur du moteur ExtendScript remonte sous cette forme littérale.
      if (text === 'EvalScript error.') {
        callback({ ok: false, value: 'ExtendScript a refuse ' + fn })
        return
      }

      var cut = text.indexOf(SEP)
      if (cut === -1) {
        callback({
          ok: false,
          value: 'reponse illisible de ' + fn + ' : ' + text,
        })
        return
      }

      callback({
        ok: text.substring(0, cut) === 'OK',
        value: text.substring(cut + 1),
      })
    })
  }

  /* ---------------------------------------------------------------------- *
   * Lecture du document
   * ---------------------------------------------------------------------- */

  /**
   * Lit le document actif.
   * @param callback reçoit `{name, path, width, height, artboardCount}` ou `null`.
   */
  function readDocumentInfo(callback) {
    call('lfGetDocumentInfo', [], function (result) {
      if (!result.ok || !result.value) {
        callback(null)
        return
      }
      var fields = result.value.split(UNIT)
      if (!fields[0]) {
        callback(null)
        return
      }
      callback({
        name: fields[0],
        path: fields[1] || '',
        width: parseFloat(fields[2]) || 0,
        height: parseFloat(fields[3]) || 0,
        artboardCount: parseInt(fields[4], 10) || 1,
      })
    })
  }

  /** Lit les noms des plans de travail. */
  function readArtboardNames(callback) {
    call('lfGetArtboardNames', [], function (result) {
      callback(result.ok && result.value ? result.value.split(UNIT) : [])
    })
  }

  /* ---------------------------------------------------------------------- *
   * Nommage et arborescence
   * ---------------------------------------------------------------------- */

  /** Caractères interdits dans un nom de fichier, sous Windows comme macOS. */
  var ILLEGAL = /[<>:"\/\\|?*]/g

  /** Rend un segment sûr pour un système de fichiers. */
  function sanitize(text) {
    return String(text)
      .replace(ILLEGAL, '')
      .replace(/^\s+/, '')
      .replace(/[\s.]+$/, '')
  }

  /** Met un libellé en PascalCase, sans accent ni espace. */
  function pascal(text) {
    var clean = sanitize(text)
      .replace(/[àâäá]/gi, 'a')
      .replace(/[éèêë]/gi, 'e')
      .replace(/[îïí]/gi, 'i')
      .replace(/[ôöó]/gi, 'o')
      .replace(/[ûüú]/gi, 'u')
      .replace(/[ç]/gi, 'c')
    var words = clean.split(/[\s._-]+/)
    var out = ''
    for (var i = 0; i < words.length; i += 1) {
      var word = words[i].replace(/[^a-zA-Z0-9]/g, '')
      if (!word) continue
      out += word.charAt(0).toUpperCase() + word.substring(1)
    }
    return out || 'Logo'
  }

  /** Assemble un chemin relatif interne au pack, toujours en `/`. */
  function joinFolder(parts) {
    var kept = []
    for (var i = 0; i < parts.length; i += 1) {
      if (parts[i]) kept.push(String(parts[i]))
    }
    return kept.join('/')
  }

  /** Assemble un chemin natif, en déduisant le séparateur de la racine. */
  function joinPath(root, rest) {
    var sep = String(root).indexOf('\\') !== -1 ? '\\' : '/'
    var base = String(root).replace(/[\\\/]+$/, '')
    var tail = []
    for (var i = 0; i < rest.length; i += 1) {
      if (rest[i] !== undefined && rest[i] !== null && rest[i] !== '') {
        tail.push(String(rest[i]))
      }
    }
    return tail.length === 0 ? base : base + sep + tail.join(sep)
  }

  /** Libellés lisibles des déclinaisons, pour les noms de fichiers. */
  var SCHEME_LABEL = {
    fullColor: 'FullColor',
    black: 'Black',
    white: 'White',
    inverted: 'Inverted',
    grayscale: 'Grayscale',
  }

  /**
   * Libellés lisibles, distincts des noms de dossiers.
   *
   * Un chemin ne doit pas contenir d'espace ; une planche de revue, elle, se
   * lit à l'œil : « Full Color », pas « FullColor ».
   */
  var SCHEME_TITLE = {
    fullColor: 'Full Color',
    black: 'Black',
    white: 'White',
    inverted: 'Inverted',
    grayscale: 'Grayscale',
  }

  /** Libellé d'une déclinaison, personnalisée comprise. */
  function schemeLabel(scheme) {
    if (scheme.id === 'custom') return pascal(scheme.name)
    return SCHEME_LABEL[scheme.id] || pascal(scheme.id)
  }

  /** Nom d'une déclinaison tel qu'il s'affiche, espaces compris. */
  function schemeTitle(scheme) {
    if (scheme.id === 'custom') return scheme.name || 'Custom'
    return SCHEME_TITLE[scheme.id] || scheme.id
  }

  /**
   * Compose le nom d'un fichier.
   * `separator` vaut `-`, `_` ou une espace.
   */
  function buildFileName(parts, separator, extension) {
    var kept = []
    for (var i = 0; i < parts.length; i += 1) {
      if (parts[i] !== undefined && parts[i] !== null && parts[i] !== '') {
        kept.push(String(parts[i]))
      }
    }
    return sanitize(kept.join(separator)) + '.' + extension
  }

  /* ---------------------------------------------------------------------- *
   * Plan du pack
   * ---------------------------------------------------------------------- */

  /**
   * Compose le nom d'un fichier de livraison.
   *
   * Convention : `{Client}_{Composant}_{Couleur}_{Taille}.{ext}`. La taille
   * n'apparaît que pour les formats matriciels, où elle distingue seule deux
   * fichiers par ailleurs identiques.
   */
  function deliveryName(clientName, component, scheme, size, extension, separator) {
    return buildFileName(
      [
        pascal(clientName),
        pascal(component.name),
        schemeLabel(scheme),
        size ? size + 'px' : '',
      ],
      separator || '_',
      extension
    )
  }

  /**
   * Calcule la liste des fichiers à produire.
   *
   * Le plan est établi avant toute écriture : il donne le total exact pour la
   * barre de progression, et permet d'afficher le pack avant de le lancer.
   *
   * Les tâches sortent groupées par passe, puis par composant, puis par
   * couleur. Cet ordre n'est pas cosmétique : il minimise les opérations
   * coûteuses — une bascule de mode colorimétrique par passe, une ouverture de
   * document par composant, une recoloration par couleur.
   *
   * @returns un tableau de tâches
   *   `{pass, kind, scheme, component, format, folder, fileName, width, resolution}`.
   */
  function planExport(config) {
    var tasks = []
    var separator = config.separator || '_'
    var passes = []

    if (config.passes && config.passes.print !== false) passes.push('print')
    if (config.passes && config.passes.web !== false) passes.push('web')
    if (passes.length === 0) passes = ['print', 'web']

    function scalesFor(pass) {
      var list = []
      for (var i = 0; i < config.scales.length; i += 1) {
        if (config.scales[i].type === pass) list.push(config.scales[i])
      }
      // Une passe sans échelle déclarée garde sa résolution de référence.
      if (list.length === 0) {
        list.push({
          type: pass,
          width: 0,
          resolution: pass === 'print' ? PRINT_RESOLUTION : 72,
        })
      }
      return list
    }

    function formatsFor(pass) {
      var allowed = pass === 'print' ? PRINT_FORMATS : WEB_FORMATS
      var chosen = config.formats[pass] || {}
      var list = []
      for (var i = 0; i < allowed.length; i += 1) {
        if (chosen[allowed[i]]) list.push(allowed[i])
      }
      return list
    }

    for (var p = 0; p < passes.length; p += 1) {
      var pass = passes[p]
      var formats = formatsFor(pass)
      var scales = scalesFor(pass)
      if (formats.length === 0) continue

      for (var c = 0; c < config.components.length; c += 1) {
        var component = config.components[c]
        if (!component.path) continue

        for (var s = 0; s < config.colorSchemes.length; s += 1) {
          var scheme = config.colorSchemes[s]
          var folder = joinFolder([
            FOLDERS[pass],
            pascal(component.name),
            schemeLabel(scheme),
          ])

          for (var f = 0; f < formats.length; f += 1) {
            var format = formats[f]

            // Le fichier source natif n'a de sens qu'en pleine couleur : un .ai
            // recoloré ne serait plus une source.
            if (format === 'ai' && scheme.id !== 'fullColor') continue

            if (format === 'png' || format === 'jpeg') {
              for (var k = 0; k < scales.length; k += 1) {
                tasks.push({
                  pass: pass,
                  kind: format,
                  scheme: scheme,
                  component: component,
                  format: format === 'jpeg' ? 'jpg' : format,
                  folder: folder,
                  fileName: deliveryName(
                    config.clientName,
                    component,
                    scheme,
                    scales[k].width,
                    format === 'jpeg' ? 'jpg' : format,
                    separator
                  ),
                  width: scales[k].width,
                  resolution: scales[k].resolution,
                })
              }
              continue
            }

            tasks.push({
              pass: pass,
              kind: format,
              scheme: scheme,
              component: component,
              format: format,
              folder: folder,
              fileName: deliveryName(
                config.clientName,
                component,
                scheme,
                0,
                format,
                separator
              ),
              resolution: pass === 'print' ? PRINT_RESOLUTION : 72,
            })
          }
        }
      }
    }

    // Favicons : le premier composant, première couleur, aux tailles attendues
    // par les navigateurs. Ils vivent dans la passe web.
    if (config.favicon && config.components.length > 0 && passes.indexOf('web') !== -1) {
      var first = config.components[0]
      if (first.path) {
        for (var v = 0; v < FAVICON_SIZES.length; v += 1) {
          tasks.push({
            pass: 'web',
            kind: 'png',
            scheme: config.colorSchemes[0],
            component: first,
            format: 'png',
            folder: joinFolder([FOLDERS.web, 'Favicon']),
            fileName:
              'favicon' + separator + FAVICON_SIZES[v] + 'px.png',
            width: FAVICON_SIZES[v],
            resolution: 72,
          })
        }
      }
    }

    return tasks
  }

  /** Dossiers distincts d'un plan, parents d'abord. */
  function planDirectories(tasks) {
    var seen = {}
    var list = []
    for (var i = 0; i < tasks.length; i += 1) {
      var parts = tasks[i].folder.split('/')
      var walked = ''
      for (var j = 0; j < parts.length; j += 1) {
        walked = walked ? walked + '/' + parts[j] : parts[j]
        if (!seen[walked]) {
          seen[walked] = true
          list.push(walked)
        }
      }
    }
    if (!seen[FOLDERS.report]) list.push(FOLDERS.report)
    return list
  }

  /* ---------------------------------------------------------------------- *
   * Rapport HTML
   * ---------------------------------------------------------------------- */

  /** Échappe du texte destiné à du HTML. */
  function escapeHtml(text) {
    return String(text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
  }

  /** Met en forme une durée. */
  function formatDuration(ms) {
    var seconds = ms / 1000
    if (seconds < 60) return seconds.toFixed(1) + ' s'
    var minutes = Math.floor(seconds / 60)
    return minutes + ' min ' + Math.round(seconds - minutes * 60) + ' s'
  }

  /** Une ligne du tableau du rapport. */
  function reportRow(state, className, component, scheme, format, detail) {
    return (
      '<tr><td class="' +
      className +
      '">' +
      state +
      '</td><td>' +
      escapeHtml(component) +
      '</td><td>' +
      escapeHtml(scheme) +
      '</td><td><span class="tag">' +
      escapeHtml(String(format).toUpperCase()) +
      '</span></td><td class="path">' +
      escapeHtml(detail) +
      '</td></tr>'
    )
  }

  /**
   * Compose le rapport d'export.
   *
   * Le rapport est autonome : il accompagne le pack chez le client, et doit
   * rester lisible sans réseau ni feuille de style externe.
   */
  function buildReport(config, result) {
    var rows = ''
    var i

    for (i = 0; i < result.written.length; i += 1) {
      var task = result.written[i]
      rows += reportRow(
        'OK',
        'ok',
        task.component.name,
        schemeLabel(task.scheme),
        task.format,
        task.folder + '/' + task.fileName
      )
    }

    for (i = 0; i < result.failures.length; i += 1) {
      var failure = result.failures[i]
      rows += reportRow(
        'Echec',
        'ko',
        failure.task.component.name,
        schemeLabel(failure.task.scheme),
        failure.task.format,
        failure.message
      )
    }

    var style = [
      'body{margin:0;padding:32px;background:#252525;color:#e3e3e3;',
      "font-family:'Adobe Clean',system-ui,-apple-system,sans-serif;font-size:13px}",
      'h1{margin:0 0 4px;font-size:22px;color:#fff}',
      '.sub{margin:0 0 24px;color:#909090;font-size:12px}',
      '.stats{margin:0 0 24px;padding:0;list-style:none;overflow:hidden}',
      '.stats li{float:left;margin-right:32px}',
      '.stats .n{display:block;font-size:24px;font-weight:700;color:#fff}',
      '.stats .l{display:block;font-size:11px;color:#909090;',
      'text-transform:uppercase;letter-spacing:.06em}',
      'table{width:100%;border-collapse:collapse;clear:both}',
      'th{padding:8px;border-bottom:1px solid #4a4a4a;color:#909090;',
      'font-size:11px;text-transform:uppercase;letter-spacing:.06em;text-align:left}',
      'td{padding:7px 8px;border-bottom:1px solid #3e3e3e;vertical-align:top}',
      'tr:hover td{background:#2f2f2f}',
      '.ok{color:#2d9d78;font-weight:700}',
      '.ko{color:#e34850;font-weight:700}',
      '.tag{padding:2px 6px;border-radius:3px;background:#3e3e3e;',
      'font-size:10px;font-weight:700}',
      ".path{color:#909090;font-family:'Source Code Pro',monospace;font-size:11px}",
      'footer{margin-top:24px;color:#6e6e6e;font-size:11px}',
    ].join('')

    var stat = function (value, label) {
      return (
        '<li><span class="n">' +
        escapeHtml(value) +
        '</span><span class="l">' +
        escapeHtml(label) +
        '</span></li>'
      )
    }

    return [
      '<!DOCTYPE html>',
      '<html lang="fr"><head><meta charset="UTF-8">',
      '<title>Package logo - ' + escapeHtml(config.clientName) + '</title>',
      '<style>' + style + '</style></head><body>',
      '<h1>Package logo - ' + escapeHtml(config.clientName) + '</h1>',
      '<p class="sub">Genere par Logo Forge le ' +
        escapeHtml(new Date().toLocaleString()) +
        ' - document source ' +
        escapeHtml(result.documentName || '-') +
        '</p>',
      '<ul class="stats">',
      stat(result.written.length, 'fichiers'),
      stat(config.components.length, 'composants'),
      stat(config.colorSchemes.length, 'declinaisons'),
      stat(result.failures.length, 'echecs'),
      stat(formatDuration(result.durationMs), 'duree'),
      '</ul>',
      '<table><thead><tr><th>Etat</th><th>Composant</th><th>Declinaison</th>',
      '<th>Format</th><th>Chemin</th></tr></thead><tbody>',
      rows,
      '</tbody></table>',
      '<footer>Logo Forge - rapport autonome, conservable avec le pack.</footer>',
      '</body></html>',
    ].join('\n')
  }

  /* ---------------------------------------------------------------------- *
   * Exécution
   * ---------------------------------------------------------------------- */

  /** Crée les dossiers du pack, l'un après l'autre. */
  function createDirectories(root, directories, done) {
    var index = 0

    function next() {
      if (index >= directories.length) {
        done(null)
        return
      }
      var path = joinPath(root, directories[index].split('/'))
      index += 1
      call('lfCreateFolder', [path], function (result) {
        if (!result.ok) {
          done('creation du dossier ' + path + ' impossible : ' + result.value)
          return
        }
        next()
      })
    }

    call('lfCreateFolder', [root], function (result) {
      if (!result.ok) {
        done('creation du dossier racine impossible : ' + result.value)
        return
      }
      next()
    })
  }

  /** Lance l'exportation d'une tâche unique. */
  function exportTask(root, task, done) {
    var path = joinPath(root, task.folder.split('/').concat([task.fileName]))
    // Chaque composant est un document autonome : son unique plan de travail
    // porte l'index 0.
    var index = 0

    if (task.kind === 'png') {
      call('lfExportPNG', [index, path, task.width || 0, task.resolution || 72], done)
      return
    }
    if (task.kind === 'jpeg') {
      call('lfExportJPEG', [index, path, task.width || 0, task.resolution || 72], done)
      return
    }
    if (task.kind === 'svg') {
      call('lfExportSVG', [index, path], done)
      return
    }
    if (task.kind === 'pdf') {
      call('lfExportPDF', [index, path], done)
      return
    }
    if (task.kind === 'eps') {
      call('lfExportEPS', [index, path], done)
      return
    }
    if (task.kind === 'ai') {
      call('lfExportAI', [path], done)
      return
    }
    done({ ok: false, value: 'format inconnu : ' + task.kind })
  }

  /**
   * Exécute un export complet, en deux passes.
   *
   * L'ordre des tâches — passe, composant, couleur — permet de n'ouvrir un
   * document et de ne basculer un mode colorimétrique que lorsque c'est
   * réellement nécessaire.
   *
   * @param config
   *   `{clientName, outputFolder, components:[{name, path}],
   *     colorSchemes:[{id, name, hex}], formats:{print:{}, web:{}},
   *     scales:[{type, width, resolution}], passes:{print, web}, favicon,
   *     separator, padding}`
   * @param handlers `{onProgress(done,total,label), onDone(result), onError(msg)}`
   * @returns un objet portant `cancel()`.
   */
  function runFullExport(config, handlers) {
    var startedAt = new Date().getTime()
    var tasks = planExport(config)
    var root = joinPath(config.outputFolder, [sanitize(config.clientName)])

    var written = []
    var failures = []
    var cancelled = false
    var index = 0

    /** Contexte courant, pour n'agir que sur les changements. */
    var current = { pass: null, component: null, scheme: null }

    function fail(task, message) {
      failures.push({ task: task, message: message })
      setTimeout(step, 0)
    }

    function finish() {
      call('lfEndSession', [], function () {
        var result = {
          written: written,
          failures: failures,
          cancelled: cancelled,
          durationMs: new Date().getTime() - startedAt,
          documentName: config.sourceName || '',
          root: root,
          total: tasks.length,
        }

        var reportPath = joinPath(root, [FOLDERS.report, 'export-rapport.html'])
        call(
          'lfWriteTextFile',
          [reportPath, buildReport(config, result)],
          function (write) {
            result.reportPath = write.ok ? reportPath : null
            if (!write.ok) {
              failures.push({
                task: {
                  component: { name: 'Rapport' },
                  scheme: { id: 'fullColor' },
                  format: 'html',
                  folder: FOLDERS.report,
                  fileName: 'export-rapport.html',
                },
                message: write.value,
              })
            }
            handlers.onDone(result)
          }
        )
      })
    }

    function runTask(task) {
      exportTask(root, task, function (result) {
        if (result.ok) written.push(task)
        else failures.push({ task: task, message: result.value })
        // `setTimeout` rend la main au navigateur : sans lui, la barre de
        // progression resterait figée pendant tout le lot.
        setTimeout(step, 0)
      })
    }

    /** Applique la marge configurée au plan de travail du composant. */
    function applyPadding(task, done) {
      var padding = config.padding
      if (
        !padding ||
        (!padding.top && !padding.right && !padding.bottom && !padding.left)
      ) {
        done()
        return
      }
      call(
        'lfSetPadding',
        [0, padding.top, padding.right, padding.bottom, padding.left],
        function (result) {
          if (!result.ok) {
            failures.push({ task: task, message: 'marge : ' + result.value })
          }
          done()
        }
      )
    }

    /** Recolore le document de travail, puis exporte. */
    function recolorThenRun(task) {
      current.scheme = task.scheme.id + ':' + (task.scheme.hex || '')
      // Le seuil d'inversion voyage avec la déclinaison : la couche
      // ExtendScript applique exactement la règle que le panneau prévisualise.
      var threshold = typeof config.threshold === 'number' ? config.threshold : 100
      call(
        'lfApplyColorScheme',
        [
          task.scheme.id,
          task.scheme.hex || '',
          threshold,
          formatColorMap(task.scheme.map),
        ],
        function (applied) {
          if (!applied.ok) {
            fail(task, 'recolorage : ' + applied.value)
            return
          }
          runTask(task)
        }
      )
    }

    /**
     * Ouvre le document du composant, le met au bon mode colorimétrique, puis
     * applique la marge et la couleur.
     */
    function openThenRun(task) {
      current.component = task.component.path
      current.scheme = null

      call('lfOpenComponent', [task.component.path], function (opened) {
        if (!opened.ok) {
          fail(task, 'ouverture du composant : ' + opened.value)
          return
        }
        call(
          'lfSetColorMode',
          [task.pass === 'print' ? 'cmyk' : 'rgb'],
          function (mode) {
            if (!mode.ok) {
              failures.push({
                task: task,
                message: 'mode colorimetrique : ' + mode.value,
              })
            }
            applyPadding(task, function () {
              recolorThenRun(task)
            })
          }
        )
      })
    }

    function step() {
      if (cancelled || index >= tasks.length) {
        finish()
        return
      }

      var task = tasks[index]
      index += 1
      handlers.onProgress(index, tasks.length, task.fileName)

      var signature = task.scheme.id + ':' + (task.scheme.hex || '')

      // Changement de composant ou de passe : il faut rouvrir le document.
      if (
        current.component !== task.component.path ||
        current.pass !== task.pass
      ) {
        current.pass = task.pass
        openThenRun(task)
        return
      }

      // Changement de couleur seul : le recolorage étant destructeur, on repart
      // du document vierge du composant.
      if (current.scheme !== signature) {
        call('lfOpenComponent', [task.component.path], function (opened) {
          if (!opened.ok) {
            fail(task, 'reouverture du composant : ' + opened.value)
            return
          }
          call(
            'lfSetColorMode',
            [task.pass === 'print' ? 'cmyk' : 'rgb'],
            function () {
              applyPadding(task, function () {
                recolorThenRun(task)
              })
            }
          )
        })
        return
      }

      runTask(task)
    }

    if (tasks.length === 0) {
      handlers.onError(
        'Rien a exporter : definissez au moins un composant, une couleur et un format.'
      )
      return { cancel: function () {} }
    }

    createDirectories(root, planDirectories(tasks), function (folderError) {
      if (folderError) {
        handlers.onError(folderError)
        return
      }
      step()
    })

    return {
      cancel: function () {
        cancelled = true
      },
    }
  }

  /* ---------------------------------------------------------------------- *
   * Contrôle de production
   *
   * La couche ExtendScript compte ; c'est ici qu'on décide ce que ces
   * décomptes signifient, avec quelle gravité, et ce qu'on peut corriger sans
   * dénaturer le travail du designer.
   * ---------------------------------------------------------------------- */

  /**
   * Règles de contrôle.
   *
   * `severity` : gravité quand la règle est en défaut.
   * `fix` : identifiant de la correction sûre, absent quand il n'en existe pas.
   * `manual` : ce que le contrôle demande au designer, faute de correction.
   */
  var PREFLIGHT_RULES = [
    {
      id: 'colorMode',
      label: 'Mode colorimétrique',
      severity: 'error',
      manual:
        'Le document doit être en CMJN pour l impression, en RVB pour le web.',
      describe: function (finding) {
        var modes = String(finding.detail).split('/')
        return 'document en ' + modes[0] + ', attendu ' + modes[1]
      },
    },
    {
      id: 'liveText',
      label: 'Texte vectorisé',
      severity: 'error',
      manual:
        'Vectorisez le texte (Texte > Vectoriser) : sans la police, le logo ' +
        'ne s affichera pas à l identique.',
      describe: function (finding) {
        return finding.count + ' bloc(s) de texte encore vivant(s)'
      },
    },
    {
      id: 'strokes',
      label: 'Contours vectorisés',
      severity: 'warning',
      manual:
        'Vectorisez les contours (Objet > Décomposition) : leur épaisseur ' +
        'varie autrement avec la mise à l échelle.',
      describe: function (finding) {
        return finding.count + ' objet(s) à contour'
      },
    },
    {
      id: 'strayPoints',
      label: 'Points isolés',
      severity: 'error',
      fix: 'strayPoints',
      manual: 'Supprimez les points isolés : ils faussent les cadrages.',
      describe: function (finding) {
        return finding.count + ' point(s) isolé(s)'
      },
    },
    {
      id: 'unpainted',
      label: 'Objets non peints',
      severity: 'error',
      fix: 'unpainted',
      manual:
        'Supprimez les objets sans fond ni contour : ils occupent de la place ' +
        'sans rien afficher.',
      describe: function (finding) {
        return finding.count + ' objet(s) invisible(s)'
      },
    },
    {
      id: 'emptyText',
      label: 'Blocs de texte vides',
      severity: 'error',
      fix: 'emptyText',
      manual: 'Supprimez les blocs de texte vides.',
      describe: function (finding) {
        return finding.count + ' bloc(s) vide(s)'
      },
    },
    {
      id: 'overprint',
      label: 'Surimpression',
      severity: 'warning',
      manual:
        'Vérifiez les objets en surimpression : à l impression, ils se ' +
        'mélangent au fond au lieu de le masquer.',
      describe: function (finding) {
        return finding.count + ' objet(s) en surimpression'
      },
    },
    {
      id: 'richBlack',
      label: 'Noir d impression',
      severity: 'warning',
      manual:
        'Un noir de trait se compose C0 M0 J0 N100 : un noir riche bave au ' +
        'calage.',
      describe: function (finding) {
        return finding.count + ' aplat(s) de noir composé'
      },
    },
    {
      id: 'unusedSwatches',
      label: 'Nuanciers inutilisés',
      severity: 'info',
      manual:
        'Nettoyez le nuancier : les couleurs inutilisées suivent le fichier ' +
        'chez le client.',
      describe: function (finding) {
        return finding.count + ' nuancier(s) sans emploi'
      },
    },
    {
      id: 'whitespace',
      label: 'Cadrage du plan de travail',
      severity: 'warning',
      fix: 'fitArtboard',
      manual:
        'Ajustez le plan de travail au logo : le blanc tournant se retrouve ' +
        'dans chaque fichier exporté.',
      describe: function (finding) {
        return finding.detail + ' % du plan de travail est vide'
      },
    },
    {
      id: 'lockedLayers',
      label: 'Calques verrouillés',
      severity: 'info',
      manual:
        'Les calques verrouillés résistent au recolorage : déverrouillez-les ' +
        'avant l export.',
      describe: function (finding) {
        return finding.count + ' calque(s) verrouillé(s)'
      },
    },
    {
      id: 'hiddenLayers',
      label: 'Calques masqués',
      severity: 'info',
      manual:
        'Un calque masqué est exporté vide : vérifiez qu il ne porte rien ' +
        'd utile.',
      describe: function (finding) {
        return finding.count + ' calque(s) masqué(s)'
      },
    },
  ]

  /**
   * Contrôles qu'aucun script ne peut trancher.
   *
   * L'expansion des apparences n'est pas lisible par le modèle objet
   * d'Illustrator : l'annoncer conforme serait mentir, la taire serait pire.
   */
  var PREFLIGHT_MANUAL = [
    {
      id: 'appearance',
      label: 'Apparences décomposées',
      manual:
        'Le modèle objet d Illustrator n expose pas les effets appliqués : ' +
        'vérifiez à l œil (Objet > Décomposer l aspect) avant de livrer.',
    },
    {
      id: 'inspection',
      label: 'Inspection à fort grossissement',
      manual:
        'Zoomez sur les jonctions et les angles : un raccord ouvert ne se ' +
        'voit qu à 800 %.',
    },
  ]

  /** Relit la charge utile de `lfPreflight`. */
  function parsePreflight(payload) {
    var findings = {}
    var lines = String(payload || '').split(UNIT)
    for (var i = 0; i < lines.length; i += 1) {
      if (!lines[i]) continue
      var parts = lines[i].split(':')
      if (parts.length < 2) continue
      findings[parts[0]] = {
        id: parts[0],
        count: parseInt(parts[1], 10) || 0,
        detail: parts.length > 2 ? parts.slice(2).join(':') : '',
      }
    }
    return findings
  }

  /**
   * Confronte les décomptes aux règles.
   *
   * Une règle sans décompte est absente du rapport plutôt que déclarée
   * conforme : le contrôle n'a pas eu lieu, on ne prétend pas le contraire.
   */
  function evaluatePreflight(payload) {
    var findings = parsePreflight(payload)
    var checks = []
    var counts = { pass: 0, info: 0, warning: 0, error: 0, unknown: 0 }

    for (var i = 0; i < PREFLIGHT_RULES.length; i += 1) {
      var rule = PREFLIGHT_RULES[i]
      var finding = findings[rule.id]

      if (!finding) {
        checks.push({
          rule: rule,
          status: 'unknown',
          message: 'contrôle non effectué',
        })
        counts.unknown += 1
        continue
      }

      var failed = finding.count > 0
      checks.push({
        rule: rule,
        status: failed ? rule.severity : 'pass',
        count: finding.count,
        detail: finding.detail,
        message: failed ? rule.describe(finding) : 'conforme',
        fix: failed ? rule.fix || null : null,
      })
      counts[failed ? rule.severity : 'pass'] += 1
    }

    return {
      checks: checks,
      manual: PREFLIGHT_MANUAL,
      counts: counts,
      items: findings.items ? findings.items.count : 0,
      status: counts.error > 0 ? 'error' : counts.warning > 0 ? 'warning' : 'pass',
      ready: counts.error === 0,
    }
  }

  /* ---------------------------------------------------------------------- *
   * Couleurs
   *
   * Le calcul des couleurs vit ici, jamais dans l'interface : ce que le
   * panneau prévisualise et ce que la couche ExtendScript applique doivent
   * sortir de la même fonction, sans quoi l'aperçu ment.
   * ---------------------------------------------------------------------- */

  /** Décompose une couleur #rrggbb. Renvoie `null` si elle est illisible. */
  function hexToRgb(hex) {
    var clean = String(hex).replace(/^#/, '')
    if (!/^[0-9a-fA-F]{6}$/.test(clean)) return null
    return [
      parseInt(clean.substring(0, 2), 16),
      parseInt(clean.substring(2, 4), 16),
      parseInt(clean.substring(4, 6), 16),
    ]
  }

  /** Recompose une couleur #rrggbb, composantes bornées. */
  function rgbToHex(rgb) {
    var out = '#'
    for (var i = 0; i < 3; i += 1) {
      var value = Math.max(0, Math.min(255, Math.round(rgb[i]))).toString(16)
      out += value.length === 1 ? '0' + value : value
    }
    return out
  }

  /** Luminance perçue, de 0 à 255 — sert au gris et au seuil d'inversion. */
  function perceivedLuminance(rgb) {
    return 0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2]
  }

  /** Luminance relative WCAG, de 0 à 1. */
  function relativeLuminance(rgb) {
    var parts = []
    for (var i = 0; i < 3; i += 1) {
      var channel = rgb[i] / 255
      parts.push(
        channel <= 0.03928
          ? channel / 12.92
          : Math.pow((channel + 0.055) / 1.055, 2.4)
      )
    }
    return 0.2126 * parts[0] + 0.7152 * parts[1] + 0.0722 * parts[2]
  }

  /** Rapport de contraste WCAG entre deux couleurs, de 1 à 21. */
  function contrastRatio(foreground, background) {
    var a = hexToRgb(foreground)
    var b = hexToRgb(background)
    if (!a || !b) return 0
    var la = relativeLuminance(a)
    var lb = relativeLuminance(b)
    var lighter = Math.max(la, lb)
    var darker = Math.min(la, lb)
    return (lighter + 0.05) / (darker + 0.05)
  }

  /**
   * Verdict de lisibilité.
   *
   * Un logo est un objet graphique, pas du texte : le seuil retenu est celui
   * des composants non textuels, 3:1. En deçà de 1,5 le logo se confond avec
   * son fond.
   */
  function contrastVerdict(ratio) {
    if (ratio >= 3) return 'good'
    if (ratio >= 1.5) return 'warning'
    return 'critical'
  }

  /**
   * Couleur obtenue en appliquant une déclinaison à une couleur source.
   *
   * @param scheme `{id, hex, map}` — `map` étant la table source → cible d'une
   *   couleur personnalisée.
   * @param threshold seuil d'inversion, de 0 à 100.
   */
  function inkColor(scheme, sourceHex, threshold) {
    var rgb = hexToRgb(sourceHex)
    if (!rgb) return sourceHex

    var id = scheme.id
    if (id === 'black') return '#000000'
    if (id === 'white') return '#ffffff'
    if (id === 'grayscale') {
      var level = Math.round(perceivedLuminance(rgb))
      return rgbToHex([level, level, level])
    }
    if (id === 'inverted') {
      // Au-delà du seuil, la couleur est déjà assez claire pour rester
      // lisible sur un fond sombre : elle ne bascule pas.
      var limit = ((typeof threshold === 'number' ? threshold : 100) / 100) * 255
      if (perceivedLuminance(rgb) >= limit) return rgbToHex(rgb)
      return rgbToHex([255 - rgb[0], 255 - rgb[1], 255 - rgb[2]])
    }
    if (id === 'custom') {
      var mapped = mappedColor(scheme.map, sourceHex)
      if (mapped) return mapped
      return scheme.hex || sourceHex
    }
    return rgbToHex(rgb)
  }

  /** Cherche une correspondance source → cible, à la casse près. */
  function mappedColor(map, sourceHex) {
    if (!map || !map.length) return null
    var wanted = String(sourceHex).toLowerCase()
    for (var i = 0; i < map.length; i += 1) {
      if (String(map[i].from).toLowerCase() === wanted) return map[i].to
    }
    return null
  }

  /**
   * Sérialise une table de correspondance pour la traversée d'`evalScript`.
   *
   * Le pont ne transporte que des chaînes : « source>cible;source>cible ».
   */
  function formatColorMap(map) {
    var parts = []
    for (var i = 0; map && i < map.length; i += 1) {
      if (!hexToRgb(map[i].from) || !hexToRgb(map[i].to)) continue
      parts.push(map[i].from + '>' + map[i].to)
    }
    return parts.join(';')
  }

  /** Relit une table de correspondance, en écartant les couleurs illisibles. */
  function parseColorMap(text) {
    var map = []
    var parts = String(text || '').split(';')
    for (var i = 0; i < parts.length; i += 1) {
      var pair = parts[i].split('>')
      if (pair.length !== 2) continue
      var from = pair[0]
      var to = pair[1]
      if (!hexToRgb(from) || !hexToRgb(to)) continue
      map.push({ from: from, to: to })
    }
    return map
  }

  /** Fonds de contrôle du contraste. */
  var CONTRAST_BACKGROUNDS = [
    { id: 'white', label: 'Fond blanc', hex: '#ffffff' },
    { id: 'black', label: 'Fond noir', hex: '#000000' },
    { id: 'gray', label: 'Fond gris', hex: '#808080' },
  ]

  /**
   * Contrôle la lisibilité d'une déclinaison sur chaque fond.
   *
   * Sur un fond donné, c'est l'encre la PLUS contrastée qui décide : un logo
   * est visible dès qu'une de ses parties se détache. Retenir la moins
   * contrastée condamnerait tout logo comportant un aplat blanc — la réserve
   * y est voulue, pas subie — et l'avertissement finirait ignoré.
   *
   * D'un fond à l'autre, en revanche, c'est le pire qui décide : une
   * déclinaison n'est livrable que si elle tient partout où elle sera posée.
   *
   * @param samples couleurs représentatives du logo.
   */
  function checkContrast(scheme, samples, threshold, backgrounds) {
    var grounds =
      backgrounds && backgrounds.length ? backgrounds : CONTRAST_BACKGROUNDS
    var results = []
    var worst = null

    for (var b = 0; b < grounds.length; b += 1) {
      var ground = grounds[b]
      var best = null

      for (var s = 0; s < samples.length; s += 1) {
        var ink = inkColor(scheme, samples[s], threshold)
        var ratio = contrastRatio(ink, ground.hex)
        if (best === null || ratio > best) best = ratio
      }

      var entry = {
        background: ground,
        ratio: best === null ? 0 : best,
        verdict: contrastVerdict(best === null ? 0 : best),
      }
      results.push(entry)
      if (!worst || entry.ratio < worst.ratio) worst = entry
    }

    return { scheme: scheme, results: results, worst: worst }
  }

  /* ---------------------------------------------------------------------- *
   * Planche de revue — géométrie
   *
   * Le calcul reste ici, en JavaScript ordinaire : une grille fausse se
   * découvre en une milliseconde de test, jamais en rouvrant Illustrator.
   * ---------------------------------------------------------------------- */

  /** Réglages de grille par défaut, en points. */
  var GRID_DEFAULTS = {
    margin: 48,
    columnGap: 28,
    rowGap: 28,
    cellWidth: 220,
    cellHeight: 140,
    labelSize: 12,
    labelGutter: 110,
    headerHeight: 26,
  }

  /** Réglages de grille complétés par leurs valeurs par défaut. */
  function gridSettings(overrides) {
    var settings = {}
    for (var key in GRID_DEFAULTS) {
      if (!GRID_DEFAULTS.hasOwnProperty(key)) continue
      var given = overrides ? parseFloat(overrides[key]) : NaN
      settings[key] = isNaN(given) || given < 0 ? GRID_DEFAULTS[key] : given
    }
    return settings
  }

  /**
   * Calcule la planche : composants en colonnes, déclinaisons en lignes.
   *
   * Les coordonnées sont celles d'Illustrator — origine en haut à gauche du
   * plan de travail, ordonnées croissantes vers le haut, donc négatives vers
   * le bas.
   */
  function planPackageGrid(config) {
    var settings = gridSettings(config.grid)
    var columns = []
    var rows = config.colorSchemes || []

    for (var c = 0; c < config.components.length; c += 1) {
      if (config.components[c].path) columns.push(config.components[c])
    }

    var width =
      settings.margin * 2 +
      settings.labelGutter +
      columns.length * settings.cellWidth +
      Math.max(0, columns.length - 1) * settings.columnGap
    var height =
      settings.margin * 2 +
      settings.headerHeight +
      rows.length * settings.cellHeight +
      Math.max(0, rows.length - 1) * settings.rowGap

    var cells = []
    var labels = []

    if (columns.length === 0 || rows.length === 0) {
      return {
        width: width,
        height: height,
        columns: columns.length,
        rows: rows.length,
        cells: cells,
        labels: labels,
        settings: settings,
      }
    }

    function columnLeft(index) {
      return (
        settings.margin +
        settings.labelGutter +
        index * (settings.cellWidth + settings.columnGap)
      )
    }

    function rowTop(index) {
      return -(
        settings.margin +
        settings.headerHeight +
        index * (settings.cellHeight + settings.rowGap)
      )
    }

    for (var h = 0; h < columns.length; h += 1) {
      labels.push({
        kind: 'column',
        text: columns[h].name,
        left: columnLeft(h),
        top: -settings.margin,
        size: settings.labelSize,
      })
    }

    for (var r = 0; r < rows.length; r += 1) {
      labels.push({
        kind: 'row',
        text: schemeTitle(rows[r]),
        left: settings.margin,
        // Aligné sur le milieu de la ligne, à la hauteur du texte près.
        top: rowTop(r) - settings.cellHeight / 2 + settings.labelSize / 2,
        size: settings.labelSize,
      })

      for (var k = 0; k < columns.length; k += 1) {
        cells.push({
          component: columns[k],
          scheme: rows[r],
          column: k,
          row: r,
          left: columnLeft(k),
          top: rowTop(r),
          width: settings.cellWidth,
          height: settings.cellHeight,
        })
      }
    }

    return {
      width: width,
      height: height,
      columns: columns.length,
      rows: rows.length,
      cells: cells,
      labels: labels,
      settings: settings,
    }
  }

  /**
   * Construit la planche dans Illustrator, cellule par cellule.
   *
   * Une cellule qui échoue est consignée et laissée vide : mieux vaut une
   * planche incomplète et annotée qu'un abandon en cours de route. La planche
   * n'est déclarée terminée qu'après vérification de son contenu.
   */
  function runPackageBuild(config, handlers) {
    var plan = planPackageGrid(config)
    var report = {
      expected: plan.cells.length,
      placed: 0,
      empty: [],
      failures: [],
      width: plan.width,
      height: plan.height,
      outside: 0,
      name: '',
    }

    if (plan.cells.length === 0) {
      handlers.onDone({
        ok: false,
        message: 'aucun composant défini ou aucune déclinaison cochée',
        report: report,
      })
      return
    }

    var threshold = typeof config.threshold === 'number' ? config.threshold : 100
    // La planche adopte le mode colorimétrique de la passe d'impression quand
    // elle est demandée : c'est celle qui contraint le plus les couleurs.
    var colorMode = config.passes && config.passes.print !== false ? 'cmyk' : 'rgb'

    function fail(message) {
      call('lfAbortPackage', [], function () {
        handlers.onDone({ ok: false, message: message, report: report })
      })
    }

    var index = 0

    function placeNext() {
      if (index >= plan.cells.length) {
        finish()
        return
      }

      var cell = plan.cells[index]
      index += 1
      handlers.onProgress(index, plan.cells.length, cell.component.name)

      call(
        'lfPlaceComponent',
        [
          cell.component.path,
          cell.scheme.id,
          cell.scheme.hex || '',
          threshold,
          formatColorMap(cell.scheme.map),
          cell.left,
          cell.top,
          cell.width,
          cell.height,
        ],
        function (result) {
          if (result.ok) {
            report.placed += 1
          } else {
            report.empty.push(
              cell.component.name + ' / ' + schemeTitle(cell.scheme)
            )
            report.failures.push({ cell: cell, message: result.value })
          }
          setTimeout(placeNext, 0)
        }
      )
    }

    function labelNext(position) {
      if (position >= plan.labels.length) {
        placeNext()
        return
      }
      var label = plan.labels[position]
      call(
        'lfAddLabel',
        [label.text, label.left, label.top, label.size],
        function (result) {
          if (!result.ok) {
            report.failures.push({ label: label.text, message: result.value })
          }
          labelNext(position + 1)
        }
      )
    }

    function finish() {
      call('lfFinishPackage', [], function (result) {
        if (!result.ok) {
          fail('finalisation de la planche : ' + result.value)
          return
        }
        var fields = result.value.split(UNIT)
        report.outside = parseInt(fields[3], 10) || 0
        report.name = fields[4] || ''

        handlers.onDone({
          // Une planche dont toutes les cellules ont échoué n'est pas un succès.
          ok: report.placed > 0,
          message:
            report.placed === report.expected
              ? ''
              : report.expected - report.placed + ' cellule(s) non remplie(s)',
          report: report,
        })
      })
    }

    call(
      'lfCreatePackage',
      [plan.width, plan.height, colorMode],
      function (created) {
        if (!created.ok) {
          handlers.onDone({
            ok: false,
            message: 'création de la planche : ' + created.value,
            report: report,
          })
          return
        }
        labelNext(0)
      }
    )
  }

  return {
    FOLDERS: FOLDERS,
    FAVICON_SIZES: FAVICON_SIZES,
    PRINT_FORMATS: PRINT_FORMATS,
    WEB_FORMATS: WEB_FORMATS,
    joinFolder: joinFolder,
    deliveryName: deliveryName,
    call: call,
    quote: quote,
    sanitize: sanitize,
    pascal: pascal,
    joinPath: joinPath,
    schemeLabel: schemeLabel,
    schemeTitle: schemeTitle,
    buildFileName: buildFileName,
    planExport: planExport,
    planDirectories: planDirectories,
    buildReport: buildReport,
    formatDuration: formatDuration,
    readDocumentInfo: readDocumentInfo,
    readArtboardNames: readArtboardNames,
    runFullExport: runFullExport,
    PREFLIGHT_RULES: PREFLIGHT_RULES,
    PREFLIGHT_MANUAL: PREFLIGHT_MANUAL,
    parsePreflight: parsePreflight,
    evaluatePreflight: evaluatePreflight,
    CONTRAST_BACKGROUNDS: CONTRAST_BACKGROUNDS,
    hexToRgb: hexToRgb,
    rgbToHex: rgbToHex,
    perceivedLuminance: perceivedLuminance,
    relativeLuminance: relativeLuminance,
    contrastRatio: contrastRatio,
    contrastVerdict: contrastVerdict,
    inkColor: inkColor,
    formatColorMap: formatColorMap,
    parseColorMap: parseColorMap,
    checkContrast: checkContrast,
    GRID_DEFAULTS: GRID_DEFAULTS,
    gridSettings: gridSettings,
    planPackageGrid: planPackageGrid,
    runPackageBuild: runPackageBuild,
  }
})()

// Rend le moteur disponible aux tests Node comme au panneau.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = LogoForgeEngine
}
