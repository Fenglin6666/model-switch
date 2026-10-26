/**
 * 四个预置场景 = v1 的产品内容。
 *
 * 每个场景先按题目假设定下模型（滑块/小球、光滑/粗糙、固定/可移动），
 * 不做 A/B 对照；学生要比较时，直接改一个条件再看结果。
 *
 * 约定：`layout` 是确定性的「参数 → 几何」展开，只在重置/改参数时调用，
 * 不参与物理循环，也不回写渲染层。
 */
import type { Body, BodyKind, Scene, Shape } from './scene'
import { emptyScene } from './scene'
import { rad, rot, type Vec2 } from './math'

export type ScenePreset = {
  id: string
  title: string
  subtitle: string
  chips: string[]
  build: () => Scene
  layout?: (scene: Scene) => void
}

const C = {
  ground: '#96a0ae',
  ramp: '#8b96a8',
  block: '#4a6585',
  ball: '#d95a39',
  trough: '#7f8b9c',
  loop: '#74808f',
  target: '#3fa37a',
}

type BodyInit = {
  id: string
  kind: BodyKind
  shape: Shape
  x: number
  y: number
  angle?: number
  material: string
  color: string
  mass?: number
  charge?: number
  friction?: number
  depth?: number
  label?: string
  velocity?: Vec2
  omega?: number
  fixedRotation?: boolean
  style?: 'solid' | 'thin'
  linearDamping?: number
  role?: 'terrain' | 'object' | 'track'
}

function body(b: BodyInit): Body {
  return {
    id: b.id,
    kind: b.kind,
    shape: b.shape,
    transform: { x: b.x, y: b.y, angle: b.angle ?? 0 },
    material: b.material,
    mass: b.mass,
    charge: b.charge,
    friction: b.friction,
    appearance: { color: b.color, depth: b.depth ?? 0.16, style: b.style },
    label: b.label,
    velocity: b.velocity,
    omega: b.omega,
    fixedRotation: b.fixedRotation,
    role: b.role,
    linearDamping: b.linearDamping,
  }
}

/** 带位置的矩形（多边形表达，逆时针），用于复合体里的底座/支柱 */
function boxPoly(cx: number, cy: number, w: number, h: number): Shape {
  return {
    type: 'polygon',
    points: [
      { x: cx - w / 2, y: cy - h / 2 },
      { x: cx + w / 2, y: cy - h / 2 },
      { x: cx + w / 2, y: cy + h / 2 },
      { x: cx - w / 2, y: cy + h / 2 },
    ],
  }
}

function groundBody(w = 10, h = 0.28): Body {
  return body({
    id: 'ground',
    kind: 'static',
    shape: { type: 'rect', w, h },
    x: 0,
    y: -h / 2,
    material: 'smooth',
    color: '#aeb7c4',
    depth: 0.12,
    label: '地面',
  })
}

// ---------------------------------------------------------------------------
// 1. 斜面滑块
// ---------------------------------------------------------------------------

const INC_L = 3.4
const INC_T = 0.09
const INC_PIVOT = 1.15
const INC_START_D = 0.5

function buildIncline(): Scene {
  const s = emptyScene('斜面滑块')
  s.meta.note = '题目假设：滑块（平动、滑动摩擦）。改 θ、μ、v₀ 看 v–t 斜率。'
  s.meta.tags = ['力学', '牛顿定律', '模型建构']
  s.params = { theta: 30, mu: 0.25, v0: 0, mass: 0.5, model: 0, ball: 0 }
  s.world.view = { preset: 'side', elevation: 0, azimuth: 0, scale: 118, center: { x: -0.5, y: 1.25 } }
  s.world.duration = 4.5
  s.bodies = [
    groundBody(),
    body({
      id: 'ramp',
      kind: 'static',
      // 体原点 = 斜面低端；矩形必须向 -x 偏移 L/2，否则会有一半插到地下
      shape: boxPoly(-INC_L / 2, 0, INC_L, INC_T),
      x: INC_PIVOT,
      y: 0,
      material: 'stone',
      color: C.ramp,
      depth: 0.22,
      label: '斜面',
    }),
    body({
      id: 'block',
      kind: 'particle',
      shape: { type: 'rect', w: 0.3, h: 0.24 },
      x: 0,
      y: 0,
      material: 'metal',
      color: C.block,
      mass: 0.5,
      depth: 0.14,
      label: '滑块',
    }),
  ]
  s.contactPairs = [{ a: 'metal', b: 'stone', mu: 0.25, restitution: 0.04 }]
  s.observers = [
    { id: 'trail', kind: 'trail', bodyId: 'block', len: 700 },
    { id: 'vel', kind: 'vector', bodyId: 'block', which: ['v'], scale: 0.2 },
    { id: 'chart', kind: 'chart', axis: 't', series: [{ bodyId: 'block', quantity: 'v' }], title: 'v–t', unit: 'm/s' },
  ]
  s.criteria = []
  s.guides = []
return s
}

function layoutIncline(s: Scene): void {
  const theta = rad(s.params.theta ?? 30)
  const isRolling = (s.params.model ?? 0) >= 0.5
  // 滚动模型必须配圆形；只把 model 拨到 1 时也按小球处理（题目说"小球滚下"）
  const isBall = isRolling || (s.params.ball ?? 0) >= 0.5
  const ramp = s.bodies.find((b) => b.id === 'ramp')
  const block = s.bodies.find((b) => b.id === 'block')
  if (!ramp || !block) return
  const pivotY = (INC_T / 2) * Math.cos(theta)
  ramp.transform.angle = -theta
  ramp.transform.x = INC_PIVOT
  ramp.transform.y = pivotY

  block.kind = isRolling ? 'rigid' : 'particle'
  block.fixedRotation = !isRolling
  block.shape = isBall ? { type: 'circle', r: 0.16 } : { type: 'rect', w: 0.3, h: 0.24 }
  block.mass = s.params.mass ?? 0.5
  block.label = isBall ? '小球' : '滑块'
  block.appearance = { ...block.appearance, color: isBall ? C.ball : C.block }
  block.transform.angle = isBall ? 0 : -theta
  const half = isBall ? 0.16 : 0.12
  const local = { x: -INC_L + INC_START_D, y: INC_T / 2 + half }
  const p = rot(local, -theta)
  block.transform.x = INC_PIVOT + p.x
  block.transform.y = pivotY + p.y
  const v0 = s.params.v0 ?? 0
  block.velocity = { x: Math.cos(theta) * v0, y: -Math.sin(theta) * v0 }
  block.omega = 0
  if (s.contactPairs[0]) s.contactPairs[0].mu = s.params.mu ?? 0.25
  ramp.friction = s.params.mu ?? 0.25
}

// ---------------------------------------------------------------------------
// 2. 半圆槽：固定 / 可移动
// ---------------------------------------------------------------------------

const TR_R = 0.9
const TR_T = 0.08
const TR_BASE_H = 0.06
const TR_CY = TR_R + TR_T + TR_BASE_H
const TR_BALL_R = 0.1
const TR_START = rad(186)

function troughShape(): Shape {
  return {
    type: 'compound',
    parts: [
      { type: 'arc', r: TR_R, a0: Math.PI, a1: Math.PI * 2, thick: TR_T },
      boxPoly(0, -(TR_R + TR_T + TR_BASE_H / 2), TR_R * 2 + 0.3, TR_BASE_H),
    ],
  }
}

function troughBallStart(): Vec2 {
  const r = TR_R - TR_BALL_R
  return { x: Math.cos(TR_START) * r, y: TR_CY + Math.sin(TR_START) * r }
}

function buildTrough(): Scene {
  const s = emptyScene('半圆槽：槽会被推走吗')
  s.meta.note =
    '题目假设：槽放在光滑水平面上，可移动。直觉说球到不了等高位置——但球其实还是能到同样高，' +
    '真正变的是槽的位置（水平动量守恒，槽被推走、整体质心不动）。'
  s.meta.tags = ['动量守恒', '机械能', '条件层', '推翻直觉']
  s.params = { fixed: 0, M: 1.0, m: 0.2, roll: 0 }
  s.world.view = { preset: 'side', elevation: 0, azimuth: 0, scale: 155, center: { x: 0, y: 0.85 } }
  s.world.duration = 7
  // 轨道用理想约束求解，能量误差随步长线性下降；1/1920 下临界误差 < 0.5%
  s.world.timeStep = 1 / 960
  s.world.substeps = 2
  const start = troughBallStart()
  s.bodies = [
    groundBody(),
    body({
      id: 'trough',
      kind: 'static',
      shape: troughShape(),
      x: 0,
      y: TR_CY,
      material: 'stone',
      color: C.trough,
      mass: 1,
      depth: 0.2,
      label: '半圆槽',
      fixedRotation: true,
    }),
    body({
      id: 'ball',
      kind: 'particle',
      shape: { type: 'circle', r: TR_BALL_R },
      x: start.x,
      y: start.y,
      material: 'metal',
      color: C.ball,
      mass: 0.2,
      depth: 0.07,
      label: '小球',
      fixedRotation: true,
    }),
  ]
  s.contactPairs = [
    { a: 'metal', b: 'stone', mu: 0, restitution: 0 },
    { a: 'stone', b: 'smooth', mu: 0, restitution: 0 },
  ]
  s.constraints = [
    {
      id: 'track',
      type: 'track',
      bodyId: 'ball',
      centerBodyId: 'trough',
      radius: TR_R - TR_BALL_R,
      side: 'inner',
    },
  ]
  s.observers = [
    { id: 'trail', kind: 'trail', bodyId: 'ball', len: 900 },
    { id: 'vel', kind: 'vector', bodyId: 'ball', which: ['v'], scale: 0.14 },
    { id: 'energy', kind: 'energy', bodyIds: ['ball', 'trough'] },
  ]
  s.criteria = [
    { id: 'momentum', kind: 'conserve', quantity: 'p', axis: 'x', tol: 0.02, label: '水平动量' },
    { id: 'energy', kind: 'conserve', quantity: 'E', tol: 0.02, label: '机械能' },
  ]
  s.guides = [{ id: 'equal-height', kind: 'hline', y: start.y, label: '初始高度', x0: -1.5, x1: 1.5 }]
return s
}

function layoutTrough(s: Scene): void {
  const fixed = (s.params.fixed ?? 0) >= 0.5
  const trough = s.bodies.find((b) => b.id === 'trough')
  const ball = s.bodies.find((b) => b.id === 'ball')
  if (!trough || !ball) return
  trough.kind = fixed ? 'static' : 'rigid'
  trough.mass = s.params.M ?? 1
  trough.fixedRotation = true
  trough.transform.x = 0
  trough.transform.y = TR_CY
  const start = troughBallStart()
  ball.mass = s.params.m ?? 0.2
  ball.transform.x = start.x
  ball.transform.y = start.y
  ball.transform.angle = 0
  ball.velocity = { x: 0, y: 0 }
  ball.omega = 0
  const rolling = (s.params.roll ?? 0) >= 0.5
  ball.kind = rolling ? 'rigid' : 'particle'
  ball.fixedRotation = !rolling
  const guide = s.guides.find((g) => g.id === 'equal-height')
  if (guide && guide.kind === 'hline') guide.y = start.y
}

// ---------------------------------------------------------------------------
// 3. 竖直圆轨道：恰好过最高点
// ---------------------------------------------------------------------------

const LOOP_R = 0.6
const LOOP_T = 0.06
const LOOP_CY = 0.9
const LOOP_BALL_R = 0.055

function loopOuterBottomAt(x: number, r: number): number {
  return Math.sqrt(Math.max(0, (r + LOOP_T) ** 2 - x * x))
}

function loopShape(r: number): Shape {
  // 局部原点在圆心；地面在 local y = -LOOP_CY
  const supportTop = -loopOuterBottomAt(0.3, r) // 环外表面在该 x 处的高度（局部，负）
  const supportBottom = -LOOP_CY + 0.1 // 底座顶面
  const supportH = Math.max(0.04, supportBottom - supportTop)
  return {
    type: 'compound',
    parts: [
      { type: 'arc', r, a0: 0, a1: Math.PI * 2, thick: LOOP_T },
      boxPoly(0, -LOOP_CY + 0.05, 1.1, 0.1),
      boxPoly(-0.3, supportTop + supportH / 2, 0.06, supportH),
      boxPoly(0.3, supportTop + supportH / 2, 0.06, supportH),
    ],
  }
}

function buildLoop(): Scene {
  const s = emptyScene('竖直圆轨道：恰好过最高点')
  s.meta.note = '拖 v₀ 从慢到快：轨迹会在某个速度上从「中途掉落」翻转成「完整过圈」。那个点就是 √(5gR)。'
  s.meta.tags = ['圆周运动', '临界问题', '判据']
  s.params = { v0: 5.0, roll: 0, R: LOOP_R }
  s.world.view = { preset: 'side', elevation: 0, azimuth: 0, scale: 230, center: { x: 0, y: 0.75 } }
  s.world.duration = 6
  s.world.timeStep = 1 / 960
  s.world.substeps = 2
  const ballBottom = LOOP_CY - LOOP_R + LOOP_BALL_R
  s.bodies = [
    groundBody(),
    body({
      id: 'loop',
      kind: 'static',
      shape: loopShape(LOOP_R),
      x: 0,
      y: LOOP_CY,
      material: 'stone',
      color: C.loop,
      depth: 0.22,
      label: '圆轨道',
    }),
    body({
      id: 'ball',
      kind: 'particle',
      shape: { type: 'circle', r: LOOP_BALL_R },
      x: 0,
      y: ballBottom,
      material: 'metal',
      color: C.ball,
      mass: 0.2,
      depth: 0.06,
      label: '小球',
      velocity: { x: 5, y: 0 },
      fixedRotation: true,
    }),
  ]
  s.contactPairs = [{ a: 'metal', b: 'stone', mu: 0, restitution: 0 }]
  s.constraints = [
    {
      id: 'track',
      type: 'track',
      bodyId: 'ball',
      centerBodyId: 'loop',
      radius: LOOP_R - LOOP_BALL_R,
      side: 'inner',
    },
  ]
  s.observers = [
    { id: 'trail', kind: 'trail', bodyId: 'ball', len: 1200 },
    { id: 'vel', kind: 'vector', bodyId: 'ball', which: ['v'], scale: 0.16 },
    { id: 'chart', kind: 'chart', axis: 't', series: [{ bodyId: 'ball', quantity: 'y' }], title: '高度 h–t', unit: 'm' },
  ]
  s.regions = []
  s.criteria = [
    { id: 'detach', kind: 'detach', bodyId: 'ball', trackId: 'loop', until: 0.7, hold: 0.04, label: '脱离轨道' },
  ]
  s.guides = [{ id: 'top', kind: 'hline', y: LOOP_CY + LOOP_R, label: '最高点', x0: -1.25, x1: 1.25 }]

return s
}

function layoutLoop(s: Scene): void {
  const ball = s.bodies.find((b) => b.id === 'ball')
  const loop = s.bodies.find((b) => b.id === 'loop')
  if (!ball || !loop) return
  const R = Math.min(0.7, Math.max(0.3, s.params.R ?? LOOP_R))
  loop.shape = loopShape(R)
  loop.transform.x = 0
  loop.transform.y = LOOP_CY
  const track = s.constraints.find((c) => c.type === 'track' && c.centerBodyId === 'loop')
  if (track && track.type === 'track') track.radius = R - LOOP_BALL_R
  ball.transform.x = 0
  ball.transform.y = LOOP_CY - R + LOOP_BALL_R
  ball.transform.angle = 0
  ball.velocity = { x: s.params.v0 ?? 5, y: 0 }
  ball.omega = 0
  const rolling = (s.params.roll ?? 0) >= 0.5
  ball.kind = rolling ? 'rigid' : 'particle'
  ball.fixedRotation = !rolling
  const guide = s.guides.find((g) => g.id === 'top')
  if (guide && guide.kind === 'hline') guide.y = LOOP_CY + R
}

// ---------------------------------------------------------------------------
// 4. 平抛：有无空气阻力
// ---------------------------------------------------------------------------

const PJ_H = 2
const PJ_R = 0.08
const PJ_TARGET_X = 3.51
const PJ_TARGET_R = 0.4

function buildProjectile(): Scene {
  const s = emptyScene('平抛：空气阻力拿走了什么')
  s.meta.note = '题目假设：不计空气阻力，落点由 v₀ 和 h 唯一决定；需要时可在「世界」里打开阻力。'
  s.meta.tags = ['抛体运动', '理想化假设', '模型层']
  s.params = { v0: 5.5, h: PJ_H, drag: 0 }
  s.world.view = { preset: 'side', elevation: 0, azimuth: 0, scale: 108, center: { x: 1.7, y: 1.5 } }
  s.world.duration = 2.4
  s.bodies = [
    groundBody(20, 0.28),
    body({
      id: 'platform',
      kind: 'static',
      shape: { type: 'rect', w: 1.1, h: 0.24 },
      x: -0.5,
      y: PJ_H - 0.12,
      material: 'stone',
      color: C.ramp,
      depth: 0.22,
      label: '平台',
    }),
    body({
      id: 'ball',
      kind: 'particle',
      shape: { type: 'circle', r: PJ_R },
      x: 0.06,
      y: PJ_H + PJ_R,
      material: 'metal',
      color: C.ball,
      mass: 0.2,
      depth: 0.06,
      label: '小球',
      velocity: { x: 5.5, y: 0 },
      fixedRotation: true,
    }),
  ]
  s.fields = [{ id: 'drag', kind: 'drag', k: 0.06, order: 2, enabled: false, label: '空气阻力' }]
  s.regions = [
    {
      id: 'target',
      shape: { type: 'circle', r: PJ_TARGET_R },
      transform: { x: PJ_TARGET_X, y: 0.12, angle: 0 },
      label: '目标',
      role: 'target',
    },
  ]
  s.contactPairs = [{ a: 'metal', b: 'smooth', mu: 0.2, restitution: 0.2 }]
  s.observers = [
    { id: 'trail', kind: 'trail', bodyId: 'ball', len: 1400 },
    { id: 'vel', kind: 'vector', bodyId: 'ball', which: ['v'], scale: 0.16 },
    { id: 'chart', kind: 'chart', axis: 'x', series: [{ bodyId: 'ball', quantity: 'y' }], title: '轨迹 y–x', unit: 'm' },
  ]
  s.criteria = [{ id: 'hit', kind: 'reach', bodyId: 'ball', regionId: 'target', label: '到达目标' }]
  s.guides = [{ id: 'ideal', kind: 'vline', x: PJ_TARGET_X, label: '无阻力落点', y0: 0, y1: 2.4 }]

return s
}

function layoutProjectile(s: Scene): void {
  const h = s.params.h ?? PJ_H
  const v0 = s.params.v0 ?? 5.5
  const platform = s.bodies.find((b) => b.id === 'platform')
  const ball = s.bodies.find((b) => b.id === 'ball')
  if (platform) platform.transform.y = h - 0.12
  if (ball) {
    ball.transform.x = 0.06
    ball.transform.y = h + PJ_R
    ball.transform.angle = 0
    ball.velocity = { x: v0, y: 0 }
    ball.omega = 0
  }
  const field = s.fields.find((f) => f.kind === 'drag')
  if (field) field.enabled = (s.params.drag ?? 0) >= 0.5
  const ideal = s.guides.find((g) => g.id === 'ideal')
  const range = v0 * Math.sqrt((2 * h) / Math.max(0.1, s.world.gravity))
  if (ideal && ideal.kind === 'vline') {
    ideal.x = Math.max(0.4, range)
    ideal.y1 = h + 0.4
  }
}


// ---------------------------------------------------------------------------
// 5. 弹簧振子：周期由谁决定
// ---------------------------------------------------------------------------

const SP_WALL_X = -1.4
const SP_WALL_W = 0.24
const SP_ANCHOR_X = SP_WALL_X + SP_WALL_W / 2
const SP_L0 = 1.4

function buildSpring(): Scene {
  const s = emptyScene('弹簧振子：周期由谁决定')
  s.meta.note = '把物块拉离平衡位置再松手：改 k 或质量，看周期怎么变。T = 2π√(m/k)，与振幅无关。'
  s.meta.tags = ['简谐运动', '弹簧', '周期']
  s.params = { k: 40, m: 0.5 }
  s.world.view = { preset: 'side', elevation: 0, azimuth: 0, scale: 160, center: { x: -0.1, y: 0.85 } }
  s.world.duration = 5
  s.world.timeStep = 1 / 480
  s.world.substeps = 2
  s.world.settle = 0.1
  s.bodies = [
    groundBody(),
    body({
      id: 'wall',
      kind: 'static',
      shape: { type: 'rect', w: SP_WALL_W, h: 1.6 },
      x: SP_WALL_X,
      y: 0.8,
      material: 'stone',
      color: C.ground,
      label: '墙',
    }),
    body({
      id: 'block',
      kind: 'rigid',
      shape: { type: 'rect', w: 0.5, h: 0.5 },
      x: 0.75,
      y: 0.25,
      material: 'smooth',
      color: C.block,
      mass: 0.5,
      label: '物块',
    }),
  ]
  s.contactPairs = [{ a: 'smooth', b: 'smooth', mu: 0, restitution: 0 }]
  s.constraints = [
    {
      id: 'spring',
      type: 'spring',
      a: { bodyId: 'wall', local: { x: SP_WALL_W / 2, y: -0.55 } },
      b: { bodyId: 'block', local: { x: -0.25, y: 0 } },
      k: 40,
      l0: SP_L0,
      damping: 0,
    },
  ]
  s.observers = [
    { id: 'trail', kind: 'trail', bodyId: 'block', len: 500 },
    { id: 'vel', kind: 'vector', bodyId: 'block', which: ['v'], scale: 0.18 },
    { id: 'chart', kind: 'chart', axis: 't', series: [{ bodyId: 'block', quantity: 'x' }], title: '位置 x–t', unit: 'm' },
  ]
  s.criteria = [{ id: 'energy', kind: 'conserve', quantity: 'E', tol: 0.02, label: '机械能' }]
  s.guides = [{ id: 'eq', kind: 'vline', x: SP_ANCHOR_X + SP_L0 + 0.25, label: '平衡位置', y0: 0, y1: 1.1 }]
return s
}

function layoutSpring(s: Scene): void {
  const block = s.bodies.find((b) => b.id === 'block')
  const spring = s.constraints.find((c) => c.id === 'spring')
  if (!block) return
  block.transform.x = 0.75
  block.transform.y = 0.25
  block.transform.angle = 0
  block.velocity = { x: 0, y: 0 }
  block.omega = 0
  block.mass = s.params.m ?? 0.5
  if (spring && spring.type === 'spring') {
    spring.k = s.params.k ?? 40
    spring.l0 = SP_L0
  }
  const guide = s.guides.find((g) => g.id === 'eq')
  if (guide && guide.kind === 'vline') guide.x = SP_ANCHOR_X + (spring && spring.type === 'spring' ? spring.l0 : SP_L0) + 0.25
}

// ---------------------------------------------------------------------------
// 6. 单摆：绳的拉力在变
// ---------------------------------------------------------------------------

const PEN_PIVOT = { x: 0, y: 2.5 }
const PEN_R = 0.14

function buildPendulum(): Scene {
  const s = emptyScene('单摆：绳的拉力一直在变')
  s.meta.note = '绳长和摆角都能拖。注意看绿色拉力箭头：最低点最大，最高点最小。'
  s.meta.tags = ['单摆', '绳', '受力']
  s.params = { L: 1.5, theta: 40 }
  s.world.view = { preset: 'side', elevation: 0, azimuth: 0, scale: 160, center: { x: 0, y: 1.5 } }
  s.world.duration = 6
  s.world.timeStep = 1 / 480
  s.world.substeps = 2
  s.bodies = [
    groundBody(),
    body({
      id: 'pivot',
      kind: 'static',
      shape: { type: 'circle', r: 0.06 },
      x: PEN_PIVOT.x,
      y: PEN_PIVOT.y,
      material: 'stone',
      color: C.ground,
      label: '悬点',
    }),
    body({
      id: 'ball',
      kind: 'particle',
      shape: { type: 'circle', r: PEN_R },
      x: 0.96,
      y: 1.35,
      material: 'metal',
      color: C.ball,
      mass: 0.3,
      label: '小球',
      fixedRotation: true,
    }),
  ]
  s.constraints = [
    { id: 'rope', type: 'rope', a: { bodyId: 'pivot', local: { x: 0, y: 0 } }, b: { bodyId: 'ball', local: { x: 0, y: 0 } }, length: 1.5 },
  ]
  s.observers = [
    { id: 'trail', kind: 'trail', bodyId: 'ball', len: 600 },
    { id: 'vel', kind: 'vector', bodyId: 'ball', which: ['v'], scale: 0.18 },
    { id: 'chart', kind: 'chart', axis: 't', series: [{ bodyId: 'ball', quantity: 'x' }], title: '摆球 x–t', unit: 'm' },
  ]
  s.criteria = [{ id: 'energy', kind: 'conserve', quantity: 'E', tol: 0.02, label: '机械能' }]
  s.guides = [{ id: 'low', kind: 'vline', x: 0, label: '最低点', y0: 0, y1: PEN_PIVOT.y }]
return s
}

function layoutPendulum(s: Scene): void {
  const ball = s.bodies.find((b) => b.id === 'ball')
  const rope = s.constraints.find((c) => c.id === 'rope')
  if (!ball) return
  const L = s.params.L ?? 1.5
  const th = ((s.params.theta ?? 40) * Math.PI) / 180
  ball.transform.x = L * Math.sin(th)
  ball.transform.y = PEN_PIVOT.y - L * Math.cos(th)
  ball.transform.angle = 0
  ball.velocity = { x: 0, y: 0 }
  ball.omega = 0
  if (rope && rope.type === 'rope') rope.length = L
}

// ---------------------------------------------------------------------------
// 7. 电场中的带电粒子
// ---------------------------------------------------------------------------

const EF_X = 1.45
const EF_W = 3.0
const EF_TOP = 2.35
const EF_BOT = 0.35
const EF_R = 0.07

function buildEfield(): Scene {
  const s = emptyScene('电场中的带电粒子：抛体还是直线？')
  s.meta.note = '忽略重力，只看电场力：没有电场时走直线，有电场时被持续加速，轨迹变成抛物线。'
  s.meta.tags = ['电场力', '类平抛', '场力']
  s.params = { v0: 3, E: 40 }
  s.world.gravity = 0
  s.world.view = { preset: 'side', elevation: 0, azimuth: 0, scale: 190, center: { x: 1.55, y: 1.3 } }
  s.world.duration = 3
  s.world.timeStep = 1 / 480
  s.world.substeps = 2
  s.bodies = [
    groundBody(),
    body({
      id: 'top',
      kind: 'static',
      shape: { type: 'rect', w: EF_W, h: 0.1 },
      x: EF_X,
      y: EF_TOP,
      material: 'metal',
      color: C.ground,
      label: '上极板',
    }),
    body({
      id: 'bottom',
      kind: 'static',
      shape: { type: 'rect', w: EF_W, h: 0.1 },
      x: EF_X,
      y: EF_BOT,
      material: 'metal',
      color: C.ground,
      label: '下极板',
    }),
    body({
      id: 'stop',
      kind: 'static',
      shape: { type: 'rect', w: 0.12, h: 0.7 },
      x: 3.05,
      y: 0.7,
      material: 'metal',
      color: C.ground,
      label: '挡板',
    }),
    body({
      id: 'particle',
      kind: 'particle',
      shape: { type: 'circle', r: EF_R },
      x: 0.15,
      y: 2.0,
      material: 'metal',
      color: C.ball,
      mass: 0.002,
      charge: 0.0002,
      label: '带电粒子',
      velocity: { x: 3, y: 0 },
      fixedRotation: true,
    }),
  ]
  s.contactPairs = [{ a: 'metal', b: 'metal', mu: 0, restitution: 0 }]
  s.regions = [
    {
      id: 'gap',
      shape: { type: 'rect', w: EF_W - 0.2, h: EF_TOP - EF_BOT - 0.1 },
      transform: { x: EF_X, y: (EF_TOP + EF_BOT) / 2, angle: 0 },
      label: '匀强电场 E',
    },
  ]
  // 场的区域写法：Region 上挂 field 只是一种渲染提示，真正的场在 fields 里
  s.fields = [{ id: 'E', kind: 'uniform', type: 'E', vector: { x: 0, y: -40 }, regionId: 'gap', enabled: true }]
  s.observers = [
    { id: 'trail', kind: 'trail', bodyId: 'particle', len: 900 },
    { id: 'vel', kind: 'vector', bodyId: 'particle', which: ['v'], scale: 0.2 },
    { id: 'chart', kind: 'chart', axis: 'x', series: [{ bodyId: 'particle', quantity: 'y' }], title: '轨迹 y–x', unit: 'm' },
  ]
  s.criteria = [{ id: 'hit', kind: 'collide', bodyA: 'particle', bodyB: 'bottom', label: '撞到下板' }]
  s.guides = [{ id: 'entry', kind: 'hline', y: 2.0, label: '入射高度', x0: 0.0, x1: 0.9 }]
return s
}

function layoutEfield(s: Scene): void {
  const ball = s.bodies.find((b) => b.id === 'particle')
  const field = s.fields.find((f) => f.id === 'E')
  if (!ball) return
  ball.transform.x = 0.15
  ball.transform.y = 2.0
  ball.transform.angle = 0
  ball.velocity = { x: s.params.v0 ?? 3, y: 0 }
  ball.omega = 0
  if (field && field.kind === 'uniform' && field.type === 'E') {
    field.vector = { x: 0, y: -(s.params.E ?? 40) }
  }
  const guide = s.guides.find((g) => g.id === 'entry')
  if (guide && guide.kind === 'hline') guide.y = 2.0
}

// ---------------------------------------------------------------------------
// 注册表
// ---------------------------------------------------------------------------

function buildRampArc(): Scene {
  const s = emptyScene('斜面 + 圆弧')
  s.meta.note = '斜面底端接一段圆弧：圆弧可以光滑也可以粗糙，改圆弧的摩擦 μ 看小球能冲多高。三个组件分开画，是为了让每段有自己的摩擦。'
  s.meta.tags = ['力学', '圆周运动', '能量']
  s.params = { theta: 35, R: 0.9, mu: 0.25, muArc: 0, v0: 0, mass: 0.5, ball: 1, roll: 0 }
  s.world.view = { preset: 'side', elevation: 0, azimuth: 0, scale: 220, center: { x: -1.0, y: 1.8 } }
  s.world.duration = 5
  s.bodies = [
    groundBody(),
    body({ id: 'ramp', kind: 'static', shape: { type: 'polyline', points: [], thick: 0.05 }, x: -1.1, y: 1.35, material: 'stone', color: C.ramp, depth: 0.16, label: '斜面', style: 'thin' }),
    body({ id: 'arc', kind: 'static', shape: { type: 'arc', r: 0.9, a0: 0, a1: 1, thick: 0.05 }, x: -0.6, y: 2, material: 'stone', color: C.loop, depth: 0.16, label: '圆弧', style: 'thin' }),
    body({ id: 'flat', kind: 'static', shape: { type: 'polyline', points: [], thick: 0.05 }, x: 0, y: 0, material: 'stone', color: C.ramp, depth: 0.16, label: '水平段', style: 'thin' }),
    body({ id: 'ball', kind: 'particle', shape: { type: 'circle', r: 0.13 }, x: -1.6, y: 2, material: 'metal', color: C.ball, mass: 0.5, depth: 0.16, label: '小球' }),
  ]
  s.contactPairs = [{ a: 'metal', b: 'stone', mu: 0.3, restitution: 0.02 }]
  s.observers = [
    { id: 'trail', kind: 'trail', bodyId: 'ball', len: 900 },
    { id: 'vel', kind: 'vector', bodyId: 'ball', which: ['v'], scale: 0.2 },
    { id: 'chart', kind: 'chart', axis: 't', series: [{ bodyId: 'ball', quantity: 'v' }], title: 'v–t', unit: 'm/s' },
  ]
  s.criteria = []
layoutRampArc(s)
  return s
}

function layoutRampArc(s: Scene): void {
  const theta = rad(Math.min(70, Math.max(10, s.params.theta ?? 35)))
  const R = Math.min(2, Math.max(0.3, s.params.R ?? 0.9))
  const L = 2.2
  const B = { x: -1.1, y: 1.35 }
  const t = { x: Math.cos(theta), y: -Math.sin(theta) }
  const n = { x: Math.sin(theta), y: Math.cos(theta) }
  const A = { x: B.x - L * t.x, y: B.y - L * t.y }
  const C = { x: B.x + R * n.x, y: B.y + R * n.y }
  const a0 = Math.PI * 1.5 - theta
  const a1 = Math.PI * 1.5
  const D = { x: C.x, y: C.y - R }
  for (const b of s.bodies) {
    if (b.id === 'ramp') {
      b.transform = { x: B.x, y: B.y, angle: 0 }
      b.shape = { type: 'polyline', points: [{ x: A.x - B.x, y: A.y - B.y }, { x: 0, y: 0 }], thick: 0.05 }
      b.friction = s.params.mu ?? 0.25
    } else if (b.id === 'arc') {
      b.transform = { x: C.x, y: C.y, angle: 0 }
      b.shape = { type: 'arc', r: R, a0, a1, thick: 0.05 }
      b.friction = s.params.muArc ?? 0
    } else if (b.id === 'flat') {
      b.transform = { x: D.x, y: D.y, angle: 0 }
      b.shape = { type: 'polyline', points: [{ x: 0, y: 0 }, { x: 1.5, y: 0 }], thick: 0.05 }
      b.friction = 0.15
    } else if (b.id === 'ball') {
      const isBall = (s.params.ball ?? 1) >= 0.5
      const rolling = (s.params.roll ?? 0) >= 0.5
      const s0 = 1.55
      const p = { x: A.x + s0 * t.x, y: A.y + s0 * t.y }
      const lift = isBall ? 0.155 : 0.12
      b.transform = { x: p.x + n.x * lift, y: p.y + n.y * lift, angle: isBall ? 0 : -theta }
      b.shape = isBall ? { type: 'circle', r: 0.13 } : { type: 'rect', w: 0.24, h: 0.18 }
      b.kind = rolling ? 'rigid' : 'particle'
      b.fixedRotation = !rolling
      b.label = isBall ? '小球' : '滑块'
      b.appearance = { ...b.appearance, color: isBall ? '#d95a39' : '#4a6585' }
      const v0 = s.params.v0 ?? 0
      b.velocity = { x: v0 * t.x, y: v0 * t.y }
      b.mass = s.params.mass ?? 0.5
    }
  }
}


// ---------------------------------------------------------------------------
// 9. 板块 + 平抛：2024 新课标卷第 12 题这一类
// ---------------------------------------------------------------------------

const BB_BLOCK = 0.08
const BB_BOARD_H = 0.04

function buildBoardBlock(): Scene {
  const s = emptyScene('板块 + 平抛')
  s.meta.note =
    '题目假设：光滑平台、薄板不翻转；板块间有滑动摩擦。物块初速度和平台高度先给默认值，' +
    '在检查器里调——题目常把它们作为待求量。'
  s.meta.tags = ['板块模型', '摩擦', '平抛', '多体']
  s.params = { l: 1.0, mu: 0.3, v0: 4, m: 0.5, h: 0.8 }
  s.materials = [...s.materials, { id: 'board', name: '板面', mu: 0.3, restitution: 0, color: '#aeb7c4' }]
  s.world.view = { preset: 'side', elevation: 0, azimuth: 0, scale: 470, center: { x: 0, y: -0.3 }, fit: false }
  s.world.duration = 1.4
  s.world.timeStep = 1 / 960
  s.world.substeps = 2
  const l = 1.0
  const h = 0.8
  const m = 0.5
  s.bodies = [
    body({
      id: 'ground',
      kind: 'static',
      shape: { type: 'rect', w: 6, h: 0.28 },
      x: 0,
      y: -h - 0.14,
      material: 'smooth',
      color: '#aeb7c4',
      depth: 0.12,
      label: '地面',
    }),
    body({
      id: 'platform',
      kind: 'static',
      shape: { type: 'rect', w: 3, h },
      x: -1.5,
      y: -h / 2,
      material: 'stone',
      color: C.ramp,
      depth: 0.2,
      label: '平台',
    }),
    body({
      id: 'board',
      kind: 'particle',
      shape: { type: 'rect', w: l, h: BB_BOARD_H },
      x: -l / 2,
      y: BB_BOARD_H / 2,
      material: 'board',
      color: C.ramp,
      mass: m,
      fixedRotation: true,
      depth: 0.14,
      label: '薄板',
    }),
    body({
      id: 'block',
      kind: 'particle',
      shape: { type: 'rect', w: BB_BLOCK, h: BB_BLOCK },
      x: -l + BB_BLOCK / 2,
      y: BB_BOARD_H + BB_BLOCK / 2,
      material: 'board',
      color: C.block,
      mass: m,
      fixedRotation: true,
      depth: 0.12,
      label: '物块',
      velocity: { x: 4, y: 0 },
    }),
  ]
  s.contactPairs = [
    { a: 'board', b: 'board', mu: 0.3, restitution: 0 },
    { a: 'board', b: 'stone', mu: 0, restitution: 0 },
  ]
  s.observers = [
    { id: 'trail', kind: 'trail', bodyId: 'block', len: 500 },
    { id: 'vel', kind: 'vector', bodyId: 'block', which: ['v'], scale: 0.2 },
    { id: 'chart', kind: 'chart', axis: 't', series: [{ bodyId: 'block', quantity: 'v' }, { bodyId: 'board', quantity: 'v' }], title: 'v–t', unit: 'm/s' },
  ]
  s.criteria = []
  s.guides = [
    { id: 'edge', kind: 'vline', x: 0, label: 'O', y0: -h, y1: 0.5 },
    { id: 'floor', kind: 'hline', y: -h, label: '地面', x0: -2.5, x1: 2.5 },
  ]
  s.regions = []
  return s
}

function layoutBoardBlock(s: Scene): void {
  const l = Math.min(2, Math.max(0.4, s.params.l ?? 1))
  const h = Math.min(3, Math.max(0.2, s.params.h ?? 0.8))
  const m = Math.min(5, Math.max(0.05, s.params.m ?? 0.5))
  const v0 = s.params.v0 ?? 4
  const board = s.bodies.find((b) => b.id === 'board')
  const block = s.bodies.find((b) => b.id === 'block')
  const platform = s.bodies.find((b) => b.id === 'platform')
  const ground = s.bodies.find((b) => b.id === 'ground')
  if (!board || !block || !platform || !ground) return
  board.shape = { type: 'rect', w: l, h: BB_BOARD_H }
  board.transform = { x: -l / 2, y: BB_BOARD_H / 2, angle: 0 }
  board.mass = m
  board.velocity = { x: 0, y: 0 }
  board.omega = 0
  block.shape = { type: 'rect', w: BB_BLOCK, h: BB_BLOCK }
  block.transform = { x: -l + BB_BLOCK / 2, y: BB_BOARD_H + BB_BLOCK / 2, angle: 0 }
  block.mass = m
  block.velocity = { x: v0, y: 0 }
  block.omega = 0
  platform.shape = { type: 'rect', w: 3, h }
  platform.transform = { x: -1.5, y: -h / 2, angle: 0 }
  ground.shape = { type: 'rect', w: 6, h: 0.28 }
  ground.transform = { x: 0, y: -h - 0.14, angle: 0 }
  const mat = s.materials.find((m) => m.id === 'board')
  if (mat) mat.mu = s.params.mu ?? 0.3
  const pair = s.contactPairs.find((c) => c.a === 'board' && c.b === 'board')
  if (pair) pair.mu = s.params.mu ?? 0.3
  const edge = s.guides.find((g) => g.id === 'edge')
  if (edge && edge.kind === 'vline') {
    edge.x = 0
    edge.y0 = -h
    edge.y1 = 0.5
  }
  const floor = s.guides.find((g) => g.id === 'floor')
  if (floor && floor.kind === 'hline') {
    floor.y = -h
    floor.x0 = -2.5
    floor.x1 = 2.5
  }
  s.world.view.center = { x: 0, y: -h / 2 + 0.1 }
  s.world.view.scale = 470
  s.world.view.fit = false
}


// ---------------------------------------------------------------------------
// 通用相互作用示例：点电荷、万有引力、碰撞
// 这些不是“某一道题的预置”，而是三类通用相互作用的可直接编辑样板。
// ---------------------------------------------------------------------------

function buildCharges(): Scene {
  const s = emptyScene('点电荷：电场中的轨迹')
  s.meta.note =
    '两个固定点电荷 + 一个试探电荷。库仑力让试探电荷偏转；轨迹、速度、受力都可观测。' +
    '常数用模型相对值（k=1），换电荷/质量/初速度看轨迹怎么变。'
  s.meta.tags = ['库仑力', '场', '轨迹']
  s.params = { q1: 1, q2: -1, qp: 0.2, v0: 1, k: 1 }
  s.world.gravity = 0
  s.world.interactions = { coulomb: { k: 1 } }
  s.world.view = { preset: 'side', elevation: 0, azimuth: 0, scale: 95, center: { x: 0, y: 0.7 } }
  s.world.duration = 3.2
  s.world.timeStep = 1 / 960
  s.world.substeps = 2
  s.bodies = [
    body({ id: 'q1', kind: 'static', shape: { type: 'circle', r: 0.18 }, x: -2, y: 0, material: 'metal', color: '#d95a39', mass: 1, charge: 1, depth: 0.12, label: 'q₁ +1', role: 'object' }),
    body({ id: 'q2', kind: 'static', shape: { type: 'circle', r: 0.18 }, x: 2, y: 0, material: 'metal', color: '#3f6fd0', mass: 1, charge: -1, depth: 0.12, label: 'q₂ −1', role: 'object' }),
    body({ id: 'probe', kind: 'particle', shape: { type: 'circle', r: 0.09 }, x: -1.2, y: 1.6, material: 'metal', color: '#2f8f6b', mass: 0.1, charge: 0.2, velocity: { x: 1, y: 0 }, depth: 0.08, fixedRotation: true, label: '试探电荷 +0.2' }),
  ]
  s.contactPairs = [{ a: 'metal', b: 'metal', mu: 0, restitution: 0.2 }]
  s.observers = [
    { id: 'trail', kind: 'trail', bodyId: 'probe', len: 1200 },
    { id: 'vel', kind: 'vector', bodyId: 'probe', which: ['v'], scale: 0.22 },
    { id: 'chart', kind: 'chart', axis: 't', series: [{ bodyId: 'probe', quantity: 'v' }], title: 'v–t', unit: 'm/s' },
  ]
  s.criteria = [{ id: 'energy', kind: 'conserve', quantity: 'E', tol: 0.03, label: '能量' }]
  s.guides = []
  return s
}

/**
 * 气缸参数 → 气体。
 *
 * 这个 layout 补的是一个**真 bug**：`buildGas` 声明了 `params = { T, n, P0 }`，
 * 但没人读它——温度硬编码在 `gases[0].temperature = 300` 里。
 * 于是左面板三个滑杆拖了完全没反应，看起来像功能，其实是死控件。
 */
function layoutGas(s: Scene): void {
  const g = s.gases[0]
  if (!g) return
  g.temperature = s.params.T ?? 300
  g.n = s.params.n ?? 1
  g.ambientPressure = s.params.P0 ?? 100
}

function buildOrbit(): Scene {
  const s = emptyScene('万有引力：卫星轨迹')
  s.meta.note =
    '恒星固定，行星以圆轨道速度起步。G=1、M=1000、r=100，速度 √(GM/r)≈3.16。' +
    '打开能量判据看轨道是否守恒；拖半径/速度试椭圆。'
  s.meta.tags = ['万有引力', '轨道', '轨迹']
  s.params = { M: 1000, m: 1, r: 100, v: Math.sqrt(10), G: 1 }
  s.world.gravity = 0
  s.world.interactions = { gravityNBody: { G: 1 } }
  s.world.view = { preset: 'side', elevation: 0, azimuth: 0, scale: 2.4, center: { x: 0, y: 0 }, fit: false }
  s.world.duration = 210
  s.world.timeStep = 0.05
  s.world.substeps = 2
  s.bodies = [
    body({ id: 'star', kind: 'static', shape: { type: 'circle', r: 6 }, x: 0, y: 0, material: 'metal', color: '#d09227', mass: 1000, depth: 0.2, label: '恒星 M=1000', role: 'object' }),
    body({ id: 'planet', kind: 'particle', shape: { type: 'circle', r: 2 }, x: 100, y: 0, material: 'metal', color: '#3f6fd0', mass: 1, velocity: { x: 0, y: Math.sqrt(10) }, fixedRotation: true, depth: 0.12, label: '行星 m=1' }),
  ]
  s.contactPairs = []
  s.observers = [
    { id: 'trail', kind: 'trail', bodyId: 'planet', len: 3000 },
    { id: 'vel', kind: 'vector', bodyId: 'planet', which: ['v'], scale: 2 },
    { id: 'chart', kind: 'chart', axis: 't', series: [{ bodyId: 'planet', quantity: 'v' }], title: 'v–t', unit: 'm/s' },
  ]
  s.criteria = [{ id: 'energy', kind: 'conserve', quantity: 'E', tol: 0.03, label: '能量' }]
  s.guides = []
  return s
}

function buildCollision(): Scene {
  const s = emptyScene('两球碰撞：动量与能量')
  s.meta.note =
    '光滑水平面上的两个等质量小球，一追一迎。完全弹性碰撞：交换速度、动量守恒、动能守恒。' +
    '把恢复系数/e 改成 0 看完全非弹性。'
  s.meta.tags = ['碰撞', '动量', '能量']
  s.params = { m1: 1, m2: 1, v1: 2, v2: -1, e: 1 }
  s.world.gravity = 0
  s.world.view = { preset: 'side', elevation: 0, azimuth: 0, scale: 110, center: { x: 0, y: 0 } }
  s.world.duration = 5
  s.world.timeStep = 1 / 960
  s.world.substeps = 2
  s.bodies = [
    body({ id: 'A', kind: 'particle', shape: { type: 'circle', r: 0.3 }, x: -3, y: 0, material: 'rubber', color: '#d95a39', mass: 1, velocity: { x: 2, y: 0 }, fixedRotation: true, depth: 0.12, label: 'A 1 kg' }),
    body({ id: 'B', kind: 'particle', shape: { type: 'circle', r: 0.3 }, x: 3, y: 0, material: 'rubber', color: '#3f6fd0', mass: 1, velocity: { x: -1, y: 0 }, fixedRotation: true, depth: 0.12, label: 'B 1 kg' }),
  ]
  s.contactPairs = [{ a: 'rubber', b: 'rubber', mu: 0, restitution: 1 }]
  s.observers = [
    { id: 'trailA', kind: 'trail', bodyId: 'A', len: 700 },
    { id: 'trailB', kind: 'trail', bodyId: 'B', len: 700 },
    { id: 'vel', kind: 'vector', bodyId: 'A', which: ['v'], scale: 0.4 },
    { id: 'chart', kind: 'chart', axis: 't', series: [{ bodyId: 'A', quantity: 'v' }, { bodyId: 'B', quantity: 'v' }], title: 'v–t', unit: 'm/s' },
  ]
  s.criteria = [
    { id: 'p', kind: 'conserve', quantity: 'p', tol: 0.03, label: '动量' },
    { id: 'e', kind: 'conserve', quantity: 'E', tol: 0.03, label: '能量' },
  ]
  s.guides = []
  return s
}


// ---------------------------------------------------------------------------
// 热学/连接体示例：气缸理想气体、滑轮连接体
// ---------------------------------------------------------------------------

function buildGas(): Scene {
  const s = emptyScene('气缸：理想气体')
  s.meta.note =
    '竖直气缸 + 可动活塞，气体在活塞下方。P = nRT/V，活塞受气体压力、外界压强和重力；' +
    '缓慢升温看活塞上移。参数是模型相对值。'
  s.meta.tags = ['理想气体', '热学', '活塞']
  s.params = { T: 300, n: 1, P0: 100 }
  s.world.view = { preset: 'side', elevation: 0, azimuth: 0, scale: 145, center: { x: 0, y: -0.4 } }
  s.world.duration = 6
  s.world.timeStep = 1 / 960
  s.world.substeps = 2
  s.bodies = [
    body({
      id: 'cylinder',
      kind: 'static',
      shape: {
        type: 'compound',
        parts: [boxPoly(0, -2.1, 2.0, 0.2), boxPoly(-0.95, -0.4, 0.1, 3.4), boxPoly(0.95, -0.4, 0.1, 3.4)],
      },
      x: 0,
      y: 0,
      material: 'stone',
      color: '#8b96a8',
      depth: 0.2,
      label: '气缸',
    }),
    body({
      id: 'piston',
      kind: 'particle',
      shape: { type: 'rect', w: 1.6, h: 0.15 },
      x: 0,
      y: -0.3,
      material: 'metal',
      color: '#4a6585',
      mass: 0.5,
      fixedRotation: true,
      linearDamping: 0.6,
      depth: 0.14,
      label: '活塞',
    }),
  ]
  s.gases = [
    {
      id: 'gas',
      cylinderId: 'cylinder',
      pistonId: 'piston',
      floorY: -2.0,
      width: 1.8,
      pistonHalf: 0.075,
      area: 1.6,
      n: 1,
      temperature: 300,
      ambientPressure: 100,
      gasConstant: 1,
      label: '气体',
    },
  ]
  s.constraints = [
    { id: 'slide', type: 'prismatic', bodyId: 'piston', centerBodyId: 'cylinder', axis: 'y', lower: -1.5, upper: 0.6, anchor: { x: 0, y: -0.3 } },
  ]
  s.contactPairs = []
  s.observers = [
    { id: 'trail', kind: 'trail', bodyId: 'piston', len: 400 },
    { id: 'vel', kind: 'vector', bodyId: 'piston', which: ['v'], scale: 0.35 },
    { id: 'chart', kind: 'chart', axis: 't', series: [{ bodyId: 'piston', quantity: 'y' }], title: '活塞 h–t', unit: 'm' },
  ]
  s.criteria = []
  s.guides = []
  return s
}

function buildPulley(): Scene {
  const s = emptyScene('滑轮：连接体')
  s.meta.note =
    '一根绳跨过定滑轮，两端是 1 kg 和 1.5 kg。绳长约束让两端加速度大小相同；' +
    '看 A 上升、B 下降，验证 (m₁−m₂)/(m₁+m₂)·g。'
  s.meta.tags = ['连接体', '滑轮', '牛顿定律']
  s.params = { m1: 1, m2: 1.5 }
  s.world.view = { preset: 'side', elevation: 0, azimuth: 0, scale: 140, center: { x: 0, y: 1.2 }, fit: false }
  s.world.duration = 4
  s.world.timeStep = 1 / 960
  s.world.substeps = 2
  s.bodies = [
    body({ id: 'A', kind: 'particle', shape: { type: 'circle', r: 0.25 }, x: -0.4, y: 0.3, material: 'metal', color: '#d95a39', mass: 1, fixedRotation: true, depth: 0.12, label: 'A 1 kg' }),
    body({ id: 'B', kind: 'particle', shape: { type: 'circle', r: 0.25 }, x: 0.4, y: 0.3, material: 'metal', color: '#3f6fd0', mass: 1.5, fixedRotation: true, depth: 0.12, label: 'B 1.5 kg' }),
  ]
  s.constraints = [
    {
      id: 'pulley',
      type: 'pulley',
      a: { bodyId: 'A', local: { x: 0, y: 0.25 } },
      b: { bodyId: 'B', local: { x: 0, y: 0.25 } },
      groundA: { x: -0.4, y: 2.4 },
      groundB: { x: 0.4, y: 2.4 },
      lengthA: 1.6,
      lengthB: 1.6,
      ratio: 1,
      pulley: { x: 0, y: 2.4 },
    },
  ]
  s.contactPairs = []
  s.observers = [
    { id: 'trailA', kind: 'trail', bodyId: 'A', len: 700 },
    { id: 'trailB', kind: 'trail', bodyId: 'B', len: 700 },
    { id: 'vel', kind: 'vector', bodyId: 'A', which: ['v'], scale: 0.5 },
    { id: 'chart', kind: 'chart', axis: 't', series: [{ bodyId: 'A', quantity: 'v' }, { bodyId: 'B', quantity: 'v' }], title: 'v–t', unit: 'm/s' },
  ]
  s.criteria = [{ id: 'energy', kind: 'conserve', quantity: 'E', tol: 0.05, label: '能量' }]
  s.guides = []
  return s
}


// ---------------------------------------------------------------------------
// 多过程组合：斜面 → 水平 → 凸圆弧
// 通用组合器：换角度/长度/半径/摩擦就是另一道多过程题，不写死题目
// ---------------------------------------------------------------------------


function buildRampChain(): Scene {
  const s = emptyScene('多过程：斜面 → 水平 → 圆弧')
  s.meta.note =
    '同一套几何：斜面 → 粗糙水平 → 上坡。换角度/长度/摩擦就是新的多过程题。' +
    '滑块从斜面滑下、过水平段、冲上上坡；水平段摩擦会拿走机械能。'
  s.meta.tags = ['多过程', '斜面', '圆弧', '能量']
  s.params = { slopeDeg: 35, slopeLen: 3, flatLen: 2, upDeg: 30, upLen: 1.5, flatMu: 0.2 }
  s.world.view = { preset: 'side', elevation: 0, azimuth: 0, scale: 150, center: { x: 0.4, y: 0.8 } }
  s.world.duration = 6
  s.world.timeStep = 1 / 960
  s.world.substeps = 2
  const deg = 35
  const th = (deg * Math.PI) / 180
  const L = 3
  const F = 2
  const R = 0.9
  const arc = (60 * Math.PI) / 180
  const B = { x: 0, y: 0 }
  const A = { x: B.x - L * Math.cos(th), y: B.y + L * Math.sin(th) }
  const Cpt = { x: F, y: 0 }
  const center = { x: Cpt.x, y: Cpt.y - R }
  const s0 = 0.12
  const start = { x: A.x + (B.x - A.x) * s0, y: A.y + (B.y - A.y) * s0 }
  const nx = -Math.sin(th)
  const ny = Math.cos(th)
  const half = 0.11
  s.bodies = [
    body({ id: 'ground', kind: 'static', shape: { type: 'rect', w: 14, h: 0.28 }, x: 2, y: -0.14, material: 'smooth', color: '#aeb7c4', depth: 0.12, label: '地面' }),
    body({ id: 'slope', kind: 'static', shape: { type: 'polyline', points: [{ x: A.x - B.x, y: A.y - B.y }, { x: 0, y: 0 }], thick: 0.05 }, x: B.x, y: B.y, material: 'slope', color: C.ramp, depth: 0.2, label: '斜面' }),
    body({ id: 'flat', kind: 'static', shape: { type: 'polyline', points: [{ x: 0, y: 0 }, { x: F + 1.2, y: 0 }], thick: 0.05 }, x: 0, y: 0, material: 'flat', color: C.ramp, depth: 0.2, label: '水平段' }),
    body({ id: 'upslope', kind: 'static', shape: { type: 'polyline', points: [{ x: 0, y: 0 }, { x: 1.5 * Math.cos(0.5236), y: 1.5 * Math.sin(0.5236) }], thick: 0.05 }, x: F, y: 0, material: 'arc', color: C.ramp, depth: 0.2, label: '上坡' }),
    body({ id: 'block', kind: 'particle', shape: { type: 'rect', w: 0.22, h: 0.18 }, x: start.x + nx * half, y: start.y + ny * half, angle: -th, material: 'metal', color: C.block, mass: 0.5, fixedRotation: true, depth: 0.12, label: '滑块' }),
  ]
  s.contactPairs = [
    { a: 'metal', b: 'slope', mu: 0, restitution: 0 },
    { a: 'metal', b: 'flat', mu: 0.2, restitution: 0 },
    { a: 'metal', b: 'arc', mu: 0.02, restitution: 0 },
  ]
  s.observers = [
    { id: 'trail', kind: 'trail', bodyId: 'block', len: 1200 },
    { id: 'vel', kind: 'vector', bodyId: 'block', which: ['v'], scale: 0.2 },
    { id: 'chart', kind: 'chart', axis: 't', series: [{ bodyId: 'block', quantity: 'v' }], title: 'v–t', unit: 'm/s' },
  ]
  s.criteria = []
  s.guides = []
  return s
}


// ---------------------------------------------------------------------------
// 多体碰撞 / 正交电磁场
// ---------------------------------------------------------------------------

function buildMultiCollision(): Scene {
  const s = emptyScene('多体碰撞：动量与能量')
  s.meta.note =
    '三个等质量小球排成一行，A 以 2 m/s 撞向静止的 B、C。完全弹性碰撞：速度逐个传递，' +
    '总动量、总动能守恒；改质量/恢复系数看非弹性。'
  s.meta.tags = ['多体碰撞', '动量', '能量']
  s.params = { m: 1, e: 1 }
  s.world.gravity = 0
  s.world.view = { preset: 'side', elevation: 0, azimuth: 0, scale: 95, center: { x: 0, y: 0 } }
  s.world.duration = 5
  s.world.timeStep = 1 / 960
  s.world.substeps = 2
  s.bodies = [
    body({ id: 'A', kind: 'particle', shape: { type: 'circle', r: 0.3 }, x: -3, y: 0, material: 'rubber', color: '#d95a39', mass: 1, velocity: { x: 2, y: 0 }, fixedRotation: true, depth: 0.12, label: 'A' }),
    body({ id: 'B', kind: 'particle', shape: { type: 'circle', r: 0.3 }, x: 0, y: 0, material: 'rubber', color: '#3f6fd0', mass: 1, fixedRotation: true, depth: 0.12, label: 'B' }),
    body({ id: 'C', kind: 'particle', shape: { type: 'circle', r: 0.3 }, x: 3, y: 0, material: 'rubber', color: '#2f8f6b', mass: 1, fixedRotation: true, depth: 0.12, label: 'C' }),
  ]
  s.contactPairs = [{ a: 'rubber', b: 'rubber', mu: 0, restitution: 1 }]
  s.observers = [
    { id: 'trailA', kind: 'trail', bodyId: 'A', len: 500 },
    { id: 'trailB', kind: 'trail', bodyId: 'B', len: 500 },
    { id: 'trailC', kind: 'trail', bodyId: 'C', len: 500 },
    { id: 'vel', kind: 'vector', bodyId: 'A', which: ['v'], scale: 0.5 },
    { id: 'chart', kind: 'chart', axis: 't', series: [{ bodyId: 'A', quantity: 'v' }, { bodyId: 'B', quantity: 'v' }, { bodyId: 'C', quantity: 'v' }], title: 'v–t', unit: 'm/s' },
  ]
  s.criteria = [
    { id: 'p', kind: 'conserve', quantity: 'p', tol: 0.04, label: '动量' },
    { id: 'e', kind: 'conserve', quantity: 'E', tol: 0.04, label: '能量' },
  ]
  s.guides = []
  return s
}

function buildCrossedFields(): Scene {
  const s = emptyScene('正交电磁场：速度选择')
  s.meta.note =
    '带电粒子同时受匀强电场和匀强磁场。E、B 正交时，轨迹是摆线/直线；调 E 和 B 看偏转。' +
    '这是通用场组件，不是某道题的预置。'
  s.meta.tags = ['电场', '磁场', '洛伦兹力']
  s.params = { E: 1, B: 2, q: 1, m: 1 }
  s.world.gravity = 0
  s.world.view = { preset: 'side', elevation: 0, azimuth: 0, scale: 80, center: { x: 0.4, y: 0.6 } }
  s.world.duration = 5
  s.world.timeStep = 1 / 960
  s.world.substeps = 2
  s.bodies = [
    body({ id: 'probe', kind: 'particle', shape: { type: 'circle', r: 0.12 }, x: 0, y: 0, material: 'metal', color: '#2f8f6b', mass: 1, charge: 1, velocity: { x: 1, y: 0 }, fixedRotation: true, depth: 0.08, label: 'q' }),
  ]
  s.fields = [
    { id: 'E', kind: 'uniform', type: 'E', vector: { x: 0, y: 1 } },
    { id: 'B', kind: 'uniform', type: 'B', bz: 2 },
  ]
  s.contactPairs = []
  s.observers = [
    { id: 'trail', kind: 'trail', bodyId: 'probe', len: 1200 },
    { id: 'vel', kind: 'vector', bodyId: 'probe', which: ['v'], scale: 0.25 },
    { id: 'chart', kind: 'chart', axis: 't', series: [{ bodyId: 'probe', quantity: 'v' }], title: 'v–t', unit: 'm/s' },
  ]
  s.criteria = []
  s.guides = []
  return s
}


/**
 * 导体棒切割磁感线（单棒 + 导轨 + 回路电阻）。
 *
 * 这是「电磁感应」那一类题的最小模型：棒在恒力作用下加速，速度一起来
 * 动生电动势就有、电流就有、安培力就反抗——加速度越来越小，最后匀速。
 * 收尾速度 v∞ = F·R/(B²L²)，动能上限也就定了，这就是题里要问的那个速度。
 *
 * 只做单棒：双棒题各挂一条 circuit、共享同一个 R 就能表达（本预置不做）。
 */
function buildRailEmf(): Scene {
  const L = 0.8 // 导轨间距 = 棒的有效长度
  const RAIL_T = 0.08
  const s = emptyScene('导体棒切割磁感线：收尾速度')
  s.meta.note =
    '导轨光滑、磁场垂直纸面向外。棒被恒力拉动，速度越大安培力越大，' +
    '加速度越来越小，最终匀速 v = F·R/(B²L²)。改 F / R / B 看收尾速度怎么变。'
  s.meta.tags = ['电磁感应', '安培力', '收尾速度']
  s.params = { B: 1, Lrod: L, res: 1, F: 1 }
  s.world.gravity = 9.8
  s.world.view = { preset: 'side', elevation: 0, azimuth: 0, scale: 150, center: { x: 0, y: 0 } }
  s.world.duration = 3.5
  s.world.timeStep = 1 / 960
  s.world.substeps = 2
  s.bodies = [
    // 上下两根导轨（光滑，只负责托住棒）
    body({ id: 'railTop', kind: 'static', shape: { type: 'rect', w: 10, h: RAIL_T }, x: 0, y: L / 2, material: 'smooth', color: '#8d97a6', depth: 0.1, label: '导轨', role: 'terrain' }),
    body({ id: 'railBottom', kind: 'static', shape: { type: 'rect', w: 10, h: RAIL_T }, x: 0, y: -L / 2, material: 'smooth', color: '#8d97a6', depth: 0.1, label: '导轨', role: 'terrain' }),
    // 导体棒：竖直，跨在两根导轨之间
    body({
      id: 'rod',
      kind: 'rigid',
      shape: { type: 'rect', w: 0.07, h: L - RAIL_T },
      x: -3,
      y: 0,
      material: 'metal',
      color: '#c98a3a',
      mass: 0.5,
      fixedRotation: true,
      depth: 0.14,
      label: '导体棒',
      role: 'object',
    }),
  ]
  // 默认拉力：layout 会按 params.F 重算，这里给个初值，直接 build 也有力可拉
  const rod = s.bodies.find((b) => b.id === 'rod')!
  rod.forces = [{ id: 'pull', x: 1, y: 0 }]
  s.contactPairs = [
    { a: 'metal', b: 'smooth', mu: 0, restitution: 0 },
    { a: 'smooth', b: 'smooth', mu: 0, restitution: 0 },
  ]
  s.constraints = [
    // 只能沿导轨方向滑
    { id: 'rail', type: 'prismatic', bodyId: 'rod', centerBodyId: 'railBottom', axis: 'x', lower: -2, upper: 8 },
    // 恒定的外力（拉力），不撤去
    { id: 'circuit', type: 'circuit', bodyId: 'rod', fieldId: 'B', length: L, resistance: 1, axis: 'x' },
  ]
  s.fields = [{ id: 'B', kind: 'uniform', type: 'B', bz: 1, label: 'B 向外' }]
  s.observers = [
    { id: 'trail', kind: 'trail', bodyId: 'rod', len: 600 },
    { id: 'vel', kind: 'vector', bodyId: 'rod', which: ['v'], scale: 0.2 },
    { id: 'chart', kind: 'chart', axis: 't', series: [{ bodyId: 'rod', quantity: 'v' }], title: 'v–t', unit: 'm/s' },
  ]
  s.criteria = []
  s.guides = []
  return s
}

/** 恒力拉动由 layout 展开成 forces，参数改了才能生效 */
function layoutRailEmf(s: Scene): void {
  const rod = s.bodies.find((b) => b.id === 'rod')
  if (!rod) return
  const RAIL_T = 0.08
  const L = s.params.Lrod ?? 0.8
  const F = s.params.F ?? 1
  rod.forces = [{ id: 'pull', x: F, y: 0 }]
  rod.mass = s.params.m ?? 0.5
  // 有效长度变了，棒和导轨都得跟着变——不然「改 L」只是改了个数字，画面不动
  if (rod.shape.type === 'rect') rod.shape = { type: 'rect', w: rod.shape.w, h: Math.max(0.1, L - RAIL_T) }
  const top = s.bodies.find((b) => b.id === 'railTop')
  const bottom = s.bodies.find((b) => b.id === 'railBottom')
  if (top) top.transform = { ...top.transform, y: L / 2 }
  if (bottom) bottom.transform = { ...bottom.transform, y: -L / 2 }
  const c = s.constraints.find((x) => x.type === 'circuit')
  if (c && c.type === 'circuit') {
    c.resistance = s.params.res ?? 1
    c.length = L
  }
  const f = s.fields.find((x) => x.id === 'B')
  if (f && f.kind === 'uniform' && f.type === 'B') f.bz = s.params.B ?? 1
}

export function buildArcChain(): Scene {
  const s = emptyScene('多过程：斜面 → 水平 → 圆弧')
  s.meta.note =
    '斜面 → 粗糙水平 → 圆弧。圆弧用光滑折线近似，小球从水平段切向进入；' +
    '换半径/圆心角就是新的圆弧题。'
  s.meta.tags = ['多过程', '圆弧', '轨道约束']
  s.params = { slopeDeg: 35, slopeLen: 3, flatLen: 2, arcR: 1, arcDeg: 60, flatMu: 0.15 }
  s.world.view = { preset: 'side', elevation: 0, azimuth: 0, scale: 150, center: { x: 0.6, y: 0.8 } }
  s.world.duration = 6
  s.world.timeStep = 1 / 960
  s.world.substeps = 2
  const th = (35 * Math.PI) / 180
  const L = 3
  const F = 2
  const R = 1
  const arc = (60 * Math.PI) / 180
  const half = 0.11
  const B = { x: 0, y: 0 }
  const A = { x: B.x - L * Math.cos(th), y: B.y + L * Math.sin(th) }
  const center = { x: F, y: R }
  const s0 = 0.12
  const start = { x: A.x + (B.x - A.x) * s0, y: A.y + (B.y - A.y) * s0 }
  const nx = -Math.sin(th)
  const ny = Math.cos(th)
  s.bodies = [
    body({ id: 'ground', kind: 'static', shape: { type: 'rect', w: 14, h: 0.28 }, x: 2, y: -0.14, material: 'smooth', color: '#aeb7c4', depth: 0.12, label: '地面' }),
    body({ id: 'slope', kind: 'static', shape: { type: 'polyline', points: [{ x: A.x - B.x, y: A.y - B.y }, { x: 0, y: 0 }], thick: 0.05 }, x: B.x, y: B.y, material: 'slope', color: C.ramp, depth: 0.2, label: '斜面' }),
    body({ id: 'flat', kind: 'static', shape: { type: 'polyline', points: [{ x: 0, y: 0 }, { x: F + 1.2, y: 0 }], thick: 0.05 }, x: 0, y: 0, material: 'flat', color: C.ramp, depth: 0.2, label: '水平段' }),
    body({ id: 'arc', kind: 'static', shape: { type: 'polyline', points: Array.from({ length: 13 }, (_, k) => { const a = -Math.PI / 2 + (Math.PI / 3) * (k / 12); return { x: R * Math.cos(a), y: R * Math.sin(a) } }), thick: 0.05 }, x: F, y: R, material: 'arc', color: C.ramp, depth: 0.2, label: '圆弧' }),
    body({ id: 'block', kind: 'particle', shape: { type: 'circle', r: half }, x: start.x + nx * half, y: start.y + ny * half, angle: 0, material: 'metal', color: C.block, mass: 0.5, fixedRotation: true, depth: 0.12, label: '小球' }),
  ]
  s.contactPairs = [
    { a: 'metal', b: 'slope', mu: 0, restitution: 0 },
    { a: 'metal', b: 'flat', mu: 0.15, restitution: 0 },
    { a: 'metal', b: 'arc', mu: 0.02, restitution: 0 },
  ]
  s.constraints = []
  s.observers = [
    { id: 'trail', kind: 'trail', bodyId: 'block', len: 1200 },
    { id: 'vel', kind: 'vector', bodyId: 'block', which: ['v'], scale: 0.2 },
    { id: 'chart', kind: 'chart', axis: 't', series: [{ bodyId: 'block', quantity: 'v' }], title: 'v–t', unit: 'm/s' },
  ]
  s.criteria = []
  s.guides = []
  return s
}

export const PRESETS: ScenePreset[] = [
  {
    id: 'incline',
    title: '斜面滑块',
    subtitle: '题目假设：滑块（平动）；θ、μ、v₀ 决定加速度',
    chips: ['参数层', '模型层'],
    build: buildIncline,
    layout: layoutIncline,
  },
  {
    id: 'trough',
    title: '半圆槽',
    subtitle: '槽放在光滑水平面上：球还能到等高位置吗？',
    chips: ['条件层', '推翻直觉'],
    build: buildTrough,
    layout: layoutTrough,
  },
  {
    id: 'loop',
    title: '竖直圆轨道',
    subtitle: '拖到某个速度，轨迹突然翻转：恰好过最高点',
    chips: ['判据', '临界'],
    build: buildLoop,
    layout: layoutLoop,
  },
  {
    id: 'projectile',
    title: '平抛',
    subtitle: '不计空气阻力：落点由 v₀ 和 h 决定',
    chips: ['模型层', '理想化假设'],
    build: buildProjectile,
    layout: layoutProjectile,
  },
  {
    id: 'spring',
    title: '弹簧振子',
    subtitle: '拉离平衡位置：周期由 k 和质量决定，与振幅无关',
    chips: ['弹簧', '简谐运动'],
    build: buildSpring,
    layout: layoutSpring,
  },
  {
    id: 'pendulum',
    title: '单摆',
    subtitle: '绳的拉力一直在变：最低点最大，最高点最小',
    chips: ['绳', '受力图'],
    build: buildPendulum,
    layout: layoutPendulum,
  },
  {
    id: 'rampArc',
    title: '斜面 + 圆弧',
    subtitle: '题目假设：圆弧光滑；改圆弧摩擦看能量损耗',
    chips: ['力学', '圆周运动', '能量'],
    build: buildRampArc,
    layout: layoutRampArc,
  },
  {
    id: 'efield',
    title: '电场中的带电粒子',
    subtitle: '匀强电场里的类平抛；把 E 调到 0 就回到直线',
    chips: ['场力', '类平抛'],
    build: buildEfield,
    layout: layoutEfield,
  },
  {
    id: 'boardBlock',
    title: '板块 + 平抛',
    subtitle: '薄板会被推走吗：板块摩擦 + 平抛',
    chips: ['板块', '多体', '平抛'],
    build: buildBoardBlock,
    layout: layoutBoardBlock,
  },
  {
    id: 'charges',
    title: '点电荷：电场中的轨迹',
    subtitle: '两个固定电荷 + 一个试探电荷：库仑力让轨迹偏转',
    chips: ['库仑力', '场', '轨迹'],
    build: buildCharges,
  },
  {
    id: 'orbit',
    title: '万有引力：卫星轨迹',
    subtitle: '恒星 + 行星：圆轨道/椭圆轨道，能量守恒',
    chips: ['万有引力', '轨道', '轨迹'],
    build: buildOrbit,
  },
  {
    id: 'collision',
    title: '两球碰撞：动量与能量',
    subtitle: '光滑水平面，完全弹性碰撞：交换速度',
    chips: ['碰撞', '动量', '能量'],
    build: buildCollision,
  },
  {
    id: 'gas',
    title: '气缸：理想气体',
    subtitle: '竖直气缸 + 活塞：P = nRT/V，升温看活塞上移',
    chips: ['理想气体', '热学', '活塞'],
    build: buildGas,
    layout: layoutGas,
  },
  {
    id: 'pulley',
    title: '滑轮：连接体',
    subtitle: '一根绳跨过定滑轮，两端质量不同：绳长约束 + 加速度',
    chips: ['连接体', '滑轮', '牛顿定律'],
    build: buildPulley,
  },
  {
    id: 'rampChain',
    title: '多过程：斜面 → 水平 → 上坡',
    subtitle: '同一套几何换角度/长度/摩擦：斜面滑下、过粗糙水平、冲上上坡',
    chips: ['多过程', '斜面', '上坡', '能量'],
    build: buildRampChain,
  },
  {
    id: 'multiCollision',
    title: '多体碰撞：动量与能量',
    subtitle: '三个等质量小球：速度逐个传递，总动量/总动能守恒',
    chips: ['多体碰撞', '动量', '能量'],
    build: buildMultiCollision,
  },
  {
    id: 'crossedFields',
    title: '正交电磁场：速度选择',
    subtitle: '电场 + 磁场同时作用：摆线/直线，调 E、B 看偏转',
    chips: ['电场', '磁场', '洛伦兹力'],
    build: buildCrossedFields,
  },
  {
    id: 'arcChain',
    title: '多过程：斜面 → 水平 → 圆弧',
    subtitle: '斜面滑下、过粗糙水平、切向进入圆弧；换半径/圆心角就是新题',
    chips: ['多过程', '圆弧', '能量'],
    build: buildArcChain,
  },
  {
    id: 'railEmf',
    title: '导体棒切割磁感线',
    subtitle: '恒力拉动导轨上的棒：安培力反抗运动，最后匀速 v = FR/(B²L²)',
    chips: ['电磁感应', '安培力', '收尾速度'],
    build: buildRailEmf,
    layout: layoutRailEmf,
  },
]

export function presetById(id: string | null | undefined): ScenePreset | undefined {
  return id ? PRESETS.find((p) => p.id === id) : undefined
}

export function buildPresetScene(id: string): Scene {
  const preset = presetById(id)
  if (!preset) throw new Error(`未知场景：${id}`)
  const s = preset.build()
  s.meta.preset = id
  preset.layout?.(s)
  return s
}

export function blankScene(): Scene {
  const s = emptyScene('空白画布')
  s.meta.note = '自由搭建：画一个形状，它会先落成「地形」，你可以再把它改成会动的物体。'
  s.world.view = { preset: 'side', elevation: 0, azimuth: 0, scale: 110, center: { x: 0, y: 1 } }
  s.bodies = [groundBody()]
s.observers = []
  return s
}
