/**
 * 用户自建组件：**从场景里「存」出来的一段模型**，之后可以插到任何场景里。
 *
 * 为什么这么做：组件不该由产品预先穷举。LLM / 别人分享的模型里总有编辑器没有的组合
 * （两个球 + 一根绳 + 一个斜面 + 一个电荷……），用户觉得好用就存下来——这比我们
 * 猜「他需要什么组件」靠谱得多，而且天然可扩展。
 *
 * 存的单位是「选中集」：物体 + 它们之间的约束 + 气体系统。
 * 不存观测器/判据/区域/场——那些是场景级的东西，跟着组件走只会制造困惑。
 *
 * 坐标：存的时候把整组物体**平移到以中心为原点**，插入时再平移到落点。
 */
import type { Anchor, Body, Constraint, GasSystem, Scene } from './scene'
import type { Vec2 } from './math'
import { cloneScene } from './scene'

export type ComponentInteractions = {
  coulomb?: { k: number }
  gravityNBody?: { G: number }
}

export type SavedComponent = {
  id: string
  name: string
  createdAt: number
  /** 局部坐标（相对组件中心） */
  bodies: Body[]
  constraints: Constraint[]
  gases: GasSystem[]
  /** 组件需要的世界级开关（点电荷要开库仑力、天体要开 N 体引力） */
  interactions?: ComponentInteractions
  plane: Scene['plane']
}

const anchorBodyId = (a: { bodyId: string } | { world: Vec2 }): string | null => ('bodyId' in a ? a.bodyId : null)

/** 约束是否完全落在选中的物体里（两端都得在，否则插到别处就断头） */
function constraintInside(c: Constraint, ids: Set<string>): boolean {
  switch (c.type) {
    case 'rope':
    case 'rod':
    case 'spring':
    case 'hinge':
    case 'pulley': {
      const a = anchorBodyId(c.a)
      const b = anchorBodyId(c.b)
      return (a === null || ids.has(a)) && (b === null || ids.has(b))
    }
    case 'prismatic':
      return ids.has(c.bodyId) && ids.has(c.centerBodyId)
    case 'track':
      return ids.has(c.bodyId) && ids.has(c.centerBodyId)
    default:
      return ids.has(c.bodyId)
  }
}

/** 一个约束引用了哪些物体（世界锚点不算） */
export function constraintBodyIds(c: Constraint): string[] {
  switch (c.type) {
    case 'rope':
    case 'rod':
    case 'spring':
    case 'hinge':
    case 'pulley': {
      const out: string[] = []
      if ('bodyId' in c.a) out.push(c.a.bodyId)
      if ('bodyId' in c.b) out.push(c.b.bodyId)
      return out
    }
    case 'prismatic':
    case 'track':
      return [c.bodyId, c.centerBodyId]
    default:
      return [c.bodyId]
  }
}

/**
 * 从「点中的那个物体」出发，沿约束找出连在一起的整段。
 *
 * 画布目前是单选，所以「存组件」不能靠多选：点中球 A，就顺着绳把球 B 也带上，
 * 点中活塞就把气缸带上。这才是用户心里的「这一坨是一个组件」。
 */
export function componentSelection(scene: Scene, seedId: string, maxBodies = 16): string[] {
  const known = new Set(scene.bodies.map((b) => b.id))
  if (!known.has(seedId)) return []
  const ids = new Set([seedId])
  let grew = true
  while (grew && ids.size < maxBodies) {
    grew = false
    for (const c of scene.constraints) {
      const refs = constraintBodyIds(c).filter((r) => known.has(r))
      if (!refs.some((r) => ids.has(r))) continue
      for (const r of refs) {
        if (ids.has(r)) continue
        ids.add(r)
        grew = true
        if (ids.size >= maxBodies) break
      }
      if (ids.size >= maxBodies) break
    }
  }
  return [...ids]
}

/** 用物体的标签拼一个默认名字：「球 + 绳 + 物块」 */
export function suggestComponentName(bodies: Body[]): string {
  const labels = bodies.map((b) => b.label ?? b.id).filter((v, i, arr) => arr.indexOf(v) === i)
  if (!labels.length) return '组件'
  const head = labels.slice(0, 3).join(' + ')
  return labels.length > 3 ? `${head} 等 ${labels.length} 件` : head
}

/**
 * 从场景里抽一段出来。
 * 返回 null：没选东西，或者选中的约束两端不全在（比如只选了一端的绳子）。
 */
export function extractComponent(
  scene: Scene,
  bodyIds: string[],
  opts: { id?: string; name?: string; now?: number } = {},
): SavedComponent | null {
  const ids = new Set(bodyIds)
  const picked = scene.bodies.filter((b) => ids.has(b.id))
  if (!picked.length) return null

  // 中心：选中物体的平均位置
  const center = picked.reduce(
    (acc, b) => ({ x: acc.x + b.transform.x / picked.length, y: acc.y + b.transform.y / picked.length }),
    { x: 0, y: 0 },
  )

  const bodies = cloneScene(picked).map((b) => ({
    ...b,
    transform: { ...b.transform, x: b.transform.x - center.x, y: b.transform.y - center.y },
  }))
  const constraints = cloneScene(scene.constraints.filter((c) => constraintInside(c, ids)))
  const gases = cloneScene(
    scene.gases.filter((g) => ids.has(g.cylinderId) && ids.has(g.pistonId)),
  )
  const now = opts.now ?? Date.now()
  return {
    id: opts.id ?? `c-${now.toString(36)}-${Math.floor(Math.random() * 1e4).toString(36)}`,
    name: opts.name ?? suggestComponentName(bodies),
    createdAt: now,
    bodies,
    constraints,
    gases,
    interactions: scene.world.interactions ? cloneScene(scene.world.interactions) : undefined,
    plane: scene.plane,
  }
}

function remapConstraint(c: Constraint, map: Map<string, string>, prefix: string): Constraint {
  const a = (x: Anchor): Anchor =>
    'bodyId' in x ? { ...x, bodyId: map.get(x.bodyId) ?? `${prefix}${x.bodyId}` } : { ...x }
  switch (c.type) {
    case 'rope':
    case 'rod':
    case 'spring':
    case 'hinge':
      return { ...c, a: a(c.a), b: a(c.b) }
    case 'pulley':
      return { ...c, a: a(c.a), b: a(c.b) }
    case 'prismatic':
    case 'track':
      return { ...c, bodyId: map.get(c.bodyId) ?? c.bodyId, centerBodyId: map.get(c.centerBodyId) ?? c.centerBodyId }
    default:
      return { ...c, bodyId: map.get(c.bodyId) ?? c.bodyId }
  }
}

export type InsertResult = {
  bodies: Body[]
  constraints: Constraint[]
  gases: GasSystem[]
  /** 插进来的物体 id（插完可以选中它们） */
  ids: string[]
  interactions?: ComponentInteractions
}

/**
 * 把组件插到 `at`（世界坐标）：所有 id 换成新前缀，位置整体平移。
 * 纯函数——调用方拿到结果自己拼 Scene。
 */
export function instantiateComponent(
  comp: SavedComponent,
  at: Vec2,
  opts: { prefix: string },
): InsertResult {
  const prefix = opts.prefix
  const map = new Map<string, string>()
  comp.bodies.forEach((b, i) => map.set(b.id, `${prefix}${i}`))

  const bodies = cloneScene(comp.bodies).map((b) => ({
    ...b,
    id: map.get(b.id)!,
    transform: { ...b.transform, x: b.transform.x + at.x, y: b.transform.y + at.y },
  }))
  const constraints = comp.constraints.map((c, i) => ({
    ...remapConstraint(c, map, prefix),
    id: `${prefix}c${i}`,
  }))
  const gases = cloneScene(comp.gases).map((g) => ({
    ...g,
    id: `${prefix}g-${g.id}`,
    cylinderId: map.get(g.cylinderId) ?? g.cylinderId,
    pistonId: map.get(g.pistonId) ?? g.pistonId,
  }))
  return { bodies, constraints, gases, ids: bodies.map((b) => b.id), interactions: comp.interactions }
}
