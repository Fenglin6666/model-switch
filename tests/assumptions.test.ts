import { describe, expect, it } from 'vitest'
import { assumptionToggles, assumptionText, cycleAssumption } from '@core/assumptions'
import { buildPresetScene, presetById } from '@core/presets'
import { decodeShare, encodeShare } from '@core/serialize'
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
