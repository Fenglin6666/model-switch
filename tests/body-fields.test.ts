/**
 * 属性表：面板显示什么、范围多少、什么条件下显示。
 *
 * 这张表的意义是把「加一个属性要改三处」变成「加一行」：
 * 面板按它渲染、面板高度按行数算、写值走同一个泛型 setter。
 * 所以测试盯三件事：显示条件对不对、读写能往返、范围和字段类型一致。
 */
import { describe, expect, it } from 'vitest'
import { emptyScene, type Body, type Scene } from '../packages/core/src/scene'
import { BODY_FIELDS, bodyFieldByKey, bodyFieldRows, fieldNeed, rotationLocked } from '../packages/core/src/body-fields'

const body = (over: Partial<Body> = {}): Body => ({
  id: 'b',
  kind: 'particle',
  shape: { type: 'circle', r: 0.3 },
  transform: { x: 0, y: 0, angle: 0 },
  material: 'metal',
  appearance: { color: '#fff', depth: 0.1 },
  ...over,
})

const scene = (over: Partial<Scene> = {}): Scene => Object.assign(emptyScene(), over)

describe('显示条件', () => {
  it('质点：有角度/质量/摩擦/阻尼，没有角速度（质点默认锁转动）', () => {
    const keys = bodyFieldRows(scene(), body()).map((f) => f.key)
    expect(keys).toEqual(['angle', 'mass', 'friction', 'linearDamping'])
    expect(keys).not.toContain('omega')
  })

  it('刚体：角速度出现', () => {
    const keys = bodyFieldRows(scene(), body({ kind: 'rigid' })).map((f) => f.key)
    expect(keys).toContain('omega')
  })

  it('静态地形：没有质量和阻尼（固定体不需要）', () => {
    const keys = bodyFieldRows(scene(), body({ kind: 'static' })).map((f) => f.key)
    expect(keys).toEqual(['angle', 'friction'])
  })

  it('电荷只在开了库仑力时才显示', () => {
    expect(bodyFieldRows(scene(), body()).map((f) => f.key)).not.toContain('charge')
    const withCoulomb = scene({ world: { ...emptyScene().world, interactions: { coulomb: { k: 1 } } } })
    expect(bodyFieldRows(withCoulomb, body()).map((f) => f.key)).toContain('charge')
  })

  it('rotationLocked：显式 true 或质点是锁的', () => {
    expect(rotationLocked(body())).toBe(true)
    expect(rotationLocked(body({ kind: 'rigid' }))).toBe(false)
    expect(rotationLocked(body({ kind: 'rigid', fixedRotation: true }))).toBe(true)
    expect(rotationLocked(body({ kind: 'particle', fixedRotation: false }))).toBe(false)
  })
})

describe('读写往返', () => {
  it('每个字段写进去能读回来（含缺省值）', () => {
    for (const f of BODY_FIELDS) {
      const b = body({ kind: 'rigid' })
      const v = (f.min + f.max) / 2
      const after = f.write(b, v)
      expect(f.read(after, scene())).toBeCloseTo(v, 5)
    }
  })

  it('缺省值落在范围内（滑杆不会一打开就跑到边界外）', () => {
    for (const f of BODY_FIELDS) {
      const v = f.read(body({ kind: 'rigid' }), scene())
      expect(v).toBeGreaterThanOrEqual(f.min)
      expect(v).toBeLessThanOrEqual(f.max)
    }
  })

  it('摩擦没设过时读材质值，不是 0', () => {
    const f = bodyFieldByKey('friction')!
    expect(f.read(body({ material: 'metal' }), scene())).toBeGreaterThan(0)
  })

  it('角度用度、内部存弧度', () => {
    const f = bodyFieldByKey('angle')!
    const after = f.write(body(), 90)
    expect(after.transform.angle).toBeCloseTo(Math.PI / 2, 5)
    expect(f.read(after, scene())).toBeCloseTo(90, 5)
  })
})

describe('必需性：agent 回读用', () => {
  it('质量对动态体是必需，对固定体是由类型决定（implied）', () => {
    expect(fieldNeed(scene(), body(), 'mass')).toBe('required')
    expect(fieldNeed(scene(), body({ kind: 'static' }), 'mass')).toBe('implied')
  })

  it('角速度对质点是 implied（不给旋钮也不用给值）', () => {
    expect(fieldNeed(scene(), body(), 'omega')).toBe('implied')
    expect(fieldNeed(scene(), body({ kind: 'rigid' }), 'omega')).toBe('optional')
  })

  it('不认识的 key 返回 null', () => {
    expect(fieldNeed(scene(), body(), 'nope')).toBeNull()
    expect(bodyFieldByKey('nope')).toBeUndefined()
  })
})
