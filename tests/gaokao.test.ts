import { describe, expect, it } from 'vitest'
import { presetById } from '../packages/core/src/presets'
import { Simulation } from '../packages/physics/src/simulation'

describe('2024 新课标卷第12题：板块 + 平抛的物理复现', () => {
  it('v0=4 m/s 时，物块约 1/3 s 离开薄板，末速约 3 m/s；薄板约 1 m/s', () => {
    const preset = presetById('boardBlock')!
    const scene = preset.build()
    scene.params = { ...scene.params, v0: 4, l: 1, mu: 0.3, m: 0.5, h: 5 / 9 }
    preset.layout!(scene)
    const sim = new Simulation(scene)

    let leave: { t: number; v: number; bv: number; bx: number } | null = null
    let land: { t: number; bx: number } | null = null
    for (let i = 0; i < 2000; i++) {
      sim.step()
      const b = sim.state.bodies.block!
      const d = sim.state.bodies.board!
      // 物块的左边缘越过薄板右端 = 离开
      if (!leave && b.x - 0.04 > d.x + 0.5) {
        leave = { t: sim.state.t, v: b.vx, bv: d.vx, bx: d.x }
      }
      if (leave && !land && b.y < -5 / 9 + 0.08) {
        land = { t: sim.state.t, bx: d.x }
        break
      }
    }

    expect(leave).not.toBeNull()
    expect(leave!.t).toBeGreaterThan(0.28)
    expect(leave!.t).toBeLessThan(0.39)
    expect(leave!.v).toBeGreaterThan(2.6)
    expect(leave!.v).toBeLessThan(3.4)
    expect(leave!.bv).toBeGreaterThan(0.7)
    expect(leave!.bv).toBeLessThan(1.3)
    expect(land).not.toBeNull()
    // 物块落地时，薄板中心应回到 O（x≈0）
    expect(Math.abs(land!.bx)).toBeLessThan(0.08)
  })
})
