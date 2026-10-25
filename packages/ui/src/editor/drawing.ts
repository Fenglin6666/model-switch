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

export type FieldKind = 'E' | 'B'

/** 拖出来的那块场：region 为 null 表示全场 */
export type FieldDraft = {
  field: { type: 'E'; vector: Vec2 } | { type: 'B'; bz: number }
  region: { w: number; h: number; x: number; y: number; label: string } | null
}

/** 拖得太小就当「点了一下」——建一块全场场，而不是一个没用的针尖 */
const MIN_FIELD_SIZE = 0.3

/**
 * 电场 / 磁场：按住拖出一个矩形，场就长在这块区域里。
 * 方向先给个默认（E 向下、B 向外），选中的时候在左侧面板调。
 */
export function fieldDraftFromDrag(kind: FieldKind, start: Vec2, current: Vec2): FieldDraft {
  const w = Math.abs(current.x - start.x)
  const h = Math.abs(current.y - start.y)
  const field: FieldDraft['field'] =
    kind === 'E' ? { type: 'E', vector: { x: 0, y: -FIELD_E } } : { type: 'B', bz: FIELD_B }
  if (w < MIN_FIELD_SIZE || h < MIN_FIELD_SIZE) return { field, region: null }
  return {
    field,
    region: {
      w,
      h,
      x: (start.x + current.x) / 2,
      y: (start.y + current.y) / 2,
      label: kind === 'E' ? 'E 区' : 'B 区',
    },
  }
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
