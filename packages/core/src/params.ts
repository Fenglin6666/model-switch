/**
 * 场景参数的可调区间（题干用词：θ、μ、v₀、R…）。
 *
 * 只列「连续变化有意义」的参数；0/1 开关（fixed/roll/drag/model/ball）故意不进来。
 * 左侧参数面板按这张表生成滑杆——**参数名必须来自题干**，不能暴露引擎字段。
 */
import type { Scene } from './scene'

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
  // h 上限原来是 3 m，但平抛/悬崖题经常到十几米——滑杆拖不到就没法改。
  // 注意：这里的区间是**滑杆能拖到哪儿**，不是物理上限。
  h: { key: 'h', label: '高度 h', unit: 'm', min: 0.2, max: 20, step: 0.1, decimals: 1 },
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
  // 电磁感应单棒切割专用。**不能复用 R / L**——那两个在别的场景里是「半径」和「摆长」，
  // 共用 key 会让面板把电阻标成半径。
  res: { key: 'res', label: '回路电阻 R', unit: 'Ω', min: 0.1, max: 5, step: 0.1, decimals: 1 },
  Lrod: { key: 'Lrod', label: '有效长度 L', unit: 'm', min: 0.2, max: 1.5, step: 0.1, decimals: 1 },
  F: { key: 'F', label: '拉力 F', unit: 'N', min: 0, max: 5, step: 0.1, decimals: 1 },
}

/** 建议优先显示的参数：临界题里最高频的几个（v₀ → θ → μ → R） */
const PRIORITY = ['v0', 'theta', 'mu', 'R', 'h', 'k', 'L', 'l', 'E', 'B', 'mass', 'm']

/** 当前场景里可调的参数（按「常见程度」排序，面板第一眼看到最该调的那个） */
export function sceneParams(scene: Scene): ParamMeta[] {
  const out: ParamMeta[] = []
  for (const key of Object.keys(scene.params ?? {})) {
    const meta = PARAM_META[key]
    if (meta) out.push(meta)
  }
  out.sort((a, b) => {
    const ia = PRIORITY.indexOf(a.key)
    const ib = PRIORITY.indexOf(b.key)
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib)
  })
  return out
}
