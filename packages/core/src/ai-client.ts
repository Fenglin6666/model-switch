/**
 * LLM 客户端：一次请求，把「题干」换成「建模决定」。
 *
 * 各家跨域情况不一样，这决定了要不要转发层（都实测过）：
 *   - 智谱 open.bigmodel.cn：OPTIONS **不回** Access-Control-Allow-Origin → 浏览器直连必失败，
 *     必须走转发（开发期是 Vite 的 `/llm` proxy）
 *   - DeepSeek api.deepseek.com：预检**回** allow-origin + allow-headers → 可以直连，不需要代理
 *
 * key 只存在用户本地（localStorage），不进代码、不进构建产物、不进仓库。
 * 请求失败不会偷偷降级——明确报错，让用户去「AI 建模」点「测一下」。
 */
import { parsePlan, planPrompt, type AiPlan } from './ai-plan'

export type AiConfig = {
  /** 可以是相对路径（走转发层），也可以是完整 URL（用户自己的代理） */
  endpoint: string
  model: string
  key: string
}

export type ProviderId = 'zhipu-coding' | 'deepseek' | 'custom'

export type Provider = {
  id: ProviderId
  label: string
  /** 端点：相对路径 = 走转发；完整 URL = 直连 */
  endpoint: string
  models: string[]
  /** 需不需要转发层（取决于厂商的 CORS 策略，见文件头） */
  needsProxy: boolean
  /** 这个服务商的 key 长什么样，用来自检「key 和端点对不上」 */
  keyPattern?: RegExp
  keyHint?: string
}

/**
 * 支持的服务商。加一家 = 往这里加一条 + （如果需要）在 vite.config 里加一条 proxy。
 * 顺序就是面板上点一下轮换的顺序。
 */
export const PROVIDERS: Provider[] = [
  {
    id: 'zhipu-coding',
    label: '智谱 GLM（Coding Plan）',
    // 开发期由 Vite 转发到 https://open.bigmodel.cn/api/coding/paas/v4
    endpoint: '/llm/chat/completions',
    models: ['glm-4.6', 'glm-4.5'],
    needsProxy: true,
    // 智谱的 key 是 "<id>.<secret>"，中间有个点
    keyPattern: /^[0-9a-zA-Z]{8,}.[0-9a-zA-Z]{8,}$/,
    keyHint: '形如 xxxx.yyyy（中间一个点）',
  },
  {
    id: 'deepseek',
    label: 'DeepSeek',
    endpoint: 'https://api.deepseek.com/chat/completions',
    models: ['deepseek-chat', 'deepseek-reasoner'],
    needsProxy: false,
    keyPattern: /^sk-[0-9a-zA-Z]{16,}$/,
    keyHint: '形如 sk-…（没有点）',
  },
  { id: 'custom', label: '自定义端点', endpoint: '', models: [], needsProxy: false },
]

export function providerById(id: ProviderId | undefined): Provider {
  return PROVIDERS.find((x) => x.id === id) ?? PROVIDERS[0]!
}

/** 从端点反查服务商（端点是我们自己的默认值时能认出来，用户改过就当自定义） */
export function providerByEndpoint(endpoint: string): Provider {
  return PROVIDERS.find((p) => p.id !== 'custom' && p.endpoint === endpoint) ?? providerById('custom')
}

/**
 * 要不要发 `thinking: {type:'disabled'}`。
 * 只有智谱认这个字段；OpenAI 兼容端点（DeepSeek 等）多传一个未知字段可能直接 400。
 */
export function supportsThinkingToggle(endpoint: string): boolean {
  return endpoint.startsWith('/llm') || endpoint.includes('bigmodel.cn')
}

export const DEFAULT_AI_CONFIG: Omit<AiConfig, 'key'> = {
  endpoint: '/llm/chat/completions',
  model: 'glm-4.6',
}

/** 建议的模型（用户可改） */
export const AI_MODEL_SUGGESTIONS = ['glm-4.6', 'glm-4.5', 'deepseek-chat', 'deepseek-reasoner']

/** key 的形态像哪一家——用来抓「拿 DeepSeek 的 key 打智谱端点」这种错配 */
export function guessProviderByKey(key: string): Provider | null {
  const k = key.trim()
  if (!k) return null
  return PROVIDERS.find((p) => p.keyPattern?.test(k)) ?? null
}

/**
 * 配置体检：不看网络，只比「key 的形态」和「端点属于谁」。
 * 这是 401 最常见的原因——不同家的 key 打错端点，服务端只会说「身份验证失败」。
 */
export function configSuspicion(cfg: AiConfig): string | null {
  const guess = guessProviderByKey(cfg.key)
  if (!guess) return null
  const actual = PROVIDERS.find((p) => p.id !== 'custom' && (cfg.endpoint === p.endpoint || cfg.endpoint.includes(new URL(p.endpoint, 'http://x').hostname)))
  if (actual && actual.id !== guess.id) {
    return 'key 是「' + guess.label + '」的，端点是「' + actual.label + '」· 换服务商'
  }
  return null
}

export type AiResult = { ok: true; plan: AiPlan; ms: number } | { ok: false; error: string; ms: number }

export function aiConfigReady(cfg: Partial<AiConfig> | null | undefined): cfg is AiConfig {
  return !!cfg && !!cfg.key?.trim() && !!cfg.endpoint?.trim() && !!cfg.model?.trim()
}

/** 从接口响应里取正文。思考模型会把内容放 reasoning_content，正文可能在 content。 */
export function pickContent(json: unknown): string {
  const j = json as { choices?: { message?: { content?: unknown } }[] }
  const c = j?.choices?.[0]?.message?.content
  if (typeof c === 'string') return c
  // 少数网关返回数组形态的 content
  if (Array.isArray(c)) {
    return c
      .map((part) => (part && typeof part === 'object' && 'text' in part ? String((part as { text: unknown }).text) : ''))
      .join('')
  }
  return ''
}

/** 把厂商/网络错误翻译成一句能行动的话（401 这种光说「身份验证失败」没法排查） */
export function explainAiError(status: number, raw: string, cfg?: AiConfig): string {
  let code = ''
  let msg = raw.slice(0, 200)
  try {
    const j = JSON.parse(raw) as { error?: { message?: string; code?: string } }
    if (j.error?.message) msg = j.error.message
    if (j.error?.code) code = j.error.code
  } catch {
    /* 不是 JSON 就用原文 */
  }
  if (status === 401 || status === 403 || code === '1000') {
    // 先看是不是「key 和端点不是一家」——这比「key 过期」常见得多
    const suspect = cfg ? configSuspicion(cfg) : null
    if (suspect) return suspect
    return `Key 无效或已过期（${status}）· 确认没粘漏，或换一家服务商`
  }
  if (status === 404) return `端点不通（404）· 检查 dev server 和端点路径`
  if (status === 429) return `请求太频繁或额度用尽（429）`
  if (code === '1113') return `额度不足（1113）· ${msg}`
  return `接口返回 ${status}：${msg}`
}

/**
 * 自检：拿当前配置发一次最小请求，把问题定位到「key / 端点 / 模型 / 额度 / 网络」中的一项。
 * 401 这种错误光看 toast 排查不了，得有个能点的地方。
 */
export async function probeAi(cfg: AiConfig, timeoutMs = 20000): Promise<{ ok: boolean; ms: number; message: string }> {
  const t0 = Date.now()
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(cfg.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.key}` },
      body: JSON.stringify({
        model: cfg.model,
        messages: [{ role: 'user', content: '只回复：ok' }],
        max_tokens: 64,
        stream: false,
        ...(supportsThinkingToggle(cfg.endpoint) ? { thinking: { type: 'disabled' } } : {}),
      }),
      signal: ctrl.signal,
    })
    const text = await res.text()
    const ms = Date.now() - t0
    if (!res.ok) return { ok: false, ms, message: explainAiError(res.status, text, cfg) }
    return { ok: true, ms, message: `通了（${ms}ms · ${cfg.model}）` }
  } catch (e) {
    const ms = Date.now() - t0
    const aborted = (e as { name?: string })?.name === 'AbortError'
    return { ok: false, ms, message: aborted ? '超时：请求没回来，检查网络或端点' : `网络错误：${String(e).slice(0, 120)}` }
  } finally {
    clearTimeout(timer)
  }
}

export async function askPlan(
  cfg: AiConfig,
  problemText: string,
  opts: { timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<AiResult> {
  const t0 = Date.now()
  const { system, user } = planPrompt(problemText)
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 45000)
  if (opts.signal) {
    if (opts.signal.aborted) ctrl.abort()
    else opts.signal.addEventListener('abort', () => ctrl.abort(), { once: true })
  }

  try {
    const res = await fetch(cfg.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.key}` },
      body: JSON.stringify({
        model: cfg.model,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        temperature: 0.1,
        max_tokens: 1200,
        stream: false,
        // 思考模型会把 token 全花在 reasoning_content 上、content 留空。
        // 我们要的是结构化决定，不是推理过程，所以对认这个字段的厂商关掉它。
        ...(supportsThinkingToggle(cfg.endpoint) ? { thinking: { type: 'disabled' } } : {}),
      }),
      signal: ctrl.signal,
    })

    const ms = Date.now() - t0
    const text = await res.text()
    if (!res.ok) {
      return { ok: false, error: explainAiError(res.status, text, cfg), ms }
    }

    let json: unknown
    try {
      json = JSON.parse(text)
    } catch {
      return { ok: false, error: '接口返回的不是 JSON', ms }
    }
    const content = pickContent(json)
    if (!content.trim()) return { ok: false, error: '模型返回了空内容', ms }

    const parsed = parsePlan(content)
    if (!parsed.ok) return { ok: false, error: parsed.error, ms }
    return { ok: true, plan: parsed.plan, ms }
  } catch (e) {
    const ms = Date.now() - t0
    const aborted = (e as { name?: string })?.name === 'AbortError'
    return { ok: false, error: aborted ? '请求超时' : `网络错误：${String(e).slice(0, 120)}`, ms }
  } finally {
    clearTimeout(timer)
  }
}
