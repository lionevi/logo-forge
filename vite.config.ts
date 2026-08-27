import { copyFileSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'

import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'

const root = resolve(__dirname, 'src')
const outDir = resolve(__dirname, 'dist')

/**
 * Copie `manifest.json` et `index.html` à la racine de `dist/`.
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
      for (const file of ['manifest.json', 'index.html']) {
        copyFileSync(resolve(root, file), resolve(outDir, file))
      }
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
    target: 'es2020',
    modulePreload: false,
    cssCodeSplit: false,
    sourcemap: false,
    rollupOptions: {
      input: resolve(root, 'main.tsx'),
      output: {
        // UXP ne charge pas de modules ES : le bundle doit être un IIFE unique.
        format: 'iife',
        entryFileNames: 'main.js',
        chunkFileNames: 'main.js',
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
