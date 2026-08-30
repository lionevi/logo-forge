import {
  copyFileSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs'
import { resolve } from 'node:path'

import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'

import { collectBrand, inlineBrand } from './scripts/inline-brand.mjs'
import { sourceRevision, stampBuild } from './scripts/stamp-build.mjs'

const root = resolve(import.meta.dirname, 'src')
const outDir = resolve(import.meta.dirname, 'dist')

/**
 * Copie les fichiers statiques à la racine de `dist/`.
 *
 * L'entrée du build est `main.tsx`, pas `index.html` : Vite ne bundle un HTML
 * que si son script porte `type="module"`, or UXP ne charge pas de modules ES.
 * Le HTML du panneau est donc écrit à la main et recopié tel quel, ce qui laisse
 * le contrôle total sur les balises produites.
 */
function copyStaticFiles(): Plugin {
  return {
    name: 'logo-forge:copy-static',
    apply: 'build',
    closeBundle() {
      mkdirSync(outDir, { recursive: true })
      copyFileSync(resolve(root, 'manifest.json'), resolve(outDir, 'manifest.json'))

      // Le panneau servi par CEP est la version vanilla : un seul fichier, sans
      // framework ni bundle, seule forme dont on soit certain qu'elle s'exécute
      // dans le Chromium figé de CEP.
      // Le panneau part en un seul fichier ; les SVG de marque déposés dans
      // `src/assets/` y sont intégrés en ligne. Ce qui manque ne casse rien.
      const { brand, notes } = collectBrand(resolve(root, 'assets'))
      // L'empreinte est posée en dernier : elle porte sur le panneau tel qu'il
      // part, marque comprise. C'est elle qui distingue une copie ancienne
      // restée dans le dossier des extensions d'un défaut non corrigé.
      const revision = sourceRevision(resolve(import.meta.dirname))
      const stamped = stampBuild(
        inlineBrand(readFileSync(resolve(root, 'panel-cep.html'), 'utf8'), brand),
        new Date().toISOString().slice(0, 10),
        revision,
      )
      writeFileSync(resolve(outDir, 'index.html'), stamped.html)
      for (const note of notes) process.stdout.write(`marque : ${note}\n`)
      process.stdout.write(
        `panneau : empreinte ${stamped.stamp}` +
          (revision ? `, depuis ${revision}` : '') +
          '\n',
      )

      // La version React reste livrée à côté, pour l'hôte UXP.
      copyFileSync(resolve(root, 'index.html'), resolve(outDir, 'panel-react.html'))

      // Les deux couches du moteur CEP : orchestration côté panneau, et
      // ExtendScript côté Illustrator. CEP charge la seconde via <ScriptPath>.
      mkdirSync(resolve(outDir, 'js'), { recursive: true })
      copyFileSync(
        resolve(root, 'js/export-engine.js'),
        resolve(outDir, 'js/export-engine.js'),
      )
      // Tous les scripts ExtendScript, pas seulement `main.jsx` : la sonde
      // minimale doit être déployée pour qu'un basculement du `ScriptPath`
      // suffise à trancher, en cas de panne de chargement.
      mkdirSync(resolve(outDir, 'jsx'), { recursive: true })
      for (const name of readdirSync(resolve(root, 'jsx'))) {
        if (!name.endsWith('.jsx')) continue
        copyFileSync(resolve(root, 'jsx', name), resolve(outDir, 'jsx', name))
      }

      // CEP cherche son descripteur dans `CSXS/manifest.xml`, à la racine de
      // l'extension. Le `.debug` autorise le débogage distant d'une extension
      // non signée ; il est sans effet sur une extension signée.
      mkdirSync(resolve(outDir, 'CSXS'), { recursive: true })
      copyFileSync(
        resolve(root, 'cep/manifest.xml'),
        resolve(outDir, 'CSXS/manifest.xml'),
      )
      copyFileSync(resolve(root, 'cep/.debug'), resolve(outDir, '.debug'))
    },
  }
}

export default defineConfig({
  root,
  base: './',
  plugins: [react(), copyStaticFiles()],
  build: {
    outDir,
    emptyOutDir: true,
    // CEP embarque un Chromium figé : CEP 9 est en Chromium 61, CEP 10 en 74.
    // Ni l'un ni l'autre ne sait *parser* `?.` ni `??` (Chrome 80+), et un
    // bundle impossible à parser ne s'exécute pas du tout — panneau blanc, sans
    // message. On abaisse donc la cible pour qu'esbuild les transpile.
    target: ['chrome61'],
    modulePreload: false,
    cssCodeSplit: false,
    sourcemap: false,
    rollupOptions: {
      input: resolve(root, 'main.tsx'),
      output: {
        // UXP ne charge pas de modules ES : le bundle doit être un IIFE unique.
        format: 'iife',
        entryFileNames: 'index.js',
        chunkFileNames: 'index.js',
        assetFileNames: 'assets/[name][extname]',
        // Un découpage produirait des imports dynamiques, que UXP ne résout pas.
        inlineDynamicImports: true,
      },
    },
  },
  define: {
    // React lit `process.env.NODE_ENV` ; `process` n'existe pas sous UXP.
    'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'production'),
  },
})
