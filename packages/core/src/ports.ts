/**
 * 端口（port）：物体上的「接点」。
 *
 * 为什么要它：约束现在连的是 `Anchor = { bodyId, local }`——一个裸坐标。
 * 这意味着「把绳接到球的上端」要先算出 (0, r)，而 agent 并不知道 r 是多少；
 * 组件沉淀之后坐标还会跟着物体变。
 *
 * 借 Modelica 的 connector 概念：**约束应该连在「端口」上，而不是连在坐标上。**
 *   - `rope.a = { bodyId:'ball', port:'top' }`   ← 说人话
 *   - `rope.a = { bodyId:'ball', local:{x:0,y:0.15} }` ← 只有自己知道 0.15 是哪来的
 *
 * 端口有两类：
 *   1. **几何派生**（center / top / bottom / left / right / 四角）——所有物体都有，不用声明；
 *   2. **语义声明**（axle 转轴 / hook 挂钩 / pin 销钉）——放在 `body.ports` 里，
 *      让「电机接在轴上」「绳接在钩上」有名字可指。
 *
 * 这一层是纯函数，不碰渲染、不碰物理：物理层只负责把端口解析成局部坐标再交给关节。
 */
import type { Body, Scene } from './scene'
import type { Vec2 } from './math'
import { shapeAABB } from './shapes'

export type PortKind = 'center' | 'edge' | 'corner' | 'axle' | 'hook' | 'pin' | 'surface'

export type Port = {
  id: string
  kind: PortKind
  /** 相对物体原点的局部坐标 */
  local: Vec2
  /** 外法线（局部方向）；center 没有法线 */
  normal?: Vec2
  label?: string
}

/** 几何派生的端口 id —— 固定的一组，agent 可以直接引用 */
export const DERIVED_PORT_IDS = ['center', 'top', 'bottom', 'left', 'right', 'tl', 'tr', 'bl', 'br'] as const

const EPS = 1e-9

/**
 * 从形状包围盒派生的端口。所有物体都有，不需要声明。
 * 只用 AABB 是有意的：圆、多边形、复合体的「上端」都用同一个语义，
 * 比按形状逐个定义稳（也更好解释给老师听）。
 */
export function derivedPorts(body: Body): Port[] {
  const box = shapeAABB(body.shape)
  const cx = (box.min.x + box.max.x) / 2
  const cy = (box.min.y + box.max.y) / 2
  const w = box.max.x - box.min.x
  const h = box.max.y - box.min.y
  const ports: Port[] = [{ id: 'center', kind: 'center', local: { x: cx, y: cy }, label: '中心' }]

  // 退化形状（点/零宽）只给中心，别派生出一堆重合的点
  if (w < EPS && h < EPS) return ports

  ports.push(
    { id: 'top', kind: 'edge', local: { x: cx, y: box.max.y }, normal: { x: 0, y: 1 }, label: '上端' },
    { id: 'bottom', kind: 'edge', local: { x: cx, y: box.min.y }, normal: { x: 0, y: -1 }, label: '下端' },
    { id: 'left', kind: 'edge', local: { x: box.min.x, y: cy }, normal: { x: -1, y: 0 }, label: '左端' },
    { id: 'right', kind: 'edge', local: { x: box.max.x, y: cy }, normal: { x: 1, y: 0 }, label: '右端' },
  )
  if (w >= EPS && h >= EPS) {
    ports.push(
      { id: 'tl', kind: 'corner', local: { x: box.min.x, y: box.max.y }, normal: { x: -0.707, y: 0.707 }, label: '左上角' },
      { id: 'tr', kind: 'corner', local: { x: box.max.x, y: box.max.y }, normal: { x: 0.707, y: 0.707 }, label: '右上角' },
      { id: 'bl', kind: 'corner', local: { x: box.min.x, y: box.min.y }, normal: { x: -0.707, y: -0.707 }, label: '左下角' },
      { id: 'br', kind: 'corner', local: { x: box.max.x, y: box.min.y }, normal: { x: 0.707, y: -0.707 }, label: '右下角' },
    )
  }
  return ports
}

/** 几何派生 + 显式声明；**同 id 时声明优先**（允许覆盖派生端口的位置） */
export function bodyPorts(body: Body): Port[] {
  const out = new Map<string, Port>()
  for (const p of derivedPorts(body)) out.set(p.id, p)
  for (const p of body.ports ?? []) out.set(p.id, p)
  return [...out.values()]
}

export function findPort(body: Body, id: string): Port | null {
  return bodyPorts(body).find((p) => p.id === id) ?? null
}

export function bodyById(scene: Scene, id: string): Body | undefined {
  return scene.bodies.find((b) => b.id === id)
}

const rot = (p: Vec2, a: number): Vec2 => ({
  x: p.x * Math.cos(a) - p.y * Math.sin(a),
  y: p.x * Math.sin(a) + p.y * Math.cos(a),
})

export type ResolvedPort = {
  body: Body
  port: Port
  /** 世界坐标 */
  point: Vec2
  /** 世界方向的外法线 */
  normal?: Vec2
}

/** 把「物体 + 端口名」解析成世界坐标。端口不存在就返回 null（交给校验层报错）。 */
export function resolvePort(scene: Scene, bodyId: string, portId: string): ResolvedPort | null {
  const body = bodyById(scene, bodyId)
  if (!body) return null
  const port = findPort(body, portId)
  if (!port) return null
  const r = rot(port.local, body.transform.angle)
  return {
    body,
    port,
    point: { x: body.transform.x + r.x, y: body.transform.y + r.y },
    normal: port.normal ? rot(port.normal, body.transform.angle) : undefined,
  }
}

/** 约束的一端：要么是命名端口，要么是显式局部坐标，要么是世界坐标 */
export type PortRef = { bodyId: string; port: string } | { bodyId: string; local: Vec2 } | { world: Vec2 }

/** 解析任意一端 → 局部坐标（给关节用）+ 世界坐标（给校验/渲染用） */
export function resolvePortRef(scene: Scene, ref: PortRef): { bodyId: string | null; local: Vec2; point: Vec2 } | null {
  if ('world' in ref) return { bodyId: null, local: { x: 0, y: 0 }, point: ref.world }
  if ('port' in ref) {
    const r = resolvePort(scene, ref.bodyId, ref.port)
    if (!r) return null
    return { bodyId: ref.bodyId, local: r.port.local, point: r.point }
  }
  const body = bodyById(scene, ref.bodyId)
  if (!body) return null
  const r = rot(ref.local, body.transform.angle)
  return { bodyId: ref.bodyId, local: ref.local, point: { x: body.transform.x + r.x, y: body.transform.y + r.y } }
}

/**
 * 只取「局部坐标」，不转世界、不建关节。
 * 渲染层和监视器各自有自己的 transform 来源（仿真状态 vs 场景初始），所以它们要的是这一层。
 * 端口不存在时返回 null —— 交给校验层报错，不要在这里猜。
 */
export function anchorLocal(scene: Scene, a: { bodyId: string; port?: string; local?: Vec2 }): Vec2 | null {
  const body = bodyById(scene, a.bodyId)
  if (!body) return null
  if (a.port) {
    const p = findPort(body, a.port)
    return p ? p.local : null
  }
  return a.local ?? null
}

/**
 * 声明一个语义端口（axle / hook / pin）。
 * 位置可以用派生的锚点名指定，避免再算一次坐标：
 *   `semanticPort('shaft', 'axle', body, 'center')`
 */
export function semanticPort(id: string, kind: PortKind, body: Body, at: string | Vec2, label?: string): Port {
  if (typeof at === 'string') {
    const base = findPort(body, at)
    if (!base) return { id, kind, local: { x: 0, y: 0 }, label }
    return { id, kind, local: { ...base.local }, normal: base.normal, label }
  }
  return { id, kind, local: { ...at }, label }
}
