/**
 * build 子集：agent 用受限指令搭场景，产出后自己过一遍校验。
 *
 * 同时验证三件事：
 *   1. 指令 → Scene 的映射（含端口引用、缺省值）
 *   2. 结构不合法时不会「静默通过」（诊断进 warnings）
 *   3. 之前只在类型里声明、没实现的 belt / motor / pin 现在真能跑
 */
import { describe, expect, it } from 'vitest'
import { parsePlan, sceneFromOps, type BuildOp } from '../packages/core/src/ai-plan'
import { Simulation } from '../packages/physics/src/simulation'

const build = (ops: BuildOp[]) => {
  const r = sceneFromOps(ops)
  if (!r.ok) throw new Error(`场景没建出来：${r.error}`)
  return r
}

const run = (scene: ReturnType<typeof build>['scene'], steps: number) => {
  const sim = new Simulation(scene)
  for (let i = 0; i < steps; i++) sim.step()
  return sim
}

describe('指令 → 场景', () => {
  it('加物体：圆默认会动、方块默认固定（和手绘的约定一致）', () => {
    const { scene } = build([
      { op: 'addBody', id: 'ball', shape: { kind: 'circle', r: 0.2 }, at: { x: 0, y: 1 } },
      { op: 'addBody', id: 'ground', shape: { kind: 'rect', w: 6, h: 0.2 }, at: { x: 0, y: -0.1 } },
    ])
    expect(scene.bodies.find((b) => b.id === 'ball')!.kind).toBe('particle')
    expect(scene.bodies.find((b) => b.id === 'ground')!.kind).toBe('static')
  })

  it('line 的坐标是绝对端点，转成相对原点的折线', () => {
    const { scene } = build([
      { op: 'addBody', id: 'floor', shape: { kind: 'line', from: { x: 1, y: 2 }, to: { x: 4, y: 2 } }, behavior: 'fixed' },
    ])
    const b = scene.bodies[0]!
    expect(b.transform).toMatchObject({ x: 1, y: 2 })
    expect(b.shape).toMatchObject({ type: 'polyline', points: [{ x: 0, y: 0 }, { x: 3, y: 0 }] })
  })

  it('约束只引用端口，长度缺省按两端当前距离算', () => {
    const { scene } = build([
      { op: 'addBody', id: 'ball', shape: { kind: 'circle', r: 0.1 }, at: { x: 0, y: -1.2 } },
      { op: 'addConstraint', type: 'rope', a: { body: 'ball', port: 'center' }, b: { world: { x: 0, y: 0 } } },
    ])
    const rope = scene.constraints[0]!
    expect(rope.type).toBe('rope')
    expect(rope.type === 'rope' && rope.length).toBeCloseTo(1.2, 2)
    expect(rope.type === 'rope' && rope.a).toEqual({ bodyId: 'ball', port: 'center' })
  })

  it('语义端口可以声明，并被约束引用', () => {
    const { scene, report } = build([
      {
        op: 'addBody',
        id: 'rotor',
        shape: { kind: 'rect', w: 1, h: 0.1 },
        at: { x: 0, y: 0 },
        behavior: 'rolling',
        ports: [{ id: 'shaft', kind: 'axle', at: 'center' }],
      },
      { op: 'addConstraint', type: 'pin', bodyId: 'rotor', a: { body: 'rotor', port: 'shaft' } },
    ])
    expect(scene.bodies[0]!.ports!.map((p) => p.id)).toContain('shaft')
    expect(report!.diagnostics.some((d) => d.code === 'dangling-port')).toBe(false)
  })

  it('接错端口 → 诊断进 warnings，不是静默成功', () => {
    const r = sceneFromOps([
      { op: 'addBody', id: 'ball', shape: { kind: 'circle', r: 0.1 }, at: { x: 0, y: 0 } },
      { op: 'addConstraint', type: 'rope', a: { body: 'ball', port: 'nope' }, b: { world: { x: 0, y: 1 } } },
    ])
    expect(r.warnings.join(' ')).toContain('dangling-port')
  })

  it('几何退化被抓住', () => {
    const r = sceneFromOps([{ op: 'addBody', id: 'bad', shape: { kind: 'circle', r: 0 }, at: { x: 0, y: 0 } }])
    // 形状不合法 → 跳过这个物体 → 最后没有任何物体，明确失败
    expect(r.ok).toBe(false)
  })

  it('完全不认识的指令被跳过并记一条', () => {
    const r = sceneFromOps([
      { op: 'addBody', id: 'ball', shape: { kind: 'circle', r: 0.1 }, at: { x: 0, y: 0 } },
      { op: 'teleport' } as unknown as BuildOp,
    ])
    expect(r.ok).toBe(true)
    expect(r.warnings.join(' ')).toContain('不认识的指令')
  })
})

describe('解析 build 计划', () => {
  it('合法的 ops 被收下，坏条目被丢掉', () => {
    const r = parsePlan(
      JSON.stringify({
        mode: 'build',
        ops: [
          { op: 'addBody', id: 'a', shape: { kind: 'circle', r: 0.1 }, at: { x: 0, y: 0 } },
          { op: 'addBody', id: 'b' }, // 缺 shape
          { op: 'addConstraint', type: 'rope', a: { body: 'a', port: 'top' } },
          { op: 'addConstraint', type: '传送带' }, // 不认识的类型
        ],
      }),
    )
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.plan.ops!.length).toBe(2)
  })

  it('build 模式但没有有效指令 → 报错', () => {
    expect(parsePlan('{"mode":"build","ops":[]}').ok).toBe(false)
  })
})

describe('之前只在类型里声明的三种约束，现在真能跑', () => {
  it('传送带：物块被表面速度带着走（+speed = 沿传送带自身 +x）', () => {
    const { scene } = build([
      { op: 'addBody', id: 'belt', shape: { kind: 'line', from: { x: 0, y: 0 }, to: { x: 4, y: 0 } }, behavior: 'fixed' },
      { op: 'addConstraint', type: 'belt', bodyId: 'belt', params: { speed: 2 } },
      {
        op: 'addBody',
        id: 'block',
        shape: { kind: 'rect', w: 0.2, h: 0.15 },
        at: { x: 0.4, y: 0.12 },
        behavior: 'moving',
        mass: 0.5,
        friction: 0.3,
      },
    ])
    const sim = run(scene, 240) // 1 s
    const x = sim.state.bodies.block!.x
    expect(x).toBeGreaterThan(0.4 + 0.2) // 确实被往 +x 带了
  })

  it('传送带反向：speed 取负就往 -x 走', () => {
    const { scene } = build([
      { op: 'addBody', id: 'belt', shape: { kind: 'line', from: { x: -1, y: 0 }, to: { x: 3, y: 0 } }, behavior: 'fixed' },
      { op: 'addConstraint', type: 'belt', bodyId: 'belt', params: { speed: -2 } },
      {
        op: 'addBody',
        id: 'block',
        shape: { kind: 'rect', w: 0.2, h: 0.15 },
        at: { x: 2.4, y: 0.12 },
        behavior: 'moving',
        mass: 0.5,
        friction: 0.3,
      },
    ])
    const sim = run(scene, 240)
    expect(sim.state.bodies.block!.x).toBeLessThan(2.4 - 0.2)
  })

  it('马达：转盘按给定角速度转', () => {
    const { scene } = build([
      { op: 'addBody', id: 'disc', shape: { kind: 'circle', r: 0.3 }, at: { x: 0, y: 0 }, behavior: 'rolling' },
      { op: 'addConstraint', type: 'motor', bodyId: 'disc', params: { omega: 2 } },
    ])
    scene.world.gravity = 0
    const sim = run(scene, 120) // 0.5 s
    const d = sim.state.bodies.disc!
    expect(Math.abs(d.omega ?? 0)).toBeCloseTo(2, 1)
    expect(Math.abs(d.angle)).toBeGreaterThan(0.5)
  })

  it('销钉：刚体绕钉住的点转，到钉子的距离不变', () => {
    const { scene } = build([
      // 必须是 rolling 刚体：质点默认锁转动，销钉会把质点完全钉死（校验器会提示这一点）
      { op: 'addBody', id: 'ball', shape: { kind: 'circle', r: 0.1 }, at: { x: 1, y: 0 }, behavior: 'rolling' },
      { op: 'addConstraint', type: 'pin', bodyId: 'ball', a: { body: 'ball', port: 'center' } },
    ])
    // pin 的 point 取的是端口世界坐标，这里就是 (1,0)；手动挪到原点才测得出「绕点转」
    const pin = scene.constraints[0]!
    expect(pin.type).toBe('pin')
    if (pin.type === 'pin') pin.point = { x: 0, y: 0 }
    const sim = run(scene, 120)
    const b = sim.state.bodies.ball!
    expect(Math.hypot(b.x, b.y)).toBeCloseTo(1, 1) // 距离锁死
    expect(b.x).toBeLessThan(0.95) // 真的摆下来了
    expect(b.y).toBeLessThan(-0.1)
  })

  it('马达装在质点上会被校验器拦下（质点锁转动）', () => {
    const r = sceneFromOps([
      { op: 'addBody', id: 'disc', shape: { kind: 'circle', r: 0.3 }, at: { x: 0, y: 0 }, behavior: 'moving' },
      { op: 'addConstraint', type: 'motor', bodyId: 'disc', params: { omega: 2 } },
    ])
    expect(r.warnings.join(' ')).toContain('motor-on-locked-body')
  })
})

describe('电磁感应：circuit 指令', () => {
  it('addField(B) + circuit → 棒被恒力拉动，出现动生电动势', () => {
    const { scene } = build([
      {
        op: 'addBody',
        id: 'rod',
        shape: { kind: 'rect', w: 0.06, h: 0.5 },
        at: { x: 0, y: 0 },
        behavior: 'rolling',
        mass: 0.2,
        force: { x: 0.5, y: 0 },
      },
      { op: 'addField', type: 'B', magnitude: 0.8 },
      { op: 'addConstraint', type: 'circuit', bodyId: 'rod', params: { length: 0.5, resistance: 0.4 } },
    ])
    const c = scene.constraints.find((x) => x.type === 'circuit')
    expect(c).toBeTruthy()
    if (c?.type === 'circuit') {
      expect(c.length).toBe(0.5)
      expect(c.resistance).toBe(0.4)
      // fieldId 自动指向那个 B 场（AI 不知道我们内部怎么编号）
      expect(scene.fields.some((f) => f.id === c.fieldId)).toBe(true)
    }
    const sim = run(scene, 240)
    expect(sim.state.circuits['c1']).toBeTruthy()
    expect(sim.state.bodies.rod!.vx).toBeGreaterThan(0.1)
  })

  it('没有磁场就报错跳过，而不是静默加一条不工作的约束', () => {
    const r = sceneFromOps([
      { op: 'addBody', id: 'rod', shape: { kind: 'rect', w: 0.06, h: 0.5 }, at: { x: 0, y: 0 }, behavior: 'rolling' },
      { op: 'addConstraint', type: 'circuit', bodyId: 'rod', params: { length: 0.5, resistance: 0.4 } },
    ])
    expect(r.ok).toBe(true)
    expect(r.scene.constraints.some((c) => c.type === 'circuit')).toBe(false)
    expect(r.warnings.join(' ')).toContain('找不到匀强磁场')
  })
})

describe('agent 基元：滑轮 / 圆轨道 / 导轨 / 有界场', () => {
  it('滑轮：agent 只给「轮 + 两端」，绳长和轮心由我们算', () => {
    const { scene } = build([
      { op: 'addBody', id: 'wheel', shape: { kind: 'circle', r: 0.15 }, at: { x: 0, y: 2 }, behavior: 'fixed' },
      { op: 'addBody', id: 'm1', shape: { kind: 'rect', w: 0.2, h: 0.2 }, at: { x: -0.4, y: 1 }, behavior: 'moving', mass: 1 },
      { op: 'addBody', id: 'm2', shape: { kind: 'rect', w: 0.2, h: 0.2 }, at: { x: 0.4, y: 0.6 }, behavior: 'moving', mass: 2 },
      { op: 'addConstraint', type: 'pulley', bodyId: 'wheel', a: { body: 'm1', port: 'top' }, b: { body: 'm2', port: 'top' } },
    ])
    const c = scene.constraints.find((x) => x.type === 'pulley')
    expect(c).toBeTruthy()
    if (c?.type === 'pulley') {
      // 轮心就是两个 ground anchor
      expect(c.groundA.x).toBeCloseTo(0, 5)
      expect(c.groundA.y).toBeCloseTo(2, 5)
      expect(c.groundB).toEqual(c.groundA)
      // 绳长 = 轮心到挂点的距离
      expect(c.lengthA).toBeCloseTo(Math.hypot(-0.4, 1.1 - 0.1 - 2 + 0.1), 1)
      expect(c.lengthA).toBeGreaterThan(0)
      expect(c.lengthB).toBeGreaterThan(0)
    }
    // 跑起来：重的那个下降，轻的上升
    const sim = run(scene, 240)
    expect(sim.state.bodies.m2!.y).toBeLessThan(0.6)
    expect(sim.state.bodies.m1!.y).toBeGreaterThan(1)
  })

  it('圆轨道：半径默认 = 轨道内半径 − 球半径（agent 不用自己减）', () => {
    const { scene } = build([
      { op: 'addBody', id: 'arc', shape: { kind: 'circle', r: 1 }, at: { x: 0, y: 0 }, behavior: 'fixed' },
      { op: 'addBody', id: 'ball', shape: { kind: 'circle', r: 0.1 }, at: { x: 0.9, y: 0 }, behavior: 'rolling', mass: 0.2 },
      { op: 'addConstraint', type: 'track', bodyId: 'ball', centerBodyId: 'arc' },
    ])
    const c = scene.constraints.find((x) => x.type === 'track')
    expect(c?.type).toBe('track')
    if (c?.type === 'track') expect(c.radius).toBeCloseTo(0.9, 5)

    // 给一个切向速度，球心到圆心的距离应保持不变（被轨道约束住）
    const ball = scene.bodies.find((b) => b.id === 'ball')!
    ball.velocity = { x: 0, y: 2 }
    const sim = run(scene, 120)
    const st = sim.state.bodies.ball!
    expect(Math.hypot(st.x, st.y)).toBeCloseTo(0.9, 1)
  })

  it('导轨：axis/行程限位落到场景里，滑块只能沿轴动', () => {
    const { scene } = build([
      { op: 'addBody', id: 'rail', shape: { kind: 'rect', w: 6, h: 0.2 }, at: { x: 0, y: 0 }, behavior: 'fixed' },
      { op: 'addBody', id: 'slider', shape: { kind: 'rect', w: 0.2, h: 0.2 }, at: { x: -1, y: 0.2 }, behavior: 'moving', mass: 1, force: { x: 2, y: 0 } },
      { op: 'addConstraint', type: 'prismatic', bodyId: 'slider', centerBodyId: 'rail', params: { axis: 0, lower: -2, upper: 0.5 } },
    ])
    const c = scene.constraints.find((x) => x.type === 'prismatic')
    expect(c?.type).toBe('prismatic')
    if (c?.type === 'prismatic') {
      expect(c.axis).toBe('x')
      expect(c.upper).toBe(0.5)
    }
    const sim = run(scene, 240 * 3)
    const st = sim.state.bodies.slider!
    expect(Math.abs(st.y - 0.2)).toBeLessThan(0.05) // 竖直被锁住
    expect(st.x).toBeCloseTo(-0.5, 1) // 走到上限（相对起点 -1，+0.5）
  })

  it('有界磁场：场只建在区域里，区域外不偏转', () => {
    const { scene } = build([
      {
        op: 'addBody',
        id: 'q',
        shape: { kind: 'circle', r: 0.08 },
        at: { x: -1.5, y: 0 },
        behavior: 'moving',
        mass: 1,
        charge: 1,
      },
      { op: 'addField', type: 'B', magnitude: 2, region: { kind: 'rect', x: 0, y: 0, w: 2, h: 2 } },
    ])
    expect(scene.regions.length).toBe(1)
    const f = scene.fields[0]!
    expect(f.kind).toBe('uniform')
    if (f.kind === 'uniform') expect(f.regionId).toBe(scene.regions[0]!.id)

    // 从左侧以 +x 射入，穿过 2 m 宽的磁场区后再直线离开
    const q = scene.bodies.find((b) => b.id === 'q')!
    q.velocity = { x: 3, y: 0 }
    scene.world.gravity = 0
    const sim = run(scene, 960)
    const st = sim.state.bodies.q!
    expect(st.x).toBeGreaterThan(1) // 穿过去了
    expect(Math.abs(st.vy)).toBeGreaterThan(0.05) // 场内被偏转过
  })

  it('有界电场：区域外的物体不受力（和受力显示走同一套判定）', () => {
    const { scene } = build([
      { op: 'addBody', id: 'q', shape: { kind: 'circle', r: 0.08 }, at: { x: 2.5, y: 0 }, behavior: 'moving', mass: 1, charge: 1 },
      { op: 'addField', type: 'E', magnitude: 2, angleDeg: 0, region: { kind: 'rect', x: 0, y: 0, w: 1, h: 1 } },
    ])
    scene.world.gravity = 0
    const sim = run(scene, 240)
    const st = sim.state.bodies.q!
    // 在场区外（x=2.5，区域只到 0.5）：既不该动，也不该显示 qE 箭头
    expect(Math.abs(st.vx)).toBeLessThan(0.01)
    expect(st.force.ex).toBe(0)
  })
})
