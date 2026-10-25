// 画图验收：手绘识别 / 缩放手柄 / 场笔（箭头·点·×）/ 交互与物理性质。
// 需要 Web dev server 在 127.0.0.1:5173。
import { chromium } from 'playwright-core'
import fs from 'node:fs'

const out = 'screenshots'
fs.mkdirSync(out, { recursive: true })
const browser = await chromium.launch({ channel: 'chrome', headless: true })
const page = await browser.newPage({ viewport: { width: 1280, height: 840 }, deviceScaleFactor: 2 })
page.on('console', (m) => {
  if (m.type() === 'error' && !m.text().includes('404')) console.log('[console.error]', m.text())
})
page.on('pageerror', (e) => console.log('[pageerror]', e.message))
await page.goto('http://127.0.0.1:5173/')
await page.waitForFunction(() => !!window.app)
await page.waitForTimeout(500)

const results = []
const check = (name, ok, detail) => {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`)
}
const wait = (ms = 240) => page.waitForTimeout(ms)
const shot = async (name) => {
  await wait(320)
  await page.screenshot({ path: `${out}/${name}.png` })
}

/** 清空场景，只留地面，切到手绘 */
const reset = () =>
  page.evaluate(() => {
    const a = window.app
    a.loadPreset('incline')
    a.doc.bodies = a.doc.bodies.filter((b) => b.id === 'ground')
    a.doc.fields = []
    a.doc.regions = []
    a.doc.criteria = []
    a.doc.observers = []
    a.rebuild()
    a.tool = 'pen'
  })

/** 按世界坐标折线驱动一次真实笔迹（可选抖动，模拟画不直） */
const stroke = (pts, jitter = 0) =>
  page.evaluate(
    ({ pts, jitter }) => {
      const a = window.app
      // 每次落笔前都回到笔（画完一笔会自动切回选择，和 Excalidraw 一致）
      a.tool = 'pen'
      const screen = pts.map((p) => a.camera.project({ x: p.x + (Math.random() - 0.5) * jitter, y: p.y + (Math.random() - 0.5) * jitter }, 0))
      a.pointerDown(screen[0].x, screen[0].y)
      for (const q of screen.slice(1)) a.pointerMove(q.x, q.y)
      a.pointerUp()
    },
    { pts, jitter },
  )

const circlePts = (cx, cy, r, n = 40) => {
  const out = []
  for (let i = 0; i <= n; i++) {
    const t = (i / n) * Math.PI * 2
    out.push({ x: cx + Math.cos(t) * r, y: cy + Math.sin(t) * r })
  }
  return out
}
const rectPts = (x0, y0, x1, y1, n = 10) => {
  const out = []
  const corners = [
    [x0, y0],
    [x1, y0],
    [x1, y1],
    [x0, y1],
    [x0, y0],
  ]
  for (let i = 0; i < corners.length - 1; i++) {
    const [ax, ay] = corners[i]
    const [bx, by] = corners[i + 1]
    for (let k = 0; k < n; k++) out.push({ x: ax + (bx - ax) * (k / n), y: ay + (by - ay) * (k / n) })
  }
  out.push({ x: x0, y: y0 })
  return out
}

const lastBody = () =>
  page.evaluate(() => {
    const a = window.app
    const b = a.doc.bodies[a.doc.bodies.length - 1]
    return { id: b.id, shape: b.shape.type, label: b.label, kind: b.kind, r: b.shape.r, w: b.shape.w, h: b.shape.h, toast: a.toastText }
  })

// 1. 手绘圆 → 圆（球）
await reset()
await stroke(circlePts(0.4, 1.6, 0.3), 0.012)
const ball = await lastBody()
check('画一个不规整的圆 → 规整成圆', ball.shape === 'circle' && Math.abs(ball.r - 0.3) < 0.03, `r=${ball.r?.toFixed(3)}`)
check('圆默认是「球」（会动的物体），不是地形', ball.kind === 'particle', ball.kind)

// 2. 手绘方块 → 矩形（地形）
await reset()
await stroke(rectPts(-1.4, 0.5, -0.4, 1.3), 0.01)
const box = await lastBody()
check('画一个方块 → 轴对齐矩形', box.shape === 'rect' && Math.abs(box.w - 1) < 0.08 && Math.abs(box.h - 0.8) < 0.08, `${box.w?.toFixed(2)}×${box.h?.toFixed(2)}`)
check('方块默认是地形（固定），不是物体', box.kind === 'static', box.kind)

// 3. 三角 → 多边形
await reset()
await stroke(
  [
    { x: -1.2, y: 0.4 },
    { x: -0.2, y: 0.4 },
    { x: -0.8, y: 1.3 },
    { x: -1.2, y: 0.4 },
  ],
  0.01,
)
const tri = await lastBody()
check('画一个三角 → 多边形（不会被当成矩形）', tri.shape === 'polygon', tri.shape)

// 4. 直线 / 曲线
await reset()
await stroke([
  { x: -1.6, y: 0.6 },
  { x: -0.6, y: 0.9 },
  { x: 0.4, y: 1.2 },
])
const line = await lastBody()
check('画一条线 → 直线', line.shape === 'polyline' && line.label === '直线', line.label)

await reset()
await stroke(
  [
    { x: -1.2, y: 0.5 },
    { x: -0.8, y: 0.9 },
    { x: -0.4, y: 0.7 },
    { x: 0, y: 1.1 },
  ],
  0.004,
)
const curve = await lastBody()
check('画一条曲线 → 折线（不硬套成圆）', curve.shape === 'polyline' && curve.label === '折线', curve.label)

// 5. 画在斜面上 → 自动吸附
await page.evaluate(() => {
  const a = window.app
  a.loadPreset('incline')
  a.tool = 'pen'
})
await wait(200)
const snapInfo = await page.evaluate(() => {
  const a = window.app
  const ramp = a.doc.bodies.find((b) => b.id === 'ramp')
  const t = ramp.transform
  const local = { x: -2.4, y: 0.045 + 0.2 }
  const c = Math.cos(t.angle)
  const s = Math.sin(t.angle)
  const wx = t.x + local.x * c - local.y * s
  const wy = t.y + local.x * s + local.y * c
  const screen = []
  for (let i = 0; i <= 30; i++) {
    const ang = (i / 30) * Math.PI * 2
    screen.push(a.camera.project({ x: wx + Math.cos(ang) * 0.12, y: wy + Math.sin(ang) * 0.12 }, 0))
  }
  a.pointerDown(screen[0].x, screen[0].y)
  for (const q of screen.slice(1)) a.pointerMove(q.x, q.y)
  a.pointerUp()
  const body = a.doc.bodies[a.doc.bodies.length - 1]
  const dist = Math.hypot(body.transform.x - wx, body.transform.y - wy)
  return { id: body.id, dist, r: body.shape.r }
})
check('画在斜面上的球会被吸附上去', snapInfo.dist > 0.02, `|Δ|=${snapInfo.dist.toFixed(3)}`)

// 6. 缩放手柄
const scaled = await page.evaluate((id) => {
  const a = window.app
  a.selectBody(id)
  a.frame(0, 0)
  const h = a.ui.hits.find((x) => x.id === 'resize-handle')
  if (!h) return { ok: false }
  const cx = h.rect.x + h.rect.w / 2
  const cy = h.rect.y + h.rect.h / 2
  const before = a.doc.bodies.find((b) => b.id === id).shape.r
  a.pointerDown(cx, cy)
  a.pointerMove(cx + 36, cy + 36)
  a.pointerUp()
  const after = a.doc.bodies.find((b) => b.id === id).shape.r
  return { ok: true, before, after }
}, snapInfo.id)
check('选中后能拖手柄改大小', scaled.ok && scaled.after > scaled.before * 1.2, `${scaled.before?.toFixed(2)} → ${scaled.after?.toFixed(2)}`)

// 7. 双击切换分类（球 → 地形）
const cycled = await page.evaluate((id) => {
  const a = window.app
  a.selectBody(null)
  a.cycleClassification(id)
  const b = a.doc.bodies.find((x) => x.id === id)
  return { kind: b.kind, role: b.role }
}, snapInfo.id)
check('双击能切换地形/物体/轨道', cycled.role === 'terrain' || cycled.kind === 'static', JSON.stringify(cycled))

// 8. 橡皮擦
const erased = await page.evaluate((id) => {
  const a = window.app
  const b = a.doc.bodies.find((x) => x.id === id)
  const before = a.doc.bodies.length
  const p = a.camera.project({ x: b.transform.x, y: b.transform.y }, 0)
  a.tool = 'eraser'
  a.pointerDown(p.x, p.y)
  a.pointerUp()
  return { before, after: a.doc.bodies.length }
}, snapInfo.id)
check('橡皮擦能删掉画的东西', erased.after === erased.before - 1, `${erased.before} → ${erased.after}`)

// 9. 场：画箭头 → 电场
await reset()
const arrow = await page.evaluate(() => {
  const a = window.app
  a.tool = 'field'
  const from = a.camera.project({ x: 0.2, y: 2.2 }, 0)
  const to = a.camera.project({ x: 0.2, y: 1.2 }, 0)
  a.pointerDown(from.x, from.y)
  a.pointerMove(to.x, to.y)
  a.pointerUp()
  return { pending: a.pendingField }
})
check('画箭头 = 电场（方向沿箭头）', arrow.pending?.type === 'E' && arrow.pending.vector.y < 0, JSON.stringify(arrow.pending))

// 10. 第二笔拖区域 → 只作用在框里
const region = await page.evaluate(() => {
  const a = window.app
  const p1 = a.camera.project({ x: -1.4, y: 1.0 }, 0)
  const p2 = a.camera.project({ x: 1.0, y: 2.4 }, 0)
  a.pointerDown(p1.x, p1.y)
  a.pointerMove(p2.x, p2.y)
  a.pointerUp()
  const f = a.doc.fields[a.doc.fields.length - 1]
  const r = a.doc.regions[a.doc.regions.length - 1]
  return { fields: a.doc.fields.length, regionLabel: r?.label, regionId: f?.regionId, same: f?.regionId === r?.id }
})
check('再拖一块区域 → 电场只作用在框里', region.fields === 1 && region.same && region.regionLabel === 'E 区', JSON.stringify(region))
await shot('230-field-e')

// 11. 点一下 = 磁场向外
const dot = await page.evaluate(() => {
  const a = window.app
  a.tool = 'field'
  const at = a.camera.project({ x: -0.4, y: 1.8 }, 0)
  a.pointerDown(at.x, at.y)
  a.pointerUp()
  const pending = a.pendingField
  a.pointerDown(at.x, at.y)
  a.pointerUp()
  const f = a.doc.fields[a.doc.fields.length - 1]
  return { pending, bz: f.bz, regionId: f.regionId ?? null }
})
check('点一下 = 磁场向外（·）', dot.pending?.type === 'B' && dot.bz > 0, JSON.stringify(dot))

// 12. 画 × = 磁场向里
const cross = await page.evaluate(() => {
  const a = window.app
  a.tool = 'field'
  const c = a.camera.project({ x: -1.3, y: 2.0 }, 0)
  const s = 22
  a.pointerDown(c.x - s, c.y - s)
  a.pointerMove(c.x + s, c.y + s)
  a.pointerUp()
  a.pointerDown(c.x + s, c.y - s)
  a.pointerMove(c.x - s, c.y + s)
  a.pointerUp()
  const pending = a.pendingField
  a.pointerDown(c.x, c.y)
  a.pointerUp()
  const f = a.doc.fields[a.doc.fields.length - 1]
  return { pending, bz: f.bz }
})
check('画一个 × = 磁场向里', cross.pending?.type === 'B' && cross.bz < 0, JSON.stringify(cross))
await shot('231-field-b')

// 13. 工具栏没有组件按钮（画什么就是什么）
const rail = await page.evaluate(() => {
  const a = window.app
  const ids = a.ui.hits.map((h) => h.id).filter((id) => id && id.startsWith('tool:'))
  return {
    tools: ids,
    hasComponentPalette: 'componentOpen' in a,
    hasShapePalette: 'paletteOpen' in a,
  }
})
check(
  '工具栏只剩 7 个工具，没有组件/形状按钮',
  rail.tools.length === 7 && !rail.hasComponentPalette && !rail.hasShapePalette,
  rail.tools.join(','),
)

// 14. 画出来的东西有物理性质（重力下会掉）
await reset()
const physics = await page.evaluate(() => {
  const a = window.app
  const c = a.camera.project({ x: 0, y: 2.6 }, 0)
  const pts = []
  for (let i = 0; i <= 30; i++) {
    const t = (i / 30) * Math.PI * 2
    pts.push({ x: c.x + Math.cos(t) * 18, y: c.y + Math.sin(t) * 18 })
  }
  a.pointerDown(pts[0].x, pts[0].y)
  for (const q of pts.slice(1)) a.pointerMove(q.x, q.y)
  a.pointerUp()
  const id = a.doc.bodies[a.doc.bodies.length - 1].id
  const y0 = a.simA.state.bodies[id].y
  a.fastForward(0.6)
  const y1 = a.simA.state.bodies[id].y
  return { y0, y1, fell: y1 < y0 - 0.3 }
})
check('画出来的球受重力会掉（有物理性质）', physics.fell, `${physics.y0.toFixed(2)} → ${physics.y1.toFixed(2)}`)
await shot('232-drawn-scene')

// 15. 连接工具：画两个球 → 连成绳（工具没变，确认还能用）
await reset()
await stroke(circlePts(-0.8, 2.2, 0.16))
await stroke(circlePts(0.8, 2.2, 0.16))
const rope = await page.evaluate(() => {
  const a = window.app
  const balls = a.doc.bodies.filter((b) => b.role === 'object')
  a.tool = 'connect'
  const p0 = a.camera.project({ x: balls[0].transform.x, y: balls[0].transform.y }, 0)
  const p1 = a.camera.project({ x: balls[1].transform.x, y: balls[1].transform.y }, 0)
  a.pointerDown(p0.x, p0.y)
  a.pointerUp()
  a.pointerDown(p1.x, p1.y)
  a.pointerUp()
  return { balls: balls.length, n: a.doc.constraints.length, type: a.doc.constraints[0]?.type }
})
check('画两个球，连接工具能连成绳', rope.balls === 2 && rope.n === 1 && rope.type === 'rope', JSON.stringify(rope))

// 16. 预置场景的物理没被画图改动碰坏（弹簧能量守恒）
const spring = await page.evaluate(() => {
  const a = window.app
  a.loadPreset('spring')
  a.fastForward(1.5)
  const c = a.simA.state.criteria.energy
  return { pass: c?.pass, err: c?.detail?.error }
})
check('弹簧振子机械能守恒（物理没被改坏）', !!spring.pass, JSON.stringify(spring))

const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} 通过`)
await browser.close()
if (failed.length) process.exit(1)
