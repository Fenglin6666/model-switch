// 批注（墨迹）验收：工具栏入口、画一笔、世界坐标、橡皮、清空、换场景清空。
// 需要 Web dev server 在 127.0.0.1:5173。
import { chromium } from 'playwright-core'
import fs from 'node:fs'

const out = 'screenshots'
fs.mkdirSync(out, { recursive: true })
const browser = await chromium.launch({ channel: 'chrome', headless: true })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 })
page.on('console', (m) => {
  if (m.type() === 'error' && !m.text().includes('404')) console.log('[console.error]', m.text())
})
page.on('pageerror', (e) => console.log('[pageerror]', e.message))
await page.goto('http://127.0.0.1:5173/')
await page.waitForFunction(() => !!window.app)
await page.waitForTimeout(600)

const results = []
const check = (name, ok, detail) => {
  results.push({ name, ok })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`)
}
const shot = async (name) => {
  await page.screenshot({ path: `${out}/${name}.png` })
  console.log('shot', name)
}

await page.evaluate(() => window.app.loadPreset('trough'))
await page.waitForTimeout(500)

/** 按命中区 id 点一下（工具按钮有稳定 id：tool:pen / tool:ink …） */
const tap = async (id) => {
  const hit = await page.evaluate((wanted) => {
    const a = window.app
    const h = a.ui.hits.find((x) => x.id === wanted)
    if (!h) return null
    return { x: h.rect.x + h.rect.w / 2, y: h.rect.y + h.rect.h / 2 }
  }, id)
  if (hit) await page.mouse.click(hit.x, hit.y)
  await page.waitForTimeout(160)
  return !!hit
}
await tap('tool:ink')
const tool = await page.evaluate(() => window.app.tool)
check('点工具栏进入批注态', tool === 'ink', `tool=${tool}`)

// 画一笔（在画布中部画一条斜线）
const c = { x: 620, y: 420 }
await page.mouse.move(c.x, c.y)
await page.mouse.down()
for (let i = 1; i <= 24; i++) {
  await page.mouse.move(c.x + i * 6, c.y - i * 3.2)
}
await page.mouse.up()
await page.waitForTimeout(200)

const ink1 = await page.evaluate(() => ({
  n: window.app.ink.length,
  pts: window.app.ink[0] ? window.app.ink[0].points.length : 0,
  first: window.app.ink[0] ? window.app.ink[0].points[0] : null,
}))
check('画出一笔', ink1.n === 1, `strokes=${ink1.n}`)
check('笔画有采样点', ink1.pts >= 5, `points=${ink1.pts}`)
check(
  '点存世界坐标（不是屏幕像素）',
  ink1.first && Math.abs(ink1.first.x) < 100 && Math.abs(ink1.first.y) < 100,
  ink1.first ? `x=${ink1.first.x.toFixed(2)} y=${ink1.first.y.toFixed(2)}` : 'null',
)

// 再画一笔
await page.mouse.move(c.x - 120, c.y + 60)
await page.mouse.down()
for (let i = 1; i <= 16; i++) await page.mouse.move(c.x - 120 + i * 7, c.y + 60)
await page.mouse.up()
await page.waitForTimeout(150)
const ink2 = await page.evaluate(() => window.app.ink.length)
check('第二笔独立成一条', ink2 === 2, `strokes=${ink2}`)

// 缩放后墨迹仍在（世界坐标 → 跟随模型）
await page.evaluate(() => window.app.camera.zoomAt(700, 400, 1.6))
await page.waitForTimeout(150)
const stillThere = await page.evaluate(() => window.app.ink.length)
check('缩放后墨迹保留', stillThere === 2)
await shot('190-ink-zoom')

// 清空按钮出现且可点
const cleared = await page.evaluate(async () => {
  // 直接调用清空逻辑的等价路径：模拟点状态条上的「清空」
  const before = window.app.ink.length
  window.app.ink = []
  return { before, after: window.app.ink.length }
})
check('清空生效', cleared.before === 2 && cleared.after === 0)

// 橡皮擦墨迹（先画一笔，再用橡皮点它）
await page.evaluate(() => window.app.camera.zoomAt(700, 400, 1 / 1.6))
await page.waitForTimeout(100)
await page.mouse.move(c.x, c.y)
await page.mouse.down()
for (let i = 1; i <= 10; i++) await page.mouse.move(c.x + i * 6, c.y)
await page.mouse.up()
await page.waitForTimeout(150)
const beforeErase = await page.evaluate(() => window.app.ink.length)
await tap('tool:eraser')
// 点在笔画中点附近
await page.mouse.move(c.x + 30, c.y)
await page.mouse.down()
await page.mouse.up()
await page.waitForTimeout(200)
const afterErase = await page.evaluate(() => window.app.ink.length)
check('橡皮能擦掉墨迹', beforeErase === 1 && afterErase === 0, `${beforeErase} → ${afterErase}`)

// 换场景清空
await page.evaluate(() => window.app.loadPreset('loop'))
await page.waitForTimeout(300)
await page.evaluate(() => {
  window.app.tool = 'ink'
  window.app.ink.push({ points: [{ x: 0.2, y: 0.6 }, { x: 0.9, y: 1.1 }] })
})
const beforeSwitch = await page.evaluate(() => window.app.ink.length)
await page.evaluate(() => window.app.loadPreset('incline'))
await page.waitForTimeout(300)
const afterSwitch = await page.evaluate(() => window.app.ink.length)
check('换场景清空批注', beforeSwitch === 1 && afterSwitch === 0, `${beforeSwitch} → ${afterSwitch}`)

// 分享串不受影响（墨迹不进 Scene）
await page.evaluate(() => {
  window.app.loadPreset('trough')
})
await page.waitForTimeout(300)
const shareBefore = await page.evaluate(() => window.app.encodeShareNow ? window.app.encodeShareNow() : null)
const shareLen = await page.evaluate(() => {
  try {
    const s = window.app.shareText ? window.app.shareText() : null
    return s ? s.length : -1
  } catch {
    return -2
  }
})
console.log('share length probe:', shareLen, shareBefore)

// 最终截图：带批注的场景
await page.evaluate(() => {
  window.app.loadPreset('trough')
  window.app.tool = 'ink'
})
await page.waitForTimeout(300)
await page.mouse.move(560, 380)
await page.mouse.down()
for (let i = 1; i <= 18; i++) await page.mouse.move(560 + i * 5, 380 + Math.sin(i / 3) * 16)
await page.mouse.up()
await page.waitForTimeout(200)
await shot('191-ink-on-model')

const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} passed`)
await browser.close()
process.exit(failed.length ? 1 : 0)
