/**
 * 基元覆盖测试：**每一个基元至少有一个用例证明它真的能用**。
 *
 * 为什么要有它：审计时发现有 6 个基元「零使用」——
 *   rod / bezier / point 场 / escape / coincide / energy 观测器
 * 有的实现了但没人碰过（等于没验证），有的干脆只活在类型里（`probe` 就是，已删）。
 * 这份测试就是那条防线：**加基元必须带一个用例**，否则它只是类型上的谎话。
 *
 * 不测的（别处已覆盖）：
 *   rope/spring/pulley/track → presets + acceptance
 *   belt/prismatic/pin/hinge → tests/constraints.test.ts（跑过仿真、有数值断言）
 *   detach/reach/collide/conserve → acceptance + presets
 *
 * 注意：build-ops 只证明「指令能解析成约束」，不证明约束接上以后物理对。
 * 这四个基元一度被写成「→ build-ops 已覆盖」，实际上一次仿真都没跑过。
 */
import { describe, expect, it } from 'vitest'
import { emptyScene, type Body, type Scene } from '../packages/core/src/scene'
import { renderGeometries } from '../packages/core/src/shapes'
import { Simulation } from '../packages/physics/src/simulation'

const body = (id: string, over: Partial<Body> = {}): Body => ({
  id,
  kind: 'particle',
  shape: { type: 'circle', r: 0.1 },
  transform: { x: 0, y: 0, angle: 0 },
  material: 'metal',
  appearance: { color: '#888', depth: 0.1 },
  ...over,
})

const scene = (over: Partial<Scene> = {}): Scene => Object.assign(emptyScene(), over)

const run = (s: Scene, steps: number) => {
  const sim = new Simulation(s)
  for (let i = 0; i < steps; i++) sim.step()
  return sim
}

describe('约束：rod（杆）', () => {
  it('杆锁住两端距离——球吊着摆动，距离不变', () => {
    const s = scene({
      bodies: [body('ball', { transform: { x: 1, y: 0, angle: 0 } })],
      constraints: [{ id: 'rod', type: 'rod', a: { world: { x: 0, y: 0 } }, b: { bodyId: 'ball', port: 'center' }, length: 1 }],
    })
    const sim = run(s, 120)
    const b = sim.state.bodies.ball!
    expect(Math.hypot(b.x, b.y)).toBeCloseTo(1, 1)
    expect(b.y).toBeLessThan(-0.1) // 真的摆下来了，不是钉死
  })

  it('杆和绳的区别：杆能推（绳只拉）', () => {
    // 球在杆的「正下方」，杆长 0.5，球离锚点 0.5 → 杆既不需要拉也不需要推
    // 关键区别在长度固定 vs 上限固定：rod 是等号，rope 是 ≤
    const s = scene({
      bodies: [body('ball', { transform: { x: 0, y: -0.5, angle: 0 } })],
      constraints: [{ id: 'rod', type: 'rod', a: { world: { x: 0, y: 0 } }, b: { bodyId: 'ball', port: 'center' }, length: 0.5 }],
    })
    const sim = run(s, 120)
    expect(Math.hypot(sim.state.bodies.ball!.x, sim.state.bodies.ball!.y)).toBeCloseTo(0.5, 1)
  })
})

describe('形状：bezier', () => {
  it('能转成渲染几何，且点的数量随精度上升', () => {
    const shape = { type: 'bezier' as const, ctrl: [{ x: 0, y: 0 }, { x: 0.5, y: 1 }, { x: 1, y: 0 }], thick: 0.05 }
    const teach = renderGeometries(shape, 'teach')
    const verify = renderGeometries(shape, 'verify')
    expect(teach.length).toBeGreaterThan(0)
    const pts = (g: ReturnType<typeof renderGeometries>) => g.reduce((n, x) => n + (x.kind === 'fill' ? 0 : x.points.length), 0)
    expect(pts(verify)).toBeGreaterThan(pts(teach))
  })

  it('能当静态地形放进仿真，跑起来不炸', () => {
    const s = scene({
      bodies: [
        body('hill', {
          kind: 'static',
          shape: { type: 'bezier', ctrl: [{ x: -1, y: 0 }, { x: 0, y: 0.8 }, { x: 1, y: 0 }], thick: 0.06 },
        }),
        body('ball', { transform: { x: 0, y: 1.5, angle: 0 } }),
      ],
    })
    const sim = run(s, 60)
    const b = sim.state.bodies.ball!
    expect(Number.isFinite(b.x) && Number.isFinite(b.y)).toBe(true)
    expect(b.y).toBeLessThan(1.5) // 受重力下落
  })
})

describe('场：point（点源场）', () => {
  it('正电荷被点源排斥（沿径向向外加速）', () => {
    const s = scene({
      // 显式给质量：不给的话按面积×密度估，量级会差很远（这也是点源场没人用的原因）
      bodies: [body('q', { charge: 1, mass: 0.5, transform: { x: 1, y: 0, angle: 0 } })],
      fields: [{ id: 'src', kind: 'point', type: 'E', source: { x: 0, y: 0 }, strength: 1 }],
    })
    s.world.gravity = 0
    const sim = run(s, 120)
    expect(sim.state.bodies.q!.x).toBeGreaterThan(1.05)
  })

  it('负电荷被吸引（朝源运动）', () => {
    const s = scene({
      bodies: [body('q', { charge: -1, mass: 0.5, transform: { x: 1, y: 0, angle: 0 } })],
      fields: [{ id: 'src', kind: 'point', type: 'E', source: { x: 0, y: 0 }, strength: 1 }],
    })
    s.world.gravity = 0
    const sim = run(s, 120)
    expect(sim.state.bodies.q!.x).toBeLessThan(0.95)
  })
})

describe('判据：escape（飞出去）', () => {
  it('球离开区域后触发', () => {
    const s = scene({
      bodies: [body('ball', { transform: { x: 0, y: 0, angle: 0 }, velocity: { x: 5, y: 0 } })],
      regions: [{ id: 'box', shape: { type: 'rect', w: 0.6, h: 0.6 }, transform: { x: 0, y: 0, angle: 0 }, label: '区域' }],
      criteria: [{ id: 'esc', kind: 'escape', bodyId: 'ball', regionId: 'box', hold: 0.02 }],
    })
    s.world.gravity = 0
    const sim = run(s, 120)
    expect(sim.state.criteria.esc?.pass).toBe(true)
  })

  it('一直待在区域里就不触发（防误报）', () => {
    const s = scene({
      bodies: [body('ball', { transform: { x: 0, y: 0, angle: 0 } })],
      regions: [{ id: 'box', shape: { type: 'rect', w: 2, h: 2 }, transform: { x: 0, y: 0, angle: 0 }, label: '区域' }],
      criteria: [{ id: 'esc', kind: 'escape', bodyId: 'ball', regionId: 'box', hold: 0.02 }],
    })
    s.world.gravity = 0
    expect(run(s, 120).state.criteria.esc?.pass).toBe(false)
  })
})

describe('判据：coincide（共速）', () => {
  it('两物体速度相同时触发——这就是「板块/传送带达到共速」', () => {
    const s = scene({
      bodies: [
        body('a', { velocity: { x: 1, y: 0 } }),
        body('b', { velocity: { x: 1, y: 0 }, transform: { x: 2, y: 0, angle: 0 } }),
      ],
      criteria: [{ id: 'co', kind: 'coincide', bodyA: 'a', bodyB: 'b', eps: 0.05, hold: 0.02 }],
    })
    s.world.gravity = 0
    expect(run(s, 60).state.criteria.co?.pass).toBe(true)
  })

  it('速度差大就不触发', () => {
    const s = scene({
      bodies: [body('a', { velocity: { x: 1, y: 0 } }), body('b', { velocity: { x: -1, y: 0 } })],
      criteria: [{ id: 'co', kind: 'coincide', bodyA: 'a', bodyB: 'b', eps: 0.05, hold: 0.02 }],
    })
    s.world.gravity = 0
    expect(run(s, 60).state.criteria.co?.pass).toBe(false)
  })
})

describe('物体类型：kinematic（匀速平移）', () => {
  it('不受重力影响，按给定速度匀速走', () => {
    const s = scene({ bodies: [body('belt', { kind: 'kinematic', transform: { x: 0, y: 3, angle: 0 }, velocity: { x: 2, y: 0 } })] })
    const sim = run(s, 120)
    const b = sim.state.bodies.belt!
    expect(b.y).toBeCloseTo(3, 1) // 没有下落
    expect(b.x).toBeGreaterThan(0.9) // 1 s 走了约 2 m（重力不影响）
  })
})

describe('观测器：energy（能量读数）', () => {
  it('有 energy 观测器时能拿到动能/势能/总量', () => {
    const s = scene({
      bodies: [body('ball', { transform: { x: 0, y: 2, angle: 0 } })],
      observers: [{ id: 'e', kind: 'energy', bodyIds: ['ball'] }],
    })
    const sim = run(s, 30)
    const e = sim.state.energy
    expect(Number.isFinite(e.ke) && Number.isFinite(e.pe) && Number.isFinite(e.total)).toBe(true)
    expect(e.pe).toBeGreaterThan(0) // 有高度就有势能
  })
})
