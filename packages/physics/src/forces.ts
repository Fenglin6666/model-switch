/**
 * 场力（架构 §5.3）。
 *
 * 关键修正（见 docs/PHYSICS.md §3.3）：洛伦兹力不能用「每帧加外力」。
 * F = qv×B 在二维里就是精确旋转，用速度旋转代替力，速度模长严格不变。
 */
import type { Body as PlanckBody } from 'planck'
import { Vec2 } from 'planck'
import type { Plane, Scene } from '@core/scene'
import { findRegion } from '@core/scene'
import { regionContains } from '@core/criterion'
import { rot } from '@core/math'

export type FieldContext = {
  scene: Scene
  bodies: PlanckBody[]
  plane: Plane
}

/** 每帧（子步）施加：电场力、附加重力场、点源场、阻力，以及磁场速度旋转 */
export function applyPairwiseInteractions(ctx: FieldContext): void {
  const { scene, bodies } = ctx
  const coulomb = scene.world.interactions?.coulomb
  const gravity = scene.world.interactions?.gravityNBody
  if (!coulomb && !gravity) return
  const byId = new Map(scene.bodies.map((b) => [b.id, b]))
  for (let i = 0; i < bodies.length; i++) {
    const A = bodies[i]!
    const idA = (A.getUserData() as { id?: string } | undefined)?.id
    const sa = idA ? byId.get(idA) : undefined
    if (!sa) continue
    for (let j = i + 1; j < bodies.length; j++) {
      const B = bodies[j]!
      const idB = (B.getUserData() as { id?: string } | undefined)?.id
      const sb = idB ? byId.get(idB) : undefined
      if (!sb) continue
      if (!A.isDynamic() && !B.isDynamic()) continue
      const pa = A.getPosition()
      const pb = B.getPosition()
      const dx = pa.x - pb.x
      const dy = pa.y - pb.y
      const r2 = Math.max(dx * dx + dy * dy, 0.02 * 0.02)
      const r = Math.sqrt(r2)
      const ux = dx / r
      const uy = dy / r
      if (coulomb) {
        const f = (coulomb.k * (sa.charge ?? 0) * (sb.charge ?? 0)) / r2
        if (f !== 0) {
          if (A.isDynamic()) A.applyForce({ x: f * ux, y: f * uy }, A.getWorldCenter(), true)
          if (B.isDynamic()) B.applyForce({ x: -f * ux, y: -f * uy }, B.getWorldCenter(), true)
        }
      }
      if (gravity) {
        const ma = sa.mass ?? A.getMass()
        const mb = sb.mass ?? B.getMass()
        const f = (gravity.G * ma * mb) / r2
        if (f > 0) {
          if (A.isDynamic()) A.applyForce({ x: -f * ux, y: -f * uy }, A.getWorldCenter(), true)
          if (B.isDynamic()) B.applyForce({ x: f * ux, y: f * uy }, B.getWorldCenter(), true)
        }
      }
    }
  }
}

export function applyFields(ctx: FieldContext, dt: number): void {
  const { scene, bodies } = ctx
  if (scene.fields.length === 0) return

  for (const body of bodies) {
    if (!body.isDynamic()) continue
    const id = (body.getUserData() as { id?: string } | undefined)?.id
    if (!id) continue
    const sceneBody = scene.bodies.find((b) => b.id === id)
    if (!sceneBody) continue
    const q = sceneBody.charge ?? 0
    const m = body.getMass()
    if (m <= 0) continue
    const pos = body.getPosition()

    for (const f of scene.fields) {
      if (f.enabled === false) continue
      if (f.kind !== 'drag') {
        const region = f.regionId ? findRegion(scene, f.regionId) : undefined
        if (f.regionId && (!region || !regionContains(region, { x: pos.x, y: pos.y }))) continue
      }

      switch (f.kind) {
        case 'uniform': {
          if (f.type === 'B') {
            if (q === 0 || f.bz === 0) break
            // θ = −(q/m)·Bz·dt：二维旋转，速度模长不变
            const theta = -((q / m) * f.bz * dt)
            const v = body.getLinearVelocity()
            const r = rot({ x: v.x, y: v.y }, theta)
            body.setLinearVelocity(new Vec2(r.x, r.y))
          } else {
            const k = f.type === 'E' ? q : m
            if (k === 0) break
            body.applyForceToCenter(new Vec2(f.vector.x * k, f.vector.y * k), true)
          }
          break
        }
        case 'point': {
          const dx = pos.x - f.source.x
          const dy = pos.y - f.source.y
          const r2 = Math.max(dx * dx + dy * dy, 0.02 * 0.02)
          const r = Math.sqrt(r2)
          const coupler = f.type === 'E' ? q * f.strength : -m * f.strength
          if (coupler === 0) break
          const fmag = coupler / r2
          body.applyForceToCenter(new Vec2((fmag * dx) / r, (fmag * dy) / r), true)
          break
        }
        case 'drag': {
          const v = body.getLinearVelocity()
          const speed = Math.hypot(v.x, v.y)
          if (speed < 1e-6) break
          const k = f.order === 1 ? f.k : f.k * speed
          body.applyForceToCenter(new Vec2(-k * v.x, -k * v.y), true)
          break
        }
      }
    }
  }
}
