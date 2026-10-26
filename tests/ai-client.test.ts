/**
 * AI 客户端：错误翻译 + 配置就绪判断。
 *
 * 为什么专门测这个：401 这种错光看 toast 排查不了（「身份验证失败」不告诉你是 key 错、
 * 端点错还是额度问题）。所以错误必须翻译成「该去改什么」，而且这条映射不能漂。
 */
import { describe, expect, it } from 'vitest'
import { aiConfigReady, explainAiError, pickContent } from '../packages/core/src/ai-client'

describe('配置就绪', () => {
  it('key / 端点 / 模型 都填了才算就绪', () => {
    expect(aiConfigReady({ key: 'k', model: 'm', endpoint: 'e' })).toBe(true)
    expect(aiConfigReady({ key: '  ', model: 'm', endpoint: 'e' })).toBe(false)
    expect(aiConfigReady({ key: 'k', model: '', endpoint: 'e' })).toBe(false)
    expect(aiConfigReady(null)).toBe(false)
  })
})

describe('错误翻译：每条都要指向「该去改什么」', () => {
  it('401 / 1000 → 说 key 无效，并提示要用 Coding Plan 的 key', () => {
    const m = explainAiError(401, '{"error":{"code":"1000","message":"身份验证失败"}}')
    expect(m).toContain('Key 无效')
    expect(m).toContain('Coding Plan')
    // 不能只把厂商原话丢给用户
    expect(m).not.toBe('身份验证失败')
  })

  it('403 也归到 key 问题', () => {
    expect(explainAiError(403, '{}')).toContain('Key 无效')
  })

  it('404 → 指向端点（这条最常见：没起 dev server / 端点写错）', () => {
    const m = explainAiError(404, 'not found')
    expect(m).toContain('端点')
    expect(m).toContain('/llm/chat/completions')
  })

  it('1113 → 说额度不足，不要误报成 key 错', () => {
    const m = explainAiError(400, '{"error":{"code":"1113","message":"余额不足或无可用资源包"}}')
    expect(m).toContain('额度不足')
    expect(m).not.toContain('Key 无效')
  })

  it('429 → 说太频繁/额度', () => {
    expect(explainAiError(429, '{}')).toContain('额度')
  })

  it('不认识的错误也带上原始信息，别吞掉', () => {
    const m = explainAiError(500, '内部错误 XYZ')
    expect(m).toContain('500')
    expect(m).toContain('内部错误 XYZ')
  })
})

describe('取正文', () => {
  it('标准 choices[0].message.content', () => {
    expect(pickContent({ choices: [{ message: { content: '{"mode":"preset"}' } }] })).toBe('{"mode":"preset"}')
  })

  it('思考模型 content 为空时返回空串（让上层报「空内容」，不要瞎猜）', () => {
    expect(pickContent({ choices: [{ message: { content: '', reasoning_content: '想了很多' } }] })).toBe('')
  })

  it('数组形态的 content 也能拼', () => {
    expect(pickContent({ choices: [{ message: { content: [{ text: 'a' }, { text: 'b' }] } }] })).toBe('ab')
  })

  it('结构不对返回空串，不抛', () => {
    expect(pickContent(null)).toBe('')
    expect(pickContent({})).toBe('')
  })
})
