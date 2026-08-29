#!/usr/bin/env node
/**
 * Contrôle de mise en page du panneau, avant livraison.
 *
 * Un panneau CEP dont la hauteur dépend de `vh` s'effondre à zéro : la
 * fenêtre d'un panneau ne résout pas ces unités. Il ne reste que l'en-tête sur
 * un fond gris, et rien ne dit pourquoi. `position: fixed` pose le même genre
 * de piège selon l'hôte.
 *
 * Le contrôle porte sur `dist/index.html` — le fichier réellement livré, après
 * les transformations du build — et sur la source, pour que le défaut se
 * corrige là où il est écrit.
 *
 *     node scripts/check-cep-css.mjs           # vérifie, échoue si défaut
 *     node scripts/check-cep-css.mjs --fix     # corrige la SOURCE, puis vérifie
 *
 * `--fix` ne touche jamais `dist/` : un correctif appliqué au livrable seul
 * laisserait la source fautive et le défaut reviendrait au build suivant.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SOURCE = resolve(ROOT, 'src/panel-cep.html')
const BUILT = resolve(ROOT, 'dist/index.html')

/**
 * Ce qui vide un panneau CEP, et par quoi le remplacer.
 *
 * Le remplacement n'est pas une équivalence CSS générale : c'est celui qui
 * convient à un panneau borné par ses quatre côtés, ce qu'est celui-ci.
 */
export const FORBIDDEN = [
  { find: /height:\s*100vh/gi, fix: 'height: 100%', label: 'height: 100vh' },
  { find: /height:\s*100dvh/gi, fix: 'height: 100%', label: 'height: 100dvh' },
  { find: /height:\s*100svh/gi, fix: 'height: 100%', label: 'height: 100svh' },
  {
    find: /min-height:\s*100[ds]?vh/gi,
    fix: 'min-height: 100%',
    label: 'min-height: 100vh',
  },
  { find: /calc\(100[ds]?vh/gi, fix: null, label: 'calc(100vh …)' },
  { find: /\b100[ds]?vh\b/gi, fix: null, label: 'unité vh' },
  { find: /position:\s*fixed/gi, fix: 'position: absolute', label: 'position: fixed' },
]

/**
 * Ce sans quoi le panneau n'a pas de hauteur du tout.
 *
 * C'est le pendant positif de la liste ci-dessus : interdire `vh` ne sert à
 * rien si rien ne le remplace.
 */
export const REQUIRED = [
  {
    label: 'html, body en hauteur pleine',
    test: /html,\s*body\s*\{[^}]*height:\s*100%/i,
  },
  {
    label: '.panel borné par ses quatre côtés',
    test: /\.panel\s*\{[^}]*position:\s*absolute[^}]*top:\s*0[^}]*right:\s*0[^}]*bottom:\s*0[^}]*left:\s*0/i,
  },
  {
    label: '.panel-body borné en haut et en bas',
    test: /\.panel-body\s*\{[^}]*position:\s*absolute[^}]*top:[^}]*bottom:\s*0/i,
  },
]

/** Feuille de style du document, seule partie qui nous concerne. */
function styleOf(html) {
  const blocks = html.match(/<style[^>]*>([\s\S]*?)<\/style>/gi) || []
  return blocks.join('\n')
}

/**
 * Contrôle un document.
 *
 * @returns la liste des défauts, vide si tout va bien.
 */
export function checkPanel(html, label) {
  const faults = []
  const style = styleOf(html)

  // Les règles se recouvrent — « height: 100vh » relève aussi de « unité vh ».
  // Chaque occurrence est retirée après avoir été signalée, pour qu'un seul
  // défaut ne soit pas compté deux fois.
  let remaining = style
  for (const rule of FORBIDDEN) {
    const hits = remaining.match(rule.find)
    if (!hits) continue
    remaining = remaining.replace(rule.find, '')
    faults.push({
      file: label,
      message: `${rule.label} — ${hits.length} occurrence(s) : la hauteur s effondrera dans CEP`,
      fixable: !!rule.fix,
    })
  }

  for (const rule of REQUIRED) {
    if (rule.test.test(style)) continue
    faults.push({
      file: label,
      message: `${rule.label} — règle absente : le panneau n aura pas de hauteur`,
      fixable: false,
    })
  }

  return faults
}

/** Applique les remplacements connus, et rend le texte corrigé. */
export function fixPanel(html) {
  let out = html
  const applied = []
  for (const rule of FORBIDDEN) {
    if (!rule.fix) continue
    const before = out
    out = out.replace(rule.find, rule.fix)
    if (out !== before) applied.push(`${rule.label} → ${rule.fix}`)
  }
  return { html: out, applied }
}

if (process.argv[1] && process.argv[1].endsWith('check-cep-css.mjs')) {
  const wantsFix = process.argv.indexOf('--fix') >= 0

  if (wantsFix) {
    const { html, applied } = fixPanel(readFileSync(SOURCE, 'utf8'))
    if (applied.length) {
      writeFileSync(SOURCE, html)
      for (const note of applied) {
        process.stdout.write(`corrigé dans la source : ${note}\n`)
      }
      process.stdout.write('Relancez le build pour reporter la correction.\n')
    } else {
      process.stdout.write('Rien à corriger dans la source.\n')
    }
  }

  const faults = [...checkPanel(readFileSync(SOURCE, 'utf8'), relative(ROOT, SOURCE))]
  if (existsSync(BUILT)) {
    faults.push(...checkPanel(readFileSync(BUILT, 'utf8'), relative(ROOT, BUILT)))
  }

  if (faults.length === 0) {
    process.stdout.write('Mise en page : compatible CEP.\n')
    process.exit(0)
  }

  for (const fault of faults) {
    process.stderr.write(`${fault.file} — ${fault.message}\n`)
  }
  if (faults.some((fault) => fault.fixable)) {
    process.stderr.write('\nCorrigeable : node scripts/check-cep-css.mjs --fix\n')
  }
  process.stderr.write(
    `\n${faults.length} défaut(s). Le panneau serait vide dans Illustrator :\n` +
      'le build refuse de le livrer.\n',
  )
  process.exit(1)
}
