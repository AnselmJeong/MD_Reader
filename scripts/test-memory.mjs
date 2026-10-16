import { build } from 'esbuild'
import { spawnSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
mkdirSync('.tmp', { recursive: true })
for (const [name, input, executable] of [
  ['hindsight-tests', 'tests/hindsight.smoke.ts', require('electron')],
  ['epub-context-tests', 'tests/epub-context.test.ts', process.execPath]
]) {
  await build({ entryPoints: [input], bundle: true, platform: 'node', packages: 'external', outfile: `.tmp/${name}.cjs` })
  const result = spawnSync(executable, [`.tmp/${name}.cjs`], { stdio: 'inherit' })
  if (result.error) throw result.error
  if (result.status) process.exit(result.status)
}
