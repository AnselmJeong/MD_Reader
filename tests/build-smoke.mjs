// Bundles an Electron smoke test; the model client is swapped for tests/helpers/coach-model-mock.ts.
import { build } from 'esbuild'
import path from 'node:path'
const [entry, outfile] = process.argv.slice(2)
await build({
  entryPoints: [entry], outfile, bundle: true, platform: 'node', packages: 'external', format: 'cjs', logLevel: 'warning',
  plugins: [{ name: 'mock-model', setup(b) {
    b.onResolve({ filter: /\/subscription-client$/ }, () => ({ path: path.resolve('tests/helpers/coach-model-mock.ts') }))
  } }]
})
