/**
 * 题目 → 场景：题目生成链路的 v0，一个可解释、离线的规则解析器。
 *
 * 这是产品的主入口：题目（现在粘贴文字；后续图片识别 / 拍照）→ 一张可运行、可手改的模型。
 * 当前不调用大模型，只做「把题干里的关键词和数字映射到已有组件」：
 *   - 识别 archetype（斜面 / 斜面+圆弧 / 平抛 / 单摆 / 弹簧 / 圆轨道）
 *   - 抽 θ、μ、v₀、R、m、k、L、h 这些参数（支持 cm/g/km·h⁻¹ 换算）
 *   - 用预置场景的 layout 生成可运行、可手改的 Scene
 *
 * AI / 多模态后续接同一条契约：成功给 Scene + 假设，失败给 unsupported/hints；
 * 绝不悄悄套一个错模型。手动编辑永远是兜底。
 */
import type { Scene } from './scene'
import { presetById } from './presets'

export type ParseOk = {
  ok: true
  scene: Scene
  archetype: string
  used: Record<string, number | string>
  warnings: string[]
  /** 从题干里读出的建模假设（滑块/小球、滚动、光滑/粗糙、固定/可移动、空气阻力） */
  assumptions: string[]
}
export type ParseErr = { ok: false; error: string; hints: string[]; unsupported?: string[] }
export type ParseResult = ParseOk | ParseErr

const ARCHETYPE_LABEL: Record<string, string> = {
  rampArc: '斜面 + 圆弧',
  incline: '斜面滑块',
  projectile: '平抛',
  pendulum: '单摆',
  spring: '弹簧振子',
  loop: '竖直圆轨道',
  trough: '半圆槽',
  boardBlock: '板块 + 平抛',
}

function unitScale(u: string | undefined): number {
  if (!u) return 1
  const s = u.toLowerCase()
  if (s === 'cm' || s === '厘米') return 0.01
  if (s === 'mm' || s === '毫米') return 0.001
  if (s === 'g' || s === '克') return 0.001
  if (s === 'km/h' || s === '千米/时' || s === 'km·h⁻¹') return 1 / 3.6
  return 1
}

function grab(text: string, re: RegExp, scale = 1): number | undefined {
  const m = text.match(re)
  if (!m) return undefined
  const v = parseFloat(m[1])
  if (!Number.isFinite(v)) return undefined
  return v * (m[2] ? unitScale(m[2]) : scale)
}

function unsupportedProblem(features: string[]): ParseErr {
  const list = [...new Set(features)]
  return {
    ok: false,
    error: `这道题需要「${list.join('、')}」的建模，当前自动建模还没有覆盖。`,
    hints: [
      '当前自动支持：斜面滑块、斜面+圆弧、半圆槽、平抛、单摆、弹簧振子、竖直圆轨道、板块+平抛。',
      '多过程、多体、场、热学、光学的题先不自动生成；题目会先记在题库「我的题目」里，等支持了再建。',
    ],
    unsupported: list,
  }
}

export function parseProblem(raw: string): ParseResult {
  const text = raw
    .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[．。]/g, '.')
    .replace(/[，、]/g, ',')
    .replace(/\s+/g, ' ')
    .trim()
  if (text.length < 6) {
    return { ok: false, error: '题干太短，至少给一句完整描述。', hints: ['例如：倾角 30° 的斜面，底端接半径 0.5m 的光滑圆弧…'] }
  }

  const hasSlope = /斜面|斜坡|倾角/.test(text)
  const hasArc = /圆弧|半圆|圆形轨道|圆轨道/.test(text)
  const hasPendulum = /单摆|摆球|摆长|细线|细绳|悬挂/.test(text)
  const hasSpring = /弹簧|劲度系数/.test(text)
  const hasProjectile = /平抛|水平抛出|斜抛|抛体|抛出点|水平飞出/.test(text)
  const hasLoop = /竖直圆轨道|圆周运动|最高点|过山车/.test(text)
  const hasTrough = /半圆槽|凹槽/.test(text)
  const hasLoopReal = /竖直圆轨道|过山车|圆轨道[^。；]{0,16}最高点|完整(?:的)?圆周/.test(text)
  const hasBoard = /薄板|木板|长木板|滑板/.test(text)
  const hasBoardBlock = hasBoard && /物块|滑块|小物块/.test(text)
  const hasProjectileMove = hasProjectile || /飞出后|离开.{0,6}平台/.test(text)
  const horizontalBetween = /(?:斜面|斜坡)[^。；]{0,100}(?:水平面|水平段)[^。；]{0,100}(?:圆弧|圆轨道)/.test(text)
  const hasCollision = /碰撞|弹性碰撞|非弹性碰撞/.test(text)
  const hasEM = /电场|磁场|电荷|点电荷|库仑|洛伦兹|电容|感应|变压器|导轨|带电粒子/.test(text)
  const hasThermo = /气体|汽缸|活塞|水银|温度|理想气体|热学/.test(text)
  const hasOptics = /折射|全反射|棱镜|透镜|光线|光路|光的/.test(text)
  const hasWave = /波长|频率|波源|机械波|简谐波|波的传播/.test(text)
  const hasBelt = /传送带|皮带/.test(text)
  const hasRope = /滑轮|悬挂|重物|绳子|细绳/.test(text) && !hasPendulum
  const hasKinematics = /追及|鸣笛|声速|救护车/.test(text)

  const unsupported: string[] = []
  const flag = (cond: boolean, label: string) => {
    if (cond && !unsupported.includes(label)) unsupported.push(label)
  }
  flag(hasEM, '静电场/磁场')
  flag(hasThermo, '热学')
  flag(hasOptics, '光学')
  flag(hasWave, '振动与波')
  flag(hasCollision, '碰撞/多体')
  flag(hasBelt, '传送带')
  flag(hasRope, '连接体/绳子')
  flag(hasKinematics, '运动学/追及')
  if (hasLoopReal && hasSlope) flag(true, '多过程：斜面 + 竖直圆轨道')
  if (hasLoopReal && hasTrough) flag(true, '多过程：半圆槽 + 竖直圆轨道')
  if (hasSlope && hasTrough) flag(true, '多过程：斜面 + 半圆槽')
  if (hasLoopReal && hasSpring) flag(true, '多过程：弹簧 + 竖直圆轨道')
  if (hasTrough && hasSpring) flag(true, '多过程：弹簧 + 半圆槽')
  if (unsupported.length) return unsupportedProblem(unsupported)

  let archetype: string | null = null
  if (hasBoardBlock) archetype = 'boardBlock'
  else if (hasSlope && hasArc) archetype = 'rampArc'
  else if (hasTrough) archetype = 'trough'
  else if (hasSlope) archetype = 'incline'
  else if (hasPendulum) archetype = 'pendulum'
  else if (hasSpring) archetype = 'spring'
  else if (hasProjectile) archetype = 'projectile'
  else if (hasLoop) archetype = 'loop'

  const multiStage: string[] = []
  if (archetype === 'rampArc' && (hasProjectileMove || horizontalBetween || hasSpring || hasLoopReal || hasBoard)) multiStage.push('多过程：斜面 → 水平/平抛 → 圆弧')
  if (archetype === 'incline' && (hasProjectileMove || hasSpring || hasLoopReal || hasTrough || hasBoard)) multiStage.push('多过程：斜面 + 其他阶段')
  if (archetype === 'trough' && (hasSlope || hasSpring || hasProjectileMove || hasLoopReal || hasBoard)) multiStage.push('多过程：半圆槽 + 其他阶段')
  if (archetype === 'projectile' && (hasSlope || hasArc || hasLoopReal || hasTrough || hasSpring || hasBoard)) multiStage.push('多过程：平抛 + 其他模型')
  if (archetype === 'loop' && (hasSlope || hasSpring || hasTrough || hasProjectileMove || hasBoard)) multiStage.push('多过程：竖直圆轨道 + 其他阶段')
  if (archetype === 'spring' && (hasSlope || hasArc || hasLoopReal || hasTrough || hasProjectileMove || hasBoard)) multiStage.push('多过程：弹簧 + 其他模型')
  if (archetype === 'pendulum' && (hasSlope || hasArc || hasSpring || hasLoopReal || hasTrough || hasProjectileMove || hasBoard)) multiStage.push('多过程：单摆 + 其他模型')
  if (archetype === 'boardBlock' && (hasSlope || hasArc || hasLoopReal || hasTrough || hasSpring || hasPendulum)) multiStage.push('多过程：板块 + 其他模型')
  if (multiStage.length) return unsupportedProblem(multiStage)

  if (!archetype) {
    return {
      ok: false,
      error: '没有识别出物理模型。',
      hints: [
        '目前支持：斜面、斜面+圆弧、半圆槽、平抛、单摆、弹簧、竖直圆轨道、板块+平抛。',
        '题干里请保留「斜面 / 圆弧 / 半圆槽 / 平抛 / 单摆 / 弹簧 / 圆轨道 / 薄板」这类关键词。',
        '题目会先记在题库「我的题目」里，改好题干可以直接再生成。',
      ],
    }
  }

  const theta =
    grab(text, /(?:倾角|与水平(?:面|方向)?成|与竖直方向成|θ)\s*(?:为|=|是|约)?\s*(\d+(?:\.\d+)?)\s*(?:°|度)/) ??
    grab(text, /(\d+(?:\.\d+)?)\s*(?:°|度)\s*(?:的)?\s*(?:斜面|倾角)/)
  const muAll = [...text.matchAll(/(?:动摩擦因数|摩擦因数|摩擦系数|μ)\s*(?:为|=|是|约)?\s*(0?\.\d+|\d+(?:\.\d+)?)/g)]
    .map((m) => parseFloat(m[1]))
    .filter((v) => Number.isFinite(v))
  const mu = muAll[0]
  const v0 =
    grab(text, /(?:v0|v₀)\s*(?:为|=|是|约)?\s*(\d+(?:\.\d+)?)\s*(m\/s|米\/秒|km\/h)/) ??
    grab(text, /(?:初速度|以)\s*(?:为|=|是|约)?\s*(\d+(?:\.\d+)?)\s*(m\/s|米\/秒|km\/h)/) ??
    grab(text, /(\d+(?:\.\d+)?)\s*(m\/s|米\/秒|km\/h)\s*的?\s*初速度/)
  const R = grab(text, /(?:半径|R)\s*(?:为|=|是|约)?\s*(\d+(?:\.\d+)?)\s*(m|米|cm|厘米|mm|毫米)/)
  const mass = grab(text, /(?:质量|m)\s*(?:为|=|是|约)?\s*(\d+(?:\.\d+)?)\s*(kg|千克|g|克)/)
  const k = grab(text, /(?:劲度系数|k)\s*(?:为|=|是|约)?\s*(\d+(?:\.\d+)?)\s*(N\/m|牛\/米)?/)
  const L = grab(text, /(?:摆长|长度|长|L)\s*(?:为|=|是|约)?\s*(\d+(?:\.\d+)?)\s*(m|米|cm|厘米)/)
  const h = grab(text, /(?:高度|高|h)\s*(?:为|=|是|约)?\s*(\d+(?:\.\d+)?)\s*(m|米|cm|厘米)/)

  const smoothArc = /光滑[^。；,]{0,6}圆弧|圆弧[^。；,]{0,6}光滑/.test(text)
  const roughArc = /粗糙[^。；,]{0,6}圆弧|圆弧[^。；,]{0,6}粗糙/.test(text)
  const muArc = smoothArc ? 0 : roughArc ? (muAll[1] ?? mu ?? 0.4) : (muAll[1] ?? undefined)

  // ---- 题目假设：这些词决定模型，而不是让用户去 A/B ----
  const hasBlockWord = /滑块|物块|木块|小车/.test(text)
  const hasBallWord = /小球|球/.test(text)
  const isBall = hasBallWord && !hasBlockWord
  const isRolling = /(?:纯滚动|无滑动|滚动|滚下|滚上|滚过)/.test(text)
  const isSmooth = /光滑/.test(text)
  const isRough = /粗糙/.test(text)
  const noAir = /(?:不计|忽略|无|没有)[^。；,]{0,4}(?:空气阻力|阻力)/.test(text)
  const withAir = /(?:有|受|考虑)[^。；,]{0,4}(?:空气阻力|阻力)|空气阻力[^。；,]{0,4}(?:不可忽略|不能忽略)/.test(text)
  const fixedTrough = /(?:半圆槽|凹槽|槽)[^。；,]{0,8}固定|固定[^。；,]{0,6}(?:半圆槽|凹槽|槽)/.test(text)
  const slopeSmooth = /斜面[^。；,]{0,6}光滑|光滑[^。；,]{0,6}斜面/.test(text)

  const preset = presetById(archetype)
  if (!preset) return { ok: false, error: `没有预置模型 ${archetype}。`, hints: [] }
  const scene = preset.build()
  const warnings: string[] = []
  const assumptions: string[] = []
  const used: Record<string, number | string> = {}

  const set = (key: string, value: number | undefined, label: string, fallback: number, min: number, max: number) => {
    if (value === undefined) {
      const current = scene.params[key] ?? fallback
      warnings.push(`没找到${label}，用默认 ${current}`)
      if (scene.params[key] === undefined) scene.params[key] = current
      used[key] = current
      return
    }
    const v = Math.min(max, Math.max(min, value))
    scene.params[key] = v
    used[key] = v
  }

  if (archetype === 'incline') {
    set('theta', theta, '倾角 θ', 30, 10, 55)
    set('mu', isSmooth ? 0 : (mu ?? (isRough ? 0.3 : 0.25)), '动摩擦因数 μ', 0.25, 0, 0.9)
    set('v0', v0, '初速度 v₀', 0, 0, 12)
    set('mass', mass, '质量 m', 0.5, 0.05, 5)
    // 滑块 → 矩形、质点；小球 → 圆；滚 → 刚体（实心球）
    scene.params.ball = isBall ? 1 : 0
    scene.params.model = isBall && isRolling ? 1 : 0
    assumptions.push(isBall ? (isRolling ? '小球，纯滚动' : '小球，平动') : '滑块，平动')
    assumptions.push(isSmooth ? '斜面光滑' : isRough ? '斜面粗糙' : '斜面摩擦按 μ')
  } else if (archetype === 'boardBlock') {
    const boardL = grab(text, /(?:长度|l)\s*(?:l|L)?\s*(?:为|=|是|约)?\s*(\d+(?:\.\d+)?)\s*(m|米|cm|厘米)/i) ?? L
    set('l', boardL, '薄板长度 l', 1.0, 0.4, 2)
    set('mu', mu, '板块动摩擦因数 μ', 0.3, 0, 0.8)
    set('v0', v0, '物块初速度 v0', 4, 0.5, 10)
    set('m', mass, '物块/薄板质量 m', 0.5, 0.1, 5)
    set('h', h, '平台高度 h', 0.8, 0.2, 3)
    assumptions.push('光滑平台', '薄板不翻转', '板块间滑动摩擦', '平抛不计空气阻力')
  } else if (archetype === 'rampArc') {
    set('theta', theta, '倾角 θ', 35, 10, 70)
    set('R', R, '圆弧半径 R', 0.9, 0.3, 2)
    set('mu', slopeSmooth ? 0 : (mu ?? 0.25), '斜面动摩擦因数 μ', 0.25, 0, 0.9)
    set('muArc', muArc ?? (roughArc ? 0.5 : 0), '圆弧摩擦因数', 0, 0, 0.9)
    set('v0', v0, '初速度 v₀', 0, 0, 12)
    set('mass', mass, '质量 m', 0.5, 0.05, 5)
    scene.params.ball = isBall ? 1 : 0
    scene.params.roll = isBall && isRolling ? 1 : 0
    used.arc = smoothArc ? '光滑' : roughArc ? '粗糙' : '未说明'
    assumptions.push(isBall ? (isRolling ? '小球，纯滚动' : '小球，平动') : '滑块，平动')
    assumptions.push(smoothArc ? '圆弧光滑' : roughArc ? '圆弧粗糙' : '圆弧摩擦按 μ')
  } else if (archetype === 'trough') {
    // 槽固定 / 可移动由题目假设决定
    scene.params.fixed = fixedTrough ? 1 : 0
    scene.params.roll = isBall && isRolling ? 1 : 0
    used.fixed = fixedTrough ? '固定' : '可移动'
    assumptions.push(isBall ? (isRolling ? '小球，纯滚动' : '小球，平动') : '滑块，平动')
    assumptions.push(fixedTrough ? '槽固定' : '槽可移动（光滑水平面）')
  } else if (archetype === 'pendulum') {
    set('L', L, '摆长 L', 1.5, 0.2, 4)
    set('theta', theta, '释放角 θ', 40, 5, 80)
    assumptions.push('小球，质点', '轻绳，不可伸长')
  } else if (archetype === 'spring') {
    set('k', k, '劲度系数 k', 40, 5, 200)
    set('m', mass, '质量 m', 0.5, 0.05, 5)
    assumptions.push('物块，质点', '轻弹簧，无阻尼')
  } else if (archetype === 'projectile') {
    set('v0', v0, '初速度 v₀', 5, 0.5, 40)
    set('h', h, '抛出高度 h', 1.2, 0.2, 50)
    scene.params.drag = withAir && !noAir ? 1 : 0
    assumptions.push(withAir && !noAir ? '考虑空气阻力' : '不计空气阻力')
  } else if (archetype === 'loop') {
    set('v0', v0, '初速度 v₀', 5.5, 1, 20)
    set('R', R, '圆轨道半径 R', 0.6, 0.3, 0.7)
    scene.params.roll = isBall && isRolling ? 1 : 0
    assumptions.push(isBall ? (isRolling ? '小球，纯滚动' : '小球，质点') : '滑块，质点')
  }

  preset.layout?.(scene)
  scene.meta.preset = archetype
  scene.meta.assumptions = assumptions
  scene.meta.title = `${preset.title} · 题目`
  scene.meta.note = `从题目解析生成（${ARCHETYPE_LABEL[archetype] ?? archetype}）。假设：${assumptions.join('、')}。参数可继续手动改。`
  if (warnings.length) scene.meta.note += ` 注意：${warnings.join('；')}。`

  return {
    ok: true,
    scene,
    archetype,
    used: { ...used, ...(theta !== undefined ? { theta } : {}) },
    warnings,
    assumptions,
  }
}
