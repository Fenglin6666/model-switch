import { describe, expect, it } from 'vitest'
import { presetById } from '../packages/core/src/presets'
import { Simulation } from '../packages/physics/src/simulation'

describe('多过程组合', () => {
  it('斜面→水平→上坡：滑块过水平段后冲上上坡', () => {
    const p = presetById('rampChain')!
    const s = p.build()
    p.layout?.(s)
    const sim = new Simulation(s)
    for (let i = 0; i < 1700; i++) sim.step()
    const b = sim.state.bodies.block!
    expect(b.x).toBeGreaterThan(2.1)
    expect(b.y).toBeGreaterThan(0.2)
  })

describe('多过程圆弧', () => {
  it('斜面→水平→圆弧：小球切向进入并冲上圆弧', () => {
    const p = presetById('arcChain')!
    const s = p.build()
    p.layout?.(s)
    const sim = new Simulation(s)
    for (let i = 0; i < 1700; i++) sim.step()
    const b = sim.state.bodies.block!
    expect(b.x).toBeGreaterThan(2.2)
    expect(b.y).toBeGreaterThan(0.2)
  })
})
})
