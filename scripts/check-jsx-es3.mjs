#!/usr/bin/env node
/**
 * Contrôle de compatibilité ExtendScript de la couche `src/jsx/`.
 *
 * ExtendScript est un moteur ECMA-262 3e édition, et il ne charge pas un
 * fichier à moitié : la moindre construction qu'il refuse emporte le fichier
 * entier, et *aucune* fonction n'existe plus dans Illustrator. Le symptôme est
 * toujours le même — « lf* n'est pas une fonction », pour les quarante — et il
 * ne dit rien de la cause.
 *
 * Un parseur ne suffit pas ici : acorn imite les navigateurs, pas ExtendScript.
 * Trois défauts ont traversé un `acorn --ecma3` vert avant d'être trouvés dans
 * Illustrator. Ce contrôle-ci interroge donc l'arbre, et interdit nommément ce
 * que le moteur a réellement refusé.
 *
 *     node scripts/check-jsx-es3.mjs
 */

import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import * as acorn from 'acorn'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const JSX_DIR = join(ROOT, 'src/jsx')

/** Nœuds d'une syntaxe postérieure à ES3, et ce qu'ils coûtent. */
const FORBIDDEN_NODES = {
  ForOfStatement: 'for…of',
  SpreadElement: 'opérateur de décomposition',
  RestElement: 'paramètre du reste',
  ObjectPattern: 'décomposition d objet',
  ArrayPattern: 'décomposition de tableau',
  TemplateLiteral: 'gabarit de chaîne',
  TaggedTemplateExpression: 'gabarit étiqueté',
  ArrowFunctionExpression: 'fonction fléchée',
  ClassDeclaration: 'classe',
  ClassExpression: 'classe',
  YieldExpression: 'yield',
  AwaitExpression: 'await',
}

/** Méthodes absentes du moteur : elles ne lèvent qu'à l'exécution. */
const ABSENT_METHODS = [
  [/\.forEach\s*\(/, 'Array.forEach'],
  [/\.map\s*\(/, 'Array.map'],
  [/\.filter\s*\(/, 'Array.filter'],
  [/\.reduce\s*\(/, 'Array.reduce'],
  [/\.some\s*\(/, 'Array.some'],
  [/\.every\s*\(/, 'Array.every'],
  [/\.trim\s*\(/, 'String.trim'],
  [/\bJSON\s*\./, 'JSON'],
  [/\bObject\.(keys|values|create|defineProperty|getOwnPropertyNames)\b/, 'Object.*'],
  [/\bArray\.isArray\b/, 'Array.isArray'],
  [/\bDate\.now\b/, 'Date.now'],
  [/\.bind\s*\(/, 'Function.bind'],
]

/**
 * Contrôle une source, et rend la liste des défauts trouvés.
 *
 * @param source contenu du fichier.
 * @param label nom affiché dans les messages.
 */
export function checkSource(source, label) {
  const faults = []
  const at = (line, message) => faults.push({ file: label, line, message })

  let tree
  try {
    tree = acorn.parse(source, {
      ecmaVersion: 3,
      sourceType: 'script',
      locations: true,
    })
  } catch (error) {
    at(error.loc ? error.loc.line : 0, `ne parse pas en ES3 : ${error.message}`)
    return faults
  }

  const lines = source.split('\n')

  walk(tree, null, true, (node, parent, sourceElements) => {
    const line = node.loc.start.line

    if (FORBIDDEN_NODES[node.type]) {
      at(line, `${FORBIDDEN_NODES[node.type]} : absent d ES3`)
    }

    // Une déclaration de fonction est un « SourceElement » : elle n'est légale
    // qu'au niveau d'un programme ou d'un corps de fonction. Dans un `if`, un
    // `try`, une boucle, ExtendScript rejette le fichier entier — et acorn
    // l'accepte, comme le font les navigateurs.
    if (node.type === 'FunctionDeclaration' && !sourceElements) {
      at(line, `fonction « ${node.id.name} » déclarée dans un ${parent.type}`)
    }

    // `{a, b}` au lieu de `{a: a, b: b}`.
    if (node.type === 'Property' && node.shorthand) {
      at(line, 'propriété raccourcie')
    }

    // Le point décisif. ExtendScript n'insère pas le point-virgule d'une
    // production restreinte — `continue`, `break`, `return` — servant de corps
    // à un `if` sans accolades. Il continue de lire, tombe sur l'instruction
    // suivante, et rend « Attendu : ; ».
    if (
      node.type === 'ContinueStatement' ||
      node.type === 'BreakStatement' ||
      node.type === 'ReturnStatement'
    ) {
      const text = source.slice(node.start, node.end)
      if (!text.trimEnd().endsWith(';')) {
        at(line, `« ${text.split('\n')[0].trim()} » sans point-virgule`)
      }
    }
  })

  // Virgule finale dans un littéral d'objet : refusée par ES3. Celle d'un
  // tableau y est légale, mais le parseur d'ExtendScript n'est pas celui-ci et
  // la distinction ne se vérifierait qu'en production.
  lines.forEach((line, index) => {
    if (!/,\s*$/.test(line)) return
    let next = index + 1
    while (next < lines.length && !lines[next].trim()) next += 1
    const following = (lines[next] || '').trim()
    if (following.startsWith('}') || following.startsWith(']')) {
      at(index + 1, 'virgule finale')
    }
  })

  const withoutComments = source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
  for (const [pattern, name] of ABSENT_METHODS) {
    const match = pattern.exec(withoutComments)
    if (!match) continue
    const line = withoutComments.slice(0, match.index).split('\n').length
    at(line, `${name} : absent du moteur ExtendScript`)
  }

  return faults
}

/** Parcourt l'arbre en suivant les positions « SourceElement ». */
function walk(node, parent, sourceElements, visit) {
  if (!node || typeof node.type !== 'string') return
  visit(node, parent, sourceElements)

  const opens =
    node.type === 'Program' ||
    (node.type === 'BlockStatement' && parent && /Function/.test(parent.type))

  for (const key of Object.keys(node)) {
    if (key === 'loc') continue
    const value = node[key]
    if (Array.isArray(value)) {
      for (const child of value) walk(child, node, opens, visit)
    } else if (value && typeof value.type === 'string') {
      walk(value, node, opens, visit)
    }
  }
}

/** Contrôle tous les scripts ExtendScript du dépôt. */
export function checkAll() {
  const faults = []
  for (const name of readdirSync(JSX_DIR)) {
    if (!name.endsWith('.jsx')) continue
    const path = join(JSX_DIR, name)
    faults.push(...checkSource(readFileSync(path, 'utf8'), relative(ROOT, path)))
  }
  return faults
}

// Exécution directe : rapport et code de sortie.
if (process.argv[1] && process.argv[1].endsWith('check-jsx-es3.mjs')) {
  const faults = checkAll()
  if (faults.length === 0) {
    process.stdout.write('Couche ExtendScript : compatible ES3.\n')
    process.exit(0)
  }
  for (const fault of faults) {
    process.stderr.write(`${fault.file}:${fault.line} — ${fault.message}\n`)
  }
  process.stderr.write(`\n${faults.length} défaut(s).\n`)
  process.exit(1)
}
