/**
 * 约束的属性表：一张表管「面板显示什么 + 改完怎么落回场景」。
 *
 * 为什么要表驱动：原来的 `renderConstraintSheet` 是 if/else 手写的，只认
 * rope/rod/spring 三种，**其余全部落进 else 分支显示成「铰链」**——
 * 选中一条传送带，面板上写着「铰链只固定连接点，不限制转动」，而且没有任何可调项。
 * 传送带的速度、马达的转速、电路的电阻，全都改不了。
 *
 * 这和 body-fields 是同一个教训：**加一种基元，必须只改一处**。
 * 现在加一种约束 = 在 CONSTRAINT_FIELDS 里加一行；面板、高度、setter 自动跟上。
 */
import type { Constraint } from './scene'

export type ConstraintField = {
  /** 写进 edits.constraints 的键，必须和 ConstraintEdit 对得上 */
  key: string
  label: string
  unit?: string
  min: number
  max: number
  step: number
  decimals: number
  read: (c: Constraint) => number | null
  write: (c: Constraint, v: number) => Constraint
}

/** 只有对应类型才返回非 null；这样 read 写起来不用每处都判类型 */
const num = (v: number | undefined): number | null => (v === undefined ? null : v)

/**
 * 建一行表。`T` 由 get/set 的参数推断，所以每个字段内部都能直接 `{...c, x: v}`，
 * 不用在表里到处写 `c.type === 'spring' ? ... : null`。
 * 外层的 read/write 收窄责任在 constraintFields 的调用方——按 type 查表，类型天然对得上。
 */
function f<T extends Constraint>(
  key: string,
  label: string,
  opts: {
    unit?: string
    min: number
    max: number
    step: number
    decimals: number
    get: (c: T) => number | null
    set: (c: T, v: number) => T
  },
): ConstraintField {
  return {
    key,
    label,
    unit: opts.unit,
    min: opts.min,
    max: opts.max,
    step: opts.step,
    decimals: opts.decimals,
    read: (c) => opts.get(c as unknown as T),
    write: (c, v) => opts.set(c as unknown as T, v) as Constraint,
  }
}

const length = (min = 0.1, max = 6) =>
  f('length', '长度', {
    unit: ' m',
    min,
    max,
    step: 0.01,
    decimals: 2,
    get: (c: Extract<Constraint, { type: 'rope' | 'rod' }>) => c.length,
    set: (c, v) => ({ ...c, length: v }),
  })

export const CONSTRAINT_FIELDS: Record<Constraint['type'], ConstraintField[]> = {
  rope: [length()],
  rod: [length()],
  spring: [
    f('k', '劲度系数 k', {
      unit: ' N/m',
      min: 1,
      max: 120,
      step: 1,
      decimals: 0,
      get: (c: Extract<Constraint, { type: 'spring' }>) => c.k,
      set: (c, v) => ({ ...c, k: v }),
    }),
    f('l0', '原长 l₀', {
      unit: ' m',
      min: 0.1,
      max: 5,
      step: 0.01,
      decimals: 2,
      get: (c: Extract<Constraint, { type: 'spring' }>) => c.l0,
      set: (c, v) => ({ ...c, l0: v }),
    }),
    f('damping', '阻尼', {
      min: 0,
      max: 2,
      step: 0.05,
      decimals: 2,
      get: (c: Extract<Constraint, { type: 'spring' }>) => c.damping,
      set: (c, v) => ({ ...c, damping: v }),
    }),
  ],
  hinge: [],
  pulley: [
    f('ratio', '力比', {
      min: 0.25,
      max: 4,
      step: 0.25,
      decimals: 2,
      get: (c: Extract<Constraint, { type: 'pulley' }>) => c.ratio ?? 1,
      set: (c, v) => ({ ...c, ratio: v }),
    }),
  ],
  prismatic: [
    f('lower', '行程下限', {
      unit: ' m',
      min: -6,
      max: 0,
      step: 0.05,
      decimals: 2,
      get: (c: Extract<Constraint, { type: 'prismatic' }>) => num(c.lower),
      set: (c, v) => ({ ...c, lower: v }),
    }),
    f('upper', '行程上限', {
      unit: ' m',
      min: 0,
      max: 6,
      step: 0.05,
      decimals: 2,
      get: (c: Extract<Constraint, { type: 'prismatic' }>) => num(c.upper),
      set: (c, v) => ({ ...c, upper: v }),
    }),
  ],
  track: [
    f('radius', '轨道半径', {
      unit: ' m',
      min: 0.2,
      max: 3,
      step: 0.01,
      decimals: 2,
      get: (c: Extract<Constraint, { type: 'track' }>) => c.radius,
      set: (c, v) => ({ ...c, radius: v }),
    }),
  ],
  belt: [
    f('speed', '带速', {
      unit: ' m/s',
      min: -6,
      max: 6,
      step: 0.1,
      decimals: 1,
      get: (c: Extract<Constraint, { type: 'belt' }>) => c.speed,
      set: (c, v) => ({ ...c, speed: v }),
    }),
  ],
  pin: [],
  motor: [
    f('omega', '角速度 ω', {
      unit: ' rad/s',
      min: -12,
      max: 12,
      step: 0.5,
      decimals: 1,
      get: (c: Extract<Constraint, { type: 'motor' }>) => c.omega,
      set: (c, v) => ({ ...c, omega: v }),
    }),
  ],
  circuit: [
    f('length', '有效长度 L', {
      unit: ' m',
      min: 0.1,
      max: 2,
      step: 0.05,
      decimals: 2,
      get: (c: Extract<Constraint, { type: 'circuit' }>) => c.length,
      set: (c, v) => ({ ...c, length: v }),
    }),
    f('resistance', '回路电阻 R', {
      unit: ' Ω',
      min: 0.1,
      max: 8,
      step: 0.1,
      decimals: 1,
      get: (c: Extract<Constraint, { type: 'circuit' }>) => c.resistance,
      set: (c, v) => ({ ...c, resistance: v }),
    }),
    f('emf0', '外接电动势', {
      unit: ' V',
      min: -6,
      max: 6,
      step: 0.1,
      decimals: 1,
      get: (c: Extract<Constraint, { type: 'circuit' }>) => c.emf0 ?? 0,
      set: (c, v) => ({ ...c, emf0: v }),
    }),
  ],
}

/** 这个约束在面板里能改哪几个数 */
export function constraintFields(c: Constraint): ConstraintField[] {
  return CONSTRAINT_FIELDS[c.type] ?? []
}

const TITLES: Record<Constraint['type'], { name: string; hint: string }> = {
  rope: { name: '绳', hint: '只能拉不能推；超过长度就绷紧' },
  rod: { name: '杆', hint: '刚性连接：距离固定，能推能拉' },
  spring: { name: '弹簧', hint: 'F = k(x − l₀)，带阻尼' },
  hinge: { name: '铰链', hint: '两端点始终重合，但允许相对转动' },
  pulley: { name: '滑轮', hint: '绳跨过定滑轮：两端位移相等，张力按力比分配' },
  prismatic: { name: '导轨', hint: '只能沿一个方向滑动，可设行程限位' },
  track: { name: '圆轨道', hint: '质心锁在圆上；法向力为负即脱离' },
  belt: { name: '传送带', hint: '表面匀速移动，靠摩擦带动物体' },
  pin: { name: '销钉', hint: '钉住的点不动，物体可绕它转' },
  motor: { name: '马达', hint: '强制角速度（伺服语义，确定可复现）' },
  circuit: { name: '电路', hint: '导体棒切割：ε = BLv → I = ε/R → F = BIL' },
}

export function constraintTitle(c: Constraint): { name: string; hint: string } {
  return TITLES[c.type] ?? { name: c.type, hint: '' }
}

/**
 * 「贴身」约束：只作用于一个物体，几何上看不见（不像绳那样有一条线）。
 * 这类约束没法靠点线选中，只能挂在物体面板上——见 App 的「机制」区。
 */
export const BODY_BOUND_TYPES: ReadonlyArray<Constraint['type']> = ['belt', 'motor', 'circuit', 'pin', 'prismatic']

export function isBodyBound(c: Constraint): boolean {
  return BODY_BOUND_TYPES.includes(c.type)
}
