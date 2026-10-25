/**
 * 手绘识别：画得不规整，自动规整成圆 / 矩形 / 直线 / 多边形 / 折线。
 *
 * 这是「画什么就是什么」的第一层——没有形状按钮，笔一落就开始判断意图：
 *  - 闭合且径向偏差小 → 圆（半径取平均，圆心取质心）
 *  - 闭合且四个角 → 轴对齐矩形（丢掉画歪的那点角度，题里不需要）
 *  - 闭合但既不像圆也不像方 → 多边形（保留顶点）
 *  - 开放且直 → 直线（只留两端点）
 *  - 开放且有弯 → 折线（保留简化后的点，不做样条）
 *
 * 判断只看几何，不猜语义：画出来的东西先当几何，物理性质由用户再给。
 */
import type { Vec2 } from './math'
import { distToSegment, polygonArea, polylineLength, simplifyPath } from './math'

export type Recognized =
  | { kind: 'circle'; center: Vec2; r: number }
  | { kind: 'rect'; center: Vec2; w: number; h: number }
  | { kind: 'polygon'; points: Vec2[] }
  | { kind: 'line'; a: Vec2; b: Vec2 }
  | { kind: 'polyline'; points: Vec2[] }

export type RecognizeOptions = {
  /** 点太少/太小就不认，返回 null（用户只是点了一下） */
  minSize?: number
}

function bbox(points: Vec2[]) {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const p of points) {
    minX = Math.min(minX, p.x)
    minY = Math.min(minY, p.y)
    maxX = Math.max(maxX, p.x)
    maxY = Math.max(maxY, p.y)
  }
  return { minX, minY, maxX, maxY, w: maxX - minX, h: maxY - minY }
}

/** 闭合程度：首尾距离 / 包围盒对角线 */
function closure(points: Vec2[], diag: number): number {
  const a = points[0]!
  const b = points[points.length - 1]!
  return Math.hypot(b.x - a.x, b.y - a.y) / Math.max(diag, 1e-9)
}

/**
 * 圆形度：所有点到**包围盒中心**的距离，标准差 / 均值越小越像圆。
 * 不用质心——RDP 简化后采样点疏密不均，质心会偏（实测能偏 0.07）。
 */
function circularity(points: Vec2[], center: Vec2): { center: Vec2; r: number; spread: number } {
  const cx = center.x
  const cy = center.y
  let sum = 0
  const radii: number[] = []
  for (const p of points) {
    const r = Math.hypot(p.x - cx, p.y - cy)
    radii.push(r)
    sum += r
  }
  const mean = sum / Math.max(1, radii.length)
  let varSum = 0
  for (const r of radii) varSum += (r - mean) ** 2
  const std = Math.sqrt(varSum / Math.max(1, radii.length))
  return { center: { x: cx, y: cy }, r: mean, spread: std / Math.max(mean, 1e-9) }
}

/** 直线的「直」程度：各点到弦的最大垂直距离 / 弦长 */
function straightness(points: Vec2[]): number {
  const a = points[0]!
  const b = points[points.length - 1]!
  const len = Math.hypot(b.x - a.x, b.y - a.y)
  if (len < 1e-9) return 1
  let worst = 0
  for (const p of points) worst = Math.max(worst, distToSegment(p, a, b))
  return worst / len
}


export function recognizeStroke(raw: Vec2[], opts: RecognizeOptions = {}): Recognized | null {
  const minSize = opts.minSize ?? 0.12
  const pts = simplifyPath(raw, 0.012)
  if (pts.length < 2) return null
  const box = bbox(pts)
  const diag = Math.hypot(box.w, box.h)
  if (diag < minSize) return null
  const pathLen = polylineLength(pts)
  // 画得太短（相对包围盒）说明只是抖了一下
  if (pathLen < diag * 1.02) {
    return { kind: 'line', a: pts[0]!, b: pts[pts.length - 1]! }
  }

  const closeRatio = closure(pts, diag)
  const closed = closeRatio < 0.24 && pathLen > diag * 1.5

  if (closed) {
    // 圆形度必须用**原始采样点**：简化后的点只剩四个角，到中心距离全都一样，
    // 会把矩形误判成圆（这个 bug 真踩过）
    const cir = circularity(raw, { x: (box.minX + box.maxX) / 2, y: (box.minY + box.maxY) / 2 })
    // 圆：径向偏差 < 12%，且确实绕了一圈
    if (cir.spread < 0.12 && cir.r > minSize / 2) {
      return { kind: 'circle', center: cir.center, r: cir.r }
    }
    // 方：闭合面积 ≈ 包围盒面积（矩形≈1、三角形≈0.5、圆≈0.78 已在上面被认走）
    const corners = simplifyPath(pts, Math.max(diag * 0.05, 0.025))
    const boxArea = Math.max(box.w * box.h, 1e-9)
    const fill = Math.abs(polygonArea(pts)) / boxArea
    if (fill > 0.82 && box.w > 0.05 && box.h > 0.05) {
      return {
        kind: 'rect',
        center: { x: (box.minX + box.maxX) / 2, y: (box.minY + box.maxY) / 2 },
        w: box.w,
        h: box.h,
      }
    }
    return { kind: 'polygon', points: corners }
  }

  // 开放：够直就是一条线
  if (straightness(pts) < 0.05) {
    return { kind: 'line', a: pts[0]!, b: pts[pts.length - 1]! }
  }
  return { kind: 'polyline', points: pts }
}

/** 给 UI 用的一句话，说明「这一笔被认成了什么」 */
export function describeRecognized(r: Recognized): string {
  switch (r.kind) {
    case 'circle':
      return '圆'
    case 'rect':
      return '矩形'
    case 'polygon':
      return '多边形'
    case 'line':
      return '直线'
    case 'polyline':
      return '折线'
  }
}
