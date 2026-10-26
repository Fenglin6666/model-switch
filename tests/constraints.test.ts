/**
 * 约束基元的**数值**验证：belt / prismatic / pin / hinge。
 *
 * 为什么要单独一份：这四个在 tests/primitives.test.ts 的文件头里被写成
 * 「→ tests/build-ops.test.ts」，但 build-ops 测的是「指令能不能解析成约束」，
 * 不是「约束接上以后物理对不对」。结果是四个基元全都没有跑过一次仿真——
 * 类型上有、schema 有、UI 能建，就是没人证明它动起来是对的。
 *
 * 每个用例都拿课本上的定性结论去卡（传送带最终共速、导轨只能沿轴走、
 * 销钉钉住的点不动、铰链两端点始终重合），而不是「跑完没崩」。
 */
import { describe, expect, it } from 'vitest'
import { emptyScene, type Body, type Constraint, type Scene } from '../packages/core/src/scene'
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

const box = (id: string, w: number, h: number, over: Partial<Body> = {}): Body =>
  body(id, { shape: { type: 'rect', w, h }, ...over })

const scene = (over: Partial<Scene> = {}): Scene =>
  Object.assign(emptyScene(), { contactPairs: [{ a: 'metal', b: 'metal', mu: 0.6, restitution: 0 }] }, over)

const run = (s: Scene, steps: number) => {
  const sim = new Simulation(s)
  for (let i = 0; i < steps; i++) sim.step()
  return sim
}

describe('约束：belt（传送带）', () => {
  /**
   * 传送带的语义：**表面**在动，物体本身不动。所以带体是 static，
   * 靠 setTangentSpeed 让接触点的相对速度不为零，摩擦力把物块带走。
   * 这也是最容易写反的地方——切线速度的符号取决于 fixture 是 A 还是 B。
   */
  const conveyor = (dir: 1 | -1): Scene => {
    const speed = 2 * dir
    return scene({
      world: { ...emptyScene().world, gravity: 9.8, timeStep: 1 / 480, substeps: 2 },
      bodies: [
        box('belt', 20, 0.4, {
          kind: 'static',
          transform: { x: 0, y: 0, angle: 0 },
          material: 'rubber',
          label: '传送带',
        }),
        box('block', 0.3, 0.3, {
          kind: 'rigid',
          transform: { x: -2, y: 0.36, angle: 0 },
          material: 'rubber',
          mass: 1,
          label: '物块',
        }),
      ],
      constraints: [{ id: 'c', type: 'belt', bodyId: 'belt', speed }],
    })
  }

  it('物块被带向带速方向，最终与带共速', () => {
    const sim = run(conveyor(1), 480 * 3) // 3 s
    const b = sim.state.bodies.block!
    expect(b.vx).toBeGreaterThan(1.2) // 被带起来了（不是原地不动）
    expect(b.vx).toBeLessThanOrEqual(2.2) // 不会超过带速
  })

  it('带速反向，物块也跟着反向（符号不能写死）', () => {
    const sim = run(conveyor(-1), 480 * 3)
    const b = sim.state.bodies.block!
    expect(b.vx).toBeLessThan(-1.2)
  })

  it('达到共速后不再相对滑动（物块速度稳定在带速）', () => {
    const sim = run(conveyor(1), 480 * 4)
    const v4 = sim.state.bodies.block!.vx
    expect(v4).toBeCloseTo(2, 1) // 稳定在带速
    // 再跑 1 s，速度不再涨 → 已经没有相对滑动
    for (let i = 0; i < 480; i++) sim.step()
    expect(sim.state.bodies.block!.vx).toBeCloseTo(v4, 2)
  })
})

describe('约束：prismatic（导轨/滑槽）', () => {
  /** 只允许沿 x 平动：重力把物体往下拉，但导轨顶住——y 不能变 */
  const rail = (extra: Partial<Constraint> = {}): Scene =>
    scene({
      bodies: [
        box('rail', 4, 0.2, { kind: 'static', transform: { x: 0, y: 0, angle: 0 }, material: 'smooth' }),
        box('slider', 0.2, 0.2, {
          kind: 'rigid',
          transform: { x: -1, y: 0.2, angle: 0 },
          mass: 1,
          material: 'smooth',
          forces: [{ x: 2, y: 0 }],
        }),
      ],
      constraints: [{ id: 'g', type: 'prismatic', bodyId: 'slider', centerBodyId: 'rail', axis: 'x', ...extra }],
    })

  it('锁住 y：重力拉不下来，水平外力推得动', () => {
    const sim = run(rail(), 240 * 2)
    const s = sim.state.bodies.slider!
    expect(Math.abs(s.y - 0.2)).toBeLessThan(0.05) // 竖直方向被约束住
    expect(s.x).toBeGreaterThan(-0.4) // 沿 x 被推动了
  })

  it('带行程限位：走到上限就停住', () => {
    // planck 的 translation 是相对关节建立时那一瞬间量的，不是绝对坐标。
    // 滑块起始 x=-1，上限 0.5 → 只能走到 -0.5。
    const sim = run(rail({ lower: -2, upper: 0.5 }), 240 * 4)
    const s = sim.state.bodies.slider!
    expect(s.x).toBeCloseTo(-0.5, 1)
  })
})

describe('约束：pin（销钉）', () => {
  /** 钉住的点不动，但物体可以绕它转——和「焊死」不是一回事 */
  it('钉住的位置不移动，加上马达后绕钉旋转', () => {
    const s = scene({
      bodies: [
        box('rod', 1, 0.12, {
          kind: 'rigid',
          transform: { x: 0, y: 0, angle: 0 },
          mass: 1,
          fixedRotation: false,
        }),
      ],
      constraints: [
        { id: 'p', type: 'pin', bodyId: 'rod', point: { x: 0, y: 0 } },
        { id: 'm', type: 'motor', bodyId: 'rod', omega: 2 },
      ],
    })
    const sim = run(s, 240)
    const st = sim.state.bodies.rod!
    expect(Math.hypot(st.x, st.y)).toBeLessThan(0.02) // 质心还在钉点上
    expect(Math.abs(st.angle)).toBeGreaterThan(0.4) // 确实转了
  })

  it('钉住的质点不会被重力拽走', () => {
    const s = scene({
      bodies: [body('ball', { transform: { x: 1, y: 2, angle: 0 }, mass: 1 })],
      constraints: [{ id: 'p', type: 'pin', bodyId: 'ball', point: { x: 1, y: 2 } }],
    })
    const sim = run(s, 240)
    const st = sim.state.bodies.ball!
    expect(Math.hypot(st.x - 1, st.y - 2)).toBeLessThan(0.02)
  })
})

describe('约束：hinge（铰链）', () => {
  /** 铰链 = 两个端点始终重合，但允许相对转动（门轴、连杆） */
  it('两端点始终重合，且门能绕着它转下来', () => {
    const s = scene({
      bodies: [
        box('post', 0.3, 0.3, {
          kind: 'static',
          transform: { x: 0, y: 0, angle: 0 },
          ports: [{ id: 'axle', kind: 'axle', local: { x: 0.15, y: 0 } }],
        }),
        box('door', 1, 0.1, {
          kind: 'rigid',
          transform: { x: 0.8, y: 0, angle: 0 },
          mass: 1,
          fixedRotation: false,
          ports: [{ id: 'hinge', kind: 'pin', local: { x: -0.5, y: 0 } }],
        }),
      ],
      constraints: [
        {
          id: 'h',
          type: 'hinge',
          a: { bodyId: 'post', port: 'axle' },
          b: { bodyId: 'door', port: 'hinge' },
        },
      ],
    })
    const sim = new Simulation(s)
    let maxGap = 0
    let maxAngle = 0
    // 门会摆下去、甩过竖直、再摆回来——单看某一时刻的角度会误判成「没动」。
    // 所以要盯整段过程：取过程中转过的最大角度，和全程铰链点的最大缝隙。
    for (let i = 0; i < 240 * 2; i++) {
      sim.step()
      const d = sim.state.bodies.door!
      const ax = d.x - 0.5 * Math.cos(d.angle)
      const ay = d.y - 0.5 * Math.sin(d.angle)
      maxGap = Math.max(maxGap, Math.hypot(ax - 0.15, ay - 0))
      maxAngle = Math.max(maxAngle, Math.abs(d.angle))
    }
    expect(maxGap).toBeLessThan(0.02) // 铰链点全程钉在一起
    expect(maxAngle).toBeGreaterThan(1.5) // 门确实转下来了（不是被焊死）
  })
})

describe('组合：多个基元挂在同一个物体上', () => {
  it('圆轨道 + 马达：球被约束在圆上，同时被驱动着转', () => {
    const s = scene({
      bodies: [
        box('ring', 1.2, 1.2, { kind: 'static', transform: { x: 0, y: 0, angle: 0 }, material: 'smooth' }),
        body('ball', { kind: 'rigid', transform: { x: 0.5, y: 0, angle: 0 }, mass: 0.2, fixedRotation: false }),
      ],
      constraints: [
        { id: 't', type: 'track', bodyId: 'ball', centerBodyId: 'ring', radius: 0.5, side: 'inner' },
        { id: 'm', type: 'motor', bodyId: 'ball', omega: 2 },
      ],
    })
    const sim = new Simulation(s)
    let maxDev = 0
    for (let i = 0; i < 240; i++) {
      sim.step()
      const st = sim.state.bodies.ball!
      maxDev = Math.max(maxDev, Math.abs(Math.hypot(st.x, st.y) - 0.5))
    }
    const st = sim.state.bodies.ball!
    // 轨道约束始终生效：全程没离开半径 0.5 的圆
    expect(maxDev).toBeLessThan(0.03)
    // 马达也在起作用：球绕圈跑了一段
    expect(Math.atan2(st.y, st.x)).not.toBeCloseTo(0, 1)
  })

  it('传送带 + 电场：两个机制同时作用于一个物块', () => {
    const mk = (E: number) =>
      scene({
        world: { ...emptyScene().world, gravity: 9.8, timeStep: 1 / 480, substeps: 2 },
        bodies: [
          box('belt', 40, 0.4, { kind: 'static', transform: { x: 0, y: 0, angle: 0 }, material: 'metal' }),
          box('block', 0.3, 0.3, { kind: 'rigid', transform: { x: 0, y: 0.36, angle: 0 }, material: 'metal', mass: 1, charge: 1 }),
        ],
        constraints: [{ id: 'c', type: 'belt', bodyId: 'belt', speed: 1 }],
        fields: [{ id: 'E', kind: 'uniform', type: 'E', vector: { x: E, y: 0 } }],
      })
    // 电场弱（2 N）时，摩擦（μmg≈5.9 N）能把它按在带速上——这正是「传送带共速」的物理
    const weak = run(mk(2), 480 * 3)
    expect(weak.state.bodies.block!.vx).toBeCloseTo(1, 1)
    // 电场强到超过最大静摩擦（8 N > 5.9 N），物块才会被推着超过带速
    const strong = run(mk(8), 480 * 3)
    expect(strong.state.bodies.block!.vx).toBeGreaterThan(2)
  })
})
