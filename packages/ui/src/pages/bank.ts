/** 题库页 + 题目详情页：先看完整题干，再决定建不建模。 */
import { THEME, font, rgba, roundRect } from '@render/theme'
import { BANK_PROBLEMS, bankCategoryName, bankStats, visibleCategories, type BankProblem } from '@core/bank'
import { deleteProblem, type LibraryModel } from '@core/library'
import { clamp } from '@core/math'
import { inRect } from '../widgets'
import type { Rect } from '../widgets'
import type { PagesHost } from './host'
import { renderTabs, wrapLines } from './shared'

export function allProblems(h: PagesHost): BankProblem[] {

  return [...h.library.problems, ...BANK_PROBLEMS]
}

export function problemsIn(h: PagesHost, cat: string): BankProblem[] {

  const all = allProblems(h)
  return cat === 'all' ? all : all.filter((p) => p.category === cat)
}

export function modelForProblem(h: PagesHost, problemId: string): LibraryModel | undefined {

  return h.library.models.find((m) => m.problemId === problemId)
}

export function categoryColor(id: string): string {

  if (id === 'mechanics') return THEME.blue
  if (id === 'em') return THEME.amber
  if (id === 'thermo') return THEME.green
  return THEME.inkSoft
}

export function renderBank(h: PagesHost): void {

  const W = h.width
  const H = h.height
  const ctx = h.ctx
  ctx.save()
  ctx.fillStyle = THEME.paper
  ctx.fillRect(0, 0, W, H)
  ctx.restore()

  const bar = h.pageBarRect()
  const narrow = W < 560
  h.ui.text('SLOGAN · 题库', bar.x, bar.y + 12, {
    size: 8.5,
    weight: 700,
    color: THEME.inkFaint,
    mono: true,
    tracking: 1.3,
  })
  h.ui.text('题库', bar.x, bar.y + 36, { size: narrow ? 22 : 26, weight: 600, serif: true })
  const stats = bankStats(BANK_PROBLEMS)
  if (!narrow) {
    h.ui.text(`内置 ${stats.total} 道 · 都能让 AI 试一次`, bar.x + 62, bar.y + 36, {
      size: 10,
      color: THEME.inkFaint,
    })
  }
  // 唯一的入口：生成建模
  const ctaW = narrow ? 104 : 124
  h.ui.pillButton({ x: bar.x + bar.w - ctaW, y: bar.y + 10, w: ctaW, h: 38 }, '生成建模 →', {
    active: true,
    size: narrow ? 11 : 12,
    weight: 650,
    onClick: () => h.askGenerate(),
  })

  // 分类
  const cats = visibleCategories(h.library.problems.length)
  const chipsY = bar.y + 60
  let cx = bar.x
  const allCount = allProblems(h).length
  const chipList: Array<{ id: string; name: string; count: number }> = [
    { id: 'all', name: '全部', count: allCount },
    ...cats.map((c) => ({ id: c.id, name: c.name, count: problemsIn(h, c.id).length })),
  ]
  let cy = chipsY
  let chipRows = 1
  for (const c of chipList) {
    if (c.count === 0 && c.id !== 'all') continue
    const label = `${c.name} ${c.count}`
    const w = Math.min(110, 26 + label.length * 10)
    // 放不下就换行（手机上 5 个分类一行塞不开）
    if (cx + w > bar.x + bar.w && cx > bar.x) {
      cx = bar.x
      cy += 32
      chipRows++
    }
    h.ui.pillButton({ x: cx, y: cy, w, h: 28 }, label, {
      active: h.bankCategory === c.id,
      size: 10,
      weight: 600,
      onClick: () => {
        h.bankCategory = c.id
        h.bankScroll = 0
      },
    })
    cx += w + 6
  }

  // 列表
  const listTop = chipsY + chipRows * 32 + 6
  const listBottom = h.tabBarRect().y - 8
  const cols = W >= 1000 ? 2 : 1
  const gap = 10
  const cardW = (bar.w - gap * (cols - 1)) / cols
  const cardH = narrow ? 96 : 104
  const list = problemsIn(h, h.bankCategory)
  const rows = Math.ceil(list.length / cols)
  const contentH = rows * (cardH + gap)
  h.bankMaxScroll = Math.max(0, contentH - (listBottom - listTop))
  h.bankScroll = clamp(h.bankScroll, -h.bankMaxScroll, 0)

  ctx.save()
  ctx.beginPath()
  ctx.rect(bar.x - 4, listTop - 4, bar.w + 8, listBottom - listTop + 8)
  ctx.clip()
  list.forEach((p, i) => {
    const col = i % cols
    const row = Math.floor(i / cols)
    const r: Rect = {
      x: bar.x + col * (cardW + gap),
      y: listTop + row * (cardH + gap) + h.bankScroll,
      w: cardW,
      h: cardH,
    }
    if (r.y > listBottom || r.y + r.h < listTop - 8) return
    renderProblemCard(h, r, p)
  })
  ctx.restore()

  if (list.length === 0) {
    h.ui.text('这个分类还没有题', W / 2, listTop + 40, { size: 12, color: THEME.inkFaint, align: 'center' })
    h.ui.text('点右上角「生成建模」贴一道自己的题', W / 2, listTop + 62, {
      size: 10,
      color: THEME.inkFaint,
      align: 'center',
    })
  }

  if (h.problemOpen) renderProblemDetail(h)
  renderTabs(h)
}

export function renderProblemCard(h: PagesHost, r: Rect, p: BankProblem): void {

  const built = modelForProblem(h, p.id)
  const hover = h.width >= 700 && inRect(r, h.ui.pointer.x, h.ui.pointer.y)
  h.ui.card(r, {
    radius: 12,
    stroke: hover ? rgba(THEME.accent, 0.5) : THEME.hairline,
    shadow: hover,
  })
  // 左侧知识模块色条
  const ctx = h.ctx
  ctx.save()
  ctx.fillStyle = rgba(categoryColor(p.category), 0.75)
  roundRect(ctx, r.x, r.y + 12, 3, r.h - 24, 1.5)
  ctx.fill()
  ctx.restore()

  const pad = 14
  const right = r.x + r.w - 12
  // 状态
  // 只有「已建 / 未建」。以前这里写「可建模 / 暂不支持」，但那是规则解析时代的标注，
  // 现在生成由 AI 决定——标注会拦人（用户配了 key 却点不了），而且早就过时了。
  const status = built ? '已建' : '未建'
  const statusColor = built ? THEME.green : THEME.inkFaint
  const sw = h.ui.chip(right - 46, r.y + 20, status, statusColor)
  void sw
  h.ui.text(p.title, r.x + pad, r.y + 22, {
    size: 13,
    weight: 650,
    maxWidth: r.w - pad - 60,
  })
  // 来源 + 标签
  const catName = bankCategoryName(p.category)
  const meta = p.source === catName ? p.source : `${p.source} · ${catName}`
  h.ui.text(meta, r.x + pad, r.y + 42, { size: 9, color: THEME.inkFaint, maxWidth: r.w - pad - 20 })
  // 题干两行（真换行，不是同一句画两遍）
  const lines = wrapLines(h.ctx, p.text.replace(/\s+/g, ' '), r.w - pad - 16, 2, 9.5)
  lines.forEach((line, i) => {
    h.ui.text(line, r.x + pad, r.y + 62 + i * 15, { size: 9.5, color: THEME.inkSoft })
  })
  if (p.tags.length && r.h >= 100) {
    let tx = r.x + pad
    for (const t of p.tags.slice(0, 3)) {
      const w = h.ui.chip(tx, r.y + r.h - 14, t, THEME.inkSoft)
      tx += w + 5
      if (tx > r.x + r.w - 20) break
    }
  }
  h.ui.add({
    id: `bank:${p.id}`,
    rect: r,
    cursor: 'pointer',
    onClick: () => h.openProblemDetail(p.id),
  })
}

export function openProblemDetail(h: PagesHost, id: string): void {

  h.problemOpen = id
  h.problemScroll = 0
}

export function renderProblemDetail(h: PagesHost): void {

  const p = allProblems(h).find((x) => x.id === h.problemOpen)
  if (!p) {
    h.problemOpen = null
    return
  }
  const ctx = h.ctx
  const bar = h.pageBarRect()
  const tab = h.tabBarRect()
  const narrow = h.width < 560
  const pad = 18
  const built = modelForProblem(h, p.id)
  const unsupported = p.expect.kind === 'unsupported'

  // 先算内容多高，卡片贴着内容走（题干短的时候不留一大片空白）
  const bodyW = h.width - 24 - pad * 2
  const titleSize = narrow ? 17 : 19
  const titleLines = wrapLines(h.ctx, p.title, bodyW, 2, titleSize)
  const size = narrow ? 12 : 13
  const lineH = size + 9
  const lines = wrapLines(h.ctx, p.text.replace(/\s+/g, ' '), bodyW, 200, size)
  const headH = 46 + (titleLines.length - 1) * 24 + 58 + 14
  const footH = 58
  const contentH = lines.length * lineH
  const avail = tab.y - 8 - (bar.y - 4)
  const r: Rect = {
    x: 12,
    y: bar.y - 4,
    w: h.width - 24,
    h: Math.min(avail, Math.max(220, headH + contentH + footH + 14)),
  }
  // 详情是「盖在列表上的一页」：底下压一层纸色，列表退到背景里；
  // 点空白处退回列表（卡片本身先注册，所以点卡片不会误关）
  ctx.save()
  ctx.fillStyle = 'rgba(245,242,234,0.86)'
  ctx.fillRect(r.x - 4, r.y - 4, r.w + 8, avail + 8)
  ctx.restore()
  h.ui.add({
    id: 'problem:backdrop',
    rect: { x: r.x - 4, y: r.y - 4, w: r.w + 8, h: avail + 8 },
    onClick: () => {
      h.problemOpen = null
    },
  })
  h.ui.card(r, { radius: 16, fill: THEME.card, stroke: THEME.hairline, shadow: true })
  h.ui.add({ id: 'problem:card', rect: r })

  h.ui.iconButton({ x: r.x + 4, y: r.y + 4, w: 34, h: 34 }, 'back', {
    onClick: () => {
      h.problemOpen = null
    },
  })
  h.ui.text('题目', r.x + pad + 24, r.y + 21, {
    size: 9,
    weight: 700,
    color: THEME.inkFaint,
    mono: true,
    tracking: 1.2,
  })

  // 详情页顶部也只显示「已建 / 未建」。以前这里写「暂不支持」，
  // 但按钮明明能点生成——chip 和按钮互相矛盾，用户只会困惑。
  const status = built ? '已建' : '未建'
  const statusColor = built ? THEME.green : THEME.inkFaint
  ctx.save()
  ctx.font = font(10, 600)
  const statusW = ctx.measureText(status).width + 14
  ctx.restore()
  h.ui.chip(r.x + r.w - pad - statusW, r.y + 21, status, statusColor)

  let y = r.y + 46
  titleLines.forEach((line, i) => {
    h.ui.text(line, r.x + pad, y + i * 24, { size: titleSize, weight: 600, serif: true })
  })
  y += (titleLines.length - 1) * 24
  const catName = bankCategoryName(p.category)
  h.ui.text(`${p.source} · ${catName}`, r.x + pad, y + 26, {
    size: 9.5,
    color: THEME.inkFaint,
    maxWidth: r.w - pad * 2,
  })
  if (p.tags.length) {
    let tx = r.x + pad
    for (const t of p.tags.slice(0, 4)) {
      const w = h.ui.chip(tx, y + 44, t, THEME.inkSoft)
      tx += w + 5
      if (tx > r.x + r.w - pad) break
    }
  }
  const dividerY = y + 58
  h.ui.divider(r.x + pad, dividerY, r.x + r.w - pad, dividerY)

  // 题干
  const bodyTop = dividerY + 14
  const bodyBottom = r.y + r.h - footH - 4
  h.problemMaxScroll = Math.max(0, contentH - (bodyBottom - bodyTop))
  h.problemScroll = clamp(h.problemScroll, -h.problemMaxScroll, 0)
  ctx.save()
  ctx.beginPath()
  ctx.rect(r.x + pad - 2, bodyTop - 4, bodyW + 4, bodyBottom - bodyTop + 8)
  ctx.clip()
  lines.forEach((line, i) => {
    const ly = bodyTop + i * lineH + h.problemScroll
    if (ly < bodyTop - lineH || ly > bodyBottom + lineH) return
    h.ui.text(line, r.x + pad, ly, { size, color: THEME.ink, baseline: 'top' })
  })
  ctx.restore()
  if (h.problemMaxScroll > 0) {
    h.ui.text('上下拖动看完整题干', r.x + r.w - pad, bodyBottom + 10, {
      size: 8.5,
      color: THEME.inkFaint,
      align: 'right',
    })
  }

  // 底部动作：左边说明/删除，右边主操作
  const footY = r.y + r.h - footH + 8
  if (p.origin === 'mine') {
    h.ui.text('删除这道题', r.x + pad, footY + 18, { size: 10, color: THEME.inkFaint })
    h.ui.add({
      id: 'problem:delete',
      rect: { x: r.x + pad - 4, y: footY + 6, w: 76, h: 24 },
      cursor: 'pointer',
      onClick: () => {
        h.library = deleteProblem(h.library, p.id)
        h.persist()
        h.problemOpen = null
        h.toast('已从「我的题目」删除')
      },
    })
  } else {
    // 标注只当提示，**不当闸门**：以前规则解析建不了，不代表 AI 建不了。
    // 用户配了 key 就该让他试——试了才知道，AI 自己会说建不了。
    h.ui.text(
      unsupported
        ? '这类题以前规则解析没覆盖，AI 也许能建——试了才知道'
        : built
          ? '已经建过这道题'
          : '生成后可以直接拖、改参数',
      r.x + pad,
      footY + 18,
      { size: 10, color: THEME.inkSoft, maxWidth: r.w - pad * 2 - 170 },
    )
  }

  // 主按钮永远是「生成」；「手动搭」是并列的次要入口（兜底不该被藏起来）
  const manualW = 76
  const manual: Rect = { x: r.x + pad, y: footY, w: manualW, h: 36 }
  h.ui.pillButton(manual, '手动搭', {
    size: 10.5,
    weight: 600,
    onClick: () => h.loadBlank(),
  })
  h.ui.add({ id: 'problem:manual', rect: manual, cursor: 'pointer', onClick: () => h.loadBlank() })

  const btnW = 120
  const btn: Rect = { x: r.x + r.w - pad - btnW, y: footY, w: btnW, h: 36 }
  const action = built ? () => h.openModel(built.id) : () => h.generateAny(p.text, p.id)
  h.ui.pillButton(btn, built ? '打开模型 →' : '生成建模 →', {
    active: true,
    size: 11.5,
    weight: 650,
    onClick: action,
  })
  h.ui.add({
    id: built ? 'problem:open' : 'problem:generate',
    rect: btn,
    cursor: 'pointer',
    onClick: action,
  })
}