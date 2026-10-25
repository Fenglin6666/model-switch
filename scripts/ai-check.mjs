// 真实接口验证：把几道题喂给 AI，看它到底怎么决定建模。
//
//   LLM_KEY=xxx node scripts/ai-check.mjs
//   LLM_KEY=xxx node scripts/ai-check.mjs --dump      # 额外打印每道题的完整场景摘要
//
// key 只从环境变量读，**不写文件**（仓库是 public 的）。
// 需要 dev server 在 5173：走它的 /llm 转发绕开跨域（厂商接口的预检过不去）。
//
// 这里不自己拼请求，而是调 app.generateAsync —— 测的是真实链路：
// 设置读取 → 提示词 → 请求 → 解析 → 校验 → 落库 → 打开画布。
import { chromium } from 'playwright-core'

const KEY = process.env.LLM_KEY
if (!KEY) {
  console.error('缺少 LLM_KEY 环境变量')
  process.exit(1)
}
const DUMP = process.argv.includes('--dump')

const CASES = [
  {
    name: '单斜面（规则也能建，看参数抽得准不准）',
    text: '倾角 30° 的斜面长 2 m，动摩擦因数 0.25，小滑块从顶端由静止下滑，求到底端的速度。',
    expect: 'preset:incline',
  },
  {
    name: '斜面→水平→圆弧（多过程，规则一定拒绝）',
    text: '倾角 37° 的斜面长 2 m，底端接一段长 1.5 m 的粗糙水平面（动摩擦因数 0.2），再进入半径 0.6 m 的光滑圆弧，小球从斜面顶端由静止滑下。',
    expect: 'chain 或 preset:rampArc',
  },
  {
    name: '半圆槽可移动（看会不会挑错模型）',
    text: '质量 M=0.5kg 的半圆槽放在光滑水平面上，槽半径 R=0.4m。质量 m=0.2kg 的小球从槽左端与圆心等高处由静止释放，求小球能到达的最大高度。',
    expect: 'preset:trough',
  },
  {
    name: '竖直圆轨道（临界题）',
    text: '小球在竖直平面内的光滑圆轨道内侧运动，轨道半径 0.5 m，小球恰能通过最高点，求最低点的速度。',
    expect: 'preset:loop',
  },
  {
    name: '电磁感应（应该明确拒绝）',
    text: '一矩形线圈在匀强磁场中绕垂直于磁场的轴匀速转动，线圈面积 0.02 m²，磁感应强度 0.5 T，角速度 100 rad/s，求感应电动势的最大值。',
    expect: 'unsupported',
  },
  {
    name: '传送带（应该明确拒绝，不是硬套）',
    text: '水平传送带以 2 m/s 匀速运动，把一个物块轻放在传送带左端，物块与传送带间动摩擦因数 0.2，传送带长 3 m，求物块从左端运动到右端的时间。',
    expect: 'unsupported',
  },
]

const browser = await chromium.launch({ channel: 'chrome', headless: true })
const page = await browser.newPage({ viewport: { width: 1280, height: 840 } })
page.on('pageerror', (e) => console.log('[pageerror]', e.message))
await page.goto('http://127.0.0.1:5173/')
await page.waitForFunction(() => !!window.app)

// 注入 AI 设置（模拟用户在「用户页 → AI 建模」里填的）
await page.evaluate((key) => {
  localStorage.setItem('slogan.ai.v1', JSON.stringify({ key, model: 'glm-4.6', endpoint: '/llm/chat/completions' }))
  localStorage.removeItem('slogan.library.v1')
}, KEY)
await page.reload()
await page.waitForFunction(() => !!window.app)
await page.waitForTimeout(300)

const ready = await page.evaluate(() => ({ ready: window.app.aiReady(), label: window.app.aiLabel() }))
console.log(`AI 状态：${JSON.stringify(ready)}\n`)

const results = []
for (const c of CASES) {
  const before = await page.evaluate(() => window.app.library.models.length)
  const r = await page.evaluate(async (text) => {
    const t0 = performance.now()
    const res = await window.app.generateAsync(text)
    const ms = Math.round(performance.now() - t0)
    const m = window.app.library.models[0]
    return {
      ok: res.ok,
      message: res.message,
      ms,
      models: window.app.library.models.length,
      added: window.app.library.models.length > 0,
      title: m?.title,
      preset: m?.scene?.meta?.preset ?? null,
      assumptions: m?.scene?.meta?.assumptions ?? [],
      params: m?.scene?.params ?? {},
      bodies: m?.scene?.bodies?.length ?? 0,
      mode: window.app.mode,
    }
  }, c.text)

  const grew = r.models > before
  const verdict = r.ok && grew ? (r.preset ? `preset:${r.preset}` : 'chain') : 'unsupported'
  const hit =
    c.expect.startsWith('preset:') ? verdict === c.expect : c.expect.includes(verdict) || verdict === 'unsupported'
  console.log(`${hit ? 'PASS' : 'FAIL'}  ${c.name}`)
  console.log(`      → ${verdict}  (${r.ms} ms)${grew ? '  ' + (r.title ?? '') : ''}`)
  // unsupported 不会新增模型，此时 models[0] 是上一题留下的——别拿它当本题结果
  if (grew && r.assumptions.length) console.log(`      假设：${r.assumptions.join('、')}`)
  if (grew && DUMP) console.log(`      参数：${JSON.stringify(r.params)}  物体数：${r.bodies}  mode=${r.mode}`)
  console.log(`      ${r.message}`)
  results.push({ name: c.name, hit })
}

const failed = results.filter((r) => !r.hit)
console.log(`\n${results.length - failed.length}/${results.length} 符合预期`)
await browser.close()
if (failed.length) process.exit(1)
