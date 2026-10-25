/**
 * 批注墨迹：老师讲课时在模型上「指」的痕迹。
 *
 * 三个约定（见 docs/ANNOTATION-DESIGN.md）：
 * 1. 点存**世界坐标**——缩放/平移后跟着模型走，不会错位；
 * 2. 线宽存**屏幕像素**——放大后线条不会变粗；
 * 3. 纯函数，渲染器不持有状态（铁律一）：墨迹由 App 持有，这里只负责画。
 *
 * 墨迹**不进 Scene**，所以不影响分享串，也不参与物理与判据。
 */
import type { Vec2 } from '@core/math'
import type { Camera } from './camera'
import { THEME } from './theme'

export type InkStroke = { points: Vec2[] }

/** 屏幕像素线宽：不随相机缩放变化。投屏上课要看得清，3px 起步 */
const WIDTH_PX = 3
/** 采样最小间距（世界坐标）：太密的点只是浪费，手机上一次滑动会产生上百个点 */
const MIN_STEP_WORLD = 0.006

/** 是否够远，值得再记一个点。 */
export function shouldSample(last: Vec2 | undefined, p: Vec2): boolean {
  if (!last) return true
  return Math.hypot(p.x - last.x, p.y - last.y) >= MIN_STEP_WORLD
}

export function drawInk(
  ctx: CanvasRenderingContext2D,
  camera: Camera,
  strokes: InkStroke[],
): void {
  if (strokes.length === 0) return
  ctx.save()
  ctx.strokeStyle = THEME.ink
  ctx.fillStyle = THEME.ink
  ctx.lineWidth = WIDTH_PX
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  for (const stroke of strokes) {
    const pts = stroke.points
    if (pts.length === 0) continue
    if (pts.length === 1) {
      // 单点 = 一个圆点（点一下也是有效批注）
      const s = camera.project(pts[0]!)
      ctx.beginPath()
      ctx.arc(s.x, s.y, WIDTH_PX / 2, 0, Math.PI * 2)
      ctx.fill()
      continue
    }
    const first = camera.project(pts[0]!)
    ctx.beginPath()
    ctx.moveTo(first.x, first.y)
    for (let i = 1; i < pts.length; i++) {
      const s = camera.project(pts[i]!)
      ctx.lineTo(s.x, s.y)
    }
    ctx.stroke()
  }
  ctx.restore()
}

/** 点到线段的距离（世界坐标），用于橡皮命中。 */
function distToSegment(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len2 = dx * dx + dy * dy
  if (len2 < 1e-12) return Math.hypot(p.x - a.x, p.y - a.y)
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2
  t = Math.max(0, Math.min(1, t))
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy))
}

/**
 * 找到命中点附近的笔画下标；没有则 -1。
 * `radiusWorld` 由调用方按屏幕像素换算，保证手指粗细的手感不随缩放变化。
 */
export function inkHitTest(strokes: InkStroke[], p: Vec2, radiusWorld: number): number {
  for (let i = strokes.length - 1; i >= 0; i--) {
    const pts = strokes[i]!.points
    if (pts.length === 1) {
      if (Math.hypot(p.x - pts[0]!.x, p.y - pts[0]!.y) <= radiusWorld) return i
      continue
    }
    for (let j = 1; j < pts.length; j++) {
      if (distToSegment(p, pts[j - 1]!, pts[j]!) <= radiusWorld) return i
    }
  }
  return -1
}
