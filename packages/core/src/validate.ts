/**
 * 结构校验：这把「尺」。
 *
 * 借 Modelica 的相容性分析（structural / compatibility analysis）思路：
 * 方程数 ≠ 变量数 → 欠约束或过约束，模型要么解不出来，要么解出无意义的结果。
 * 刚体系统里对应的量是**自由度**：
 *
 *   每个动态体 3 个自由度（x, y, θ；fixedRotation 的粒子是 2 个）
 *   每条约束消去若干自由度（绳 1、铰链 2、导轨 2、轨道 1…）
 *   连通分量内 DOF < 0 → 过约束（冗余约束，求解器会变软/抖）
 *                DOF > 0 → 欠约束（会自由运动；多数是有意的，只报 info）
 *
 * 为什么要有它：LLM 生成的结构**没法靠「看着像」判断对错**（有实证：LLM 评估仿真结果不如人）。
 * 所以正确性必须落在确定性检查上：引用是否悬空、几何是否退化、约束是否冗余。
 *
 * 这是纯函数，不依赖渲染和物理，Node 里能跑，agent 出招后可以立刻自查。
 */
import type { Body, Constraint, Scene, Shape } from './scene'
import { constraintBodyIds } from './components'
import { bodyPorts, findPort } from './ports'

export type DiagnosticLevel = 'error' | 'warn' | 'info'

export type Diagnostic = {
  level: DiagnosticLevel
  /** 稳定的机器可读码，UI/agent 按它分类，不要匹配 message */
  code: string
  message: string
  bodyId?: string
  constraintId?: string
  portId?: string
}

export type DofComponent = {
  bodies: string[]
  constraints: string[]
  /** 这个连通分量还剩几个自由度；<0 就是过约束 */
  dof: number
}

export type SceneReport = {
  diagnostics: Diagnostic[]
  dof: { total: number; components: DofComponent[] }
  /** 没有 error 级诊断 */
  ok: boolean
}

const EPS = 1e-9
const finite = (n: number) => Number.isFinite(n)

/** 一个物体还剩几个自由度 */
export function bodyDof(b: Body): number {
  if (b.kind === 'static') return 0
  if (b.kind === 'kinematic') return 3
  return b.fixedRotation ? 2 : 3
}

/** 一条约束消去几个自由度。motor / belt 是「驱动」，不约束运动，所以是 0。 */
export function constraintDof(c: Constraint): number {
  switch (c.type) {
    case 'rope':
    case 'rod':
    case 'spring':
    case 'track':
    case 'pulley':
      return 1
    case 'hinge':
    case 'pin':
    case 'prismatic':
      return 2
    case 'motor':
    case 'belt':
      return 0
    default:
      return 1
  }
}

function shapeProblems(shape: Shape): string[] {
  switch (shape.type) {
    case 'circle':
      return shape.r > EPS ? [] : ['半径 ≤ 0']
    case 'rect':
      return shape.w > EPS && shape.h > EPS ? [] : ['宽或高 ≤ 0']
    case 'polygon':
      return shape.points.length >= 3 ? [] : ['多边形少于 3 个点']
    case 'polyline':
      return shape.points.length >= 2 ? (shape.thick > EPS ? [] : ['线宽 ≤ 0']) : ['折线少于 2 个点']
    case 'arc':
      return shape.r > EPS ? [] : ['圆弧半径 ≤ 0']
    case 'bezier':
      return shape.ctrl.length >= 2 ? [] : ['贝塞尔控制点少于 2 个']
    case 'compound':
      return shape.parts.length ? [] : ['复合体没有子形状']
    default:
      return []
  }
}

/** 并查集：把约束连起来的物体归到同一个连通分量 */
function makeUnionFind(ids: string[]) {
  const parent = new Map<string, string>(ids.map((id) => [id, id]))
  const find = (x: string): string => {
    let r = x
    while (parent.get(r) !== r) r = parent.get(r)!
    let c = x
    while (parent.get(c) !== r) {
      const next = parent.get(c)!
      parent.set(c, r)
      c = next
    }
    return r
  }
  const union = (a: string, b: string) => {
    const ra = find(a)
    const rb = find(b)
    if (ra !== rb) parent.set(ra, rb)
  }
  return { find, union }
}

export function analyzeScene(scene: Scene): SceneReport {
  const diags: Diagnostic[] = []
  const add = (d: Diagnostic) => diags.push(d)

  // ---- id 唯一 ----
  const seenBody = new Set<string>()
  for (const b of scene.bodies) {
    if (seenBody.has(b.id)) add({ level: 'error', code: 'duplicate-body', message: `物体 id 重复：${b.id}`, bodyId: b.id })
    seenBody.add(b.id)
  }
  const seenCon = new Set<string>()
  for (const c of scene.constraints) {
    if (seenCon.has(c.id)) add({ level: 'error', code: 'duplicate-constraint', message: `约束 id 重复：${c.id}`, constraintId: c.id })
    seenCon.add(c.id)
  }

  // ---- 物体本身 ----
  for (const b of scene.bodies) {
    if (!finite(b.transform.x) || !finite(b.transform.y) || !finite(b.transform.angle)) {
      add({ level: 'error', code: 'non-finite-transform', message: `${b.id} 的坐标不是有限数`, bodyId: b.id })
    }
    const shapeBad = shapeProblems(b.shape)
    if (shapeBad.length) {
      add({ level: 'error', code: 'degenerate-shape', message: `${b.id} 几何退化：${shapeBad.join('、')}`, bodyId: b.id })
    }
    if (b.kind !== 'static' && b.mass !== undefined && b.mass <= EPS) {
      add({ level: 'error', code: 'zero-mass', message: `${b.id} 质量 ≤ 0，仿真会炸`, bodyId: b.id })
    }
    if (b.velocity && (!finite(b.velocity.x) || !finite(b.velocity.y))) {
      add({ level: 'error', code: 'non-finite-velocity', message: `${b.id} 的速度不是有限数`, bodyId: b.id })
    }
    for (const p of b.ports ?? []) {
      if (!finite(p.local.x) || !finite(p.local.y)) {
        add({ level: 'error', code: 'non-finite-port', message: `${b.id} 的端口 ${p.id} 坐标不是有限数`, bodyId: b.id, portId: p.id })
      }
    }
  }

  // ---- 约束引用 ----
  for (const c of scene.constraints) {
    for (const id of constraintBodyIds(c)) {
      if (!seenBody.has(id)) {
        add({ level: 'error', code: 'dangling-body', message: `约束 ${c.id} 指向不存在的物体 ${id}`, constraintId: c.id })
      }
    }
    for (const a of ['a', 'b'] as const) {
      const anchor = (c as { a?: unknown; b?: unknown })[a]
      if (!anchor || typeof anchor !== 'object' || !('bodyId' in anchor)) continue
      const { bodyId, port } = anchor as { bodyId: string; port?: string }
      if (!port) continue
      const body = scene.bodies.find((x) => x.id === bodyId)
      if (!body) continue // 上面已经报过 dangling-body
      if (!findPort(body, port)) {
        const available = bodyPorts(body).map((p) => p.id).join('/')
        add({
          level: 'error',
          code: 'dangling-port',
          message: `约束 ${c.id} 的 ${a} 端指向 ${bodyId} 上不存在的端口「${port}」（可用：${available}）`,
          constraintId: c.id,
          bodyId,
          portId: port,
        })
      }
    }
    if ('length' in c && c.length <= EPS) {
      add({ level: 'warn', code: 'zero-length', message: `约束 ${c.id} 长度 ≤ 0`, constraintId: c.id })
    }
    if (c.type === 'spring' && (c.k <= 0 || c.l0 <= 0)) {
      add({ level: 'error', code: 'bad-spring', message: `弹簧 ${c.id} 的 k 或原长 ≤ 0`, constraintId: c.id })
    }

    // 语义检查：质点默认锁转动（fixedRotation），所以这两类约束在质点上等于失效/锁死
    if (c.type === 'pin' || c.type === 'motor') {
      const b = scene.bodies.find((x) => x.id === c.bodyId)
      const locked = b && (b.fixedRotation ?? b.kind === 'particle')
      if (locked) {
        add({
          level: c.type === 'motor' ? 'error' : 'info',
          code: c.type === 'motor' ? 'motor-on-locked-body' : 'pin-locks-particle',
          message:
            c.type === 'motor'
              ? `马达 ${c.id} 装在「${c.bodyId}」上，但这个物体锁了转动，马达不会生效（换成 rolling 刚体）`
              : `销钉 ${c.id} 把质点「${c.bodyId}」完全钉死了（质点没有转动自由度，不会摆动）；要摆动请用 rolling 刚体`,
          constraintId: c.id,
          bodyId: c.bodyId,
        })
      }
    }
  }

  // ---- 场 ----
  for (const f of scene.fields) {
    if (f.enabled === false) continue
    let mag: number
    if (f.kind === 'uniform') mag = f.type === 'B' ? Math.abs(f.bz) : Math.hypot(f.vector.x, f.vector.y)
    else if (f.kind === 'point') mag = Math.abs(f.strength)
    else mag = Math.abs(f.k) // drag
    if (mag < EPS) add({ level: 'warn', code: 'zero-field', message: `场 ${f.id} 强度为 0，等于没有` })
  }

  // ---- 自由度 / 过约束 ----
  const uf = makeUnionFind(scene.bodies.map((b) => b.id))
  for (const c of scene.constraints) {
    const ids = constraintBodyIds(c).filter((id) => seenBody.has(id))
    for (let i = 1; i < ids.length; i++) uf.union(ids[0]!, ids[i]!)
  }
  const groups = new Map<string, { bodies: string[]; constraints: string[] }>()
  for (const b of scene.bodies) {
    const root = uf.find(b.id)
    if (!groups.has(root)) groups.set(root, { bodies: [], constraints: [] })
    groups.get(root)!.bodies.push(b.id)
  }
  for (const c of scene.constraints) {
    const ids = constraintBodyIds(c).filter((id) => seenBody.has(id))
    if (!ids.length) continue
    groups.get(uf.find(ids[0]!))!.constraints.push(c.id)
  }

  const components: DofComponent[] = []
  let total = 0
  for (const g of groups.values()) {
    const bodySet = new Set(g.bodies)
    let dof = 0
    for (const id of g.bodies) {
      const b = scene.bodies.find((x) => x.id === id)!
      dof += bodyDof(b)
    }
    for (const cid of g.constraints) {
      const c = scene.constraints.find((x) => x.id === cid)!
      // 只统计两端都在这个分量里的约束（跨分量不可能，但防御一下）
      if (constraintBodyIds(c).every((id) => bodySet.has(id) || !seenBody.has(id))) dof -= constraintDof(c)
    }
    total += dof
    components.push({ bodies: g.bodies, constraints: g.constraints, dof })

    const hasDynamic = g.bodies.some((id) => scene.bodies.find((x) => x.id === id)!.kind !== 'static')
    if (!hasDynamic) continue
    if (dof < 0) {
      add({
        level: 'warn',
        code: 'over-constrained',
        message: `过约束：${g.bodies.join('、')} 这一组剩 ${dof} 个自由度，约束有冗余（求解器会变软/抖，通常还能跑）`,
      })
    } else if (g.constraints.length > 0 && dof === 0) {
      add({
        level: 'info',
        code: 'fully-constrained',
        message: `${g.bodies.join('、')} 被完全约束（0 自由度）`,
      })
    } else if (g.constraints.length > 0 && dof > 0) {
      add({
        level: 'info',
        code: 'under-constrained',
        message: `${g.bodies.join('、')} 还有 ${dof} 个自由度（会自由运动，多数情况是有意的）`,
      })
    }
  }

  // ---- 声明了但没被用的端口 ----
  for (const b of scene.bodies) {
    if (!b.ports?.length) continue
    const used = new Set<string>()
    for (const c of scene.constraints) {
      for (const a of ['a', 'b'] as const) {
        const anchor = (c as { a?: unknown; b?: unknown })[a]
        if (anchor && typeof anchor === 'object' && 'bodyId' in anchor) {
          const ref = anchor as { bodyId: string; port?: string }
          if (ref.bodyId === b.id && ref.port) used.add(ref.port)
        }
      }
    }
    for (const p of b.ports) {
      if (!used.has(p.id)) {
        add({ level: 'info', code: 'unused-port', message: `${b.id} 的端口「${p.label ?? p.id}」没有被任何约束使用`, bodyId: b.id, portId: p.id })
      }
    }
  }

  return { diagnostics: diags, dof: { total, components }, ok: !diags.some((d) => d.level === 'error') }
}

/** 只要错误（用于「能不能交付」的判断） */
export function errorsOf(report: SceneReport): Diagnostic[] {
  return report.diagnostics.filter((d) => d.level === 'error')
}

/** 一句话摘要，给 toast / agent 自检回读用 */
export function summarizeReport(report: SceneReport): string {
  const err = report.diagnostics.filter((d) => d.level === 'error')
  const warn = report.diagnostics.filter((d) => d.level === 'warn')
  if (err.length) return `${err.length} 个错误：${err[0]!.message}`
  if (warn.length) return `${warn.length} 个警告：${warn[0]!.message}`
  return `结构正常（${report.dof.total} 个自由度）`
}
