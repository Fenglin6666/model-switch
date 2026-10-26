/**
 * Scene 是唯一真相源（铁律一）。
 *
 * 所有层（渲染、物理、判据、UI）都从它派生；物理层不写回。撤销/重做、分享、
 * A/B 对比都只是「换一份 JSON」。
 *
 * 与架构文档 §3 的差异（均为向后兼容的扩展，已在 docs/DECISIONS.md 记录）：
 * - 增加 `shape.type === 'compound'`：一个刚体可由多个形状组成（半圆槽 = 弧 + 底座）。
 * - 增加 `params`：预设场景的标量参数，UI 滑杆绑定它，`layout()` 在每次重置时把它
 *   展开成几何。这样 θ 这种「改一个数就换一套几何」的开关也能用 JSON Pointer 表达。
 * - 匀强磁场用 `bz`（垂直平面的标量）而不是 `vector`，避免二维向量语义含糊。
 * - `chart` 观察器增加 `axis`，支持 y–x 轨迹图（平抛对比必需）。
 * - 增加 `guides`：教学辅助线（等高线、目标线），不参与物理。
 */
import type { Vec2 } from './math'

export type Plane = 'vertical' | 'horizontal'

export type BodyKind = 'static' | 'kinematic' | 'particle' | 'rigid'

export type Shape =
  | { type: 'circle'; r: number }
  | { type: 'rect'; w: number; h: number }
  | { type: 'polygon'; points: Vec2[] }
  /** 圆弧。r = 圆心到**内表面**的半径，厚度向**外侧**（r 增大方向）生长。 */
  | { type: 'arc'; r: number; a0: number; a1: number; thick: number }
  | { type: 'polyline'; points: Vec2[]; thick: number; closed?: boolean }
  | { type: 'bezier'; ctrl: Vec2[]; thick: number }
  | { type: 'compound'; parts: Shape[] }

export type Transform = { x: number; y: number; angle: number }

/** 一个可叠加的外力（N，世界坐标）。多个力用不同颜色和 F1/F2 标签区分。 */
export type ForceDef = { id: string; x: number; y: number }

/** 用户在检查器里改过的字段；布局和分享时在布局之后重新盖回去 */
export type BodyEdit = {
  x?: number
  /** 折线/多边形地形的总长度（模型相对值）；按当前方向等比缩放 */
  length?: number
  radius?: number
  style?: 'solid' | 'thin'
  y?: number
  angle?: number
  friction?: number
  velocity?: Vec2
  mass?: number
  kind?: BodyKind
  role?: 'terrain' | 'object' | 'track'
  forces?: ForceDef[]
  charge?: number
  /** 线性阻尼（气缸活塞这类「缓慢过程」） */
  linearDamping?: number
  /** 初始角速度（刚体） */
  omega?: number
}

export type ConstraintEdit = { length?: number; k?: number; l0?: number; damping?: number; radius?: number }

export type Body = {
  id: string
  kind: BodyKind
  /** 用户给组件的分类：双击在 地形 → 物体 → 轨道 之间切换 */
  role?: 'terrain' | 'object' | 'track'
  shape: Shape
  transform: Transform
  material: string
  /** 缺省时按面积 × 默认密度估算；给定了就以它为准（老师填的质量优先）。 */
  mass?: number
  charge?: number
  appearance: { color: string; depth: number; style?: 'solid' | 'thin' }
  label?: string
  velocity?: Vec2
  omega?: number
  /** 覆盖 kind 的默认值。半圆槽这种「会平动但不翻转」的刚体需要 true。 */
  fixedRotation?: boolean
  /** 线性阻尼（模型相对）：气缸活塞这类“缓慢过程”用 */
  linearDamping?: number
  /** 这个物体表面的摩擦系数；不填就用材质的。接触时取两边的覆盖值。 */
  friction?: number
  /** 兼容旧场景的单个外力；新场景用 forces */
  appliedForce?: Vec2
  /** 常驻外力（N，世界坐标），可以叠加多个 */
  forces?: ForceDef[]
  /** 外力在多少秒后撤去（不填=一直在）。 */
  appliedUntil?: number
  /**
   * 语义端口（转轴 / 挂钩 / 销钉）。几何派生的 center/top/bottom/left/right/四角
   * 不需要声明，见 `ports.ts`。约束可以按端口名连过来，不必算坐标。
   */
  ports?: import('./ports').Port[]
}

export type Material = {
  id: string
  name: string
  /** 物体自身表面粗糙度，只在与没有显式接触对的材质相碰时参与 sqrt 混合 */
  mu: number
  restitution: number
  color: string
}

export type ContactPair = {
  a: string
  b: string
  mu: number
  restitution?: number
}

export type Field =
  | {
      id: string
      kind: 'uniform'
      type: 'E' | 'g'
      vector: Vec2
      regionId?: string
      enabled?: boolean
      label?: string
    }
  | { id: string; kind: 'uniform'; type: 'B'; bz: number; regionId?: string; enabled?: boolean; label?: string }
  | {
      id: string
      kind: 'point'
      type: 'E' | 'g'
      source: Vec2
      strength: number
      regionId?: string
      enabled?: boolean
      label?: string
    }
  | { id: string; kind: 'drag'; k: number; order: 1 | 2; enabled?: boolean; label?: string }

export type Region = {
  id: string
  shape: Shape
  transform: Transform
  label: string
  /** target 用于判据靶子；field 用于限定场的作用域；area 仅作标注 */
  role?: 'target' | 'field' | 'area'
}

export type Observer =
  | { id: string; kind: 'trail'; bodyId: string; len: number; color?: string }
  | { id: string; kind: 'vector'; bodyId: string; which: Array<'v' | 'a' | 'F' | 'p'>; scale: number }
  | {
      id: string
      kind: 'chart'
      axis: 't' | 'x'
      series: Array<{ bodyId: string; quantity: 'x' | 'y' | 'v' | 'a' | 'E' | 'p' }>
      title?: string
      unit?: string
    }
  | { id: string; kind: 'energy'; bodyIds: string[] }
  | { id: string; kind: 'probe'; bodyId: string; fields: string[] }

export type Criterion =
  | {
      id: string
      kind: 'detach'
      bodyId: string
      trackId?: string
      after?: number
      /** 只统计这个时刻之前的脱离（例如「过最高点之前」） */
      until?: number
      hold?: number
      label?: string
    }
  | {
      id: string
      kind: 'reach'
      bodyId: string
      regionId: string
      after?: number
      /** 必须仍然被轨道托着（contactCount > 0）才算到达 */
      requireSupport?: boolean
      label?: string
    }
  | { id: string; kind: 'escape'; bodyId: string; regionId: string; hold?: number; label?: string }
  | { id: string; kind: 'coincide'; bodyA: string; bodyB: string; eps: number; hold?: number; label?: string }
  | { id: string; kind: 'collide'; bodyA: string; bodyB: string; after?: number; label?: string }
  | {
      id: string
      kind: 'conserve'
      quantity: 'E' | 'p'
      tol: number
      /** p 守恒时只比较某个分量（'x' 即「水平动量」） */
      axis?: 'x' | 'y' | 'both'
      bodyIds?: string[]
      label?: string
    }

export type Guide =
  | { id: string; kind: 'hline'; y: number; label?: string; x0?: number; x1?: number }
  | { id: string; kind: 'vline'; x: number; label?: string; y0?: number; y1?: number }
  | { id: string; kind: 'label'; at: Vec2; text: string }

/** 约束：v1 实现 track（圆轨道，只能推不能拉），其余类型先占位。 */
export type Constraint =
  | { id: string; type: 'rope'; a: Anchor; b: Anchor; length: number }
  | { id: string; type: 'rod'; a: Anchor; b: Anchor; length: number }
  | { id: string; type: 'spring'; a: Anchor; b: Anchor; k: number; l0: number; damping: number }
  | { id: string; type: 'hinge'; a: Anchor; b: Anchor }
  | { id: string; type: 'pulley'; a: Anchor; b: Anchor; groundA: Vec2; groundB: Vec2; lengthA: number; lengthB: number; ratio?: number; pulley?: Vec2 }
  | { id: string; type: 'prismatic'; bodyId: string; centerBodyId: string; axis: 'x' | 'y'; lower?: number; upper?: number; anchor?: Vec2 }
  /**
   * 圆轨道约束：把 bodyId 的质心约束在以 centerBodyId 原点为心、radius 为半径的圆上，
   * 只能被“推”不能被“拉”（法向力为负即脱离）。轨道本身不生成碰撞 fixture。
   */
  | {
      id: string
      type: 'track'
      bodyId: string
      centerBodyId: string
      radius: number
      side: 'inner' | 'outer'
      /** 弧段：入场前不挂，走到 entry 附近才挂；到 toAngle 释放 */
      fromAngle?: number
      toAngle?: number
      entry?: Vec2
    }
  | { id: string; type: 'belt'; bodyId: string; speed: number }
  | { id: string; type: 'pin'; bodyId: string; point: Vec2 }
  | { id: string; type: 'motor'; bodyId: string; omega: number }

/**
 * 约束的一端。三种写法，优先级从「说人话」到「说坐标」：
 *   1. `{ bodyId, port }`  —— 命名端口（推荐，agent 和组件都用这个）
 *   2. `{ bodyId, local }` —— 显式局部坐标（旧场景、手画时用）
 *   3. `{ world }`         —— 固定在世界某点（相当于钉在地上）
 */
export type Anchor = { bodyId: string; port: string } | { bodyId: string; local: Vec2 } | { world: Vec2 }

export type World = {
  gravity: number
  /** 固定步长，禁止自适应（确定性是判据搜索的前提） */
  timeStep: number
  substeps: number
  maxSpeed: number
  /** 通用相互作用：点电荷库仑力、N 体万有引力；常数用模型相对值 */
  interactions?: {
    coulomb?: { k: number }
    gravityNBody?: { G: number }
  }
  view: {
    preset: 'side' | 'three'
    elevation: number
    azimuth: number
    scale: number
    center: Vec2
    fit?: boolean
  }
  /** 单次播放的最长仿真时长（秒）。到点自动暂停。 */
  duration?: number
  /** 启动沉静期（秒）：形状刚放上地面会被位置修正顶一下，这段时间不评估判据、不记能量基准 */
  settle?: number
  /** 形状离散精度：teach 粗（能看见折线），verify 细 */
  precision: 'teach' | 'verify'
}

export type GasSystem = {
  id: string
  cylinderId: string
  pistonId: string
  /** 气体内底面的世界 y */
  floorY: number
  /** 气体内宽 */
  width: number
  /** 活塞半厚 */
  pistonHalf: number
  /** 截面积（模型相对） */
  area: number
  /** 物质的量（模型相对） */
  n: number
  /** 温度 K */
  temperature: number
  /** 外界压强 */
  ambientPressure: number
  /** 气体常数，模型相对默认 1 */
  gasConstant?: number
  enabled?: boolean
  label?: string
}

export type Scene = {
  version: 1
  meta: {
    /** 题目解析出的建模假设，用于状态条展示 */
    assumptions?: string[]
    id: string
    title: string
    tags: string[]
    createdAt: number
    updatedAt: number
    note?: string
    /** 来自哪个预置场景（分享出去后还能让滑杆继续生效） */
    preset?: string
  }
  plane: Plane
  world: World
  /** 预设场景的标量参数；layout() 把它展开成几何。 */
  params: Record<string, number>
  materials: Material[]
  contactPairs: ContactPair[]
  bodies: Body[]
  gases: GasSystem[]
  constraints: Constraint[]
  fields: Field[]
  regions: Region[]
  observers: Observer[]
  criteria: Criterion[]
  guides: Guide[]
  /** 用户编辑覆盖层：布局/分享后重新应用，避免被预置布局冲掉 */
  edits?: { bodies?: Record<string, BodyEdit>; constraints?: Record<string, ConstraintEdit> }
}

// ---------------------------------------------------------------------------
// 构造与默认值
// ---------------------------------------------------------------------------

export const DEFAULT_MATERIALS: Material[] = [
  { id: 'stone', name: '石面', mu: 0.7, restitution: 0.04, color: '#8d97a6' },
  { id: 'wood', name: '木质', mu: 0.4, restitution: 0.12, color: '#c08b5c' },
  { id: 'metal', name: '金属', mu: 0.25, restitution: 0.2, color: '#9aa7b8' },
  { id: 'rubber', name: '橡胶', mu: 0.9, restitution: 0.6, color: '#5d6673' },
  { id: 'smooth', name: '光滑', mu: 0, restitution: 0, color: '#aab4c2' },
]

export function defaultWorld(): World {
  return {
    gravity: 9.8,
    timeStep: 1 / 240,
    substeps: 2,
    maxSpeed: 30,
    view: { preset: 'side', elevation: 0, azimuth: 0, scale: 110, center: { x: 0, y: 1 } },
    duration: 6,
    settle: 0.12,
    precision: 'teach',
  }
}

export function emptyScene(title = '未命名场景'): Scene {
  const now = Date.now()
  return {
    version: 1,
    meta: { id: 'scene-' + now.toString(36), title, tags: [], createdAt: now, updatedAt: now },
    plane: 'vertical',
    world: defaultWorld(),
    params: {},
    materials: DEFAULT_MATERIALS.map((m) => ({ ...m })),
    contactPairs: [],
    bodies: [],
    gases: [],
    constraints: [],
    fields: [],
    regions: [],
    observers: [],
    criteria: [],
      guides: [],
  }
}

// ---------------------------------------------------------------------------
// JSON Pointer（RFC 6901）
// ---------------------------------------------------------------------------

export function parsePointer(pointer: string): string[] {
  if (pointer === '' || pointer === '/') return []
  if (!pointer.startsWith('/')) throw new Error(`JSON Pointer 必须以 / 开头：${pointer}`)
  return pointer
    .slice(1)
    .split('/')
    .map((s) => s.replace(/~1/g, '/').replace(/~0/g, '~'))
}

/** 不可变写入：沿路径浅拷贝，未改动子树保持引用。 */
export function setAtPath<T>(root: T, pointer: string, value: unknown): T {
  const parts = parsePointer(pointer)
  if (parts.length === 0) return value as T
  return setIn(root as unknown, parts, 0, value) as T
}

function setIn(node: unknown, parts: string[], i: number, value: unknown): unknown {
  if (i === parts.length) return value
  const key = parts[i]!
  const src = (node ?? {}) as Record<string, unknown>
  const copy: Record<string, unknown> = Array.isArray(src) ? ([...src] as unknown as Record<string, unknown>) : { ...src }
  copy[key] = setIn(src[key], parts, i + 1, value)
  return copy
}

// ---------------------------------------------------------------------------
// 查询与材质
// ---------------------------------------------------------------------------

export function findBody(scene: Scene, id: string | undefined): Body | undefined {
  return id ? scene.bodies.find((b) => b.id === id) : undefined
}

export function findMaterial(scene: Scene, id: string | undefined): Material | undefined {
  return id ? scene.materials.find((m) => m.id === id) : undefined
}

export function findRegion(scene: Scene, id: string | undefined): Region | undefined {
  return id ? scene.regions.find((r) => r.id === id) : undefined
}

export function findCriterion(scene: Scene, id: string): Criterion | undefined {
  return scene.criteria.find((c) => c.id === id)
}

/** 接触对优先；没有显式接触对时退回 Box2D 的 sqrt 混合。 */
export function resolveFriction(scene: Scene, matA: string, matB: string): number {
  for (const p of scene.contactPairs) {
    if ((p.a === matA && p.b === matB) || (p.a === matB && p.b === matA)) return p.mu
  }
  const a = findMaterial(scene, matA)
  const b = findMaterial(scene, matB)
  return Math.sqrt((a?.mu ?? 0.3) * (b?.mu ?? 0.3))
}

export function resolveRestitution(scene: Scene, matA: string, matB: string): number {
  for (const p of scene.contactPairs) {
    if ((p.a === matA && p.b === matB) || (p.a === matB && p.b === matA)) {
      if (p.restitution !== undefined) return p.restitution
    }
  }
  const a = findMaterial(scene, matA)
  const b = findMaterial(scene, matB)
  return Math.max(a?.restitution ?? 0.1, b?.restitution ?? 0.1)
}

export function materialColor(scene: Scene, matId: string): string {
  return findMaterial(scene, matId)?.color ?? '#8d97a6'
}

// ---------------------------------------------------------------------------
// 克隆
// ---------------------------------------------------------------------------

export function cloneScene<T>(v: T): T {
  if (typeof structuredClone === 'function') {
    try {
      return structuredClone(v)
    } catch {
      /* fallthrough */
    }
  }
  return JSON.parse(JSON.stringify(v)) as T
}


/** 把用户编辑覆盖层盖回场景（幂等）。布局/克隆之后调用。 */
export function applyEdits(scene: Scene): Scene {
  const edits = scene.edits
  if (!edits) return scene
  if (edits.bodies) {
    for (const b of scene.bodies) {
      const e = edits.bodies[b.id]
      if (!e) continue
      if (e.x !== undefined) b.transform.x = e.x
      if (e.y !== undefined) b.transform.y = e.y
      if (e.angle !== undefined) b.transform.angle = e.angle
      if (e.friction !== undefined) b.friction = e.friction
      if (e.velocity !== undefined) b.velocity = { ...e.velocity }
      if (e.mass !== undefined) b.mass = e.mass
      if (e.charge !== undefined) b.charge = e.charge
      if (e.linearDamping !== undefined) b.linearDamping = e.linearDamping
      if (e.omega !== undefined) b.omega = e.omega
      if (e.kind !== undefined) b.kind = e.kind
      if (e.role !== undefined) b.role = e.role
      if (e.radius !== undefined && (b.shape.type === 'arc' || b.shape.type === 'circle')) b.shape.r = e.radius
  if (e.length !== undefined && (b.shape.type === 'polyline' || b.shape.type === 'polygon')) {
    const pts = b.shape.points
    let current = 0
    if (b.shape.type === 'polyline') {
      for (let i = 1; i < pts.length; i++) current += Math.hypot(pts[i]!.x - pts[i - 1]!.x, pts[i]!.y - pts[i - 1]!.y)
    } else {
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
      for (const p of pts) { minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y) }
      current = Math.max(maxX - minX, maxY - minY)
    }
    if (current > 1e-9) {
      const f = e.length / current
      b.shape.points = pts.map((p) => ({ x: p.x * f, y: p.y * f }))
    }
  }
      if (e.style !== undefined) b.appearance.style = e.style
      if (e.charge !== undefined) b.charge = e.charge
      if (e.forces !== undefined) b.forces = e.forces.map((f) => ({ ...f }))
    }
  }
  if (edits.constraints) {
    for (const c of scene.constraints) {
      const e = edits.constraints[c.id]
      if (!e) continue
      if (e.length !== undefined && (c.type === 'rope' || c.type === 'rod')) c.length = e.length
      if (e.radius !== undefined && c.type === 'track') c.radius = e.radius
      if (e.k !== undefined && c.type === 'spring') c.k = e.k
      if (e.l0 !== undefined && c.type === 'spring') c.l0 = e.l0
      if (e.damping !== undefined && c.type === 'spring') c.damping = e.damping
    }
  }
  return scene
}

/** 记录一个用户编辑；不覆盖之前记录的其它字段 */
export function recordBodyEdit(scene: Scene, id: string, patch: BodyEdit): void {
  const edits = (scene.edits ??= {})
  const bodies = (edits.bodies ??= {})
  bodies[id] = { ...(bodies[id] ?? {}), ...patch }
}

export function recordConstraintEdit(scene: Scene, id: string, patch: ConstraintEdit): void {
  const edits = (scene.edits ??= {})
  const constraints = (edits.constraints ??= {})
  constraints[id] = { ...(constraints[id] ?? {}), ...patch }
}
