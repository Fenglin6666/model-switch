/**
 * 物体的属性表：**有哪些旋钮、范围多少、什么时候显示**。
 *
 * 为什么要这张表：检查器面板原来是写死的（353 行、一堆 `this.ui.slider(...)`），
 * 加一个属性就得改三处——加一段 UI 代码、改 `sheetHeight()` 里的高度算式、补一个 setter。
 * 忘掉任何一处，就会出现「滑杆画到面板外面」或「点了没反应」。
 *
 * 这张表是**唯一真相**：面板按它渲染，高度按行数算，写值走同一个泛型 setter。
 * 加一个属性 = 往表里加一行。
 *
 * 属性集是**封闭**的（见 docs/DECISIONS.md §2.10）：高中物理的量就这些，
 * 二十来个列得完。判据是「21 年 4462 道真题里没出现过的不进表」。
 *
 * 表里只放 UI 元信息（标签/范围/单位/必需性/显示条件），**不重新定义字段**——
 * 字段本身在 `Body` 类型里，那是唯一真相。否则两处定义一定会漂。
 */
import type { Body, Scene } from './scene'
import { findMaterial } from './scene'

/** 必需性：required 缺了算不了；optional 缺了走默认；implied 由类型决定（不给旋钮） */
export type FieldNeed = 'required' | 'optional' | 'implied'

export type BodyField = {
  key: string
  label: string
  unit?: string
  min: number
  max: number
  step: number
  decimals: number
  need: FieldNeed
  /** 只对会动的物体显示 */
  dynamicOnly?: boolean
  /** 额外显示条件（例如电荷要开了库仑力才显示） */
  when?: (scene: Scene) => boolean
  /**
   * 面板里改值走哪个 setter。缺省用泛型 `setBodyField`。
   * 之所以不全部走泛型：`setBodyAngle` 顺手把物体抬出地面、`setBodyFriction` 会同步 `params.mu`，
   * 这些副作用属于 App，不属于表。表管「显示什么」，setter 管「改完还要做什么」。
   */
  setter?: 'angle' | 'mass' | 'friction' | 'charge'
  hint?: string
  read: (b: Body, scene: Scene) => number
  /** 纯写入；不负责 pushHistory / rebuild / recordBodyEdit —— 那是 App 的事 */
  write: (b: Body, v: number) => Body
}

const DEG = 180 / Math.PI

/** 质点默认锁转动（`fixedRotation ?? kind==='particle'`），所以角速度对它们没意义 */
export function rotationLocked(b: Body): boolean {
  return b.fixedRotation ?? b.kind === 'particle'
}

export const BODY_FIELDS: BodyField[] = [
  {
    key: 'angle',
    label: '角度',
    unit: '°',
    min: -180,
    max: 180,
    step: 0.5,
    decimals: 1,
    need: 'optional',
    setter: 'angle',
    read: (b) => b.transform.angle * DEG,
    write: (b, v) => ({ ...b, transform: { ...b.transform, angle: v / DEG } }),
  },
  {
    key: 'mass',
    label: '质量 m',
    unit: 'kg',
    min: 0.1,
    max: 5,
    step: 0.1,
    decimals: 2,
    need: 'required',
    dynamicOnly: true,
    setter: 'mass',
    read: (b) => b.mass ?? 0.5,
    write: (b, v) => ({ ...b, mass: v }),
  },
  {
    key: 'friction',
    label: '摩擦 μ',
    min: 0,
    max: 1,
    step: 0.05,
    decimals: 2,
    need: 'optional',
    setter: 'friction',
    read: (b, scene) => b.friction ?? findMaterial(scene, b.material)?.mu ?? 0.3,
    write: (b, v) => ({ ...b, friction: v }),
  },
  {
    key: 'charge',
    label: '电荷 q',
    min: -5,
    max: 5,
    step: 0.1,
    decimals: 1,
    need: 'optional',
    when: (scene) => !!scene.world.interactions?.coulomb,
    setter: 'charge',
    read: (b) => b.charge ?? 0,
    write: (b, v) => ({ ...b, charge: v }),
  },
  {
    key: 'linearDamping',
    label: '线性阻尼',
    min: 0,
    max: 3,
    step: 0.1,
    decimals: 1,
    need: 'optional',
    dynamicOnly: true,
    hint: '气缸活塞这类「缓慢过程」用',
    read: (b) => b.linearDamping ?? 0,
    write: (b, v) => ({ ...b, linearDamping: v }),
  },
  {
    key: 'omega',
    label: '角速度 ω',
    unit: 'rad/s',
    min: -10,
    max: 10,
    step: 0.5,
    decimals: 1,
    need: 'optional',
    dynamicOnly: true,
    // 质点默认锁转动，给它角速度滑杆是骗人
    when: () => true,
    read: (b) => b.omega ?? 0,
    write: (b, v) => ({ ...b, omega: v }),
  },
]

/** 这个物体现在该显示哪些旋钮（顺序 = 表里的顺序） */
export function bodyFieldRows(scene: Scene, body: Body): BodyField[] {
  const dynamic = body.kind !== 'static' && body.kind !== 'kinematic'
  return BODY_FIELDS.filter((f) => {
    if (f.dynamicOnly && !dynamic) return false
    if (f.key === 'omega' && rotationLocked(body)) return false
    if (f.when && !f.when(scene)) return false
    return true
  })
}

/** 按 key 找字段（泛型 setter 用） */
export function bodyFieldByKey(key: string): BodyField | undefined {
  return BODY_FIELDS.find((f) => f.key === key)
}

/**
 * 这个属性的「必需性」在当前物体上是什么。
 * 用途：给 agent 回读用——哪些是题干必须给的，哪些可以不给。
 */
export function fieldNeed(scene: Scene, body: Body, key: string): FieldNeed | null {
  const f = bodyFieldByKey(key)
  if (!f) return null
  if (f.dynamicOnly && body.kind === 'static') return 'implied' // 固定体没有质量旋钮
  if (f.key === 'omega' && rotationLocked(body)) return 'implied' // 质点没有角速度
  if (f.when && !f.when(scene)) return 'implied'
  return f.need
}
