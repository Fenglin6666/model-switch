/** 二维向量与几何小工具。全部纯函数，零依赖，可在 Node / 小程序里跑。 */

export type Vec2 = { x: number; y: number }

export const V = (x = 0, y = 0): Vec2 => ({ x, y })

export const add = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x + b.x, y: a.y + b.y })
export const sub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y })
export const scale = (a: Vec2, s: number): Vec2 => ({ x: a.x * s, y: a.y * s })
export const dot = (a: Vec2, b: Vec2): number => a.x * b.x + a.y * b.y
export const cross = (a: Vec2, b: Vec2): number => a.x * b.y - a.y * b.x
export const len = (a: Vec2): number => Math.hypot(a.x, a.y)
export const len2 = (a: Vec2): number => a.x * a.x + a.y * a.y
export const norm = (a: Vec2): Vec2 => {
  const l = len(a)
  return l > 1e-12 ? { x: a.x / l, y: a.y / l } : { x: 0, y: 0 }
}
export const neg = (a: Vec2): Vec2 => ({ x: -a.x, y: -a.y })
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t
export const lerpV = (a: Vec2, b: Vec2, t: number): Vec2 => ({
  x: lerp(a.x, b.x, t),
  y: lerp(a.y, b.y, t),
})

export function rot(a: Vec2, angle: number): Vec2 {
  const c = Math.cos(angle)
  const s = Math.sin(angle)
  return { x: a.x * c - a.y * s, y: a.x * s + a.y * c }
}

export const clamp = (x: number, lo: number, hi: number): number =>
  x < lo ? lo : x > hi ? hi : x

export const deg = (rad: number): number => (rad * 180) / Math.PI
export const rad = (d: number): number => (d * Math.PI) / 180

export const distance = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.y - b.y)

/** 点到线段距离（用于折线命中测试） */
export function distToSegment(p: Vec2, a: Vec2, b: Vec2): number {
  const abx = b.x - a.x
  const aby = b.y - a.y
  const l2 = abx * abx + aby * aby
  if (l2 < 1e-12) return distance(p, a)
  const t = clamp(((p.x - a.x) * abx + (p.y - a.y) * aby) / l2, 0, 1)
  return Math.hypot(p.x - (a.x + abx * t), p.y - (a.y + aby * t))
}

/** 射线法判断点是否在多边形内（允许凹多边形），边界上的点算在内 */
export function pointInPolygon(p: Vec2, poly: Vec2[]): boolean {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!
    const b = poly[j]!
    if (distToSegment(p, a, b) < 1e-9) return true
    const intersect = a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x
    if (intersect) inside = !inside
  }
  return inside
}

/** 有符号面积（逆时针为正） */
export function polygonArea(poly: Vec2[]): number {
  let s = 0
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    s += (poly[j]!.x - poly[i]!.x) * (poly[j]!.y + poly[i]!.y)
  }
  return s / 2
}

export function polygonCentroid(poly: Vec2[]): Vec2 {
  let cx = 0
  let cy = 0
  let a = 0
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const f = poly[j]!.x * poly[i]!.y - poly[i]!.x * poly[j]!.y
    a += f
    cx += (poly[j]!.x + poly[i]!.x) * f
    cy += (poly[j]!.y + poly[i]!.y) * f
  }
  if (Math.abs(a) < 1e-12) {
    // 退化：取顶点平均
    let sx = 0
    let sy = 0
    for (const q of poly) {
      sx += q.x
      sy += q.y
    }
    return { x: sx / poly.length, y: sy / poly.length }
  }
  const k = 1 / (3 * a)
  return { x: cx * k, y: cy * k }
}

export function polylineLength(pts: Vec2[]): number {
  let s = 0
  for (let i = 1; i < pts.length; i++) s += distance(pts[i - 1]!, pts[i]!)
  return s
}

export function almostEqual(a: number, b: number, eps = 1e-9): boolean {
  return Math.abs(a - b) <= eps
}

/** 三次/二次贝塞尔采样，t∈[0,1] */
export function bezierPoint(ctrl: Vec2[], t: number): Vec2 {
  if (ctrl.length === 4) {
    const u = 1 - t
    const a = u * u * u
    const b = 3 * u * u * t
    const c = 3 * u * t * t
    const d = t * t * t
    return {
      x: a * ctrl[0]!.x + b * ctrl[1]!.x + c * ctrl[2]!.x + d * ctrl[3]!.x,
      y: a * ctrl[0]!.y + b * ctrl[1]!.y + c * ctrl[2]!.y + d * ctrl[3]!.y,
    }
  }
  if (ctrl.length === 3) {
    const u = 1 - t
    return {
      x: u * u * ctrl[0]!.x + 2 * u * t * ctrl[1]!.x + t * t * ctrl[2]!.x,
      y: u * u * ctrl[0]!.y + 2 * u * t * ctrl[1]!.y + t * t * ctrl[2]!.y,
    }
  }
  return ctrl[0] ?? { x: 0, y: 0 }
}

/** 沿闭合/开放折线等距取点，用于画箭头、刻度 */
export function pathPointAt(pts: Vec2[], s: number): Vec2 {
  let acc = 0
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!
    const b = pts[i]!
    const l = distance(a, b)
    if (acc + l >= s) return lerpV(a, b, (s - acc) / Math.max(l, 1e-9))
    acc += l
  }
  return pts[pts.length - 1] ?? { x: 0, y: 0 }
}


/** Ramer–Douglas–Peucker：手绘点太多，抽稀到能看出来但计算便宜 */
export function simplifyPath(points: Vec2[], epsilon = 0.02): Vec2[] {
  if (points.length <= 2) return points.slice()
  const sq = epsilon * epsilon
  const keep = new Array<boolean>(points.length).fill(false)
  keep[0] = true
  keep[points.length - 1] = true
  const stack: Array<[number, number]> = [[0, points.length - 1]]
  while (stack.length) {
    const [a, b] = stack.pop()!
    let maxD = 0
    let idx = -1
    for (let i = a + 1; i < b; i++) {
      const p = points[i]!
      const ab = { x: points[b]!.x - points[a]!.x, y: points[b]!.y - points[a]!.y }
      const ap = { x: p.x - points[a]!.x, y: p.y - points[a]!.y }
      const len2 = ab.x * ab.x + ab.y * ab.y
      const t = len2 < 1e-12 ? 0 : Math.max(0, Math.min(1, (ap.x * ab.x + ap.y * ab.y) / len2))
      const dx = ap.x - ab.x * t
      const dy = ap.y - ab.y * t
      const d = dx * dx + dy * dy
      if (d > maxD) {
        maxD = d
        idx = i
      }
    }
    if (idx > 0 && maxD > sq) {
      keep[idx] = true
      stack.push([a, idx], [idx, b])
    }
  }
  return points.filter((_, i) => keep[i])
}
