/**
 * 组件吸附：把一个正在放置/拖动的物体吸到另一个物体的表面上。
 *
 * 这是「组件之间有逻辑」的最小实现：拖一个球到斜面上，球会贴到斜面上并停住；
 * 拖一个方块到斜面，方块会转到和斜面同一个角度。吸附点在平面内计算，
 * 和相机角度无关（3D 视角下也成立）。
 */
import type { Body, Scene } from './scene'
import { bodyAABB, renderGeometries } from './shapes'
import type { Vec2 } from './math'

export type SnapHit = {
  /** 被吸附到的物体 */
  targetId: string
  /** 表面上的接触点 */
  point: Vec2
  /** 从表面指向移动物体的方向 */
  normal: Vec2
  /** 表面的切线方向（弧度），方块用它对齐角度 */
  angle: number
  /** 吸附前物体中心和表面的距离（减去支撑半径），越小越优先 */
  gap: number
}

export type SnapOptions = {
  /** 超过这个距离就不吸 */
  threshold?: number
  /** 是否允许旋转物体去贴合表面 */
  rotate?: boolean
}

type Edge = { a: Vec2; b: Vec2; bodyId: string }

function rotate(v: Vec2, angle: number): Vec2 {
  const c = Math.cos(angle)
  const s = Math.sin(angle)
  return { x: v.x * c - v.y * s, y: v.x * s + v.y * c }
}

function toWorld(p: Vec2, b: Body): Vec2 {
  const r = rotate(p, b.transform.angle)
  return { x: r.x + b.transform.x, y: r.y + b.transform.y }
}

/** 物体在某个方向上的“支撑半径”，用于把它放到表面上 */
function supportRadius(body: Body, angle: number): number {
  const s = body.shape
  if (s.type === 'circle') return s.r
  if (s.type === 'rect') return s.h / 2
  const box = bodyAABB(s, { x: 0, y: 0, angle })
  const c = Math.cos(angle)
  const sn = Math.sin(angle)
  return Math.abs(c) * (box.max.x - box.min.x) / 2 + Math.abs(sn) * (box.max.y - box.min.y) / 2
}

function collectEdges(scene: Scene, excludeId: string): Edge[] {
  const edges: Edge[] = []
  for (const b of scene.bodies) {
    if (b.id === excludeId) continue
    // 圆弧：吸附面是**内表面** r（不是描边中线 r+thick/2），否则球会陷进槽壁
    if (b.shape.type === 'arc') {
      const s = b.shape
      const n = 64
      const pts: Vec2[] = []
      for (let i = 0; i <= n; i++) {
        const a = s.a0 + ((s.a1 - s.a0) * i) / n
        pts.push(toWorld({ x: Math.cos(a) * s.r, y: Math.sin(a) * s.r }, b))
      }
      for (let i = 1; i < pts.length; i++) edges.push({ a: pts[i - 1]!, b: pts[i]!, bodyId: b.id })
      continue
    }
    for (const g of renderGeometries(b.shape, 'teach')) {
      if (g.kind === 'fill') {
        for (const outline of g.outlines) {
          if (outline.length < 2) continue
          for (let i = 0; i < outline.length; i++) {
            const j = (i + 1) % outline.length
            edges.push({ a: toWorld(outline[i]!, b), b: toWorld(outline[j]!, b), bodyId: b.id })
          }
        }
      } else {
        for (let i = 1; i < g.points.length; i++) {
          edges.push({
            a: toWorld(g.points[i - 1]!, b),
            b: toWorld(g.points[i]!, b),
            bodyId: b.id,
          })
        }
        if (g.closed && g.points.length > 2) {
          edges.push({
            a: toWorld(g.points[g.points.length - 1]!, b),
            b: toWorld(g.points[0]!, b),
            bodyId: b.id,
          })
        }
      }
    }
  }
  return edges
}

function closestOnSegment(p: Vec2, a: Vec2, b: Vec2): { q: Vec2; t: number } {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len2 = dx * dx + dy * dy
  if (len2 < 1e-12) return { q: a, t: 0 }
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2
  t = Math.max(0, Math.min(1, t))
  return { q: { x: a.x + dx * t, y: a.y + dy * t }, t }
}

/**
 * 以 center 为移动物体的候选中心，找最近的吸附面。
 * 返回的 normal 永远指向物体一侧（球在槽里就是朝槽内）。
 */
export function findSnap(scene: Scene, body: Body, center: Vec2, opts: SnapOptions = {}): SnapHit | null {
  const threshold = opts.threshold ?? 0.3
  const allowRotate = opts.rotate ?? true
  const edges = collectEdges(scene, body.id)
  if (edges.length === 0) return null

  const support = supportRadius(body, body.transform.angle)
  let best: SnapHit | null = null

  for (const e of edges) {
    const { q } = closestOnSegment(center, e.a, e.b)
    const dx = center.x - q.x
    const dy = center.y - q.y
    const dist = Math.hypot(dx, dy)
    const gap = dist - support
    if (gap > threshold || gap < -Math.max(0.08, support * 0.9)) continue
    // 法线：从表面指向物体中心；重合时用边的垂线
    let nx: number
    let ny: number
    if (dist < 1e-6) {
      const t = { x: e.b.x - e.a.x, y: e.b.y - e.a.y }
      const l = Math.hypot(t.x, t.y) || 1
      nx = t.y / l
      ny = -t.x / l
    } else {
      nx = dx / dist
      ny = dy / dist
    }
    const angle = Math.atan2(e.b.y - e.a.y, e.b.x - e.a.x)
    if (!best || gap < best.gap) {
      best = { targetId: e.bodyId, point: q, normal: { x: nx, y: ny }, angle, gap }
    }
  }

  if (best && !allowRotate) best = { ...best, angle: body.transform.angle }
  return best
}

/** 把物体的 transform 改成吸附后的位置/角度。返回新的 body。 */
export function applySnap(body: Body, hit: SnapHit, opts: SnapOptions = {}): Body {
  const allowRotate = opts.rotate ?? true
  const s = body.shape
  let angle = body.transform.angle
  let x: number
  let y: number

  // 边是没有方向的：把切线角折到 ±90°，否则"斜面朝左"会被当成差 151° 而不旋转
  let surfaceAngle = hit.angle
  if (surfaceAngle > Math.PI / 2) surfaceAngle -= Math.PI
  else if (surfaceAngle < -Math.PI / 2) surfaceAngle += Math.PI

  if (s.type === 'circle') {
    const r = s.r
    x = hit.point.x + hit.normal.x * r
    y = hit.point.y + hit.normal.y * r
  } else if (s.type === 'rect') {
    // 当前角度和表面夹角太大（比如竖直的墙）就不硬转
    const current = body.transform.angle
    const diff = Math.atan2(Math.sin(surfaceAngle - current), Math.cos(surfaceAngle - current))
    if (allowRotate && Math.abs(diff) < (70 * Math.PI) / 180) angle = surfaceAngle
    const half = rotate({ x: 0, y: s.h / 2 }, angle)
    x = hit.point.x + half.x + hit.normal.x * 0.001
    y = hit.point.y + half.y + hit.normal.y * 0.001
  } else {
    const r = supportRadius(body, body.transform.angle)
    angle = allowRotate ? Math.atan2(-hit.normal.x, hit.normal.y) : body.transform.angle
    x = hit.point.x + hit.normal.x * r
    y = hit.point.y + hit.normal.y * r
  }

  return { ...body, transform: { ...body.transform, x, y, angle } }
}
