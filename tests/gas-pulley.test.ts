import { describe, expect, it } from 'vitest'
import { presetById } from '../packages/core/src/presets'
import { Simulation } from '../packages/physics/src/simulation'

describe('气缸/理想气体', () => {
  it('气体满足 P·V = nRT，活塞向上运动', () => {
    const p = presetById('gas')!
    const s = p.build()
    p.layout?.(s)
    const sim = new Simulation(s)
    const y0 = sim.state.bodies.piston!.y
    let pSum = 0
    let n = 0
    for (let i = 0; i < 5000; i++) {
      sim.step()
      if (i > 4500) {
        pSum += sim.state.gases.gas!.p
        n++
      }
    }
    const gas = sim.state.gases.gas!
    expect(gas.p * gas.v).toBeCloseTo(300, 2)
    const pAvg = pSum / n
    expect(pAvg).toBeGreaterThan(100)
    expect(pAvg).toBeLessThan(110)
    expect(sim.state.bodies.piston!.y).toBeGreaterThan(y0)
  })

  it('升温后 P·V 增大，气体体积/温度跟着变', () => {
    const p = presetById('gas')!
    const s = p.build()
    // 温度的真源是 params.T（layout 会把它展开进 gases），不是直接改 gases
    s.params = { ...s.params, T: 350 }
    p.layout?.(s)
    const sim = new Simulation(s)
    for (let i = 0; i < 1200; i++) sim.step()
    const gas = sim.state.gases.gas!
    expect(gas.t).toBe(350)
    expect(gas.p * gas.v).toBeCloseTo(350, 2)
  })
})

describe('滑轮/绳连接体', () => {
  it('阿特伍德机：轻的一侧上升、重的一侧下降，加速度约 (m1−m2)/(m1+m2)g', () => {
    const p = presetById('pulley')!
    const s = p.build()
    p.layout?.(s)
    const sim = new Simulation(s)
    for (let i = 0; i < 600; i++) sim.step()
    const A = sim.state.bodies.A!
    const B = sim.state.bodies.B!
    expect(A.vy).toBeGreaterThan(1.2)
    expect(B.vy).toBeLessThan(-1.2)
    expect(Math.abs(A.vy + B.vy)).toBeLessThan(0.1)
    expect(sim.state.criteria.energy?.pass).toBe(true)
  })
})

describe('气缸参数真的接上了（曾经是死滑杆）', () => {
  it('改 params.T 会改到气体温度，改 params.P0 会改到外界压强', () => {
    const p = presetById('gas')!
    const s = p.build()
    // 不调 layout：温度是 build 里的硬编码值
    expect(s.gases[0]!.temperature).toBe(300)
    // 调 layout：按 params 展开
    s.params = { T: 420, n: 2, P0: 130 }
    p.layout?.(s)
    expect(s.gases[0]!.temperature).toBe(420)
    expect(s.gases[0]!.n).toBe(2)
    expect(s.gases[0]!.ambientPressure).toBe(130)
  })

  it('温度越高，同一体积下压强越大（P = nRT/V）', () => {
    const p = presetById('gas')!
    const mk = (T: number) => {
      const s = p.build()
      s.params = { T, n: 1, P0: 100 }
      p.layout?.(s)
      const sim = new Simulation(s)
      for (let i = 0; i < 240; i++) sim.step()
      return sim.state.gases.gas!.p
    }
    expect(mk(400)).toBeGreaterThan(mk(300))
  })
})
