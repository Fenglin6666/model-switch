/**
 * LLM 客户端：一次请求，把「题干」换成「建模决定」。
 *
 * 为什么不在浏览器里直连厂商 API：**跨域预检过不去**（实测 open.bigmodel.cn 的
 * OPTIONS 不回 Access-Control-Allow-Origin），浏览器会直接 `Failed to fetch`。
 * 所以默认走一个转发层（开发期是 Vite 的 `/llm` proxy），端点可配。
 *
 * key 只存在用户本地（localStorage），不进代码、不进构建产物、不进仓库。
 * 没有 key 或请求失败 → 调用方回退到规则解析 `parseProblem`。
 */
import { parsePlan, planPrompt, type AiPlan } from './ai-plan'

export type AiConfig = {
  /** 可以是相对路径（走转发层），也可以是完整 URL（用户自己的代理） */
  endpoint: string
  model: string
  key: string
}

export const DEFAULT_AI_CONFIG: Omit<AiConfig, 'key'> = {
  // 开发期由 Vite 转发到 https://open.bigmodel.cn/api/coding/paas/v4
  endpoint: '/llm/chat/completions',
  model: 'glm-4.6',
}

/** 建议的模型（用户可改；Coding Plan 的 key 走 coding 端点） */
export const AI_MODEL_SUGGESTIONS = ['glm-4.6', 'glm-4.5', 'glm-4-plus']

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
export function explainAiError(status: number, raw: string): string {
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
    return (
      `Key 无效或已过期（HTTP ${status}）。去「AI 建模」重新粘贴一次——` +
      '要用 Coding Plan 的 key；普通 API key 打在 coding 端点上会被拒。'
    )
  }
  if (status === 404) return `端点不对（HTTP 404）：${msg}。检查端点是不是 /llm/chat/completions，以及 dev server 有没有起`
  if (status === 429) return `请求太频繁或额度用尽（HTTP 429）：${msg}`
  if (code === '1113') return `额度不足：${msg}`
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
        thinking: { type: 'disabled' },
      }),
      signal: ctrl.signal,
    })
    const text = await res.text()
    const ms = Date.now() - t0
    if (!res.ok) return { ok: false, ms, message: explainAiError(res.status, text) }
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
        // 我们要的是结构化决定，不是推理过程，所以关掉；不认这个字段的厂商会忽略它。
        thinking: { type: 'disabled' },
      }),
      signal: ctrl.signal,
    })

    const ms = Date.now() - t0
    const text = await res.text()
    if (!res.ok) {
      return { ok: false, error: explainAiError(res.status, text), ms }
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
