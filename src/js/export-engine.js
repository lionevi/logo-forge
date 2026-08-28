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

  /** Dossiers du pack, dans l'ordre où ils apparaissent à la livraison. */
  var FOLDERS = {
    sources: '01_Sources',
    web: '02_Web',
    print: '03_Print',
    favicon: '04_Favicon',
    report: '05_Rapport',
  }

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

  /** Libellé d'une déclinaison, personnalisée comprise. */
  function schemeLabel(scheme) {
    if (scheme.id === 'custom') return pascal(scheme.name)
    return SCHEME_LABEL[scheme.id] || pascal(scheme.id)
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
   * Calcule la liste des fichiers à produire.
   *
   * Le plan est établi avant toute écriture : il donne le total exact pour la
   * barre de progression, et permet d'afficher le pack avant de le lancer.
   *
   * @returns un tableau de tâches
   *   `{kind, scheme, component, format, folder, fileName, width, resolution}`.
   */
  function planExport(config) {
    var tasks = []
    var separator = config.separator || '-'
    var i
    var j
    var k

    for (i = 0; i < config.colorSchemes.length; i += 1) {
      var scheme = config.colorSchemes[i]
      var label = schemeLabel(scheme)

      for (j = 0; j < config.components.length; j += 1) {
        var component = config.components[j]
        var base = pascal(component.name)

        // Sources : le document natif, seulement en pleine couleur — un .ai
        // recoloré ne serait plus une source.
        if (config.formats.ai && scheme.id === 'fullColor') {
          tasks.push({
            kind: 'ai',
            scheme: scheme,
            component: component,
            format: 'ai',
            folder: FOLDERS.sources,
            fileName: buildFileName([base], separator, 'ai'),
          })
        }

        if (config.formats.svg) {
          tasks.push({
            kind: 'svg',
            scheme: scheme,
            component: component,
            format: 'svg',
            folder: FOLDERS.web + '/SVG',
            fileName: buildFileName([base, label], separator, 'svg'),
          })
        }

        if (config.formats.png) {
          for (k = 0; k < config.scales.length; k += 1) {
            var scale = config.scales[k]
            tasks.push({
              kind: 'png',
              scheme: scheme,
              component: component,
              format: 'png',
              folder:
                (scale.type === 'print' ? FOLDERS.print : FOLDERS.web) + '/PNG',
              fileName: buildFileName(
                [base, label, scale.label],
                separator,
                'png'
              ),
              width: scale.width,
              resolution: scale.resolution,
            })
          }
        }

        if (config.formats.pdf) {
          tasks.push({
            kind: 'pdf',
            scheme: scheme,
            component: component,
            format: 'pdf',
            folder: FOLDERS.print + '/PDF',
            fileName: buildFileName([base, label], separator, 'pdf'),
          })
        }

        if (config.formats.eps) {
          tasks.push({
            kind: 'eps',
            scheme: scheme,
            component: component,
            format: 'eps',
            folder: FOLDERS.print + '/EPS',
            fileName: buildFileName([base, label], separator, 'eps'),
          })
        }
      }
    }

    // Favicons : le premier composant, à la première déclinaison, aux tailles
    // attendues par les navigateurs.
    if (config.favicon && config.components.length > 0) {
      var faviconScheme = config.colorSchemes[0]
      for (i = 0; i < FAVICON_SIZES.length; i += 1) {
        tasks.push({
          kind: 'png',
          scheme: faviconScheme,
          component: config.components[0],
          format: 'png',
          folder: FOLDERS.favicon,
          fileName: 'favicon' + separator + FAVICON_SIZES[i] + 'px.png',
          width: FAVICON_SIZES[i],
          resolution: 72,
        })
      }
    }

    // Regroupe par déclinaison : une seule recoloration par schéma, là où
    // l'ordre inverse en imposerait une par fichier.
    tasks.sort(function (a, b) {
      var left = String(a.scheme.id) + ' ' + a.component.name
      var right = String(b.scheme.id) + ' ' + b.component.name
      if (left < right) return -1
      if (left > right) return 1
      return 0
    })

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
    var path = joinPath(root, [task.folder, task.fileName])
    var index = task.component.artboardIndex

    if (task.kind === 'png') {
      call(
        'lfExportPNG',
        [index, path, task.width || 0, task.resolution || 72],
        done
      )
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
   * Exécute un export complet.
   *
   * @param config
   *   `{clientName, outputFolder, components:[{name, artboardIndex}],
   *     colorSchemes:[{id, name, hex}], formats:{svg,png,pdf,eps,ai},
   *     scales:[{type, label, width, resolution}], favicon, separator}`
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
    var currentScheme = null
    var documentName = ''
    var index = 0

    function finish() {
      // La session est refermée quoi qu'il arrive : un document temporaire
      // resté ouvert dans Illustrator serait plus gênant qu'un échec.
      call('lfEndSession', [], function () {
        var result = {
          written: written,
          failures: failures,
          cancelled: cancelled,
          durationMs: new Date().getTime() - startedAt,
          documentName: documentName,
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

    /**
     * Élargit les plans de travail de la marge demandée.
     *
     * La marge est réappliquée après chaque remise à zéro de la session : la
     * copie repart du fichier d'origine, donc sans marge.
     */
    function applyPadding(task, done) {
      var padding = config.padding
      if (!padding) {
        done()
        return
      }
      if (!padding.top && !padding.right && !padding.bottom && !padding.left) {
        done()
        return
      }

      var remaining = config.components.length
      if (remaining === 0) {
        done()
        return
      }

      for (var i = 0; i < config.components.length; i += 1) {
        call(
          'lfSetPadding',
          [
            config.components[i].artboardIndex,
            padding.top,
            padding.right,
            padding.bottom,
            padding.left,
          ],
          function (result) {
            if (!result.ok) {
              failures.push({ task: task, message: 'marge : ' + result.value })
            }
            remaining -= 1
            if (remaining === 0) done()
          }
        )
      }
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

    function step() {
      if (cancelled || index >= tasks.length) {
        finish()
        return
      }

      var task = tasks[index]
      index += 1
      handlers.onProgress(index, tasks.length, task.fileName)

      var signature = task.scheme.id + ':' + (task.scheme.hex || '')
      if (currentScheme === signature) {
        runTask(task)
        return
      }

      // Changement de déclinaison : le recolorage étant destructeur, on repart
      // de la copie vierge avant de l'appliquer.
      currentScheme = signature
      call('lfResetSession', [], function (reset) {
        if (!reset.ok) {
          failures.push({
            task: task,
            message: 'reinitialisation : ' + reset.value,
          })
          setTimeout(step, 0)
          return
        }
        call(
          'lfApplyColorScheme',
          [task.scheme.id, task.scheme.hex || ''],
          function (applied) {
            if (!applied.ok) {
              failures.push({
                task: task,
                message: 'recolorage : ' + applied.value,
              })
              setTimeout(step, 0)
              return
            }
            applyPadding(task, function () {
              runTask(task)
            })
          }
        )
      })
    }

    readDocumentInfo(function (info) {
      if (!info) {
        handlers.onError('Aucun document Illustrator ouvert.')
        return
      }
      if (!info.path) {
        handlers.onError(
          "Enregistrez le document avant d'exporter : Logo Forge travaille " +
            'sur une copie du fichier.'
        )
        return
      }
      documentName = info.name

      createDirectories(root, planDirectories(tasks), function (folderError) {
        if (folderError) {
          handlers.onError(folderError)
          return
        }
        call('lfBeginSession', [], function (session) {
          if (!session.ok) {
            handlers.onError(
              'Ouverture de la copie de travail : ' + session.value
            )
            return
          }
          step()
        })
      })
    })

    return {
      cancel: function () {
        cancelled = true
      },
    }
  }

  return {
    FOLDERS: FOLDERS,
    FAVICON_SIZES: FAVICON_SIZES,
    call: call,
    quote: quote,
    sanitize: sanitize,
    pascal: pascal,
    joinPath: joinPath,
    schemeLabel: schemeLabel,
    buildFileName: buildFileName,
    planExport: planExport,
    planDirectories: planDirectories,
    buildReport: buildReport,
    formatDuration: formatDuration,
    readDocumentInfo: readDocumentInfo,
    readArtboardNames: readArtboardNames,
    runFullExport: runFullExport,
  }
})()

// Rend le moteur disponible aux tests Node comme au panneau.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = LogoForgeEngine
}
