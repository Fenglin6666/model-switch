import { describe, expect, it } from 'vitest'
import { presetById } from '../packages/core/src/presets'
import { Simulation } from '../packages/physics/src/simulation'

describe('通用场：匀强电场 / 匀强磁场', () => {
  it('电荷在匀强电场中沿场方向加速', () => {
    const p = presetById('charges')!
    const s = p.build()
    s.world.interactions = undefined
    s.fields = [{ id: 'E', kind: 'uniform', type: 'E', vector: { x: 1, y: 0 } }]
    s.world.gravity = 0
    s.observers = []
    s.criteria = []
    s.bodies = s.bodies.filter((b) => b.id === 'probe')
    const probe = s.bodies[0]!
    probe.transform = { x: 0, y: 0, angle: 0 }
    probe.velocity = { x: 0, y: 0 }
    const sim = new Simulation(s)
    for (let i = 0; i < 120; i++) sim.step()
    const b = sim.state.bodies.probe!
    expect(b.vx).toBeGreaterThan(0.2)
    expect(Math.abs(b.vy)).toBeLessThan(0.05)
  })

  it('电荷在匀强磁场中做圆周运动，速率不变', () => {
    const p = presetById('charges')!
    const s = p.build()
    s.world.interactions = undefined
    s.fields = [{ id: 'B', kind: 'uniform', type: 'B', bz: 1 }]
    s.world.gravity = 0
    s.observers = []
    s.criteria = []
    s.bodies = s.bodies.filter((b) => b.id === 'probe')
    const probe = s.bodies[0]!
    probe.transform = { x: 0, y: 0, angle: 0 }
    probe.velocity = { x: 1, y: 0 }
    const sim = new Simulation(s)
    const v0 = Math.hypot(probe.velocity!.x, probe.velocity!.y)
    for (let i = 0; i < 240; i++) sim.step()
    const b = sim.state.bodies.probe!
    expect(Math.hypot(b.vx, b.vy)).toBeCloseTo(v0, 1)
    expect(Math.hypot(b.x, b.y)).toBeGreaterThan(0.2)
  })
})
