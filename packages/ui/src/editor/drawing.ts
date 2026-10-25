/**
 * 画图的纯逻辑：一笔识别成什么物体、场笔这一笔是什么手势、形状怎么缩放。
 *
 * 这些以前都写在 `finishDraw` / `finishFieldStroke` / `scaledShape` 里，夹在
 * 「改 doc → 重建仿真 → 弹 toast」中间，只能靠截图回归。抽出来之后可以在 node 里断言。
 */
import type { Body, Shape } from '@core/scene'
import type { Recognized } from '@core/recognize'
import type { Vec2 } from '@core/math'
import { THEME } from '@render/theme'

/** 场笔的默认强度：E 用 N/C 口径，B 用「垂直纸面」的正负表示方向 */
export const FIELD_E = 40
export const FIELD_B = 2

/** 两段是否相交（画 × 时判断两笔交叉） */
export function segmentsCross(a1: Vec2, a2: Vec2, b1: Vec2, b2: Vec2): boolean {
  const cross = (o: Vec2, a: Vec2, b: Vec2) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x)
  const d1 = cross(b1, b2, a1)
  const d2 = cross(b1, b2, a2)
  const d3 = cross(a1, a2, b1)
  const d4 = cross(a1, a2, b2)
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))
}

export type FieldGesture = 'arrow' | 'dot' | 'cross' | 'pending'

/**
 * 场笔这一笔算什么：
 * - 长线（> 0.8）→ 箭头（电场）
 * - 点一下（< 0.12）→ 磁场向外（·）
 * - 短线 + 上一笔在 1.4s 内且相交 → ×（磁场向里）
 * - 其余 → 先记下这一笔，等第二笔（返回 pending）
 */
export function classifyFieldGesture(input: {
  start: Vec2
  current: Vec2
  prev: { a: Vec2; b: Vec2; t: number } | null
  now: number
}): FieldGesture {
  const len = Math.hypot(input.current.x - input.start.x, input.current.y - input.start.y)
  if (len < 0.12) return 'dot'
  if (len > 0.8) return 'arrow'
  const prev = input.prev
  if (prev && input.now - prev.t < 1400 && segmentsCross(prev.a, prev.b, input.start, input.current)) return 'cross'
  return 'pending'
}

export type PendingField = { type: 'E' | 'B'; vector?: Vec2; bz?: number }

/** 手势 → 待落地的场（方向、正负都定死在这里） */
export function fieldFromGesture(g: Exclude<FieldGesture, 'pending'>, start: Vec2, current: Vec2): PendingField {
  if (g === 'dot') return { type: 'B', bz: FIELD_B }
  if (g === 'cross') return { type: 'B', bz: -FIELD_B }
  const len = Math.max(1e-6, Math.hypot(current.x - start.x, current.y - start.y))
  return { type: 'E', vector: { x: ((current.x - start.x) / len) * FIELD_E, y: ((current.y - start.y) / len) * FIELD_E } }
}

/**
 * 识别结果 → 普通 Body。
 * 圆默认是「球」（会动），方块/三角/线默认是地形（固定）——双击可以改。
 */
export function bodyFromRecognized(rec: Recognized, id: string): Body {
  if (rec.kind === 'circle') {
    return {
      id,
      kind: 'particle',
      role: 'object',
      shape: { type: 'circle', r: Math.max(0.04, rec.r) },
      transform: { x: rec.center.x, y: rec.center.y, angle: 0 },
      material: 'metal',
      appearance: { color: THEME.terrain, depth: 0.14 },
      label: '球',
      fixedRotation: true,
    }
  }
  if (rec.kind === 'rect') {
    return {
      id,
      kind: 'static',
      role: 'terrain',
      shape: { type: 'rect', w: Math.max(0.08, rec.w), h: Math.max(0.08, rec.h) },
      transform: { x: rec.center.x, y: rec.center.y, angle: 0 },
      material: 'stone',
      appearance: { color: THEME.terrain, depth: 0.2 },
      label: '方块',
    }
  }
  if (rec.kind === 'line') {
    const cx = (rec.a.x + rec.b.x) / 2
    const cy = (rec.a.y + rec.b.y) / 2
    return {
      id,
      kind: 'static',
      role: 'terrain',
      shape: { type: 'polyline', points: [{ x: rec.a.x - cx, y: rec.a.y - cy }, { x: rec.b.x - cx, y: rec.b.y - cy }], thick: 0.05 },
      transform: { x: cx, y: cy, angle: 0 },
      material: 'stone',
      appearance: { color: THEME.terrain, depth: 0.2, style: 'thin' },
      label: '直线',
    }
  }
  const pts = rec.points
  const minX = Math.min(...pts.map((p) => p.x))
  const maxX = Math.max(...pts.map((p) => p.x))
  const minY = Math.min(...pts.map((p) => p.y))
  const maxY = Math.max(...pts.map((p) => p.y))
  const cx = (minX + maxX) / 2
  const cy = (minY + maxY) / 2
  const local = pts.map((p) => ({ x: p.x - cx, y: p.y - cy }))
  return {
    id,
    kind: 'static',
    role: 'terrain',
    shape: rec.kind === 'polygon' ? { type: 'polygon', points: local } : { type: 'polyline', points: local, thick: 0.05 },
    transform: { x: cx, y: cy, angle: 0 },
    material: 'stone',
    appearance: { color: THEME.terrain, depth: 0.2, style: rec.kind === 'polygon' ? undefined : 'thin' },
    label: rec.kind === 'polygon' ? '多边形' : '折线',
  }
}

/** 按比例缩放一个形状（拖缩放手柄用）；厚度不缩放，线宽是屏幕语义 */
export function scaleShape(shape: Shape, f: number): Shape {
  switch (shape.type) {
    case 'circle':
      return { ...shape, r: shape.r * f }
    case 'rect':
      return { ...shape, w: shape.w * f, h: shape.h * f }
    case 'arc':
      return { ...shape, r: shape.r * f }
    case 'polyline':
      return { ...shape, points: shape.points.map((p) => ({ x: p.x * f, y: p.y * f })) }
    case 'polygon':
      return { ...shape, points: shape.points.map((p) => ({ x: p.x * f, y: p.y * f })) }
    case 'bezier':
      return { ...shape, ctrl: shape.ctrl.map((p) => ({ x: p.x * f, y: p.y * f })) }
    case 'compound':
      return { ...shape, parts: shape.parts.map((part) => scaleShape(part, f)) }
  }
}
