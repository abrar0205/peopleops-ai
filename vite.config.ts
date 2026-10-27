import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

/**
 * Prisma's edge client imports its query compiler as `*.wasm?module` and
 * expects a compiled WebAssembly.Module. Serve the file as an asset and
 * compile it at load time.
 */
function wasmModule(): Plugin {
  const prefix = '\0wasm-module:'
  return {
    name: 'wasm-module',
    enforce: 'pre',
    async resolveId(id, importer) {
      if (!id.endsWith('.wasm?module')) return null
      const resolved = await this.resolve(id.replace(/\?module$/, ''), importer, { skipSelf: true })
      return resolved && prefix + resolved.id
    },
    load(id) {
      if (!id.startsWith(prefix)) return null
      const file = id.slice(prefix.length)
      return `import url from ${JSON.stringify(file + '?url')}\nexport default await WebAssembly.compileStreaming(fetch(url))`
    },
  }
}

export default defineConfig({
  base: './',
  plugins: [react(), wasmModule()],
  build: { target: 'es2022', chunkSizeWarningLimit: 1500 },
  optimizeDeps: { exclude: ['@electric-sql/pglite'], esbuildOptions: { target: 'es2022' } },
  worker: { format: 'es' },
})
