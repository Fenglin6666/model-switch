/** 页面共用的小工具：折行、日期、底部三栏。 */
import { THEME, font, roundRect } from '@render/theme'
import { inRect } from '../widgets'
import type { Rect } from '../widgets'
import type { PagesHost } from './host'

/** 按字符宽度折行（中文按 1em 估，够用） */
export function wrapLines(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, maxLines: number, size: number): string[] {
  ctx.save()
  ctx.font = font(size, 500)
  const lines: string[] = []
  let line = ''
  for (const ch of text) {
    if (line && ctx.measureText(line + ch).width > maxWidth) {
      lines.push(line)
      line = ch
      if (lines.length === maxLines) break
    } else {
      line += ch
    }
  }
  if (lines.length < maxLines && line) lines.push(line)
  ctx.restore()
  return lines
}

export function shortDate(t: number): string {

  const d = new Date(t)
  return `${d.getMonth() + 1}/${d.getDate()}`
}

/** 三个页面共用的底部选择栏：用户 / 题库 / 模型 */
export function renderTabs(h: PagesHost): void {

  const r = h.tabBarRect()
  h.ui.card(r, { radius: 14, fill: THEME.card, stroke: THEME.panelLine, shadow: true })
  const gap = 4
  const w = (r.w - gap * 4) / 3
  const items: Array<{ id: 'user' | 'bank' | 'library'; label: string }> = [
    { id: 'user', label: '用户' },
    { id: 'bank', label: '题库' },
    { id: 'library', label: h.library.models.length ? `模型 ${h.library.models.length}` : '模型' },
  ]
  items.forEach((it, i) => {
    h.ui.pillButton({ x: r.x + gap + i * (w + gap), y: r.y + gap, w, h: r.h - gap * 2 }, it.label, {
      active: h.mode === it.id,
      size: 11.5,
      weight: 650,
      onClick: () => {
        if (it.id === 'user') h.toUser()
        else if (it.id === 'bank') h.toBank()
        else h.toLibrary()
      },
    })
  })
}