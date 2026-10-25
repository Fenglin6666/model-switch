/** 用户页：本地数据统计 + 清空（带确认）+ 关于。 */
import { THEME, roundRect } from '@render/theme'
import { clearModels, clearProblems, countIn, folderList, formatBytes, libraryBytes } from '@core/library'
import type { Rect } from '../widgets'
import type { PagesHost, ConfirmState } from './host'
import { renderTabs, wrapLines } from './shared'

export function renderUser(h: PagesHost): void {

  const W = h.width
  const H = h.height
  const ctx = h.ctx
  ctx.save()
  ctx.fillStyle = THEME.paper
  ctx.fillRect(0, 0, W, H)
  ctx.restore()

  const bar = h.pageBarRect()
  const narrow = W < 560
  h.ui.text('MODEL SWITCH · 用户', bar.x, bar.y + 12, {
    size: 8.5,
    weight: 700,
    color: THEME.inkFaint,
    mono: true,
    tracking: 1.3,
  })
  h.ui.text('用户', bar.x, bar.y + 36, { size: narrow ? 22 : 26, weight: 600, serif: true })
  h.ui.text('不登录 · 不上传', bar.x + (narrow ? 64 : 76), bar.y + 38, { size: 10, color: THEME.inkFaint })

  // 卡片贴着内容走，不撑满整页；宽屏统计排一行，窄屏 2×2
  const statCols = narrow ? 2 : 4
  const statRows = Math.ceil(4 / statCols)
  const statH = statRows * 48
  const avail = h.tabBarRect().y - 8 - (bar.y + 60)
  const needH = 24 + 18 + 18 + 26 + statH + 16 + 22 + 2 * 50 + 22 + 20 + 18 + 18 + 18
  const card: Rect = { x: bar.x, y: bar.y + 60, w: bar.w, h: Math.min(avail, needH) }
  h.ui.card(card, { radius: 14, fill: THEME.card, stroke: THEME.hairline })
  const pad = narrow ? 16 : 22
  let y = card.y + 24
  h.ui.text('这台设备上的数据', card.x + pad, y, { size: 12, weight: 700 })
  y += 18
  h.ui.text('所有内容都存在本地；换设备、清缓存会丢', card.x + pad, y, { size: 9.5, color: THEME.inkFaint })
  y += 26

  // 统计 2×2
  const stats: Array<[string, string]> = [
    [`${h.library.models.length}`, '建模'],
    [`${folderList(h.library).length}`, '文件夹'],
    [`${h.library.problems.length}`, '我的题目'],
    [formatBytes(libraryBytes(h.library)), '占用'],
  ]
  const cellW = (card.w - pad * 2) / statCols
  stats.forEach(([value, label], i) => {
    const col = i % statCols
    const row = Math.floor(i / statCols)
    const x = card.x + pad + col * cellW
    const yy = y + row * 48
    h.ui.text(value, x, yy + 2, { size: 20, weight: 650, serif: true })
    h.ui.text(label, x + 1, yy + 22, { size: 9, color: THEME.inkFaint })
  })
  y += statH
  h.ui.divider(card.x + pad, y, card.x + card.w - pad, y)
  y += 16

  h.ui.text('数据管理', card.x + pad, y, { size: 11, weight: 700, color: THEME.inkSoft })
  y += 22
  const rows: Array<{ label: string; sub: string; danger?: boolean; onClick: () => void }> = [
    {
      label: '清空建模库',
      sub: '删掉所有模型，文件夹和我的题目保留',
      danger: true,
      onClick: () =>
        h.askConfirm({
          title: '清空建模库？',
          message: `会删掉 ${h.library.models.length} 个模型，删了找不回来。文件夹和「我的题目」会保留。`,
          okLabel: '清空',
          onOk: () => {
            h.library = clearModels(h.library)
            h.persist()
            h.toast('建模库已清空')
          },
        }),
    },
    {
      label: '清空我的题目',
      sub: '只删导入的题目，模型不受影响',
      danger: true,
      onClick: () =>
        h.askConfirm({
          title: '清空我的题目？',
          message: `会删掉 ${h.library.problems.length} 道导入的题，模型不受影响。`,
          okLabel: '清空',
          onOk: () => {
            h.library = clearProblems(h.library)
            h.persist()
            h.toast('「我的题目」已清空')
          },
        }),
    },
  ]
  for (const row of rows) {
    const rr: Rect = { x: card.x + pad, y, w: card.w - pad * 2, h: 46 }
    h.ui.text(row.label, rr.x, rr.y + 12, { size: 12, weight: 600, color: row.danger ? THEME.red : THEME.ink })
    h.ui.text(row.sub, rr.x, rr.y + 30, { size: 9, color: THEME.inkFaint, maxWidth: rr.w - 40 })
    h.ui.text('›', rr.x + rr.w - 8, rr.y + 22, { size: 16, color: THEME.inkFaint, align: 'right' })
    h.ui.add({ id: `user:${row.label}`, rect: rr, cursor: 'pointer', onClick: row.onClick })
    y += 50
  }

  h.ui.divider(card.x + pad, y + 4, card.x + card.w - pad, y + 4)
  y += 22
  h.ui.text('关于', card.x + pad, y, { size: 11, weight: 700, color: THEME.inkSoft })
  y += 20
  h.ui.text('模型开关 · 把一道物理题变成能拨动的模型', card.x + pad, y, {
    size: 10,
    color: THEME.inkSoft,
    maxWidth: card.w - pad * 2,
  })
  y += 18
  h.ui.text('不判对错 · 不做实验 · 完全免费', card.x + pad, y, {
    size: 9.5,
    color: THEME.inkFaint,
  })

  renderTabs(h)
  if (h.confirm) renderConfirm(h)
}

export function askConfirm(h: PagesHost, opts: ConfirmState): void {
  h.confirm = opts
}

export function renderConfirm(h: PagesHost): void {

  const c = h.confirm
  if (!c) return
  const W = h.width
  const H = h.height
  const ctx = h.ctx
  ctx.save()
  ctx.fillStyle = 'rgba(29,32,37,0.42)'
  ctx.fillRect(0, 0, W, H)
  ctx.restore()
  h.ui.add({ id: 'confirm:backdrop', rect: { x: 0, y: 0, w: W, h: H }, onClick: () => { h.confirm = null } })

  const w = Math.min(W - 40, 360)
  const sheetH = 168
  const r: Rect = { x: (W - w) / 2, y: (H - sheetH) / 2, w, h: sheetH }
  h.ui.card(r, { radius: 16, fill: THEME.card, stroke: THEME.hairline })
  h.ui.add({ id: 'confirm:card', rect: r })
  h.ui.text(c.title, r.x + 18, r.y + 26, { size: 13, weight: 700 })
  const lines = wrapLines(h.ctx, c.message, r.w - 36, 3, 10)
  lines.forEach((line, i) => {
    h.ui.text(line, r.x + 18, r.y + 52 + i * 16, { size: 10, color: THEME.inkSoft })
  })
  h.ui.pillButton({ x: r.x + 18, y: r.y + sheetH - 50, w: 88, h: 34 }, '取消', {
    size: 11,
    weight: 600,
    onClick: () => {
      h.confirm = null
    },
  })
  h.ui.pillButton({ x: r.x + r.w - 106, y: r.y + sheetH - 50, w: 88, h: 34 }, c.okLabel, {
    active: true,
    size: 11,
    weight: 650,
    onClick: () => {
      const fn = c.onOk
      h.confirm = null
      fn()
    },
  })
}