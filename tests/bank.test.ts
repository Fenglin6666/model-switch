/**
 * 题库：分类、来源、结构。
 *
 * ⚠️ 2026-10-26 起，「可建模 / 暂不支持」是**人工标注**，不再自动验证。
 * 原因：规则解析（parseProblem）删掉了，生成只剩 AI 一条路——而 AI 需要网络和 key，
 * 不能进 CI。所以这一层只能保证「标注本身是合法的」，保证不了「AI 现在真的能建」。
 *
 * 这条降级是明确接受的：AI 的能力在变，静态标注本来就会过时。
 * 真正的覆盖边界应该靠 `scripts/ai-check.mjs` 定期跑真实接口来测，不是靠单测。
 */
import { describe, expect, it } from 'vitest'
import { BANK_CATEGORIES, BANK_PROBLEMS, bankStats, makeMineProblem, visibleCategories } from '@core/bank'
import { PRESETS } from '@core/presets'

describe('题库：结构与标注合法', () => {
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

  it('题目 id 唯一（否则详情页会串）', () => {
    const seen = new Set<string>()
    for (const p of BANK_PROBLEMS) {
      expect(seen.has(p.id), `重复的题目 id：${p.id}`).toBe(false)
      seen.add(p.id)
    }
  })

  it('标注的原型必须真的存在（防止指向一个不存在的场景）', () => {
    const presetIds = new Set(PRESETS.map((x) => x.id))
    for (const p of BANK_PROBLEMS) {
      if (p.expect.kind !== 'model') continue
      expect(presetIds.has(p.expect.archetype), `${p.id} 标注的原型 ${p.expect.archetype} 不在 PRESETS 里`).toBe(true)
    }
  })

  it('既有「可建模」也有「暂不支持」——边界要诚实地露出来', () => {
    const buildable = BANK_PROBLEMS.filter((p) => p.expect.kind === 'model')
    const unsupported = BANK_PROBLEMS.filter((p) => p.expect.kind === 'unsupported')
    expect(buildable.length).toBeGreaterThanOrEqual(8)
    expect(unsupported.length).toBeGreaterThan(0)
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
