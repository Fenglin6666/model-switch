// 依次跑三项前置验证（架构 §13）。任何一项失败即退出非零。
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const scripts = ['contact-friction.mjs', 'lorentz-drift.mjs', 'canvas-perf.mjs']
let failed = 0
for (const s of scripts) {
  console.log(`\n========== ${s} ==========`)
  const r = spawnSync(process.execPath, [path.join(here, s)], { stdio: 'inherit' })
  if (r.status !== 0) failed++
}
console.log(failed === 0 ? '\n全部验证通过' : `\n${failed} 项验证失败`)
process.exit(failed === 0 ? 0 : 1)
