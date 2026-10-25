/**
 * 临界判据通用化：任意场景 + 任意参数 + 任意判据 → 找翻转点。
 *
 * 现状（v5.3）只有 `scene.search`：每个场景手写一条「参数区间 + 判据」，
 * 于是 46% 含临界结构的计算题只有最窄的一条路能走。
 *
 * 这里做的事：
 *  - 给常见参数一份「可扫区间」表（题干用词，不暴露引擎字段）；
 *  - 从任意场景里推出「哪些参数能扫、哪些判据能看」；
 *  - 生成一条与旧 `scene.search` 完全同构的 spec，UI 与搜索链路不用改。
 */
import type { Criterion, Scene } from './scene'

export type ParamMeta = {
  key: string
  label: string
  unit?: string
  min: number
  max: number
  step: number
  decimals: number
}

/** 只列「连续变化有意义」的参数；0/1 开关（fixed/roll/drag/model/ball）故意不进来 */
export const PARAM_META: Record<string, ParamMeta> = {
  theta: { key: 'theta', label: '倾角 θ', unit: '°', min: 5, max: 75, step: 1, decimals: 0 },
  mu: { key: 'mu', label: '动摩擦因数 μ', min: 0, max: 0.95, step: 0.05, decimals: 2 },
  muArc: { key: 'muArc', label: '圆弧摩擦因数', min: 0, max: 0.9, step: 0.05, decimals: 2 },
  v0: { key: 'v0', label: '初速度 v₀', unit: 'm/s', min: 0, max: 20, step: 0.5, decimals: 1 },
  mass: { key: 'mass', label: '质量 m', unit: 'kg', min: 0.1, max: 5, step: 0.1, decimals: 1 },
  m: { key: 'm', label: '质量 m', unit: 'kg', min: 0.1, max: 5, step: 0.1, decimals: 1 },
  M: { key: 'M', label: '槽质量 M', unit: 'kg', min: 0.2, max: 5, step: 0.1, decimals: 1 },
  R: { key: 'R', label: '半径 R', unit: 'm', min: 0.3, max: 1.5, step: 0.05, decimals: 2 },
  k: { key: 'k', label: '劲度系数 k', unit: 'N/m', min: 5, max: 200, step: 5, decimals: 0 },
  L: { key: 'L', label: '摆长 L', unit: 'm', min: 0.2, max: 4, step: 0.1, decimals: 1 },
  l: { key: 'l', label: '板长 l', unit: 'm', min: 0.4, max: 2, step: 0.1, decimals: 1 },
  h: { key: 'h', label: '高度 h', unit: 'm', min: 0.2, max: 3, step: 0.1, decimals: 1 },
  E: { key: 'E', label: '电场 E', min: 0, max: 120, step: 5, decimals: 0 },
  B: { key: 'B', label: '磁感应强度 B', min: 0, max: 6, step: 0.5, decimals: 1 },
  q: { key: 'q', label: '电荷量 q', min: 0.2, max: 3, step: 0.2, decimals: 1 },
  slopeDeg: { key: 'slopeDeg', label: '斜面倾角', unit: '°', min: 5, max: 75, step: 1, decimals: 0 },
  slopeLen: { key: 'slopeLen', label: '斜面长度', unit: 'm', min: 0.5, max: 5, step: 0.1, decimals: 1 },
  flatLen: { key: 'flatLen', label: '水平段长度', unit: 'm', min: 0.3, max: 4, step: 0.1, decimals: 1 },
  flatMu: { key: 'flatMu', label: '水平段摩擦', min: 0, max: 0.9, step: 0.05, decimals: 2 },
  upDeg: { key: 'upDeg', label: '上坡倾角', unit: '°', min: 5, max: 75, step: 1, decimals: 0 },
  arcR: { key: 'arcR', label: '圆弧半径', unit: 'm', min: 0.3, max: 2, step: 0.1, decimals: 1 },
  arcDeg: { key: 'arcDeg', label: '圆弧圆心角', unit: '°', min: 10, max: 180, step: 5, decimals: 0 },
  m1: { key: 'm1', label: '质量 m₁', unit: 'kg', min: 0.2, max: 5, step: 0.1, decimals: 1 },
  m2: { key: 'm2', label: '质量 m₂', unit: 'kg', min: 0.2, max: 5, step: 0.1, decimals: 1 },
  v1: { key: 'v1', label: '速度 v₁', unit: 'm/s', min: 0, max: 8, step: 0.5, decimals: 1 },
  v2: { key: 'v2', label: '速度 v₂', unit: 'm/s', min: -8, max: 0, step: 0.5, decimals: 1 },
  e: { key: 'e', label: '恢复系数 e', min: 0, max: 1, step: 0.05, decimals: 2 },
  T: { key: 'T', label: '温度 T', unit: 'K', min: 200, max: 500, step: 10, decimals: 0 },
  P0: { key: 'P0', label: '外界压强', min: 50, max: 200, step: 5, decimals: 0 },
  r: { key: 'r', label: '距离 r', min: 0.5, max: 5, step: 0.1, decimals: 1 },
  v: { key: 'v', label: '速度 v', unit: 'm/s', min: 0, max: 8, step: 0.2, decimals: 1 },
}

/** 建议优先扫的参数：临界题里最高频的几个（v₀ → θ → μ → R） */
const PRIORITY = ['v0', 'theta', 'mu', 'R', 'h', 'k', 'L', 'l', 'E', 'B', 'mass', 'm']

export function thresholdParams(scene: Scene): ParamMeta[] {
  const out: ParamMeta[] = []
  for (const key of Object.keys(scene.params ?? {})) {
    const meta = PARAM_META[key]
    if (meta) out.push(meta)
  }
  // 按「临界题常见程度」排序，滑杆面板第一眼看到的就是最该扫的那个
  out.sort((a, b) => {
    const ia = PRIORITY.indexOf(a.key)
    const ib = PRIORITY.indexOf(b.key)
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib)
  })
  return out
}

export type CriterionOption = { id: string; label: string; kind: Criterion['kind'] }

export function thresholdCriteria(scene: Scene): CriterionOption[] {
  return scene.criteria.map((c) => ({ id: c.id, label: criterionLabel(c), kind: c.kind }))
}

export function criterionLabel(c: Criterion): string {
  if (c.label) return c.label
  switch (c.kind) {
    case 'detach':
      return '脱离轨道'
    case 'reach':
      return '到达区域'
    case 'escape':
      return '穿出区域'
    case 'coincide':
      return '共速'
    case 'collide':
      return '碰撞'
    case 'conserve':
      return c.quantity === 'E' ? '机械能守恒' : '动量守恒'
  }
}

/**
 * 场景里有没有「能找临界」的东西：
 * 至少一个可扫参数 + 至少一个判据。守恒类判据也能扫（它会在某个参数上从守恒变不守恒）。
 */
export function canSearchThreshold(scene: Scene): boolean {
  return thresholdParams(scene).length > 0 && scene.criteria.length > 0
}

/** 默认选哪个参数/判据：优先「非守恒判据 + 最高频参数」 */
export function suggestedThreshold(scene: Scene): { param: string; criterionId: string } | null {
  const params = thresholdParams(scene)
  if (!params.length) return null
  const criteria = thresholdCriteria(scene)
  if (!criteria.length) return null
  const flip = criteria.find((c) => c.kind !== 'conserve') ?? criteria[0]!
  return { param: params[0]!.key, criterionId: flip.id }
}

/** 生成与旧 `scene.search` 同构的 spec：搜索链路、分享、UI 都不用改 */
export function thresholdSpec(
  scene: Scene,
  paramKey: string,
  criterionId: string,
): NonNullable<Scene['search']> | null {
  const meta = PARAM_META[paramKey]
  if (!meta) return null
  if (!scene.params || scene.params[paramKey] === undefined) return null
  if (!scene.criteria.some((c) => c.id === criterionId)) return null
  return {
    path: `/params/${paramKey}`,
    label: meta.label,
    min: meta.min,
    max: meta.max,
    criterionId,
  }
}
