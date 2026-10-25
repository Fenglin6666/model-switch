import { describe, expect, it } from 'vitest'
import { parseProblem } from './problem'

const ok = (text: string) => {
  const r = parseProblem(text)
  if (!r.ok) throw new Error(r.error)
  return r
}

describe('题目解析', () => {
  it('斜面 + 光滑圆弧', () => {
    const r = ok('如图，倾角为30°的斜面底端与半径R=0.5m的光滑圆弧相切。质量m=1kg的滑块从斜面顶端由静止释放，斜面动摩擦因数μ=0.2。求滑块到达圆弧最低点时的速度。')
    expect(r.archetype).toBe('rampArc')
    expect(r.scene.params.theta).toBe(30)
    expect(r.scene.params.R).toBeCloseTo(0.5)
    expect(r.scene.params.mu).toBeCloseTo(0.2)
    expect(r.scene.params.muArc).toBe(0)
    expect(r.scene.params.mass).toBeCloseTo(1)
  })

  it('斜面滑块（含 cm / g 换算）', () => {
    const r = ok('倾角θ=37°的斜面上，质量m=200g的物块以v0=4m/s的初速度沿斜面下滑，动摩擦因数μ=0.25。')
    expect(r.archetype).toBe('incline')
    expect(r.scene.params.theta).toBe(37)
    expect(r.scene.params.mass).toBeCloseTo(0.2)
    expect(r.scene.params.v0).toBeCloseTo(4)
    expect(r.scene.params.mu).toBeCloseTo(0.25)
  })

  it('平抛', () => {
    const r = ok('将一小球以v0=20m/s的速度水平抛出，抛出点距地面高度h=20m，不计空气阻力。')
    expect(r.archetype).toBe('projectile')
    expect(r.scene.params.v0).toBeCloseTo(20)
    expect(r.scene.params.h).toBeCloseTo(20)
  })

  it('单摆', () => {
    const r = ok('长L=1m的细线一端固定，另一端系质量m=0.5kg的小球，将小球拉至与竖直方向成60°后由静止释放。')
    expect(r.archetype).toBe('pendulum')
    expect(r.scene.params.L).toBeCloseTo(1)
    expect(r.scene.params.theta).toBe(60)
  })

  it('弹簧', () => {
    const r = ok('劲度系数k=200N/m的弹簧一端固定，另一端连接质量m=0.5kg的物块，将弹簧压缩x=0.1m后释放。')
    expect(r.archetype).toBe('spring')
    expect(r.scene.params.k).toBeCloseTo(200)
    expect(r.scene.params.m).toBeCloseTo(0.5)
  })

  it('竖直圆轨道', () => {
    const r = ok('小球以v0=6m/s的初速度进入竖直圆轨道，轨道半径R=0.4m，求小球能否通过最高点。')
    expect(r.archetype).toBe('loop')
    expect(r.scene.params.v0).toBeCloseTo(6)
  })

  it('识别不了时给提示', () => {
    const r = parseProblem('这是一段没有物理模型的文字，只有一些无关的描述。')
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.hints.length).toBeGreaterThan(0)
    }
  })

  it('滑块：矩形质点（题目假设）', () => {
    const r = ok('倾角为30°的斜面上，质量m=1kg的滑块沿粗糙斜面下滑，动摩擦因数μ=0.2。')
    const b = r.scene.bodies.find((x) => x.id === 'block')!
    expect(b.kind).toBe('particle')
    expect(b.shape.type).toBe('rect')
    expect(r.assumptions.join('')).toContain('滑块')
  })

  it('小球滚下：圆形刚体 + 纯滚动假设', () => {
    const r = ok('倾角为30°的粗糙斜面，质量m=0.5kg的小球从斜面顶端由静止滚下（纯滚动）。')
    expect(r.archetype).toBe('incline')
    expect(r.scene.params.ball).toBe(1)
    expect(r.scene.params.model).toBe(1)
    const b = r.scene.bodies.find((x) => x.id === 'block')!
    expect(b.kind).toBe('rigid')
    expect(b.shape.type).toBe('circle')
    expect(r.assumptions.join('')).toContain('纯滚动')
  })

  it('粗糙圆弧：圆弧摩擦按题目设置', () => {
    const r = ok('倾角为30°的斜面底端接半径R=0.5m的粗糙圆弧，圆弧动摩擦因数μ=0.2，质量m=1kg的滑块从斜面顶端由静止释放。')
    const arc = r.scene.bodies.find((x) => x.id === 'arc')!
    expect(arc.friction).toBeCloseTo(0.2, 5)
    expect(r.assumptions.join('')).toContain('圆弧粗糙')
  })

  it('半圆槽：固定 / 可移动按题目假设', () => {
    const fixed = ok('半圆槽固定在光滑水平面上，质量m=0.2kg的小球从槽口由静止释放。')
    expect(fixed.archetype).toBe('trough')
    expect(fixed.scene.bodies.find((x) => x.id === 'trough')!.kind).toBe('static')
    const movable = ok('半圆槽放在光滑水平面上，质量m=0.2kg的小球从槽口由静止释放。')
    expect(movable.scene.bodies.find((x) => x.id === 'trough')!.kind).toBe('rigid')
    expect(movable.assumptions.join('')).toContain('可移动')
  })

  it('空气阻力：按题目假设决定有无', () => {
    const air = ok('将一小球以v0=20m/s的速度水平抛出，抛出点距地面高度h=20m，考虑空气阻力。')
    expect(air.scene.params.drag).toBe(1)
    const noAir = ok('将一小球以v0=20m/s的速度水平抛出，抛出点距地面高度h=20m，不计空气阻力。')
    expect(noAir.scene.params.drag).toBe(0)
  })
})
