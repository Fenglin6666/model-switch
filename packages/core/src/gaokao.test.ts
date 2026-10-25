import { describe, expect, it } from 'vitest'
import { parseProblem } from './problem'
import { GAOKAO_CASES } from './gaokaoCases'

describe('真实高考计算题：自动建模的覆盖边界', () => {
  for (const c of GAOKAO_CASES) {
    it(`${c.id} ${c.title}`, () => {
      const r = parseProblem(c.text)
      if (c.expect.kind === 'model') {
        expect(r.ok).toBe(true)
        if (!r.ok) return
        expect(r.archetype).toBe(c.expect.archetype)
        const assumptions = r.assumptions.join('')
        for (const must of c.expect.mustInclude) expect(assumptions).toContain(must)
        // 场景必须真的可运行，不能只返回一个空壳
        expect(r.scene.bodies.length).toBeGreaterThan(1)
        expect(r.scene.params[c.expect.archetype === 'boardBlock' ? 'l' : 'theta']).toBeDefined()
      } else {
        expect(r.ok).toBe(false)
        if (r.ok) return
        expect((r.unsupported ?? []).join('')).toContain(c.expect.includes)
      }
    })
  }
})
