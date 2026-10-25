/**
 * 正交投影相机（架构 §4.2）。
 *
 * 世界坐标 (x,y,z)，z 向上。相机由方位角 φ、仰角 ε 定义：
 *   u =  x·cosφ − y·sinφ
 *   v = (x·sinφ + y·cosφ)·sinε − z·cosε
 *   d = (x·sinφ + y·cosφ)·cosε + z·sinε      // 深度，画家算法用
 *
 * 物理平面 → 世界坐标：vertical 时 (p,q) → (p, 0, q)，horizontal 时 (p,q) → (p, q, 0)。
 * 两个逆映射都是线性的，所以拖拽是像素精确的（往返误差 < 1e-9，见 camera.test.ts）。
 */
import type { Plane } from '@core/scene'
import { clamp, type Vec2 } from '@core/math'

export type ViewPreset = 'side' | 'three'

export type CameraView = {
  preset: ViewPreset
  elevation: number
  azimuth: number
  scale: number
  center: Vec2
}

export type ScreenPoint = { x: number; y: number; d: number }

export class Camera {
  plane: Plane = 'vertical'
  elevation = 0
  azimuth = 0
  scale = 110
  center: Vec2 = { x: 0, y: 0 }
  zoom = 1
  pan = { x: 0, y: 0 }
  width = 800
  height = 600

  private cphi = 1
  private sphi = 0
  private ceps = 1
  private seps = 0
  private u0 = 0
  private v0 = 0
  private depthDx = 0
  private depthDy = 0

  constructor(view?: Partial<CameraView>, plane: Plane = 'vertical') {
    this.plane = plane
    if (view) this.applyView(view)
    else this.update()
  }

  applyView(view: Partial<CameraView> & { plane?: Plane }): void {
    if (view.plane) this.plane = view.plane
    if (view.elevation !== undefined) this.elevation = view.elevation
    if (view.azimuth !== undefined) this.azimuth = view.azimuth
    if (view.scale !== undefined) this.scale = view.scale
    if (view.center) this.center = { ...view.center }
    this.update()
  }

  setPlane(plane: Plane): void {
    this.plane = plane
    this.update()
  }

  setViewport(width: number, height: number): void {
    this.width = width
    this.height = height
    this.update()
  }

  resetPan(): void {
    this.pan = { x: 0, y: 0 }
  }

  /** 侧视：物理题的对答案视角，没有透视变形 */
  setSide(): void {
    this.preset = 'side'
    this.plane = 'vertical'
    this.elevation = 0
    this.azimuth = 0
    this.update()
  }

  /** 3D：能看见厚度和立体遮挡，但仍然以侧视为主 */
  setThree(): void {
    this.preset = 'three'
    this.plane = 'vertical'
    this.elevation = 0.28
    this.azimuth = 0
    this.update()
  }

  setPreset(preset: ViewPreset): void {
    if (preset === 'side') this.setSide()
    else this.setThree()
  }

  /** 拖动旋转整个场景（轨道相机）。yaw 限制在 ±69°，避免平面退化 */
  orbitBy(dx: number, dy: number): void {
    this.azimuth = clamp(this.azimuth - dx * 0.006, -1.2, 1.2)
    this.elevation = clamp(this.elevation + dy * 0.006, -0.18, 1.3)
    this.preset = 'three'
    this.update()
  }

  preset: ViewPreset = 'side'

  update(): void {
    // 奇异点保护：竖直面在 ε=90° 退化，水平面在 ε=0 退化
    const eps = this.plane === 'horizontal' ? clamp(this.elevation, 0.08, Math.PI / 2) : clamp(this.elevation, -0.2, 1.35)
    const phi = clamp(this.azimuth, -1.2, 1.2)
    this.ceps = Math.cos(eps)
    this.seps = Math.sin(eps)
    this.cphi = Math.cos(phi)
    this.sphi = Math.sin(phi)
    const c = this.toUV(this.center, 0)
    this.u0 = c.u
    this.v0 = c.v
    if (this.plane === 'vertical') {
      const s = this.pixelScale
      this.depthDx = -this.sphi * s
      this.depthDy = -this.cphi * this.seps * s
    } else {
      const s = this.pixelScale
      this.depthDx = 0
      this.depthDy = -this.ceps * s
    }
  }

  get pixelScale(): number {
    return this.scale * this.zoom
  }

  /**
   * 平面坐标 + 深度 → 未缩放的 u/v/d。
   *
   * 注意：架构文档 §4.2 里 z 项的符号是反的（会让竖直面上下颠倒）。
   * 这里按「屏幕 v 轴向上」重推：v = base·sinε + z·cosε，d = base·cosε − z·sinε。
   * 往返测试与三个视角预设都验证过（含正视/俯视/斜视）。
   */
  toUV(p: Vec2, depth: number): { u: number; v: number; d: number } {
    if (this.plane === 'vertical') {
      const x = p.x
      const y = depth
      const z = p.y
      const u = x * this.cphi - y * this.sphi
      const base = x * this.sphi + y * this.cphi
      return { u, v: base * this.seps + z * this.ceps, d: base * this.ceps - z * this.seps }
    }
    const x = p.x
    const y = p.y
    const z = depth
    const u = x * this.cphi - y * this.sphi
    const base = x * this.sphi + y * this.cphi
    return { u, v: base * this.seps + z * this.ceps, d: base * this.ceps - z * this.seps }
  }

  project(p: Vec2, depth = 0): ScreenPoint {
    const { u, v, d } = this.toUV(p, depth)
    const s = this.pixelScale
    return {
      x: this.width / 2 + (u - this.u0) * s + this.pan.x,
      y: this.height / 2 - (v - this.v0) * s + this.pan.y,
      d,
    }
  }

  unproject(sx: number, sy: number): Vec2 {
    const s = this.pixelScale
    const u = (sx - this.pan.x - this.width / 2) / s + this.u0
    const v = -(sy - this.pan.y - this.height / 2) / s + this.v0
    if (this.plane === 'horizontal') {
      const a = v / Math.max(Math.abs(this.seps), 1e-6)
      return { x: u * this.cphi + a * this.sphi, y: -u * this.sphi + a * this.cphi }
    }
    const x = u / Math.max(Math.abs(this.cphi), 1e-6)
    const z = (v - x * this.sphi * this.seps) / Math.max(Math.abs(this.ceps), 1e-6)
    return { x, y: z }
  }

  /** 深度偏移在屏幕上对应的位移（挤出用） */
  depthOffsetPx(depth: number): { x: number; y: number } {
    return { x: this.depthDx * depth, y: this.depthDy * depth }
  }

  depthOf(p: Vec2, depth = 0): number {
    return this.toUV(p, depth).d
  }

  panBy(dx: number, dy: number): void {
    this.pan = { x: this.pan.x + dx, y: this.pan.y + dy }
  }

  zoomAt(sx: number, sy: number, factor: number): void {
    const before = this.unproject(sx, sy)
    this.zoom = clamp(this.zoom * factor, 0.35, 3.2)
    const after = this.project(before, 0)
    this.pan = { x: this.pan.x + (sx - after.x), y: this.pan.y + (sy - after.y) }
  }

  /** 可视平面范围（用于网格） */
  visibleBounds(): { minX: number; maxX: number; minY: number; maxY: number } {
    const pts = [
      this.unproject(0, 0),
      this.unproject(this.width, 0),
      this.unproject(0, this.height),
      this.unproject(this.width, this.height),
    ]
    const xs = pts.map((p) => p.x)
    const ys = pts.map((p) => p.y)
    return {
      minX: Math.min(...xs),
      maxX: Math.max(...xs),
      minY: Math.min(...ys),
      maxY: Math.max(...ys),
    }
  }

  /** 把一组平面点框进视口 */
  fit(points: Vec2[], padding = 48): void {
    if (points.length === 0) return
    let minX = Infinity
    let maxX = -Infinity
    let minY = Infinity
    let maxY = -Infinity
    for (const p of points) {
      minX = Math.min(minX, p.x)
      maxX = Math.max(maxX, p.x)
      minY = Math.min(minY, p.y)
      maxY = Math.max(maxY, p.y)
    }
    const cx = (minX + maxX) / 2
    const cy = (minY + maxY) / 2
    const corners: Vec2[] = [
      { x: minX, y: minY },
      { x: maxX, y: minY },
      { x: maxX, y: maxY },
      { x: minX, y: maxY },
    ]
    const uv = corners.map((c) => this.toUV(c, 0))
    const du = Math.max(...uv.map((p) => p.u)) - Math.min(...uv.map((p) => p.u))
    const dv = Math.max(...uv.map((p) => p.v)) - Math.min(...uv.map((p) => p.v))
    const availW = Math.max(80, this.width - padding * 2)
    const availH = Math.max(80, this.height - padding * 2)
    this.center = { x: cx, y: cy }
    this.zoom = 1
    this.pan = { x: 0, y: 0 }
    this.scale = clamp(Math.min(availW / Math.max(du, 0.2), availH / Math.max(dv, 0.2)), 30, 420)
    this.update()
  }
}
