/** 极简即时模式控件：每帧绘制并登记可点击区域，输入层用上一帧的区域做命中测试。 */
import { THEME, font, fontMono, fontSerif, rgba, roundRect } from '@render/theme'
import { drawIcon, type IconName } from './icons'

export type Rect = { x: number; y: number; w: number; h: number }

export const inRect = (r: Rect, x: number, y: number): boolean =>
  x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h

export const rectCenter = (r: Rect): { x: number; y: number } => ({
  x: r.x + r.w / 2,
  y: r.y + r.h / 2,
})

export type HitRegion = {
  id: string
  rect: Rect
  cursor?: 'pointer' | 'grab' | 'ew-resize' | 'default'
  onPress?: (x: number, y: number) => void
  onDrag?: (x: number, y: number) => void
  onRelease?: () => void
  /** 松手才触发（拖动超过 8px 视为滚动，不触发） */
  onClick?: () => void
  /** 滑杆：拖动时把 x 映射成值 */
  slider?: { min: number; max: number; step: number; onChange: (v: number) => void }
  disabled?: boolean
}

export class UI {
  hits: HitRegion[] = []
  hoverId: string | null = null
  pointer = { x: -999, y: -999 }
  pointerDown = false
  private seq = 0

  constructor(readonly ctx: CanvasRenderingContext2D) {}

  reset(): void {
    this.hits = []
    this.seq = 0
  }

  id(prefix: string): string {
    this.seq++
    return `${prefix}#${this.seq}`
  }

  add(region: HitRegion): void {
    this.hits.push(region)
  }

  find(x: number, y: number): HitRegion | undefined {
    // 后画的优先（浮层在上）
    for (let i = this.hits.length - 1; i >= 0; i--) {
      const h = this.hits[i]!
      if (!h.disabled && inRect(h.rect, x, y)) return h
    }
    return undefined
  }

  private isHover(r: Rect): boolean {
    return inRect(r, this.pointer.x, this.pointer.y)
  }

  card(r: Rect, opts: { fill?: string; radius?: number; shadow?: boolean; stroke?: string } = {}): void {
    const { ctx } = this
    ctx.save()
    if (opts.shadow !== false) {
      ctx.shadowColor = 'rgba(35,39,47,0.13)'
      ctx.shadowBlur = 18
      ctx.shadowOffsetY = 5
    }
    ctx.fillStyle = opts.fill ?? THEME.card
    roundRect(ctx, r.x, r.y, r.w, r.h, opts.radius ?? 16)
    ctx.fill()
    ctx.restore()
    if (opts.stroke) {
      ctx.save()
      ctx.strokeStyle = opts.stroke
      ctx.lineWidth = 1
      roundRect(ctx, r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1, opts.radius ?? 16)
      ctx.stroke()
      ctx.restore()
    }
  }

  text(
    text: string,
    x: number,
    y: number,
    opts: {
      size?: number
      weight?: number
      color?: string
      align?: CanvasTextAlign
      baseline?: CanvasTextBaseline
      maxWidth?: number
      mono?: boolean
      serif?: boolean
      tracking?: number
    } = {},
  ): void {
    const { ctx } = this
    ctx.save()
    ctx.font = opts.mono ? fontMono(opts.size ?? 12, opts.weight ?? 500) : opts.serif ? fontSerif(opts.size ?? 12, opts.weight ?? 500) : font(opts.size ?? 12, opts.weight ?? 500)
    if (opts.tracking) (ctx as CanvasRenderingContext2D & { letterSpacing?: string }).letterSpacing = `${opts.tracking}px`
    ctx.fillStyle = opts.color ?? THEME.ink
    ctx.textAlign = opts.align ?? 'left'
    ctx.textBaseline = opts.baseline ?? 'middle'
    if (opts.maxWidth) {
      let t = text
      if (ctx.measureText(t).width > opts.maxWidth) {
        while (t.length > 1 && ctx.measureText(t + '…').width > opts.maxWidth) t = t.slice(0, -1)
        t += '…'
      }
      ctx.fillText(t, x, y)
    } else {
      ctx.fillText(text, x, y)
    }
    ctx.restore()
  }

  iconButton(
    r: Rect,
    icon: IconName,
    opts: {
      active?: boolean
      danger?: boolean
      size?: number
      label?: string
      tone?: 'light' | 'dark'
      /** 开关类状态用安静高亮，不抢主操作 */
      quiet?: boolean
      onClick?: () => void
    } = {},
  ): void {
    const { ctx } = this
    const dark = opts.tone === 'dark'
    const hover = this.isHover(r)
    const pressed = this.pointerDown && hover
    const bg = opts.active
      ? opts.quiet
        ? dark ? 'rgba(255,255,255,0.14)' : 'rgba(29,32,37,0.08)'
        : dark ? THEME.accent : THEME.ink
      : pressed
        ? dark ? 'rgba(255,255,255,0.14)' : 'rgba(29,32,37,0.10)'
        : hover
          ? dark ? 'rgba(255,255,255,0.08)' : 'rgba(29,32,37,0.05)'
          : 'transparent'
    if (bg !== 'transparent') {
      ctx.save()
      ctx.fillStyle = bg
      roundRect(ctx, r.x, r.y, r.w, r.h, 9)
      ctx.fill()
      ctx.restore()
    }
    const color = opts.active
      ? opts.quiet
        ? dark ? THEME.onChrome : THEME.ink
        : THEME.white
      : opts.danger
        ? (dark ? '#ff9d87' : THEME.red)
        : (dark ? THEME.onChromeSoft : THEME.inkSoft)
    drawIcon(ctx, icon, r.x + r.w / 2, r.y + r.h / 2, opts.size ?? 20, color)
    if (opts.label) {
      this.text(opts.label, r.x + r.w / 2, r.y + r.h / 2 + 1, { size: 10, weight: 600, color, align: 'center' })
    }
    if (opts.onClick) this.add({ id: this.id('ib'), rect: r, cursor: 'pointer', onClick: opts.onClick })
  }

  /** 主播放键：大圆 */
  playButton(r: Rect, playing: boolean, onClick: () => void): void {
    const { ctx } = this
    const pressed = this.pointerDown && this.isHover(r)
    ctx.save()
    ctx.shadowColor = rgba(THEME.accent, 0.35)
    ctx.shadowBlur = 10
    ctx.shadowOffsetY = 3
    ctx.fillStyle = pressed ? THEME.accentDeep : THEME.accent
    ctx.beginPath()
    ctx.arc(r.x + r.w / 2, r.y + r.h / 2, r.w / 2, 0, Math.PI * 2)
    ctx.fill()
    ctx.restore()
    drawIcon(ctx, playing ? 'pause' : 'play', r.x + r.w / 2 + (playing ? 0 : 1), r.y + r.h / 2, 20, THEME.white, 2)
    this.add({ id: this.id('play'), rect: r, cursor: 'pointer', onClick })
  }

  pillButton(
    r: Rect,
    label: string,
    opts: {
      active?: boolean
      accent?: string
      size?: number
      weight?: number
      tone?: 'light' | 'dark'
      mono?: boolean
      icon?: IconName
      onClick?: () => void
    } = {},
  ): void {
    const { ctx } = this
    const dark = opts.tone === 'dark'
    const hover = this.isHover(r) && !!opts.onClick
    const pressed = hover && this.pointerDown
    const accent = opts.accent ?? THEME.accent
    ctx.save()
    ctx.fillStyle = opts.active
      ? accent
      : pressed
        ? dark ? 'rgba(255,255,255,0.15)' : 'rgba(29,32,37,0.10)'
        : hover
          ? dark ? 'rgba(255,255,255,0.11)' : 'rgba(29,32,37,0.07)'
          : dark ? 'rgba(255,255,255,0.07)' : 'rgba(29,32,37,0.045)'
    roundRect(ctx, r.x, r.y, r.w, r.h, 9)
    ctx.fill()
    ctx.restore()
    const fg = opts.active ? THEME.white : dark ? THEME.onChrome : THEME.ink
    if (opts.icon) drawIcon(ctx, opts.icon, r.x + 14, r.y + r.h / 2, 13, fg)
    this.text(label, r.x + r.w / 2 + (opts.icon ? 6 : 0), r.y + r.h / 2 + 0.5, {
      size: opts.size ?? 11,
      weight: opts.weight ?? 600,
      color: fg,
      align: 'center',
      mono: opts.mono,
    })
    if (opts.onClick) this.add({ id: this.id('pill'), rect: r, cursor: 'pointer', onClick: opts.onClick })
  }

  chip(x: number, y: number, text: string, color: string = THEME.inkSoft, fill?: string): number {
    const { ctx } = this
    ctx.save()
    ctx.font = font(10, 600)
    const w = ctx.measureText(text).width + 14
    ctx.fillStyle = fill ?? rgba(color, 0.12)
    roundRect(ctx, x, y - 9, w, 18, 9)
    ctx.fill()
    ctx.restore()
    this.text(text, x + w / 2, y + 0.5, { size: 10, weight: 600, color, align: 'center' })
    return w
  }

  /**
   * 参数滑杆：和参考图一致——上方标签 + 紫色数值，下面一条 5px 轨道，
   * 白色圆钮带紫色描边；可选左右两端的小字（光滑 0 / 粗糙 0.8）。
   */
  slider(
    r: Rect,
    opts: {
      id: string
      label: string
      value: number
      min: number
      max: number
      step: number
      unit?: string
      decimals?: number
      displayScale?: number
      hintLeft?: string
      hintRight?: string
      onChange: (v: number) => void
      onScrubStart?: () => void
      onScrubEnd?: () => void
    },
  ): void {
    const { ctx } = this
    const scale = opts.displayScale ?? 1
    const decimals = opts.decimals ?? 0
    const display = (opts.value * scale).toFixed(decimals)
    const hints = !!(opts.hintLeft || opts.hintRight)
    const trackY = r.y + r.h - (hints ? 20 : 14)
    const t = (opts.value - opts.min) / Math.max(1e-9, opts.max - opts.min)
    const knobX = r.x + t * r.w

    this.text(opts.label, r.x, r.y + 10, { size: 11, weight: 600, color: THEME.ink })
    this.text(`${display}${opts.unit ?? ''}`, r.x + r.w, r.y + 10, {
      size: 11.5,
      weight: 700,
      color: THEME.accent,
      align: 'right',
      mono: true,
    })

    const hover = this.isHover(r)
    ctx.save()
    // 轨道
    ctx.fillStyle = 'rgba(29,32,37,0.10)'
    roundRect(ctx, r.x, trackY - 2.5, r.w, 5, 2.5)
    ctx.fill()
    if (t > 0) {
      ctx.fillStyle = THEME.accent
      roundRect(ctx, r.x, trackY - 2.5, Math.max(5, knobX - r.x), 5, 2.5)
      ctx.fill()
    }
    // 圆钮
    const knobR = hover ? 8.5 : 8
    ctx.beginPath()
    ctx.arc(knobX, trackY, knobR, 0, Math.PI * 2)
    ctx.fillStyle = THEME.white
    ctx.shadowColor = 'rgba(29,32,37,0.18)'
    ctx.shadowBlur = 6
    ctx.shadowOffsetY = 1
    ctx.fill()
    ctx.shadowColor = 'transparent'
    ctx.strokeStyle = THEME.accent
    ctx.lineWidth = 2
    ctx.stroke()
    ctx.restore()

    if (hints) {
      if (opts.hintLeft) this.text(opts.hintLeft, r.x, trackY + 18, { size: 8.5, color: THEME.inkFaint })
      if (opts.hintRight) this.text(opts.hintRight, r.x + r.w, trackY + 18, { size: 8.5, color: THEME.inkFaint, align: 'right' })
    }

    const hit: Rect = { x: r.x - 10, y: r.y, w: r.w + 20, h: r.h }
    this.add({
      id: `ctl:${opts.id}`,
      rect: hit,
      cursor: 'ew-resize',
      onPress: (x) => {
        opts.onScrubStart?.()
        this.applySlider(x, hit, opts)
      },
      onDrag: (x) => this.applySlider(x, hit, opts),
      onRelease: () => opts.onScrubEnd?.(),
      slider: { min: opts.min, max: opts.max, step: opts.step, onChange: opts.onChange },
    })
  }

  private applySlider(
    x: number,
    r: Rect,
    opts: { min: number; max: number; step: number; onChange: (v: number) => void },
  ): void {
    const t = Math.max(0, Math.min(1, (x - r.x) / Math.max(1, r.w)))
    const raw = opts.min + t * (opts.max - opts.min)
    const stepped = Math.round(raw / opts.step) * opts.step
    const v = Math.max(opts.min, Math.min(opts.max, Number(stepped.toFixed(6))))
    opts.onChange(v)
  }

  toggle(
    r: Rect,
    opts: {
      id: string
      label: string
      on: boolean
      offLabel: string
      onLabel: string
      onChange: (on: boolean) => void
    },
  ): void {
    const { ctx } = this
    this.text(opts.label, r.x, r.y + 10, { size: 11, weight: 600, color: THEME.inkSoft })
    const trackY = r.y + r.h - 34
    const trackH = 28
    ctx.save()
    ctx.fillStyle = 'rgba(35,39,47,0.07)'
    roundRect(ctx, r.x, trackY, r.w, trackH, 9)
    ctx.fill()
    const half = (r.w - 4) / 2
    const activeX = opts.on ? r.x + 2 + half : r.x + 2
    ctx.fillStyle = THEME.white
    ctx.shadowColor = 'rgba(35,39,47,0.16)'
    ctx.shadowBlur = 6
    ctx.shadowOffsetY = 1
    roundRect(ctx, activeX, trackY + 4, half, trackH - 8, 7)
    ctx.fill()
    ctx.shadowColor = 'transparent'
    ctx.restore()

    this.text(opts.offLabel, r.x + 2 + half / 2, trackY + trackH / 2, {
      size: 11,
      weight: opts.on ? 500 : 700,
      color: opts.on ? THEME.inkSoft : THEME.ink,
      align: 'center',
    })
    this.text(opts.onLabel, r.x + 2 + half + half / 2, trackY + trackH / 2, {
      size: 11,
      weight: opts.on ? 700 : 500,
      color: opts.on ? THEME.ink : THEME.inkSoft,
      align: 'center',
    })

    this.add({
      id: `ctl:${opts.id}:off`,
      rect: { x: r.x, y: trackY, w: half + 2, h: trackH },
      cursor: 'pointer',
      onClick: () => opts.onChange(false),
    })
    this.add({
      id: `ctl:${opts.id}:on`,
      rect: { x: r.x + half + 2, y: trackY, w: half + 2, h: trackH },
      cursor: 'pointer',
      onClick: () => opts.onChange(true),
    })
  }

  segmented(
    r: Rect,
    opts: {
      id: string
      label?: string
      options: Array<{ label: string; value: string }>
      value: string
      onChange: (v: string) => void
      size?: number
    },
  ): void {
    const { ctx } = this
    if (opts.label) this.text(opts.label, r.x, r.y + 8, { size: 10, weight: 600, color: THEME.inkSoft, tracking: 0.2 })
    const top = r.y + (opts.label ? 18 : 0)
    const h = r.h - (opts.label ? 18 : 0)
    const n = opts.options.length
    const gap = 3
    const w = (r.w - gap * (n - 1)) / n
    ctx.save()
    ctx.fillStyle = 'rgba(29,32,37,0.045)'
    roundRect(ctx, r.x - 3, top - 3, r.w + 6, h + 6, 11)
    ctx.fill()
    ctx.restore()
    opts.options.forEach((opt, i) => {
      const x = r.x + i * (w + gap)
      const active = opt.value === opts.value
      ctx.save()
      if (active) {
        ctx.shadowColor = 'rgba(29,32,37,0.12)'
        ctx.shadowBlur = 5
        ctx.shadowOffsetY = 1
        ctx.fillStyle = THEME.card
      } else {
        ctx.fillStyle = 'transparent'
      }
      roundRect(ctx, x, top, w, h, 8)
      ctx.fill()
      ctx.shadowColor = 'transparent'
      if (active) {
        ctx.strokeStyle = 'rgba(29,32,37,0.08)'
        ctx.lineWidth = 1
        ctx.stroke()
      }
      ctx.restore()
      this.text(opt.label, x + w / 2, top + h / 2 + 0.5, {
        size: opts.size ?? 10.5,
        weight: active ? 700 : 500,
        color: active ? THEME.ink : THEME.inkSoft,
        align: 'center',
      })
      this.add({
        id: `ctl:${opts.id}:${opt.value}`,
        rect: { x, y: top, w, h },
        cursor: 'pointer',
        onClick: () => opts.onChange(opt.value),
      })
    })
  }

  progress(r: Rect, value: number): void {
    const { ctx } = this
    ctx.save()
    ctx.fillStyle = 'rgba(35,39,47,0.08)'
    roundRect(ctx, r.x, r.y, r.w, r.h, r.h / 2)
    ctx.fill()
    ctx.fillStyle = THEME.accent
    roundRect(ctx, r.x, r.y, Math.max(r.h, r.w * Math.max(0, Math.min(1, value))), r.h, r.h / 2)
    ctx.fill()
    ctx.restore()
  }

  divider(x1: number, y1: number, x2: number, y2: number, color: string = THEME.hairline): void {
    const { ctx } = this
    ctx.save()
    ctx.strokeStyle = color
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(x1, y1)
    ctx.lineTo(x2, y2)
    ctx.stroke()
    ctx.restore()
  }

  toast(text: string, x: number, y: number): void {
    const { ctx } = this
    ctx.save()
    ctx.font = font(12, 600)
    const w = Math.min(ctx.measureText(text).width + 32, 360)
    ctx.shadowColor = 'rgba(35,39,47,0.18)'
    ctx.shadowBlur = 16
    ctx.shadowOffsetY = 4
    ctx.fillStyle = THEME.ink
    roundRect(ctx, x - w / 2, y - 18, w, 36, 18)
    ctx.fill()
    ctx.restore()
    this.text(text, x, y + 0.5, { size: 12, weight: 600, color: THEME.white, align: 'center', maxWidth: w - 20 })
  }
}
