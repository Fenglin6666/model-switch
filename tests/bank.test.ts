import { describe, expect, it } from 'vitest'
import { BANK_CATEGORIES, BANK_PROBLEMS, bankStats, makeMineProblem, visibleCategories } from '@core/bank'
import { parseProblem } from '@core/problem'

describe('题库：每条题的「能不能建」都必须是真的', () => {
  it('分类齐全，每条题的分类都在分类表里', () => {
    const ids = new Set(BANK_CATEGORIES.map((c) => c.id))
    expect(ids.has('mechanics')).toBe(true)
    expect(ids.has('em')).toBe(true)
    expect(ids.has('thermo')).toBe(true)
    for (const p of BANK_PROBLEMS) {
      expect(ids.has(p.category), `${p.id} 的分类 ${p.category}`).toBe(true)
      expect(p.text.length).toBeGreaterThan(20)
      expect(p.title.length).toBeGreaterThan(2)
      expect(p.source.length).toBeGreaterThan(0)
    }
  })

  it('说「能建」的题，parseProblem 真的建出来了，而且原型对得上', () => {
    const buildable = BANK_PROBLEMS.filter((p) => p.expect.kind === 'model')
    expect(buildable.length).toBeGreaterThanOrEqual(8)
    for (const p of buildable) {
      const r = parseProblem(p.text)
      expect(r.ok, `${p.id} 应该能建模：${r.ok ? '' : r.error}`).toBe(true)
      if (r.ok && p.expect.kind === 'model') {
        expect(r.archetype, `${p.id} 的原型`).toBe(p.expect.archetype)
      }
    }
  })

  it('说「暂不支持」的题，必须被明确拒绝（不能悄悄套一个错模型）', () => {
    const unsupported = BANK_PROBLEMS.filter((p) => p.expect.kind === 'unsupported')
    expect(unsupported.length).toBeGreaterThan(0)
    for (const p of unsupported) {
      const r = parseProblem(p.text)
      expect(r.ok, `${p.id} 不应该被静默建模`).toBe(false)
      if (!r.ok) expect(r.error.length).toBeGreaterThan(4)
    }
  })

  it('能建/不能建的数量与页面提示一致', () => {
    const stats = bankStats()
    expect(stats.total).toBe(BANK_PROBLEMS.length)
    expect(stats.buildable).toBe(BANK_PROBLEMS.filter((p) => p.expect.kind === 'model').length)
  })

  it('自编示例题必须标明来源，不冒充真题', () => {
    for (const p of BANK_PROBLEMS.filter((x) => x.origin === 'sample')) {
      expect(p.source).toContain('自编')
    }
    for (const p of BANK_PROBLEMS.filter((x) => x.origin === 'gaokao')) {
      expect(p.source).toMatch(/20\d\d/)
    }
  })

  it('导入的题目结构完整，「我的题目」分类按需出现', () => {
    const mine = makeMineProblem('  倾角为 45° 的斜面，滑块从顶端滑下。  ', 'mine-1', 1000)
    expect(mine.origin).toBe('mine')
    expect(mine.category).toBe('mine')
    expect(mine.text.startsWith('倾角为 45°')).toBe(true)
    expect(visibleCategories(0).some((c) => c.id === 'mine')).toBe(false)
    expect(visibleCategories(1).some((c) => c.id === 'mine')).toBe(true)
  })
})
