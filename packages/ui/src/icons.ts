/** 线性图标：24×24 viewBox，用路径绘制，不依赖图片资源（小程序包体积友好）。 */
import { THEME } from '@render/theme'

export type IconName =
  | 'play'
  | 'pause'
  | 'reset'
  | 'back'
  | 'chart'
  | 'view'
  | 'share'
  | 'compare'
  | 'select'
  | 'rect'
  | 'circle'
  | 'line'
  | 'arc'
  | 'triangle'
  | 'pen'
  | 'ink'
  | 'eraser'
  | 'orbit'
  | 'doc'
  | 'force'
  | 'field'
  | 'link'
  | 'hand'
  | 'trash'
  | 'close'
  | 'search'
  | 'check'
  | 'plus'
  | 'speed'
  | 'steps'
  | 'chevron'

export function drawIcon(
  ctx: CanvasRenderingContext2D,
  name: IconName,
  cx: number,
  cy: number,
  size: number,
  color: string = THEME.ink,
  lineWidth = 1.8,
): void {
  const s = size / 24
  ctx.save()
  ctx.translate(cx - size / 2, cy - size / 2)
  ctx.scale(s, s)
  ctx.strokeStyle = color
  ctx.fillStyle = color
  ctx.lineWidth = lineWidth / s
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  const p = (fn: () => void) => {
    ctx.beginPath()
    fn()
    ctx.stroke()
  }
  switch (name) {
    case 'play':
      ctx.beginPath()
      ctx.moveTo(9, 6)
      ctx.lineTo(19, 12)
      ctx.lineTo(9, 18)
      ctx.closePath()
      ctx.fill()
      break
    case 'pause':
      ctx.beginPath()
      ctx.rect(7, 6, 3.5, 12)
      ctx.fill()
      ctx.beginPath()
      ctx.rect(13.5, 6, 3.5, 12)
      ctx.fill()
      break
    case 'reset':
      p(() => {
        ctx.arc(12, 12, 6.2, Math.PI * 0.18, Math.PI * 1.75)
      })
      // 箭头：接在弧的起点
      ctx.beginPath()
      ctx.moveTo(18.1, 10.4)
      ctx.lineTo(18.4, 15.4)
      ctx.lineTo(13.6, 14.2)
      ctx.closePath()
      ctx.fill()
      break
    case 'back':
      p(() => {
        ctx.moveTo(14, 5)
        ctx.lineTo(7, 12)
        ctx.lineTo(14, 19)
      })
      break
    case 'chevron':
      p(() => {
        ctx.moveTo(9, 6)
        ctx.lineTo(15, 12)
        ctx.lineTo(9, 18)
      })
      break
    case 'chart':
      p(() => {
        ctx.moveTo(4, 19)
        ctx.lineTo(4, 5)
        ctx.moveTo(4, 19)
        ctx.lineTo(20, 19)
      })
      ctx.beginPath()
      ctx.moveTo(7, 16)
      ctx.lineTo(11, 10)
      ctx.lineTo(15, 13)
      ctx.lineTo(20, 6)
      ctx.stroke()
      break
    case 'view':
      p(() => {
        ctx.ellipse(12, 12, 9, 5.5, 0, 0, Math.PI * 2)
      })
      ctx.beginPath()
      ctx.arc(12, 12, 2.4, 0, Math.PI * 2)
      ctx.fill()
      break
    case 'share':
      p(() => {
        ctx.moveTo(12, 4)
        ctx.lineTo(12, 14)
        ctx.moveTo(8, 8)
        ctx.lineTo(12, 4)
        ctx.lineTo(16, 8)
        ctx.moveTo(5, 14)
        ctx.lineTo(5, 20)
        ctx.lineTo(19, 20)
        ctx.lineTo(19, 14)
      })
      break
    case 'compare':
      p(() => {
        ctx.moveTo(12, 4)
        ctx.lineTo(12, 20)
        ctx.moveTo(4, 8)
        ctx.lineTo(4, 16)
        ctx.moveTo(20, 8)
        ctx.lineTo(20, 16)
      })
      ctx.beginPath()
      ctx.arc(4, 12, 2.2, 0, Math.PI * 2)
      ctx.arc(20, 12, 2.2, 0, Math.PI * 2)
      ctx.fill()
      break
    case 'select':
      ctx.beginPath()
      ctx.moveTo(6, 4)
      ctx.lineTo(18, 13)
      ctx.lineTo(12, 14)
      ctx.lineTo(15, 20)
      ctx.lineTo(12.5, 21)
      ctx.lineTo(9.5, 15)
      ctx.lineTo(6, 18)
      ctx.closePath()
      ctx.fill()
      break
    case 'rect':
      p(() => ctx.rect(5, 6, 14, 12))
      break
    case 'circle':
      p(() => ctx.arc(12, 12, 7, 0, Math.PI * 2))
      break
    case 'line':
      p(() => {
        ctx.moveTo(5, 18)
        ctx.lineTo(19, 6)
      })
      break
    case 'arc':
      p(() => ctx.arc(12, 15, 8, Math.PI, Math.PI * 2))
      break
    case 'triangle':
      p(() => {
        ctx.moveTo(5, 18)
        ctx.lineTo(12, 5)
        ctx.lineTo(19, 18)
        ctx.closePath()
      })
      break
    case 'pen':
      p(() => {
        ctx.moveTo(5, 19)
        ctx.lineTo(8.5, 18.2)
        ctx.lineTo(18.5, 8.2)
        ctx.lineTo(15.8, 5.5)
        ctx.lineTo(5.8, 15.5)
        ctx.closePath()
      })
      p(() => {
        ctx.moveTo(8.5, 18.2)
        ctx.lineTo(5.8, 15.5)
      })
      break
    case 'ink':
      // 笔尖 + 下面一条波浪线：区别于「手绘」（那是建地形）
      p(() => {
        ctx.moveTo(15.5, 4.5)
        ctx.lineTo(19.5, 8.5)
        ctx.lineTo(10.5, 17.5)
        ctx.lineTo(6.5, 13.5)
        ctx.closePath()
      })
      p(() => {
        ctx.moveTo(6.5, 13.5)
        ctx.lineTo(15.5, 4.5)
      })
      p(() => {
        ctx.moveTo(4, 20.5)
        ctx.bezierCurveTo(7, 18.6, 9.5, 21.4, 12.5, 20)
        ctx.bezierCurveTo(15, 18.9, 17, 20.6, 20, 19.6)
      })
      break
    case 'eraser':
      p(() => {
        ctx.moveTo(8, 20)
        ctx.lineTo(4, 16)
        ctx.lineTo(13, 7)
        ctx.lineTo(19, 13)
        ctx.lineTo(11, 21)
        ctx.closePath()
      })
      p(() => {
        ctx.moveTo(9, 11)
        ctx.lineTo(15, 17)
      })
      break
    case 'link':
      p(() => {
        ctx.moveTo(8, 12)
        ctx.lineTo(16, 12)
      })
      ctx.beginPath()
      ctx.arc(6, 12, 2.6, 0, Math.PI * 2)
      ctx.fill()
      ctx.beginPath()
      ctx.arc(18, 12, 2.6, 0, Math.PI * 2)
      ctx.fill()
      break
    case 'force':
      p(() => {
        ctx.moveTo(4, 12)
        ctx.lineTo(19, 12)
      })
      ctx.beginPath()
      ctx.moveTo(19, 12)
      ctx.lineTo(13.5, 7.5)
      ctx.lineTo(13.5, 16.5)
      ctx.closePath()
      ctx.fill()
      p(() => {
        ctx.moveTo(4, 6)
        ctx.lineTo(4, 18)
      })
      break
    case 'field':
      // 虚线框 + 里面的箭头：一块场区
      ctx.setLineDash([2.4, 2.2])
      p(() => ctx.rect(4, 5.5, 16, 13))
      ctx.setLineDash([])
      p(() => {
        ctx.moveTo(12, 16)
        ctx.lineTo(12, 8.4)
      })
      ctx.beginPath()
      ctx.moveTo(12, 6.6)
      ctx.lineTo(9.4, 10)
      ctx.lineTo(14.6, 10)
      ctx.closePath()
      ctx.fill()
      break
    case 'doc':
      p(() => {
        ctx.moveTo(7, 4)
        ctx.lineTo(14, 4)
        ctx.lineTo(18, 8)
        ctx.lineTo(18, 20)
        ctx.lineTo(7, 20)
        ctx.closePath()
        ctx.moveTo(14, 4)
        ctx.lineTo(14, 8)
        ctx.lineTo(18, 8)
        ctx.moveTo(10, 12)
        ctx.lineTo(15, 12)
        ctx.moveTo(10, 16)
        ctx.lineTo(15, 16)
      })
      break

    case 'orbit':
      p(() => {
        ctx.ellipse(12, 12, 8, 4.5, -0.5, 0, Math.PI * 1.7)
      })
      ctx.beginPath()
      ctx.moveTo(17.6, 6.4)
      ctx.lineTo(19.8, 8.6)
      ctx.lineTo(16.6, 9.6)
      ctx.closePath()
      ctx.fill()
      break
    case 'hand':
      p(() => {
        ctx.moveTo(8, 12)
        ctx.lineTo(8, 6)
        ctx.moveTo(8, 10)
        ctx.lineTo(8, 4.5)
        ctx.moveTo(12, 10)
        ctx.lineTo(12, 4.5)
        ctx.moveTo(16, 11)
        ctx.lineTo(16, 7)
        ctx.moveTo(8, 12)
        ctx.quadraticCurveTo(8, 19, 13, 20.5)
        ctx.quadraticCurveTo(18, 21, 18, 14)
        ctx.lineTo(18, 11)
      })
      break
    case 'trash':
      p(() => {
        ctx.moveTo(5, 7)
        ctx.lineTo(19, 7)
        ctx.moveTo(9, 7)
        ctx.lineTo(9, 4)
        ctx.lineTo(15, 4)
        ctx.lineTo(15, 7)
        ctx.moveTo(7, 7)
        ctx.lineTo(8, 20)
        ctx.lineTo(16, 20)
        ctx.lineTo(17, 7)
      })
      break
    case 'close':
      p(() => {
        ctx.moveTo(6, 6)
        ctx.lineTo(18, 18)
        ctx.moveTo(18, 6)
        ctx.lineTo(6, 18)
      })
      break
    case 'search':
      p(() => ctx.arc(11, 11, 6, 0, Math.PI * 2))
      p(() => {
        ctx.moveTo(15.5, 15.5)
        ctx.lineTo(20, 20)
      })
      break
    case 'check':
      p(() => {
        ctx.moveTo(5, 12.5)
        ctx.lineTo(10, 17)
        ctx.lineTo(19, 7)
      })
      break
    case 'plus':
      p(() => {
        ctx.moveTo(12, 5)
        ctx.lineTo(12, 19)
        ctx.moveTo(5, 12)
        ctx.lineTo(19, 12)
      })
      break
    case 'steps':
      p(() => {
        ctx.moveTo(4, 19)
        ctx.lineTo(9, 9)
        ctx.lineTo(14, 14)
        ctx.lineTo(20, 5)
      })
      for (const [x, y] of [[4, 19], [9, 9], [14, 14], [20, 5]]) {
        ctx.beginPath()
        ctx.arc(x, y, 1.8, 0, Math.PI * 2)
        ctx.fill()
      }
      break
    case 'speed':
      p(() => {
        ctx.arc(12, 14, 7, Math.PI, Math.PI * 2)
      })
      p(() => {
        ctx.moveTo(12, 14)
        ctx.lineTo(16, 9)
      })
      break
  }
  ctx.restore()
}
