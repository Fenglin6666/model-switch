/**
 * LLM 决定层：提示词、响应解析、决定 → Scene 的校验。
 *
 * 这一层是**纯函数**，不碰网络——所以能离线测。网络那层（ai-client）只在
 * `scripts/ai-check.mjs` 里打真实接口验。
 *
 * 重点测「脏输入」：模型返回的东西一定会有围栏、废话、类型漂移、不存在的场景名。
 */
import { describe, expect, it } from 'vitest'
import {
  AI_SYSTEM_PROMPT,
  archetypeCatalog,
  extractJsonObject,
  isKnownArchetype,
  parsePlan,
  planPrompt,
  sceneFromPlan,
  sceneFromStages,
} from '../packages/core/src/ai-plan'
import { PRESETS } from '../packages/core/src/presets'

describe('模型目录：从 PRESETS 自动派生', () => {
  it('每个预置都进目录，且都能反查到', () => {
    const cat = archetypeCatalog()
    // 别写死数字：目录是从 PRESETS 派生的，写死就变成「加一个预置就要改测试」。
    // 真正要保证的是「一个不漏」。
    expect(cat.length).toBe(PRESETS.length)
    expect(cat.map((c) => c.id)).toContain('incline')
    expect(cat.map((c) => c.id)).toContain('arcChain')
    for (const c of cat) expect(isKnownArchetype(c.id)).toBe(true)
  })

  it('参数和开关分开：theta 是连续参数，ball/fixed 是开关', () => {
    const incline = archetypeCatalog().find((c) => c.id === 'incline')!
    expect(incline.params.map((p) => p.key)).toEqual(expect.arrayContaining(['theta', 'mu', 'v0', 'mass']))
    expect(incline.switches).toEqual(expect.arrayContaining(['ball']))

    const trough = archetypeCatalog().find((c) => c.id === 'trough')!
    expect(trough.switches).toContain('fixed')
  })

  it('每个参数都带可调区间（否则滑杆没边界）', () => {
    for (const c of archetypeCatalog()) {
      for (const p of c.params) expect(p.max).toBeGreaterThan(p.min)
    }
  })

  it('不认识的场景名不会被当成合法目标', () => {
    expect(isKnownArchetype('电磁感应')).toBe(false)
    expect(isKnownArchetype('incline ')).toBe(false)
  })
})

describe('提示词', () => {
  it('把目录和输出格式都塞进去了', () => {
    expect(AI_SYSTEM_PROMPT).toContain('incline')
    expect(AI_SYSTEM_PROMPT).toContain('arcChain')
    expect(AI_SYSTEM_PROMPT).toContain('"mode"')
    expect(AI_SYSTEM_PROMPT).toContain('unsupported')
  })

  it('写明「参数是输入不是答案」——否则模型会把要求解的临界值填进 v0', () => {
    expect(AI_SYSTEM_PROMPT).toContain('参数是「输入」，不是「答案」')
  })

  it('题干原样进 user 消息', () => {
    const { user, system } = planPrompt('  倾角 30° 的斜面  ')
    expect(user).toContain('倾角 30° 的斜面')
    expect(system.length).toBeGreaterThan(200)
  })
})

describe('从响应里挖 JSON', () => {
  it('纯 JSON', () => {
    expect(extractJsonObject('{"a":1}')).toBe('{"a":1}')
  })

  it('markdown 围栏', () => {
    expect(extractJsonObject('```json\n{"a":1}\n```')).toBe('{"a":1}')
  })

  it('前后有废话', () => {
    expect(extractJsonObject('好的，我的判断是：\n{"a":1}\n希望有帮助')).toBe('{"a":1}')
  })

  it('嵌套对象只取最外层', () => {
    expect(extractJsonObject('{"a":{"b":2},"c":3}')).toBe('{"a":{"b":2},"c":3}')
  })

  it('字符串里的花括号不打断配平', () => {
    expect(extractJsonObject('{"a":"}{"}')).toBe('{"a":"}{"}')
  })

  it('没有 JSON 就返回 null', () => {
    expect(extractJsonObject('我觉得这道题建不了')).toBeNull()
  })
})

describe('解析模型的决定', () => {
  it('合法的 preset', () => {
    const r = parsePlan('{"mode":"preset","archetype":"incline","params":{"theta":30},"switches":{"ball":1}}')
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.plan.mode).toBe('preset')
      expect(r.plan.archetype).toBe('incline')
      expect(r.plan.params).toEqual({ theta: 30 })
      expect(r.plan.switches).toEqual({ ball: 1 })
    }
  })

  it('参数给成字符串也能收（模型常这么干）', () => {
    const r = parsePlan('{"mode":"preset","archetype":"incline","params":{"theta":"30","mu":"0.25"}}')
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.plan.params).toEqual({ theta: 30, mu: 0.25 })
  })

  it('开关只认 0/1', () => {
    const r = parsePlan('{"mode":"preset","archetype":"trough","switches":{"fixed":true,"roll":0}}')
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.plan.switches).toEqual({ fixed: 1, roll: 0 })
  })

  it('选了一个不存在的场景 → 报错（不能让它落到空场景）', () => {
    const r = parsePlan('{"mode":"preset","archetype":"电磁感应"}')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain('不存在')
  })

  it('未知 mode → 报错', () => {
    const r = parsePlan('{"mode":"magic"}')
    expect(r.ok).toBe(false)
  })

  it('chain 没有有效阶段 → 报错', () => {
    expect(parsePlan('{"mode":"chain","stages":[]}').ok).toBe(false)
    expect(parsePlan('{"mode":"chain","stages":[{"kind":"传送带"}]}').ok).toBe(false)
  })

  it('chain 的阶段字段缺省时有兜底，且最多 6 段', () => {
    const r = parsePlan(
      JSON.stringify({
        mode: 'chain',
        stages: Array.from({ length: 9 }, () => ({ kind: 'slope' })),
      }),
    )
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.plan.stages!.length).toBe(6)
      expect(r.plan.stages![0]).toMatchObject({ kind: 'slope', length: 2, radius: 1, arcDeg: 60 })
    }
  })

  it('confidence 夹在 0–1', () => {
    const hi = parsePlan('{"mode":"unsupported","confidence":9}')
    const lo = parsePlan('{"mode":"unsupported","confidence":-3}')
    if (hi.ok) expect(hi.plan.confidence).toBe(1)
    if (lo.ok) expect(lo.plan.confidence).toBe(0)
  })

  it('不是 JSON 时给明确错误，不抛异常', () => {
    const r = parsePlan('这道题我不会')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain('JSON')
  })
})

describe('决定 → Scene', () => {
  it('preset 模式：参数落到 scene.params，并打上 preset 标记', () => {
    const r = sceneFromPlan({ mode: 'preset', archetype: 'incline', params: { theta: 42, mu: 0.1 } })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.scene.params.theta).toBe(42)
      expect(r.scene.params.mu).toBe(0.1)
      expect(r.scene.meta.preset).toBe('incline')
      expect(r.archetype).toBe('incline')
      expect(r.scene.bodies.length).toBeGreaterThan(1)
    }
  })

  it('超出可调范围的参数被夹住，并给出 warning', () => {
    const r = sceneFromPlan({ mode: 'preset', archetype: 'incline', params: { theta: 999 } })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.scene.params.theta).toBeLessThanOrEqual(75)
      expect(r.warnings.join(' ')).toContain('超出')
    }
  })

  it('不认识的参数被丢掉，不往 Scene 里塞垃圾字段', () => {
    const r = sceneFromPlan({ mode: 'preset', archetype: 'incline', params: { density: 7 } })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.scene.params.density).toBeUndefined()
      expect(r.warnings.join(' ')).toContain('不认识')
    }
  })

  it('场景里没有的开关也被丢掉（不能凭空造 ball）', () => {
    const r = sceneFromPlan({ mode: 'preset', archetype: 'spring', switches: { fixed: 1 } })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.scene.params.fixed).toBeUndefined()
      expect(r.warnings.join(' ')).toContain('没有的开关')
    }
  })

  it('假设写进 meta，供状态栏 chip 和文案使用', () => {
    const r = sceneFromPlan({
      mode: 'preset',
      archetype: 'trough',
      switches: { fixed: 1 },
      assumptions: ['槽固定', '小球，平动'],
    })
    if (r.ok) {
      expect(r.assumptions).toEqual(['槽固定', '小球，平动'])
      expect(r.scene.meta.assumptions).toEqual(['槽固定', '小球，平动'])
      expect(r.scene.params.fixed).toBe(1)
    }
  })

  it('chain 模式：阶段拼成地形 + 小球 + 观测器，且没有 layout 可重排', () => {
    const scene = sceneFromStages([
      { kind: 'slope', angle: 30, length: 2, radius: 1, arcDeg: 60 },
      { kind: 'flat', angle: 0, length: 1.5, radius: 1, arcDeg: 60 },
      { kind: 'arc', angle: 0, length: 1, radius: 0.6, arcDeg: 90 },
    ])
    expect(scene.bodies.length).toBeGreaterThanOrEqual(5)
    expect(scene.observers.some((o) => o.kind === 'chart')).toBe(true)
    expect(scene.bodies.some((b) => b.kind === 'particle')).toBe(true)
    expect(scene.params).toEqual({})
  })

  it('chain 模式走 sceneFromPlan 也成立', () => {
    const r = sceneFromPlan({
      mode: 'chain',
      stages: [{ kind: 'slope', angle: 30, length: 2, radius: 1, arcDeg: 60 }],
      assumptions: ['小球，平动'],
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.archetype).toBe('chain')
      expect(r.scene.meta.preset).toBeUndefined()
    }
  })

  it('unsupported 模式：不建场景，把「缺什么」原样带出来', () => {
    const r = sceneFromPlan({ mode: 'unsupported', unsupported: ['电磁感应'], reason: '没有对应模型' })
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.unsupported).toEqual(['电磁感应'])
      expect(r.error).toContain('电磁感应')
      expect(r.hints.join(' ')).toContain('没有对应模型')
    }
  })

  it('端到端：模型返回的文本 → 场景（中间不碰网络）', () => {
    const raw = '```json\n{"mode":"preset","archetype":"projectile","params":{"v0":8,"h":5},"assumptions":["不计空气阻力"]}\n```'
    const p = parsePlan(raw)
    expect(p.ok).toBe(true)
    if (!p.ok) return
    const r = sceneFromPlan(p.plan)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.scene.params.v0).toBe(8)
      expect(r.scene.params.h).toBe(5)
      expect(r.scene.meta.preset).toBe('projectile')
    }
  })
})
