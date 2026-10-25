import { describe, expect, it } from 'vitest'
import { presetById } from '../packages/core/src/presets'
import { Simulation } from '../packages/physics/src/simulation'

describe('通用相互作用：库仑 / 万有引力 / 碰撞', () => {
  it('点电荷示例：试探电荷被库仑力偏转，能量判据通过', () => {
    const p = presetById('charges')!
    const s = p.build()
    p.layout?.(s)
    const sim = new Simulation(s)
    const x0 = sim.state.bodies.probe!.x
    for (let i = 0; i < 600; i++) sim.step()
    const probe = sim.state.bodies.probe!
    expect(probe.x).toBeGreaterThan(x0 + 0.2)
    expect(sim.state.energy.total).toBeLessThan(0)
    expect(sim.state.criteria.energy?.pass).toBe(true)
  })

  it('万有引力示例：圆轨道半径保持，能量判据通过', () => {
    const p = presetById('orbit')!
    const s = p.build()
    p.layout?.(s)
    const sim = new Simulation(s)
    for (let i = 0; i < 800; i++) sim.step()
    const planet = sim.state.bodies.planet!
    const r = Math.hypot(planet.x, planet.y)
    expect(r).toBeGreaterThan(95)
    expect(r).toBeLessThan(105)
    expect(sim.state.criteria.energy?.pass).toBe(true)
  })

  it('两球弹性碰撞：动量与动能守恒，速度交换', () => {
    const p = presetById('collision')!
    const s = p.build()
    s.world.duration = 3
    p.layout?.(s)
    const sim = new Simulation(s)
    for (let i = 0; i < 2500; i++) sim.step()
    const A = sim.state.bodies.A!
    const B = sim.state.bodies.B!
    expect(A.vx).toBeCloseTo(-1, 1)
    expect(B.vx).toBeCloseTo(2, 1)
    expect(sim.state.criteria.p?.pass).toBe(true)
    expect(sim.state.criteria.e?.pass).toBe(true)
  })

  it('两个同号电荷：库仑力把动态电荷推开', () => {
    const p = presetById('charges')!
    const s = p.build()
    s.bodies = s.bodies.filter((b) => b.id === 'q1')
    s.bodies.push({
      ...s.bodies[0]!,
      id: 'test',
      kind: 'particle',
      transform: { x: 1, y: 0, angle: 0 },
      velocity: { x: 0, y: 0 },
      mass: 1,
      charge: 1,
      shape: { type: 'circle', r: 0.1 },
      label: 'test',
    })
    s.criteria = []
    s.observers = []
    s.world.interactions = { coulomb: { k: 1 } }
    s.world.gravity = 0
    const sim = new Simulation(s)
    for (let i = 0; i < 120; i++) sim.step()
    const test = sim.state.bodies.test!
    expect(test.x).toBeGreaterThan(1)
  })
})
