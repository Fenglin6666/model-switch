// 题库 / 题目详情 / 建模库 / 用户页 验收。
// 需要 Web dev server 在 127.0.0.1:5173。
import { chromium } from 'playwright-core'
import fs from 'node:fs'

const out = 'screenshots'
fs.mkdirSync(out, { recursive: true })
const browser = await chromium.launch({ channel: 'chrome', headless: true })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 })
page.on('console', (m) => {
  if (m.type() === 'error' && !m.text().includes('404')) console.log('[console.error]', m.text())
})
page.on('pageerror', (e) => console.log('[pageerror]', e.message))
await page.goto('http://127.0.0.1:5173/')
await page.waitForFunction(() => !!window.app)
await page.waitForTimeout(500)

const results = []
const check = (name, ok, detail) => {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`)
}
const wait = (ms = 260) => page.waitForTimeout(ms)
const shot = async (name) => {
  await wait(320)
  await page.screenshot({ path: `${out}/${name}.png` })
}
/** 按命中区 id 前缀点一下（真实走 pointerDown/Up，不是直接调方法） */
const tap = async (prefix) => {
  const id = await page.evaluate((p) => {
    const a = window.app
    const hit = a.ui.hits.find((h) => h.id && h.id.startsWith(p))
    if (!hit) return null
    const x = hit.rect.x + hit.rect.w / 2
    const y = hit.rect.y + hit.rect.h / 2
    a.pointerDown(x, y)
    a.pointerUp()
    return hit.id
  }, prefix)
  await wait(260)
  return id
}
const state = () =>
  page.evaluate(() => {
    const a = window.app
    return {
      mode: a.mode,
      problemOpen: a.problemOpen,
      models: a.library.models.length,
      folders: a.library.folders.length,
      mine: a.library.problems.length,
    }
  })

// 0. 干净起点
await page.evaluate(() => {
  localStorage.removeItem('slogan.library.v1')
  localStorage.removeItem('model-switch.library.v1')
})
await page.reload()
await page.waitForFunction(() => !!window.app)
await wait(400)

// 1. 首屏：题库 + 底部三栏
const home = await page.evaluate(() => {
  const a = window.app
  return {
    mode: a.mode,
    bank: a.allProblems().length,
    cards: a.ui.hits.filter((h) => h.id && h.id.startsWith('bank:')).length,
  }
})
check('首屏是题库', home.mode === 'bank' && home.bank >= 15 && home.cards >= 4, JSON.stringify(home))
const tabs = await page.evaluate(() => {
  const a = window.app
  const bar = a.tabBarRect()
  return a.ui.hits.filter((h) => h.id && h.id.startsWith('pill') && h.rect.y >= bar.y).length
})
check('底部三栏（用户 / 题库 / 模型）', tabs === 3, `tabs=${tabs}`)
await shot('220-bank')

// 2. 点题先看完整题干，不直接建模
await tap('bank:s-ramp-arc')
const opened = await state()
check('点题先进入题目详情，没有直接生成', opened.problemOpen === 's-ramp-arc' && opened.models === 0, JSON.stringify(opened))
const detail = await page.evaluate(() => {
  const a = window.app
  const ids = a.ui.hits.map((h) => h.id)
  return {
    hasGenerate: ids.includes('problem:generate'),
    title: a.allProblems().find((p) => p.id === a.problemOpen)?.title,
  }
})
check('详情页有「生成建模」按钮', detail.hasGenerate, detail.title ?? '')
await shot('221-problem-detail')

// 3. 详情页点「生成建模」→ 进画布 + 入库
await tap('problem:generate')
const generated = await state()
check('详情页点生成 → 进画布并入库', generated.mode === 'scene' && generated.models === 1, JSON.stringify(generated))
const draft = await page.evaluate(() => ({ fromProblem: window.app.fromProblem === true }))
check('生成的场景带「题目初稿」标记（舞台上标可改）', draft.fromProblem, JSON.stringify(draft))
await shot('222-generated')

// 4. 回题库再点同一道题：详情变成「打开模型」
await page.evaluate(() => window.app.toBank())
await wait(300)
await tap('bank:s-ramp-arc')
const again = await page.evaluate(() => {
  const a = window.app
  return {
    open: a.problemOpen,
    hasOpen: a.ui.hits.some((h) => h.id === 'problem:open'),
    hasGenerate: a.ui.hits.some((h) => h.id === 'problem:generate'),
  }
})
check('建过的题在详情页显示「打开模型」', again.open === 's-ramp-arc' && again.hasOpen && !again.hasGenerate, JSON.stringify(again))
await tap('problem:open')
const reopened = await state()
check('点「打开模型」回到画布，不新增', reopened.mode === 'scene' && reopened.models === 1, JSON.stringify(reopened))

// 5. 暂不支持的题：详情页只说明，没有生成按钮
// 先切到「热学」分类，让这张卡在第一屏（列表可滚动，看不见的卡没有命中区）
await page.evaluate(() => {
  const a = window.app
  a.toBank()
  a.bankCategory = 'thermo'
  a.bankScroll = 0
})
await wait(300)
await tap('bank:g-2024-jj-13')
const blocked = await page.evaluate(() => {
  const a = window.app
  return {
    open: a.problemOpen,
    hasUnsupported: a.ui.hits.some((h) => h.id === 'problem:unsupported'),
    hasGenerate: a.ui.hits.some((h) => h.id === 'problem:generate'),
    models: a.library.models.length,
  }
})
check(
  '暂不支持的题：详情只说不能建，没有生成按钮',
  blocked.open === 'g-2024-jj-13' && blocked.hasUnsupported && !blocked.hasGenerate,
  JSON.stringify(blocked),
)
await shot('223-problem-unsupported')

// 6. 用户页：统计与清空（带确认）
await page.evaluate(() => window.app.toUser())
await wait(300)
const user = await page.evaluate(() => {
  const a = window.app
  return { mode: a.mode, rows: a.ui.hits.filter((h) => h.id && h.id.startsWith('user:')).length }
})
check('用户页有数据管理入口（AI 建模 + 两个清空）', user.mode === 'user' && user.rows === 3, JSON.stringify(user))
await shot('224-user')

await tap('user:清空建模库')
const confirmOpen = await page.evaluate(() => !!window.app.confirm)
check('清空前先要确认（不静默删）', confirmOpen)
await shot('225-user-confirm')

const cleared = await page.evaluate(() => {
  const a = window.app
  if (!a.confirm) return null
  // 确认弹层最后画的两个按钮：最后一个就是「清空」
  const hits = a.ui.hits.filter((h) => h.id && h.id.startsWith('pill'))
  const btn = hits[hits.length - 1]
  a.pointerDown(btn.rect.x + btn.rect.w / 2, btn.rect.y + btn.rect.h / 2)
  a.pointerUp()
  return { models: a.library.models.length, confirm: !!a.confirm }
})
check('确认后清空建模库', cleared && cleared.models === 0 && !cleared.confirm, JSON.stringify(cleared))

// 7. 建模库：新建文件夹 + 移动 + 持久化
await page.evaluate(() => {
  const a = window.app
  a.generateFromText(a.allProblems().find((p) => p.id === 's-incline').text, 's-incline')
  a.toLibrary()
})
await wait(400)
await page.evaluate(() => window.app.newFolder())
await wait(300)
await page.fill('#dlg-input', '力学')
await page.click('#dlg-ok')
await wait(400)
const folder = await page.evaluate(() => {
  const a = window.app
  const m = a.library.models[0]
  a.moveTo(m.id, a.library.folders[0].id)
  return {
    folders: a.library.folders.length,
    inFolder: a.library.models.filter((x) => x.folderId === a.library.folders[0].id).length,
  }
})
check('建模库：新建文件夹并移入', folder.folders === 1 && folder.inFolder === 1, JSON.stringify(folder))
await shot('226-library')

await page.reload()
await page.waitForFunction(() => !!window.app)
await wait(500)
const persisted = await page.evaluate(() => ({
  models: window.app.library.models.length,
  folders: window.app.library.folders.length,
  mode: window.app.mode,
}))
check('刷新后建模库与文件夹还在', persisted.models === 1 && persisted.folders === 1, JSON.stringify(persisted))

// 8. 手机尺寸
await page.setViewportSize({ width: 390, height: 844 })
await wait(400)
const mobile = await page.evaluate(() => {
  const a = window.app
  a.toBank()
  a.frame(0, 0)
  const cards = a.ui.hits.filter((h) => h.id && h.id.startsWith('bank:')).length
  a.openProblemDetail('s-incline')
  a.frame(0, 0)
  const ids = a.ui.hits.map((h) => h.id)
  return {
    cards,
    detail: !!a.problemOpen,
    action: ids.includes('problem:generate') ? 'generate' : ids.includes('problem:open') ? 'open' : 'none',
  }
})
check(
  '手机尺寸：题库卡片与详情页都能用',
  mobile.cards >= 3 && mobile.detail && mobile.action !== 'none',
  JSON.stringify(mobile),
)
await shot('227-bank-mobile')
await shot('228-detail-mobile')

// 9. 改名迁移：旧 key（model-switch.library.v1）里的数据要能读出来，保存后旧 key 清掉。
//    这条锁的是「改产品名不许丢用户数据」——很容易在清理旧代码时被顺手删掉。
await page.setViewportSize({ width: 1280, height: 840 })
await page.evaluate(() => {
  localStorage.removeItem('slogan.library.v1')
  localStorage.setItem(
    'model-switch.library.v1',
    JSON.stringify({
      version: 1,
      folders: [],
      models: [
        {
          id: 'm-legacy',
          title: '旧 key 里的模型',
          folderId: 'unsorted',
          createdAt: 1,
          updatedAt: 1,
          scene: window.app.doc,
        },
      ],
      problems: [],
      components: [],
    }),
  )
})
await page.reload()
await page.waitForFunction(() => !!window.app)
await wait(400)
const migrated = await page.evaluate(() => {
  const got = {
    title: window.app.library.models[0]?.title,
    models: window.app.library.models.length,
  }
  window.app.persist()
  return {
    ...got,
    oldGone: localStorage.getItem('model-switch.library.v1') === null,
    newLen: (localStorage.getItem('slogan.library.v1') || '').length,
  }
})
check(
  '改名迁移：旧 key 的建模库能读出来，保存后旧 key 清掉',
  migrated.models === 1 && migrated.title === '旧 key 里的模型' && migrated.oldGone && migrated.newLen > 100,
  JSON.stringify(migrated),
)

// 10. AI 设置：入口在用户页；key 存本地；坏 key 时必须回退规则解析而不是彻底失败。
//     这里不打真接口（测试不该依赖外部服务和余额），只验「状态机 + 回退」。
await page.evaluate(() => {
  localStorage.removeItem('slogan.ai.v1')
  localStorage.removeItem('slogan.library.v1')
})
await page.reload()
await page.waitForFunction(() => !!window.app)
await wait(400)

const aiEntry = await page.evaluate(() => {
  const a = window.app
  a.toUser()
  a.frame(0, 0)
  const hasRow = a.ui.hits.some((h) => h.id === 'user:AI 建模')
  a.openAiSettings()
  a.frame(0, 0)
  const sheet = a.ui.hits.some((h) => h.id === 'ai:card')
  const hasKey = a.ui.hits.some((h) => h.id === 'ai:API Key')
  a.aiOpen = false
  return { hasRow, sheet, hasKey, label: a.aiLabel(), ready: a.aiReady() }
})
check(
  '用户页有「AI 建模」入口，点开是设置面板（未配置时走规则解析）',
  aiEntry.hasRow && aiEntry.sheet && aiEntry.hasKey && !aiEntry.ready,
  JSON.stringify(aiEntry),
)
await shot('250-user-ai')

// 写入一个**假的** key：验证「配了但接口挂了」时的回退
await page.evaluate(() => {
  localStorage.setItem('slogan.ai.v1', JSON.stringify({ key: 'bad-key.test', model: 'glm-4.6', endpoint: '/llm/chat/completions' }))
})
await page.reload()
await page.waitForFunction(() => !!window.app)
await wait(400)
const configured = await page.evaluate(() => ({ ready: window.app.aiReady(), label: window.app.aiLabel() }))
check('填了 key 之后状态变成已就绪', configured.ready && configured.label.includes('glm-4.6'), JSON.stringify(configured))

const fallback = await page.evaluate(async () => {
  const a = window.app
  const before = a.library.models.length
  const r = await a.generateAsync('倾角 30° 的斜面长 2 m，动摩擦因数 0.25，小滑块从顶端由静止下滑，求到底端的速度。')
  const m = a.library.models[0]
  return {
    ok: r.ok,
    grew: a.library.models.length > before,
    preset: m?.scene?.meta?.preset ?? null,
    message: r.message,
  }
})
check(
  'AI 请求失败 → 回退规则解析，照样建出模型（不比没有 AI 更差）',
  fallback.ok && fallback.grew && fallback.preset === 'incline',
  JSON.stringify(fallback),
)

await page.evaluate(() => localStorage.removeItem('slogan.ai.v1'))

const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} 通过`)
await browser.close()
if (failed.length) process.exit(1)
