/**
 * 序列化 / 分享 / 校验。
 *
 * 分享 = 把 Scene 压成 URL hash。老师发一条链接，学生打开看到同一份场景，
 * 不需要后端（架构 §10 P2 的分享能力的 v1 形态）。
 */
import type { Scene } from './scene'
import { applyEdits, emptyScene } from './scene'
import { presetById } from './presets'

const PREFIX = 's1.'
/** 预置场景的紧凑分享：p1.<预设>.<base64url(控制值数组)>，约 60~120 字符 */
const COMPACT = 'p1.'

export function encodeScene(scene: Scene): string {
  return PREFIX + base64UrlEncode(utf8Encode(JSON.stringify(scene)))
}

/**
 * 分享用的编码：
 * - 来自预置场景 → 只存预设 id + 每个控件的当前值（小程序分享 path 有长度限制）
 * - 自由画布/未知预设 → 退回完整 JSON
 */
function structureOf(scene: Scene): string {
  return JSON.stringify({
    b: scene.bodies.map((b) => b.id).sort(),
    c: scene.constraints.map((c) => `${c.id}:${c.type}`).sort(),
    o: scene.observers.map((o) => o.id).sort(),
    k: scene.criteria.map((c) => c.id).sort(),
  })
}

export function encodeShare(scene: Scene): string {
  const pid = scene.meta.preset
  const preset = pid ? presetById(pid) : undefined
  if (pid && preset) {
    const base = preset.build()
    base.params = { ...base.params, ...scene.params }
    preset.layout?.(base)
    // 结构变了（加了组件/约束/判据）就只能存完整 JSON
    if (structureOf(scene) !== structureOf(base)) return encodeScene(scene)
    const hasEdits = !!(scene.edits && ((scene.edits.bodies && Object.keys(scene.edits.bodies).length) || (scene.edits.constraints && Object.keys(scene.edits.constraints).length)))
    const payload: Record<string, unknown> = { t: scene.meta.title }
    if (scene.params && Object.keys(scene.params).length) payload.p = scene.params
    if (scene.meta.assumptions && scene.meta.assumptions.length) payload.a = scene.meta.assumptions
    if (hasEdits) payload.e = scene.edits
    return COMPACT + pid + '.' + base64UrlEncode(utf8Encode(JSON.stringify(payload)))
  }
  return encodeScene(scene)
}

export function decodeShare(text: string): Scene {
  if (text.startsWith(COMPACT)) {
    const rest = text.slice(COMPACT.length)
    const dot = rest.indexOf('.')
    if (dot <= 0) throw new Error('分享串格式错误')
    const pid = rest.slice(0, dot)
    const preset = presetById(pid)
    if (!preset) throw new Error(`未知预置场景：${pid}`)
    const payload = JSON.parse(utf8Decode(base64UrlDecode(rest.slice(dot + 1)))) as {
      t?: string
      p?: Scene['params']
      a?: string[]
      e?: Scene['edits']
    }
    let s = preset.build()
    s.meta.preset = pid
    if (payload.p) s.params = { ...s.params, ...payload.p }
    if (payload.a) s.meta.assumptions = payload.a
    if (payload.t) s.meta.title = payload.t
    preset.layout?.(s)
    if (payload.p) s.params = { ...s.params, ...payload.p }
    if (payload.e) {
      s.edits = payload.e
      applyEdits(s)
    }
    return s
  }
  return decodeScene(text)
}

export function decodeScene(text: string): Scene {
  const raw = text.startsWith(PREFIX) ? text.slice(PREFIX.length) : text
  const json = utf8Decode(base64UrlDecode(raw))
  const parsed = JSON.parse(json) as unknown
  return normalizeScene(parsed)
}

/** 补齐缺省字段，兼容早期/手写的 JSON。不做取值范围的强校验（那是 validateScene 的事）。 */
export function normalizeScene(raw: unknown): Scene {
  if (!raw || typeof raw !== 'object') throw new Error('场景不是对象')
  const r = raw as Record<string, unknown>
  const base = emptyScene(typeof (r.meta as Record<string, unknown>)?.title === 'string' ? String((r.meta as Record<string, unknown>).title) : '导入的场景')
  const scene: Scene = {
    ...base,
    ...(r as Partial<Scene>),
    version: 1,
    meta: { ...base.meta, ...((r.meta as Partial<Scene['meta']>) ?? {}) },
    world: { ...base.world, ...((r.world as Partial<Scene['world']>) ?? {}), view: { ...base.world.view, ...(((r.world as Partial<Scene['world']>)?.view) ?? {}) } },
    params: { ...((r.params as Record<string, number>) ?? {}) },
    materials: Array.isArray(r.materials) ? (r.materials as Scene['materials']) : base.materials,
    contactPairs: Array.isArray(r.contactPairs) ? (r.contactPairs as Scene['contactPairs']) : [],
    bodies: Array.isArray(r.bodies) ? (r.bodies as Scene['bodies']) : [],
    gases: Array.isArray(r.gases) ? (r.gases as Scene['gases']) : [],
    constraints: Array.isArray(r.constraints) ? (r.constraints as Scene['constraints']) : [],
    fields: Array.isArray(r.fields) ? (r.fields as Scene['fields']) : [],
    regions: Array.isArray(r.regions) ? (r.regions as Scene['regions']) : [],
    observers: Array.isArray(r.observers) ? (r.observers as Scene['observers']) : [],
    criteria: Array.isArray(r.criteria) ? (r.criteria as Scene['criteria']) : [],
    guides: Array.isArray(r.guides) ? (r.guides as Scene['guides']) : [],
    plane: r.plane === 'horizontal' ? 'horizontal' : 'vertical',
  }
  return scene
}

export function validateScene(scene: Scene): string[] {
  const errors: string[] = []
  if (scene.version !== 1) errors.push(`不支持的场景版本：${String(scene.version)}`)
  if (!scene.meta?.title) errors.push('缺少标题')
  const bodyIds = new Set<string>()
  for (const b of scene.bodies) {
    if (!b.id) errors.push('存在没有 id 的物体')
    if (bodyIds.has(b.id)) errors.push(`物体 id 重复：${b.id}`)
    bodyIds.add(b.id)
    if (!Number.isFinite(b.transform.x) || !Number.isFinite(b.transform.y)) errors.push(`${b.id} 的位置不是有限数`)
    if (!Number.isFinite(b.mass ?? 1) || (b.mass ?? 1) <= 0) errors.push(`${b.id} 的质量必须为正`)
  }
  const matIds = new Set(scene.materials.map((m) => m.id))
  for (const b of scene.bodies) {
    if (!matIds.has(b.material)) errors.push(`${b.id} 引用了不存在的材质 ${b.material}`)
  }
  for (const p of scene.contactPairs) {
    if (!matIds.has(p.a) || !matIds.has(p.b)) errors.push(`接触对引用了不存在的材质：${p.a}/${p.b}`)
    if (!Number.isFinite(p.mu) || p.mu < 0) errors.push(`接触对 μ 非法：${p.a}/${p.b}`)
  }
  const regionIds = new Set(scene.regions.map((r) => r.id))
  for (const c of scene.criteria) {
    if ((c.kind === 'reach' || c.kind === 'escape') && !regionIds.has(c.regionId)) {
      errors.push(`判据 ${c.id} 引用了不存在的区域 ${c.regionId}`)
    }
    if (c.kind === 'detach' && !bodyIds.has(c.bodyId)) errors.push(`判据 ${c.id} 引用了不存在的物体`)
    if (c.kind === 'reach' || c.kind === 'escape') {
      if (!bodyIds.has(c.bodyId)) errors.push(`判据 ${c.id} 引用了不存在的物体`)
    }
    if (c.kind === 'coincide' || c.kind === 'collide') {
      if (!bodyIds.has(c.bodyA) || !bodyIds.has(c.bodyB)) errors.push(`判据 ${c.id} 引用了不存在的物体`)
    }
  }
  if (scene.world.timeStep <= 0) errors.push('timeStep 必须为正')
  if (scene.world.substeps < 1) errors.push('substeps 至少为 1')
  return errors
}

// ---------------------------------------------------------------------------
// base64url（不依赖 btoa / Buffer，小程序也能跑）
// ---------------------------------------------------------------------------

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'

function base64UrlEncode(bytes: number[]): string {
  let out = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i]!
    const b1 = bytes[i + 1]
    const b2 = bytes[i + 2]
    out += B64[b0 >> 2]
    out += B64[((b0 & 3) << 4) | ((b1 ?? 0) >> 4)]
    if (b1 !== undefined) out += B64[((b1 & 15) << 2) | ((b2 ?? 0) >> 6)]
    if (b2 !== undefined) out += B64[b2 & 63]
  }
  return out
}

function base64UrlDecode(text: string): number[] {
  const clean = text.replace(/=+$/, '')
  const out: number[] = []
  let buffer = 0
  let bits = 0
  for (const ch of clean) {
    const v = B64.indexOf(ch)
    if (v < 0) continue
    buffer = (buffer << 6) | v
    bits += 6
    if (bits >= 8) {
      bits -= 8
      out.push((buffer >> bits) & 0xff)
    }
  }
  return out
}

function utf8Encode(text: string): number[] {
  const out: number[] = []
  for (const ch of text) {
    const code = ch.codePointAt(0)!
    if (code < 0x80) out.push(code)
    else if (code < 0x800) {
      out.push(0xc0 | (code >> 6), 0x80 | (code & 63))
    } else if (code < 0x10000) {
      out.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 63), 0x80 | (code & 63))
    } else {
      out.push(
        0xf0 | (code >> 18),
        0x80 | ((code >> 12) & 63),
        0x80 | ((code >> 6) & 63),
        0x80 | (code & 63),
      )
    }
  }
  return out
}

function utf8Decode(bytes: number[]): string {
  let out = ''
  let i = 0
  while (i < bytes.length) {
    const b = bytes[i]!
    if (b < 0x80) {
      out += String.fromCharCode(b)
      i += 1
    } else if ((b & 0xe0) === 0xc0) {
      out += String.fromCharCode(((b & 31) << 6) | (bytes[i + 1]! & 63))
      i += 2
    } else if ((b & 0xf0) === 0xe0) {
      out += String.fromCharCode(((b & 15) << 12) | ((bytes[i + 1]! & 63) << 6) | (bytes[i + 2]! & 63))
      i += 3
    } else {
      const code =
        ((b & 7) << 18) | ((bytes[i + 1]! & 63) << 12) | ((bytes[i + 2]! & 63) << 6) | (bytes[i + 3]! & 63)
      out += String.fromCodePoint(code)
      i += 4
    }
  }
  return out
}
