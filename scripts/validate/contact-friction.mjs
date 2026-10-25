// 验证 1：Planck 的 contact.setFriction() 在 pre-solve 里能否覆写摩擦
// 结论决定摩擦模型是「接触对」还是退化到「物体级」。
import { World, Vec2, Box } from 'planck'

const DT = 1 / 240
const STEPS = 240 * 3 // 3 s

function run({ groundMu, bodyMu, overrideMu = null, label }) {
  const world = new World({ gravity: new Vec2(0, -9.8) })
  const ground = world.createBody({ type: 'static', position: new Vec2(0, -0.1) })
  ground.createFixture({ shape: new Box(40, 0.1), friction: groundMu })

  const box = world.createBody({
    type: 'dynamic',
    position: new Vec2(0, 0.5),
    linearVelocity: new Vec2(2, 0),
  })
  box.createFixture({ shape: new Box(0.5, 0.5), density: 1, friction: bodyMu })

  let preSolveCalls = 0
  if (overrideMu !== null) {
    world.on('pre-solve', (contact) => {
      preSolveCalls++
      contact.setFriction(overrideMu)
    })
  }

  for (let i = 0; i < STEPS; i++) world.step(DT, 8, 3)
  return {
    label,
    distance: +box.getPosition().x.toFixed(3),
    endSpeed: +box.getLinearVelocity().x.toFixed(3),
    preSolveCalls,
  }
}

const noFriction = run({ groundMu: 0, bodyMu: 0, label: 'μ=0（对照：应当几乎不停）' })
const highFriction = run({ groundMu: 0.9, bodyMu: 0.9, label: 'μ=0.9（对照：应当很快停）' })
const overridden = run({ groundMu: 0.9, bodyMu: 0.9, overrideMu: 0.0, label: 'pre-solve 覆写为 μ=0' })

const rows = [noFriction, highFriction, overridden]
console.table(rows)

const works = Math.abs(overridden.distance - noFriction.distance) < 1e-2 && highFriction.distance < noFriction.distance - 2
console.log(works
  ? 'PASS: pre-solve 里 setFriction 生效，接触对摩擦模型可用'
  : 'FAIL: pre-solve 覆写无效，需退回物体级摩擦')
process.exit(works ? 0 : 1)
