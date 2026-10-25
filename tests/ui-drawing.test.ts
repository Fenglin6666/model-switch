import { describe, expect, it } from 'vitest'
import {
  FIELD_B,
  FIELD_E,
  bodyFromRecognized,
  classifyFieldGesture,
  fieldFromGesture,
  scaleShape,
  segmentsCross,
} from '@ui/editor/drawing'

const at = (x: number, y: number) => ({ x, y })

describe('场笔手势（纯函数）', () => {
  const prev = { a: at(-0.2, -0.2), b: at(0.2, 0.2), t: 1000 }

  it('点一下 = 磁场向外；长线 = 电场；短线 = 等第二笔', () => {
    expect(classifyFieldGesture({ start: at(0, 0), current: at(0.05, 0.05), prev: null, now: 2000 })).toBe('dot')
    expect(classifyFieldGesture({ start: at(0, 0), current: at(0, -1.2), prev: null, now: 2000 })).toBe('arrow')
    expect(classifyFieldGesture({ start: at(-0.25, 0.25), current: at(0.25, -0.25), prev: null, now: 2000 })).toBe('pending')
  })

  it('两笔交叉且在 1.4 秒内 = ×（向里）', () => {
    expect(classifyFieldGesture({ start: at(0.2, -0.2), current: at(-0.2, 0.2), prev, now: 1500 })).toBe('cross')
    // 超时就不算
    expect(classifyFieldGesture({ start: at(0.2, -0.2), current: at(-0.2, 0.2), prev, now: 3000 })).toBe('pending')
    // 离得远、不交叉
    expect(classifyFieldGesture({ start: at(0.6, -0.2), current: at(0.6, 0.2), prev, now: 1500 })).toBe('pending')
  })

  it('手势落成场：方向、正负都对', () => {
    const arrow = fieldFromGesture('arrow', at(0, 2), at(0, 1))
    expect(arrow.type).toBe('E')
    expect(arrow.vector).toEqual({ x: 0, y: -FIELD_E })
    expect(fieldFromGesture('dot', at(0, 0), at(0, 0)).bz).toBe(FIELD_B)
    expect(fieldFromGesture('cross', at(0, 0), at(0, 0)).bz).toBe(-FIELD_B)
  })

  it('线段相交判定', () => {
    expect(segmentsCross(at(-1, -1), at(1, 1), at(1, -1), at(-1, 1))).toBe(true)
    expect(segmentsCross(at(-1, -1), at(1, -1), at(-1, 1), at(1, 1))).toBe(false)
    expect(segmentsCross(at(-1, 0), at(1, 0), at(2, -1), at(2, 1))).toBe(false)
  })
})

describe('识别结果 → 物体', () => {
  it('圆 → 球（可动、质点）', () => {
    const b = bodyFromRecognized({ kind: 'circle', center: at(1, 2), r: 0.3 }, 'b1')
    expect(b.kind).toBe('particle')
    expect(b.role).toBe('object')
    expect(b.shape).toEqual({ type: 'circle', r: 0.3 })
    expect(b.transform.x).toBe(1)
    expect(b.label).toBe('球')
  })

  it('矩形 → 地形（固定）', () => {
    const b = bodyFromRecognized({ kind: 'rect', center: at(0, 1), w: 1.2, h: 0.6 }, 'b2')
    expect(b.kind).toBe('static')
    expect(b.shape).toEqual({ type: 'rect', w: 1.2, h: 0.6 })
    expect(b.label).toBe('方块')
  })

  it('直线 → 细线地形，两端点相对中心', () => {
    const b = bodyFromRecognized({ kind: 'line', a: at(0, 0), b: at(2, 1) }, 'b3')
    expect(b.appearance.style).toBe('thin')
    expect(b.transform).toMatchObject({ x: 1, y: 0.5 })
    expect(b.shape).toEqual({ type: 'polyline', thick: 0.05, points: [{ x: -1, y: -0.5 }, { x: 1, y: 0.5 }] })
  })

  it('多边形保留顶点、折线保持细线', () => {
    const poly = bodyFromRecognized({ kind: 'polygon', points: [at(0, 0), at(1, 0), at(0, 1)] }, 'b4')
    expect(poly.shape.type).toBe('polygon')
    const line = bodyFromRecognized({ kind: 'polyline', points: [at(0, 0), at(1, 1), at(2, 0)] }, 'b5')
    expect(line.appearance.style).toBe('thin')
  })

  it('太小/太薄的形状有下限，不会生成零尺寸', () => {
    const b = bodyFromRecognized({ kind: 'circle', center: at(0, 0), r: 0.001 }, 'b6')
    expect(b.shape.type === 'circle' && b.shape.r).toBe(0.04)
  })
})

describe('缩放手柄', () => {
  it('圆 / 矩形 / 折线按比例缩放，厚度不变', () => {
    expect(scaleShape({ type: 'circle', r: 0.5 }, 2)).toEqual({ type: 'circle', r: 1 })
    expect(scaleShape({ type: 'rect', w: 1, h: 0.5 }, 0.5)).toEqual({ type: 'rect', w: 0.5, h: 0.25 })
    const line = scaleShape({ type: 'polyline', points: [at(1, 1), at(2, 2)], thick: 0.05 }, 3)
    expect(line).toEqual({ type: 'polyline', points: [at(3, 3), at(6, 6)], thick: 0.05 })
  })

  it('复合体逐部分缩放', () => {
    const s = scaleShape({ type: 'compound', parts: [{ type: 'circle', r: 0.2 }, { type: 'rect', w: 1, h: 1 }] }, 2)
    expect(s.type).toBe('compound')
    if (s.type === 'compound') {
      expect(s.parts[0]).toEqual({ type: 'circle', r: 0.4 })
      expect(s.parts[1]).toEqual({ type: 'rect', w: 2, h: 2 })
    }
  })
})
