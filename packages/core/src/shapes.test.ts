import { describe, expect, it } from 'vitest'
import { toPhysicsFixtures, renderGeometries, pointInShape, shapeArea, triangulate, isFullCircle } from './shapes'
import type { Shape } from './scene'
import { polygonArea } from './math'

describe('形状双表示', () => {
  it('圆 → 1 个 circle fixture；矩形 → 1 个 polygon', () => {
    expect(toPhysicsFixtures({ type: 'circle', r: 0.2 })).toEqual([
      { kind: 'circle', radius: 0.2, center: { x: 0, y: 0 } },
    ])
    const rect = toPhysicsFixtures({ type: 'rect', w: 1, h: 0.5 })
    expect(rect).toHaveLength(1)
    expect(rect[0]!.kind).toBe('polygon')
  })

  it('凸多边形一次成型，凹多边形三角化后面积不变', () => {
    const convex: Shape = {
      type: 'polygon',
      points: [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 1, y: 1 },
        { x: 0, y: 1 },
      ],
    }
    expect(toPhysicsFixtures(convex)).toHaveLength(1)

    const concave: Shape = {
      type: 'polygon',
      points: [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 1, y: 1 },
        { x: 0.5, y: 0.35 },
        { x: 0, y: 1 },
      ],
    }
    const parts = toPhysicsFixtures(concave)
    expect(parts.length).toBeGreaterThan(1)
    const total = parts.reduce((s, p) => (p.kind === 'polygon' ? s + Math.abs(polygonArea(p.vertices)) : s), 0)
    expect(Math.abs(total - Math.abs(polygonArea((concave as Extract<Shape, { type: 'polygon' }>).points)))).toBeLessThan(1e-9)
    expect(triangulate((concave as Extract<Shape, { type: 'polygon' }>).points).length).toBe(3)
  })

  it('圆弧 → 1 条 chain，整圆是 loop', () => {
    const half = toPhysicsFixtures({ type: 'arc', r: 0.9, a0: Math.PI, a1: Math.PI * 2, thick: 0.08 })
    expect(half).toHaveLength(1)
    expect(half[0]!.kind).toBe('chain')
    expect((half[0] as Extract<typeof half[0], { kind: 'chain' }>).loop).toBe(false)
    const full = toPhysicsFixtures({ type: 'arc', r: 0.6, a0: 0, a1: Math.PI * 2, thick: 0.06 })
    expect((full[0] as Extract<typeof full[0], { kind: 'chain' }>).loop).toBe(true)
    expect(isFullCircle(0, Math.PI * 2)).toBe(true)
  })

  it('描边形状的渲染几何是 stroke；填充是高精度采样多边形', () => {
    const arc = renderGeometries({ type: 'arc', r: 1, a0: 0, a1: Math.PI, thick: 0.1 }, 'teach')
    expect(arc[0]!.kind).toBe('stroke')
    const circle = renderGeometries({ type: 'circle', r: 0.3 }, 'verify')
    expect(circle[0]!.kind).toBe('fill')
    const teach = renderGeometries({ type: 'circle', r: 0.3 }, 'teach')
    const v = (circle[0] as Extract<(typeof circle)[0], { kind: 'fill' }>).outlines[0]!.length
    const t = (teach[0] as Extract<(typeof teach)[0], { kind: 'fill' }>).outlines[0]!.length
    expect(v).toBeGreaterThan(t)
  })

  it('compound 会展开，命中测试能命中任一部分', () => {
    const shape: Shape = {
      type: 'compound',
      parts: [
        { type: 'rect', w: 2, h: 0.1 },
        { type: 'polygon', points: [{ x: -1, y: -1 }, { x: 1, y: -1 }, { x: 1, y: -0.9 }, { x: -1, y: -0.9 }] },
      ],
    }
    expect(renderGeometries(shape, 'teach')).toHaveLength(2)
    expect(pointInShape(shape, { x: 0, y: 0 })).toBe(true)
    expect(pointInShape(shape, { x: 0, y: -0.95 })).toBe(true)
    expect(pointInShape(shape, { x: 0, y: 5 })).toBe(false)
  })

  it('面积用于缺省质量', () => {
    expect(shapeArea({ type: 'rect', w: 2, h: 0.5 })).toBeCloseTo(1, 9)
    expect(shapeArea({ type: 'circle', r: 1 })).toBeCloseTo(Math.PI, 9)
  })
})
