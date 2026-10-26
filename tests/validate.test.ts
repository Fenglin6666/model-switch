/**
 * 结构校验：自由度分析 + 诊断。
 *
 * 这把「尺」的存在理由：LLM 生成的结构没法靠「看着像」判断对错
 * （有实证：LLM 评估仿真结果不如人工）。所以正确性必须落在确定性检查上。
 *
 * 借 Modelica 相容性分析的思路：方程数 ≠ 变量数 → 欠/过约束。刚体系统里对应的是自由度。
 */
import { describe, expect, it } from 'vitest'
import { emptyScene, type Body, type Constraint, type Scene } from '../packages/core/src/scene'
import { PRESETS } from '../packages/core/src/presets'
import { analyzeScene, bodyDof, constraintDof, errorsOf, summarizeReport } from '../packages/core/src/validate'

const mkBody = (id: string, over: Partial<Body> = {}): Body => ({
  id,
  kind: 'particle',
  shape: { type: 'circle', r: 0.2 },
  transform: { x: 0, y: 0, angle: 0 },
  material: 'metal',
  appearance: { color: '#fff', depth: 0.1 },
  ...over,
})

const scene = (bodies: Body[], constraints: Constraint[] = []): Scene => {
  const s = emptyScene()
  s.bodies = bodies
  s.constraints = constraints
  return s
}

const codes = (s: Scene) => analyzeScene(s).diagnostics.map((d) => d.code)

describe('自由度计数', () => {
  it('静态 0、运动 3、锁转动的粒子 2', () => {
    expect(bodyDof(mkBody('a', { kind: 'static' }))).toBe(0)
    expect(bodyDof(mkBody('b'))).toBe(3)
    expect(bodyDof(mkBody('c', { fixedRotation: true }))).toBe(2)
  })

  it('约束消去的自由度：绳 1、铰链 2、马达 0（驱动不约束）', () => {
    expect(constraintDof({ id: 'c', type: 'rope', a: { world: { x: 0, y: 0 } }, b: { world: { x: 1, y: 0 } }, length: 1 })).toBe(1)
    expect(constraintDof({ id: 'c', type: 'hinge', a: { world: { x: 0, y: 0 } }, b: { world: { x: 1, y: 0 } } })).toBe(2)
    expect(constraintDof({ id: 'c', type: 'motor', bodyId: 'x', omega: 1 })).toBe(0)
    expect(constraintDof({ id: 'c', type: 'belt', bodyId: 'x', speed: 1 })).toBe(0)
  })

  it('单摆：一个球 + 一根绳 → 还剩 2 个自由度（能绕点摆，角度自由）', () => {
    const s = scene(
      [mkBody('ball')],
      [{ id: 'rope', type: 'rope', a: { bodyId: 'ball', port: 'top' }, b: { world: { x: 0, y: 1 } }, length: 1 }],
    )
    const r = analyzeScene(s)
    expect(r.dof.total).toBe(2)
    expect(r.ok).toBe(true)
    expect(r.diagnostics.some((d) => d.code === 'under-constrained')).toBe(true)
  })

  it('锁转动的物体被 3 根绳钉住 → 过约束（2 - 3 = -1）', () => {
    const s = scene(
      [mkBody('b', { fixedRotation: true })],
      [0, 1, 2].map((i) => ({
        id: `r${i}`,
        type: 'rope' as const,
        a: { bodyId: 'b', port: 'center' },
        b: { world: { x: i, y: 2 } },
        length: 1,
      })),
    )
    const r = analyzeScene(s)
    expect(r.dof.total).toBe(-1)
    expect(r.diagnostics.some((d) => d.code === 'over-constrained')).toBe(true)
    // 过约束只是警告，不是错误：planck 会做最小二乘，通常还能跑
    expect(r.ok).toBe(true)
  })
})

describe('诊断：会抓到真错误', () => {
  it('约束指向不存在的物体', () => {
    const s = scene(
      [mkBody('ball')],
      [{ id: 'rope', type: 'rope', a: { bodyId: 'ghost', port: 'top' }, b: { world: { x: 0, y: 1 } }, length: 1 }],
    )
    const r = analyzeScene(s)
    expect(codes(s)).toContain('dangling-body')
    expect(r.ok).toBe(false)
  })

  it('端口不存在，并把可用端口列出来', () => {
    const s = scene(
      [mkBody('ball')],
      [{ id: 'rope', type: 'rope', a: { bodyId: 'ball', port: 'shaft' }, b: { world: { x: 0, y: 1 } }, length: 1 }],
    )
    const d = analyzeScene(s).diagnostics.find((x) => x.code === 'dangling-port')!
    expect(d).toBeTruthy()
    expect(d.message).toContain('shaft')
    expect(d.message).toContain('center') // 提示可用端口
    expect(d.portId).toBe('shaft')
  })

  it('几何退化 / 质量为零 / 坐标非有限', () => {
    expect(codes(scene([mkBody('a', { shape: { type: 'circle', r: 0 } })]))).toContain('degenerate-shape')
    expect(codes(scene([mkBody('a', { mass: 0 })]))).toContain('zero-mass')
    expect(codes(scene([mkBody('a', { transform: { x: NaN, y: 0, angle: 0 } })]))).toContain('non-finite-transform')
  })

  it('id 重复', () => {
    expect(codes(scene([mkBody('a'), mkBody('a')]))).toContain('duplicate-body')
  })

  it('场强为 0 只是警告', () => {
    const s = scene([mkBody('a')])
    s.fields = [{ id: 'E', kind: 'uniform', type: 'E', vector: { x: 0, y: 0 } }]
    const r = analyzeScene(s)
    expect(r.diagnostics.some((d) => d.code === 'zero-field' && d.level === 'warn')).toBe(true)
    expect(r.ok).toBe(true)
  })

  it('声明了但没接的端口 → info（组件沉淀时常忘）', () => {
    const s = scene([
      mkBody('a', { ports: [{ id: 'hook', kind: 'hook', local: { x: 0, y: 0.2 } }] }),
    ])
    const r = analyzeScene(s)
    expect(r.diagnostics.some((d) => d.code === 'unused-port' && d.level === 'info')).toBe(true)
  })
})

describe('对 18 个预置不误报', () => {
  it('每个预置场景都没有 error 级诊断', () => {
    const bad: string[] = []
    for (const p of PRESETS) {
      const s = p.build()
      const errs = errorsOf(analyzeScene(s))
      if (errs.length) bad.push(`${p.id}: ${errs.map((e) => e.code).join(',')}`)
    }
    expect(bad).toEqual([])
  })
})

describe('摘要', () => {
  it('有错误时先报错误，没错误时报自由度', () => {
    expect(summarizeReport(analyzeScene(scene([mkBody('a', { mass: 0 })])))).toContain('错误')
    expect(summarizeReport(analyzeScene(scene([mkBody('a')])))).toContain('自由度')
  })
})
