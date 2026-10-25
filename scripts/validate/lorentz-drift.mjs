// 验证 3：洛伦兹力的积分方式与圆周半径漂移。
//
// 结论（见 docs/PHYSICS.md §3.3）：
//   朴素 applyForceToCenter(qv×B) 会让半径单调增长（1/240+2substeps，10 圈 12.5%）。
//   原因是显式/半隐式欧拉对速度相关力持续注入能量。
//   Boris 式「速度旋转」= 精确旋转，速度模长严格不变，半径漂移降到 ~1e-4 量级。
//
// 量级说明：真实比荷下回旋周期 ~1e-7 s，1/240 步长采样不到，必须用教学比荷
// （q/m ≈ 1 C/kg），让半径落在 0.1~10 m、周期在秒级。
import { World, Vec2, Circle } from 'planck'

const Q_OVER_M = 1.0 // C/kg，教学比荷
const Bz = 2.0 // T，垂直纸面向外
const v0 = 2.0 // m/s
const omega = Q_OVER_M * Bz // rad/s
const period = (2 * Math.PI) / omega
const Rtheory = v0 / omega
console.log(`ω = ${omega} rad/s，T = ${period.toFixed(4)} s，R = ${Rtheory.toFixed(4)} m`)

function run({ dt, substeps, loops = 10, method, label }) {
  const world = new World({ gravity: new Vec2(0, 0), allowSleep: false })
  const body = world.createBody({
    type: 'dynamic',
    position: new Vec2(0, 0),
    linearVelocity: new Vec2(v0, 0),
    allowSleep: false,
  })
  body.createFixture({ shape: new Circle(0.02), density: 1 })
  body.setMassData({ mass: 1, center: new Vec2(0, 0), I: 1e-6 })

  const stepsPerPeriod = Math.round(period / dt)
  const substepDt = dt / substeps
  const radii = []
  let samples = []

  for (let loop = 0; loop < loops; loop++) {
    for (let i = 0; i < stepsPerPeriod; i++) {
      for (let s = 0; s < substeps; s++) {
        const v = body.getLinearVelocity()
        if (method === 'force') {
          body.applyForceToCenter(new Vec2(Q_OVER_M * v.y * Bz, -Q_OVER_M * v.x * Bz), true)
        } else {
          // Boris 的纯磁场形式：速度精确旋转 θ = −ω·dt
          const theta = -omega * substepDt
          const c = Math.cos(theta)
          const sn = Math.sin(theta)
          body.setLinearVelocity(new Vec2(v.x * c - v.y * sn, v.x * sn + v.y * c))
        }
        world.step(substepDt, 8, 3)
      }
      const p = body.getPosition()
      samples.push([p.x, p.y])
    }
    let cx = 0, cy = 0
    for (const [x, y] of samples) { cx += x; cy += y }
    cx /= samples.length; cy /= samples.length
    let r = 0
    for (const [x, y] of samples) r += Math.hypot(x - cx, y - cy)
    r /= samples.length
    radii.push(r)
    samples = []
  }

  const drift = ((radii[radii.length - 1] - radii[0]) / radii[0]) * 100
  const speed = body.getLinearVelocity().length()
  return {
    label,
    dt: +dt.toFixed(5),
    substeps,
    R_loop1: +radii[0].toFixed(5),
    R_loop10: +radii[radii.length - 1].toFixed(5),
    radiusErr: +(((radii[0] - Rtheory) / Rtheory) * 100).toFixed(3),
    drift: +drift.toFixed(4),
    speedErr: +(((speed - v0) / v0) * 100).toFixed(4),
  }
}

const configs = [
  { dt: 1 / 240, substeps: 2, method: 'force', label: '力法 · 1/240·2' },
  { dt: 1 / 240, substeps: 2, method: 'rotate', label: '旋转法 · 1/240·2' },
  { dt: 1 / 240, substeps: 1, method: 'rotate', label: '旋转法 · 1/240·1' },
  { dt: 1 / 60, substeps: 1, method: 'rotate', label: '旋转法 · 1/60·1（对照）' },
]
const results = configs.map(run)
console.table(results)

const chosen = results[1]
const ok = Math.abs(chosen.drift) < 1 && Math.abs(chosen.speedErr) < 0.01
console.log(ok
  ? `PASS: 旋转法 1/240·2，10 圈半径漂移 ${chosen.drift}%，速度误差 ${chosen.speedErr}%`
  : `FAIL: ${chosen.drift}%`)
process.exit(ok ? 0 : 1)
