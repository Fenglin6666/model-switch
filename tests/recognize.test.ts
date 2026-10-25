import { describe, expect, it } from 'vitest'
import { recognizeStroke, describeRecognized } from '@core/recognize'
import type { Vec2 } from '@core/math'

/** 把一条闭合折线按顺序采样成手绘轨迹（加一点抖动，模拟画得不规整） */
function sample(vertices: Vec2[], perEdge = 12, jitter = 0.004): Vec2[] {
  const out: Vec2[] = []
  for (let i = 0; i < vertices.length; i++) {
    const a = vertices[i]!
    const b = vertices[(i + 1) % vertices.length]!
    for (let k = 0; k < perEdge; k++) {
      const t = k / perEdge
      out.push({
        x: a.x + (b.x - a.x) * t + (Math.random() - 0.5) * jitter,
        y: a.y + (b.y - a.y) * t + (Math.random() - 0.5) * jitter,
      })
    }
  }
  out.push({ ...out[0]! })
  return out
}

function circleStroke(r = 0.5, n = 48, jitter = 0.01): Vec2[] {
  const out: Vec2[] = []
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI * 2
    out.push({ x: Math.cos(a) * r + (Math.random() - 0.5) * jitter, y: Math.sin(a) * r + (Math.random() - 0.5) * jitter })
  }
  return out
}

describe('手绘识别：画得不规整，自动规整', () => {
  it('圆圈 → 圆（半径取平均，圆心在质心）', () => {
    const r = recognizeStroke(circleStroke(0.6))
    expect(r?.kind).toBe('circle')
    if (r?.kind === 'circle') {
      expect(Math.abs(r.r - 0.6)).toBeLessThan(0.03)
      expect(Math.hypot(r.center.x, r.center.y)).toBeLessThan(0.03)
    }
  })

  it('四边形 → 轴对齐矩形（丢掉画歪的角度）', () => {
    const r = recognizeStroke(sample([{ x: -0.6, y: -0.35 }, { x: 0.6, y: -0.35 }, { x: 0.6, y: 0.35 }, { x: -0.6, y: 0.35 }]))
    expect(r?.kind).toBe('rect')
    if (r?.kind === 'rect') {
      expect(Math.abs(r.w - 1.2)).toBeLessThan(0.08)
      expect(Math.abs(r.h - 0.7)).toBeLessThan(0.08)
    }
  })

  it('三角形 → 多边形（不会被当成矩形）', () => {
    const r = recognizeStroke(sample([{ x: -0.6, y: -0.4 }, { x: 0.6, y: -0.4 }, { x: 0.1, y: 0.55 }]))
    expect(r?.kind).toBe('polygon')
    if (r?.kind === 'polygon') expect(r.points.length).toBeGreaterThanOrEqual(3)
  })

  it('一条斜线 → 直线（只留两端点）', () => {
    const r = recognizeStroke([
      { x: -0.8, y: -0.5 },
      { x: -0.3, y: -0.2 },
      { x: 0.2, y: 0.1 },
      { x: 0.8, y: 0.45 },
    ])
    expect(r?.kind).toBe('line')
  })

  it('一段弧 → 折线（不硬套成圆）', () => {
    const pts: Vec2[] = []
    for (let i = 0; i <= 24; i++) {
      const a = Math.PI * 0.15 + (i / 24) * Math.PI * 0.7
      pts.push({ x: Math.cos(a) * 0.7, y: Math.sin(a) * 0.7 })
    }
    const r = recognizeStroke(pts)
    expect(r?.kind).toBe('polyline')
    if (r?.kind === 'polyline') expect(r.points.length).toBeGreaterThan(2)
  })

  it('点一下（太小）不产生任何形状', () => {
    expect(recognizeStroke([{ x: 0, y: 0 }, { x: 0.02, y: 0.01 }])).toBeNull()
  })

  it('识别结果有中文说明', () => {
    expect(describeRecognized({ kind: 'circle', center: { x: 0, y: 0 }, r: 1 })).toBe('圆')
    expect(describeRecognized({ kind: 'line', a: { x: 0, y: 0 }, b: { x: 1, y: 1 } })).toBe('直线')
  })
})
