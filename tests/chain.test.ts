import { describe, expect, it } from 'vitest'
import { blankScene } from '../packages/core/src/presets'
import { buildChain, defaultChain } from '../packages/core/src/chain'
import { Simulation } from '../packages/physics/src/simulation'

describe('从空白画布拼链', () => {
  it('默认三阶段：斜面→水平→圆弧，小球能滑到圆弧', () => {
    const scene = blankScene()
    const built = buildChain(defaultChain(), { x: -2, y: 2 }, 'test')
    scene.bodies = [...scene.bodies, ...built.bodies, built.ball]
    scene.contactPairs = built.contactPairs
    scene.observers = []
    const sim = new Simulation(scene)
    for (let i = 0; i < 400; i++) sim.step()
    const b = sim.state.bodies['test-ball']!
    expect(b.x).toBeGreaterThan(1)
    expect(b.y).toBeGreaterThan(0.2)
  })

  it('插入的每段都是可编辑的静态地形 + 一个动态小球', () => {
    const built = buildChain(defaultChain(), { x: 0, y: 2 }, 't')
    expect(built.bodies).toHaveLength(3)
    expect(built.bodies.every((b) => b.kind === 'static')).toBe(true)
    expect(built.ball.kind).toBe('particle')
    expect(built.ball.shape.type).toBe('circle')
  })
})
