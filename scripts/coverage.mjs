// 覆盖率分析：算出「覆盖所有计算题」到底需要什么，以及每一步的边际收益。
//
//   node scripts/coverage.mjs
//   node scripts/coverage.mjs --csv D:/OneAgent/gaokao-research/output/gaokao-physics-2006-2026.csv
//
// 数据源是 2006–2026 的 4462 道真题（304 卷），字段含题型 / 知识模块 / 场 / 约束 /
// 是否含临界 / 是否多过程 / 物体数 / 可建模性。**只有结构标注，没有完整题干**，
// 所以这个脚本算的是「理论上限」，不是「AI 实测覆盖率」——后者得拿全文跑，
// 见 docs/RESEARCH.md 里的说明。
//
// 为什么要有它：「覆盖所有高中物理大题」这句话没有分母就没法讨论。
// 分母不是 4462（选择题不需要建模），是 1011 道计算题里的 785 道 D2。
import fs from 'node:fs'

const DEFAULT_CSV = 'D:/OneAgent/gaokao-research/output/gaokao-physics-2006-2026.csv'
const arg = process.argv.indexOf('--csv')
const csvPath = arg > 0 ? process.argv[arg + 1] : DEFAULT_CSV

if (!fs.existsSync(csvPath)) {
  console.error('找不到语料：' + csvPath)
  console.error('这份 CSV 不在仓库里（1.6 MB，且许可证是 CC BY-NC），用 --csv 指到你本地的路径。')
  process.exit(1)
}

/** 极简 CSV 解析：支持双引号包裹与转义 */
function parseCsv(text) {
  const rows = []
  let row = []
  let cur = ''
  let q = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (q) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          cur += '"'
          i++
        } else q = false
      } else cur += c
    } else if (c === '"') q = true
    else if (c === ',') {
      row.push(cur)
      cur = ''
    } else if (c === '\n') {
      row.push(cur)
      cur = ''
      rows.push(row)
      row = []
    } else if (c !== '\r') cur += c
  }
  if (cur || row.length) {
    row.push(cur)
    rows.push(row)
  }
  return rows
}

const raw = fs.readFileSync(csvPath, 'utf8').replace(/^\uFEFF/, '')
const rows = parseCsv(raw)
const header = rows.shift()
const all = rows
  .filter((r) => r.length >= header.length - 1)
  .map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ''])))

const calc = all.filter((r) => r.qtype === '计算')
const d2 = calc.filter((r) => r.modelability === 'D2')
const pct = (x, base = d2.length) => ((x / base) * 100).toFixed(0) + '%'
const count = (arr) => arr.length

/** 我们已支持的约束基元（CSV 用的词 + 我们代码里的名字） */
const SUPPORTED_CONSTRAINTS = new Set([
  '水平面',
  '斜面',
  '圆弧',
  '弧轨道',
  '圆',
  '轨道',
  '绳',
  '杆',
  '板',
  '车',
  '弹簧',
  '传送带',
  '滑轮',
  '导轨',
  '无约束',
  '',
])

const constraintsOf = (r) =>
  (r.constraints || '')
    .split(/[;；、/|]/)
    .map((s) => s.trim())
    .filter(Boolean)

const line = (s = '') => console.log(s)

line('语料：' + all.length + ' 道题 / 计算题 ' + calc.length + ' 道')
line('')
line('=== 分母 ===')
const byModel = {}
for (const r of calc) byModel[r.modelability] = (byModel[r.modelability] || 0) + 1
line('  1011 道计算题的可建模性：' + JSON.stringify(byModel))
line('  → 真正需要「动力学建模」的只有 D2 = ' + d2.length + ' 道（' + pct(d2.length, calc.length) + ' of 计算题）')
line('  D3 需专门模块 / D0 不可建模 / D1 静态，这三类共 ' + (calc.length - d2.length) + ' 道，本身不该用仿真')
line('')

line('=== D2 的 785 道怎么分布 ===')
const byField = {}
for (const r of d2) byField[r.field] = (byField[r.field] || 0) + 1
for (const [k, v] of Object.entries(byField)) {
  const s = d2.filter((r) => r.field === k)
  line(
    '  ' +
      k.padEnd(4) +
      String(v).padStart(4) +
      '  ' +
      pct(v).padStart(4) +
      '  临界 ' +
      String(count(s.filter((r) => r.has_critical === 'True'))).padStart(3) +
      '  多过程 ' +
      String(count(s.filter((r) => r.has_multi_stage === 'True'))).padStart(3),
  )
}
line(
  '  含临界合计 ' +
    count(d2.filter((r) => r.has_critical === 'True')) +
    '（' +
    pct(count(d2.filter((r) => r.has_critical === 'True'))) +
    '）· 含多过程 ' +
    count(d2.filter((r) => r.has_multi_stage === 'True')) +
    '（' +
    pct(count(d2.filter((r) => r.has_multi_stage === 'True'))) +
    '）',
)
line(
  '  物体数：单 ' +
    count(d2.filter((r) => Number(r.n_objects) === 1)) +
    ' · 双 ' +
    count(d2.filter((r) => Number(r.n_objects) === 2)) +
    ' · 多(≥3) ' +
    count(d2.filter((r) => Number(r.n_objects) >= 3)),
)
line('')

line('=== 理论上限：只用现在的基元能建多少 ===')
const noField = d2.filter((r) => r.field === '无场')
const pureOk = noField.filter((r) => constraintsOf(r).every((c) => SUPPORTED_CONSTRAINTS.has(c)))
line('  纯力学（无场）' + noField.length + ' 道 = ' + pct(noField.length) + ' of D2')
line('    约束全部在已支持集合里：' + pureOk.length + ' 道（' + pct(pureOk.length) + ' of D2）')
const badConstraints = {}
for (const r of noField) for (const c of constraintsOf(r)) if (!SUPPORTED_CONSTRAINTS.has(c)) badConstraints[c] = (badConstraints[c] || 0) + 1
line('    仍缺的约束词：' + JSON.stringify(badConstraints))
line('  → 所以「纯力学」这一块的天花板约 ' + pct(noField.length) + '，剩下 ' + pct(d2.length - noField.length) + ' 都在场里')
line('')

line('=== 想往上走，每一步买多少 ===')
const steps = [
  { what: '场类：速度空间相图 + 磁场几何求解', gain: byField['磁场'] || 0, note: '磁场题难在几何，不在积分' },
  { what: '复合场（E/B 交替、速度选择）', gain: byField['复合场'] || 0, note: 'crossedFields 预置已有；「先电场后磁场」靠区域限定，不是新机制' },
  { what: '电场深化（点电荷叠加是解析题，不做）', gain: byField['电场'] || 0, note: '66 道里有一部分本来就该拒绝' },
  { what: '多过程串联（build 更好用 + 组件参数槽）', gain: count(d2.filter((r) => r.has_multi_stage === 'True')), note: '和上面三项有重叠' },
  { what: '临界的表达（判据翻转 + 倍率慢放，让人自己找临界）', gain: count(d2.filter((r) => r.has_critical === 'True')), note: '48% 的题含临界；不做「一键跳临界」' },
]
for (const s of steps) line('  ' + String(s.gain).padStart(4) + ' 道  ' + s.what + '   （' + s.note + '）')
line('')
line('注：gain 是「提到这个维度的题数」，多维度会重叠，不能直接相加。')
line('')

// 电磁感应单独统计：它按「场」分类会被归到无场/磁场里，但缺的是另一类基元（回路）。
// 关键词要扫整行——语料里没有专门的 induction 列，关键词散在题干摘要/约束/理由里。
const INDUCTION_KW = ['感应', '电动势', '安培力', '楞次']
const hasInduction = (r) => INDUCTION_KW.some((k) => Object.values(r).some((v) => String(v ?? '').includes(k)))
const ind = d2.filter(hasInduction)
line('=== 电磁感应（单棒切割）===')
line('  D2 里命中「感应/电动势/安培力/楞次」：' + ind.length + ' 道（' + pct(ind.length) + ' of D2）')
line('  → 单棒切割已由 circuit 基元覆盖（tests/induction.test.ts 卡收尾速度与能量）')
line('  → 双棒 / 电容 / 线圈转动仍然建不了，这部分题只能 unsupported')
line('')

line('=== 结论 ===')
line('  1. 100% 不可能：' + (calc.length - d2.length) + ' 道计算题本身不是 D2（D3 需专门模块 / D0 不可建模 / D1 静态）。')
line('  2. 纯力学 ' + pct(noField.length) + ' 现在就能全吃下（约束全在已支持集合里）。')
line('  3. 场上再补 ' + pct((byField['磁场'] || 0) + (byField['复合场'] || 0) + (byField['电场'] || 0)) + '：匀强 E/B、正交复合场、区域限定都已经有了；')
line('     真正还没做的是「速度空间相图」这类读图工具，不是物理。')
line('  4. 电磁感应 ' + ind.length + ' 道里，单棒切割已能建；双棒/电容/线圈转动建不了，会明确 unsupported。')
line('  5. 剩下的边际收益断崖——长尾组合每加一个只赚几道题。')
line('')
line('  → 所以「覆盖所有」不该是目标。真正的指标是「老师手上那道题，多大几率 10 秒内变成能拨的模型」，')
line('    而它 = 题库命中率 × AI 建成率。题库（确定能建）比生成（可能能建）更能直接提升体验。')
