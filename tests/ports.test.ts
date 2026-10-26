/**
 * 端口：物体上的「接点」。
 *
 * 借 Modelica 的 connector 思路——约束连的是「端口」，不是裸坐标。
 * 这一层的价值全在「不用算坐标」和「接错了能查出来」，所以测试也盯这两点。
 */
import { describe, expect, it } from 'vitest'
import { emptyScene, type Body } from '../packages/core/src/scene'
import {
  DERIVED_PORT_IDS,
  anchorLocal,
  bodyPorts,
  derivedPorts,
  findPort,
  resolvePort,
  resolvePortRef,
  semanticPort,
} from '../packages/core/src/ports'

const body = (over: Partial<Body> = {}): Body => ({
  id: 'b',
  kind: 'particle',
  shape: { type: 'circle', r: 0.5 },
  transform: { x: 1, y: 2, angle: 0 },
  material: 'metal',
  appearance: { color: '#fff', depth: 0.1 },
  ...over,
})

describe('几何派生端口', () => {
  it('圆：中心和四条边中点，top 在半径处', () => {
    const ports = derivedPorts(body())
    const ids = ports.map((p) => p.id)
    expect(ids).toEqual(expect.arrayContaining(['center', 'top', 'bottom', 'left', 'right']))
    expect(findPort(body(), 'top')!.local.y).toBeCloseTo(0.5, 5)
    expect(findPort(body(), 'left')!.local.x).toBeCloseTo(-0.5, 5)
  })

  it('矩形：四角 + 四边，坐标来自包围盒', () => {
    const b = body({ shape: { type: 'rect', w: 2, h: 1 } })
    expect(findPort(b, 'top')!.local).toEqual({ x: 0, y: 0.5 })
    expect(findPort(b, 'right')!.local).toEqual({ x: 1, y: 0 })
    expect(findPort(b, 'tl')!.local).toEqual({ x: -1, y: 0.5 })
    expect(findPort(b, 'br')!.local).toEqual({ x: 1, y: -0.5 })
  })

  it('所有物体都有同一套派生 id，agent 可以直接引用', () => {
    for (const shape of [
      { type: 'circle', r: 0.3 },
      { type: 'rect', w: 1, h: 0.4 },
      { type: 'polygon', points: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }] },
      { type: 'polyline', points: [{ x: 0, y: 0 }, { x: 1, y: 0 }], thick: 0.05 },
    ] as const) {
      const ids = derivedPorts(body({ shape })).map((p) => p.id)
      for (const want of ['center', 'top', 'bottom', 'left', 'right']) expect(ids).toContain(want)
    }
  })

  it('退化形状只给中心，不派生一堆重合点', () => {
    const ports = derivedPorts(body({ shape: { type: 'rect', w: 0, h: 0 } }))
    expect(ports.map((p) => p.id)).toEqual(['center'])
  })

  it('派生端口是固定的一组（别随便改名，agent 的提示词里写着）', () => {
    expect(DERIVED_PORT_IDS).toEqual(['center', 'top', 'bottom', 'left', 'right', 'tl', 'tr', 'bl', 'br'])
  })
})

describe('语义端口', () => {
  it('声明后和派生端口合并，同 id 时声明优先', () => {
    const b = body({ ports: [semanticPort('shaft', 'axle', body(), 'center', '转轴')] })
    const ids = bodyPorts(b).map((p) => p.id)
    expect(ids).toContain('shaft')
    expect(ids).toContain('top')

    const override = body({
      shape: { type: 'rect', w: 2, h: 1 },
      ports: [semanticPort('top', 'hook', body({ shape: { type: 'rect', w: 2, h: 1 } }), { x: 0.2, y: 0.9 })],
    })
    expect(findPort(override, 'top')!.local).toEqual({ x: 0.2, y: 0.9 })
  })

  it('可以用派生端口名定位，不用再算一遍坐标', () => {
    const b = body()
    const p = semanticPort('hook', 'hook', b, 'top')
    expect(p.local.y).toBeCloseTo(0.5, 5)
  })
})

describe('解析到世界坐标', () => {
  it('未旋转：局部点 + 平移', () => {
    const s = emptyScene()
    s.bodies = [body()]
    const r = resolvePort(s, 'b', 'top')!
    expect(r.point).toEqual({ x: 1, y: 2.5 })
    expect(r.normal).toEqual({ x: 0, y: 1 })
  })

  it('旋转 90°：top 转到左边', () => {
    const s = emptyScene()
    s.bodies = [body({ transform: { x: 0, y: 0, angle: Math.PI / 2 } })]
    const r = resolvePort(s, 'b', 'top')!
    expect(r.point.x).toBeCloseTo(-0.5, 5)
    expect(r.point.y).toBeCloseTo(0, 5)
    expect(r.normal!.x).toBeCloseTo(-1, 5)
  })

  it('端口不存在返回 null（交给校验层报错，不在这里猜）', () => {
    const s = emptyScene()
    s.bodies = [body()]
    expect(resolvePort(s, 'b', 'shaft')).toBeNull()
    expect(resolvePort(s, 'nope', 'top')).toBeNull()
  })

  it('三种引用写法都能解析：端口 / 局部坐标 / 世界点', () => {
    const s = emptyScene()
    s.bodies = [body()]
    expect(resolvePortRef(s, { bodyId: 'b', port: 'top' })!.point).toEqual({ x: 1, y: 2.5 })
    expect(resolvePortRef(s, { bodyId: 'b', local: { x: 0, y: 0 } })!.point).toEqual({ x: 1, y: 2 })
    expect(resolvePortRef(s, { world: { x: 9, y: 9 } })!.point).toEqual({ x: 9, y: 9 })
    expect(resolvePortRef(s, { bodyId: 'b', port: 'shaft' })).toBeNull()
  })

  it('anchorLocal 只给局部坐标（渲染/监视器各有自己的 transform 来源）', () => {
    const s = emptyScene()
    s.bodies = [body()]
    expect(anchorLocal(s, { bodyId: 'b', port: 'top' })).toEqual({ x: 0, y: 0.5 })
    expect(anchorLocal(s, { bodyId: 'b', local: { x: 3, y: 4 } })).toEqual({ x: 3, y: 4 })
    expect(anchorLocal(s, { bodyId: 'b', port: 'shaft' })).toBeNull()
  })
})
