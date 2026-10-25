import { describe, expect, it } from 'vitest'
import { buildPresetScene } from '@core/presets'
import { componentSelection, extractComponent, instantiateComponent, suggestComponentName } from '@core/components'
import { addComponent, deleteComponent, emptyLibrary, parseLibrary, renameComponent, serializeLibrary } from '@core/library'

/** 搭一个「两个球 + 一根绳」的场景 */
function ropeScene() {
  const s = buildPresetScene('incline')
  s.bodies = [
    ...s.bodies,
    {
      id: 'a1',
      kind: 'particle',
      role: 'object',
      shape: { type: 'circle', r: 0.15 },
      transform: { x: 0.2, y: 2.2, angle: 0 },
      material: 'metal',
      mass: 0.2,
      appearance: { color: '#d95a39', depth: 0.1 },
      label: '球 A',
    },
    {
      id: 'a2',
      kind: 'particle',
      role: 'object',
      shape: { type: 'circle', r: 0.15 },
      transform: { x: 1.2, y: 2.2, angle: 0 },
      material: 'metal',
      mass: 0.2,
      appearance: { color: '#3f6fd0', depth: 0.1 },
      label: '球 B',
    },
  ]
  s.constraints = [
    ...s.constraints,
    { id: 'r1', type: 'rope', a: { bodyId: 'a1', local: { x: 0, y: 0 } }, b: { bodyId: 'a2', local: { x: 0, y: 0 } }, length: 1 },
    // 只连了一端的绳子：不该被带进去
    { id: 'r2', type: 'rope', a: { bodyId: 'a1', local: { x: 0, y: 0 } }, b: { bodyId: 'block', local: { x: 0, y: 0 } }, length: 2 },
  ]
  return s
}

describe('从场景里「存」一个组件', () => {
  it('选中两个球 → 只带走它们之间的绳，不带跨出去的绳', () => {
    const s = ropeScene()
    const comp = extractComponent(s, ['a1', 'a2'])!
    expect(comp.bodies.map((b) => b.id)).toEqual(['a1', 'a2'])
    expect(comp.constraints.map((c) => c.id)).toEqual(['r1'])
  })

  it('坐标平移成「以组件中心为原点」', () => {
    const comp = extractComponent(ropeScene(), ['a1', 'a2'])!
    // 两球中点 (0.7, 2.2)
    expect(comp.bodies[0]!.transform.x).toBeCloseTo(-0.5, 6)
    expect(comp.bodies[1]!.transform.x).toBeCloseTo(0.5, 6)
    expect(comp.bodies[0]!.transform.y).toBeCloseTo(0, 6)
  })

  it('自动起名用物体的标签', () => {
    const comp = extractComponent(ropeScene(), ['a1', 'a2'])!
    expect(comp.name).toBe('球 A + 球 B')
    expect(suggestComponentName([])).toBe('组件')
    const many = Array.from({ length: 5 }, (_, i) => ({ label: `件${i}` }) as never)
    expect(suggestComponentName(many)).toContain('等 5 件')
  })

  it('没选东西 / 只选了一个球（绳跨出去）→ 组件里不含那根绳', () => {
    expect(extractComponent(ropeScene(), [])).toBeNull()
    const one = extractComponent(ropeScene(), ['a1'])!
    expect(one.bodies).toHaveLength(1)
    expect(one.constraints).toHaveLength(0)
  })

  it('存出来的东西和原场景脱钩（改组件不影响原场景）', () => {
    const s = ropeScene()
    const comp = extractComponent(s, ['a1', 'a2'])!
    comp.bodies[0]!.transform.x = 99
    expect(s.bodies.find((b) => b.id === 'a1')!.transform.x).toBe(0.2)
  })
})

describe('把组件插回场景', () => {
  it('id 全部换新，位置平移到落点', () => {
    const comp = extractComponent(ropeScene(), ['a1', 'a2'])!
    const inst = instantiateComponent(comp, { x: 5, y: 1 }, { prefix: 'k1-' })
    expect(inst.bodies.map((b) => b.id)).toEqual(['k1-0', 'k1-1'])
    expect(inst.bodies[0]!.transform.x).toBeCloseTo(4.5, 6)
    expect(inst.bodies[1]!.transform.x).toBeCloseTo(5.5, 6)
    expect(inst.bodies[0]!.transform.y).toBeCloseTo(1, 6)
    // 约束的两端也跟着换名
    const rope = inst.constraints[0]!
    expect(rope.id).toBe('k1-c0')
    if (rope.type === 'rope') {
      expect(rope.a).toMatchObject({ bodyId: 'k1-0' })
      expect(rope.b).toMatchObject({ bodyId: 'k1-1' })
    }
  })

  it('插两次不会撞 id', () => {
    const comp = extractComponent(ropeScene(), ['a1', 'a2'])!
    const a = instantiateComponent(comp, { x: 0, y: 0 }, { prefix: 'k1-' })
    const b = instantiateComponent(comp, { x: 0, y: 0 }, { prefix: 'k2-' })
    const ids = new Set([...a.ids, ...b.ids])
    expect(ids.size).toBe(4)
  })

  it('插进场景后能跑（约束的 id 指向真实物体）', () => {
    const s = buildPresetScene('incline')
    const comp = extractComponent(ropeScene(), ['a1', 'a2'])!
    const inst = instantiateComponent(comp, { x: 0, y: 3 }, { prefix: 'k1-' })
    const next = {
      ...s,
      bodies: [...s.bodies, ...inst.bodies],
      constraints: [...s.constraints, ...inst.constraints],
    }
    for (const c of next.constraints) {
      if (c.type === 'rope' || c.type === 'rod' || c.type === 'spring' || c.type === 'hinge') {
        const ids = next.bodies.map((b) => b.id)
        if ('bodyId' in c.a) expect(ids).toContain(c.a.bodyId)
        if ('bodyId' in c.b) expect(ids).toContain(c.b.bodyId)
      }
    }
  })
})

describe('组件库（本地持久化）', () => {
  it('存 / 改名 / 删', () => {
    let lib = emptyLibrary()
    const comp = extractComponent(ropeScene(), ['a1', 'a2'])!
    lib = addComponent(lib, comp).library
    expect(lib.components).toHaveLength(1)
    lib = renameComponent(lib, comp.id, '  双球绳  ')
    expect(lib.components[0]!.name).toBe('双球绳')
    lib = deleteComponent(lib, comp.id)
    expect(lib.components).toHaveLength(0)
  })

  it('序列化往返：组件里的物体和约束都在', () => {
    let lib = emptyLibrary()
    const comp = extractComponent(ropeScene(), ['a1', 'a2'])!
    lib = addComponent(lib, comp).library
    const back = parseLibrary(serializeLibrary(lib))
    expect(back.components).toHaveLength(1)
    expect(back.components[0]!.bodies).toHaveLength(2)
    expect(back.components[0]!.constraints).toHaveLength(1)
  })

  it('旧数据没有 components 字段也不炸', () => {
    const lib = parseLibrary(JSON.stringify({ version: 1, folders: [], models: [], problems: [] }))
    expect(lib.components).toEqual([])
  })

  it('上限 40 个，满了明确报错', () => {
    let lib = emptyLibrary()
    const comp = extractComponent(ropeScene(), ['a1', 'a2'])!
    for (let i = 0; i < 40; i++) lib = addComponent(lib, { ...comp, id: `c${i}` }).library
    const over = addComponent(lib, { ...comp, id: 'over' })
    expect(over.error).toContain('40')
  })
})

describe('点中一个物体 → 顺着约束带出整段', () => {
  /** 只有「两球 + 一根绳」，没有连到别处 */
  function isolatedRope() {
    const s = ropeScene()
    s.constraints = s.constraints.filter((c) => c.id !== 'r2')
    return s
  }

  it('点球 A，把绳和球 B 一起带上', () => {
    expect(componentSelection(isolatedRope(), 'a1').sort()).toEqual(['a1', 'a2'])
  })

  it('连到别处时也会一路带过去（用户点的是「这一坨」）', () => {
    // ropeScene 里 a1 还连着一根通向 block 的绳 → 会带上 block
    expect(componentSelection(ropeScene(), 'a1').sort()).toEqual(['a1', 'a2', 'block'])
  })

  it('点一个没连东西的物体，就它自己', () => {
    const s = buildPresetScene('incline')
    expect(componentSelection(s, 'block')).toEqual(['block'])
  })

  it('点活塞会把气缸带上（prismatic 两端都算）', () => {
    const s = buildPresetScene('gas')
    const ids = componentSelection(s, 'piston')
    expect(ids).toContain('piston')
    expect(ids).toContain('cylinder')
  })

  it('点不存在的 id → 空', () => {
    expect(componentSelection(buildPresetScene('incline'), 'nope')).toEqual([])
  })

  it('有上限，别把整个场景吸进来', () => {
    expect(componentSelection(ropeScene(), 'a1', 1)).toHaveLength(1)
    expect(componentSelection(ropeScene(), 'a1', 2)).toHaveLength(2)
  })
})
