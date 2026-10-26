/** 守恒监视器（架构 §5.6）：既是质量保证，也是教学点。 */
import type { Body as PlanckBody } from 'planck'
import type { Anchor, Plane, Scene } from '@core/scene'
import { anchorLocal } from '@core/ports'

export type EnergySample = { ke: number; pe: number; total: number }

export function measure(
  scene: Scene,
  plane: Plane,
  entities: Array<{ body: PlanckBody; id: string }>,
): { energy: EnergySample; momentum: { x: number; y: number }; momentumScale: number } {
  let ke = 0
  let pe = 0
  let px = 0
  let py = 0
  let pScale = 0
  const byId = new Map(entities.map((e) => [e.id, e.body]))
  const worldOf = (a: Anchor): { x: number; y: number } | null => {
    if ('world' in a) return a.world
    const body = byId.get(a.bodyId)
    if (!body) return null
    const local = anchorLocal(scene, a)
    if (!local) return null
    const p = body.getWorldPoint({ x: local.x, y: local.y })
    return { x: p.x, y: p.y }
  }
  for (const { body } of entities) {
    if (!body.isDynamic()) continue
    const m = body.getMass()
    if (m <= 0) continue
    const v = body.getLinearVelocity()
    const w = body.getAngularVelocity()
    const I = body.getInertia()
    ke += 0.5 * m * (v.x * v.x + v.y * v.y) + 0.5 * I * w * w
    if (plane === 'vertical') {
      // 物理坐标第二轴即竖直方向（架构 §4.2：vertical → (p,q)=(x,z)）
      // 势能必须用质心高度，不能用体原点（复合体的原点可能在几何外）
      pe += m * scene.world.gravity * body.getWorldCenter().y
    }
    px += m * v.x
    py += m * v.y
    pScale += m * Math.hypot(v.x, v.y)
  }
  // 弹簧势能：½k(l−l0)²。不补这一项，弹簧场景的"机械能守恒"会误报
  for (const c of scene.constraints) {
    if (c.type !== 'spring') continue
    const a = worldOf(c.a)
    const b = worldOf(c.b)
    if (!a || !b) continue
    const d = Math.hypot(b.x - a.x, b.y - a.y)
    pe += 0.5 * c.k * (d - c.l0) * (d - c.l0)
  }
  const interactions = scene.world.interactions
  if (interactions) {
    const pos = new Map(entities.map((e) => [e.id, e.body.getPosition()]))
    for (let i = 0; i < scene.bodies.length; i++) {
      const a = scene.bodies[i]!
      const pa = pos.get(a.id)
      if (!pa) continue
      for (let j = i + 1; j < scene.bodies.length; j++) {
        const b = scene.bodies[j]!
        const pb = pos.get(b.id)
        if (!pb) continue
        const r = Math.max(Math.hypot(pa.x - pb.x, pa.y - pb.y), 0.02)
        if (interactions.coulomb) pe += (interactions.coulomb.k * (a.charge ?? 0) * (b.charge ?? 0)) / r
        if (interactions.gravityNBody) pe -= (interactions.gravityNBody.G * (a.mass ?? 0) * (b.mass ?? 0)) / r
      }
    }
  }
  return {
    energy: { ke, pe, total: ke + pe },
    momentum: { x: px, y: py },
    momentumScale: pScale,
  }
}
