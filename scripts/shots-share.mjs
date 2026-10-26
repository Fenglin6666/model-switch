import { chromium } from 'playwright-core'

const browser = await chromium.launch({ channel: 'chrome', headless: true })
const page = await browser.newPage({ viewport: { width: 1280, height: 840 }, deviceScaleFactor: 2 })
const errors = []
page.on('pageerror', (e) => errors.push(e.message))

await page.goto('http://127.0.0.1:5173/', { waitUntil: 'networkidle' })
await page.waitForTimeout(600)
// 打开半圆槽
await page.evaluate(() => window.app.loadPreset('trough'))
await page.waitForTimeout(300)
// 点分享（顶栏最右）
await page.mouse.click(1243, 36)
await page.waitForTimeout(300)
const url = page.url()
console.log('share url length', url.length, url.slice(0, 80))

// 用分享链接重新打开
await page.goto(url, { waitUntil: 'networkidle' })
await page.waitForTimeout(800)
const state = await page.evaluate(() => ({
  mode: window.app.mode,
  title: window.app.doc.meta.title,
  preset: window.app.presetId,
  bodies: window.app.doc.bodies.length,
  constraints: window.app.doc.constraints.length,
}))
const ok = state.mode === 'scene' && state.preset === 'trough' && state.bodies > 1
console.log(`${ok ? 'PASS' : 'FAIL'}  分享链接能还原同一个场景`, JSON.stringify(state))
console.log(JSON.stringify({ errors }))
await page.screenshot({ path: 'screenshots/50-shared.png' })
await browser.close()
if (!ok || errors.length) process.exit(1)
