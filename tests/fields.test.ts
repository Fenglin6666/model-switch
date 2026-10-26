import { describe, expect, it } from 'vitest'
import { presetById } from '../packages/core/src/presets'
import { Simulation } from '../packages/physics/src/simulation'
import type { Scene } from '../packages/core/src/scene'

/**
 * 场基元的数值验证。
 *
 * 为什么不再只断言「动了 / 速度没变」：那是「没崩」的测试，不是「物理对」的测试。
 * 磁场那段原来只查「速率不变 + 位移 > 0.2」——把 B 的符号写反、或把 ω 算成 2ω，
 * 它照样通过。这里改成拿高中课本上的闭式解去卡：r = mv/(qB)、T = 2πm/(qB)、
 * 速度选择器 v = E/B。
 *
 * 每个用例都从预置里取一个真实场景再改参数，不走「凭空造 scene」——
 * 预置是老师真会点开的东西，它坏了必须红。
 */

/** 只留一个试探电荷的干净场景：去掉重力、库仑、判据，只留我们要测的那个场 */
function probeScene(
  fields: Scene['fields'],
  opts: { v0?: [number, number]; q?: number; m?: number; at?: [number, number] } = {},
): Scene {
  const s = presetById('charges')!.build()
  s.world.interactions = undefined
  s.world.gravity = 0
  s.fields = fields
  s.observers = []
  s.criteria = []
  s.bodies = s.bodies.filter((b) => b.id === 'probe')
  const probe = s.bodies[0]!
  probe.transform = { x: opts.at?.[0] ?? 0, y: opts.at?.[1] ?? 0, angle: 0 }
  probe.velocity = { x: opts.v0?.[0] ?? 1, y: opts.v0?.[1] ?? 0 }
  if (opts.q !== undefined) probe.charge = opts.q
  if (opts.m !== undefined) probe.mass = opts.m
  return s
}

const DT = 1 / 960 // 预置的 timeStep；sim.step() 每步前进这么多秒
const runFor = (sim: Simulation, seconds: number) => {
  for (let i = 0; i < Math.round(seconds / DT); i++) sim.step()
}

describe('匀强电场', () => {
  it('电荷沿场方向加速，垂直方向不动', () => {
    const s = probeScene([{ id: 'E', kind: 'uniform', type: 'E', vector: { x: 1, y: 0 } }])
    const sim = new Simulation(s)
    runFor(sim, 0.125)
    const b = sim.state.bodies.probe!
    expect(b.vx).toBeGreaterThan(0.2)
    expect(Math.abs(b.vy)).toBeLessThan(0.05)
  })

  it('a = qE/m：数值对得上（不是「大概变快了」）', () => {
    // q=0.2, m=0.1 → q/m=2；E=1 → a=2 m/s²
    const s = probeScene([{ id: 'E', kind: 'uniform', type: 'E', vector: { x: 1, y: 0 } }], { v0: [0, 0] })
    const sim = new Simulation(s)
    const T = 0.5
    runFor(sim, T)
    const b = sim.state.bodies.probe!
    expect(b.vx).toBeCloseTo(2 * T, 1) // 1.0 m/s ±0.05
  })
})

describe('匀强磁场', () => {
  it('做圆周运动：半径 = mv/(qB)，周期 = 2πm/(qB)', () => {
    // probe 默认 q=0.2, m=0.1 → q/m=2；B=1 → ω=2 rad/s
    // v0=1 → r=0.5 m，T=π≈3.1416 s
    const s = probeScene([{ id: 'B', kind: 'uniform', type: 'B', bz: 1 }])
    const sim = new Simulation(s)
    const v0 = 1
    const omega = 2 // (q/m)·B
    const r = v0 / omega
    const T = (2 * Math.PI) / omega

    runFor(sim, T)
    const b = sim.state.bodies.probe!
    // 走满一个周期应该回到起点（圆心在 (0, ±r)）
    expect(Math.hypot(b.x, b.y)).toBeLessThan(0.06)
    expect(Math.hypot(b.vx, b.vy)).toBeCloseTo(v0, 2)

    // 再跑 1/4 周期：应该正好在圆的四分之一点上，离原点 √2·r
    const s2 = probeScene([{ id: 'B', kind: 'uniform', type: 'B', bz: 1 }])
    const sim2 = new Simulation(s2)
    runFor(sim2, T / 4)
    const q = sim2.state.bodies.probe!
    expect(Math.hypot(q.x, q.y)).toBeCloseTo(Math.SQRT2 * r, 1)
  })

  it('偏转方向由 qB 的符号决定（正电荷 + 出纸面 B → 顺时针）', () => {
    const ccw = (bz: number) => {
      const s = probeScene([{ id: 'B', kind: 'uniform', type: 'B', bz }])
      const sim = new Simulation(s)
      runFor(sim, 0.2) // ω·t = 0.4 rad，方向已经能看出来
      return sim.state.bodies.probe!.vy
    }
    // v0 沿 +x：顺时针 → 往 -y 拐；B 反号 → 往 +y 拐
    expect(ccw(1)).toBeLessThan(-0.1)
    expect(ccw(-1)).toBeGreaterThan(0.1)
  })

  it('洛伦兹力不做功：速率严格不变（跑满一个周期）', () => {
    const s = probeScene([{ id: 'B', kind: 'uniform', type: 'B', bz: 1 }])
    const sim = new Simulation(s)
    const v0 = 1
    runFor(sim, Math.PI)
    const b = sim.state.bodies.probe!
    expect(Math.hypot(b.vx, b.vy)).toBeCloseTo(v0, 2)
  })
})

describe('复合场：速度选择器', () => {
  // E 沿 +y、B 出纸面。洛伦兹力沿 -y（v 沿 +x 时），
  // 两者抵消的条件是 v = E/B —— 这是复合场题的第一块砖。
  const build = (vx: number) => {
    const s = presetById('crossedFields')!.build()
    s.world.gravity = 0
    s.bodies[0]!.velocity = { x: vx, y: 0 }
    // 预置里 E=(0,1)、B=2 → E/B = 0.5
    return s
  }

  it('v = E/B → 直线通过（合力为零）', () => {
    const sim = new Simulation(build(0.5))
    runFor(sim, 0.5)
    const b = sim.state.bodies.probe!
    expect(b.vx).toBeCloseTo(0.5, 1)
    expect(Math.abs(b.vy)).toBeLessThan(0.05) // 不偏
    expect(b.x).toBeCloseTo(0.25, 1)
  })

  it('v ≠ E/B → 偏转，且方向随快慢翻转', () => {
    const slow = new Simulation(build(0.2)) // 电场占优
    const fast = new Simulation(build(0.9)) // 洛伦兹力占优
    runFor(slow, 0.5)
    runFor(fast, 0.5)
    expect(slow.state.bodies.probe!.vy).toBeGreaterThan(0.1)
    expect(fast.state.bodies.probe!.vy).toBeLessThan(-0.1)
  })
})

describe('场的区域限定', () => {
  const zone = (): Scene['regions'] => [
    { id: 'zone', shape: { type: 'circle', r: 0.2 }, transform: { x: 0, y: 0, angle: 0 }, label: '场区', role: 'field' },
  ]

  it('物理：走出区域后不再加速（速度恒定）', () => {
    const s = probeScene([{ id: 'E', kind: 'uniform', type: 'E', vector: { x: 1, y: 0 }, regionId: 'zone' }], {
      v0: [0, 0],
    })
    s.regions = zone()
    const sim = new Simulation(s)
    // 半径 0.2、a=2 → 出场约 0.45 s；之后只靠惯性
    runFor(sim, 0.8)
    const vExit = sim.state.bodies.probe!.vx
    runFor(sim, 0.4)
    const vLater = sim.state.bodies.probe!.vx
    expect(vExit).toBeGreaterThan(0.5) // 区域内确实被推过
    expect(vLater).toBeCloseTo(vExit, 3) // 出场后完全不再加速
  })

  it('物理：走出区域后不再偏转（B）', () => {
    const s = probeScene([{ id: 'B', kind: 'uniform', type: 'B', bz: 1, regionId: 'zone' }])
    s.regions = zone()
    const sim = new Simulation(s)
    runFor(sim, 0.5) // 早就出场了
    const { vx: vx0, vy: vy0 } = sim.state.bodies.probe!
    runFor(sim, 0.4)
    const { vx: vx1, vy: vy1 } = sim.state.bodies.probe!
    // 出场后速度方向不再转：分量都不变
    expect(vx1).toBeCloseTo(vx0, 3)
    expect(vy1).toBeCloseTo(vy0, 3)
    expect(Math.abs(vy0)).toBeGreaterThan(0.05) // 场内确实转过
  })

  /**
   * 显示和物理必须同一套判定。
   *
   * 这里锁的是一个真实 bug：`updateForces`（画「qE」箭头的那个）曾经自己手写了
   * 一个「只认矩形」的区域判定，圆形区域会被当成全场——面板上画着 qE 箭头，
   * 实际一点电场力都没有。学生按箭头分析受力就全错了。
   */
  it('显示：圆形区域外 qE 箭头为零，区域内等于 qE', () => {
    const mk = (at: [number, number]) => {
      const s = probeScene([{ id: 'E', kind: 'uniform', type: 'E', vector: { x: 1, y: 0 }, regionId: 'zone' }], {
        v0: [0, 0],
        at,
      })
      s.regions = zone()
      const sim = new Simulation(s)
      sim.step()
      return sim.state.bodies.probe!.force
    }
    const inside = mk([0, 0])
    const outside = mk([1, 0])
    expect(inside.ex).toBeCloseTo(0.2, 3) // q=0.2 · E=1
    expect(outside.ex).toBe(0) // 出了圆就没有电场力，箭头也不该画
  })

  it('显示：旋转过的矩形区域也按真实几何判定', () => {
    const mk = (at: [number, number]) => {
      const s = probeScene([{ id: 'E', kind: 'uniform', type: 'E', vector: { x: 1, y: 0 }, regionId: 'zone' }], {
        v0: [0, 0],
        at,
      })
      s.regions = [
        {
          id: 'zone',
          shape: { type: 'rect', w: 0.6, h: 0.2 },
          transform: { x: 0, y: 0, angle: Math.PI / 4 }, // 转 45°
          label: '场区',
          role: 'field',
        },
      ]
      const sim = new Simulation(s)
      sim.step()
      return sim.state.bodies.probe!.force.ex
    }
    // 长边沿 45°：沿对角线 0.25 还在里面，沿 x 轴 0.25 已经出去了
    expect(mk([0.18, 0.18])).toBeGreaterThan(0.1)
    expect(mk([0.3, -0.3])).toBe(0)
  })
})
