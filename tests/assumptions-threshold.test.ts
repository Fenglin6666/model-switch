import { describe, expect, it } from 'vitest'
import { assumptionToggles, assumptionText, cycleAssumption } from '@core/assumptions'
import { canSearchThreshold, suggestedThreshold, thresholdSpec, thresholdParams } from '@core/threshold'
import { buildPresetScene, presetById } from '@core/presets'
import { decodeShare, encodeShare } from '@core/serialize'
import { findCritical, formatCritical } from '@core/search'
import { runCriterion } from '@physics/simulation'
import { setAtPath } from '@core/scene'

const build = (id: string, patch: Record<string, number> = {}) => {
  const s = buildPresetScene(id)
  Object.assign(s.params, patch)
  presetById(id)!.layout?.(s)
  return s
}

describe('假设可勾选：点一下就重算', () => {
  it('斜面：主体 滑块 → 小球 → 滚动 → 滑块', () => {
    let s = build('incline')
    expect(assumptionToggles(s).map((t) => t.id)).toEqual(['body', 'surface'])
    expect(assumptionToggles(s).find((t) => t.id === 'body')!.value).toBe('block')

    const r1 = cycleAssumption(s, 'body')!
    s = r1.scene
    expect(r1.toggle.value).toBe('ball')
    expect(s.bodies.find((b) => b.id === 'block')!.shape.type).toBe('circle')

    const r2 = cycleAssumption(s, 'body')!
    s = r2.scene
    expect(r2.toggle.value).toBe('roll')
    expect(s.bodies.find((b) => b.id === 'block')!.kind).toBe('rigid')

    const r3 = cycleAssumption(s, 'body')!
    expect(r3.toggle.value).toBe('block')
    expect(r3.scene.bodies.find((b) => b.id === 'block')!.shape.type).toBe('rect')
  })

  it('斜面：光滑 ↔ 粗糙 改 μ 且改几何', () => {
    const s = build('incline')
    const smooth = cycleAssumption(s, 'surface')!
    expect(smooth.toggle.value).toBe('smooth')
    expect(smooth.scene.params.mu).toBe(0)
    const back = cycleAssumption(smooth.scene, 'surface')!
    expect(back.scene.params.mu).toBeGreaterThan(0)
    expect(assumptionText(back.scene)).toContain('表面粗糙')
  })

  it('半圆槽：固定 ↔ 可移动 改的是 kind，不是外观开关', () => {
    const s = build('trough')
    expect(s.bodies.find((b) => b.id === 'trough')!.kind).toBe('rigid')
    const fixed = cycleAssumption(s, 'mount')!
    expect(fixed.scene.params.fixed).toBe(1)
    expect(fixed.scene.bodies.find((b) => b.id === 'trough')!.kind).toBe('static')
    expect(assumptionText(fixed.scene)).toContain('槽固定')
  })

  it('平抛：不计 ↔ 计入 空气阻力', () => {
    const s = build('projectile')
    const on = cycleAssumption(s, 'air')!
    expect(on.scene.params.drag).toBe(1)
    const field = on.scene.fields.find((f) => f.kind === 'drag')
    expect(field && field.kind === 'drag' && field.enabled).toBe(true)
  })

  it('切换假设后分享串仍是 p1.（纠错不破坏分享）', () => {
    let s = build('trough')
    s = cycleAssumption(s, 'mount')!.scene
    s = cycleAssumption(s, 'ball')!.scene
    const token = encodeShare(s)
    expect(token.startsWith('p1.')).toBe(true)
    expect(token.length).toBeLessThan(250)
    expect(decodeShare(token).params.fixed).toBe(1)
  })
})

describe('临界判据通用化：任意参数 + 任意判据', () => {
  it('能扫的参数来自 params，开关类参数被排除', () => {
    const loop = build('loop')
    const keys = thresholdParams(loop).map((p) => p.key)
    expect(keys).toContain('v0')
    expect(keys).toContain('R')
    expect(keys).not.toContain('roll')
    expect(canSearchThreshold(loop)).toBe(true)
  })

  it('没有判据的场景不能找临界（诚实拒绝，不给假结果）', () => {
    const crossed = build('crossedFields')
    expect(crossed.criteria.length).toBe(0)
    expect(canSearchThreshold(crossed)).toBe(false)
  })

  it('自动推荐「最高频参数 + 非守恒判据」', () => {
    const s = suggestedThreshold(build('loop'))!
    expect(s.param).toBe('v0')
    expect(s.criterionId).toBe('detach')
    const spec = thresholdSpec(build('loop'), s.param, s.criterionId)!
    expect(spec.path).toBe('/params/v0')
    expect(spec.min).toBeLessThan(spec.max)
  })

  it('竖直圆轨道：扫 v₀ 找到「脱离 / 不脱离」的翻转点，误差 < 3%', async () => {
    const base = build('loop')
    base.world.duration = 1.5
    base.world.timeStep = 1 / 480
    const spec = thresholdSpec(base, 'v0', 'detach')!
    const preset = presetById(base.meta.preset ?? 'loop')!
    const outcome = await findCritical({
      range: [1, 8],
      samples: 10,
      precision: 1e-3,
      run: async (value) => {
        const s = setAtPath(structuredClone(base), spec.path, value)
        preset.layout?.(s)
        return runCriterion(s, { criterionId: 'detach', maxTime: 1.5 }).passed
      },
    })
    expect(outcome.flips.length).toBeGreaterThan(0)
    const flip = outcome.flips.find((f) => f.passFrom && !f.passTo) ?? outcome.flips[outcome.flips.length - 1]!
    const theory = Math.sqrt(5 * 9.8 * (base.params.R! - 0.055))
    expect(Math.abs(flip.critical - theory) / theory).toBeLessThan(0.03)
    expect(formatCritical(flip.critical, 3)).toMatch(/^5\.\d{2}$/)
  })
})
