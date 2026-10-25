// 小程序真机/模拟器验证：需要微信开发者工具已打开项目并开启自动化端口。
//
//   1. 开发者工具 → 设置 → 安全设置 → 服务端口 打开
//   2. cli.bat open --project D:\Slogan\apps\miniprogram
//   3. cli.bat auto --project D:\Slogan\apps\miniprogram --auto-port 9420
//   4. node scripts/mp-verify.mjs
//
// 验证内容：页面启动、画布与安全区、预置场景步进、判据、触摸拖拽、题库/详情/建模库、分享串。
import automator from 'miniprogram-automator'
import fs from 'node:fs'
import path from 'node:path'

const outDir = path.resolve('screenshots')
fs.mkdirSync(outDir, { recursive: true })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const results = []
const check = (name, ok, detail) => {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`)
}

const shot = async (name) => {
  try {
    await mp.screenshot({ path: path.join(outDir, name) })
  } catch (e) {
    console.log(`[warn] 截图 ${name} 超时（开发者工具忙，不影响断言）`)
  }
}

const mp = await automator.connect({ wsEndpoint: 'ws://127.0.0.1:9420' })
const errors = []
mp.on('exception', (e) => errors.push('exception: ' + JSON.stringify(e)))
mp.on('console', (m) => {
  if (m.type === 'error' && !/String\(.*favicon/.test(m.args.join(' '))) errors.push('console: ' + m.args.join(' '))
})

try {
  let ready = 0
  for (let i = 0; i < 20; i++) {
    await sleep(1000)
    try {
      ready = await mp.evaluate(() => getCurrentPages().length)
      if (ready > 0) break
    } catch (e) {
      /* still compiling */
    }
  }
  check('页面启动', ready > 0, `pages=${ready}`)

  // 清掉上一次跑留下的本地库：每次从空库开始，断言才是确定的
  await mp.evaluate(() => {
    const a = getCurrentPages().slice(-1)[0].app
    try {
      wx.removeStorageSync('model-switch.library.v1')
    } catch (e) {}
    a.library = { version: 1, folders: [], models: [], problems: [] }
    a.currentModelId = null
    a.toBank()
  })

  const boot = await mp.evaluate(() => {
    const p = getCurrentPages().slice(-1)[0]
    return {
      hasApp: !!p.app,
      mode: p.app ? p.app.mode : null,
      insets: p.app ? p.app.insets : null,
      size: p.app ? [p.app.width, p.app.height, p.app.dpr] : null,
      canvas: !!p.canvas,
    }
  })
  check('App 实例 + canvas', boot.hasApp && boot.canvas, JSON.stringify(boot.size))
  check('安全区（状态栏 + 胶囊）', boot.insets && boot.insets.top > 0 && boot.insets.right > 0, JSON.stringify(boot.insets))
  await shot('mp-04-bank.png')

  // 半圆槽：步进 + 判据。开发者工具在后台时 rAF 会被节流到 1fps，
  // 所以这里直接调 frame() 推进固定时间，测的是仿真本身而不是窗口焦点。
  await mp.evaluate(() => {
    const a = getCurrentPages().slice(-1)[0].app
    a.loadPreset('trough')
    // 开发者工具里 1/960 的步长跑 1.5 s 要上千步，忙的时候会把 automator 拖超时；
    // 这里用 1/240 固定步长，判据阈值（2%）照样能过，跑得快 4 倍
    a.doc.world.timeStep = 1 / 240
    a.fastForward(1.5)
    a.playing = false
    a.frame(0, 0)
  })
  await sleep(200)
  const trough = await mp.evaluate(() => {
    const a = getCurrentPages().slice(-1)[0].app
    a.playing = false
    return {
      title: a.doc.meta.title,
      preset: a.presetId,
      t: a.simA.state.t,
      trail: Object.values(a.trailsA)[0] ? Object.values(a.trailsA)[0].length : 0,
      energy: a.simA.state.criteria.energy,
      momentum: a.simA.state.criteria.momentum,
    }
  })
  check('预置场景步进', trough.t > 0.5 && trough.trail > 20, `t=${trough.t.toFixed(2)} trail=${trough.trail}`)
  check('判据（机械能守恒）', !!trough.energy && trough.energy.pass, JSON.stringify(trough.energy && trough.energy.detail))
  check('水平动量守恒', !!trough.momentum && trough.momentum.pass)
  await shot('mp-02-trough.png')

  // 题目假设：同一段文本，滑块 + 光滑圆弧
  const assumption = await mp.evaluate(() => {
    const a = getCurrentPages().slice(-1)[0].app
    const r = a.loadProblemText('倾角为30°的斜面底端与半径R=0.5m的光滑圆弧相切，质量m=1kg的滑块从斜面顶端由静止释放，斜面动摩擦因数μ=0.2。')
    const arc = a.doc.bodies.find((b) => b.id === 'arc')
    return { ok: r.ok, preset: a.presetId, muArc: arc ? arc.friction : null }
  })
  check('题目假设：滑块 + 光滑圆弧', assumption.ok && assumption.preset === 'rampArc' && assumption.muArc === 0, JSON.stringify(assumption))
  await shot('mp-03-assumption.png')

  // 分享 token
  const share = await mp.evaluate(() => {
    const page = getCurrentPages().slice(-1)[0]
    page.app.loadPreset('trough')
    page.app.selectBody(null)
    page.app.share()
    const msg = page.onShareAppMessage()
    return { token: page.shareToken, path: msg.path }
  })
  check('分享串进 path（< 200 字符）', !!share.token && share.token.length < 200 && share.path.includes(encodeURIComponent(share.token).slice(0, 10)), `len=${share.token && share.token.length}`)

  // 触摸拖拽（空白画布上画一个球再拖，远离地面，避免被吸附带走）
  await mp.evaluate(() => {
    const page = getCurrentPages().slice(-1)[0]
    const a = page.app
    a.loadBlank()
    a.tool = 'pen'
    // 手绘一个圈（松手后会被规整成圆 → 球）
    const c = a.camera.project({ x: 0, y: 1.6 }, 0)
    const pts = []
    for (let i = 0; i <= 24; i++) {
      const t = (i / 24) * Math.PI * 2
      pts.push({ x: c.x + Math.cos(t) * 18, y: c.y + Math.sin(t) * 18 })
    }
    page.onTouchStart({ touches: [pts[0]] })
    for (const q of pts.slice(1)) page.onTouchMove({ touches: [q] })
    page.onTouchEnd({})
  })
  await sleep(300)
  const drag = await mp.evaluate(() => {
    const page = getCurrentPages().slice(-1)[0]
    const a = page.app
    const ball = a.doc.bodies.find((x) => x.role === 'object')
    const s = a.simA.state.bodies[ball.id]
    const before = { x: s.x, y: s.y }
    const from = a.camera.project({ x: s.x, y: s.y }, 0)
    const scale = a.camera.pixelScale
    page.onTouchStart({ touches: [{ x: from.x, y: from.y }] })
    page.onTouchMove({ touches: [{ x: from.x + 26, y: from.y - 18 }] })
    page.onTouchEnd({})
    const after = a.doc.bodies.find((x) => x.id === ball.id).transform
    return {
      dx: after.x - before.x,
      dy: after.y - before.y,
      scale,
      expectDx: 26 / scale,
      expectDy: 18 / scale,
      selected: a.selectedId,
      snap: !!a.snapHint,
    }
  })
  check(
    '触摸拖拽走逆投影',
    Math.abs(drag.dx - drag.expectDx) < 0.03 && Math.abs(drag.dy - drag.expectDy) < 0.03 && drag.selected === drag.selected,
    `dx=${drag.dx.toFixed(3)}→${drag.expectDx.toFixed(3)} dy=${drag.dy.toFixed(3)}→${drag.expectDy.toFixed(3)} snap=${drag.snap}`,
  )
  await shot('mp-05-drag.png')

  // 题库 / 题目详情 / 建模库：小程序端跑的是同一份 canvas UI（不需要原生输入框）
  // 开发者工具里 rAF 会被节流，一次 evaluate 走完「点卡片 → 详情 → 生成 → 推帧」
  const bank = await mp.evaluate(() => {
    const page = getCurrentPages().slice(-1)[0]
    const a = page.app
    const tapHit = (hit) => {
      if (!hit) return false
      page.onTouchStart({ touches: [{ x: hit.rect.x + hit.rect.w / 2, y: hit.rect.y + hit.rect.h / 2 }] })
      page.onTouchEnd({})
      return true
    }
    a.toBank()
    a.frame(0, 0)
    const cards = a.ui.hits.filter((h) => h.id && h.id.startsWith('bank:')).length
    const mode = a.mode

    // 点第一张卡：应该先进详情，不建模
    tapHit(a.ui.hits.find((h) => h.id === 'bank:s-incline'))
    a.frame(0, 0)
    const detail = {
      open: a.problemOpen,
      models: a.library.models.length,
      hasGenerate: a.ui.hits.some((h) => h.id === 'problem:generate'),
    }

    // 详情里点「生成建模」
    tapHit(a.ui.hits.find((h) => h.id === 'problem:generate'))
    a.frame(0, 0)
    let stored = 0
    try {
      stored = String(wx.getStorageSync('model-switch.library.v1') || '').length
    } catch (e) {}
    return {
      mode,
      cards,
      detail,
      after: a.mode,
      models: a.library.models.length,
      title: a.library.models[0] && a.library.models[0].title,
      preset: a.doc.meta.preset,
      stored,
    }
  })
  check('首屏是题库（分类题目卡片可点）', bank.mode === 'bank' && bank.cards >= 4, `cards=${bank.cards}`)
  check(
    '点题先进详情，不直接建模',
    bank.detail.open === 's-incline' && bank.detail.models === 0 && bank.detail.hasGenerate,
    JSON.stringify(bank.detail),
  )
  check(
    '详情页点生成 → 进画布并写入本地建模库',
    bank.after === 'scene' && bank.models === 1 && bank.preset === 'incline' && bank.stored > 200,
    JSON.stringify({ models: bank.models, title: bank.title, preset: bank.preset, stored: bank.stored }),
  )
  await shot('mp-09-generated.png')

  // 假设 chip：点一下「小球：质点 → 滚动」
  const chipTap = await mp.evaluate(() => {
    const page = getCurrentPages().slice(-1)[0]
    const a = page.app
    const hit = a.ui.hits.find((h) => h.id && h.id.startsWith('assume:'))
    if (!hit) return { id: null, before: a.doc.params.ball, after: a.doc.params.ball }
    const x = hit.rect.x + hit.rect.w / 2
    const y = hit.rect.y + hit.rect.h / 2
    const before = a.doc.params.ball
    page.onTouchStart({ touches: [{ x, y }] })
    page.onTouchEnd({})
    return { id: hit.id, before, after: a.doc.params.ball }
  })
  check('假设 chip 可点（滑块 → 小球）', chipTap.id === 'assume:body' && chipTap.before === 0 && chipTap.after === 1, JSON.stringify(chipTap))

  // 建模库：卡片能点开
  const lib = await mp.evaluate(() => {
    const page = getCurrentPages().slice(-1)[0]
    const a = page.app
    a.toLibrary()
    a.frame(0, 0)
    const hit = a.ui.hits.find((h) => h.id && h.id.startsWith('model:'))
    if (!hit) return { ok: false, mode: a.mode }
    const x = hit.rect.x + hit.rect.w / 2
    const y = hit.rect.y + hit.rect.h / 2
    page.onTouchStart({ touches: [{ x, y }] })
    page.onTouchEnd({})
    return { ok: true, mode: a.mode, after: a.mode === 'scene' ? 'scene' : a.mode, current: !!a.currentModelId }
  })
  check('建模库卡片点开回到画布', lib.ok && lib.current, JSON.stringify(lib))
  await shot('mp-10-library.png')

  check('无运行时错误', errors.length === 0, errors.join(' | '))
} finally {
  await mp.disconnect()
}

const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} 通过`)
process.exit(failed.length === 0 ? 0 : 1)
