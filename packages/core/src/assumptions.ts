/**
 * 假设可勾选：生成后的「假设」不是一句说明，而是一排可点的 chip。
 *
 * 目的（EXECUTION-PLAN §4 任务 1.2）：把生成后的纠错成本从 30–120 秒压到 ≤2 次点击。
 *  - 四类必须能切：滑块/小球、光滑/粗糙、固定/可移动、有无阻力；
 *  - 切换只写 `scene.params`，所以改完的分享串仍然能压回 `p1.`；
 *  - 切换后重跑 `layout()`，几何跟着变（不是隐藏开关，是参数连续变化）。
 */
import type { Scene } from './scene'
import { cloneScene } from './scene'
import { presetById } from './presets'

export type AssumptionToggle = {
  id: string
  /** 分类名：主体 / 表面 / 槽 / 空气阻力 … */
  label: string
  value: string
  options: Array<{ value: string; label: string }>
}

const on = (v: number | undefined, threshold = 0.5) => (v ?? 0) >= threshold

function toggle(
  id: string,
  label: string,
  value: string,
  options: Array<[string, string]>,
): AssumptionToggle {
  return { id, label, value, options: options.map(([v, l]) => ({ value: v, label: l })) }
}

/** 从当前场景读出「现在是什么假设」。只依赖 preset + params，不存额外状态。 */
export function assumptionToggles(scene: Scene): AssumptionToggle[] {
  const p = scene.params ?? {}
  const preset = scene.meta.preset
  const list: AssumptionToggle[] = []
  if (preset === 'incline') {
    const body = on(p.ball) ? (on(p.model) ? 'roll' : 'ball') : 'block'
    list.push(
      toggle('body', '主体', body, [
        ['block', '滑块'],
        ['ball', '小球'],
        ['roll', '小球·滚动'],
      ]),
    )
    list.push(
      toggle('surface', '表面', (p.mu ?? 0.25) <= 0.001 ? 'smooth' : 'rough', [
        ['rough', '粗糙'],
        ['smooth', '光滑'],
      ]),
    )
  } else if (preset === 'trough') {
    list.push(
      toggle('mount', '槽', on(p.fixed) ? 'fixed' : 'free', [
        ['free', '可移动'],
        ['fixed', '固定'],
      ]),
    )
    list.push(
      toggle('ball', '球', on(p.roll) ? 'roll' : 'slide', [
        ['slide', '平动'],
        ['roll', '滚动'],
      ]),
    )
  } else if (preset === 'loop') {
    list.push(
      toggle('ball', '小球', on(p.roll) ? 'roll' : 'point', [
        ['point', '质点'],
        ['roll', '滚动'],
      ]),
    )
  } else if (preset === 'projectile') {
    list.push(
      toggle('air', '空气阻力', on(p.drag) ? 'on' : 'none', [
        ['none', '不计'],
        ['on', '计入'],
      ]),
    )
  } else if (preset === 'rampArc') {
    list.push(
      toggle('body', '主体', on(p.ball) ? 'ball' : 'block', [
        ['ball', '小球'],
        ['block', '滑块'],
      ]),
    )
    list.push(
      toggle('slope', '斜面', (p.mu ?? 0.25) <= 0.001 ? 'smooth' : 'rough', [
        ['rough', '粗糙'],
        ['smooth', '光滑'],
      ]),
    )
    list.push(
      toggle('arc', '圆弧', (p.muArc ?? 0) <= 0.001 ? 'smooth' : 'rough', [
        ['smooth', '光滑'],
        ['rough', '粗糙'],
      ]),
    )
  } else if (preset === 'boardBlock') {
    list.push(
      toggle('surface', '板面', (p.mu ?? 0.3) <= 0.001 ? 'smooth' : 'rough', [
        ['rough', '粗糙'],
        ['smooth', '光滑'],
      ]),
    )
  }
  return list
}

/** 把假设写成一句句中文，状态条和分享串都用它 */
export function assumptionText(scene: Scene): string[] {
  const toggles = assumptionToggles(scene)
  // 没有可切假设的场景（弹簧、单摆、场…）保留题目解析写下的原文
  if (!toggles.length) return [...(scene.meta.assumptions ?? [])]
  const out: string[] = []
  for (const t of toggles) {
    if (t.id === 'body') out.push(t.value === 'block' ? '滑块，平动' : t.value === 'roll' ? '小球，纯滚动' : '小球，平动')
    else if (t.id === 'surface' || t.id === 'slope') out.push(t.value === 'smooth' ? '表面光滑' : '表面粗糙')
    else if (t.id === 'arc') out.push(t.value === 'smooth' ? '圆弧光滑' : '圆弧粗糙')
    else if (t.id === 'mount') out.push(t.value === 'fixed' ? '槽固定' : '槽可移动')
    else if (t.id === 'ball') out.push(t.value === 'roll' ? '球，纯滚动' : '球，平动')
    else if (t.id === 'air') out.push(t.value === 'on' ? '考虑空气阻力' : '不计空气阻力')
    else out.push(t.options.find((o) => o.value === t.value)?.label ?? t.value)
  }
  return out
}

/** 切到下一个取值；返回新场景（不改原对象），供撤销栈使用 */
export function cycleAssumption(scene: Scene, id: string): { scene: Scene; toggle: AssumptionToggle } | null {
  const current = assumptionToggles(scene).find((t) => t.id === id)
  if (!current || current.options.length < 2) return null
  const idx = current.options.findIndex((o) => o.value === current.value)
  const next = current.options[(idx + 1) % current.options.length]!
  const s = cloneScene(scene)
  applyValue(s, id, next.value)
  const preset = presetById(s.meta.preset ?? '')
  preset?.layout?.(s)
  s.meta.assumptions = assumptionText(s)
  s.meta.updatedAt = Date.now()
  const after = assumptionToggles(s).find((t) => t.id === id) ?? { ...current, value: next.value }
  return { scene: s, toggle: after }
}

function applyValue(s: Scene, id: string, value: string): void {
  const p = s.params
  switch (id) {
    case 'body':
      if (s.meta.preset === 'incline') {
        p.ball = value === 'block' ? 0 : 1
        p.model = value === 'roll' ? 1 : 0
      } else if (s.meta.preset === 'rampArc') {
        p.ball = value === 'ball' ? 1 : 0
      }
      break
    case 'surface':
      if (s.meta.preset === 'boardBlock') {
        p.mu = value === 'smooth' ? 0 : 0.3
      } else {
        p.mu = value === 'smooth' ? 0 : 0.25
      }
      break
    case 'slope':
      p.mu = value === 'smooth' ? 0 : 0.25
      break
    case 'arc':
      p.muArc = value === 'smooth' ? 0 : 0.5
      break
    case 'mount':
      p.fixed = value === 'fixed' ? 1 : 0
      break
    case 'ball':
      p.roll = value === 'roll' ? 1 : 0
      break
    case 'air':
      p.drag = value === 'on' ? 1 : 0
      break
    default:
      break
  }
}
