/**
 * 约束属性表：可塑性的防线。
 *
 * 背景：`renderConstraintSheet` 原来是 if/else 手写的，只认绳/杆/弹簧，
 * 其余全部落到 else 分支**显示成「铰链」**——选中一条传送带，面板写着
 * 「铰链只固定连接点」，而且没有任何可调项。传送带速度、马达转速、电路电阻
 * 全都改不了，而它们恰好是 AI 最常生成的那几种。
 *
 * 这份测试卡三件事：
 *   1. 每种约束都有标题和提示（不许再出现「传送带显示成铰链」）；
 *   2. 表里每个字段 write 之后 read 读得回来（滑杆不会拖了没反应）；
 *   3. **recordConstraintEdit → applyEdits 能复原**（否则一 layout 就弹回去）。
 */
import { describe, expect, it } from 'vitest'
import { applyEdits, emptyScene, recordConstraintEdit, type Constraint, type Scene } from '../packages/core/src/scene'
import { CONSTRAINT_FIELDS, constraintFields, constraintTitle, isBodyBound } from '../packages/core/src/constraint-fields'

const ALL: Constraint[] = [
  { id: 'c', type: 'rope', a: { world: { x: 0, y: 0 } }, b: { world: { x: 1, y: 0 } }, length: 1 },
  { id: 'c', type: 'rod', a: { world: { x: 0, y: 0 } }, b: { world: { x: 1, y: 0 } }, length: 1 },
  {
    id: 'c',
    type: 'spring',
    a: { world: { x: 0, y: 0 } },
    b: { world: { x: 1, y: 0 } },
    k: 40,
    l0: 0.5,
    damping: 0.2,
  },
  { id: 'c', type: 'hinge', a: { world: { x: 0, y: 0 } }, b: { world: { x: 1, y: 0 } } },
  {
    id: 'c',
    type: 'pulley',
    a: { world: { x: 0, y: 0 } },
    b: { world: { x: 1, y: 0 } },
    groundA: { x: 0.5, y: 2 },
    groundB: { x: 0.5, y: 2 },
    lengthA: 2,
    lengthB: 1,
  },
  { id: 'c', type: 'prismatic', bodyId: 'a', centerBodyId: 'b', axis: 'x', lower: -1, upper: 1 },
  { id: 'c', type: 'track', bodyId: 'a', centerBodyId: 'b', radius: 0.6, side: 'inner' },
  { id: 'c', type: 'belt', bodyId: 'a', speed: 2 },
  { id: 'c', type: 'pin', bodyId: 'a', point: { x: 0, y: 0 } },
  { id: 'c', type: 'motor', bodyId: 'a', omega: 3 },
  { id: 'c', type: 'circuit', bodyId: 'a', fieldId: 'B', length: 0.8, resistance: 1 },
]

describe('约束属性表：每种约束都有名有姓', () => {
  it('11 种约束全部有标题和提示，且名字互不相同', () => {
    const types = new Set(ALL.map((c) => c.type))
    expect(types.size).toBe(11)
    const names = new Set<string>()
    for (const c of ALL) {
      const t = constraintTitle(c)
      expect(t.name.length).toBeGreaterThan(0)
      expect(t.hint.length).toBeGreaterThan(0)
      names.add(t.name)
    }
    // 原来所有非绳/杆/弹簧的约束都显示成「铰链」，去重后只剩几个名字
    expect(names.size).toBe(ALL.length)
  })

  it('每种约束在表里都有条目（哪怕是空数组）', () => {
    for (const c of ALL) expect(Array.isArray(CONSTRAINT_FIELDS[c.type])).toBe(true)
  })
})

describe('约束属性表：字段能读能写', () => {
  it('每个字段 write 之后 read 读得回来', () => {
    for (const c of ALL) {
      for (const f of constraintFields(c)) {
        const before = f.read(c)
        expect(before).not.toBeNull()
        // 往中间值写，避开上下界
        const target = (f.min + f.max) / 2
        const next = f.write(c, target)
        expect(f.read(next)).toBeCloseTo(target, 5)
        // 写的是新对象，不改原对象（历史/撤销依赖不可变）
        expect(f.read(c)).toBeCloseTo(before!, 5)
      }
    }
  })

  it('每种「可调」的约束至少有一个字段（铰链/销钉除外，它们没有数值参数）', () => {
    for (const c of ALL) {
      if (c.type === 'hinge' || c.type === 'pin') continue
      expect(constraintFields(c).length).toBeGreaterThan(0)
    }
  })

  it('场/电路这类核心参数确实在表里（不能只读不能改）', () => {
    const belt = ALL.find((c) => c.type === 'belt')!
    expect(constraintFields(belt).map((f) => f.key)).toContain('speed')
    const motor = ALL.find((c) => c.type === 'motor')!
    expect(constraintFields(motor).map((f) => f.key)).toContain('omega')
    const circuit = ALL.find((c) => c.type === 'circuit')!
    expect(constraintFields(circuit).map((f) => f.key)).toEqual(expect.arrayContaining(['length', 'resistance']))
    const prism = ALL.find((c) => c.type === 'prismatic')!
    expect(constraintFields(prism).map((f) => f.key)).toEqual(expect.arrayContaining(['lower', 'upper']))
  })
})

describe('约束属性表：编辑要能复原（否则 layout 一跑就弹回去）', () => {
  /** 把某个约束放进一个空场景，写一条编辑，再走 applyEdits */
  const roundtrip = (c: Constraint, key: string, value: number) => {
    const s: Scene = Object.assign(emptyScene(), {
      bodies: [
        { id: 'a', kind: 'particle', shape: { type: 'circle', r: 0.1 }, transform: { x: 0, y: 0, angle: 0 }, material: 'metal', appearance: { color: '#888', depth: 0.1 } },
        { id: 'b', kind: 'static', shape: { type: 'circle', r: 0.3 }, transform: { x: 1, y: 0, angle: 0 }, material: 'metal', appearance: { color: '#888', depth: 0.1 } },
      ],
      constraints: [{ ...c }],
      fields: [{ id: 'B', kind: 'uniform', type: 'B', bz: 1 }],
    })
    recordConstraintEdit(s, 'c', { [key]: value })
    const applied = applyEdits(s)
    const out = applied.constraints[0]!
    const f = constraintFields(out).find((x) => x.key === key)!
    return f.read(out)
  }

  it('传送带速度、马达转速、电路电阻、导轨限位、滑轮力比都能存下来', () => {
    expect(roundtrip(ALL.find((c) => c.type === 'belt')!, 'speed', -1.5)).toBeCloseTo(-1.5, 5)
    expect(roundtrip(ALL.find((c) => c.type === 'motor')!, 'omega', 7)).toBeCloseTo(7, 5)
    expect(roundtrip(ALL.find((c) => c.type === 'circuit')!, 'resistance', 3.2)).toBeCloseTo(3.2, 5)
    expect(roundtrip(ALL.find((c) => c.type === 'circuit')!, 'length', 0.45)).toBeCloseTo(0.45, 5)
    expect(roundtrip(ALL.find((c) => c.type === 'prismatic')!, 'upper', 2.5)).toBeCloseTo(2.5, 5)
    expect(roundtrip(ALL.find((c) => c.type === 'pulley')!, 'ratio', 2)).toBeCloseTo(2, 5)
    expect(roundtrip(ALL.find((c) => c.type === 'track')!, 'radius', 0.9)).toBeCloseTo(0.9, 5)
  })
})

describe('贴身约束：哪些要靠物体面板才能改', () => {
  it('传送带/马达/电路/销钉/导轨算「贴身」——画布上点不到，必须挂在物体上', () => {
    const bound = ALL.filter(isBodyBound).map((c) => c.type)
    expect(bound).toEqual(['prismatic', 'belt', 'pin', 'motor', 'circuit'])
    // 绳/杆/弹簧/铰链/滑轮/轨道是「有线的」，能在画布上点选
    const wired = ALL.filter((c) => !isBodyBound(c)).map((c) => c.type)
    expect(wired).toEqual(['rope', 'rod', 'spring', 'hinge', 'pulley', 'track'])
  })
})
