import { describe, expect, it } from 'vitest'
import { applySnap, findSnap } from './snap'
import type { Body, Scene } from './scene'
import { emptyScene } from './scene'

function sceneWith(...bodies: Body[]): Scene {
  const s = emptyScene('snap-test')
  s.bodies = bodies
  return s
}

function body(partial: Partial<Body> & Pick<Body, 'id' | 'shape' | 'transform'>): Body {
  return {
    kind: 'static',
    material: 'stone',
    appearance: { color: '#999999', depth: 0.2 },
    ...partial,
  }
}

describe('组件吸附', () => {
  it('球落到水平面上：球心抬高一个半径', () => {
    const floor = body({ id: 'floor', shape: { type: 'rect', w: 4, h: 0.2 }, transform: { x: 0, y: 0, angle: 0 } })
    const ball = body({
      id: 'ball',
      kind: 'particle',
      shape: { type: 'circle', r: 0.1 },
      transform: { x: 0.5, y: 0.5, angle: 0 },
    })
    const scene = sceneWith(floor, ball)
    const hit = findSnap(scene, ball, { x: 0.5, y: 0.45 }, { threshold: 0.5 })
    expect(hit).not.toBeNull()
    const snapped = applySnap(ball, hit!)
    expect(snapped.transform.y).toBeCloseTo(0.2, 5)
    expect(snapped.transform.x).toBeCloseTo(0.5, 5)
  })

  it('滑块放到斜面上：角度对齐斜面', () => {
    const angle = -0.5
    const ramp = body({ id: 'ramp', shape: { type: 'rect', w: 3, h: 0.2 }, transform: { x: 0, y: 0, angle } })
    const block = body({
      id: 'block',
      kind: 'rigid',
      shape: { type: 'rect', w: 0.4, h: 0.3 },
      transform: { x: 0, y: 0.6, angle: 0 },
    })
    const scene = sceneWith(ramp, block)
    const hit = findSnap(scene, block, { x: 0.2, y: 0.55 }, { threshold: 0.5 })
    expect(hit).not.toBeNull()
    const snapped = applySnap(block, hit!)
    expect(snapped.transform.angle).toBeCloseTo(angle, 4)
    // 方块底面应该贴在斜面上：中心到斜面线的距离 = h/2
    const nx = Math.sin(-angle)
    const ny = Math.cos(-angle)
    const dist = snapped.transform.x * nx + snapped.transform.y * ny
    expect(Math.abs(dist - 0.25)).toBeLessThan(0.03)
  })

  it('球落进半圆槽：贴到内壁', () => {
    const arc = body({
      id: 'trough',
      shape: { type: 'arc', r: 1, a0: Math.PI, a1: Math.PI * 2, thick: 0.06 },
      transform: { x: 0, y: 0, angle: 0 },
    })
    const ball = body({
      id: 'ball',
      kind: 'particle',
      shape: { type: 'circle', r: 0.1 },
      transform: { x: 0, y: 0, angle: 0 },
    })
    const scene = sceneWith(arc, ball)
    const hit = findSnap(scene, ball, { x: 0, y: -0.4 }, { threshold: 0.8 })
    expect(hit).not.toBeNull()
    const snapped = applySnap(ball, hit!)
    expect(snapped.transform.x).toBeCloseTo(0, 1)
    expect(snapped.transform.y).toBeCloseTo(-0.9, 1)
  })

  it('离得远就不吸', () => {
    const floor = body({ id: 'floor', shape: { type: 'rect', w: 4, h: 0.2 }, transform: { x: 0, y: 0, angle: 0 } })
    const ball = body({
      id: 'ball',
      kind: 'particle',
      shape: { type: 'circle', r: 0.1 },
      transform: { x: 0, y: 3, angle: 0 },
    })
    const scene = sceneWith(floor, ball)
    expect(findSnap(scene, ball, { x: 0, y: 3 }, { threshold: 0.3 })).toBeNull()
  })
})
