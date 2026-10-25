/**
 * Planck 适配层：Scene JSON → 可步进的确定性世界。
 *
 * 铁律一：物理层只读 Scene，不写回。渲染层读 `state`，不读 Planck 对象。
 * 铁律二：这里没有任何渲染依赖，Node 里可以 headless 跑（判据搜索就靠它）。
 *
 * 轨道（track 约束）为什么不用碰撞链：
 *   球在半圆弧上滚动时，多边形近似会让每个顶点成为一次微小非弹性碰撞，
 *   能量损失只与分段数有关、与步长无关（实测 60 段：2 s 掉 13%）。
 *   改用 DistanceJoint（理想约束）+ 关节反力判脱离后，临界速度误差 < 0.5%。
 */
import {
  Chain,
  Circle,
  DistanceJoint,
  Polygon,
  PrismaticJoint,
  PulleyJoint,
  RevoluteJoint,
  RopeJoint,
  Vec2,
  World,
  type Body as PlanckBody,
  type Contact,
  type Fixture,
  type Joint,
} from 'planck'
import type { Anchor, Constraint, Plane, Scene } from '@core/scene'
import { findMaterial, resolveFriction, resolveRestitution } from '@core/scene'
import { polygonArea } from '@core/math'
import { toPhysicsFixtures, type FixtureSpec } from '@core/shapes'
import { CriteriaRunner, pairKey, type BodySample, type CriterionResult, type Frame } from '@core/criterion'
import { applyFields, applyPairwiseInteractions } from './forces'
import { measure } from './monitor'

export type SimEvent = {
  t: number
  type: 'speed-clamp' | 'criterion'
  a?: string
  value?: number
  message?: string
}

/** 力的分量，渲染层画受力图用（N）。g=重力，a=外力，e=场力，t=绳/杆/弹簧张力 */
export type ForceArrows = {
  gx: number
  gy: number
  ax: number
  ay: number
  ex: number
  ey: number
  tx: number
  ty: number
  applied: Array<{ x: number; y: number }>
}

export type BodyState = BodySample & { id: string; mass: number; force: ForceArrows }

export type SimState = {
  t: number
  bodies: Record<string, BodyState>
  contacts: Record<string, number>
  energy: { ke: number; pe: number; total: number }
  /** 沉静期结束时的机械能基准（用于漂移显示） */
  energy0?: number
  momentum: { x: number; y: number }
  momentumScale: number
  criteria: Record<string, CriterionResult>
  /** track 约束是否还托着球（用于 UI 高亮与判据） */
  trackAttached: Record<string, boolean>
  speedClamped: boolean
  gases: Record<string, { p: number; v: number; t: number; length: number }>
  events: SimEvent[]
}

export type RunOutcome = {
  passed: boolean
  criterionId?: string
  triggeredAt?: number
  t: number
  criteria: Record<string, CriterionResult>
  speedClamped: boolean
}

type TrackRuntime = {
  constraint: Extract<Constraint, { type: 'track' }>
  ball: PlanckBody
  center: PlanckBody
  joint: DistanceJoint | null
  attached: boolean
  warmup: number
  /** 重新接上的「保险」：脱离后要先真正离开轨道一段，才允许再接上，避免贴面抖动 */
  rearm: boolean
}

function fixtureArea(spec: FixtureSpec): number {
  switch (spec.kind) {
    case 'circle':
      return Math.PI * spec.radius * spec.radius
    case 'polygon':
      return Math.abs(polygonArea(spec.vertices))
    case 'chain':
      return 0
  }
}

export class Simulation {
  readonly scene: Scene
  readonly plane: Plane
  world!: World
  state!: SimState
  private entities: Array<{ id: string; material: string; body: PlanckBody }> = []
  private planckBodies: PlanckBody[] = []
  private byId = new Map<string, PlanckBody>()
  private runner!: CriteriaRunner
  private contactCounts = new Map<string, number>()
  private prevVel = new Map<string, { x: number; y: number }>()
  private frame!: Frame
  private lastClampEvent = -1
  private precision: 'teach' | 'verify'
  private tracks: TrackRuntime[] = []
  /** 绳/杆/弹簧/铰链：关节与它作用在哪个物体上（sign=+1 表示 B 端） */
  private links: Array<{ bodyId: string; joint: Joint; sign: number }> = []
  private sceneById = new Map<string, import('@core/scene').Body>()
  private trackSupport = new Map<string, number>()
  private lastSubDt = 1 / 240
  /** 调试用：最近一次轨道反力（法向分量） */
  lastFriction = -1
  trackDebug: Record<string, { r: number; dotIn: number; attached: boolean }> = {}

  constructor(scene: Scene) {
    this.scene = scene
    this.plane = scene.plane
    this.precision = scene.world.precision ?? 'teach'
    this.rebuild()
  }

  rebuild(): void {
    const scene = this.scene
    const gravity = this.plane === 'vertical' ? -scene.world.gravity : 0
    this.world = new World({ gravity: new Vec2(0, gravity), allowSleep: false })
    this.entities = []
    this.planckBodies = []
    this.byId.clear()
    this.contactCounts.clear()
    this.prevVel.clear()
    this.tracks = []
    this.links = []
    this.sceneById = new Map(scene.bodies.map((b) => [b.id, b]))
    this.trackSupport.clear()
    this.lastClampEvent = -1
    this.state = {
      t: 0,
      bodies: {},
      contacts: {},
      energy: { ke: 0, pe: 0, total: 0 },
      momentum: { x: 0, y: 0 },
      momentumScale: 0,
      criteria: {},
      trackAttached: {},
      energy0: undefined,
      speedClamped: false,
      gases: {},
      events: [],
    }
    this.runner = new CriteriaRunner(scene)

    const trackCenterIds = new Set(
      scene.constraints.filter((c): c is Extract<Constraint, { type: 'track' }> => c.type === 'track').map((c) => c.centerBodyId),
    )

    for (const b of scene.bodies) {
      const type = b.kind === 'static' ? 'static' : b.kind === 'kinematic' ? 'kinematic' : 'dynamic'
      const vx = b.velocity?.x ?? 0
      const vy = b.velocity?.y ?? 0
      const def = {
        type: type as 'static' | 'kinematic' | 'dynamic',
        position: new Vec2(b.transform.x, b.transform.y),
        angle: b.transform.angle,
        linearVelocity: new Vec2(vx, vy),
        angularVelocity: b.omega ?? 0,
        fixedRotation: b.fixedRotation ?? b.kind === 'particle',
        linearDamping: b.linearDamping ?? 0,
        allowSleep: false,
        bullet: Math.hypot(vx, vy) > 5,
        userData: { id: b.id, material: b.material, friction: b.friction },
      }
      const pb = this.world.createBody(def)
      this.byId.set(b.id, pb)
      this.entities.push({ id: b.id, material: b.material, body: pb })
      this.planckBodies.push(pb)
      this.state.bodies[b.id] = {
        id: b.id,
        mass: 0,
        x: b.transform.x,
        y: b.transform.y,
        angle: b.transform.angle,
        vx,
        vy,
        ax: 0,
        ay: 0,
        omega: b.omega ?? 0,
        contactCount: 0,
        force: { gx: 0, gy: 0, ax: 0, ay: 0, ex: 0, ey: 0, tx: 0, ty: 0, applied: [] },
      }

      const specs = toPhysicsFixtures(b.shape, this.precision, {
        skipArcs: trackCenterIds.has(b.id),
      })
      const area = specs.reduce((s, sp) => s + fixtureArea(sp), 0)
      let density = 0
      if (type === 'dynamic') {
        if (b.mass !== undefined && b.mass > 0) {
          density = area > 1e-9 ? b.mass / area : 0
        } else {
          density = 500
        }
      }
      const friction = findMaterial(scene, b.material)?.mu ?? 0.3
      const restitution = findMaterial(scene, b.material)?.restitution ?? 0.1

      for (const spec of specs) {
        const shape = this.makeShape(spec)
        if (!shape) continue
        pb.createFixture({
          shape,
          density,
          friction,
          restitution,
          userData: { id: b.id, material: b.material },
        })
      }

      // 高中题的「小球」是实心球：I = 2/5 mR²。2D 圆在 Planck 里默认是圆盘（1/2），
      // 这里按题目假设改成实心球，滚动加速度才是 5/7·g·sinθ。
      if (type === 'dynamic' && b.kind === 'rigid' && b.shape.type === 'circle') {
        const mass = pb.getMass()
        if (mass > 0) {
          pb.setMassData({ mass, center: new Vec2(0, 0), I: 0.4 * mass * b.shape.r * b.shape.r })
        }
      }

      // 全链条（无面积）的动态体：给一个兜底质量，避免质量 0
      if (type === 'dynamic' && area < 1e-9) {
        const mass = b.mass ?? 1
        pb.setMassData({ mass, center: new Vec2(0, 0), I: mass * 0.1 })
      }
    }

    for (const c of scene.constraints) {
      if (c.type !== 'track') continue
      const ball = this.byId.get(c.bodyId)
      const center = this.byId.get(c.centerBodyId)
      if (!ball || !center) continue
      const waiting = c.entry !== undefined
      const joint = waiting ? null : this.createTrackJoint(center, ball, c.radius)
      this.tracks.push({ constraint: c, ball, center, joint, attached: !waiting, warmup: waiting ? 0 : 2, rearm: !waiting })
      this.trackSupport.set(c.bodyId, 1)
      this.state.trackAttached[c.id] = true
      this.state.contacts[pairKey(c.bodyId, c.centerBodyId)] = 1
    }

    for (const c of scene.constraints) {
      if (c.type === 'rope' || c.type === 'rod' || c.type === 'hinge') {
        this.createLinkJoint(c)
      } else if (c.type === 'pulley') {
        this.createPulleyJoint(c)
      } else if (c.type === 'prismatic') {
        this.createPrismaticJoint(c)
      }
    }

    this.bindContacts()
    this.refresh(0)
    this.evaluateCriteria()
  }

  /** 弹簧用真实力（不是软关节）：能量守恒更好，也方便画力箭头 */
  private applySprings(): void {
    for (const c of this.scene.constraints) {
      if (c.type !== 'spring') continue
      const A = this.anchorWorld(c.a)
      const B = this.anchorWorld(c.b)
      if (!A || !B) continue
      const dx = B.point.x - A.point.x
      const dy = B.point.y - A.point.y
      const d = Math.hypot(dx, dy)
      if (d < 1e-6) continue
      const nx = dx / d
      const ny = dy / d
      const bodyA = A.body
      const bodyB = B.body
      const mA = bodyA && bodyA.isDynamic() ? bodyA.getMass() : 0
      const mB = bodyB && bodyB.isDynamic() ? bodyB.getMass() : 0
      const m = Math.max(mA > 0 ? mA : mB, 0.02)
      const va = bodyA && bodyA.isDynamic() ? bodyA.getLinearVelocity() : { x: 0, y: 0 }
      const vb = bodyB && bodyB.isDynamic() ? bodyB.getLinearVelocity() : { x: 0, y: 0 }
      const vrel = (vb.x - va.x) * nx + (vb.y - va.y) * ny
      const mag = c.k * (d - c.l0) + (c.damping > 0 ? c.damping * 2 * Math.sqrt(c.k * m) * vrel : 0)
      // 拉伸时把 B 拉回 A，所以力的方向是 -n
      const fx = -nx * mag
      const fy = -ny * mag
      if (bodyB && bodyB.isDynamic()) bodyB.applyForceToCenter(new Vec2(fx, fy), true)
      if (bodyA && bodyA.isDynamic()) bodyA.applyForceToCenter(new Vec2(-fx, -fy), true)
    }
  }

  private anchorWorld(a: Anchor): { body: PlanckBody | null; point: { x: number; y: number } } | null {
    if ('world' in a) return { body: null, point: a.world }
    const body = this.byId.get(a.bodyId)
    if (!body) return null
    const p = body.getWorldPoint(new Vec2(a.local.x, a.local.y))
    return { body, point: { x: p.x, y: p.y } }
  }

  private applyAppliedForces(): void {
    const t = this.state.t
    for (const b of this.scene.bodies) {
      if (!b.appliedForce && !(b.forces && b.forces.length)) continue
      if (b.appliedUntil !== undefined && t >= b.appliedUntil) continue
      const pb = this.byId.get(b.id)
      if (!pb || !pb.isDynamic()) continue
      if (b.appliedForce) pb.applyForceToCenter(new Vec2(b.appliedForce.x, b.appliedForce.y), true)
      for (const f of b.forces ?? []) pb.applyForceToCenter(new Vec2(f.x, f.y), true)
    }
  }

  /** world 锚点：给它建一个无 fixture 的静态体，关节就能挂上去 */
  private resolveAnchor(a: Anchor): { body: PlanckBody; local: Vec2; sceneId?: string } | null {
    if ('world' in a) {
      const body = this.world.createBody({ type: 'static', position: new Vec2(a.world.x, a.world.y) })
      return { body, local: new Vec2(0, 0) }
    }
    const body = this.byId.get(a.bodyId)
    if (!body) return null
    return { body, local: new Vec2(a.local.x, a.local.y), sceneId: a.bodyId }
  }

  private createPulleyJoint(c: Extract<Constraint, { type: 'pulley' }>): void {
    const A = this.resolveAnchor(c.a)
    const B = this.resolveAnchor(c.b)
    if (!A || !B) return
    const joint = this.world.createJoint(
      new PulleyJoint({
        bodyA: A.body,
        bodyB: B.body,
        groundAnchorA: new Vec2(c.groundA.x, c.groundA.y),
        groundAnchorB: new Vec2(c.groundB.x, c.groundB.y),
        localAnchorA: A.local,
        localAnchorB: B.local,
        lengthA: c.lengthA,
        lengthB: c.lengthB,
        ratio: c.ratio ?? 1,
      }),
    )
    if (!joint) return
    if (A.sceneId) this.links.push({ bodyId: A.sceneId, joint, sign: -1 })
    if (B.sceneId) this.links.push({ bodyId: B.sceneId, joint, sign: 1 })
  }

  private createPrismaticJoint(c: Extract<Constraint, { type: 'prismatic' }>): void {
    const bodyA = this.byId.get(c.centerBodyId)
    const bodyB = this.byId.get(c.bodyId)
    if (!bodyA || !bodyB) return
    const axis = c.axis === 'y' ? new Vec2(0, 1) : new Vec2(1, 0)
    const anchor = c.anchor ? new Vec2(c.anchor.x, c.anchor.y) : bodyB.getPosition()
    this.world.createJoint(
      new PrismaticJoint(
        {
          enableLimit: c.lower !== undefined || c.upper !== undefined,
          lowerTranslation: c.lower ?? 0,
          upperTranslation: c.upper ?? 0,
          collideConnected: false,
        },
        bodyA,
        bodyB,
        anchor,
        axis,
      ),
    )
  }

  /** 气体：P = nRT/V，气压与外界压强差作用在活塞上 */
  private applyGases(): void {
    for (const gas of this.scene.gases) {
      if (gas.enabled === false) continue
      const piston = this.byId.get(gas.pistonId)
      if (!piston || !piston.isDynamic()) continue
      const length = Math.max(piston.getPosition().y - gas.pistonHalf - gas.floorY, 0.01)
      const v = Math.max(gas.area * length, 1e-6)
      const pressure = (gas.n * (gas.gasConstant ?? 1) * gas.temperature) / v
      const force = (pressure - gas.ambientPressure) * gas.area
      piston.applyForceToCenter(new Vec2(0, force), true)
    }
  }

  private createLinkJoint(c: Extract<Constraint, { type: 'rope' | 'rod' | 'spring' | 'hinge' }>): void {
    const A = this.resolveAnchor(c.a)
    const B = this.resolveAnchor(c.b)
    if (!A || !B) return
    let joint: Joint | null = null
    if (c.type === 'rope') {
      joint = this.world.createJoint(
        new RopeJoint({
          bodyA: A.body,
          bodyB: B.body,
          localAnchorA: A.local,
          localAnchorB: B.local,
          maxLength: c.length,
        }),
      )
    } else if (c.type === 'rod') {
      joint = this.world.createJoint(
        new DistanceJoint({
          bodyA: A.body,
          bodyB: B.body,
          localAnchorA: A.local,
          localAnchorB: B.local,
          length: c.length,
          frequencyHz: 0,
          dampingRatio: 0,
        }),
      )
    } else {
      joint = this.world.createJoint(
        new RevoluteJoint({
          bodyA: A.body,
          bodyB: B.body,
          localAnchorA: A.local,
          localAnchorB: B.local,
        }),
      )
    }
    if (!joint) return
    if (A.sceneId) this.links.push({ bodyId: A.sceneId, joint, sign: -1 })
    if (B.sceneId) this.links.push({ bodyId: B.sceneId, joint, sign: 1 })
  }

  private updateForces(): void {
    const g = this.plane === 'vertical' ? this.scene.world.gravity : 0
    const invDt = 1 / Math.max(this.lastSubDt, 1e-6)
    const t = this.state.t
    for (const s of Object.values(this.state.bodies)) {
      s.force.gx = 0
      s.force.gy = 0
      s.force.ax = 0
      s.force.ay = 0
      s.force.ex = 0
      s.force.ey = 0
      s.force.tx = 0
      s.force.ty = 0
      s.force.applied = []
      const sb = this.sceneById.get(s.id)
      if (!sb) continue
      if (sb.kind !== 'static' && sb.kind !== 'kinematic') {
        s.force.gy = -s.mass * g
        if (sb.appliedUntil === undefined || t < sb.appliedUntil) {
          if (sb.appliedForce) {
            s.force.ax += sb.appliedForce.x
            s.force.ay += sb.appliedForce.y
            s.force.applied.push({ x: sb.appliedForce.x, y: sb.appliedForce.y })
          }
          for (const f of sb.forces ?? []) {
            s.force.ax += f.x
            s.force.ay += f.y
            s.force.applied.push({ x: f.x, y: f.y })
          }
        }
        const q = sb.charge ?? 0
        if (q !== 0) {
          for (const f of this.scene.fields) {
            if (f.kind !== 'uniform' || f.type !== 'E' || f.enabled === false) continue
            if (f.regionId) {
              const region = this.scene.regions.find((r) => r.id === f.regionId)
              if (!region) continue
              // 复用 criterion 的区域判定会很重，这里用简单的 AABB（区域多为矩形）
              const local = { x: s.x - region.transform.x, y: s.y - region.transform.y }
              const c0 = Math.cos(-region.transform.angle)
              const s0 = Math.sin(-region.transform.angle)
              const lx = local.x * c0 - local.y * s0
              const ly = local.x * s0 + local.y * c0
              const shape = region.shape
              if (shape.type === 'rect' && (Math.abs(lx) > shape.w / 2 || Math.abs(ly) > shape.h / 2)) continue
            }
            s.force.ex += q * f.vector.x
            s.force.ey += q * f.vector.y
          }
        }
      }
    }
    for (const c of this.scene.constraints) {
      if (c.type !== 'spring') continue
      const A = this.anchorWorld(c.a)
      const B = this.anchorWorld(c.b)
      if (!A || !B) continue
      const dx = B.point.x - A.point.x
      const dy = B.point.y - A.point.y
      const d = Math.hypot(dx, dy)
      if (d < 1e-6) continue
      const mg = c.k * (d - c.l0)
      const nx = dx / d
      const ny = dy / d
      const sB = this.state.bodies[(c.b as { bodyId?: string }).bodyId ?? '']
      const sA = this.state.bodies[(c.a as { bodyId?: string }).bodyId ?? '']
      if (sB) {
        sB.force.tx -= nx * mg
        sB.force.ty -= ny * mg
      }
      if (sA) {
        sA.force.tx += nx * mg
        sA.force.ty += ny * mg
      }
    }
    // 关节在第一步之前没有 solver 数据，getReactionForce 会崩：等跑起来再算
    if (this.state.t > 1e-9) {
      for (const link of this.links) {
        const s = this.state.bodies[link.bodyId]
        if (!s) continue
        try {
          const f = link.joint.getReactionForce(invDt)
          if (!f || !Number.isFinite(f.x) || !Number.isFinite(f.y)) continue
          s.force.tx += link.sign * f.x
          s.force.ty += link.sign * f.y
        } catch {
          // 忽略未初始化的关节
        }
      }
    }
  }

  private createTrackJoint(center: PlanckBody, ball: PlanckBody, radius: number): DistanceJoint {
    return this.world.createJoint(
      new DistanceJoint({
        bodyA: center,
        bodyB: ball,
        localAnchorA: new Vec2(0, 0),
        localAnchorB: new Vec2(0, 0),
        length: radius,
        frequencyHz: 0,
        dampingRatio: 0,
      }),
    ) as DistanceJoint
  }

  private makeShape(spec: FixtureSpec): Circle | Polygon | Chain | null {
    if (spec.kind === 'circle') {
      return spec.center.x === 0 && spec.center.y === 0
        ? new Circle(spec.radius)
        : new Circle(new Vec2(spec.center.x, spec.center.y), spec.radius)
    }
    if (spec.kind === 'polygon') {
      if (spec.vertices.length < 3) return null
      const pts = spec.vertices.slice()
      if (polygonArea(pts) < 0) pts.reverse()
      return new Polygon(pts.map((p) => new Vec2(p.x, p.y)))
    }
    let verts = spec.vertices.slice()
    if (spec.loop && verts.length > 1) {
      const a = verts[0]!
      const b = verts[verts.length - 1]!
      if (Math.hypot(a.x - b.x, a.y - b.y) < 1e-6) verts = verts.slice(0, -1)
    }
    if (verts.length < 2) return null
    return new Chain(verts.map((p) => new Vec2(p.x, p.y)), spec.loop)
  }

  private bindContacts(): void {
    const idOf = (f: Fixture): string | undefined => (f.getUserData() as { id?: string } | undefined)?.id
    const matOf = (f: Fixture): string | undefined =>
      (f.getUserData() as { material?: string } | undefined)?.material

    this.world.on('begin-contact', (c: Contact) => {
      const a = idOf(c.getFixtureA())
      const b = idOf(c.getFixtureB())
      if (!a || !b) return
      const key = pairKey(a, b)
      this.state.contacts[key] = (this.state.contacts[key] ?? 0) + 1
      this.contactCounts.set(a, (this.contactCounts.get(a) ?? 0) + 1)
      this.contactCounts.set(b, (this.contactCounts.get(b) ?? 0) + 1)
    })

    this.world.on('end-contact', (c: Contact) => {
      const a = idOf(c.getFixtureA())
      const b = idOf(c.getFixtureB())
      if (!a || !b) return
      const key = pairKey(a, b)
      this.state.contacts[key] = Math.max(0, (this.state.contacts[key] ?? 0) - 1)
      this.contactCounts.set(a, Math.max(0, (this.contactCounts.get(a) ?? 0) - 1))
      this.contactCounts.set(b, Math.max(0, (this.contactCounts.get(b) ?? 0) - 1))
    })

    this.world.on('pre-solve', (c: Contact) => {
      const ma = matOf(c.getFixtureA())
      const mb = matOf(c.getFixtureB())
      if (!ma || !mb) return
      const fa = (c.getFixtureA().getBody().getUserData() as { friction?: number } | undefined)?.friction
      const fb = (c.getFixtureB().getBody().getUserData() as { friction?: number } | undefined)?.friction
      const mu =
        fa !== undefined || fb !== undefined
          ? fa !== undefined && fb !== undefined
            ? (fa + fb) / 2
            : (fa ?? fb ?? 0)
          : resolveFriction(this.scene, ma, mb)
      this.lastFriction = mu
      c.setFriction(mu)
      c.setRestitution(resolveRestitution(this.scene, ma, mb))
    })
  }

  /** 推进一个固定步（内部再分子步） */
  step(): void {
    const dt = this.scene.world.timeStep
    const sub = Math.max(1, Math.floor(this.scene.world.substeps))
    const subDt = dt / sub
    this.lastSubDt = subDt
    for (let i = 0; i < sub; i++) {
      this.applyGases()
      applyPairwiseInteractions({ scene: this.scene, bodies: this.planckBodies, plane: this.plane })
      applyFields({ scene: this.scene, bodies: this.planckBodies, plane: this.plane }, subDt)
      this.applySprings()
      this.applyAppliedForces()
      this.world.step(subDt, 8, 3)
    }
    this.updateTracks(subDt)
    this.state.t += dt
    this.clampSpeeds()
    this.refresh(dt)
    this.updateForces()
    this.evaluateCriteria()
  }

  /**
   * 轨道约束的每步维护：
   * - 反力指向圆心外侧（轨道要“拉”球）→ 球失去支持，脱离；
   * - 脱离后球落回圆的边界（从内侧撞上轨道）→ 重新接上，去掉向外径向速度。
   */
  private updateTracks(subDt: number): void {
    for (const t of this.tracks) {
      const p = t.ball.getPosition()
      // 注意：必须用关节锚点（体原点），不能用 getWorldCenter（那是质心）
      const c = t.center.getWorldPoint(new Vec2(0, 0))
      const dx = p.x - c.x
      const dy = p.y - c.y
      const r = Math.max(Math.hypot(dx, dy), 1e-6)
      const angle = Math.atan2(dy, dx)
      if (!t.attached && t.constraint.entry) {
        const e = t.constraint.entry
        if (Math.hypot(p.x - e.x, p.y - e.y) < 0.12) {
          t.joint = this.createTrackJoint(t.center, t.ball, t.constraint.radius)
          t.attached = true
          t.warmup = 2
          t.rearm = true
        } else {
          this.trackSupport.set(t.constraint.bodyId, 0)
          this.state.trackAttached[t.constraint.id] = false
          this.state.contacts[pairKey(t.constraint.bodyId, t.constraint.centerBodyId)] = 0
          continue
        }
      }
      if (t.attached && t.constraint.toAngle !== undefined && angle >= t.constraint.toAngle) {
        if (t.joint) this.world.destroyJoint(t.joint)
        t.joint = null
        t.attached = false
        t.rearm = false
        this.trackSupport.set(t.constraint.bodyId, 0)
        this.state.trackAttached[t.constraint.id] = false
        this.state.contacts[pairKey(t.constraint.bodyId, t.constraint.centerBodyId)] = 0
        continue
      }
      if (t.warmup > 0) {
        t.warmup--
      } else if (t.attached && t.joint) {
        const f = t.joint.getReactionForce(1 / subDt)
        const nx = -dx / r
        const ny = -dy / r
        const dotIn = f.x * nx + f.y * ny
        const m = t.ball.getMass()
        this.trackDebug[t.constraint.id] = { r, dotIn, attached: true }
        if (dotIn < -0.001 * m * Math.max(1, this.scene.world.gravity)) {
          this.world.destroyJoint(t.joint)
          t.joint = null
          t.attached = false
          t.rearm = false
        }
      } else if (!t.attached) {
        if (r < t.constraint.radius - 0.008) t.rearm = true
        const v = t.ball.getLinearVelocity()
        const vr = (v.x * dx + v.y * dy) / r
        if (t.rearm && r >= t.constraint.radius - 0.002 && vr > 0) {
          const nx = dx / r
          const ny = dy / r
          const vn = v.x * nx + v.y * ny
          if (vn > 0) t.ball.setLinearVelocity(new Vec2(v.x - vn * nx, v.y - vn * ny))
          t.ball.setPosition(new Vec2(c.x + nx * t.constraint.radius, c.y + ny * t.constraint.radius))
          t.joint = this.createTrackJoint(t.center, t.ball, t.constraint.radius)
          t.attached = true
          t.warmup = 2
        }
      }
      this.trackSupport.set(t.constraint.bodyId, t.attached ? 1 : 0)
      this.state.trackAttached[t.constraint.id] = t.attached
      this.state.contacts[pairKey(t.constraint.bodyId, t.constraint.centerBodyId)] = t.attached ? 1 : 0
    }
  }

  private refresh(dt: number): void {
    const prev = this.prevVel
    for (const { id, body } of this.entities) {
      const s = this.state.bodies[id]
      if (!s) continue
      const v = body.getLinearVelocity()
      const p = body.getPosition()
      if (dt > 0) {
        const old = prev.get(id)
        s.ax = old ? (v.x - old.x) / dt : 0
        s.ay = old ? (v.y - old.y) / dt : 0
      } else {
        s.ax = 0
        s.ay = 0
      }
      prev.set(id, { x: v.x, y: v.y })
      s.x = p.x
      s.y = p.y
      s.angle = body.getAngle()
      s.vx = v.x
      s.vy = v.y
      s.omega = body.getAngularVelocity()
      s.contactCount = (this.contactCounts.get(id) ?? 0) + (this.trackSupport.get(id) ?? 0)
      s.mass = body.getMass()
      body.setBullet(Math.hypot(v.x, v.y) > 5)
    }
    this.state.gases = {}
    for (const gas of this.scene.gases) {
      const piston = this.byId.get(gas.pistonId)
      if (!piston) continue
      const length = Math.max(piston.getPosition().y - gas.pistonHalf - gas.floorY, 0.01)
      const v = Math.max(gas.area * length, 1e-6)
      const pressure = (gas.n * (gas.gasConstant ?? 1) * gas.temperature) / v
      this.state.gases[gas.id] = { p: pressure, v, t: gas.temperature, length }
    }
    const m = measure(this.scene, this.plane, this.entities)
    this.state.energy = m.energy
    this.state.momentum = m.momentum
    this.state.momentumScale = m.momentumScale
    this.updateForces()
  }

  private clampSpeeds(): void {
    const max = this.scene.world.maxSpeed
    if (!(max > 0)) return
    for (const { id, body } of this.entities) {
      if (!body.isDynamic()) continue
      const v = body.getLinearVelocity()
      const speed = Math.hypot(v.x, v.y)
      if (speed <= max) continue
      const k = max / speed
      body.setLinearVelocity(new Vec2(v.x * k, v.y * k))
      this.state.speedClamped = true
      if (this.state.t - this.lastClampEvent > 0.5) {
        this.lastClampEvent = this.state.t
        this.pushEvent({
          t: this.state.t,
          type: 'speed-clamp',
          a: id,
          value: speed,
          message: '速度超过安全上限，已截断',
        })
      }
    }
  }

  private evaluateCriteria(): void {
    const settle = this.scene.world.settle ?? 0
    if (this.state.t + 1e-9 >= settle) this.state.energy0 ??= this.state.energy.total
    this.frame = {
      t: this.state.t,
      bodies: this.state.bodies,
      contacts: this.state.contacts,
      energy: this.state.energy,
      momentum: this.state.momentum,
      momentumScale: this.state.momentumScale,
    }
    this.runner.update(this.frame, this.scene)
    this.state.criteria = this.runner.results()
  }

  private pushEvent(e: SimEvent): void {
    this.state.events.push(e)
    if (this.state.events.length > 60) this.state.events.shift()
  }

  get terminalPassed(): boolean {
    return this.runner.terminalPassed
  }

  get criteriaResults(): Record<string, CriterionResult> {
    return this.state.criteria
  }

  getWorldBody(id: string): PlanckBody | undefined {
    return this.byId.get(id)
  }

  get finished(): boolean {
    const d = this.scene.world.duration
    return d !== undefined && this.state.t >= d - 1e-9
  }

  /** 固定总时长跑完（供 headless 用）；不渲染、不记轨迹 */
  runFor(seconds: number): void {
    const steps = Math.ceil(seconds / this.scene.world.timeStep)
    for (let i = 0; i < steps; i++) {
      if (this.terminalPassed) break
      this.step()
    }
  }
}

/**
 * headless 判据求值：不渲染、不算图表，直接 step（架构 §7.2 前提 2）。
 * 判据触发即停；conserve 类判据跑满时长。
 */
export function runCriterion(
  scene: Scene,
  opts: { maxTime?: number; criterionId?: string } = {},
): RunOutcome {
  const sim = new Simulation(scene)
  const maxTime = opts.maxTime ?? scene.world.duration ?? 6
  sim.runFor(maxTime)
  const criteria = sim.state.criteria
  const id = opts.criterionId ?? scene.criteria[0]?.id
  const result = id ? criteria[id] : undefined
  return {
    passed: result?.pass ?? false,
    criterionId: id,
    triggeredAt: result?.triggeredAt,
    t: sim.state.t,
    criteria,
    speedClamped: sim.state.speedClamped,
  }
}
