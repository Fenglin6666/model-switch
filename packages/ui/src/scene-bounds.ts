import type { Scene } from '@core/scene'
import { bodyAABB } from '@core/shapes'
import type { Vec2 } from '@core/math'

/** 场景包围点：取景和卡片预览共用（不含地面，地面会把视野拉扁）。 */
export function sceneBoundsPoints(scene: Scene, includeGuides = true): Vec2[] {
  const pts: Vec2[] = []
  for (const b of scene.bodies) {
    if (b.id === 'ground') continue
    const box = bodyAABB(b.shape, b.transform)
    pts.push(box.min, { x: box.max.x, y: box.min.y }, box.max, { x: box.min.x, y: box.max.y })
  }
  for (const r of scene.regions) {
    const box = bodyAABB(r.shape, r.transform)
    pts.push(box.min, { x: box.max.x, y: box.min.y }, box.max, { x: box.min.x, y: box.max.y })
  }
  if (includeGuides) for (const g of scene.guides) {
    if (g.kind === 'hline') {
      pts.push({ x: g.x0 ?? -2, y: g.y }, { x: g.x1 ?? 2, y: g.y })
    } else if (g.kind === 'vline') {
      pts.push({ x: g.x, y: g.y0 ?? 0 }, { x: g.x, y: g.y1 ?? 2 })
    } else {
      pts.push(g.at)
    }
  }
  if (pts.length === 0) {
    // 空白画布：给一块「可画的区域」而不是把地面线放在正中间
    return [
      { x: -2.5, y: 0 },
      { x: 2.5, y: 0 },
      { x: -2.5, y: 2.4 },
      { x: 2.5, y: 2.4 },
    ]
  }
  return pts
}

