import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import peggy from 'peggy'
import { defineConfig, type Plugin } from 'vite'

const websiteDir = dirname(fileURLToPath(import.meta.url))
const repoDir = resolve(websiteDir, '..')
const require = createRequire(import.meta.url)
const typescriptLibDir = dirname(require.resolve('typescript'))

const parserVirtualId = 'virtual:funky-parser'
const parserResolvedId = `\0${parserVirtualId}`
const libsVirtualId = 'virtual:typescript-libs'
const libsResolvedId = `\0${libsVirtualId}`

function browserTooling(): Plugin {
  const grammar = readFileSync(resolve(repoDir, 'mock/funky.peggy'), 'utf8')
  const libraries: Record<string, string> = {}
  const pending = ['lib.es2022.d.ts']
  while (pending.length) {
    const name = pending.pop()!
    if (libraries[name] !== undefined) continue
    const source = readFileSync(resolve(typescriptLibDir, name), 'utf8')
    libraries[name] = source
    for (const match of source.matchAll(/<reference\s+lib=["']([^"']+)["']/g)) {
      pending.push(`lib.${match[1]}.d.ts`)
    }
  }

  return {
    name: 'funky-browser-tooling',
    resolveId(id) {
      if (id === parserVirtualId) return parserResolvedId
      if (id === libsVirtualId) return libsResolvedId
      return undefined
    },
    load(id) {
      if (id === parserResolvedId) {
        return peggy.generate(grammar, {
          output: 'source',
          format: 'es',
          grammarSource: 'Funky Draft 0.2',
        })
      }
      if (id === libsResolvedId) return `export default ${JSON.stringify(libraries)};`
      return undefined
    },
  }
}

export default defineConfig({
  root: websiteDir,
  base: './',
  plugins: [browserTooling()],
  resolve: { dedupe: ['typescript'] },
  optimizeDeps: { include: ['typescript'] },
  server: {
    host: '0.0.0.0',
    allowedHosts: true,
    fs: { allow: [repoDir] },
  },
  preview: { host: '0.0.0.0' },
  build: {
    outDir: resolve(repoDir, 'dist'),
    emptyOutDir: true,
    chunkSizeWarningLimit: 4500, // The lazily loaded TypeScript compiler is intentionally bundled for offline checking.
  },
})
