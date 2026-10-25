/**
 * 意图形状（用户画的）→ 物理形状 / 渲染几何 的双表示（架构 §3.3）。
 *
 * 约定：
 * - `arc.r` 是圆心到**内表面**的半径，厚度向外生长；物理表面取 r（零厚 Chain），
 *   视觉带宽 [r, r+thick]。球在槽内/环内时，视觉与碰撞面严丝合缝。
 * - 填充形状（circle/rect/polygon）做挤出；描边形状（arc/polyline/bezier）做带状挤出。
 * - 贝塞尔/圆弧在编辑时采样成折线，渲染时不再细分（§4.5）。
 */
import type { Shape } from './scene'
import {
  type Vec2,
  bezierPoint,
  clamp,
  distance,
  distToSegment,
  pointInPolygon,
  polygonArea,
  polylineLength,
  rot,
} from './math'

export type Precision = 'teach' | 'verify'

export type FixtureSpec =
  | { kind: 'circle'; radius: number; center: Vec2 }
  | { kind: 'polygon'; vertices: Vec2[] }
  | { kind: 'chain'; vertices: Vec2[]; loop: boolean }

export type RenderGeometry =
  | { kind: 'fill'; outlines: Vec2[][] }
  | { kind: 'stroke'; points: Vec2[]; thick: number; closed: boolean }

const TAU = Math.PI * 2

function circleSamples(precision: Precision): number {
  return precision === 'verify' ? 64 : 28
}

/** 圆弧采样步长：verify 3°，teach 6°。对 R=0.9 的轨道，3° 对应弦高 0.3 mm，感觉不到棱。 */
function arcStep(precision: Precision): number {
  return ((precision === 'verify' ? 3 : 6) * Math.PI) / 180
}

export function isFullCircle(a0: number, a1: number): boolean {
  return Math.abs(a1 - a0) >= TAU - 1e-6
}

/** 圆弧中心线采样。radiusOverride 用于把视觉中心线外移到 r + thick/2。 */
export function arcPoints(shape: Extract<Shape, { type: 'arc' }>, precision: Precision, radiusOverride?: number): Vec2[] {
  const r = radiusOverride ?? shape.r
  const step = arcStep(precision)
  const span = shape.a1 - shape.a0
  const n = Math.max(2, Math.ceil(Math.abs(span) / step))
  const pts: Vec2[] = []
  for (let i = 0; i <= n; i++) {
    const a = shape.a0 + (span * i) / n
    pts.push({ x: Math.cos(a) * r, y: Math.sin(a) * r })
  }
  return pts
}

export function bezierPoints(shape: Extract<Shape, { type: 'bezier' }>, precision: Precision): Vec2[] {
  const n = precision === 'verify' ? 64 : 16
  const pts: Vec2[] = []
  for (let i = 0; i <= n; i++) pts.push(bezierPoint(shape.ctrl, i / n))
  return dedupe(pts)
}

function dedupe(pts: Vec2[]): Vec2[] {
  const out: Vec2[] = []
  for (const p of pts) {
    const last = out[out.length - 1]
    if (!last || distance(last, p) > 1e-7) out.push(p)
  }
  return out
}

/** 渲染几何（局部坐标）。compound 会展开成多条。 */
export function renderGeometries(shape: Shape, precision: Precision): RenderGeometry[] {
  switch (shape.type) {
    case 'circle': {
      const n = circleSamples(precision)
      const pts: Vec2[] = []
      for (let i = 0; i < n; i++) {
        const a = (i / n) * TAU
        pts.push({ x: Math.cos(a) * shape.r, y: Math.sin(a) * shape.r })
      }
      return [{ kind: 'fill', outlines: [pts] }]
    }
    case 'rect': {
      const hw = shape.w / 2
      const hh = shape.h / 2
      return [
        {
          kind: 'fill',
          outlines: [
            [
              { x: -hw, y: -hh },
              { x: hw, y: -hh },
              { x: hw, y: hh },
              { x: -hw, y: hh },
            ],
          ],
        },
      ]
    }
    case 'polygon':
      return [{ kind: 'fill', outlines: [dedupe(shape.points)] }]
    case 'arc':
      return [
        {
          kind: 'stroke',
          points: arcPoints(shape, precision, shape.r + shape.thick / 2),
          thick: shape.thick,
          closed: isFullCircle(shape.a0, shape.a1),
        },
      ]
    case 'polyline':
      return [{ kind: 'stroke', points: dedupe(shape.points), thick: shape.thick, closed: !!shape.closed }]
    case 'bezier':
      return [{ kind: 'stroke', points: bezierPoints(shape, precision), thick: shape.thick, closed: false }]
    case 'compound':
      return shape.parts.flatMap((p) => renderGeometries(p, precision))
  }
}

/** 用于选中/命中测试的轮廓（局部坐标） */
export function hitOutline(shape: Shape, precision: Precision): { points: Vec2[]; thick: number } {
  const all = renderGeometries(shape, precision)
  let thick = 0
  const points: Vec2[] = []
  for (const g of all) {
    if (g.kind === 'fill') points.push(...g.outlines.flat())
    else {
      points.push(...g.points)
      thick = Math.max(thick, g.thick)
    }
  }
  return { points, thick }
}

export function pointInShape(shape: Shape, p: Vec2, precision: Precision = 'teach'): boolean {
  switch (shape.type) {
    case 'circle':
      return Math.hypot(p.x, p.y) <= shape.r
    case 'rect':
      return Math.abs(p.x) <= shape.w / 2 && Math.abs(p.y) <= shape.h / 2
    case 'polygon':
      return pointInPolygon(p, shape.points)
    case 'arc':
    case 'polyline':
    case 'bezier': {
      const g = renderGeometries(shape, precision)[0]
      if (!g || g.kind !== 'stroke') return false
      const half = g.thick / 2 + 1e-6
      for (let i = 1; i < g.points.length; i++) {
        if (distToSegment(p, g.points[i - 1]!, g.points[i]!) <= half) return true
      }
      if (g.closed && g.points.length > 2) {
        if (distToSegment(p, g.points[g.points.length - 1]!, g.points[0]!) <= half) return true
      }
      return false
    }
    case 'compound':
      return shape.parts.some((part) => pointInShape(part, p, precision))
  }
}

/** 面积（m²），用于缺省质量 */
export function shapeArea(shape: Shape, precision: Precision = 'teach'): number {
  switch (shape.type) {
    case 'circle':
      return Math.PI * shape.r * shape.r
    case 'rect':
      return shape.w * shape.h
    case 'polygon':
      return Math.abs(polygonArea(shape.points))
    case 'arc': {
      const span = Math.abs(shape.a1 - shape.a0)
      return span * shape.r * shape.thick
    }
    case 'polyline': {
      const g = renderGeometries(shape, precision)[0]
      return g && g.kind === 'stroke' ? polylineLength(g.points) * shape.thick : 0
    }
    case 'bezier': {
      const pts = bezierPoints(shape, precision)
      return polylineLength(pts) * shape.thick
    }
    case 'compound':
      return shape.parts.reduce((s, p) => s + shapeArea(p, precision), 0)
  }
}

export function shapeMaxRadius(shape: Shape): number {
  switch (shape.type) {
    case 'circle':
      return shape.r
    case 'rect':
      return Math.hypot(shape.w, shape.h) / 2
    case 'polygon':
      return Math.max(0, ...shape.points.map((p) => Math.hypot(p.x, p.y)))
    case 'arc':
      return shape.r + shape.thick
    case 'polyline':
      return Math.max(0, ...shape.points.map((p) => Math.hypot(p.x, p.y))) + shape.thick / 2
    case 'bezier':
      return Math.max(0, ...shape.ctrl.map((p) => Math.hypot(p.x, p.y))) + shape.thick / 2
    case 'compound':
      return Math.max(0, ...shape.parts.map(shapeMaxRadius))
  }
}

export function shapeAABB(shape: Shape, precision: Precision = 'teach'): { min: Vec2; max: Vec2 } {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const g of renderGeometries(shape, precision)) {
    const pts = g.kind === 'fill' ? g.outlines.flat() : g.points
    const pad = g.kind === 'stroke' ? g.thick / 2 : 0
    for (const p of pts) {
      minX = Math.min(minX, p.x - pad)
      minY = Math.min(minY, p.y - pad)
      maxX = Math.max(maxX, p.x + pad)
      maxY = Math.max(maxY, p.y + pad)
    }
  }
  if (!Number.isFinite(minX)) return { min: { x: 0, y: 0 }, max: { x: 0, y: 0 } }
  return { min: { x: minX, y: minY }, max: { x: maxX, y: maxY } }
}

/** 世界坐标命中测试 */
export function pointInBody(shape: Shape, transform: { x: number; y: number; angle: number }, world: Vec2, precision: Precision = 'teach'): boolean {
  const local = rot({ x: world.x - transform.x, y: world.y - transform.y }, -transform.angle)
  return pointInShape(shape, local, precision)
}

export function bodyAABB(shape: Shape, transform: { x: number; y: number; angle: number }, precision: Precision = 'teach') {
  const box = shapeAABB(shape, precision)
  const corners = [
    box.min,
    { x: box.max.x, y: box.min.y },
    box.max,
    { x: box.min.x, y: box.max.y },
  ].map((p) => {
    const r = rot(p, transform.angle)
    return { x: r.x + transform.x, y: r.y + transform.y }
  })
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const p of corners) {
    minX = Math.min(minX, p.x)
    minY = Math.min(minY, p.y)
    maxX = Math.max(maxX, p.x)
    maxY = Math.max(maxY, p.y)
  }
  return { min: { x: minX, y: minY }, max: { x: maxX, y: maxY } }
}

export function isConvex(poly: Vec2[]): boolean {
  if (poly.length < 4) return true
  let sign = 0
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]!
    const b = poly[(i + 1) % poly.length]!
    const c = poly[(i + 2) % poly.length]!
    const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x)
    if (Math.abs(cross) < 1e-12) continue
    const s = Math.sign(cross)
    if (sign === 0) sign = s
    else if (s !== sign) return false
  }
  return true
}

/** 耳切法三角化（凹多边形）。返回逆时针三角形列表。 */
export function triangulate(points: Vec2[]): Vec2[][] {
  const poly = dedupe(points).slice()
  if (poly.length < 3) return []
  if (polygonArea(poly) < 0) poly.reverse()
  const idx = poly.map((_, i) => i)
  const out: Vec2[][] = []
  let guard = 0
  while (idx.length > 3 && guard++ < 2000) {
    let clipped = false
    for (let i = 0; i < idx.length; i++) {
      const ia = idx[(i + idx.length - 1) % idx.length]!
      const ib = idx[i]!
      const ic = idx[(i + 1) % idx.length]!
      const a = poly[ia]!
      const b = poly[ib]!
      const c = poly[ic]!
      const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x)
      if (cross <= 1e-12) continue
      let contains = false
      for (const k of idx) {
        if (k === ia || k === ib || k === ic) continue
        const p = poly[k]!
        if (inTriangle(p, a, b, c)) {
          contains = true
          break
        }
      }
      if (contains) continue
      out.push([a, b, c])
      idx.splice(i, 1)
      clipped = true
      break
    }
    if (!clipped) break
  }
  if (idx.length === 3) out.push([poly[idx[0]!]!, poly[idx[1]!]!, poly[idx[2]!]!])
  return out
}

function inTriangle(p: Vec2, a: Vec2, b: Vec2, c: Vec2): boolean {
  const d1 = (p.x - b.x) * (a.y - b.y) - (a.x - b.x) * (p.y - b.y)
  const d2 = (p.x - c.x) * (b.y - c.y) - (b.x - c.x) * (p.y - c.y)
  const d3 = (p.x - a.x) * (c.y - a.y) - (c.x - a.x) * (p.y - a.y)
  const hasNeg = d1 < -1e-12 || d2 < -1e-12 || d3 < -1e-12
  const hasPos = d1 > 1e-12 || d2 > 1e-12 || d3 > 1e-12
  return !(hasNeg && hasPos)
}

/** 意图形状 → 物理 fixture（局部坐标）。
 * skipArcs：轨道体不生成弧的碰撞 fixture（弧由 track 约束承担），但保留底座/支柱。
 */
export function toPhysicsFixtures(
  shape: Shape,
  precision: Precision = 'teach',
  opts: { skipArcs?: boolean } = {},
): FixtureSpec[] {
  if (opts.skipArcs && shape.type === 'arc') return []
  switch (shape.type) {
    case 'circle':
      return [{ kind: 'circle', radius: shape.r, center: { x: 0, y: 0 } }]
    case 'rect': {
      const hw = shape.w / 2
      const hh = shape.h / 2
      return [
        {
          kind: 'polygon',
          vertices: [
            { x: -hw, y: -hh },
            { x: hw, y: -hh },
            { x: hw, y: hh },
            { x: -hw, y: hh },
          ],
        },
      ]
    }
    case 'polygon': {
      const pts = dedupe(shape.points)
      if (pts.length < 3) return []
      if (isConvex(pts) && pts.length <= 8) return [{ kind: 'polygon', vertices: pts }]
      return triangulate(pts).map((vertices) => ({ kind: 'polygon' as const, vertices }))
    }
    case 'arc': {
      const pts = arcPoints(shape, precision)
      if (pts.length < 2) return []
      return [{ kind: 'chain', vertices: pts, loop: isFullCircle(shape.a0, shape.a1) }]
    }
    case 'polyline': {
      const pts = dedupe(shape.points)
      if (pts.length < 2) return []
      return [{ kind: 'chain', vertices: pts, loop: !!shape.closed }]
    }
    case 'bezier': {
      const pts = bezierPoints(shape, precision)
      if (pts.length < 2) return []
      return [{ kind: 'chain', vertices: pts, loop: false }]
    }
    case 'compound':
      return shape.parts.flatMap((p) => toPhysicsFixtures(p, precision, opts))
  }
}

/** 采样后的世界坐标折线，用于轨迹/矢量绘制 */
export function shapePolylineWorld(shape: Shape, transform: { x: number; y: number; angle: number }, precision: Precision = 'teach'): Vec2[] {
  const g = renderGeometries(shape, precision)[0]
  if (!g) return []
  const pts = g.kind === 'fill' ? g.outlines[0] ?? [] : g.points
  return pts.map((p) => {
    const r = rot(p, transform.angle)
    return { x: r.x + transform.x, y: r.y + transform.y }
  })
}

/** 夹取到桩形（用于把生成物体放进世界边界） */
export function clampToRange(v: number, lo: number, hi: number): number {
  return clamp(v, lo, hi)
}
