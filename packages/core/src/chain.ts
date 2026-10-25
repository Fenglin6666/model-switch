import type { Body, ContactPair, Shape } from './scene'
import type { Vec2 } from './math'

export type ChainStageKind = 'slope' | 'flat' | 'arc' | 'upslope'

export type ChainStage = {
  kind: ChainStageKind
  /** 斜面/上坡角度（度） */
  angle: number
  /** 斜面/水平/上坡长度（模型相对） */
  length: number
  /** 圆弧半径 */
  radius: number
  /** 圆弧圆心角（度），从水平切线起 */
  arcDeg: number
}

export type ChainBuild = {
  bodies: Body[]
  contactPairs: ContactPair[]
  ball: Body
  start: Vec2
  end: Vec2
}

const CHAIN_COLOR = '#8b96a8'
const BALL_COLOR = '#dd5735'

export function defaultChain(): ChainStage[] {
  return [
    { kind: 'slope', angle: 35, length: 3, radius: 1, arcDeg: 60 },
    { kind: 'flat', angle: 0, length: 2, radius: 1, arcDeg: 60 },
    { kind: 'arc', angle: 0, length: 1, radius: 0.9, arcDeg: 60 },
  ]
}

export function stageLabel(stage: ChainStage): string {
  if (stage.kind === 'slope' || stage.kind === 'upslope') return `${stage.kind === 'slope' ? '斜面' : '上坡'} ${stage.angle.toFixed(0)}° / ${stage.length.toFixed(1)} m`
  if (stage.kind === 'flat') return `水平 ${stage.length.toFixed(1)} m`
  return `圆弧 R ${stage.radius.toFixed(1)} / ${stage.arcDeg.toFixed(0)}°`
}

/** 把一串“阶段”拼成地形 + 起点小球；每一段首尾相接。 */
export function buildChain(stages: ChainStage[], start: Vec2, prefix = 'chain'): ChainBuild {
  if (stages.length === 0) throw new Error('chain needs at least one stage')
  const bodies: Body[] = []
  const contactPairs: ContactPair[] = []
  const matIds = new Set<string>()
  let x = start.x
  let y = start.y

  const terrain = (id: string, shape: Shape, label: string, material: string, ox = x, oy = y) => {
    const b: Body = {
      id,
      kind: 'static',
      role: 'terrain',
      shape,
      transform: { x: ox, y: oy, angle: 0 },
      material,
      appearance: { color: CHAIN_COLOR, depth: 0.2 },
      label,
    }
    bodies.push(b)
    if (!matIds.has(material)) {
      matIds.add(material)
      contactPairs.push({ a: 'metal', b: material, mu: 0.02, restitution: 0 })
    }
  }

  stages.forEach((stage, i) => {
    const id = `${prefix}-${i + 1}`
    if (stage.kind === 'slope') {
      const th = (stage.angle * Math.PI) / 180
      const dx = stage.length * Math.cos(th)
      const dy = -stage.length * Math.sin(th)
      terrain(id, { type: 'polyline', points: [{ x: 0, y: 0 }, { x: dx, y: dy }], thick: 0.05 }, '斜面', `${prefix}-slope`)
      x += dx
      y += dy
    } else if (stage.kind === 'upslope') {
      const th = (stage.angle * Math.PI) / 180
      const dx = stage.length * Math.cos(th)
      const dy = stage.length * Math.sin(th)
      terrain(id, { type: 'polyline', points: [{ x: 0, y: 0 }, { x: dx, y: dy }], thick: 0.05 }, '上坡', `${prefix}-upslope`)
      x += dx
      y += dy
    } else if (stage.kind === 'flat') {
      terrain(id, { type: 'polyline', points: [{ x: 0, y: 0 }, { x: stage.length, y: 0 }], thick: 0.05 }, '水平', `${prefix}-flat`)
      x += stage.length
    } else {
      const th = (stage.arcDeg * Math.PI) / 180
      const r = stage.radius
      terrain(id, { type: 'arc', r, a0: -Math.PI / 2, a1: -Math.PI / 2 + th, thick: 0.05 }, '圆弧', `${prefix}-arc`, x, y + r)
      x += r * Math.sin(th)
      y += r * (1 - Math.cos(th))
    }
  })

  // 小球放在第一段起点上方；第一段是斜面时法线跟着倾斜
  const first = stages[0]!
  let nx = 0
  let ny = 1
  if (first.kind === 'slope') {
    const th = (first.angle * Math.PI) / 180
    nx = Math.sin(th)
    ny = Math.cos(th)
  } else if (first.kind === 'upslope') {
    const th = (first.angle * Math.PI) / 180
    nx = -Math.sin(th)
    ny = Math.cos(th)
  }
  const r = 0.11
  const ball: Body = {
    id: `${prefix}-ball`,
    kind: 'particle',
    role: 'object',
    shape: { type: 'circle', r },
    transform: { x: start.x + nx * r, y: start.y + ny * r, angle: 0 },
    material: 'metal',
    mass: 0.5,
    appearance: { color: BALL_COLOR, depth: 0.12 },
    label: '小球',
    fixedRotation: true,
  }

  return { bodies, contactPairs, ball, start, end: { x, y } }
}
