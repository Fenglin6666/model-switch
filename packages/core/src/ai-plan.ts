/**
 * 由 LLM 决定「怎么建模」——决定层，纯函数，不碰网络。
 *
 * 为什么不让 LLM 直接吐 Scene JSON：Scene 有几十个字段、几百行，模型很容易写出
 * 一个「看着像但跑不起来」的场景，而我们没法自动判断对错。所以这里把 LLM 的作用
 * 限定在**做决定**：
 *
 *   mode = 'preset'      选一个已有模型 + 参数（走 layout()，几何一定合法）
 *   mode = 'chain'       自由拼阶段（斜面/水平/圆弧/上坡，走 buildChain()）
 *   mode = 'unsupported' 明确拒绝 + 说明缺什么
 *
 * 三种都落到同一条既有契约（`ParseResult`），所以上层 UI、题库状态、回退逻辑
 * 一行都不用改。LLM 失败/超时/胡写 → 调用方回退到规则解析 `parseProblem`。
 *
 * 网络调用在 `ai-client.ts`；这里只负责「目录、提示词、解析、校验」。
 */
import { emptyScene, type Scene, type Body, type Constraint, type Shape } from './scene'
import { PRESETS, presetById } from './presets'
import { PARAM_META } from './params'
import { buildChain, type ChainStage, type ChainStageKind } from './chain'
import { resolvePortRef, semanticPort, type PortKind } from './ports'
import { analyzeScene, summarizeReport } from './validate'
import type { ParseResult } from './problem'

export type AiMode = 'preset' | 'chain' | 'build' | 'unsupported'

export type AiPlan = {
  mode: AiMode
  /** mode=preset：必须是 CATALOG 里的 id */
  archetype?: string
  /** mode=preset：连续参数，键必须在 PARAM_META 里；缺的用默认值 */
  params?: Record<string, number>
  /** mode=preset：0/1 开关（ball / model / roll / fixed / drag…） */
  switches?: Record<string, number>
  /** mode=chain：阶段序列 */
  stages?: ChainStage[]
  /** mode=build：受限的搭建指令（见 BuildOp） */
  ops?: BuildOp[]
  /** 模型替题目补的假设，中文短语 */
  assumptions?: string[]
  /** 一句话说明为什么这么建 */
  reason?: string
  /** mode=unsupported：缺哪类建模 */
  unsupported?: string[]
  /** 0–1，模型自己的把握 */
  confidence?: number
}

export type PlanParse = { ok: true; plan: AiPlan } | { ok: false; error: string }

// ---------------------------------------------------------------------------
// 目录：从 PRESETS 自动派生，不手写（手写一定会和 presets.ts 漂）
// ---------------------------------------------------------------------------

export type CatalogEntry = {
  id: string
  title: string
  chips: string[]
  params: { key: string; label: string; unit?: string; min: number; max: number }[]
  switches: string[]
}

let catalogCache: CatalogEntry[] | null = null

/** 18 个预置场景的参数面。每次从 `build()` 的真实 params 读，保证和预置一致。 */
export function archetypeCatalog(): CatalogEntry[] {
  if (catalogCache) return catalogCache
  catalogCache = PRESETS.map((p) => {
    const scene = p.build()
    const keys = Object.keys(scene.params ?? {})
    const params: CatalogEntry['params'] = []
    const switches: string[] = []
    for (const k of keys) {
      const meta = PARAM_META[k]
      if (meta) params.push({ key: k, label: meta.label, unit: meta.unit, min: meta.min, max: meta.max })
      else switches.push(k)
    }
    return { id: p.id, title: p.title, chips: p.chips ?? [], params, switches }
  })
  return catalogCache
}

export function isKnownArchetype(id: string): boolean {
  return PRESETS.some((p) => p.id === id)
}

// ---------------------------------------------------------------------------
// 提示词
// ---------------------------------------------------------------------------

const CHAIN_KINDS: ChainStageKind[] = ['slope', 'flat', 'arc', 'upslope']

function catalogText(): string {
  return archetypeCatalog()
    .map((e) => {
      const ps = e.params
        .map((p) => `${p.key}(${p.label.replace(/[（(].*?[)）]/g, '')} ${p.min}–${p.max}${p.unit ?? ''})`)
        .join(', ')
      const sw = e.switches.length ? ` 开关: ${e.switches.join('/')}（0 或 1）` : ''
      const chips = e.chips.length ? ` [${e.chips.join('·')}]` : ''
      return `- ${e.id} ${e.title}${chips}\n    ${ps || '（无可调参数）'}${sw}`
    })
    .join('\n')
}

export const AI_SYSTEM_PROMPT = `你是高中物理建模助手。给定一道题的题干，你要决定「用哪个已有模型来演示它」，并抽出参数。

## 可用的模型（只能从这些 id 里选）
${catalogText()}

## 或者用 chain 模式自己拼阶段
kind 只能是 slope(斜面) / flat(水平) / arc(圆弧) / upslope(上坡)，最多 6 段，首尾相接。
每段字段：kind, angle(度, 斜面/上坡用), length(长度 m), radius(圆弧半径 m), arcDeg(圆心角 度)。
适合「斜面→水平→圆弧」「斜面→水平→上坡」这类多过程题。

## 或者用 build 模式自己搭（上面都不合适时，比如传送带、电机、挂钩、多个物体）
按顺序发指令，只能从这三种里选：

1. 加物体：{"op":"addBody","id":"block","shape":{"kind":"rect","w":0.2,"h":0.15},
            "at":{"x":0,"y":0.1},"behavior":"moving","mass":0.5,"friction":0.2,"label":"物块"}
   shape 只能是：circle{r} / rect{w,h} / polygon{points:[{x,y}...]} / line{from,to}
   behavior：fixed(固定地形) / moving(会动) / rolling(滚动的刚体) / sliding(匀速平移)
   角度用 angleDeg；不给值就走默认（质量、摩擦这些可以不写）

2. 加约束：{"op":"addConstraint","type":"rope","a":{"body":"ball","port":"top"},"b":{"world":{"x":0,"y":2}},
            "params":{"length":1.2}}
   type：rope / rod / spring / hinge / pin / motor / belt
   **两端只能引用端口**，不要自己算坐标：每个物体都自带 center/top/bottom/left/right/tl/tr/bl/br。
   自己声明的端口（转轴、挂钩）写在 addBody 的 ports 里：
     "ports":[{"id":"shaft","kind":"axle","at":"center"}]
   pin / motor / belt 只作用于一个物体，用 "bodyId" 而不是 a/b：
     {"op":"addConstraint","type":"motor","bodyId":"wheel","params":{"omega":3}}
     {"op":"addConstraint","type":"belt","bodyId":"belt","params":{"speed":2}}
   rope/rod 不写 length 就按两端当前距离；spring 用 params{k, l0, damping}

3. 加场：{"op":"addField","type":"E","magnitude":40,"angleDeg":90}

## 输出格式
只输出**一个 JSON 对象**，不要 markdown 代码块，不要任何解释文字。

{
  "mode": "preset" | "chain" | "build" | "unsupported",
  "archetype": "incline",                 // mode=preset 必填
  "params": { "theta": 30, "mu": 0 },     // 只写题干明确给出的值
  "switches": { "ball": 1, "model": 0 },  // 0/1 开关
  "stages": [                             // mode=chain 必填
    { "kind": "slope", "angle": 35, "length": 3, "radius": 1, "arcDeg": 60 }
  ],
  "ops": [                                // mode=build 必填
    { "op": "addBody", "id": "ball", "shape": { "kind": "circle", "r": 0.12 }, "at": { "x": 0, "y": 1 } }
  ],
  "assumptions": ["小球，纯滚动", "斜面光滑"],
  "reason": "一句话说明为什么选这个模型",
  "unsupported": ["电磁感应"],            // mode=unsupported 必填
  "confidence": 0.8
}

## 规则
1. 只有题干确实描述了一个**能在这个工具里演示的力学过程**，才给 preset 或 chain；否则 unsupported。
2. params 只填题干**明确给出**的数。没给的不要编——留空会用默认值，UI 会标出来。
   **参数是「输入」，不是「答案」**：如果题目要求解的量正好是某个参数（比如「求最低点速度」而 v0 就是最低点速度），
   **不要把它算出来填进去**——那等于把答案提前写进模型。让它留空，由用户自己拖滑杆试。
3. 单位一律换算成 SI：cm→m、g→kg、km/h→m/s、度→度。
4. **不要为了「能建」而套一个近似的模型**。斜面 + 圆弧 + 平抛三个阶段的题，不要只给 incline。
5. assumptions 用简短中文，写清你替题目补的假设（滑块还是小球、光滑还是粗糙、槽固定还是可移动、计不计空气阻力）。
6. 电磁感应、热学、光学、波、碰撞、传送带、连接体静力学——这些当前没有对应模型，直接 unsupported。

## 两个例子

题干：倾角 30° 的斜面长 2 m，动摩擦因数 0.25，小滑块从顶端由静止下滑，求到底端的速度。
{"mode":"preset","archetype":"incline","params":{"theta":30,"mu":0.25,"v0":0},"switches":{"ball":0},"assumptions":["滑块，平动","斜面摩擦按 μ"],"reason":"单斜面 + 滑块从静止下滑","confidence":0.95}

题干：倾角 37° 的斜面长 2 m，底端接一段长 1.5 m 的粗糙水平面（μ=0.2），再进入半径 0.6 m 的光滑圆弧，小球从斜面顶端由静止滑下。
{"mode":"chain","stages":[{"kind":"slope","angle":37,"length":2,"radius":1,"arcDeg":60},{"kind":"flat","length":1.5,"radius":1,"arcDeg":60},{"kind":"arc","angle":0,"length":1,"radius":0.6,"arcDeg":90}],"assumptions":["小球，平动","水平段粗糙 μ=0.2","圆弧光滑"],"reason":"斜面→水平→圆弧的三段多过程，用 chain 拼","confidence":0.85}

题干：一矩形线圈在匀强磁场中绕垂直于磁场的轴匀速转动，求感应电动势的最大值。
{"mode":"unsupported","unsupported":["电磁感应"],"assumptions":[],"reason":"电磁感应没有对应模型","confidence":0.95}

题干：水平传送带长 3 m，以 2 m/s 匀速向右运动，把物块轻放在左端，物块与传送带间动摩擦因数 0.2。
{"mode":"build","ops":[{"op":"addBody","id":"belt","shape":{"kind":"line","from":{"x":0,"y":0},"to":{"x":3,"y":0}},"behavior":"fixed","label":"传送带"},{"op":"addConstraint","type":"belt","bodyId":"belt","params":{"speed":2}},{"op":"addBody","id":"block","shape":{"kind":"rect","w":0.2,"h":0.15},"at":{"x":0.15,"y":0.08},"behavior":"moving","mass":0.5,"friction":0.2,"label":"物块"}],"assumptions":["传送带匀速","物块初速为 0","忽略空气阻力"],"reason":"传送带不是现成模型，用一条固定线 + 表面速度 + 一个物块搭出来","confidence":0.9}`

export function planPrompt(problemText: string): { system: string; user: string } {
  return {
    system: AI_SYSTEM_PROMPT,
    user: `题干：\n${problemText.trim()}\n\n只输出 JSON。`,
  }
}

// ---------------------------------------------------------------------------
// 解析响应：模型经常裹一层 ```json，或者前后加一句废话
// ---------------------------------------------------------------------------

/** 从一段可能带 markdown 围栏/前后废话的文本里挖出第一个 JSON 对象 */
export function extractJsonObject(raw: string): string | null {
  const s = raw.trim()
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const body = fence ? fence[1] : s
  const start = body.indexOf('{')
  if (start < 0) return null
  // 括号配平：找到与第一个 { 匹配的 }
  let depth = 0
  let inStr = false
  let esc = false
  for (let i = start; i < body.length; i++) {
    const c = body[i]
    if (inStr) {
      if (esc) esc = false
      else if (c === '\\') esc = true
      else if (c === '"') inStr = false
      continue
    }
    if (c === '"') inStr = true
    else if (c === '{') depth++
    else if (c === '}') {
      depth--
      if (depth === 0) return body.slice(start, i + 1)
    }
  }
  return null
}

const num = (v: unknown): number | undefined => {
  const n = typeof v === 'string' ? Number(v) : typeof v === 'number' ? v : NaN
  return Number.isFinite(n) ? n : undefined
}

export function parsePlan(raw: string): PlanParse {
  const json = extractJsonObject(raw)
  if (!json) return { ok: false, error: '模型没有返回 JSON' }
  let obj: unknown
  try {
    obj = JSON.parse(json)
  } catch {
    return { ok: false, error: '模型返回的 JSON 不合法' }
  }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return { ok: false, error: '模型返回的不是对象' }
  const o = obj as Record<string, unknown>
  const mode = String(o.mode ?? '')
  if (mode !== 'preset' && mode !== 'chain' && mode !== 'build' && mode !== 'unsupported') {
    return { ok: false, error: `未知的 mode：${mode || '(空)'}` }
  }

  const plan: AiPlan = { mode }
  if (typeof o.archetype === 'string') plan.archetype = o.archetype.trim()
  if (typeof o.reason === 'string') plan.reason = o.reason.trim().slice(0, 200)
  if (Array.isArray(o.assumptions)) {
    plan.assumptions = o.assumptions.filter((x): x is string => typeof x === 'string').slice(0, 6)
  }
  if (Array.isArray(o.unsupported)) {
    plan.unsupported = o.unsupported.filter((x): x is string => typeof x === 'string').slice(0, 6)
  }
  const conf = num(o.confidence)
  if (conf !== undefined) plan.confidence = Math.min(1, Math.max(0, conf))

  if (o.params && typeof o.params === 'object') {
    const params: Record<string, number> = {}
    for (const [k, v] of Object.entries(o.params as Record<string, unknown>)) {
      const n = num(v)
      if (n !== undefined) params[k] = n
    }
    if (Object.keys(params).length) plan.params = params
  }
  if (o.switches && typeof o.switches === 'object') {
    const sw: Record<string, number> = {}
    for (const [k, v] of Object.entries(o.switches as Record<string, unknown>)) {
      // 开关最常见的三种写法：1/0、true/false、"1"/"0"
      if (typeof v === 'boolean') sw[k] = v ? 1 : 0
      else {
        const n = num(v)
        if (n !== undefined) sw[k] = n ? 1 : 0
      }
    }
    if (Object.keys(sw).length) plan.switches = sw
  }
  if (Array.isArray(o.stages)) {
    const stages: ChainStage[] = []
    for (const s of o.stages.slice(0, 6)) {
      if (!s || typeof s !== 'object') continue
      const r = s as Record<string, unknown>
      const kind = String(r.kind ?? '')
      if (!CHAIN_KINDS.includes(kind as ChainStageKind)) continue
      stages.push({
        kind: kind as ChainStageKind,
        angle: num(r.angle) ?? 0,
        length: num(r.length) ?? 2,
        radius: num(r.radius) ?? 1,
        arcDeg: num(r.arcDeg) ?? 60,
      })
    }
    if (stages.length) plan.stages = stages
  }

  if (Array.isArray(o.ops)) {
    const ops: BuildOp[] = []
    for (const raw of o.ops.slice(0, 40)) {
      if (!raw || typeof raw !== 'object') continue
      const r = raw as Record<string, unknown>
      const kind = String(r.op ?? '')
      if (kind === 'addBody') {
        const shape = r.shape as ShapeSpec | undefined
        if (!shape || typeof shape !== 'object') continue
        const id = String(r.id ?? '')
        if (!id) continue
        const at = r.at as { x?: unknown; y?: unknown } | undefined
        const op: BuildOp = {
          op: 'addBody',
          id,
          shape,
          at: { x: num(at?.x) ?? 0, y: num(at?.y) ?? 0 },
        }
        const angleDeg = num(r.angleDeg)
        if (angleDeg !== undefined) op.angleDeg = angleDeg
        if (typeof r.behavior === 'string' && r.behavior in BEHAVIOR) op.behavior = r.behavior as BodyBehavior
        const mass = num(r.mass)
        if (mass !== undefined) op.mass = mass
        const charge = num(r.charge)
        if (charge !== undefined) op.charge = charge
        const friction = num(r.friction)
        if (friction !== undefined) op.friction = friction
        if (typeof r.label === 'string') op.label = r.label
        if (Array.isArray(r.ports)) {
          op.ports = r.ports
            .filter((p): p is Record<string, unknown> => !!p && typeof p === 'object')
            .filter((p) => typeof p.id === 'string')
            .map((p) => ({
              id: String(p.id),
              kind: typeof p.kind === 'string' ? (p.kind as PortKind) : undefined,
              at: typeof p.at === 'string' ? p.at : undefined,
              local: p.local as { x: number; y: number } | undefined,
            }))
        }
        ops.push(op)
        continue
      }
      if (kind === 'addConstraint') {
        const type = String(r.type ?? '')
        if (!['rope', 'rod', 'spring', 'hinge', 'pin', 'motor', 'belt'].includes(type)) continue
        const op: BuildOp = { op: 'addConstraint', type: type as never }
        if (typeof r.id === 'string') op.id = r.id
        if (r.a && typeof r.a === 'object') op.a = r.a as PortRefLike
        if (r.b && typeof r.b === 'object') op.b = r.b as PortRefLike
        if (typeof r.bodyId === 'string') op.bodyId = r.bodyId
        if (r.params && typeof r.params === 'object') {
          const params: Record<string, number> = {}
          for (const [k, v] of Object.entries(r.params as Record<string, unknown>)) {
            const n = num(v)
            if (n !== undefined) params[k] = n
          }
          if (Object.keys(params).length) op.params = params
        }
        ops.push(op)
        continue
      }
      if (kind === 'addField') {
        const type = r.type === 'B' ? 'B' : 'E'
        ops.push({ op: 'addField', type, magnitude: num(r.magnitude) ?? 0, angleDeg: num(r.angleDeg) })
        continue
      }
    }
    if (ops.length) plan.ops = ops
  }

  if (mode === 'preset' && (!plan.archetype || !isKnownArchetype(plan.archetype))) {
    return { ok: false, error: `模型选的场景不存在：${plan.archetype ?? '(空)'}` }
  }
  if (mode === 'chain' && !plan.stages?.length) return { ok: false, error: 'chain 模式但没有有效阶段' }
  if (mode === 'build' && !plan.ops?.length) return { ok: false, error: 'build 模式但没有有效指令' }
  return { ok: true, plan }
}

// ---------------------------------------------------------------------------
// 决定 → Scene
// ---------------------------------------------------------------------------

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

function applyParams(scene: Scene, params: Record<string, number>, used: Record<string, number | string>): string[] {
  const warnings: string[] = []
  for (const [k, v] of Object.entries(params)) {
    const meta = PARAM_META[k]
    if (!meta) {
      warnings.push(`模型给了不认识的参数 ${k}，已忽略`)
      continue
    }
    const val = clamp(v, meta.min, meta.max)
    if (val !== v) warnings.push(`${meta.label} 超出可调范围，收到 ${val}`)
    scene.params[k] = val
    used[k] = val
  }
  return warnings
}

function applySwitches(scene: Scene, sw: Record<string, number>, used: Record<string, number | string>): string[] {
  const warnings: string[] = []
  const known = new Set(Object.keys(scene.params ?? {}))
  for (const [k, v] of Object.entries(sw)) {
    // 开关必须本来就是这个场景的 params 之一，否则不往里塞垃圾字段
    if (!known.has(k)) {
      warnings.push(`模型给了这个场景没有的开关 ${k}，已忽略`)
      continue
    }
    scene.params[k] = v ? 1 : 0
    used[k] = v ? 1 : 0
  }
  return warnings
}

/**
 * build 模式的指令集 —— 给 agent 的「简化子集」（借 Base Modelica 的思路）。
 *
 * 三条规矩，缺一不可：
 *   1. **只能从这几个 op 里选**，不能写代码，也不能直接吐 Scene JSON；
 *   2. **只能引用端口**（`{ body:'ball', port:'top' }`），不许算坐标——模型不知道场景尺度；
 *   3. **参数只填题干给的**，缺的走默认值，UI 会标出来。
 *
 * 产出后立刻过 `analyzeScene`：结构不合法（悬空端口、退化几何、过约束）会被降级成 warnings，
 * 严重的直接拒绝。这是「agent 出招后自己验算」那一环。
 */
export type ShapeSpec =
  | { kind: 'circle'; r: number }
  | { kind: 'rect'; w: number; h: number }
  | { kind: 'polygon'; points: { x: number; y: number }[] }
  /** 一条线段：给「地面 / 挡板 / 斜面」用，比让模型算 polygon 的四个点可靠 */
  | { kind: 'line'; from: { x: number; y: number }; to: { x: number; y: number }; thick?: number }

/** agent 能说的物体类型（不暴露引擎术语） */
export type BodyBehavior = 'fixed' | 'moving' | 'rolling' | 'sliding'

export type PortRefLike = { body: string; port?: string; at?: { x: number; y: number } } | { world: { x: number; y: number } }

export type BuildOp =
  | {
      op: 'addBody'
      id: string
      shape: ShapeSpec
      at: { x: number; y: number }
      angleDeg?: number
      behavior?: BodyBehavior
      mass?: number
      charge?: number
      friction?: number
      label?: string
      /** 语义端口（转轴/挂钩）；位置可以用派生端口名指定，如 at:'center' */
      ports?: { id: string; kind?: PortKind; at?: string; local?: { x: number; y: number } }[]
    }
  | {
      op: 'addConstraint'
      id?: string
      type: 'rope' | 'rod' | 'spring' | 'hinge' | 'pin' | 'motor' | 'belt'
      a?: PortRefLike
      b?: PortRefLike
      bodyId?: string
      params?: Record<string, number>
    }
  | { op: 'addField'; type: 'E' | 'B'; magnitude: number; angleDeg?: number }

const BEHAVIOR: Record<BodyBehavior, { kind: Body['kind']; role: Body['role'] }> = {
  fixed: { kind: 'static', role: 'terrain' },
  moving: { kind: 'particle', role: 'object' },
  rolling: { kind: 'rigid', role: 'object' },
  sliding: { kind: 'kinematic', role: 'object' },
}

const BODY_PALETTE = ['#dd5735', '#3f6fd0', '#2f8f6b', '#a06a2c', '#7c3aed', '#c2410c']
const TERRAIN_COLOR = '#8b96a8'

function shapeFromSpec(spec: ShapeSpec): Shape | null {
  if (!spec || typeof spec !== 'object') return null
  if (spec.kind === 'circle') return spec.r > 0 ? { type: 'circle', r: spec.r } : null
  if (spec.kind === 'rect') return spec.w > 0 && spec.h > 0 ? { type: 'rect', w: spec.w, h: spec.h } : null
  if (spec.kind === 'polygon') return spec.points?.length >= 3 ? { type: 'polygon', points: spec.points } : null
  if (spec.kind === 'line') {
    const { from, to } = spec
    if (!from || !to) return null
    return {
      type: 'polyline',
      points: [{ x: 0, y: 0 }, { x: to.x - from.x, y: to.y - from.y }],
      thick: spec.thick ?? 0.06,
    }
  }
  return null
}

function anchorOf(ref: PortRefLike | undefined): { bodyId: string; port?: string; local?: { x: number; y: number } } | { world: { x: number; y: number } } | null {
  if (!ref) return null
  if ('world' in ref) return { world: ref.world }
  if (ref.port) return { bodyId: ref.body, port: ref.port }
  if (ref.at) return { bodyId: ref.body, local: ref.at }
  return { bodyId: ref.body, port: 'center' } // 没说就接中心，最常见的默认
}

/**
 * build 指令 → Scene。每一步都容错：不认识的 op 记 warning 跳过，不整单失败。
 * 最后跑一遍结构校验，把 error 也算进 warnings（但 `ok` 仍然是 true——
 * 因为「能跑但有问题」比「什么都没有」对用户更有用；真要拦，调用方看 report.ok）。
 */
export function sceneFromOps(ops: BuildOp[], title = 'AI 搭的场景'): ParseResult & { report?: ReturnType<typeof analyzeScene> } {
  const scene = emptyScene(title)
  const warnings: string[] = []
  const known = new Set<string>()
  let paletteI = 0

  for (const op of ops) {
    if (!op || typeof op !== 'object') continue

    if (op.op === 'addBody') {
      if (!op.id) {
        warnings.push('有一个物体没有 id，跳过')
        continue
      }
      if (known.has(op.id)) {
        warnings.push(`物体 id 重复，跳过：${op.id}`)
        continue
      }
      const shape = shapeFromSpec(op.shape)
      if (!shape) {
        warnings.push(`物体 ${op.id} 的形状不合法，跳过`)
        continue
      }
      const behavior = op.behavior ?? (op.shape.kind === 'circle' ? 'moving' : 'fixed')
      const { kind, role } = BEHAVIOR[behavior] ?? BEHAVIOR.fixed
      const isStatic = kind === 'static'
      // line 的坐标是绝对端点，转成相对原点的 polyline
      const origin =
        op.shape.kind === 'line' ? { x: op.shape.from.x, y: op.shape.from.y } : { x: op.at?.x ?? 0, y: op.at?.y ?? 0 }
      const body: Body = {
        id: op.id,
        kind,
        role,
        shape,
        transform: { x: origin.x, y: origin.y, angle: ((op.angleDeg ?? 0) * Math.PI) / 180 },
        material: isStatic ? 'smooth' : 'metal',
        appearance: {
          color: isStatic ? TERRAIN_COLOR : BODY_PALETTE[paletteI++ % BODY_PALETTE.length]!,
          depth: 0.12,
        },
      }
      if (op.mass !== undefined) body.mass = op.mass
      if (op.charge !== undefined) body.charge = op.charge
      if (op.friction !== undefined) body.friction = op.friction
      if (op.label) body.label = op.label
      if (op.ports?.length) {
        const ports = op.ports
          .filter((p) => p && p.id)
          .map((p) => semanticPort(p.id, p.kind ?? 'pin', body, p.local ?? p.at ?? 'center', p.id))
        if (ports.length) body.ports = ports
      }
      scene.bodies.push(body)
      known.add(op.id)
      continue
    }

    if (op.op === 'addConstraint') {
      const a = anchorOf(op.a)
      const b = anchorOf(op.b)
      const id = op.id ?? `c${scene.constraints.length + 1}`
      const p = op.params ?? {}
      const add = (c: Constraint) => scene.constraints.push(c)

      if (op.type === 'rope' || op.type === 'rod' || op.type === 'spring' || op.type === 'hinge') {
        if (!a || !b) {
          warnings.push(`约束 ${id}（${op.type}）缺一端，跳过`)
          continue
        }
        // 长度/原长没给就按当前两端距离算——比让模型猜一个数可靠
        const ra = resolvePortRef(scene, a as never)
        const rb = resolvePortRef(scene, b as never)
        const dist = ra && rb ? Math.hypot(rb.point.x - ra.point.x, rb.point.y - ra.point.y) : 1
        const len = p.length ?? p.l0 ?? Math.max(0.05, dist)
        if (op.type === 'hinge') add({ id, type: 'hinge', a: a as never, b: b as never })
        else if (op.type === 'spring')
          add({ id, type: 'spring', a: a as never, b: b as never, k: p.k ?? 40, l0: len, damping: p.damping ?? 0 })
        else add({ id, type: op.type, a: a as never, b: b as never, length: len })
        continue
      }

      if (op.type === 'pin') {
        if (!op.bodyId) {
          warnings.push(`销钉 ${id} 缺 bodyId，跳过`)
          continue
        }
        const ref = anchorOf(op.a ?? { body: op.bodyId, port: 'center' })
        const at = ref ? resolvePortRef(scene, ref as never) : null
        if (!at) {
          warnings.push(`销钉 ${id} 的接点解析不到，跳过`)
          continue
        }
        add({ id, type: 'pin', bodyId: op.bodyId, point: at.point })
        continue
      }

      if (op.type === 'motor' || op.type === 'belt') {
        if (!op.bodyId) {
          warnings.push(`${op.type} ${id} 缺 bodyId，跳过`)
          continue
        }
        if (op.type === 'motor') add({ id, type: 'motor', bodyId: op.bodyId, omega: p.omega ?? 3 })
        else add({ id, type: 'belt', bodyId: op.bodyId, speed: p.speed ?? 1 })
        continue
      }

      warnings.push(`不支持的约束类型 ${String(op.type)}，跳过`)
      continue
    }

    if (op.op === 'addField') {
      const mag = op.magnitude ?? 0
      if (op.type === 'B') {
        scene.fields.push({ id: `f${scene.fields.length + 1}`, kind: 'uniform', type: 'B', bz: mag })
      } else {
        const rad = ((op.angleDeg ?? 90) * Math.PI) / 180
        scene.fields.push({
          id: `f${scene.fields.length + 1}`,
          kind: 'uniform',
          type: 'E',
          vector: { x: Math.cos(rad) * mag, y: Math.sin(rad) * mag },
        })
      }
      continue
    }

    warnings.push(`不认识的指令 ${String((op as { op?: string }).op)}，跳过`)
  }

  const report = analyzeScene(scene)
  for (const d of report.diagnostics) {
    // 带上机器可读的 code：agent 按 code 分类比按中文句子匹配可靠
    if (d.level === 'error') warnings.push(`结构错误[${d.code}]：${d.message}`)
    else if (d.level === 'warn') warnings.push(`[${d.code}] ${d.message}`)
  }

  if (!scene.bodies.length) {
    return {
      ok: false,
      error: 'AI 没有给出任何可用的物体。',
      hints: [warnings.join('；') || '指令为空'],
    }
  }

  const assumptions = ['按 AI 的搭建指令生成']
  scene.meta.assumptions = assumptions
  scene.meta.note = `AI 搭的场景（${scene.bodies.length} 个物体、${scene.constraints.length} 条约束）。${summarizeReport(report)}`
  scene.observers = [
    { id: 'chart', kind: 'chart', axis: 't', series: [], title: 'v–t', unit: 'm/s' },
  ]
  // 观测器要挂到第一个动态体上
  const firstDynamic = scene.bodies.find((x) => x.kind !== 'static')
  if (firstDynamic) {
    scene.observers = [
      { id: 'trail', kind: 'trail', bodyId: firstDynamic.id, len: 900 },
      { id: 'vel', kind: 'vector', bodyId: firstDynamic.id, which: ['v'], scale: 0.2 },
      { id: 'chart', kind: 'chart', axis: 't', series: [{ bodyId: firstDynamic.id, quantity: 'v' }], title: 'v–t', unit: 'm/s' },
    ]
  }

  return {
    ok: true,
    scene,
    archetype: 'build',
    used: { ops: ops.length, bodies: scene.bodies.length, constraints: scene.constraints.length },
    warnings,
    assumptions,
    report,
  }
}

/** chain 模式：阶段 → Scene（地面 + 各段地形 + 起点小球 + 三个观测器） */
export function sceneFromStages(stages: ChainStage[], title = '多过程（AI 拼的）'): Scene {
  const s = emptyScene(title)
  const built = buildChain(stages, { x: 0, y: 0 }, 'ai')
  const ground: Scene['bodies'][number] = {
    id: 'ground',
    kind: 'static',
    role: 'terrain',
    shape: { type: 'rect', w: 16, h: 0.28 },
    transform: { x: 2, y: -0.14, angle: 0 },
    material: 'smooth',
    appearance: { color: '#aeb7c4', depth: 0.12 },
    label: '地面',
  }
  s.bodies = [ground, ...built.bodies, built.ball]
  s.contactPairs = built.contactPairs
  s.observers = [
    { id: 'trail', kind: 'trail', bodyId: built.ball.id, len: 1200 },
    { id: 'vel', kind: 'vector', bodyId: built.ball.id, which: ['v'], scale: 0.2 },
    { id: 'chart', kind: 'chart', axis: 't', series: [{ bodyId: built.ball.id, quantity: 'v' }], title: 'v–t', unit: 'm/s' },
  ]
  s.world = { ...s.world, duration: 6, timeStep: 1 / 960, substeps: 2 }
  // 不给 params：每一段的几何已经烘进 body 了，没有 layout() 可以重排。
  // 留空比塞一个假参数诚实——用户照样能拖、能改检查器。
  s.params = {}
  return s
}

/**
 * 把 LLM 的决定落成 Scene。**这是唯一需要校验的地方**：
 * 场景 id、参数范围、开关归属、阶段合法性，全在这里挡住，不会把脏数据塞进 Scene。
 */
export function sceneFromPlan(plan: AiPlan): ParseResult {
  if (plan.mode === 'unsupported') {
    const list = plan.unsupported?.length ? plan.unsupported : ['这类题']
    return {
      ok: false,
      error: `这道题需要「${list.join('、')}」的建模，当前自动建模还没有覆盖。`,
      hints: [
        plan.reason || 'AI 判断这道题超出当前模型范围。',
        '题目会先记在题库「我的题目」里；也可以手动搭一个近似场景。',
      ],
      unsupported: list,
    }
  }

  if (plan.mode === 'chain') {
    const stages = plan.stages ?? []
    if (!stages.length) return { ok: false, error: 'AI 没有给出有效的阶段序列。', hints: [] }
    const scene = sceneFromStages(stages)
    const assumptions = plan.assumptions?.length ? plan.assumptions : ['多过程串联']
    scene.meta.assumptions = assumptions
    scene.meta.preset = undefined
    scene.meta.title = `多过程 · ${stages.length} 段`
    scene.meta.note = `AI 拼的多过程（${stages.map((x) => x.kind).join(' → ')}）。假设：${assumptions.join('、')}。`
    if (plan.reason) scene.meta.note += ` ${plan.reason}`
    return {
      ok: true,
      scene,
      archetype: 'chain',
      used: { stages: stages.length },
      warnings: [],
      assumptions,
    }
  }

  if (plan.mode === 'build') {
    const ops = plan.ops ?? []
    if (!ops.length) return { ok: false, error: 'AI 没有给出搭建指令。', hints: [] }
    // 标题不要用 reason（模型爱写长句，会把标题栏挤爆）；reason 进 meta.note
    return sceneFromOps(ops, 'AI 搭的场景')
  }

  const preset = plan.archetype ? presetById(plan.archetype) : null
  if (!preset) return { ok: false, error: `AI 选的场景不存在：${plan.archetype ?? '(空)'}`, hints: [] }

  const scene = preset.build()
  const used: Record<string, number | string> = {}
  const warnings = [
    ...applyParams(scene, plan.params ?? {}, used),
    ...applySwitches(scene, plan.switches ?? {}, used),
  ]
  preset.layout?.(scene)
  const assumptions = plan.assumptions?.length ? plan.assumptions : ['按题干默认假设']
  scene.meta.preset = preset.id
  scene.meta.assumptions = assumptions
  scene.meta.title = `${preset.title} · 题目`
  scene.meta.note = `AI 选的模型：${preset.title}。假设：${assumptions.join('、')}。${plan.reason ?? ''}`.trim()
  if (warnings.length) scene.meta.note += ` 注意：${warnings.join('；')}。`

  return { ok: true, scene, archetype: preset.id, used, warnings, assumptions }
}
