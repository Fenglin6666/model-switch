import { describe, expect, it } from 'vitest'
import { Camera } from '@render/camera'
import { rad } from '@core/math'

describe('Camera 投影往返（架构 §4.2 的硬要求）', () => {
  const views: Array<{ name: string; plane: 'vertical' | 'horizontal'; eps: number; phi: number }> = [
    { name: '侧视', plane: 'vertical', eps: 0, phi: 0 },
    { name: '斜视', plane: 'vertical', eps: rad(25), phi: rad(-10) },
    { name: '俯视', plane: 'horizontal', eps: rad(90), phi: 0 },
    { name: '水平斜视', plane: 'horizontal', eps: rad(55), phi: rad(20) },
    { name: '竖直负角', plane: 'vertical', eps: rad(-10), phi: rad(30) },
  ]

  for (const v of views) {
    it(`${v.name}：屏幕 → 平面 → 屏幕`, () => {
      const cam = new Camera()
      cam.setViewport(1200, 800)
      cam.plane = v.plane
      cam.elevation = v.eps
      cam.azimuth = v.phi
      cam.scale = 137
      cam.center = { x: 1.3, y: -0.7 }
      cam.zoom = 1.4
      cam.pan = { x: 33, y: -21 }
      cam.update()

      let maxErr = 0
      for (let i = 0; i < 40; i++) {
        const p = { x: -4 + (i * 0.37) % 8, y: -3 + (i * 0.71) % 6 }
        const s = cam.project(p, 0)
        const back = cam.unproject(s.x, s.y)
        maxErr = Math.max(maxErr, Math.abs(back.x - p.x), Math.abs(back.y - p.y))
      }
      expect(maxErr).toBeLessThan(1e-9)
    })

    it(`${v.name}：平面 → 屏幕 → 平面`, () => {
      const cam = new Camera()
      cam.setViewport(900, 600)
      cam.plane = v.plane
      cam.elevation = v.eps
      cam.azimuth = v.phi
      cam.scale = 100
      cam.update()
      let maxErr = 0
      for (let i = 0; i < 40; i++) {
        const sx = 10 + i * 21
        const sy = 15 + ((i * 37) % 560)
        const p = cam.unproject(sx, sy)
        const s = cam.project(p, 0)
        maxErr = Math.max(maxErr, Math.abs(s.x - sx), Math.abs(s.y - sy))
      }
      expect(maxErr).toBeLessThan(1e-8)
    })
  }

  it('竖直面：拖 100px 永远走同样的距离（线性逆映射）', () => {
    const cam = new Camera()
    cam.setViewport(1000, 700)
    cam.plane = 'vertical'
    cam.elevation = rad(25)
    cam.azimuth = rad(-10)
    cam.scale = 100
    cam.update()
    const a = cam.unproject(300, 400)
    const b = cam.unproject(400, 400)
    const c = cam.unproject(500, 400)
    expect(Math.abs(b.x - a.x) - Math.abs(c.x - b.x)).toBeLessThan(1e-9)
  })

  it('深度排序：挤出方向背离相机，越高越靠近相机', () => {
    const cam = new Camera()
    cam.setViewport(800, 600)
    cam.plane = 'vertical'
    cam.elevation = rad(25)
    cam.azimuth = rad(-10)
    cam.scale = 100
    cam.update()
    expect(cam.depthOf({ x: 0, y: 0 }, 0.2)).toBeGreaterThan(cam.depthOf({ x: 0, y: 0 }, 0))
    expect(cam.depthOf({ x: 0, y: 1 }, 0)).toBeLessThan(cam.depthOf({ x: 0, y: 0 }, 0))
  })

  it('竖直面：z 向上（不能上下颠倒）', () => {
    const cam = new Camera()
    cam.setViewport(800, 600)
    cam.plane = 'vertical'
    cam.elevation = rad(25)
    cam.azimuth = 0
    cam.scale = 100
    cam.center = { x: 0, y: 0 }
    cam.update()
    const low = cam.project({ x: 0, y: 0 }, 0)
    const high = cam.project({ x: 0, y: 1 }, 0)
    expect(high.y).toBeLessThan(low.y)
  })
})
