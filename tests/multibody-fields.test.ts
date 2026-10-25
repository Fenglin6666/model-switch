import { describe, expect, it } from 'vitest'
import { presetById } from '../packages/core/src/presets'
import { Simulation } from '../packages/physics/src/simulation'

describe('多体碰撞 / 正交电磁场', () => {
  it('三个等质量小球：速度传递到 C，动量/动能守恒', () => {
    const p = presetById('multiCollision')!
    const s = p.build()
    const sim = new Simulation(s)
    for (let i = 0; i < 2400; i++) sim.step()
    const A = sim.state.bodies.A!
    const B = sim.state.bodies.B!
    const C = sim.state.bodies.C!
    expect(Math.abs(A.vx)).toBeLessThan(0.1)
    expect(Math.abs(B.vx)).toBeLessThan(0.1)
    expect(C.vx).toBeCloseTo(2, 1)
    expect(sim.state.criteria.p?.pass).toBe(true)
    expect(sim.state.criteria.e?.pass).toBe(true)
  })

  it('正交电磁场：电荷轨迹偏转，E/B 都参与', () => {
    const p = presetById('crossedFields')!
    const s = p.build()
    const sim = new Simulation(s)
    for (let i = 0; i < 2400; i++) sim.step()
    const b = sim.state.bodies.probe!
    expect(b.x).toBeGreaterThan(0.5)
    expect(Math.abs(b.vy)).toBeGreaterThan(0.1)
  })
})
