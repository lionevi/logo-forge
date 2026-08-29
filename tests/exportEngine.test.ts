/**
 * Tests du moteur d'export CEP.
 *
 * `src/js/export-engine.js` est en ES5 pur, hors du périmètre TypeScript : rien
 * ne le compile, rien ne le vérifie au build. Ses fonctions pures — plan du
 * pack, nommage, arborescence, rapport — sont donc éprouvées ici, et son
 * enchaînement asynchrone est exercé contre une doublure d'ExtendScript.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import * as acorn from 'acorn'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const ENGINE_SOURCE = readFileSync(
  resolve(import.meta.dirname, '../src/js/export-engine.js'),
  'utf8',
)
const JSX_SOURCE = readFileSync(
  resolve(import.meta.dirname, '../src/jsx/main.jsx'),
  'utf8',
)
const PROBE_SOURCE = readFileSync(
  resolve(import.meta.dirname, '../src/jsx/test-minimal.jsx'),
  'utf8',
)

type EngineFn = (...args: unknown[]) => unknown

/** Le moteur est un script classique : on l'évalue plutôt que de l'importer. */
function loadEngine(): Record<string, EngineFn> {
  const module = { exports: {} as Record<string, EngineFn> }
  const factory = new Function('module', 'window', 'setTimeout', ENGINE_SOURCE)
  factory(module, globalThis, setTimeout)
  return module.exports
}

interface Task {
  pass: string
  kind: string
  format: string
  folder: string
  fileName: string
  scheme: { id: string; name?: string; hex?: string }
  component: { name: string; path: string }
  width?: number
  resolution?: number
}

let engine: ReturnType<typeof loadEngine>

/** Configuration de référence, que chaque cas ajuste. */
function config(overrides: Record<string, unknown> = {}) {
  return {
    clientName: 'Ma Marque',
    outputFolder: '/Users/lea/Livraisons',
    components: [{ name: 'Logo', path: '/tmp/logo.ai' }],
    colorSchemes: [{ id: 'fullColor' }],
    formats: {
      print: { ai: false, pdf: true, eps: false, jpeg: false },
      web: { svg: true, png: false, jpeg: false, ai: false },
    },
    scales: [
      { type: 'web', width: 900, resolution: 72 },
      { type: 'print', width: 2400, resolution: 300 },
    ],
    passes: { print: true, web: true },
    favicon: false,
    separator: '_',
    padding: { top: 0, right: 0, bottom: 0, left: 0 },
    ...overrides,
  }
}

function plan(overrides: Record<string, unknown> = {}): Task[] {
  return (engine.planExport as (c: unknown) => Task[])(config(overrides))
}

beforeEach(() => {
  engine = loadEngine()
})

afterEach(() => {
  vi.restoreAllMocks()
  delete (globalThis as Record<string, unknown>).__adobe_cep__
})

describe('compatibilité du moteur', () => {
  it('parse intégralement en ES5', () => {
    expect(() =>
      acorn.parse(ENGINE_SOURCE, { ecmaVersion: 5, sourceType: 'script' }),
    ).not.toThrow()
  })

  it('la couche ExtendScript parse en ES3, et non en ES5', () => {
    // ExtendScript est un moteur ECMA-262 3e édition. Le vérifier en ES5
    // laissait passer les virgules finales, qu'ES3 refuse : le fichier entier
    // cessait alors de parser, et *aucune* fonction lf* n'existait plus dans
    // Illustrator — « lfPing n'est pas une fonction », pour les quarante.
    expect(() =>
      acorn.parse(JSX_SOURCE, { ecmaVersion: 3, sourceType: 'script' }),
    ).not.toThrow()
  })

  it('la sonde minimale parse elle aussi en ES3', () => {
    // Elle ne sert qu'en cas de panne : elle doit être la dernière chose à
    // pouvoir échouer.
    expect(() =>
      acorn.parse(PROBE_SOURCE, { ecmaVersion: 3, sourceType: 'script' }),
    ).not.toThrow()
  })

  it('ne déclare aucune fonction à l intérieur d un bloc', () => {
    // En ES3, une déclaration de fonction est un « SourceElement » : elle
    // n'est légale qu'au niveau d'un programme ou d'un corps de fonction.
    // Dans un `if`, un `try`, une boucle, elle sort de la grammaire —
    // acorn l'accepte comme le font les navigateurs, ExtendScript non. Le
    // fichier entier est alors rejeté, et aucune fonction lf* n'existe.
    const tree = acorn.parse(JSX_SOURCE, {
      ecmaVersion: 3,
      sourceType: 'script',
      locations: true,
    })

    const offenders: string[] = []
    const walk = (node: unknown, parent: unknown, sourceElements: boolean) => {
      if (!node || typeof node !== 'object') return
      const current = node as Record<string, unknown> & {
        type?: string
        id?: { name: string }
        loc?: { start: { line: number } }
      }
      if (typeof current.type !== 'string') return

      if (current.type === 'FunctionDeclaration' && !sourceElements) {
        offenders.push(`${current.loc!.start.line}: ${current.id!.name}`)
      }

      const parentType = (parent as { type?: string } | null)?.type ?? ''
      const opensSourceElements =
        current.type === 'Program' ||
        (current.type === 'BlockStatement' && /Function/.test(parentType))

      for (const key of Object.keys(current)) {
        if (key === 'loc') continue
        const value = current[key]
        if (Array.isArray(value)) {
          for (const child of value) walk(child, current, opensSourceElements)
        } else if (value && typeof value === 'object') {
          walk(value, current, opensSourceElements)
        }
      }
    }
    walk(tree, null, true)

    expect(offenders).toEqual([])
  })

  it('n emploie pas « finally », que le moteur traite mal', () => {
    // Un `return` traversant un `finally` y perd sa valeur. Le nettoyage se
    // fait donc explicitement sur chaque issue.
    expect(JSX_SOURCE).not.toMatch(/}\s*finally\s*{/)
  })

  it('ne laisse aucune virgule finale dans la couche ExtendScript', () => {
    // ES3 ne les refuse que dans un littéral d'objet — celle d'un tableau y
    // est légale. Toutes sont bannies quand même : le parseur d'ExtendScript
    // n'est pas celui-ci, la distinction ne se vérifie qu'en production, et
    // l'uniformité ne coûte rien. Le parseur au-dessus est l'autorité ; ce
    // contrôle-ci nomme le défaut.
    const lines = JSX_SOURCE.split('\n')
    const offenders: string[] = []
    lines.forEach((line, index) => {
      if (!/,\s*$/.test(line)) return
      let next = index + 1
      while (next < lines.length && !lines[next].trim()) next += 1
      const following = (lines[next] || '').trim()
      if (following.startsWith('}') || following.startsWith(']')) {
        offenders.push(`${index + 1}: ${line.trim()}`)
      }
    })

    expect(offenders).toEqual([])
  })

  it('n utilise aucune méthode absente du moteur ES3', () => {
    // Celles-ci ne font pas échouer le parseur : elles lèvent à l'exécution,
    // au moment le plus coûteux — pendant un export.
    const absent = [
      /\.forEach\(/,
      /\.map\(/,
      /\.filter\(/,
      /\.reduce\(/,
      /\.some\(/,
      /\.every\(/,
      /\.trim\(/,
      /\bJSON\s*\./,
      /\bObject\.(keys|values|create|defineProperty|getOwnPropertyNames)\b/,
      /\bArray\.isArray\b/,
      /\bDate\.now\b/,
      /\.bind\(/,
    ]
    for (const pattern of absent) {
      expect(JSX_SOURCE, String(pattern)).not.toMatch(pattern)
    }
  })

  it("n'utilise pas JSON, absent du moteur ExtendScript", () => {
    expect(JSX_SOURCE).not.toMatch(/\bJSON\s*\./)
  })

  it('expose toutes les fonctions globales que le moteur appelle', () => {
    const called = [...ENGINE_SOURCE.matchAll(/call\(\s*'(lf\w+)'/g)].map(
      (match) => match[1],
    )
    expect(called.length).toBeGreaterThan(5)
    for (const fn of new Set(called)) {
      expect(JSX_SOURCE, fn).toContain(`function ${fn}(`)
    }
  })
})

describe('nommage', () => {
  it('retire les caractères interdits par le système de fichiers', () => {
    expect(engine.sanitize('a/b:c*d?')).toBe('abcd')
  })

  it('met en PascalCase sans accent', () => {
    expect(engine.pascal('Logo Mark')).toBe('LogoMark')
    expect(engine.pascal('Icône Réduite')).toBe('IconeReduite')
  })

  it('nomme les déclinaisons livrées et les personnalisées', () => {
    expect(engine.schemeLabel({ id: 'fullColor' })).toBe('FullColor')
    expect(engine.schemeLabel({ id: 'custom', name: 'Bleu marque' })).toBe('BleuMarque')
  })

  it('applique la convention Client_Composant_Couleur_Taille', () => {
    expect(
      engine.deliveryName(
        { clientName: 'Ma Marque' },
        { name: 'Logo Mark' },
        { id: 'black' },
        900,
        'png',
        '_',
      ),
    ).toBe('MaMarque_LogoMark_Black_900px.png')
  })

  it('omet la taille pour un format vectoriel', () => {
    expect(
      engine.deliveryName(
        { clientName: 'Ma Marque' },
        { name: 'Logo' },
        { id: 'white' },
        0,
        'svg',
        '_',
      ),
    ).toBe('MaMarque_Logo_White.svg')
  })

  it('respecte le séparateur choisi', () => {
    expect(
      engine.deliveryName(
        { clientName: 'Acme', separator: '-' },
        { name: 'Logo' },
        { id: 'black' },
        0,
        'pdf',
        '-',
      ),
    ).toBe('Acme-Logo-Black.pdf')
  })

  it('assemble les chemins selon le séparateur de la racine', () => {
    expect(engine.joinPath('/Users/lea', ['a', 'b.svg'])).toBe('/Users/lea/a/b.svg')
    expect(engine.joinPath('C:\\Users\\lea', ['a', 'b.svg'])).toBe(
      'C:\\Users\\lea\\a\\b.svg',
    )
  })
})

describe('plan en deux passes', () => {
  it('sépare la passe print de la passe web', () => {
    const tasks = plan()
    const passes = tasks.map((t) => t.pass)

    expect(passes).toContain('print')
    expect(passes).toContain('web')
    // Les passes ne s'entrelacent pas : une bascule de mode par passe suffit.
    expect(passes.indexOf('web')).toBeGreaterThan(passes.lastIndexOf('print'))
  })

  it('range chaque fichier sous sa passe, son composant et sa couleur', () => {
    const tasks = plan({ colorSchemes: [{ id: 'black' }] })
    const folders: Record<string, string> = {}
    for (const task of tasks) folders[task.format] = task.folder

    expect(folders.pdf).toBe('Pour_Impression/Logo/Black')
    expect(folders.svg).toBe('Pour_Web/Logo/Black')
  })

  it('respecte les formats propres à chaque passe', () => {
    const tasks = plan({
      formats: {
        print: { ai: true, pdf: true, eps: true, jpeg: false },
        web: { svg: true, png: true, jpeg: false, ai: false },
      },
      scales: [{ type: 'web', width: 900, resolution: 72 }],
    })
    const formats = tasks.map((t) => t.format).sort()

    expect(formats).toEqual(['ai', 'eps', 'pdf', 'png', 'svg'])
  })

  it('ignore une passe désactivée', () => {
    const tasks = plan({ passes: { print: false, web: true } })
    expect(tasks.every((t) => t.pass === 'web')).toBe(true)
  })

  it('multiplie le matriciel par les échelles de sa passe', () => {
    const tasks = plan({
      formats: {
        print: { ai: false, pdf: false, eps: false, jpeg: false },
        web: { svg: false, png: true, jpeg: false, ai: false },
      },
      scales: [
        { type: 'web', width: 400, resolution: 72 },
        { type: 'web', width: 900, resolution: 72 },
        { type: 'print', width: 2400, resolution: 300 },
      ],
    })

    // Seules les échelles web s'appliquent aux PNG de la passe web.
    expect(tasks).toHaveLength(2)
    expect(tasks.map((t) => t.width)).toEqual([400, 900])
  })

  it("n'écrit le fichier source qu'en pleine couleur", () => {
    const tasks = plan({
      colorSchemes: [{ id: 'fullColor' }, { id: 'black' }],
      formats: {
        print: { ai: true, pdf: false, eps: false, jpeg: false },
        web: { svg: false, png: false, jpeg: false, ai: false },
      },
    })

    expect(tasks).toHaveLength(1)
    expect(tasks[0].scheme.id).toBe('fullColor')
  })

  it('ignore un composant qui n’a pas encore été défini', () => {
    const tasks = plan({
      components: [
        { name: 'Logo', path: '/tmp/logo.ai' },
        { name: 'Mark', path: '' },
      ],
    })

    expect(tasks.every((t) => t.component.name === 'Logo')).toBe(true)
  })

  it('groupe les tâches par composant puis par couleur', () => {
    const tasks = plan({
      components: [
        { name: 'Logo', path: '/tmp/a.ai' },
        { name: 'Mark', path: '/tmp/b.ai' },
      ],
      colorSchemes: [{ id: 'fullColor' }, { id: 'black' }],
      passes: { print: false, web: true },
    })

    const keys = tasks.map((t) => t.component.name + '/' + t.scheme.id)
    const unique: string[] = []
    for (const key of keys) {
      if (unique[unique.length - 1] !== key) unique.push(key)
    }
    // Aucun groupe ne réapparaît : chaque ouverture et chaque recolorage
    // ne se produit qu'une fois.
    expect(new Set(unique).size).toBe(unique.length)
  })

  it('ajoute les cinq favicons dans la passe web', () => {
    const tasks = plan({ favicon: true })
    const favicons = tasks.filter((t) => t.fileName.indexOf('favicon') === 0)

    expect(favicons).toHaveLength(5)
    expect(favicons[0].folder).toBe('Pour_Web/Favicon')
    expect(favicons.every((t) => t.pass === 'web')).toBe(true)
  })

  it('renvoie un plan vide sans aucun format', () => {
    expect(
      plan({
        formats: {
          print: { ai: false, pdf: false, eps: false, jpeg: false },
          web: { svg: false, png: false, jpeg: false, ai: false },
        },
      }),
    ).toEqual([])
  })
})

describe('arborescence', () => {
  it('remonte tous les dossiers parents, sans doublon', () => {
    const directories = (engine.planDirectories as (t: Task[]) => string[])(plan())

    expect(directories).toContain('Pour_Impression')
    expect(directories).toContain('Pour_Impression/Logo')
    expect(directories).toContain('Pour_Impression/Logo/FullColor')
    expect(new Set(directories).size).toBe(directories.length)
  })

  it('liste les parents avant leurs enfants', () => {
    const directories = (engine.planDirectories as (t: Task[]) => string[])(plan())
    expect(directories.indexOf('Pour_Web')).toBeLessThan(
      directories.indexOf('Pour_Web/Logo'),
    )
  })

  it('place toujours le dossier du rapport', () => {
    const directories = (engine.planDirectories as (t: Task[]) => string[])(plan())
    expect(directories).toContain('Rapport')
  })
})

describe('échappement ExtendScript', () => {
  it('protège les antislashs des chemins Windows', () => {
    expect(engine.quote('C:\\Users\\lea')).toBe('"C:\\\\Users\\\\lea"')
  })

  it('protège les guillemets', () => {
    expect(engine.quote('dossier "test"')).toBe('"dossier \\"test\\""')
  })
})

describe('rapport HTML', () => {
  const result = {
    written: [
      {
        component: { name: 'Logo' },
        scheme: { id: 'fullColor' },
        format: 'svg',
        folder: 'Pour_Web/Logo/FullColor',
        fileName: 'MaMarque_Logo_FullColor.svg',
      },
    ],
    failures: [
      {
        task: {
          component: { name: 'Mark' },
          scheme: { id: 'black' },
          format: 'eps',
          folder: 'Pour_Impression/Mark/Black',
          fileName: 'MaMarque_Mark_Black.eps',
        },
        message: 'disque plein',
      },
    ],
    cancelled: false,
    durationMs: 12_300,
    documentName: 'marque.ai',
  }

  it('produit un document HTML autonome', () => {
    const html = (engine.buildReport as (c: unknown, r: unknown) => string)(
      config(),
      result,
    )

    expect(html).toMatch(/^<!DOCTYPE html>/)
    // Aucune ressource externe : le rapport voyage avec le pack.
    expect(html).not.toMatch(/<link[^>]+href=/)
    expect(html).not.toMatch(/<script/)
  })

  it('liste les réussites comme les échecs', () => {
    const html = (engine.buildReport as (c: unknown, r: unknown) => string)(
      config(),
      result,
    )

    expect(html).toContain('MaMarque_Logo_FullColor.svg')
    expect(html).toContain('disque plein')
  })

  it('échappe le HTML des noms fournis par l’utilisateur', () => {
    const html = (engine.buildReport as (c: unknown, r: unknown) => string)(
      config({ clientName: '<script>x</script>' }),
      result,
    )

    expect(html).not.toContain('<script>x')
    expect(html).toContain('&lt;script&gt;')
  })

  it('met en forme la durée', () => {
    expect(engine.formatDuration(12_300)).toBe('12.3 s')
    expect(engine.formatDuration(125_000)).toBe('2 min 5 s')
  })
})

/* -------------------------------------------------------------------------- *
 * Enchaînement asynchrone
 * -------------------------------------------------------------------------- */

/** Doublure d'ExtendScript : répond à chaque appel et note ce qu'on lui demande. */
const UNIT = String.fromCharCode(31)

function installHost(options: { failOn?: RegExp; emptyOn?: RegExp } = {}) {
  const calls: string[] = []

  ;(globalThis as Record<string, unknown>).__adobe_cep__ = {
    evalScript(expression: string, callback: (raw: string) => void) {
      calls.push(expression)
      let answer = 'OK|done'

      if (options.failOn && options.failOn.test(expression)) {
        answer = 'ERR|disque plein'
      } else if (expression.indexOf('lfExport') === 0) {
        // Un export répond « chemin | octets » : c'est cette taille qui
        // prouve qu'un fichier existe réellement.
        const bytes = options.emptyOn && options.emptyOn.test(expression) ? 0 : 4096
        answer = 'OK|' + ['/tmp/sortie', bytes].join(UNIT)
      }

      // evalScript est asynchrone : la doublure l'est aussi, sans quoi les
      // tests valideraient un enchaînement que CEP n'accepterait pas.
      setTimeout(() => callback(answer), 0)
    },
  }

  return calls
}

/** Attend la fin d'un export et renvoie son bilan. */
function runExport(
  engineRef: ReturnType<typeof loadEngine>,
  overrides: Record<string, unknown> = {},
): Promise<{ result?: Record<string, unknown>; error?: string }> {
  return new Promise((resolvePromise) => {
    ;(engineRef.runFullExport as (c: unknown, h: unknown) => unknown)(
      config(overrides),
      {
        onProgress: () => {},
        onDone: (result: Record<string, unknown>) => resolvePromise({ result }),
        onError: (error: string) => resolvePromise({ error }),
      },
    )
  })
}

describe('runFullExport', () => {
  it('écrit chaque fichier du plan', async () => {
    installHost()
    const { result } = await runExport(engine)

    expect((result!.written as unknown[]).length).toBe(2)
    expect(result!.failures).toEqual([])
  })

  it('crée les dossiers avant toute exportation', async () => {
    const calls = installHost()
    await runExport(engine)

    const firstFolder = calls.findIndex((c) => c.indexOf('lfCreateFolder') === 0)
    const firstExport = calls.findIndex((c) => c.indexOf('lfExport') === 0)
    expect(firstFolder).toBeGreaterThanOrEqual(0)
    expect(firstFolder).toBeLessThan(firstExport)
  })

  it('bascule le mode colorimétrique selon la passe', async () => {
    const calls = installHost()
    await runExport(engine)

    expect(calls.some((c) => c.indexOf('lfSetColorMode("cmyk")') === 0)).toBe(true)
    expect(calls.some((c) => c.indexOf('lfSetColorMode("rgb")') === 0)).toBe(true)
  })

  it("n'ouvre le document d'un composant qu'aux changements de contexte", async () => {
    const calls = installHost()
    await runExport(engine, {
      formats: {
        print: { ai: false, pdf: true, eps: true, jpeg: false },
        web: { svg: true, png: false, jpeg: false, ai: false },
      },
    })

    // Un composant, une couleur, deux passes : deux ouvertures suffisent pour
    // trois fichiers.
    const opens = calls.filter((c) => c.indexOf('lfOpenComponent') === 0)
    expect(opens).toHaveLength(2)
  })

  it('rouvre le document à chaque changement de couleur', async () => {
    const calls = installHost()
    await runExport(engine, {
      colorSchemes: [{ id: 'fullColor' }, { id: 'black' }, { id: 'white' }],
      passes: { print: false, web: true },
    })

    const recolors = calls.filter((c) => c.indexOf('lfApplyColorScheme') === 0)
    expect(recolors).toHaveLength(3)
  })

  it("transmet le seuil d'inversion à la couche ExtendScript", async () => {
    const calls = installHost()
    await runExport(engine, {
      colorSchemes: [{ id: 'inverted' }],
      passes: { print: false, web: true },
      threshold: 35,
    })

    const recolor = calls.find((c) => c.indexOf('lfApplyColorScheme') === 0)
    expect(recolor).toContain('35')
  })

  it("inverse tout quand aucun seuil n'est fourni", async () => {
    const calls = installHost()
    await runExport(engine, {
      colorSchemes: [{ id: 'inverted' }],
      passes: { print: false, web: true },
    })

    const recolor = calls.find((c) => c.indexOf('lfApplyColorScheme') === 0)
    expect(recolor).toContain('100')
  })

  it('sépare les réserves des échecs dans le décompte', () => {
    const written = [
      { status: 'success', bytes: 1024 },
      { status: 'warning', bytes: 2048 },
    ]
    const failures = [{ warning: true }, {}, {}]

    expect(engine.countWarnings(written as never)).toBe(1)
    expect(engine.countFailures(failures as never)).toBe(2)
    expect(engine.totalBytes(written as never)).toBe(3072)
  })

  it('exprime les tailles en unités lisibles', () => {
    expect(engine.formatBytes(0 as never)).toBe('')
    expect(engine.formatBytes(512 as never)).toBe('512 o')
    expect(engine.formatBytes(2048 as never)).toBe('2 Ko')
    expect(engine.formatBytes((3 * 1024 * 1024) as never)).toBe('3.0 Mo')
  })

  it("range les fichiers selon le modèle d'arborescence", () => {
    const plan = (template: string) =>
      (
        engine.planExport(
          config({
            folderTemplate: template,
            formats: {
              print: { ai: true, pdf: true, eps: false, jpeg: false },
              web: { svg: true, png: false, jpeg: false, ai: false },
            },
          }),
        ) as unknown as Array<{ folder: string; format: string }>
      ).map((task) => task.folder + '/' + task.format)

    // Le client cherche un usage, le designer un format, l'agence une étape.
    expect(plan('client')).toContain('Pour_Impression/Logo/FullColor/pdf')
    expect(plan('technical')).toContain('Print/PDF/Logo/pdf')
    expect(plan('agency')).toContain('01_Sources/Logo/ai')
    expect(plan('agency')).toContain('02_Impression/Logo/FullColor/pdf')
  })

  it("retombe sur le modèle client quand celui demandé n'existe pas", () => {
    const template = engine.folderTemplate('inexistant') as unknown as {
      id: string
    }
    expect(template.id).toBe('client')
  })

  it('crée le dossier de service du modèle, même vide', () => {
    const tasks = engine.planExport(
      config({ folderTemplate: 'agency' }),
    ) as unknown as unknown[]
    const directories = engine.planDirectories(
      tasks as never,
      '05_Rapport' as never,
    ) as unknown as string[]

    expect(directories).toContain('05_Rapport')
  })

  it('ne planifie aucun favicon sans déclinaison retenue', () => {
    // Une tâche sans déclinaison partirait avec une couleur indéfinie.
    const plan = engine.planExport(
      config({ favicon: true, colorSchemes: [] }),
    ) as unknown as unknown[]

    expect(plan).toHaveLength(0)
  })

  it('refuse de compter un fichier vide parmi les réussites', async () => {
    // Illustrator peut répondre OK sans rien avoir écrit : seule la taille
    // du fichier prouve la livraison.
    installHost({ emptyOn: /lfExportSVG/ })
    const { result } = await runExport(engine)

    expect((result!.written as unknown[]).length).toBe(1)
    const failures = result!.failures as Array<{ message: string }>
    expect(failures).toHaveLength(1)
    expect(failures[0].message).toContain('vide')
  })

  it('marque en avertissement un mode colorimétrique non appliqué', async () => {
    // Le fichier existe, mais dans le mauvais espace : ni réussite franche,
    // ni fichier perdu.
    installHost({ failOn: /lfSetColorMode/ })
    const { result } = await runExport(engine)

    const written = result!.written as Array<{ status: string }>
    expect(written.length).toBeGreaterThan(0)
    expect(written[0].status).toBe('warning')

    const failures = result!.failures as Array<{ warning?: boolean }>
    expect(failures.some((entry) => entry.warning)).toBe(true)
  })

  it('donne un état final à chaque tâche', async () => {
    installHost()
    const { result } = await runExport(engine)

    for (const task of result!.written as Array<{ status: string; bytes: number }>) {
      expect(['success', 'warning']).toContain(task.status)
      expect(task.bytes).toBeGreaterThan(0)
    }
  })

  it('poursuit le lot après un échec de fichier', async () => {
    installHost({ failOn: /lfExportSVG/ })
    const { result } = await runExport(engine)

    expect((result!.failures as unknown[]).length).toBe(1)
    expect((result!.written as unknown[]).length).toBe(1)
  })

  it('applique la marge quand elle est demandée', async () => {
    const calls = installHost()
    await runExport(engine, {
      padding: { top: 20, right: 20, bottom: 20, left: 20 },
    })

    expect(calls.some((c) => c.indexOf('lfSetPadding') === 0)).toBe(true)
  })

  it('écrit le rapport en fin de course', async () => {
    const calls = installHost()
    const { result } = await runExport(engine)

    expect(calls.some((c) => c.indexOf('lfWriteTextFile') === 0)).toBe(true)
    expect(result!.reportPath).toContain('Rapport')
  })

  it('range le pack sous le nom du client', async () => {
    const calls = installHost()
    await runExport(engine, { clientName: 'Atelier Nord' })

    expect(calls.some((c) => c.indexOf('Atelier Nord') !== -1)).toBe(true)
  })

  it('refuse un plan vide plutôt que de produire un pack creux', async () => {
    installHost()
    const { error } = await runExport(engine, { components: [] })

    expect(error).toMatch(/Rien a exporter/)
  })
})
