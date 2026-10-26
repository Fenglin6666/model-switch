// 编辑器截图：README「编辑器：左参数、右舞台、底部图表」那两张。
//
// 为什么单独一个脚本：240/241 原来是手截的，改了版式（8 个工具、品牌字、检查器）
// 就悄悄过期了——README 里挂着一张旧界面的图，比没图更误导。
// 现在这两张有归属，跑一遍就是当前界面。
//
// 需要 Web dev server 在 127.0.0.1:5173。
import { chromium } from 'playwright-core'
import fs from 'node:fs'

const out = 'screenshots'
fs.mkdirSync(out, { recursive: true })
const browser = await chromium.launch({ channel: 'chrome', headless: true })
const page = await browser.newPage({ viewport: { width: 1280, height: 840 }, deviceScaleFactor: 2 })
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
page.on('console', (m) => {
  if (m.type() === 'error' && !m.text().includes('404')) errors.push(m.text())
})

await page.goto('http://127.0.0.1:5173/')
await page.waitForFunction(() => !!window.app)
await page.waitForTimeout(500)

const results = []
const check = (name, ok, detail) => {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`)
}
const wait = (ms = 260) => page.waitForTimeout(ms)
const shot = async (name) => {
  await wait(360)
  await page.screenshot({ path: `${out}/${name}.png` })
}

// 干净起点
await page.evaluate(() => {
  try {
    localStorage.removeItem('slogan.library.v1')
    localStorage.removeItem('model-switch.library.v1')
  } catch (e) {}
})
await page.reload()
await page.waitForFunction(() => !!window.app)
await wait(400)

// 1. 未选中：左面板是场景参数，底部是 v–t 图
const plain = await page.evaluate(() => {
  const a = window.app
  a.loadPreset('incline')
  a.selectedId = null
  a.selectedConstraintId = null
  a.selectedFieldId = null
  a.showWorld = false
  a.frame(0, 0)
  a.fastForward(1.4)
  a.frame(0, 0)
  return {
    tool: a.tool,
    tools: a.ui.hits.filter((h) => h.id && h.id.startsWith('tool:')).length,
    chart: a.doc.observers.some((o) => o.kind === 'chart'),
    title: a.doc.meta.title,
  }
})
check('左面板 8 个工具、底部有 v–t 图', plain.tools === 8 && plain.chart, JSON.stringify(plain))
await shot('240-editor')

// 2. 选中物体：左面板换成物体参数，检查器浮在舞台底部
const picked = await page.evaluate(() => {
  const a = window.app
  // 选「会动的那个」（粒子/刚体），别选地面——检查器内容完全不同
  const body = a.doc.bodies.find((b) => b.kind !== 'static') ?? a.doc.bodies[0]
  a.selectedId = body.id
  a.frame(0, 0)
  return {
    id: body.id,
    kind: body.kind,
    save: a.ui.hits.some((h) => h.id === 'comp:save'),
  }
})
check('选中物体 → 检查器出现，且带「存为组件」入口', picked.kind !== 'static' && picked.save, JSON.stringify(picked))
await shot('241-editor-selected')

// 3. 倍率：第一次点就变慢（找临界靠它，不是靠一键跳）
const speed = await page.evaluate(() => {
  const a = window.app
  const before = a.speed
  const hit = a.ui.hits.find((h) => h.id === 'ctl:speed')
  hit && hit.onClick()
  a.frame(0, 0)
  return { before, after: a.speed, hasChip: !!hit }
})
check(
  '倍率 chip 在舞台上，点一下变慢（0.5×）',
  speed.hasChip && speed.before === 1 && speed.after === 0.5,
  JSON.stringify(speed),
)

// 4. 左面板底部不打架：读数卡（含判据 chip）不能压住「世界/组件/题目/返回」
// 这条是被真实 bug 逼出来的——chip 一长就盖住链接，肉眼看截图才发现的。
const foot = await page.evaluate(() => {
  const a = window.app
  const p = a.panelRect()
  const f = a.footLayout(p, false, 0)
  return { ...f, readoutBottom: f.readoutY + f.readoutH }
})
check(
  '读数卡底边在底部链接之上（不重叠）',
  foot.readoutBottom <= foot.linkTop,
  `readoutBottom=${foot.readoutBottom} linkTop=${foot.linkTop}`,
)

// 5. 左面板能滚到底：滚到上限后上限不能跟着变小
// 这条是被真 bug 逼出来的——panelMaxScroll 里含着 panelScroll，滚一半就互相抵消，
// 结果「机制」区的最后几个滑杆永远滚不出来。
const scroll = await page.evaluate(async () => {
  const a = window.app
  // 用参数最多的场景：单棒切割的棒身上挂着导轨 + 电路，面板一定超过一屏
  a.loadPreset('railEmf')
  await new Promise((r) => setTimeout(r, 200))
  a.selectedId = 'rod'
  await new Promise((r) => setTimeout(r, 200))
  a.panelScroll = -a.panelMaxScroll
  const first = { max: a.panelMaxScroll, scroll: a.panelScroll }
  await new Promise((r) => setTimeout(r, 150))
  return { first, after: { max: a.panelMaxScroll, scroll: a.panelScroll } }
})
check(
  '左面板滚到上限后不回弹（上限不随滚动量缩小）',
  scroll.after.scroll === -scroll.after.max && scroll.after.max > 0,
  JSON.stringify(scroll),
)

check('无运行时错误', errors.length === 0, errors.slice(0, 2).join(' | '))

const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} 通过`)
await browser.close()
if (failed.length) process.exit(1)
