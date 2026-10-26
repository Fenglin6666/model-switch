/**
 * 电磁感应：导体棒切割磁感线。
 *
 * 这一类题在 2006–2026 的 4462 道真题里有 118 道计算题（108 道属可建模的 D2），
 * 是之前唯一整块缺失的基元——AI 对这类题一律回 unsupported。
 *
 * 单棒题的核心结论全是闭式的，正好拿来卡数值：
 *   收尾速度   v∞ = F·R/(B²L²)
 *   任一时刻   a = (F − B²L²v/R)/m
 *   能量       F·x = ½mv² + ∫I²R dt
 * 三个都对得上，这个基元才算真的能用。
 */
import { describe, expect, it } from 'vitest'
import { presetById } from '../packages/core/src/presets'
import { Simulation } from '../packages/physics/src/simulation'
import type { Scene } from '../packages/core/src/scene'

const build = (over: { F?: number; R?: number; B?: number; m?: number } = {}): Scene => {
  const p = presetById('railEmf')!
  const s = p.build()
  p.layout?.(s)
  const rod = s.bodies.find((b) => b.id === 'rod')!
  if (over.F !== undefined) rod.forces = [{ id: 'pull', x: over.F, y: 0 }]
  if (over.m !== undefined) rod.mass = over.m
  const c = s.constraints.find((x) => x.type === 'circuit')
  if (c && c.type === 'circuit' && over.R !== undefined) c.resistance = over.R
  const f = s.fields.find((x) => x.id === 'B')
  if (f && f.kind === 'uniform' && f.type === 'B' && over.B !== undefined) f.bz = over.B
  // 去掉导轨行程限位：跑够长时间时棒会撞到尽头停住，那是限位在起作用，
  // 不是收尾速度。这里只测电磁耦合本身，所以给无限长的导轨。
  const rail = s.constraints.find((x) => x.type === 'prismatic')
  if (rail && rail.type === 'prismatic') {
    delete rail.lower
    delete rail.upper
  }
  return s
}

const L = 0.8

describe('电磁感应：单棒切割', () => {
  it('收尾速度 v∞ = F·R/(B²L²)', () => {
    const s = build({ F: 1, R: 1, B: 1, m: 0.5 })
    const sim = new Simulation(s)
    const vInf = (1 * 1) / (1 * 1 * L * L) // = 1/0.64 = 1.5625
    for (let i = 0; i < 960 * 6; i++) sim.step()
    const v = sim.state.bodies.rod!.vx
    expect(v).toBeCloseTo(vInf, 1)
    // 再跑 1 s 也不涨：真的收敛了，不是「恰好路过」
    for (let i = 0; i < 960; i++) sim.step()
    expect(sim.state.bodies.rod!.vx).toBeCloseTo(vInf, 1)
  })

  it('电流 I = BLv/R，方向由楞次定律定（反抗运动）', () => {
    const s = build({ F: 1, R: 2, B: 1, m: 0.5 })
    const sim = new Simulation(s)
    for (let i = 0; i < 960 * 2; i++) sim.step()
    const v = sim.state.bodies.rod!.vx
    const c = sim.state.circuits.circuit!
    expect(c).toBeTruthy()
    expect(c.emf).toBeCloseTo(1 * L * v, 3) // ε = BLv
    expect(c.current).toBeCloseTo(c.emf / 2, 3) // I = ε/R
    // 安培力反抗运动：速度为正时，安培力必须是负向的（单独一档，标「F安」）
    expect(sim.state.bodies.rod!.force.bx).toBeLessThan(-0.01)
  })

  it('电阻越大，收尾速度越高（R↑ → I↓ → 安培力↓）', () => {
    const slow = new Simulation(build({ F: 1, R: 0.5 }))
    const fast = new Simulation(build({ F: 1, R: 4 }))
    for (let i = 0; i < 960 * 4; i++) {
      slow.step()
      fast.step()
    }
    expect(fast.state.bodies.rod!.vx).toBeGreaterThan(slow.state.bodies.rod!.vx * 2)
  })

  it('磁场越强，收尾速度越低（B↑ → 安培力↑）', () => {
    const weak = new Simulation(build({ F: 1, B: 0.5 }))
    const strong = new Simulation(build({ F: 1, B: 2 }))
    for (let i = 0; i < 960 * 4; i++) {
      weak.step()
      strong.step()
    }
    expect(weak.state.bodies.rod!.vx).toBeGreaterThan(strong.state.bodies.rod!.vx * 2)
  })

  it('能量：外力做的功 = 动能 + 焦耳热', () => {
    const F = 1
    const s = build({ F, R: 1, B: 1, m: 0.5 })
    const sim = new Simulation(s)
    const x0 = sim.state.bodies.rod!.x
    for (let i = 0; i < 960 * 3; i++) sim.step()
    const rod = sim.state.bodies.rod!
    const work = F * (rod.x - x0)
    const ke = 0.5 * 0.5 * rod.vx * rod.vx
    const heat = sim.state.circuits.circuit!.heat
    // 导轨光滑、无重力做功（棒水平走），所以功只该变成动能和热
    expect(ke + heat).toBeCloseTo(work, 0)
    expect(heat).toBeGreaterThan(0)
  })

  it('B 反号不影响收尾速度（只改电流方向）', () => {
    const pos = new Simulation(build({ B: 1 }))
    const neg = new Simulation(build({ B: -1 }))
    for (let i = 0; i < 960 * 4; i++) {
      pos.step()
      neg.step()
    }
    expect(pos.state.bodies.rod!.vx).toBeCloseTo(neg.state.bodies.rod!.vx, 2)
    expect(Math.sign(pos.state.circuits.circuit!.current)).toBe(-Math.sign(neg.state.circuits.circuit!.current))
  })
})
