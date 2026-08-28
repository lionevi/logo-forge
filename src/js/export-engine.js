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

  /**
   * Modèles d'arborescence.
   *
   * Une seule structure ne convient pas à tout le monde : le client cherche
   * « pour l'impression », le designer cherche un PDF, l'agence classe par
   * étapes numérotées. Chaque modèle décrit où va un fichier et comment se
   * nomment les dossiers de service.
   *
   * `folder` reçoit le contexte d'une tâche et renvoie un chemin relatif.
   */
  var FOLDER_TEMPLATES = [
    {
      id: 'client',
      label: 'Client — dossiers en clair',
      description:
        'Pour_Impression et Pour_Web, puis un dossier par composant et par ' +
        'couleur. Le client trouve sans rien connaître au métier.',
      report: 'Rapport',
      documentation: 'Documentation',
      folder: function (context) {
        if (context.favicon) return joinFolder([FOLDERS.web, 'Favicon'])
        return joinFolder([
          context.pass === 'print' ? FOLDERS.print : FOLDERS.web,
          pascal(context.component.name),
          schemeLabel(context.scheme),
        ])
      },
    },
    {
      id: 'technical',
      label: 'Designer — par usage puis format',
      description:
        'Print et Web, puis un dossier par format. On y cherche un PDF, pas ' +
        'une couleur.',
      report: 'Rapport',
      documentation: 'Documentation',
      folder: function (context) {
        if (context.favicon) return joinFolder(['Web', 'Favicon'])
        return joinFolder([
          context.pass === 'print' ? 'Print' : 'Web',
          String(context.format).toUpperCase(),
          pascal(context.component.name),
        ])
      },
    },
    {
      id: 'agency',
      label: 'Agence — étapes numérotées',
      description:
        'Dossiers numérotés, dans l ordre de lecture d une livraison : ' +
        'sources, impression, web, favicons, documentation.',
      report: '05_Rapport',
      documentation: '04_Documentation',
      folder: function (context) {
        if (context.favicon) return '03_Favicons'
        if (context.format === 'ai') {
          return joinFolder(['01_Sources', pascal(context.component.name)])
        }
        return joinFolder([
          context.pass === 'print' ? '02_Impression' : '03_Web',
          pascal(context.component.name),
          schemeLabel(context.scheme),
        ])
      },
    },
  ]

  /** Modèle d'arborescence retenu, celui du client par défaut. */
  function folderTemplate(id) {
    for (var i = 0; i < FOLDER_TEMPLATES.length; i += 1) {
      if (FOLDER_TEMPLATES[i].id === id) return FOLDER_TEMPLATES[i]
    }
    return FOLDER_TEMPLATES[0]
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

  /**
   * Comme `pascal`, mais sans valeur de repli.
   *
   * Une variable de gabarit peut légitimement être absente : la remplacer par
   * « Logo » — ou pire, par « Undefined » — écrirait dans le nom du fichier
   * une information que personne n'a saisie.
   */
  function pascalOrEmpty(text) {
    if (text === undefined || text === null || text === '') return ''
    var out = pascal(text)
    return out === 'Logo' && !/logo/i.test(String(text)) ? '' : out
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
  /**
   * Variables reconnues par le gabarit de nommage.
   *
   * La liste est affichée telle quelle dans les réglages : elle sert de
   * documentation autant que de contrat.
   */
  var NAME_VARIABLES = [
    { token: 'client', label: 'Nom du client' },
    { token: 'brand', label: 'Marque, à défaut le client' },
    { token: 'project', label: 'Projet' },
    { token: 'component', label: 'Composant' },
    { token: 'type', label: 'Type du composant' },
    { token: 'scheme', label: 'Déclinaison' },
    { token: 'profile', label: 'Profil colorimétrique (CMJN ou RVB)' },
    { token: 'size', label: 'Largeur en pixels, quand elle s applique' },
    { token: 'format', label: 'Format du fichier' },
    { token: 'version', label: 'Version du pack' },
    { token: 'date', label: 'Date de livraison, AAAA-MM-JJ' },
  ]

  /** Gabarit par défaut, exprimé avec le séparateur choisi. */
  var DEFAULT_NAME_TEMPLATE = '{{client}}_{{component}}_{{scheme}}_{{size}}'

  /**
   * Gabarit par défaut adapté au séparateur.
   *
   * Tant que le designer n'écrit pas son propre gabarit, le réglage de
   * séparateur continue de commander le nom. Dès qu'il en écrit un, ce sont
   * ses propres caractères qui font foi.
   */
  function defaultTemplate(separator) {
    return DEFAULT_NAME_TEMPLATE.replace(/_/g, separator || '_')
  }

  /** Date de livraison au format AAAA-MM-JJ. */
  function deliveryDate(now) {
    var date = now || new Date()
    var month = date.getMonth() + 1
    var day = date.getDate()
    return (
      date.getFullYear() +
      '-' +
      (month < 10 ? '0' : '') +
      month +
      '-' +
      (day < 10 ? '0' : '') +
      day
    )
  }

  /**
   * Rend un gabarit de nommage.
   *
   * Le gabarit alterne littéraux et variables. Un littéral n'est conservé que
   * s'il sépare deux valeurs réellement écrites : une variable vide — la
   * taille d'un fichier vectoriel, par exemple — ne doit pas laisser de
   * séparateur orphelin. Quand plusieurs littéraux se suivent parce que les
   * variables intercalées sont vides, seul le premier subsiste.
   *
   * Ce découpage préserve ce que le designer a délibérément écrit : un double
   * tiret entre deux valeurs pleines reste un double tiret.
   */
  function renderNameTemplate(template, values, separator) {
    var text = String(template || DEFAULT_NAME_TEMPLATE)
    var parts = text.split(/(\{\{\s*[a-zA-Z]+\s*\}\})/)

    var out = ''
    var pending = null

    for (var i = 0; i < parts.length; i += 1) {
      var part = parts[i]
      if (part === '') continue

      var token = /^\{\{\s*([a-zA-Z]+)\s*\}\}$/.exec(part)
      if (!token) {
        // Premier littéral depuis la dernière valeur écrite : c'est lui qui
        // servira de séparateur si une valeur suit.
        if (pending === null) pending = part
        continue
      }

      var value = values[token[1]]
      value = value === undefined || value === null ? '' : String(value)
      if (value === '') continue

      if (out !== '' && pending !== null) out += pending
      out += value
      pending = null
    }

    return sanitize(out)
  }

  /** Valeurs des variables pour un fichier donné. */
  function nameValues(config, component, scheme, size, format) {
    var client = pascalOrEmpty(config.clientName)
    return {
      client: client,
      brand: pascalOrEmpty(config.brandName) || client,
      project: pascalOrEmpty(config.projectName),
      component: pascal(component.name),
      type: pascalOrEmpty(component.type),
      scheme: schemeLabel(scheme),
      profile: config.pass === 'print' ? 'CMJN' : 'RVB',
      size: size ? size + 'px' : '',
      format: String(format || '').toUpperCase(),
      version: config.version ? 'v' + config.version : '',
      date: deliveryDate(),
    }
  }

  /** Nom d'un fichier livré, gabarit appliqué. */
  function deliveryName(config, component, scheme, size, extension, pass) {
    var values = nameValues(
      {
        clientName: config.clientName,
        brandName: config.brandName,
        projectName: config.projectName,
        version: config.version,
        pass: pass,
      },
      component,
      scheme,
      size,
      extension
    )
    var separator = config.separator || '_'
    var base = renderNameTemplate(
      config.nameTemplate || defaultTemplate(separator),
      values,
      separator
    )
    // Un gabarit qui ne produirait rien laisserait un fichier sans nom.
    if (!base) base = pascal(component.name) || 'logo'
    return base + '.' + extension
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
    var template = folderTemplate(config.folderTemplate)
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
          for (var f = 0; f < formats.length; f += 1) {
            var format = formats[f]
            // Le dossier dépend du format dans certains modèles : il se
            // calcule donc par fichier, pas par déclinaison.
            var folder = template.folder({
              pass: pass,
              component: component,
              scheme: scheme,
              format: format === 'jpeg' ? 'jpg' : format,
              favicon: false,
            })

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
                    config,
                    component,
                    scheme,
                    scales[k].width,
                    format === 'jpeg' ? 'jpg' : format,
                    pass
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
              fileName: deliveryName(config, component, scheme, 0, format, pass),
              resolution: pass === 'print' ? PRINT_RESOLUTION : 72,
            })
          }
        }
      }
    }

    // Favicons : le premier composant, première couleur, aux tailles attendues
    // par les navigateurs. Ils vivent dans la passe web.
    // Un favicon porte une déclinaison comme n'importe quel autre fichier :
    // sans déclinaison retenue, il n'y a rien à produire — et la tâche
    // partirait avec une couleur indéfinie.
    if (
      config.favicon &&
      config.components.length > 0 &&
      config.colorSchemes.length > 0 &&
      passes.indexOf('web') !== -1
    ) {
      var first = config.components[0]
      if (first.path) {
        for (var v = 0; v < FAVICON_SIZES.length; v += 1) {
          tasks.push({
            pass: 'web',
            kind: 'png',
            scheme: config.colorSchemes[0],
            component: first,
            format: 'png',
            folder: template.folder({
              pass: 'web',
              component: first,
              scheme: config.colorSchemes[0],
              format: 'png',
              favicon: true,
            }),
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
  /** Dossier parent d'un chemin. */
  function dirname(path) {
    var cut = String(path).lastIndexOf('/')
    return cut <= 0 ? path : String(path).substring(0, cut)
  }

  /**
   * Dossiers à créer avant d'écrire.
   *
   * @param reportFolder dossier de service du modèle retenu, qui doit exister
   *   même quand aucun fichier n'y va.
   */
  function planDirectories(tasks, reportFolder) {
    var service = reportFolder || FOLDERS.report
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
    if (!seen[service]) list.push(service)
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
  /** Poids cumulé des fichiers réellement écrits. */
  function totalBytes(written) {
    var total = 0
    for (var i = 0; i < written.length; i += 1) total += written[i].bytes || 0
    return total
  }

  /** Fichiers écrits mais assortis d'une réserve. */
  function countWarnings(written) {
    var count = 0
    for (var i = 0; i < written.length; i += 1) {
      if (written[i].status === 'warning') count += 1
    }
    return count
  }

  /** Échecs véritables : un avertissement n'est pas un fichier perdu. */
  function countFailures(failures) {
    var count = 0
    for (var i = 0; i < failures.length; i += 1) {
      if (!failures[i].warning) count += 1
    }
    return count
  }

  /** Taille de fichier lisible, en unités décimales. */
  function formatBytes(bytes) {
    if (!bytes) return ''
    if (bytes < 1024) return bytes + ' o'
    if (bytes < 1024 * 1024) return Math.round(bytes / 1024) + ' Ko'
    return (bytes / (1024 * 1024)).toFixed(1) + ' Mo'
  }

  function buildReport(config, result) {
    var rows = ''
    var i

    for (i = 0; i < result.written.length; i += 1) {
      var task = result.written[i]
      var warned = task.status === 'warning'
      rows += reportRow(
        warned ? 'Reserve' : 'OK',
        warned ? 'warn' : 'ok',
        task.component.name,
        schemeLabel(task.scheme),
        task.format,
        task.folder +
          '/' +
          task.fileName +
          (warned ? ' — ' + task.warnings.join(' ; ') : '') +
          (task.bytes ? ' (' + formatBytes(task.bytes) + ')' : '')
      )
    }

    var ignored = result.skipped || []
    for (i = 0; i < ignored.length; i += 1) {
      rows += reportRow(
        'Ignore',
        'warn',
        ignored[i].component.name,
        schemeLabel(ignored[i].scheme),
        ignored[i].format,
        ignored[i].folder + '/' + ignored[i].fileName + ' — deja livre'
      )
    }

    for (i = 0; i < result.failures.length; i += 1) {
      var failure = result.failures[i]
      // Un avertissement accompagne déjà la ligne du fichier écrit.
      if (failure.warning) continue
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
      '.warn{color:#e68619;font-weight:700}',
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
      stat(formatBytes(totalBytes(result.written)), 'poids'),
      stat(config.components.length, 'composants'),
      stat(config.colorSchemes.length, 'declinaisons'),
      stat(countWarnings(result.written), 'reserves'),
      stat((result.skipped || []).length, 'ignores'),
      stat(countFailures(result.failures), 'echecs'),
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
  /**
   * Politiques de collision.
   *
   * Écraser sans le dire ferait perdre une livraison précédente ; refuser
   * sans recours bloquerait une relivraison légitime. Le designer choisit.
   */
  var COLLISION_POLICIES = [
    { id: 'overwrite', label: 'Écraser le fichier existant' },
    { id: 'version', label: 'Écrire une nouvelle version' },
    { id: 'skip', label: 'Ne pas réécrire' },
  ]

  /** Insère un suffixe de version avant l'extension. */
  function versionedName(fileName, attempt) {
    var cut = fileName.lastIndexOf('.')
    if (cut <= 0) return fileName + '-v' + attempt
    return (
      fileName.substring(0, cut) + '-v' + attempt + fileName.substring(cut)
    )
  }

  /**
   * Résout une collision selon la politique retenue.
   *
   * `exists` interroge l'hôte ; la recherche de version s'arrête à 99 pour ne
   * pas transformer un dossier saturé en boucle sans fin.
   */
  function resolveCollision(path, fileName, policy, exists, done) {
    exists(path, function (taken) {
      if (!taken) {
        done({ action: 'write', path: path, fileName: fileName })
        return
      }
      if (policy === 'skip') {
        done({ action: 'skip', path: path, fileName: fileName })
        return
      }
      if (policy !== 'version') {
        done({ action: 'write', path: path, fileName: fileName })
        return
      }

      var attempt = 2
      var folder = path.substring(0, path.length - fileName.length)

      function tryNext() {
        if (attempt > 99) {
          done({
            action: 'fail',
            message: 'trop de versions du fichier ' + fileName,
          })
          return
        }
        var candidate = versionedName(fileName, attempt)
        exists(folder + candidate, function (used) {
          if (used) {
            attempt += 1
            tryNext()
            return
          }
          done({
            action: 'write',
            path: folder + candidate,
            fileName: candidate,
          })
        })
      }

      tryNext()
    })
  }

  function exportTask(root, task, done) {
    var path = task.path || joinPath(root, task.folder.split('/').concat([task.fileName]))
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
  /**
   * États d'une tâche d'export.
   *
   * `warning` distingue le fichier écrit mais douteux — un mode colorimétrique
   * qui n'a pas pris, par exemple — du fichier absent.
   */
  var JOB_STATUS = {
    pending: 'pending',
    processing: 'processing',
    success: 'success',
    warning: 'warning',
    failed: 'failed',
    skipped: 'skipped',
  }

  function runFullExport(config, handlers) {
    var startedAt = new Date().getTime()
    var template = folderTemplate(config.folderTemplate)
    var tasks = planExport(config)
    var root = joinPath(config.outputFolder, [sanitize(config.clientName)])

    // Une tâche porte son état et sa trace : le rapport final décrit ce qui
    // s'est passé, pas ce qu'on avait prévu.
    var jobs = []
    for (var j = 0; j < tasks.length; j += 1) {
      tasks[j].status = JOB_STATUS.pending
      tasks[j].bytes = 0
      tasks[j].warnings = []
      jobs.push(tasks[j])
    }

    var written = []
    var failures = []
    var skipped = []
    var cancelled = false
    var index = 0

    /** Contexte courant, pour n'agir que sur les changements. */
    var current = { pass: null, component: null, scheme: null }

    /**
     * Consigne un échec de conversion colorimétrique.
     *
     * Le fichier sera bien écrit, mais dans le mauvais espace : le compter
     * parmi les réussites serait mentir, l'écarter du lot ferait perdre un
     * fichier utilisable. Il part donc en avertissement.
     */
    function noteColorMode(task, result) {
      if (result.ok) return
      task.warnings.push('mode colorimétrique : ' + result.value)
      failures.push({
        task: task,
        message: 'mode colorimétrique : ' + result.value,
        warning: true,
      })
    }

    function fail(task, message) {
      task.status = JOB_STATUS.failed
      failures.push({ task: task, message: message })
      setTimeout(step, 0)
    }

    /**
     * Écrit la documentation destinée au client.
     *
     * Elle décrit le pack réellement livré : elle ne peut donc être composée
     * qu'une fois les fichiers écrits et vérifiés.
     */
    function writeDocumentation(result) {
      if (config.documentation === false) {
        result.documents = []
        writeManifest(result)
        return
      }

      var documents = buildDocumentation(config, result)
      result.documents = []
      var position = 0

      function next() {
        if (position >= documents.length) {
          writeManifest(result)
          return
        }

        var document = documents[position]
        position += 1
        var path = joinPath(root, document.path.split('/'))

        call('lfCreateFolder', [dirname(path)], function () {
          call('lfWriteTextFile', [path, document.contents], function (write) {
            if (write.ok) {
              result.documents.push(document.path)
            } else {
              failures.push({
                task: {
                  component: { name: 'Documentation' },
                  scheme: { id: 'fullColor' },
                  format: 'txt',
                  folder: template.documentation,
                  fileName: document.path.split('/').pop(),
                },
                message: write.value,
              })
            }
            next()
          })
        })
      }

      next()
    }

    /** Écrit le manifeste, destiné à l'audit plutôt qu'au client. */
    function writeManifest(result) {
      var manifest = buildManifest(config, result)
      var path = joinPath(root, [template.report, MANIFEST_NAME])

      call(
        'lfWriteTextFile',
        [path, JSON.stringify(manifest, null, 2)],
        function (write) {
          result.manifestPath = write.ok ? template.report + '/' + MANIFEST_NAME : null
          if (!write.ok) {
            failures.push({
              task: {
                component: { name: 'Manifeste' },
                scheme: { id: 'fullColor' },
                format: 'json',
                folder: template.report,
                fileName: MANIFEST_NAME,
              },
              message: write.value,
            })
          }
          auditWrittenPackage(result)
        }
      )
    }

    /**
     * Contrôle le pack livré, en relisant le disque.
     *
     * Un export qui se contenterait de son propre décompte ne prouverait rien :
     * c'est le contenu du dossier qui fait foi.
     */
    function auditWrittenPackage(result) {
      call('lfListFiles', [root, 2000], function (listing) {
        if (!listing.ok) {
          result.audit = null
          result.auditError = listing.value
          handlers.onDone(result)
          return
        }

        var expected = []
        for (var i = 0; i < result.written.length; i += 1) {
          expected.push(
            result.written[i].folder + '/' + result.written[i].fileName
          )
        }

        var service = {}
        if (result.reportPath) {
          service[template.report + '/export-rapport.html'] = true
        }
        service[template.report + '/' + MANIFEST_NAME] = true
        var documents = result.documents || []
        for (var d = 0; d < documents.length; d += 1) service[documents[d]] = true

        var actual = parseFileListing(listing.value)
        result.audit = auditPackage(expected, actual, {
          service: service,
          expectDocumentation: config.documentation !== false,
          documentationPresent: documents.length > 0,
          manifestPresent: !!result.manifestPath,
        })
        handlers.onDone(result)
      })
    }

    function finish() {
      call('lfEndSession', [], function () {
        var result = {
          written: written,
          failures: failures,
          skipped: skipped,
          cancelled: cancelled,
          durationMs: new Date().getTime() - startedAt,
          documentName: config.sourceName || '',
          root: root,
          total: tasks.length,
        }

        var reportPath = joinPath(root, [
          template.report,
          'export-rapport.html',
        ])
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
                  folder: template.report,
                  fileName: 'export-rapport.html',
                },
                message: write.value,
              })
            }
            writeDocumentation(result)
          }
        )
      })
    }

    /** Interroge l'hôte sur l'existence d'un chemin. */
    function pathExists(path, done) {
      call('lfPathExists', [path], function (result) {
        done(result.ok && result.value === '1')
      })
    }

    function runTask(task) {
      task.status = JOB_STATUS.processing

      var target = joinPath(root, task.folder.split('/').concat([task.fileName]))
      var policy = config.collision || 'overwrite'

      resolveCollision(target, task.fileName, policy, pathExists, function (
        decision
      ) {
        if (decision.action === 'skip') {
          task.status = JOB_STATUS.skipped
          skipped.push(task)
          setTimeout(step, 0)
          return
        }
        if (decision.action === 'fail') {
          fail(task, decision.message)
          return
        }

        task.path = decision.path
        task.fileName = decision.fileName
        writeTask(task)
      })
    }

    function writeTask(task) {
      exportTask(root, task, function (result) {
        if (!result.ok) {
          task.status = JOB_STATUS.failed
          failures.push({ task: task, message: result.value })
          setTimeout(step, 0)
          return
        }

        // La couche ExtendScript renvoie « chemin | octets » : un fichier de
        // taille nulle est un échec, quel que soit le statut de l'appel.
        var parts = String(result.value).split(UNIT)
        var bytes = parseInt(parts[1], 10) || 0
        if (!bytes) {
          task.status = JOB_STATUS.failed
          failures.push({
            task: task,
            message: 'fichier vide ou absent : ' + (parts[0] || task.fileName),
          })
          setTimeout(step, 0)
          return
        }

        task.bytes = bytes
        task.status = task.warnings.length
          ? JOB_STATUS.warning
          : JOB_STATUS.success
        written.push(task)
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
            noteColorMode(task, mode)
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
            function (mode) {
              noteColorMode(task, mode)
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

    createDirectories(
      root,
      planDirectories(tasks, template.report),
      function (folderError) {
        if (folderError) {
          handlers.onError(folderError)
          return
        }
        step()
      }
    )

    return {
      cancel: function () {
        cancelled = true
      },
    }
  }

  /* ---------------------------------------------------------------------- *
   * Documentation du pack
   *
   * Le client final n'est pas designer. Il ne sait pas ce qu'est un vectoriel,
   * il sait qu'il doit envoyer un logo à un imprimeur ou le donner à son
   * webmestre. La documentation est écrite pour lui, et décrit le pack
   * réellement livré — pas un pack idéal.
   * ---------------------------------------------------------------------- */

  /** Ce que chaque format sert à faire, en langage de destinataire. */
  var FORMAT_USE = {
    fr: {
      ai: 'Fichier de travail Illustrator. À transmettre à un graphiste qui doit modifier le logo.',
      eps: 'Format d échange pour l impression. À donner à un imprimeur qui le demande.',
      pdf: 'Pour l impression et pour joindre le logo à un courrier ou un devis.',
      svg: 'Pour votre site internet. Reste net à toutes les tailles.',
      png: 'Pour un écran, une présentation, un réseau social. Fond transparent.',
      jpg: 'Pour un écran, quand un fond blanc convient. Ne gère pas la transparence.',
    },
    en: {
      ai: 'Illustrator working file. Hand it to a designer who needs to edit the logo.',
      eps: 'Print interchange format. Give it to a printer who asks for it.',
      pdf: 'For printing, and for attaching the logo to a letter or a quote.',
      svg: 'For your website. Stays sharp at any size.',
      png: 'For screens, slides and social media. Transparent background.',
      jpg: 'For screens when a white background is fine. No transparency.',
    },
  }

  /** Libellés de la documentation, par langue. */
  var DOC_STRINGS = {
    fr: {
      readme: 'LISEZ-MOI.md',
      guide: 'GUIDE_DES_FICHIERS.txt',
      title: 'Votre logo',
      intro:
        'Ce dossier contient votre logo dans tous les formats dont vous aurez ' +
        'besoin. Vous n avez rien à installer : chaque fichier est prêt à être ' +
        'envoyé ou utilisé tel quel.',
      contentTitle: 'Ce que contient ce dossier',
      whichTitle: 'Quel fichier utiliser',
      formatTitle: 'À quoi sert chaque format',
      backgroundTitle: 'Fond transparent ou fond plein',
      backgroundBody:
        'Les fichiers PNG et SVG ont un fond transparent : posés sur une ' +
        'couleur, ils la laissent apparaître. Les fichiers JPG ont un fond ' +
        'plein, généralement blanc.',
      variantTitle: 'Pourquoi plusieurs versions',
      variantBody:
        'Une version couleur pour la plupart des usages, une version noire et ' +
        'une version blanche pour les fonds qui ne s accordent pas à la ' +
        'couleur, et parfois une version inversée pour les fonds sombres.',
      contactTitle: 'Une question',
      print: 'Pour un imprimeur',
      web: 'Pour votre site internet',
      social: 'Pour les réseaux sociaux',
      edit: 'Pour faire modifier le logo',
      generated: 'Document produit automatiquement avec le pack.',
      files: 'fichiers',
      none: 'Aucun fichier de ce type dans ce pack.',
    },
    en: {
      readme: 'README.md',
      guide: 'FILE_GUIDE.txt',
      title: 'Your logo',
      intro:
        'This folder holds your logo in every format you are likely to need. ' +
        'Nothing to install: each file is ready to send or use as it is.',
      contentTitle: 'What is in this folder',
      whichTitle: 'Which file to use',
      formatTitle: 'What each format is for',
      backgroundTitle: 'Transparent or solid background',
      backgroundBody:
        'PNG and SVG files have a transparent background: placed on a colour, ' +
        'they let it show through. JPG files have a solid background, usually ' +
        'white.',
      variantTitle: 'Why several versions',
      variantBody:
        'A colour version for most uses, a black and a white version for ' +
        'backgrounds the colour does not suit, and sometimes an inverted ' +
        'version for dark backgrounds.',
      contactTitle: 'Any question',
      print: 'For a printer',
      web: 'For your website',
      social: 'For social media',
      edit: 'To have the logo edited',
      generated: 'Document generated automatically with the package.',
      files: 'files',
      none: 'No file of this kind in this package.',
    },
  }

  /** Variables du texte personnalisable du designer. */
  var DOC_VARIABLES = [
    'CLIENT_NAME',
    'BRAND_NAME',
    'PROJECT_NAME',
    'DESIGNER_NAME',
    'STUDIO_NAME',
    'EMAIL',
    'WEBSITE',
    'DELIVERY_DATE',
  ]

  /** Remplace les variables d'un texte libre, en majuscules à double accolade. */
  function fillDocumentVariables(text, values) {
    return String(text || '').replace(
      /\{\{\s*([A-Z_]+)\s*\}\}/g,
      function (match, token) {
        var value = values[token]
        return value === undefined || value === null ? '' : String(value)
      }
    )
  }

  /** Valeurs des variables du texte libre. */
  function documentValues(config) {
    var studio = config.studio || {}
    return {
      CLIENT_NAME: config.clientName || '',
      BRAND_NAME: config.brandName || config.clientName || '',
      PROJECT_NAME: config.projectName || '',
      DESIGNER_NAME: studio.designer || '',
      STUDIO_NAME: studio.name || '',
      EMAIL: studio.email || '',
      WEBSITE: studio.website || '',
      DELIVERY_DATE: deliveryDate(),
    }
  }

  /** Premier fichier livré dans un format donné, ou `null`. */
  function firstOfFormat(written, format) {
    for (var i = 0; i < written.length; i += 1) {
      if (written[i].format === format) {
        return written[i].folder + '/' + written[i].fileName
      }
    }
    return null
  }

  /** Formats effectivement présents dans le pack, dans l'ordre d'usage. */
  function deliveredFormats(written) {
    var order = ['ai', 'eps', 'pdf', 'svg', 'png', 'jpg']
    var seen = {}
    var list = []
    for (var i = 0; i < written.length; i += 1) seen[written[i].format] = true
    for (var f = 0; f < order.length; f += 1) {
      if (seen[order[f]]) list.push(order[f])
    }
    return list
  }

  /**
   * Compose la documentation destinée au client.
   *
   * @returns une liste de `{path, contents}`, relative à la racine du pack.
   */
  function buildDocumentation(config, result) {
    var language = config.docLanguage === 'en' ? 'en' : 'fr'
    var words = DOC_STRINGS[language]
    var uses = FORMAT_USE[language]
    var values = documentValues(config)
    var template = folderTemplate(config.folderTemplate)
    var written = result.written || []

    var lines = []
    function line(text) {
      lines.push(text === undefined ? '' : text)
    }

    line('# ' + words.title + (values.BRAND_NAME ? ' — ' + values.BRAND_NAME : ''))
    line()
    line(words.intro)
    line()

    var message = fillDocumentVariables(config.docMessage, values)
    if (message) {
      line(message)
      line()
    }

    line('## ' + words.contentTitle)
    line()
    var folders = planDirectories(written, template.report)
    folders.sort()
    for (var d = 0; d < folders.length; d += 1) {
      line('- `' + folders[d] + '`')
    }
    line()
    line(written.length + ' ' + words.files + '.')
    line()

    line('## ' + words.whichTitle)
    line()
    var recommendations = [
      [words.print, firstOfFormat(written, 'pdf') || firstOfFormat(written, 'eps')],
      [words.web, firstOfFormat(written, 'svg') || firstOfFormat(written, 'png')],
      [words.social, firstOfFormat(written, 'png') || firstOfFormat(written, 'jpg')],
      [words.edit, firstOfFormat(written, 'ai')],
    ]
    for (var r = 0; r < recommendations.length; r += 1) {
      line(
        '- **' +
          recommendations[r][0] +
          '** : ' +
          (recommendations[r][1]
            ? '`' + recommendations[r][1] + '`'
            : words.none)
      )
    }
    line()

    line('## ' + words.formatTitle)
    line()
    var formats = deliveredFormats(written)
    for (var k = 0; k < formats.length; k += 1) {
      line('- **' + formats[k].toUpperCase() + '** — ' + uses[formats[k]])
    }
    line()

    line('## ' + words.backgroundTitle)
    line()
    line(words.backgroundBody)
    line()
    line('## ' + words.variantTitle)
    line()
    line(words.variantBody)
    line()

    if (values.STUDIO_NAME || values.EMAIL || values.WEBSITE) {
      line('## ' + words.contactTitle)
      line()
      if (values.DESIGNER_NAME) line('- ' + values.DESIGNER_NAME)
      if (values.STUDIO_NAME) line('- ' + values.STUDIO_NAME)
      if (values.EMAIL) line('- ' + values.EMAIL)
      if (values.WEBSITE) line('- ' + values.WEBSITE)
      line()
    }

    line('---')
    line(words.generated + ' ' + values.DELIVERY_DATE)

    var readme = lines.join('\n')

    // La version texte reprend le même contenu, sans balisage : elle s'ouvre
    // d'un double-clic sur n'importe quelle machine.
    var plain = readme
      .replace(/^#+\s*/gm, '')
      .replace(/\*\*/g, '')
      .replace(/`/g, '')

    return [
      { path: joinFolder([template.documentation, words.readme]), contents: readme },
      { path: joinFolder([template.documentation, words.guide]), contents: plain },
    ]
  }

  /* ---------------------------------------------------------------------- *
   * Manifeste et contrôle du pack
   *
   * L'export sait ce qu'il a cru écrire ; le disque sait ce qu'il contient.
   * Le contrôle confronte les deux. Sans lui, « export réussi » resterait une
   * affirmation invérifiable.
   * ---------------------------------------------------------------------- */

  /** Nom du manifeste, destiné à l'audit et au diagnostic. */
  var MANIFEST_NAME = 'PACKAGE_MANIFEST.json'

  /** Compose le manifeste du pack. */
  function buildManifest(config, result) {
    var components = []
    for (var c = 0; c < config.components.length; c += 1) {
      components.push({
        name: config.components[c].name,
        type: config.components[c].type || 'custom',
      })
    }

    var schemes = []
    for (var s = 0; s < config.colorSchemes.length; s += 1) {
      schemes.push(schemeTitle(config.colorSchemes[s]))
    }

    var files = []
    for (var w = 0; w < result.written.length; w += 1) {
      var task = result.written[w]
      files.push({
        path: task.folder + '/' + task.fileName,
        format: task.format,
        component: task.component.name,
        scheme: schemeTitle(task.scheme),
        pass: task.pass,
        bytes: task.bytes || 0,
        status: task.status,
      })
    }

    var warnings = []
    var errors = []
    for (var f = 0; f < result.failures.length; f += 1) {
      var failure = result.failures[f]
      var entry = {
        file: failure.task.folder + '/' + failure.task.fileName,
        message: failure.message,
      }
      if (failure.warning) warnings.push(entry)
      else errors.push(entry)
    }

    var skipped = []
    var ignored = result.skipped || []
    for (var k = 0; k < ignored.length; k += 1) {
      skipped.push(ignored[k].folder + '/' + ignored[k].fileName)
    }

    return {
      generator: 'Logo Forge',
      client: config.clientName || '',
      brand: config.brandName || '',
      project: config.projectName || '',
      version: config.version || '',
      createdAt: deliveryDate(),
      sourceDocument: result.documentName || '',
      folderTemplate: folderTemplate(config.folderTemplate).id,
      components: components,
      colorSchemes: schemes,
      formats: deliveredFormats(result.written),
      files: files,
      skipped: skipped,
      warnings: warnings,
      errors: errors,
    }
  }

  /** Relit la charge utile de `lfListFiles`. */
  function parseFileListing(payload) {
    var files = []
    var lines = String(payload || '').split(UNIT)
    for (var i = 0; i < lines.length; i += 1) {
      if (!lines[i]) continue
      var cut = lines[i].lastIndexOf(':')
      if (cut <= 0) continue
      files.push({
        path: lines[i].substring(0, cut),
        bytes: parseInt(lines[i].substring(cut + 1), 10) || 0,
      })
    }
    return files
  }

  /**
   * Confronte le pack attendu au pack présent sur le disque.
   *
   * @param expected chemins que l'export dit avoir écrits.
   * @param actual contenu réel du dossier, `lfListFiles` à l'appui.
   */
  function auditPackage(expected, actual, options) {
    var settings = options || {}
    var present = {}
    var duplicates = []
    var empty = []
    var seenNames = {}

    for (var a = 0; a < actual.length; a += 1) {
      var file = actual[a]
      present[file.path] = file.bytes
      if (!file.bytes) empty.push(file.path)

      var name = file.path.split('/').pop()
      if (seenNames[name]) {
        duplicates.push(name)
      } else {
        seenNames[name] = true
      }
    }

    var missing = []
    for (var e = 0; e < expected.length; e += 1) {
      if (present[expected[e]] === undefined) missing.push(expected[e])
    }

    var extra = []
    var known = {}
    for (var k = 0; k < expected.length; k += 1) known[expected[k]] = true
    for (var x = 0; x < actual.length; x += 1) {
      // Rapport, documentation et manifeste sont attendus sans figurer dans le
      // plan d'export : ils ne sont pas des fichiers en trop.
      if (known[actual[x].path]) continue
      if (settings.service && settings.service[actual[x].path]) continue
      extra.push(actual[x].path)
    }

    var checks = [
      {
        id: 'count',
        label: 'Nombre de fichiers',
        ok: missing.length === 0,
        detail: actual.length + ' présents pour ' + expected.length + ' attendus',
      },
      {
        id: 'missing',
        label: 'Fichiers manquants',
        ok: missing.length === 0,
        detail: missing.length ? missing.join(', ') : 'aucun',
      },
      {
        id: 'empty',
        label: 'Fichiers vides',
        ok: empty.length === 0,
        detail: empty.length ? empty.join(', ') : 'aucun',
      },
      {
        id: 'duplicates',
        label: 'Noms en double',
        ok: duplicates.length === 0,
        detail: duplicates.length ? duplicates.join(', ') : 'aucun',
      },
      {
        id: 'documentation',
        label: 'Documentation',
        ok: !settings.expectDocumentation || !!settings.documentationPresent,
        detail: settings.expectDocumentation
          ? settings.documentationPresent
            ? 'présente'
            : 'absente'
          : 'non demandée',
      },
      {
        id: 'manifest',
        label: 'Manifeste',
        ok: !!settings.manifestPresent,
        detail: settings.manifestPresent ? 'présent' : 'absent',
      },
    ]

    var failed = 0
    for (var i = 0; i < checks.length; i += 1) {
      if (!checks[i].ok) failed += 1
    }

    return {
      checks: checks,
      missing: missing,
      empty: empty,
      duplicates: duplicates,
      extra: extra,
      expected: expected.length,
      actual: actual.length,
      ready: failed === 0,
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
    FOLDER_TEMPLATES: FOLDER_TEMPLATES,
    DOC_VARIABLES: DOC_VARIABLES,
    fillDocumentVariables: fillDocumentVariables,
    documentValues: documentValues,
    deliveredFormats: deliveredFormats,
    buildDocumentation: buildDocumentation,
    MANIFEST_NAME: MANIFEST_NAME,
    buildManifest: buildManifest,
    parseFileListing: parseFileListing,
    auditPackage: auditPackage,
    folderTemplate: folderTemplate,
    FAVICON_SIZES: FAVICON_SIZES,
    PRINT_FORMATS: PRINT_FORMATS,
    WEB_FORMATS: WEB_FORMATS,
    joinFolder: joinFolder,
    deliveryName: deliveryName,
    NAME_VARIABLES: NAME_VARIABLES,
    DEFAULT_NAME_TEMPLATE: DEFAULT_NAME_TEMPLATE,
    defaultTemplate: defaultTemplate,
    renderNameTemplate: renderNameTemplate,
    nameValues: nameValues,
    deliveryDate: deliveryDate,
    call: call,
    quote: quote,
    sanitize: sanitize,
    pascal: pascal,
    pascalOrEmpty: pascalOrEmpty,
    joinPath: joinPath,
    schemeLabel: schemeLabel,
    schemeTitle: schemeTitle,
    buildFileName: buildFileName,
    planExport: planExport,
    planDirectories: planDirectories,
    buildReport: buildReport,
    formatDuration: formatDuration,
    formatBytes: formatBytes,
    totalBytes: totalBytes,
    countWarnings: countWarnings,
    countFailures: countFailures,
    JOB_STATUS: JOB_STATUS,
    COLLISION_POLICIES: COLLISION_POLICIES,
    versionedName: versionedName,
    resolveCollision: resolveCollision,
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
