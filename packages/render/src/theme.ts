/** 视觉主题：纸感白板 + 高对比墨水色。全部纯函数，方便小程序复用。 */

export const THEME = {
  paper: '#eef1f7',
  paperDeep: '#e4e8f0',
  card: '#ffffff',
  ink: '#1d2025',
  inkSoft: '#5e6570',
  inkFaint: 'rgba(29,32,37,0.34)',
  hairline: 'rgba(29,32,37,0.10)',
  grid: 'rgba(29,32,37,0.045)',
  gridMajor: 'rgba(29,32,37,0.085)',
   chrome: '#1b1e23',
  chromeSoft: '#2a2f37',
  chromeLine: 'rgba(255,255,255,0.09)',
  onChrome: '#f6f3ec',
  onChromeSoft: 'rgba(246,243,236,0.58)',
  chromeHover: 'rgba(255,255,255,0.08)',
  accent: '#7c3aed',
  accentDeep: '#6d28d9',
  accentSoft: 'rgba(124,58,237,0.12)',
  /** 左侧参数面板 */
  panel: '#ffffff',
  panelLine: '#e6e9f0',
  panelSoft: '#f5f6fa',
  /** 舞台底色（比纸色更冷一点，和白色面板分开） */
  stage: '#eef1f7',
  /** 状态药丸 */
  ok: '#16a34a',
  okSoft: 'rgba(22,163,74,0.12)',
  blue: '#3f7fe0',
  blueSoft: 'rgba(63,127,224,0.14)',
  green: '#3fa37a',
  amber: '#d99a2b',
  red: '#d4574a',
  terrain: '#96a0ae',
  track: '#7f8ea1',
  terrainDeep: '#7b8595',
  shadow: 'rgba(35,39,47,0.10)',
  forceColors: ['#dd5735', '#3f6fd0', '#2f8f6b', '#d09227', '#8a63d2'] as const,
  white: '#ffffff',
} as const

const FONT_STACK =
  '"PingFang SC","Hiragino Sans GB","Microsoft YaHei",ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif'
const MONO_STACK = '"SF Mono","JetBrains Mono","Cascadia Mono",ui-monospace,Menlo,Consolas,monospace'
const SERIF_STACK = '"Songti SC","Noto Serif SC","Source Han Serif SC",SimSun,ui-serif,Georgia,serif'

export function font(size: number, weight = 500): string {
  return `${weight} ${size}px ${FONT_STACK}`
}

export function fontMono(size: number, weight = 500): string {
  return `${weight} ${size}px ${MONO_STACK}`
}

export function fontSerif(size: number, weight = 500): string {
  return `${weight} ${size}px ${SERIF_STACK}`
}

export function shade(hex: string, factor: number): string {
  const n = hex.replace('#', '')
  const full = n.length === 3 ? n.split('').map((c) => c + c).join('') : n
  const r = Math.min(255, Math.round(parseInt(full.slice(0, 2), 16) * factor))
  const g = Math.min(255, Math.round(parseInt(full.slice(2, 4), 16) * factor))
  const b = Math.min(255, Math.round(parseInt(full.slice(4, 6), 16) * factor))
  return `rgb(${r},${g},${b})`
}

export function rgba(hex: string, alpha: number): string {
  const n = hex.replace('#', '')
  const full = n.length === 3 ? n.split('').map((c) => c + c).join('') : n
  const r = parseInt(full.slice(0, 2), 16)
  const g = parseInt(full.slice(2, 4), 16)
  const b = parseInt(full.slice(4, 6), 16)
  return `rgba(${r},${g},${b},${alpha})`
}

export function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const rr = Math.min(r, w / 2, h / 2)
  ctx.beginPath()
  ctx.moveTo(x + rr, y)
  ctx.lineTo(x + w - rr, y)
  ctx.arcTo(x + w, y, x + w, y + rr, rr)
  ctx.lineTo(x + w, y + h - rr)
  ctx.arcTo(x + w, y + h, x + w - rr, y + h, rr)
  ctx.lineTo(x + rr, y + h)
  ctx.arcTo(x, y + h, x, y + h - rr, rr)
  ctx.lineTo(x, y + rr)
  ctx.arcTo(x, y, x + rr, y, rr)
  ctx.closePath()
}
