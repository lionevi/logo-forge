/**
 * Socle des scénarios de bout en bout.
 *
 * Ces scénarios ouvrent le panneau construit — `dist/index.html`, celui qui
 * part dans l'extension — dans un vrai navigateur, face à un hôte CEP simulé.
 * Ce qu'ils prouvent : l'enchaînement complet, du clic à l'appel ExtendScript.
 * Ce qu'ils ne prouvent pas : le comportement d'Illustrator lui-même, qui ne
 * se vérifie que dans Illustrator (voir docs/TEST-ILLUSTRATOR.md).
 */

import { existsSync, readdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
export const PANEL = resolve(HERE, '../../dist/index.html')

const UNIT = String.fromCharCode(31)

/**
 * Trouve un Chromium utilisable.
 *
 * Aucun n'est téléchargé : le scénario se déclare non exécutable plutôt que
 * d'aller chercher deux cents mégaoctets sans prévenir.
 */
export function findChromium() {
  if (process.env.LOGO_FORGE_CHROMIUM) return process.env.LOGO_FORGE_CHROMIUM

  const roots = ['/opt/pw-browsers', process.env.PLAYWRIGHT_BROWSERS_PATH].filter(
    Boolean,
  )
  for (const root of roots) {
    if (!existsSync(root)) continue
    for (const entry of readdirSync(root)) {
      if (entry.indexOf('chromium') !== 0) continue
      for (const suffix of ['chrome-linux/chrome', 'chrome-mac/Chromium.app']) {
        const candidate = resolve(root, entry, suffix)
        if (existsSync(candidate)) return candidate
      }
    }
  }

  for (const path of [
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/google-chrome',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ]) {
    if (existsSync(path)) return path
  }
  return null
}

/** Charge Playwright, sans l'imposer comme dépendance du projet. */
export async function loadPlaywright() {
  const candidates = [
    'playwright-core',
    'playwright',
    process.env.LOGO_FORGE_PLAYWRIGHT,
  ]
  for (const candidate of candidates) {
    if (!candidate) continue
    try {
      return await import(candidate)
    } catch (error) {
      /* module absent : on essaie le suivant */
    }
  }
  return null
}

/**
 * Hôte ExtendScript simulé.
 *
 * Il tient un disque : c'est ce qui permet de vérifier qu'un fichier annoncé
 * écrit existe vraiment, et de reprendre un lot après un rechargement. Le
 * disque vit dans le stockage local de la page, donc survit à `reload()`.
 */
export function hostScript() {
  return () => {
    const UNIT_ = String.fromCharCode(31)
    window.__lfCalls = []
    window.__lfFail = {}

    const disk = () => JSON.parse(localStorage.getItem('__disk') || '[]')
    const put = (path) => {
      const files = disk()
      if (files.indexOf(path) < 0) files.push(path)
      localStorage.setItem('__disk', JSON.stringify(files))
    }
    const quoted = (script) =>
      (script.match(/"((?:[^"\\]|\\.)*)"/g) || []).map((part) => part.slice(1, -1))
    const filePath = (script) =>
      quoted(script).filter((a) => a.indexOf('/') >= 0)[0] || ''

    window.__adobe_cep__ = {
      evalScript(script, callback) {
        window.__lfCalls.push(script)
        const name = script.split('(')[0]
        let value = 'OK|'

        if (window.__lfFail[name]) {
          value = 'ERR|' + window.__lfFail[name]
        } else if (name.indexOf('lfExport') === 0) {
          const path = filePath(script)
          if (
            window.__lfDiskFull !== undefined &&
            disk().length >= window.__lfDiskFull
          ) {
            value = 'ERR|disque plein'
          } else {
            put(path)
            value = 'OK|' + [path, '4096'].join(UNIT_)
          }
        } else if (name === 'lfWriteIco') {
          const target = quoted(script)[0]
          put(target)
          value = 'OK|' + [target, '1240'].join(UNIT_)
        } else if (name === 'lfWriteTextFile') {
          put(filePath(script))
          value = 'OK|'
        } else if (name === 'lfPing') value = 'OK|pong'
        else if (name === 'lfGetDocumentInfo')
          value = 'OK|' + ['brand.ai', '/tmp/brand.ai', 'rgb', '2'].join(UNIT_)
        else if (name === 'lfDescribeSelection')
          value = 'OK|' + ['12', '12', '0', '0', 'GroupItem,PathItem'].join(UNIT_)
        else if (name === 'lfSetComponent') {
          put('/tmp/lf/Logo.ai')
          value =
            'OK|' +
            [
              'Logo',
              '/tmp/lf/Logo.ai',
              '480',
              '240',
              'rgb',
              '12',
              '1',
              '84210',
              '/tmp/lf/Logo.png',
            ].join(UNIT_)
        } else if (name === 'lfRenderThumbnail')
          value = 'OK|' + ['/tmp/lf/Logo.png', '12'].join(UNIT_)
        else if (name === 'lfCreatePackage')
          value = 'OK|' + ['planche.ai', '800', '600'].join(UNIT_)
        else if (name === 'lfPackageBackground')
          value = 'OK|' + ['800', '600'].join(UNIT_)
        else if (name === 'lfPlaceComponent')
          value = 'OK|' + ['12', '320', '160'].join(UNIT_)
        else if (name === 'lfFinishPackage')
          value = 'OK|' + ['9', '800', '600', '0', 'planche.ai'].join(UNIT_)
        else if (name === 'lfPathExists')
          value = 'OK|' + (disk().indexOf(filePath(script)) >= 0 ? '1' : '0')
        else if (name === 'lfListFiles') {
          const root = filePath(script) + '/'
          value =
            'OK|' +
            disk()
              .filter((path) => path.indexOf(root) === 0)
              .map((path) => path.slice(root.length) + ':4096')
              .join(UNIT_)
        } else if (name === 'lfListColors')
          value = 'OK|' + ['#2680eb:12', '#1d1d1d:8', '#ffffff:3'].join(UNIT_)
        else if (name === 'lfPreflight')
          value =
            'OK|' +
            [
              'colorMode:0:cmyk/cmyk',
              'strayPoints:3:',
              'unpainted:0:',
              'strokes:2:',
              'overprint:0:',
              'richBlack:0:',
              'emptyText:0:',
              'liveText:1:',
              'lockedLayers:0:',
              'hiddenLayers:0:',
              'unusedSwatches:5:',
              'whitespace:1:62',
              'items:12:',
            ].join(UNIT_)
        else if (name === 'lfClean') value = 'OK|3'

        setTimeout(() => callback(value), 0)
      },
    }

    // PNG 1×1 : ce que `cep.fs` renverrait d'une vignette réellement exportée.
    const PNG =
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
    window.cep = {
      encoding: { Base64: 'Base64', UTF8: 'UTF-8' },
      fs: {
        showOpenDialog: () => ({ err: 0, data: ['/tmp/livraison'] }),
        readFile: (path, encoding) =>
          encoding === 'Base64' && /\.png$/.test(path)
            ? { err: 0, data: PNG }
            : { err: 0, data: '' },
      },
      util: { openURLInDefaultBrowser() {} },
    }
  }
}

/** Ouvre le panneau construit, face à l'hôte simulé. */
export async function openPanel(browser) {
  const page = await browser.newPage({ viewport: { width: 320, height: 640 } })
  const faults = []
  page.on('pageerror', (error) => faults.push('pageerror: ' + error.message))
  page.on('console', (message) => {
    if (message.type() === 'error') faults.push('console: ' + message.text())
  })

  await page.addInitScript(hostScript())
  await page.goto('file://' + PANEL)
  await page.waitForTimeout(400)
  return { page, faults }
}

/** Appels ExtendScript reçus, éventuellement filtrés par nom. */
export function calls(page, prefix) {
  return page.evaluate(
    (name) =>
      window.__lfCalls.filter((call) => (name ? call.indexOf(name) === 0 : true)),
    prefix || '',
  )
}

export { UNIT }
