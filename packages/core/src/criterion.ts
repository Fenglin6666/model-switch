/**
 * 判据引擎：只读事件流，不参与物理（架构 §7.1）。
 *
 * 每个判据是一个有状态的谓词：喂入每一帧的采样，输出 pass / triggeredAt。
 * 判据不判对错、不打分——它只回答「这一刻，条件翻转了吗」。
 */
import type { Criterion, Region, Scene } from './scene'
import { findBody, findRegion } from './scene'
import { pointInShape } from './shapes'
import { rot } from './math'

/** 区域自带 transform，命中测试要把世界坐标转回局部坐标 */
export function regionContains(region: Region, world: { x: number; y: number }): boolean {
  const local = rot(
    { x: world.x - region.transform.x, y: world.y - region.transform.y },
    -region.transform.angle,
  )
  return pointInShape(region.shape, local)
}

export type BodySample = {
  x: number
  y: number
  vx: number
  vy: number
  ax: number
  ay: number
  angle: number
  omega: number
  contactCount: number
}

export type Frame = {
  t: number
  bodies: Record<string, BodySample>
  /** 接触对计数，key = pairKey(a,b) */
  contacts: Record<string, number>
  energy: { ke: number; pe: number; total: number }
  momentum: { x: number; y: number }
  /** Σ mᵢ|vᵢ|，动量守恒判据的参考尺度（避免 p≈0 时除以 0） */
  momentumScale: number
}

export type CriterionResult = {
  pass: boolean
  triggeredAt?: number
  /** 供 UI 展示的实时量（例如最大高度、当前误差） */
  detail?: Record<string, number>
  label?: string
}

export function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`
}

type State = {
  c: Criterion
  pass: boolean
  triggeredAt?: number
  /** detach：是否曾经接触过 */
  touched: boolean
  /** 去抖计时起点（hold 语义） */
  since?: number
  /** escape：是否曾进入 */
  wasInside: boolean
  /** conserve：参照值 */
  e0?: number
  p0?: { x: number; y: number }
  maxError: number
  detail: Record<string, number>
}

export class CriteriaRunner {
  private states: State[]
  /** 沉静期：能量类判据等系统稳定后再取基准（接触/脱离类必须从 0 开始判） */
  private settle: number

  constructor(scene: Scene) {
    this.settle = scene.world.settle ?? 0
    this.states = scene.criteria.map((c) => ({
      c,
      pass: false,
      touched: false,
      wasInside: false,
      maxError: 0,
      detail: {},
    }))
  }

  reset(): void {
    for (const s of this.states) {
      s.pass = false
      s.triggeredAt = undefined
      s.touched = false
      s.since = undefined
      s.wasInside = false
      s.e0 = undefined
      s.p0 = undefined
      s.maxError = 0
      s.detail = {}
    }
  }

  update(frame: Frame, scene: Scene): void {
    for (const s of this.states) {
      if (s.pass && s.c.kind !== 'conserve' && s.c.kind !== 'coincide') continue
      updateOne(s, frame, scene, this.settle)
    }
  }

  results(): Record<string, CriterionResult> {
    const out: Record<string, CriterionResult> = {}
    for (const s of this.states) {
      out[s.c.id] = {
        pass: s.pass,
        triggeredAt: s.triggeredAt,
        detail: { ...s.detail },
        label: s.c.label,
      }
    }
    return out
  }

  get anyPassed(): boolean {
    return this.states.some((s) => s.pass)
  }

  /** 提前终止用：判据已经触发（conserve 除外，它要跑满时长） */
  get terminalPassed(): boolean {
    return this.states.some((s) => s.pass && s.c.kind !== 'conserve')
  }
}

function updateOne(s: State, frame: Frame, scene: Scene, settle: number): void {
  const c = s.c
  const hold = 'hold' in c && c.hold !== undefined ? c.hold : 0.05
  switch (c.kind) {
    case 'detach': {
      if (c.after !== undefined && frame.t < c.after) return
      if (c.until !== undefined && frame.t > c.until && !s.pass) return
      const body = frame.bodies[c.bodyId]
      if (!body) return
      const count = c.trackId
        ? frame.contacts[pairKey(c.bodyId, c.trackId)] ?? 0
        : body.contactCount
      if (count > 0) {
        s.touched = true
        s.since = undefined
      } else if (s.touched) {
        if (s.since === undefined) s.since = frame.t
        s.detail.gap = frame.t - s.since
        if (frame.t - s.since >= hold) {
          s.pass = true
          s.triggeredAt ??= s.since
        }
      }
      break
    }
    case 'reach': {
      if (c.after !== undefined && frame.t < c.after) return
      const body = frame.bodies[c.bodyId]
      const region = findRegion(scene, c.regionId)
      if (!body || !region) return
      if (c.requireSupport && body.contactCount <= 0) return
      if (regionContains(region, { x: body.x, y: body.y })) {
        s.pass = true
        s.triggeredAt ??= frame.t
      }
      break
    }
    case 'escape': {
      const body = frame.bodies[c.bodyId]
      const region = findRegion(scene, c.regionId)
      if (!body || !region) return
      const inside = regionContains(region, { x: body.x, y: body.y })
      if (inside) {
        s.wasInside = true
        s.since = undefined
      } else if (s.wasInside) {
        if (s.since === undefined) s.since = frame.t
        if (frame.t - s.since >= hold) {
          s.pass = true
          s.triggeredAt ??= s.since
        }
      }
      break
    }
    case 'coincide': {
      const a = frame.bodies[c.bodyA]
      const b = frame.bodies[c.bodyB]
      if (!a || !b) return
      const dv = Math.hypot(a.vx - b.vx, a.vy - b.vy)
      s.detail.dv = dv
      if (dv <= c.eps) {
        if (s.since === undefined) s.since = frame.t
        if (frame.t - s.since >= hold) {
          s.pass = true
          s.triggeredAt ??= s.since
        }
      } else {
        s.since = undefined
      }
      break
    }
    case 'collide': {
      if (c.after !== undefined && frame.t < c.after) return
      if ((frame.contacts[pairKey(c.bodyA, c.bodyB)] ?? 0) > 0) {
        s.pass = true
        s.triggeredAt ??= frame.t
      }
      break
    }
    case 'conserve': {
      // 启动瞬间地面位置修正会顶一下物体，等沉静期过了再取能量基准
      if (frame.t + 1e-9 < settle) return
      if (s.e0 === undefined) {
        s.e0 = frame.energy.total
        s.p0 = { ...frame.momentum }
        return
      }
      let err: number
      if (c.quantity === 'E') {
        const scale = Math.max(Math.abs(s.e0), 1e-6)
        err = Math.abs(frame.energy.total - s.e0) / scale
      } else {
        const axis = c.axis ?? 'both'
        const dx = axis === 'y' ? 0 : frame.momentum.x - s.p0!.x
        const dy = axis === 'x' ? 0 : frame.momentum.y - s.p0!.y
        const p0axis =
          axis === 'x' ? Math.abs(s.p0!.x) : axis === 'y' ? Math.abs(s.p0!.y) : Math.hypot(s.p0!.x, s.p0!.y)
        const pRef = Math.max(p0axis, frame.momentumScale, 1e-9)
        err = Math.hypot(dx, dy) / pRef
      }
      s.maxError = Math.max(s.maxError, err)
      s.detail.error = s.maxError
      s.pass = s.maxError <= c.tol
      if (!s.pass) s.triggeredAt ??= frame.t
      break
    }
  }
}
