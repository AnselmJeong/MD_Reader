import { build } from 'esbuild'
import { spawnSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
mkdirSync('.tmp', { recursive: true })
for (const [name, input] of [['codex', 'codex-server'], ['claude', 'claude-cli']]) {
  await build({ entryPoints: [`tests/fixtures/${input}.ts`], bundle: true, platform: 'node', format: 'esm', outfile: `.tmp/${name}-fixture.mjs` })
}
await build({ entryPoints: ['tests/subscriptions.smoke.ts'], bundle: true, platform: 'node', packages: 'external', outfile: '.tmp/subscriptions.cjs' })
const result = spawnSync(require('electron'), ['.tmp/subscriptions.cjs'], { stdio: 'inherit' })
if (result.error) throw result.error
process.exit(result.status ?? 1)
