/**
 * Canvas2D 手绘 2.5D 渲染器（架构 §4）。
 *
 * 铁律一：渲染器不持有状态，一切从 Scene + 仿真快照派生。
 * 这里只依赖 @core，不认识 Planck——所以 Web / 小程序 / 测试截图共用同一套绘制。
 */
import type { Anchor, Body, Guide, Region, Scene, Shape } from '@core/scene'
import { renderGeometries, type Precision, type RenderGeometry } from '@core/shapes'
import { anchorLocal } from '@core/ports'
import type { Vec2 } from '@core/math'
import { Camera } from './camera'
import { THEME, font, rgba, shade } from './theme'

export type ForceVisual = {
  gx: number
  gy: number
  ax: number
  ay: number
  ex: number
  ey: number
  tx: number
  ty: number
  applied?: Array<{ x: number; y: number }>
}

export type BodyVisual = {
  x: number
  y: number
  angle: number
  vx: number
  vy: number
  ax: number
  ay: number
  contactCount: number
  force?: ForceVisual
}

export type VisualState = {
  bodies: Record<string, BodyVisual>
  trackAttached?: Record<string, boolean>
  gases?: Record<string, { p: number; v: number; t: number; length: number }>
}

export type RenderInput = {
  ctx: CanvasRenderingContext2D
  scene: Scene
  camera: Camera
  state: VisualState | null
  trails?: Record<string, Vec2[]>
  selectedId?: string | null
  selectedConstraintId?: string | null
  showTrails?: boolean
  showVectors?: boolean
  showForces?: boolean
  showConstraints?: boolean
  showGuides?: boolean
  showLabels?: boolean
  precision?: Precision
  time?: number
}

const geomCache = new WeakMap<Shape, Map<Precision, RenderGeometry[]>>()

function getGeom(shape: Shape, precision: Precision): RenderGeometry[] {
  let m = geomCache.get(shape)
  if (!m) {
    m = new Map()
    geomCache.set(shape, m)
  }
  const hit = m.get(precision)
  if (hit) return hit
  const g = renderGeometries(shape, precision)
  m.set(precision, g)
  return g
}

function projectLocal(
  local: Vec2,
  t: { x: number; y: number; angle: number },
  camera: Camera,
  depth: number,
): { x: number; y: number } {
  const c = Math.cos(t.angle)
  const s = Math.sin(t.angle)
  const p = { x: t.x + local.x * c - local.y * s, y: t.y + local.x * s + local.y * c }
  const sp = camera.project(p, depth)
  return { x: sp.x, y: sp.y }
}

function tracePath(ctx: CanvasRenderingContext2D, pts: { x: number; y: number }[], close = true): void {
  if (pts.length === 0) return
  ctx.beginPath()
  ctx.moveTo(pts[0]!.x, pts[0]!.y)
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i]!.x, pts[i]!.y)
  if (close) ctx.closePath()
}

function translate(pts: { x: number; y: number }[], dx: number, dy: number): { x: number; y: number }[] {
  return pts.map((p) => ({ x: p.x + dx, y: p.y + dy }))
}

function signedArea(pts: { x: number; y: number }[]): number {
  let a = 0
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i]!
    const q = pts[(i + 1) % pts.length]!
    a += p.x * q.y - q.x * p.y
  }
  return a / 2
}

function rotateVec(v: { x: number; y: number }, angle: number): { x: number; y: number } {
  const c = Math.cos(angle)
  const s = Math.sin(angle)
  return { x: v.x * c - v.y * s, y: v.x * s + v.y * c }
}

export function renderScene(input: RenderInput): void {
  const { ctx, scene, camera, state } = input
  const precision: Precision = input.precision ?? scene.world.precision ?? 'teach'
  const showTrails = input.showTrails ?? true
  const showVectors = input.showVectors ?? true
  const showForces = input.showForces ?? true
  const showConstraints = input.showConstraints ?? true
  const showGuides = input.showGuides ?? true
  const showLabels = input.showLabels ?? true

  ctx.save()
  drawGrid(ctx, camera)
  drawRegions(ctx, scene, camera, precision)
  drawFields(ctx, scene, camera)
  drawGases(ctx, scene, camera, state)
  if (showConstraints) drawConstraints(ctx, scene, camera, state, input.selectedConstraintId ?? null)
  if (showTrails) drawTrails(ctx, scene, camera, input.trails)

  // 收集并按深度排序：远的先画
  const items = scene.bodies.map((b) => {
    const s = state?.bodies[b.id]
    const pos = s ? { x: s.x, y: s.y } : { x: b.transform.x, y: b.transform.y }
    return { body: b, visual: s, depth: camera.depthOf(pos, 0) }
  })
  items.sort((a, b) => b.depth - a.depth)
  for (const item of items) drawBody(ctx, camera, item.body, item.visual, precision, input)

  // 辅助线是指注，画在物体之上，不该被轨道盖住
  if (showGuides) drawGuides(ctx, scene.guides, camera)
  if (showForces) drawForces(ctx, scene, camera, state, input.selectedId)
  if (showVectors) drawVectors(ctx, scene, camera, state, input.selectedId ?? null)
  if (showLabels) drawBodyLabels(ctx, scene, camera, state, input)
  ctx.restore()
}

// ---------------------------------------------------------------------------
// 网格与地面
// ---------------------------------------------------------------------------

function drawGrid(ctx: CanvasRenderingContext2D, camera: Camera): void {
  const b = camera.visibleBounds()
  const px = camera.pixelScale
  let step = 1
  if (px * step > 120) step = 0.25
  else if (px * step > 70) step = 0.5
  else if (px * step < 28) step = 2
  const startX = Math.floor(b.minX / step) * step
  const startY = Math.floor(b.minY / step) * step
  const maxLines = 140
  ctx.lineWidth = 1
  ctx.strokeStyle = THEME.grid
  ctx.beginPath()
  let n = 0
  for (let x = startX; x <= b.maxX && n < maxLines; x += step, n++) {
    const a = camera.project({ x, y: b.minY }, 0)
    const c = camera.project({ x, y: b.maxY }, 0)
    ctx.moveTo(a.x, a.y)
    ctx.lineTo(c.x, c.y)
  }
  n = 0
  for (let y = startY; y <= b.maxY && n < maxLines; y += step, n++) {
    const a = camera.project({ x: b.minX, y }, 0)
    const c = camera.project({ x: b.maxX, y }, 0)
    ctx.moveTo(a.x, a.y)
    ctx.lineTo(c.x, c.y)
  }
  ctx.stroke()

  // 地面基准线（q=0）：只画一条，帮助判断高度
  if (camera.plane === 'vertical') {
    const p0 = camera.project({ x: b.minX, y: 0 }, 0)
    const p1 = camera.project({ x: b.maxX, y: 0 }, 0)
    ctx.strokeStyle = 'rgba(35,39,47,0.16)'
    ctx.lineWidth = 1.2
    ctx.setLineDash([6, 6])
    ctx.beginPath()
    ctx.moveTo(p0.x, p0.y)
    ctx.lineTo(p1.x, p1.y)
    ctx.stroke()
    ctx.setLineDash([])
  }
}

// ---------------------------------------------------------------------------
// 物体
// ---------------------------------------------------------------------------

function drawBody(
  ctx: CanvasRenderingContext2D,
  camera: Camera,
  body: Body,
  visual: BodyVisual | undefined,
  precision: Precision,
  input: RenderInput,
): void {
  const transform = visual
    ? { x: visual.x, y: visual.y, angle: visual.angle }
    : body.transform
  const geoms = getGeom(body.shape, precision)
  const color = body.appearance.color
  const thin = body.appearance.style === 'thin'
  const isStatic = body.kind === 'static'

  // 地面阴影（竖直面才需要；静态地形不画）
  if (camera.plane === 'vertical' && !isStatic) {
    for (const g of geoms) {
      const pts = g.kind === 'fill' ? g.outlines[0] ?? [] : g.points
      if (pts.length < 2) continue
      const c = Math.cos(transform.angle)
      const s = Math.sin(transform.angle)
      const sp = pts.map((p) => {
        const wp = { x: transform.x + p.x * c - p.y * s, y: transform.y + p.x * s + p.y * c }
        return camera.project({ x: wp.x, y: 0 }, 0)
      })
      ctx.fillStyle = THEME.shadow
      if (g.kind === 'fill') {
        tracePath(ctx, sp)
        ctx.fill()
      } else {
        ctx.strokeStyle = THEME.shadow
        ctx.lineWidth = Math.max(2, g.thick * camera.pixelScale)
        ctx.lineCap = 'round'
        ctx.lineJoin = 'round'
        tracePath(ctx, sp, false)
        ctx.stroke()
      }
    }
  }

  for (const g of geoms) drawGeometry(ctx, camera, g, transform, color, thin)

  // 外观即语义（docs/DRAWING.md §5）：静态地形画 45° 剖面线 = 固定端；
  // 动态体不画，所以「钉住 / 能滑」第一次不依赖阴影就能分辨。
  // 细线地形（style='thin'，斜面/水平段这种「表面符号」）不画：剖面线会把一条线
  // 撑成一块板，看起来像换了个物体。固定的语义留给有厚度的实体（槽、轨道、墙、底座）。
  if (isStatic && !thin) drawFixedHatch(ctx, camera, geoms, transform)
  if (body.charge) drawChargeSign(ctx, camera, body, transform, geoms)

  // 选中高亮
  if (input.selectedId === body.id) {
    for (const g of geoms) {
      const pts = g.kind === 'fill' ? g.outlines[0] ?? [] : g.points
      if (pts.length < 2) continue
      const sp = pts.map((p) => projectLocal(p, transform, camera, 0))
      ctx.lineWidth = 1.6
      ctx.strokeStyle = THEME.accent
      if (g.kind === 'fill') {
        tracePath(ctx, sp)
      } else {
        tracePath(ctx, sp, g.closed)
      }
      ctx.stroke()
    }
  }
}

function drawGeometry(
  ctx: CanvasRenderingContext2D,
  camera: Camera,
  g: RenderGeometry,
  transform: { x: number; y: number; angle: number },
  color: string,
  thin = false,
): void {
  if (thin) {
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.strokeStyle = color
    ctx.lineWidth = 1.6
    if (g.kind === 'fill') {
      for (const outline of g.outlines.filter((o) => o.length >= 3)) {
        tracePath(ctx, outline.map((p) => projectLocal(p, transform, camera, 0)))
        ctx.stroke()
      }
    } else {
      const pts = g.points.map((p) => projectLocal(p, transform, camera, 0))
      if (pts.length >= 2) {
        tracePath(ctx, pts, g.closed)
        ctx.stroke()
      }
    }
    return
  }

  if (g.kind === 'fill') {
    const outlines = g.outlines.filter((o) => o.length >= 3)
    for (const outline of outlines) {
      const pts = outline.map((p) => projectLocal(p, transform, camera, 0))
      // 平面填充：上浅下深的渐变 + 一道细边，比纯色更像"模型件"
      const ys = pts.map((p) => p.y)
      const top = Math.min(...ys)
      const bottom = Math.max(...ys)
      const grad = ctx.createLinearGradient(0, top, 0, bottom)
      grad.addColorStop(0, shade(color, 1.05))
      grad.addColorStop(1, shade(color, 0.9))
      tracePath(ctx, pts)
      ctx.fillStyle = grad
      ctx.fill()
      ctx.lineWidth = 1.4
      ctx.strokeStyle = shade(color, 0.7)
      ctx.stroke()
    }
    return
  }

  const pts = g.points.map((p) => projectLocal(p, transform, camera, 0))
  if (pts.length < 2) return
  const width = Math.max(1.5, g.thick * camera.pixelScale)
  const closed = g.closed
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  // 先铺一条深色底边再压主色，边缘更挺、在浅色纸面上更"立"
  ctx.strokeStyle = shade(color, 0.72)
  ctx.lineWidth = width + 2.2
  tracePath(ctx, pts, closed)
  ctx.stroke()
  ctx.strokeStyle = color
  ctx.lineWidth = width
  tracePath(ctx, pts, closed)
  ctx.stroke()
  // 顶部高光
  ctx.strokeStyle = rgba('#ffffff', 0.35)
  ctx.lineWidth = Math.max(1, width * 0.28)
  tracePath(ctx, pts.map((p) => ({ x: p.x, y: p.y - width * 0.16 })), closed)
  ctx.stroke()
}

// ---------------------------------------------------------------------------
// 视觉语法：固定剖面线 / 带电符号 / 磁场 ×·
// 规则见 docs/DRAWING.md §5 —— 不发明符号，用教材已有的；不抢注意力。
// ---------------------------------------------------------------------------

/** 屏幕上短边小于这个值就不画任何装饰（宁可没有，不要脏） */
const DECO_MIN_SIDE = 24

function screenGeomPoints(
  geoms: RenderGeometry[],
  transform: { x: number; y: number; angle: number },
  camera: Camera,
): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = []
  for (const g of geoms) {
    const local = g.kind === 'fill' ? (g.outlines[0] ?? []) : g.points
    for (const p of local) out.push(projectLocal(p, transform, camera, 0))
  }
  return out
}

function boundsOf(pts: { x: number; y: number }[]): { minX: number; minY: number; maxX: number; maxY: number; w: number; h: number } {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const p of pts) {
    minX = Math.min(minX, p.x)
    minY = Math.min(minY, p.y)
    maxX = Math.max(maxX, p.x)
    maxY = Math.max(maxY, p.y)
  }
  return { minX, minY, maxX, maxY, w: maxX - minX, h: maxY - minY }
}

/**
 * 屏幕坐标下的「下轮廓」：沿 x 从最小到最大，贴着物体底边的一条折线。
 * 剖面线只画在这条线下面，所以不会侵入填充（规则 1）。
 */
function lowerChain(pts: { x: number; y: number }[]): { x: number; y: number }[] {
  if (pts.length < 2) return pts
  // 先按 x 去重、只留最低的那个点：否则竖直边（墙、槽侧壁）的顶端会混进下轮廓，
  // 剖面线就画进物体内部了。
  const byX = new Map<number, { x: number; y: number }>()
  for (const p of pts) {
    const k = Math.round(p.x * 4) / 4
    const cur = byX.get(k)
    if (!cur || p.y > cur.y) byX.set(k, p)
  }
  const sorted = [...byX.values()].sort((a, b) => a.x - b.x || a.y - b.y)
  const cross = (o: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number }) =>
    (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x)
  const chain: { x: number; y: number }[] = []
  for (const p of sorted) {
    // 屏幕 y 向下：保留「更低」的点，得到下轮廓
    while (chain.length >= 2 && cross(chain[chain.length - 2]!, chain[chain.length - 1]!, p) >= 0) chain.pop()
    chain.push(p)
  }
  return chain
}

/** 固定端符号：轮廓外侧 45° 剖面线（间距 7px，1px，inkFaint） */
function drawFixedHatch(
  ctx: CanvasRenderingContext2D,
  camera: Camera,
  geoms: RenderGeometry[],
  transform: { x: number; y: number; angle: number },
): void {
  const pts = screenGeomPoints(geoms, transform, camera)
  if (pts.length < 2) return
  const box = boundsOf(pts)
  if (Math.min(box.w, box.h) < DECO_MIN_SIDE) return
  const chain = lowerChain(pts)
  if (chain.length < 2) return

  const spacing = 7
  const len = 6
  ctx.save()
  ctx.strokeStyle = 'rgba(29,32,37,0.22)'
  ctx.lineWidth = 1
  ctx.lineCap = 'round'
  ctx.beginPath()
  for (let i = 1; i < chain.length; i++) {
    const a = chain[i - 1]!
    const b = chain[i]!
    const seg = Math.hypot(b.x - a.x, b.y - a.y)
    if (seg < 0.01) continue
    const ux = (b.x - a.x) / seg
    const uy = (b.y - a.y) / seg
    for (let d = 0; d <= seg; d += spacing) {
      const x = a.x + ux * d
      const y = a.y + uy * d
      ctx.moveTo(x, y + 1)
      ctx.lineTo(x + len * 0.72, y + 1 + len * 0.72)
    }
  }
  ctx.stroke()
  ctx.restore()
}

/** 带电体：体心 +/−（红正蓝负，教材符号） */
function drawChargeSign(
  ctx: CanvasRenderingContext2D,
  camera: Camera,
  body: Body,
  transform: { x: number; y: number; angle: number },
  geoms: RenderGeometry[],
): void {
  const pts = screenGeomPoints(geoms, transform, camera)
  if (!pts.length) return
  const box = boundsOf(pts)
  if (Math.min(box.w, box.h) < 16) return
  const cx = (box.minX + box.maxX) / 2
  const cy = (box.minY + box.maxY) / 2
  const r = 5.5
  const positive = (body.charge ?? 0) > 0
  ctx.save()
  ctx.beginPath()
  ctx.arc(cx, cy, r, 0, Math.PI * 2)
  ctx.fillStyle = positive ? 'rgba(212,87,74,0.92)' : 'rgba(63,127,224,0.92)'
  ctx.fill()
  ctx.strokeStyle = '#fff'
  ctx.lineWidth = 1.6
  ctx.beginPath()
  ctx.moveTo(cx - 2.6, cy)
  ctx.lineTo(cx + 2.6, cy)
  if (positive) {
    ctx.moveTo(cx, cy - 2.6)
    ctx.lineTo(cx, cy + 2.6)
  }
  ctx.stroke()
  ctx.restore()
}

/**
 * 场：磁场用 ×（向里）/ ·（向外）阵列；电场用一组短箭头。
 * 这是「磁场方向看不出来」这个缺口的直接补丁 —— 一眼就是课本图。
 */
function drawFields(ctx: CanvasRenderingContext2D, scene: Scene, camera: Camera): void {
  if (!scene.fields?.length) return
  const view = camera.visibleBounds()
  for (const f of scene.fields) {
    if (f.enabled === false) continue
    if (f.kind !== 'uniform') continue
    const region = f.regionId ? scene.regions.find((r) => r.id === f.regionId) : undefined
    let rect: { x: number; y: number; w: number; h: number }
    if (region) {
      const geoms = getGeom(region.shape, 'teach')
      const pts = screenGeomPoints(geoms, region.transform, camera)
      if (pts.length < 2) continue
      const b = boundsOf(pts)
      rect = { x: b.minX, y: b.minY, w: b.w, h: b.h }
    } else {
      // 世界 y 向上、屏幕 y 向下：取两个角的最小/最大，别让 h 变成负数
      const a = camera.project({ x: view.minX, y: view.minY }, 0)
      const c = camera.project({ x: view.maxX, y: view.maxY }, 0)
      rect = {
        x: Math.min(a.x, c.x),
        y: Math.min(a.y, c.y),
        w: Math.abs(c.x - a.x),
        h: Math.abs(c.y - a.y),
      }
    }
    if (rect.w < 30 || rect.h < 30) continue
    // 有区域的场由区域自己的标签负责，别再叠一个角落标签
    const showTag = !region
    if (f.type === 'B') drawMagnetic(ctx, rect, f.bz, f.label, showTag)
    else drawElectric(ctx, rect, f.vector, f.label, showTag)
  }
}

/**
 * 场标签：放在场区左上角，但让开顶栏（约 80px）——
 * 全场场景里 rect 从 (0,0) 起，直接画会被深色顶栏吃掉。
 */
function fieldTag(
  ctx: CanvasRenderingContext2D,
  text: string,
  rect: { x: number; y: number; w: number; h: number },
  color: string,
): void {
  // 78 是左侧工具栏的右边界 + 半个标签宽；92 是顶栏下方
  const x = Math.max(rect.x + 46, 100)
  const y = Math.max(rect.y + 20, 94)
  drawTag(ctx, text, x, y, color)
}

function drawMagnetic(
  ctx: CanvasRenderingContext2D,
  rect: { x: number; y: number; w: number; h: number },
  bz: number,
  label?: string,
  showTag = true,
): void {
  const outward = bz >= 0
  // 间距 30px：够密看得出「处处有场」，又不至于变成噪点（规则 3：不抢注意力）
  const gap = 32
  const r = 2.6
  const cols = Math.min(60, Math.max(1, Math.floor(rect.w / gap)))
  const rows = Math.min(60, Math.max(1, Math.floor(rect.h / gap)))
  const ox = rect.x + (rect.w - (cols - 1) * gap) / 2
  const oy = rect.y + (rect.h - (rows - 1) * gap) / 2
  ctx.save()
  ctx.strokeStyle = 'rgba(63,127,224,0.26)'
  ctx.fillStyle = 'rgba(63,127,224,0.26)'
  ctx.lineWidth = 1.1
  ctx.beginPath()
  for (let i = 0; i < cols; i++) {
    for (let j = 0; j < rows; j++) {
      const x = ox + i * gap
      const y = oy + j * gap
      if (outward) {
        ctx.moveTo(x + r, y)
        ctx.arc(x, y, r, 0, Math.PI * 2)
      } else {
        ctx.moveTo(x - r, y - r)
        ctx.lineTo(x + r, y + r)
        ctx.moveTo(x + r, y - r)
        ctx.lineTo(x - r, y + r)
      }
    }
  }
  if (outward) ctx.fill()
  else ctx.stroke()
  ctx.restore()
  if (showTag) fieldTag(ctx, label ?? (outward ? 'B 向外 ·' : 'B 向里 ×'), rect, THEME.blue)
}

function drawElectric(
  ctx: CanvasRenderingContext2D,
  rect: { x: number; y: number; w: number; h: number },
  vector: { x: number; y: number },
  label?: string,
  showTag = true,
): void {
  const mag = Math.hypot(vector.x, vector.y)
  if (mag < 1e-6) return
  const ux = vector.x / mag
  const uy = -vector.y / mag // 世界 y 向上，屏幕 y 向下
  const gap = 104
  const cols = Math.min(12, Math.max(1, Math.floor(rect.w / gap)))
  const rows = Math.min(12, Math.max(1, Math.floor(rect.h / gap)))
  const ox = rect.x + (rect.w - (cols - 1) * gap) / 2
  const oy = rect.y + (rect.h - (rows - 1) * gap) / 2
  const half = 7
  ctx.save()
  ctx.strokeStyle = 'rgba(63,127,224,0.20)'
  ctx.lineWidth = 1.2
  ctx.lineCap = 'round'
  ctx.beginPath()
  for (let i = 0; i < cols; i++) {
    for (let j = 0; j < rows; j++) {
      const x = ox + i * gap
      const y = oy + j * gap
      const x0 = x - ux * half
      const y0 = y - uy * half
      const x1 = x + ux * half
      const y1 = y + uy * half
      ctx.moveTo(x0, y0)
      ctx.lineTo(x1, y1)
      // 箭头
      const ax = x1 - ux * 4 - uy * 3
      const ay = y1 - uy * 4 + ux * 3
      const bx = x1 - ux * 4 + uy * 3
      const by = y1 - uy * 4 - ux * 3
      ctx.moveTo(ax, ay)
      ctx.lineTo(x1, y1)
      ctx.lineTo(bx, by)
    }
  }
  ctx.stroke()
  ctx.restore()
  if (showTag) fieldTag(ctx, label ?? 'E', rect, THEME.blue)
}

// ---------------------------------------------------------------------------
// 约束 / 受力图
// ---------------------------------------------------------------------------

function anchorWorld(scene: Scene, state: VisualState | null, a: Anchor): Vec2 | null {
  if ('world' in a) return a.world
  const body = scene.bodies.find((b) => b.id === a.bodyId)
  if (!body) return null
  const local = anchorLocal(scene, a)
  if (!local) return null
  const s = state?.bodies[a.bodyId]
  const t = s ? { x: s.x, y: s.y, angle: s.angle } : body.transform
  const c = Math.cos(t.angle)
  const sn = Math.sin(t.angle)
  return { x: t.x + local.x * c - local.y * sn, y: t.y + local.x * sn + local.y * c }
}

function drawGases(ctx: CanvasRenderingContext2D, scene: Scene, camera: Camera, state: VisualState | null): void {
  for (const gas of scene.gases) {
    if (gas.enabled === false) continue
    const piston = state?.bodies[gas.pistonId]
    const pb = scene.bodies.find((b) => b.id === gas.pistonId)
    const pos = piston ? { x: piston.x, y: piston.y } : pb?.transform
    if (!pos) continue
    const bottom = pos.y - gas.pistonHalf
    if (bottom <= gas.floorY + 0.01) continue
    const a = camera.project({ x: pos.x - gas.width / 2, y: gas.floorY }, 0)
    const b = camera.project({ x: pos.x + gas.width / 2, y: bottom }, 0)
    const x = Math.min(a.x, b.x)
    const y = Math.min(a.y, b.y)
    const w = Math.abs(b.x - a.x)
    const h = Math.abs(b.y - a.y)
    ctx.save()
    ctx.fillStyle = rgba(THEME.blue, 0.1)
    ctx.fillRect(x, y, w, h)
    ctx.strokeStyle = rgba(THEME.blue, 0.3)
    ctx.lineWidth = 1
    ctx.strokeRect(x, y, w, h)
    const gs = state?.gases?.[gas.id]
    if (gs) {
      ctx.fillStyle = rgba(THEME.inkSoft, 0.8)
      ctx.font = font(9.5, 600)
      ctx.textAlign = 'center'
      ctx.fillText(`P ${gs.p.toFixed(0)}  V ${gs.v.toFixed(2)}  T ${gs.t.toFixed(0)}`, x + w / 2, y + h / 2 + 3)
    }
    ctx.restore()
  }
}

function drawConstraints(ctx: CanvasRenderingContext2D, scene: Scene, camera: Camera, state: VisualState | null, selectedId?: string | null): void {
  for (const c of scene.constraints) {
    if (c.type === 'pulley') {
      const a = anchorWorld(scene, state, c.a)
      const b = anchorWorld(scene, state, c.b)
      if (!a || !b) continue
      const pa = camera.project(a, 0)
      const pb = camera.project(b, 0)
      const ga = camera.project(c.groundA, 0)
      const gb = camera.project(c.groundB, 0)
      const wheel = camera.project(c.pulley ?? { x: (c.groundA.x + c.groundB.x) / 2, y: (c.groundA.y + c.groundB.y) / 2 }, 0)
      const sel = c.id === selectedId
      ctx.save()
      ctx.strokeStyle = sel ? THEME.accent : '#b08968'
      ctx.lineWidth = Math.max(1.6, camera.pixelScale * 0.014)
      ctx.beginPath()
      ctx.moveTo(pa.x, pa.y)
      ctx.lineTo(ga.x, ga.y)
      ctx.moveTo(pb.x, pb.y)
      ctx.lineTo(gb.x, gb.y)
      ctx.moveTo(ga.x, ga.y)
      ctx.lineTo(wheel.x, wheel.y)
      ctx.moveTo(gb.x, gb.y)
      ctx.lineTo(wheel.x, wheel.y)
      ctx.stroke()
      ctx.strokeStyle = THEME.inkSoft
      ctx.lineWidth = 1.4
      ctx.beginPath()
      ctx.arc(wheel.x, wheel.y, 9, 0, Math.PI * 2)
      ctx.stroke()
      ctx.beginPath()
      ctx.arc(wheel.x, wheel.y, 2, 0, Math.PI * 2)
      ctx.fillStyle = THEME.inkSoft
      ctx.fill()
      ctx.restore()
      continue
    }
    if (c.type === 'track') {
      const b = state?.bodies[c.centerBodyId]
      const sb = scene.bodies.find((x) => x.id === c.centerBodyId)
      const pos = b ? { x: b.x, y: b.y } : sb?.transform
      if (!pos) continue
      const p = camera.project(pos, 0)
      const rad = c.radius * camera.pixelScale
      const sel = c.id === selectedId
      ctx.save()
      ctx.strokeStyle = sel ? THEME.accent : rgba(THEME.inkSoft, 0.45)
      ctx.lineWidth = 2
      ctx.setLineDash([5, 4])
      ctx.beginPath()
      ctx.arc(p.x, p.y, rad, c.fromAngle ?? 0, c.toAngle ?? Math.PI * 2)
      ctx.stroke()
      ctx.setLineDash([])
      ctx.restore()
      continue
    }
    if (c.type === 'prismatic') {
      const b = state?.bodies[c.bodyId]
      const sb = scene.bodies.find((x) => x.id === c.bodyId)
      const pos = b ? { x: b.x, y: b.y } : sb?.transform
      if (!pos) continue
      const p = camera.project(pos, 0)
      const sel = c.id === selectedId
      ctx.save()
      ctx.strokeStyle = sel ? THEME.accent : rgba(THEME.inkSoft, 0.3)
      ctx.setLineDash([4, 5])
      ctx.lineWidth = 1.4
      ctx.beginPath()
      if (c.axis === 'y') {
        ctx.moveTo(p.x, p.y - 80)
        ctx.lineTo(p.x, p.y + 80)
      } else {
        ctx.moveTo(p.x - 80, p.y)
        ctx.lineTo(p.x + 80, p.y)
      }
      ctx.stroke()
      ctx.setLineDash([])
      ctx.restore()
      continue
    }
    if (c.type !== 'rope' && c.type !== 'rod' && c.type !== 'spring' && c.type !== 'hinge') continue
    const a = anchorWorld(scene, state, c.a)
    const b = anchorWorld(scene, state, c.b)
    if (!a || !b) continue
    const pa = camera.project(a, 0)
    const pb = camera.project(b, 0)
    const sel = c.id === selectedId
    ctx.save()
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    if (c.type === 'rope') {
      ctx.strokeStyle = sel ? THEME.accent : '#b08968'
      ctx.lineWidth = Math.max(1.6, camera.pixelScale * 0.014)
      ctx.beginPath()
      ctx.moveTo(pa.x, pa.y)
      ctx.lineTo(pb.x, pb.y)
      ctx.stroke()
    } else if (c.type === 'rod') {
      ctx.strokeStyle = THEME.inkSoft
      ctx.lineWidth = Math.max(2.4, camera.pixelScale * 0.022)
      ctx.beginPath()
      ctx.moveTo(pa.x, pa.y)
      ctx.lineTo(pb.x, pb.y)
      ctx.stroke()
      ctx.fillStyle = THEME.inkSoft
      for (const p of [pa, pb]) {
        ctx.beginPath()
        ctx.arc(p.x, p.y, 3, 0, Math.PI * 2)
        ctx.fill()
      }
    } else if (c.type === 'spring') {
      // 竖直方向的弹簧画成锯齿，其他方向按法线展开
      const dx = pb.x - pa.x
      const dy = pb.y - pa.y
      const len = Math.hypot(dx, dy) || 1
      const nx = -dy / len
      const ny = dx / len
      const coils = 12
      const amp = Math.min(12, len * 0.05)
      ctx.strokeStyle = sel ? THEME.accent : '#5f8f86'
      ctx.lineWidth = sel ? 2.6 : 1.7
      ctx.beginPath()
      ctx.moveTo(pa.x, pa.y)
      for (let i = 1; i < coils; i++) {
        const f = i / coils
        const side = i % 2 === 0 ? 1 : -1
        ctx.lineTo(pa.x + dx * f + nx * amp * side, pa.y + dy * f + ny * amp * side)
      }
      ctx.lineTo(pb.x, pb.y)
      ctx.stroke()
    } else if (c.type === 'hinge') {
      ctx.fillStyle = THEME.card
      ctx.strokeStyle = THEME.inkSoft
      ctx.lineWidth = 1.8
      ctx.beginPath()
      ctx.arc(pa.x, pa.y, 5, 0, Math.PI * 2)
      ctx.fill()
      ctx.stroke()
      ctx.fillStyle = THEME.inkSoft
      ctx.beginPath()
      ctx.arc(pa.x, pa.y, 1.8, 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.restore()
  }
}

function drawForces(
  ctx: CanvasRenderingContext2D,
  scene: Scene,
  camera: Camera,
  state: VisualState | null,
  selectedId?: string | null,
): void {
  if (!state) return
  const s = camera.pixelScale
  const arrow = (p: Vec2, vx: number, vy: number, color: string, label: string, showLabel: boolean, ref: number, withValue = true) => {
    const mag = Math.hypot(vx, vy)
    if (mag < 0.15) return
    // 相对于该物体的重力来定箭头长度：拉力/重力一眼能比出来
    const lenM = Math.min(0.9, Math.max(0.16, 0.28 * (mag / Math.max(ref, 0.5))))
    const ux = vx / mag
    const uy = vy / mag
    const from = camera.project(p, 0)
    const to = camera.project({ x: p.x + ux * lenM, y: p.y + uy * lenM }, 0)
    const dx = to.x - from.x
    const dy = to.y - from.y
    const l = Math.hypot(dx, dy) || 1
    ctx.strokeStyle = color
    ctx.fillStyle = color
    ctx.lineWidth = 2
    ctx.lineCap = 'round'
    ctx.beginPath()
    ctx.moveTo(from.x, from.y)
    ctx.lineTo(to.x - (dx / l) * 7, to.y - (dy / l) * 7)
    ctx.stroke()
    const ux2 = dx / l
    const uy2 = dy / l
    ctx.beginPath()
    ctx.moveTo(to.x, to.y)
    ctx.lineTo(to.x - ux2 * 9 - uy2 * 4.2, to.y - uy2 * 9 + ux2 * 4.2)
    ctx.lineTo(to.x - ux2 * 9 + uy2 * 4.2, to.y - uy2 * 9 - ux2 * 4.2)
    ctx.closePath()
    ctx.fill()
    if (showLabel) {
      ctx.font = font(10, 600)
      ctx.fillStyle = color
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      const text = showLabel ? (withValue ? `${label} ${mag.toFixed(1)}N` : label) : ''
      ctx.fillText(text, to.x + ux2 * 12, to.y + uy2 * 12)
    }
  }
  for (const body of scene.bodies) {
    const v = state.bodies[body.id]
    if (!v || !v.force) continue
    if (body.kind === 'static' || body.kind === 'kinematic') continue
    const p = { x: v.x, y: v.y }
    const f = v.force
    const show = body.id === selectedId
    const ref = Math.max(Math.hypot(f.gx, f.gy), 0.5)
    arrow(p, f.gx, f.gy, THEME.inkSoft, 'G', show, ref)
    // 多个外力：每种颜色 + F1/F2 标签，选中的那个再标大小和方向
    ;(f.applied ?? []).forEach((a, i) => {
      const color = THEME.forceColors[i % THEME.forceColors.length]!
      const mag = Math.hypot(a.x, a.y)
      const deg = Math.round((Math.atan2(a.y, a.x) * 180) / Math.PI)
      const label = `F${i + 1}${show ? ` ${mag.toFixed(1)}N · ${deg}°` : ''}`
      arrow(p, a.x, a.y, color, label, true, ref, false)
    })
    arrow(p, f.ex, f.ey, THEME.blue, 'qE', show, ref)
    arrow(p, f.tx, f.ty, THEME.green, 'T', show, ref)
  }
  void s
}

// ---------------------------------------------------------------------------
// 轨迹 / 矢量 / 标签
// ---------------------------------------------------------------------------

function drawTrails(
  ctx: CanvasRenderingContext2D,
  scene: Scene,
  camera: Camera,
  trails: Record<string, Vec2[]> | undefined,
): void {
  if (!trails) return
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  for (const obs of scene.observers) {
    if (obs.kind !== 'trail') continue
    const pts = trails[obs.bodyId]
    if (!pts || pts.length < 2) continue
    const body = scene.bodies.find((b) => b.id === obs.bodyId)
    const color = obs.color ?? body?.appearance.color ?? THEME.blue
    const screen = pts.map((p) => camera.project(p, 0))
    // 分段淡出：越早越淡
    const chunk = Math.max(1, Math.floor(screen.length / 28))
    for (let i = 1; i < screen.length; i += chunk) {
      const end = Math.min(screen.length, i + chunk + 1)
      const age = i / screen.length
      ctx.strokeStyle = rgba(color, 0.12 + 0.5 * age)
      ctx.lineWidth = 1.6 + 1.1 * age
      ctx.beginPath()
      ctx.moveTo(screen[i - 1]!.x, screen[i - 1]!.y)
      for (let k = i; k < end; k++) ctx.lineTo(screen[k]!.x, screen[k]!.y)
      ctx.stroke()
    }
  }
}

const VECTOR_COLORS: Record<string, string> = {
  v: THEME.blue,
  a: THEME.amber,
  F: THEME.red,
  p: '#8a5cd6',
}

function drawVectors(
  ctx: CanvasRenderingContext2D,
  scene: Scene,
  camera: Camera,
  state: VisualState | null,
  selectedId?: string | null,
): void {
  if (!state) return
  let selectedVelocityDrawn = false
  for (const obs of scene.observers) {
    if (obs.kind !== 'vector') continue
    if (obs.bodyId === selectedId && obs.which.includes('v')) selectedVelocityDrawn = true
    const b = state.bodies[obs.bodyId]
    const body = scene.bodies.find((x) => x.id === obs.bodyId)
    if (!b || !body) continue
    const origin = camera.project({ x: b.x, y: b.y }, 0)
    const mass = body.mass ?? 1
    for (const which of obs.which) {
      let vx = 0
      let vy = 0
      if (which === 'v') {
        vx = b.vx
        vy = b.vy
      } else if (which === 'a') {
        vx = b.ax
        vy = b.ay
      } else if (which === 'F') {
        vx = b.ax * mass
        vy = b.ay * mass
      } else {
        vx = b.vx * mass
        vy = b.vy * mass
      }
      const mag = Math.hypot(vx, vy)
      if (mag < 1e-3) continue
      const scale = obs.scale ?? 0.3
      const tip = camera.project({ x: b.x + vx * scale, y: b.y + vy * scale }, 0)
      const dx = tip.x - origin.x
      const dy = tip.y - origin.y
      const len = Math.hypot(dx, dy)
      if (len < 6) continue
      const color = VECTOR_COLORS[which] ?? THEME.ink
      ctx.strokeStyle = color
      ctx.fillStyle = color
      ctx.lineWidth = 2.2
      ctx.lineCap = 'round'
      ctx.beginPath()
      ctx.moveTo(origin.x, origin.y)
      ctx.lineTo(tip.x, tip.y)
      ctx.stroke()
      const ang = Math.atan2(dy, dx)
      const head = Math.min(11, 6 + len * 0.05)
      ctx.beginPath()
      ctx.moveTo(tip.x, tip.y)
      ctx.lineTo(tip.x - head * Math.cos(ang - 0.42), tip.y - head * Math.sin(ang - 0.42))
      ctx.lineTo(tip.x - head * Math.cos(ang + 0.42), tip.y - head * Math.sin(ang + 0.42))
      ctx.closePath()
      ctx.fill()
      ctx.font = font(11, 600)
      ctx.fillStyle = color
      const deg = Math.round((Math.atan2(vy, vx) * 180) / Math.PI)
      const label = which === 'v' && body.id === selectedId ? `v ${mag.toFixed(1)} m/s · ${deg}°` : which
      ctx.fillText(label, tip.x + 6 * Math.cos(ang), tip.y + 6 * Math.sin(ang) - 4)
    }
  }
  // 没有 vector 观测者时，选中的物体也画一个速度矢量箭头（手动建模时尤其需要）
  if (selectedId && !selectedVelocityDrawn) {
    const b = state.bodies[selectedId]
    const body = scene.bodies.find((x) => x.id === selectedId)
    if (b && body && (body.kind === 'particle' || body.kind === 'rigid')) {
      const mag = Math.hypot(b.vx, b.vy)
      if (mag > 1e-3) {
        const scale = 0.3
        const origin = camera.project({ x: b.x, y: b.y }, 0)
        const tip = camera.project({ x: b.x + b.vx * scale, y: b.y + b.vy * scale }, 0)
        const dx = tip.x - origin.x
        const dy = tip.y - origin.y
        if (Math.hypot(dx, dy) >= 6) {
          const color = VECTOR_COLORS.v ?? THEME.blue
          ctx.strokeStyle = color
          ctx.fillStyle = color
          ctx.lineWidth = 2.2
          ctx.lineCap = 'round'
          ctx.beginPath()
          ctx.moveTo(origin.x, origin.y)
          ctx.lineTo(tip.x, tip.y)
          ctx.stroke()
          const ang = Math.atan2(dy, dx)
          const head = Math.min(11, 6 + Math.hypot(dx, dy) * 0.05)
          ctx.beginPath()
          ctx.moveTo(tip.x, tip.y)
          ctx.lineTo(tip.x - head * Math.cos(ang - 0.42), tip.y - head * Math.sin(ang - 0.42))
          ctx.lineTo(tip.x - head * Math.cos(ang + 0.42), tip.y - head * Math.sin(ang + 0.42))
          ctx.closePath()
          ctx.fill()
          const deg = Math.round((Math.atan2(b.vy, b.vx) * 180) / Math.PI)
          ctx.font = font(11, 600)
          ctx.fillText(`v ${mag.toFixed(1)} m/s · ${deg}°`, tip.x + 6 * Math.cos(ang), tip.y + 6 * Math.sin(ang) - 4)
        }
      }
    }
  }
}

function drawBodyLabels(
  ctx: CanvasRenderingContext2D,
  scene: Scene,
  camera: Camera,
  state: VisualState | null,
  input: RenderInput,
): void {
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.font = font(11, 600)
  // 选中的、会动的先画；互相压住的标签直接跳过，避免“地形”盖在球上
  const order = scene.bodies.slice().sort((a, b) => {
    const sa = a.id === input.selectedId ? 0 : a.kind === 'particle' || a.kind === 'rigid' ? 1 : 2
    const sb = b.id === input.selectedId ? 0 : b.kind === 'particle' || b.kind === 'rigid' ? 1 : 2
    return sa - sb
  })
  const placed: { x: number; y: number }[] = []
  // 会动的物体优先占位；地形的标签如果正压在物体上就跳过
  const dynamics = order
    .filter((b) => b.kind === 'particle' || b.kind === 'rigid')
    .map((b) => {
      const s = state?.bodies[b.id]
      return camera.project(s ? { x: s.x, y: s.y } : b.transform, 0)
    })
  for (const body of order) {
    if (!body.label || body.id === 'ground') continue
    const s = state?.bodies[body.id]
    const pos = s ? { x: s.x, y: s.y } : { x: body.transform.x, y: body.transform.y }
    const p = camera.project(pos, 0)
    const above = 24 + body.appearance.depth * camera.pixelScale * 0.5
    const text = body.label
    const w = ctx.measureText(text).width + 14
    const ly = p.y - above - 10
    if (placed.some((q) => Math.abs(q.x - p.x) < w + 8 && Math.abs(q.y - ly) < 26)) continue
    if (
      (body.kind === 'static' || body.kind === 'kinematic') &&
      dynamics.some((q) => Math.hypot(q.x - p.x, q.y - p.y) < 60)
    ) {
      continue
    }
    placed.push({ x: p.x, y: ly })
    ctx.fillStyle = 'rgba(255,255,255,0.82)'
    const x = p.x - w / 2
    const y = ly
    ctx.beginPath()
    ctx.moveTo(x + 7, y)
    ctx.arcTo(x + w, y, x + w, y + 20, 7)
    ctx.arcTo(x + w, y + 20, x, y + 20, 7)
    ctx.arcTo(x, y + 20, x, y, 7)
    ctx.arcTo(x, y, x + w, y, 7)
    ctx.closePath()
    ctx.fill()
    ctx.fillStyle = THEME.inkSoft
    ctx.fillText(text, p.x, y + 10)
  }
}

// ---------------------------------------------------------------------------
// 区域与辅助线
// ---------------------------------------------------------------------------

function drawRegions(
  ctx: CanvasRenderingContext2D,
  scene: Scene,
  camera: Camera,
  precision: Precision,
): void {
  for (const region of scene.regions) {
    const geoms = getGeom(region.shape, precision)
    const color = region.role === 'target' ? THEME.green : THEME.blue
    for (const g of geoms) {
      if (g.kind === 'fill') {
        for (const outline of g.outlines) {
          const sp = outline.map((p) => projectLocal(p, { ...region.transform }, camera, 0))
          tracePath(ctx, sp)
          ctx.fillStyle = rgba(color, 0.07)
          ctx.fill()
          ctx.setLineDash([7, 6])
          ctx.strokeStyle = rgba(color, 0.55)
          ctx.lineWidth = 1.6
          ctx.stroke()
          ctx.setLineDash([])
        }
      } else {
        const sp = g.points.map((p) => projectLocal(p, { ...region.transform }, camera, 0))
        ctx.setLineDash([7, 6])
        ctx.strokeStyle = rgba(color, 0.55)
        ctx.lineWidth = Math.max(1.5, g.thick * camera.pixelScale)
        tracePath(ctx, sp, g.closed)
        ctx.stroke()
        ctx.setLineDash([])
      }
    }
    if (region.label) {
      const p = camera.project(region.transform, 0)
      drawTag(ctx, region.label, p.x, p.y - 14, color)
    }
  }
}

function drawGuides(ctx: CanvasRenderingContext2D, guides: Guide[], camera: Camera): void {
  const b = camera.visibleBounds()
  ctx.setLineDash([5, 6])
  ctx.lineWidth = 1.4
  for (const g of guides) {
    if (g.kind === 'hline') {
      const x0 = g.x0 ?? b.minX
      const x1 = g.x1 ?? b.maxX
      const a = camera.project({ x: x0, y: g.y }, 0)
      const c = camera.project({ x: x1, y: g.y }, 0)
      ctx.strokeStyle = rgba(THEME.inkSoft, 0.4)
      ctx.beginPath()
      ctx.moveTo(a.x, a.y)
      ctx.lineTo(c.x, c.y)
      ctx.stroke()
      // 标签放中点下方：左端会撞到小球，右端常被观测卡盖住，上方会撞到物体标签
      if (g.label) drawTag(ctx, g.label, (a.x + c.x) / 2 + 36, a.y + 18, THEME.inkSoft)
    } else if (g.kind === 'vline') {
      const y0 = g.y0 ?? b.minY
      const y1 = g.y1 ?? b.maxY
      const a = camera.project({ x: g.x, y: y0 }, 0)
      const c = camera.project({ x: g.x, y: y1 }, 0)
      ctx.strokeStyle = rgba(THEME.inkSoft, 0.4)
      ctx.beginPath()
      ctx.moveTo(a.x, a.y)
      ctx.lineTo(c.x, c.y)
      ctx.stroke()
      if (g.label) drawTag(ctx, g.label, a.x, a.y + 14, THEME.inkSoft)
    } else {
      const p = camera.project(g.at, 0)
      drawTag(ctx, g.text, p.x, p.y, THEME.inkSoft)
    }
  }
  ctx.setLineDash([])
}

function drawTag(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  color: string,
): void {
  ctx.font = font(10, 600)
  const w = ctx.measureText(text).width + 12
  const h = 18
  ctx.fillStyle = 'rgba(255,255,255,0.86)'
  ctx.beginPath()
  ctx.moveTo(x - w / 2 + 6, y - h / 2)
  ctx.arcTo(x + w / 2, y - h / 2, x + w / 2, y + h / 2, 6)
  ctx.arcTo(x + w / 2, y + h / 2, x - w / 2, y + h / 2, 6)
  ctx.arcTo(x - w / 2, y + h / 2, x - w / 2, y - h / 2, 6)
  ctx.arcTo(x - w / 2, y - h / 2, x + w / 2, y - h / 2, 6)
  ctx.closePath()
  ctx.fill()
  ctx.fillStyle = color
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(text, x, y)
}

/** 命中测试：世界坐标下的物体（从后往前找，优先选小物体） */
export function pickBody(scene: Scene, camera: Camera, state: VisualState | null, sx: number, sy: number): Body | null {
  const world = camera.unproject(sx, sy)
  const candidates: Array<{ body: Body; radius: number }> = []
  for (const body of scene.bodies) {
    if (body.id === 'ground') continue
    const s = state?.bodies[body.id]
    const transform = s ? { x: s.x, y: s.y, angle: s.angle } : body.transform
    if (!hitTestShape(body.shape, transform, world)) continue
    candidates.push({ body, radius: Math.hypot(transform.x - world.x, transform.y - world.y) })
  }
  candidates.sort((a, b) => a.radius - b.radius)
  return candidates[0]?.body ?? null
}

function hitTestShape(shape: Shape, transform: { x: number; y: number; angle: number }, world: Vec2): boolean {
  const c = Math.cos(transform.angle)
  const s = Math.sin(transform.angle)
  const local = {
    x: (world.x - transform.x) * c + (world.y - transform.y) * s,
    y: -(world.x - transform.x) * s + (world.y - transform.y) * c,
  }
  const geoms = getGeom(shape, 'teach')
  for (const g of geoms) {
    if (g.kind === 'fill') {
      if (g.outlines.some((o) => pointInPolygonLocal(local, o))) return true
    } else {
      const half = g.thick / 2 + 0.02
      for (let i = 1; i < g.points.length; i++) {
        if (distToSeg(local, g.points[i - 1]!, g.points[i]!) <= half) return true
      }
    }
  }
  return false
}

function pointInPolygonLocal(p: Vec2, poly: Vec2[]): boolean {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!
    const b = poly[j]!
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) {
      inside = !inside
    }
  }
  return inside
}

function distToSeg(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const l2 = dx * dx + dy * dy
  if (l2 < 1e-12) return Math.hypot(p.x - a.x, p.y - a.y)
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2))
  return Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t))
}
