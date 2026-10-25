import { describe, expect, it } from 'vitest'
import { FIELD_B, FIELD_E, bodyFromRecognized, fieldDraftFromDrag, scaleShape } from '@ui/editor/drawing'

const at = (x: number, y: number) => ({ x, y })

describe('电场 / 磁场：拖一块区域', () => {
  it('拖出矩形 → 场长在这块区域里，中心是矩形中心', () => {
    const d = fieldDraftFromDrag('E', at(-1, 0.5), at(1, 2.5))
    expect(d.region).toMatchObject({ w: 2, h: 2, x: 0, y: 1.5, label: 'E 区' })
    expect(d.field.type).toBe('E')
    // 默认方向向下
    expect(d.field.type === 'E' && d.field.vector).toEqual({ x: 0, y: -FIELD_E })
  })

  it('反向拖（右下 → 左上）也是同一块区域', () => {
    const d = fieldDraftFromDrag('B', at(1, 2.5), at(-1, 0.5))
    expect(d.region).toMatchObject({ w: 2, h: 2, x: 0, y: 1.5 })
  })

  it('磁场默认向外，区域标签是 B 区', () => {
    const d = fieldDraftFromDrag('B', at(0, 0), at(1, 1))
    expect(d.field).toEqual({ type: 'B', bz: FIELD_B })
    expect(d.region?.label).toBe('B 区')
  })

  it('拖得太小 = 点了一下 → 全场（没有区域）', () => {
    expect(fieldDraftFromDrag('E', at(0, 0), at(0.1, 0.1)).region).toBeNull()
    expect(fieldDraftFromDrag('B', at(0, 0), at(0.5, 0.2)).region).toBeNull()
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
