import { chromium } from 'playwright-core'
import path from 'node:path'
import fs from 'node:fs'

const url = process.argv[2] ?? 'http://127.0.0.1:5173/'
const outDir = path.resolve('screenshots')
fs.mkdirSync(outDir, { recursive: true })

const browser = await chromium.launch({ channel: 'chrome', headless: true })
const page = await browser.newPage({ viewport: { width: 1280, height: 840 }, deviceScaleFactor: 2 })
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
page.on('console', (m) => {
  if (m.type() === 'error' && !m.text().includes('favicon')) errors.push(m.text())
})

await page.goto(url, { waitUntil: 'networkidle' })
await page.waitForTimeout(800)
await page.screenshot({ path: path.join(outDir, '01-picker.png') })

async function scene(id, name, playMs = 1800) {
  await page.evaluate((pid) => window.app.loadPreset(pid), id)
  await page.waitForTimeout(350)
  await page.screenshot({ path: path.join(outDir, `${name}-initial.png`) })
  await page.evaluate(() => window.app.togglePlay())
  await page.waitForTimeout(playMs)
  await page.evaluate(() => {
    window.app.playing = false
  })
  await page.waitForTimeout(120)
  await page.screenshot({ path: path.join(outDir, `${name}-played.png`) })
}

await scene('incline', '10-incline', 1400)
await scene('trough', '11-trough', 1600)
await scene('loop', '12-loop', 2600)
await scene('projectile', '13-projectile', 2200)

// 半圆槽 A/B
await page.evaluate(() => window.app.loadPreset('trough'))
await page.evaluate(() => window.app.toggleCompare())
await page.evaluate(() => window.app.togglePlay())
await page.waitForTimeout(2000)
await page.evaluate(() => {
  window.app.playing = false
})
await page.screenshot({ path: path.join(outDir, '20-trough-compare.png') })

// 圆轨道找临界
await page.evaluate(() => window.app.loadPreset('loop'))
await page.evaluate(() => window.app.runSearch())
await page.waitForFunction(() => window.app.search && window.app.search.running === false, null, { timeout: 60000 })
await page.waitForTimeout(200)
await page.screenshot({ path: path.join(outDir, '21-loop-search.png') })
const search = await page.evaluate(() => ({
  message: window.app.search?.message,
  theory: window.app.doc.search?.theory,
  flips: window.app.search?.outcome?.flips,
  runs: window.app.search?.outcome?.runs,
}))

// 斜面 A/B：质点 vs 刚体
await page.evaluate(() => window.app.loadPreset('incline'))
await page.evaluate(() => window.app.toggleCompare())
await page.evaluate(() => window.app.togglePlay())
await page.waitForTimeout(1200)
await page.evaluate(() => { window.app.playing = false })
await page.screenshot({ path: path.join(outDir, '23-incline-compare.png') })

// 平抛 A/B
await page.evaluate(() => window.app.loadPreset('projectile'))
await page.evaluate(() => window.app.toggleCompare())
await page.evaluate(() => window.app.togglePlay())
await page.waitForTimeout(1600)
await page.evaluate(() => {
  window.app.playing = false
})
await page.screenshot({ path: path.join(outDir, '22-projectile-compare.png') })

// 移动端尺寸
await page.setViewportSize({ width: 390, height: 780 })
await page.evaluate(() => window.app.loadPreset('trough'))
await page.waitForTimeout(400)
await page.screenshot({ path: path.join(outDir, '30-mobile-trough.png') })
await page.evaluate(() => window.app.loadPreset('incline'))
await page.waitForTimeout(300)
await page.screenshot({ path: path.join(outDir, '31-mobile-incline.png') })

console.log(JSON.stringify({ search, errors }, null, 2))
await browser.close()
