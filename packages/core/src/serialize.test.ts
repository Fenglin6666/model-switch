import { describe, expect, it } from 'vitest'
import { buildPresetScene } from './presets'
import { decodeScene, decodeShare, encodeScene, encodeShare, normalizeScene, validateScene } from './serialize'
import { applyEdits } from './scene'
import { presetById } from './presets'

describe('序列化 / 分享 / 校验', () => {
  it('预置场景 encode → decode 后一致', () => {
    for (const id of ['incline', 'trough', 'loop', 'projectile']) {
      const s = buildPresetScene(id)
      const text = encodeScene(s)
      const back = decodeScene(text)
      expect(back.meta.title).toBe(s.meta.title)
      expect(back.bodies.length).toBe(s.bodies.length)
      expect(back.params).toEqual(s.params)
      expect(back.criteria).toEqual(s.criteria)
      expect(back.constraints).toEqual(s.constraints)
      expect(back.world.view.center).toEqual(s.world.view.center)
    }
  })

  it('预置场景分享：只存 id + 参数，长度 < 200', () => {
    const s = buildPresetScene('trough')
    const text = encodeShare(s)
    expect(text.startsWith('p1.trough.')).toBe(true)
    expect(text.length).toBeLessThan(200)
    const back = decodeShare(text)
    expect(back.meta.preset).toBe('trough')
    expect(back.params).toEqual(s.params)
    const kind = (sc: typeof s) => sc.bodies.find((b) => b.id === 'trough')!.kind
    expect(kind(back)).toBe(kind(s))
  })

  it('预置场景的组件编辑能进分享串', () => {
    const s = buildPresetScene('trough')
    s.edits = { bodies: { ball: { mass: 0.42, friction: 0.1 } } }
    applyEdits(s)
    const text = encodeShare(s)
    expect(text.startsWith('p1.trough.')).toBe(true)
    expect(text.length).toBeLessThan(400)
    const back = decodeShare(text)
    const ball = back.bodies.find((b) => b.id === 'ball')!
    expect(ball.mass).toBeCloseTo(0.42, 5)
    expect(ball.friction).toBeCloseTo(0.1, 5)
  })

  it('加了约束就退回完整 JSON', () => {
    const s = buildPresetScene('trough')
    s.constraints.push({
      id: 'extra',
      type: 'rope',
      a: { bodyId: 'ball', local: { x: 0, y: 0 } },
      b: { bodyId: 'trough', local: { x: 0, y: 0 } },
      length: 1,
    })
    const text = encodeShare(s)
    expect(text.startsWith('s1.')).toBe(true)
    expect(decodeShare(text).constraints.length).toBe(s.constraints.length)
  })

  it('小球纯滚动的斜面场景保持紧凑分享', () => {
    // 以前这里用 parseProblem 造场景；规则解析删掉后，直接按 AI 那条路造：
    // preset.build() + 改 params + layout()
    const s = buildPresetScene('incline')
    s.params.ball = 1
    s.params.model = 1
    s.meta.assumptions = ['小球，纯滚动']
    presetById('incline')!.layout?.(s)
    const text = encodeShare(s)
    expect(text.startsWith('p1.incline.')).toBe(true)
    expect(text.length).toBeLessThan(500)
    const back = decodeShare(text)
    const b = back.bodies.find((x) => x.id === 'block')!
    expect(b.kind).toBe('rigid')
    expect(b.shape.type).toBe('circle')
    expect(back.meta.assumptions ?? []).toContain('小球，纯滚动')
  })

  it('圆弧上的滑块场景也保持紧凑', () => {
    const s = buildPresetScene('rampArc')
    s.params.ball = 0
    s.meta.assumptions = ['滑块，平动']
    presetById('rampArc')!.layout?.(s)
    const text = encodeShare(s)
    expect(text.startsWith('p1.rampArc.')).toBe(true)
    const back = decodeShare(text)
    const b = back.bodies.find((x) => x.id === 'ball')!
    expect(b.shape.type).toBe('rect')
    expect(b.label).toBe('滑块')
    expect((back.meta.assumptions ?? []).join('')).toContain('滑块')
  })

  it('自由画布分享回退到完整 JSON', () => {
    const s = buildPresetScene('incline')
    s.meta.preset = undefined
    const text = encodeShare(s)
    expect(text.startsWith('s1.')).toBe(true)
    expect(decodeShare(text).bodies.length).toBe(s.bodies.length)
  })

  it('中文标题与参数能无损往返', () => {
    const s = buildPresetScene('trough')
    s.meta.title = '测试：半圆槽「可移动」'
    s.params.note = 1
    const back = decodeScene(encodeScene(s))
    expect(back.meta.title).toBe('测试：半圆槽「可移动」')
  })

  it('校验能发现坏引用', () => {
    const s = buildPresetScene('loop')
    s.bodies = s.bodies.filter((b) => b.id !== 'ball')
    const errors = validateScene(s)
    expect(errors.length).toBeGreaterThan(0)
  })

  it('旧/手写 JSON 会被补齐缺省字段', () => {
    const s = normalizeScene({ version: 1, meta: { title: '手写' } })
    expect(s.world.timeStep).toBeGreaterThan(0)
    expect(Array.isArray(s.bodies)).toBe(true)
  })
})
