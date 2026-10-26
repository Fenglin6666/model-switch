// 文档事实校验：CODEMAP 里的行数必须和代码一致。
//
//   node scripts/doc-facts.mjs          只检查（不一致就 exit 1）
//   node scripts/doc-facts.mjs --write  把事实块重写进 docs/CODEMAP.md
//
// 为什么要有它：CODEMAP 曾经写 app.ts=1798 行，实际 4772——文档漂移比没有文档更坑，
// 因为它会让人按错误的体积做判断（「这个文件不用拆」）。
import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const START = '<!-- FACTS:START -->'
const END = '<!-- FACTS:END -->'

/** 要盯的文件：改动最频繁、体积最能说明问题的那些 */
const FILES = [
  'packages/ui/src/app.ts',
  'packages/ui/src/editor/layout.ts',
  'packages/ui/src/editor/drawing.ts',
  'packages/ui/src/pages/bank.ts',
  'packages/ui/src/pages/library.ts',
  'packages/ui/src/pages/user.ts',
  'packages/ui/src/pages/host.ts',
  'packages/ui/src/pages/shared.ts',
  'packages/ui/src/scene-bounds.ts',
  'packages/ui/src/widgets.ts',
  'packages/ui/src/icons.ts',
  'packages/ui/src/chart.ts',
  'packages/core/src/presets.ts',
  'packages/core/src/scene.ts',
  'packages/core/src/ai-plan.ts',
  'packages/core/src/ai-client.ts',
  'packages/core/src/recognize.ts',
  'packages/core/src/bank.ts',
  'packages/core/src/library.ts',
  'packages/core/src/components.ts',
  'packages/core/src/ports.ts',
  'packages/core/src/body-fields.ts',
  'packages/core/src/validate.ts',
  'packages/core/src/params.ts',
  'packages/core/src/criterion.ts',
  'packages/core/src/serialize.ts',
  'packages/render/src/renderer.ts',
  'packages/render/src/camera.ts',
  'packages/physics/src/simulation.ts',
  'packages/physics/src/forces.ts',
  'apps/web/src/main.ts',
  'apps/miniprogram/miniprogram/pages/index/index.js',
]

function lines(rel) {
  const abs = path.join(root, rel)
  if (!fs.existsSync(abs)) return null
  return fs.readFileSync(abs, 'utf8').split('\n').length - (fs.readFileSync(abs, 'utf8').endsWith('\n') ? 1 : 0)
}

const facts = FILES.map((rel) => ({ rel, lines: lines(rel) }))
const missing = facts.filter((f) => f.lines === null)
if (missing.length) {
  console.error('文件不存在：', missing.map((f) => f.rel).join(', '))
  process.exit(1)
}

const table = [
  START,
  '',
  '| 文件 | 行数 |',
  '|---|---:|',
  ...facts.map((f) => `| \`${f.rel}\` | ${f.lines} |`),
  '',
  '> 这张表由 `node scripts/doc-facts.mjs --write` 生成，`node scripts/doc-facts.mjs` 校验。',
  '> **别手改数字**——手改一定会漂。',
  '',
  END,
].join('\n')

const codemapPath = path.join(root, 'docs/CODEMAP.md')
const codemap = fs.readFileSync(codemapPath, 'utf8')
const write = process.argv.includes('--write')

if (write) {
  const next = codemap.includes(START)
    ? codemap.replace(new RegExp(`${START}[\\s\\S]*?${END}`), table)
    : codemap.replace(/\n## /, `\n${table}\n\n## `)
  fs.writeFileSync(codemapPath, next, 'utf8')
  console.log(`已写入 docs/CODEMAP.md（${facts.length} 个文件）`)
} else {
  if (!codemap.includes(START)) {
    console.error('CODEMAP 里没有事实块，先跑 node scripts/doc-facts.mjs --write')
    process.exit(1)
  }
  const block = codemap.slice(codemap.indexOf(START), codemap.indexOf(END))
  const drift = facts.filter((f) => {
    const row = block.split('\n').find((l) => l.includes(`\`${f.rel}\``))
    if (!row) return true
    const n = Number(row.match(/\|\s*(\d+)\s*\|/)?.[1])
    return n !== f.lines
  })
  // 正文里凡是「（NNN 行）」的写法，也校验一遍
  const proseDrift = []
  for (const m of codemap.matchAll(/\(\.\.\/([\w./-]+\.(?:ts|js|mjs))\)（(?:约 )?(\d+) 行）/g)) {
    const rel = m[1]
    const claimed = Number(m[2])
    const actual = lines(rel)
    if (actual !== null && Math.abs(actual - claimed) > Math.max(5, actual * 0.1)) {
      proseDrift.push(`${rel}: 文档写 ${claimed} 行，实际 ${actual} 行`)
    }
  }
  if (drift.length || proseDrift.length) {
    console.error('文档与代码不一致：')
    for (const f of drift) console.error(`  - ${f.rel}：表里没有或数字不对（实际 ${f.lines} 行）`)
    for (const d of proseDrift) console.error(`  - ${d}`)
    console.error('\n跑 node scripts/doc-facts.mjs --write 更新事实块，再手改正文里的「NNN 行」。')
    process.exit(1)
  }
  console.log(`文档与代码一致（${facts.length} 个文件）`)
}
