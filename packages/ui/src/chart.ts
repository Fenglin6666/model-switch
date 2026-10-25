/** 观测图表：v–t / h–t / y–x 轨迹，A/B 两条曲线同图。 */
import { THEME, font, rgba, roundRect } from '@render/theme'
import type { Rect } from './widgets'

export type ChartSample = {
  t: number
  x: number
  y: number
  v: number
  a: number
  E: number
  p: number
}

export type ChartSeries = {
  label: string
  color: string
  dashed?: boolean
  points: Array<{ x: number; y: number }>
}

export function drawChart(
  ctx: CanvasRenderingContext2D,
  r: Rect,
  opts: {
    title: string
    xLabel: string
    yLabel: string
    series: ChartSeries[]
    emptyHint?: string
  },
): void {
  const padL = 44
  const padR = 14
  const padT = 22
  const padB = 26
  const x0 = r.x + padL
  const y0 = r.y + padT
  const w = r.w - padL - padR
  const h = r.h - padT - padB
  if (w < 40 || h < 30) return

  let minX = Infinity
  let maxX = -Infinity
  let minY = Infinity
  let maxY = -Infinity
  for (const s of opts.series) {
    for (const p of s.points) {
      if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) continue
      minX = Math.min(minX, p.x)
      maxX = Math.max(maxX, p.x)
      minY = Math.min(minY, p.y)
      maxY = Math.max(maxY, p.y)
    }
  }
  if (minY > 0) minY = 0
  if (maxY < 0) maxY = 0

  // 坐标轴标签：左上角写量纲，右下角写横轴
  ctx.save()
  ctx.font = font(9, 600)
  ctx.fillStyle = THEME.inkFaint
  ctx.textAlign = 'left'
  ctx.textBaseline = 'top'
  if (opts.yLabel) ctx.fillText(opts.yLabel, r.x + 4, r.y + 4)
  ctx.textAlign = 'right'
  ctx.fillText(opts.xLabel, x0 + w, y0 + h + 10)
  ctx.restore()

  if (!Number.isFinite(minX)) {
    ctx.save()
    ctx.font = font(11, 500)
    ctx.fillStyle = THEME.inkFaint
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(opts.emptyHint ?? '按播放，曲线会自己长出来', x0 + w / 2, y0 + h / 2)
    ctx.restore()
    return
  }

  const spanX = Math.max(maxX - minX, 1e-6)
  const spanY = Math.max(maxY - minY, 1e-6)
  const sx = (v: number) => x0 + ((v - minX) / spanX) * w
  const sy = (v: number) => y0 + h - ((v - minY) / spanY) * h

  // 横向网格 + 纵轴刻度
  ctx.save()
  ctx.strokeStyle = 'rgba(29,32,37,0.07)'
  ctx.lineWidth = 1
  ctx.font = font(9, 500)
  ctx.fillStyle = THEME.inkFaint
  ctx.textAlign = 'right'
  ctx.textBaseline = 'middle'
  for (let i = 0; i <= 3; i++) {
    const gy = y0 + (h * i) / 3
    ctx.beginPath()
    ctx.moveTo(x0, gy + 0.5)
    ctx.lineTo(x0 + w, gy + 0.5)
    ctx.stroke()
    const val = maxY - ((maxY - minY) * i) / 3
    ctx.fillText(formatTick(val), x0 - 8, gy)
  }
  // 坐标轴（L 形）
  ctx.strokeStyle = 'rgba(29,32,37,0.18)'
  ctx.beginPath()
  ctx.moveTo(x0 + 0.5, y0)
  ctx.lineTo(x0 + 0.5, y0 + h)
  ctx.lineTo(x0 + w, y0 + h)
  ctx.stroke()
  ctx.restore()

  // 曲线
  for (const s of opts.series) {
    if (s.points.length < 2) continue
    ctx.save()
    ctx.strokeStyle = s.color
    ctx.lineWidth = 2
    ctx.lineJoin = 'round'
    ctx.lineCap = 'round'
    if (s.dashed) ctx.setLineDash([5, 4])
    ctx.beginPath()
    s.points.forEach((p, i) => {
      const X = sx(p.x)
      const Y = sy(p.y)
      if (i === 0) ctx.moveTo(X, Y)
      else ctx.lineTo(X, Y)
    })
    ctx.stroke()
    ctx.restore()
  }
}

function formatTick(v: number): string {
  if (Math.abs(v) < 1e-9) return '0'
  const a = Math.abs(v)
  if (a >= 100) return v.toFixed(0)
  if (a >= 10) return v.toFixed(1)
  if (a >= 1) return v.toFixed(2)
  return v.toFixed(3)
}

/** 能量堆叠条：动能 / 势能 / 总能量漂移 */
export function drawEnergyBar(
  ctx: CanvasRenderingContext2D,
  r: Rect,
  opts: { ke: number; pe: number; total: number; initial: number },
): void {
  const { ke, pe, total, initial } = opts
  const maxE = Math.max(Math.abs(ke) + Math.abs(pe), Math.abs(initial), 1e-6)
  const w = r.w
  const h = 10
  const y = r.y
  ctx.save()
  roundRect(ctx, r.x, y, w, h, 5)
  ctx.fillStyle = 'rgba(35,39,47,0.06)'
  ctx.fill()
  const keW = (Math.max(0, ke) / maxE) * w
  const peW = (Math.max(0, pe) / maxE) * w
  if (keW > 0) {
    ctx.save()
    roundRect(ctx, r.x, y, Math.max(keW, 2), h, 5)
    ctx.clip()
    ctx.fillStyle = THEME.blue
    ctx.fillRect(r.x, y, keW, h)
    ctx.restore()
  }
  if (peW > 0) {
    ctx.save()
    roundRect(ctx, r.x + keW, y, Math.max(peW, 2), h, 5)
    ctx.clip()
    ctx.fillStyle = THEME.green
    ctx.fillRect(r.x + keW, y, peW, h)
    ctx.restore()
  }
  ctx.restore()

  const drift = initial > 1e-9 ? Math.abs(total - initial) / Math.abs(initial) : 0
  const color = drift > 0.02 ? THEME.red : drift > 0.005 ? THEME.amber : THEME.inkSoft
  ctx.save()
  ctx.font = font(9, 600)
  ctx.fillStyle = THEME.inkSoft
  ctx.textAlign = 'left'
  ctx.fillText('动能', r.x, y + h + 10)
  ctx.fillStyle = THEME.blue
  ctx.fillRect(r.x + 20, y + h + 5, 6, 6)
  ctx.fillStyle = THEME.inkSoft
  ctx.fillText('势能', r.x + 34, y + h + 10)
  ctx.fillStyle = THEME.green
  ctx.fillRect(r.x + 54, y + h + 5, 6, 6)
  ctx.fillStyle = color
  ctx.textAlign = 'right'
  ctx.fillText(`机械能漂移 ${(drift * 100).toFixed(2)}%`, r.x + w, y + h + 10)
  ctx.restore()
}
