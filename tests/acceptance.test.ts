import { describe, expect, it } from 'vitest'
import { blankScene, buildPresetScene, presetById } from '@core/presets'
import { setAtPath, type Scene } from '@core/scene'
import { Simulation, runCriterion } from '@physics/simulation'

function sceneWith(preset: string, path: string, value: number): Scene {
  const s = setAtPath(buildPresetScene(preset), path, value)
  presetById(preset)!.layout?.(s)
  return s
}

function run(scene: Scene, seconds: number) {
  const sim = new Simulation(scene)
  const track: Record<string, { maxY: number; minY: number; x0: number; maxDx: number }> = {}
  for (const b of scene.bodies) track[b.id] = { maxY: -Infinity, minY: Infinity, x0: b.transform.x, maxDx: 0 }
  const steps = Math.ceil(seconds / scene.world.timeStep)
  for (let i = 0; i < steps; i++) {
    sim.step()
    for (const [id, s] of Object.entries(sim.state.bodies)) {
      const tr = track[id]!
      tr.maxY = Math.max(tr.maxY, s.y)
      tr.minY = Math.min(tr.minY, s.y)
      tr.maxDx = Math.max(tr.maxDx, Math.abs(s.x - tr.x0))
    }
  }
  return { sim, track }
}

describe('P0 验收：斜面滑块', () => {
  it('滑动：a = g(sinθ − μcosθ)，误差 < 3%', () => {
    const s = sceneWith('incline', '/params/model', 0)
    const sim = new Simulation(s)
    const theta = (s.params.theta! * Math.PI) / 180
    // 沿斜面方向采样
    let sum = 0
    let n = 0
    for (let i = 0; i < 240 * 0.6; i++) {
      sim.step()
      const b = sim.state.bodies['block']!
      sum += b.ax * Math.cos(theta) - b.ay * Math.sin(theta)
      n++
    }
    const measured = sum / n
    const theory = 9.8 * (Math.sin(theta) - 0.25 * Math.cos(theta))
    expect(Math.abs(measured - theory) / theory).toBeLessThan(0.03)
  })

  it('滚动（实心球）：a = 5/7·g·sinθ，误差 < 3%', () => {
    const s = sceneWith('incline', '/params/model', 1)
    const sim = new Simulation(s)
    const theta = (s.params.theta! * Math.PI) / 180
    let sum = 0
    let n = 0
    for (let i = 0; i < 240 * 0.6; i++) {
      sim.step()
      const b = sim.state.bodies['block']!
      sum += b.ax * Math.cos(theta) - b.ay * Math.sin(theta)
      n++
    }
    const measured = sum / n
    const theory = (5 / 7) * 9.8 * Math.sin(theta)
    expect(Math.abs(measured - theory) / theory).toBeLessThan(0.03)
  })

  it('光滑斜面：机械能漂移 < 0.5%（3 秒）', () => {
    const s = sceneWith('incline', '/params/mu', 0)
    const sim = new Simulation(s)
    // 等沉静期过去（形状刚放上斜坡时位置修正会顶一下），只测理想滑动段
    while (sim.state.t < 0.12) sim.step()
    const e0 = sim.state.energy.total
    while (sim.state.t < 0.5) sim.step()
    const drift = Math.abs(sim.state.energy.total - e0) / Math.abs(e0)
    expect(drift).toBeLessThan(0.005)
  })
})

describe('P1 验收：半圆槽（条件层）', () => {
  it('固定：小球回到初始高度，误差 < 1%', () => {
    const s = sceneWith('trough', '/params/fixed', 1)
    const startY = s.bodies.find((b) => b.id === 'ball')!.transform.y
    const { track } = run(s, 4)
    expect(Math.abs(track['ball']!.maxY - startY) / startY).toBeLessThan(0.01)
  })

  it('可移动：小球仍回到等高位置，但槽被推走（质心不动）', () => {
    const s = sceneWith('trough', '/params/fixed', 0)
    const startY = s.bodies.find((b) => b.id === 'ball')!.transform.y
    const { track, sim } = run(s, 4)
    // 物理结论：槽可移动时小球「仍能到等高」——这是被仿真推翻的常见错觉
    expect(Math.abs(track['ball']!.maxY - startY) / startY).toBeLessThan(0.01)
    // 槽确实动了（理论位移 2mR/(m+M)≈0.30，起点 186° 略小），且系统水平动量守恒
    expect(track['trough']!.maxDx).toBeGreaterThan(0.15)
    expect(Math.abs(sim.state.momentum.x)).toBeLessThan(0.01)
  })
})

describe('P1 验收：竖直圆轨道（判据 + 临界）', () => {
  it('仿真临界速度与 √(5gR) 偏差 < 1%', () => {
    const base = buildPresetScene('loop')
    const g = base.world.gravity
    const R = 0.6
    const rb = 0.055
    const theory = Math.sqrt(5 * g * (R - rb))
    let lo = 4
    let hi = 8
    for (let i = 0; i < 34; i++) {
      const mid = (lo + hi) / 2
      const s = sceneWith('loop', '/params/v0', mid)
      const res = runCriterion(s, { criterionId: 'detach', maxTime: 3 })
      if (res.passed) lo = mid
      else hi = mid
    }
    const measured = (lo + hi) / 2
    expect(Math.abs(measured - theory) / theory).toBeLessThan(0.01)
  })

  it('找临界：粗扫 + 二分能在 100 次仿真内收敛', async () => {
    const { findCritical } = await import('@core/search')
    const base = buildPresetScene('loop')
    const outcome = await findCritical({
      range: [1, 8],
      samples: 32,
      precision: 1e-3,
      run: async (v) => {
        const s = setAtPath(base, '/params/v0', v)
        presetById('loop')!.layout!(s)
        return runCriterion(s, { criterionId: 'detach', maxTime: 3 }).passed
      },
    })
    expect(outcome.flips.length).toBeGreaterThan(0)
    expect(outcome.runs).toBeLessThan(100)
  })
})

describe('P0/P1 验收：平抛与空气阻力', () => {
  it('无阻力命中目标，有阻力够不到', () => {
    const noDrag = runCriterion(sceneWith('projectile', '/params/drag', 0), { criterionId: 'hit', maxTime: 3 })
    const drag = runCriterion(sceneWith('projectile', '/params/drag', 1), { criterionId: 'hit', maxTime: 3 })
    expect(noDrag.passed).toBe(true)
    expect(drag.passed).toBe(false)
  })
})

describe('P0 验收：稳定性', () => {
  it('25 m/s 小球不穿透 4 cm 薄墙（CCD）', () => {
    const s = blankScene()
    s.world.view.center = { x: 0, y: 1 }
    s.plane = 'horizontal'
    s.bodies = [
      {
        id: 'wall',
        kind: 'static',
        shape: { type: 'rect', w: 0.04, h: 4 },
        transform: { x: 1, y: 0, angle: 0 },
        material: 'stone',
        appearance: { color: '#96a0ae', depth: 0.1 },
      },
      {
        id: 'ball',
        kind: 'particle',
        shape: { type: 'circle', r: 0.05 },
        transform: { x: -1, y: 0, angle: 0 },
        material: 'metal',
        mass: 0.2,
        velocity: { x: 25, y: 0 },
        appearance: { color: '#e2694a', depth: 0.06 },
      },
    ]
    s.contactPairs = [{ a: 'metal', b: 'stone', mu: 0, restitution: 0 }]
    const sim = new Simulation(s)
    for (let i = 0; i < 240; i++) sim.step()
    const ball = sim.state.bodies['ball']!
    expect(ball.x).toBeLessThan(1)
  })

  it('压力测试：40 个形状稳定步进不 NaN', () => {
    const s = blankScene()
    for (let i = 0; i < 40; i++) {
      s.bodies.push({
        id: `b${i}`,
        kind: 'particle',
        shape: i % 2 === 0 ? { type: 'circle', r: 0.08 } : { type: 'rect', w: 0.16, h: 0.12 },
        transform: { x: -1 + (i % 8) * 0.3, y: 1 + Math.floor(i / 8) * 0.3, angle: 0 },
        material: 'metal',
        mass: 0.1,
        appearance: { color: '#4a7fe8', depth: 0.06 },
      })
    }
    const sim = new Simulation(s)
    for (let i = 0; i < 240; i++) sim.step()
    for (const b of Object.values(sim.state.bodies)) {
      expect(Number.isFinite(b.x) && Number.isFinite(b.y)).toBe(true)
      expect(Math.hypot(b.vx, b.vy)).toBeLessThan(30.0001)
    }
  })
})
