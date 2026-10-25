import { chromium } from 'playwright-core'
import path from 'node:path'
import fs from 'node:fs'

const outDir = path.resolve('screenshots')
fs.mkdirSync(outDir, { recursive: true })

const browser = await chromium.launch({ channel: 'chrome', headless: true })
const page = await browser.newPage({ viewport: { width: 1280, height: 840 }, deviceScaleFactor: 2 })
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
page.on('console', (m) => { if (m.text().startsWith('BEFORE')||m.text().startsWith('AFTER')) console.log(m.text()) })

await page.goto('http://127.0.0.1:5173/', { waitUntil: 'networkidle' })
await page.waitForTimeout(700)

// 空白画布
await page.evaluate(() => window.app.loadBlank())
await page.waitForTimeout(300)
await page.screenshot({ path: path.join(outDir, '40-blank.png') })

// 选矩形工具（左侧栏第二个）
await page.mouse.click(35, 146)
await page.waitForTimeout(120)
// 画一个矩形
await page.mouse.move(520, 330)
await page.mouse.down()
await page.mouse.move(720, 470, { steps: 12 })
await page.mouse.up()
await page.waitForTimeout(300)
await page.screenshot({ path: path.join(outDir, '41-draw-rect.png') })

// 分派为「物体」
const dispatch = await page.evaluate(() => {
  const app = window.app
  const rect = app.dockRect ? null : null
  return { mode: app.mode, bodies: app.doc.bodies.map((b) => b.id + ':' + b.kind) }
})
console.log('after draw', JSON.stringify(dispatch))
await page.evaluate(() => {
  const app = window.app
  app.setDispatch('object')
  app.reset()
})
await page.waitForTimeout(200)
await page.evaluate(() => window.app.togglePlay())
await page.waitForTimeout(900)
await page.evaluate(() => {
  window.app.playing = false
})
await page.screenshot({ path: path.join(outDir, '42-object-falls.png') })

// 点选物体 → 属性面板
const pos = await page.evaluate(() => {
  const app = window.app
  const b = app.doc.bodies.find((x) => x.kind === 'particle')
  const s = app.simA?.state.bodies[b.id]
  const p = app.camera.project({ x: s.x, y: s.y }, 0)
  return p
})
await page.evaluate(() => { const a=window.app; console.log('BEFORE', JSON.stringify(a.doc.bodies.map(b=>b.transform)), JSON.stringify(a.simA.state.bodies)) })
await page.mouse.click(pos.x, pos.y)
await page.waitForTimeout(300)
await page.evaluate(() => { const a=window.app; console.log('AFTER', JSON.stringify(a.doc.bodies.map(b=>b.transform)), JSON.stringify(a.simA.state.bodies)) })
await page.screenshot({ path: path.join(outDir, '43-sheet.png') })

// 斜面上用滚轮缩放
await page.evaluate(() => window.app.loadPreset('incline'))
await page.waitForTimeout(300)
await page.mouse.move(640, 400)
await page.mouse.wheel(0, -600)
await page.waitForTimeout(250)
await page.screenshot({ path: path.join(outDir, '44-zoom.png') })

console.log(JSON.stringify({ errors }))
await browser.close()
