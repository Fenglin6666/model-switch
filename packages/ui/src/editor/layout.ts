/**
 * 编辑器布局：纯函数，输入只有「窗口多大 + 有没有图表」，输出所有矩形。
 *
 * 抽出来的理由（不是洁癖）：这套算术以前埋在 app.ts 里，只能靠截图看对不对，
 * 一改面板宽度就可能把图表压到屏幕外。现在它可以在 node 里直接断言。
 *
 * 约定：
 * - 宽屏（>= 760）：左边是参数面板，右边是舞台，图表贴在舞台底部。
 * - 窄屏：舞台在上、参数面板在下（底部抽屉），图表收起（手机上一屏放不下三段）。
 * - 相机的**视口仍然是整个窗口**，靠 `pan` 把内容偏到「舞台」正中——
 *   这样指针坐标不用做任何偏移换算，这是这次重构里最省事的一个决定。
 */
import type { Rect } from '../widgets'

export const NARROW_BREAKPOINT = 760

export type LayoutInput = {
  width: number
  height: number
  insetsTop: number
  insetsRight: number
  hasChart: boolean
}

export type EditorLayout = {
  /** 左侧参数面板（窄屏时是底部抽屉） */
  panel: Rect
  /** 舞台：画布 + 图表所在的那一块 */
  stage: Rect
  /** 舞台底部的图表面板；没有图表观测器或窄屏时为 null */
  chart: Rect | null
  /** 真正能看见场景的区域（舞台减去图表） */
  canvas: Rect
  /** 相机要加的偏移：让内容落在 canvas 正中 */
  pan: { x: number; y: number }
  /** 三个页面的底部切换栏 */
  tabBar: Rect
  /** 题库/模型/用户页的标题栏 */
  pageBar: Rect
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

export function computeLayout(input: LayoutInput): EditorLayout {
  const { width, height, insetsTop, insetsRight, hasChart } = input
  const narrow = width < NARROW_BREAKPOINT

  const tabBar: Rect = { x: 12, y: height - 60, w: width - 24, h: 50 }
  const pageBar: Rect = { x: 14, y: 10 + insetsTop, w: width - 28, h: 52 }
  void insetsRight

  if (narrow) {
    const panelH = Math.min(360, Math.max(250, height * 0.44))
    const panel: Rect = { x: 0, y: height - panelH, w: width, h: panelH }
    const stage: Rect = { x: 0, y: 0, w: width, h: panel.y }
    return {
      panel,
      stage,
      chart: null,
      canvas: { ...stage },
      pan: { x: 0, y: -panelH / 2 },
      tabBar,
      pageBar,
    }
  }

  const panelW = Math.min(292, Math.max(250, width * 0.22))
  const panel: Rect = { x: 0, y: 0, w: panelW, h: height }
  const stage: Rect = { x: panelW, y: 0, w: width - panelW, h: height }
  const chartH = clamp(stage.h * 0.3, 150, 250)
  const chart: Rect | null = hasChart
    ? { x: stage.x + 16, y: stage.y + stage.h - chartH - 16, w: stage.w - 32, h: chartH }
    : null
  const canvas: Rect = {
    x: stage.x,
    y: stage.y,
    w: stage.w,
    h: chart ? chart.y - stage.y - 8 : stage.h,
  }
  // 内容中心要落在 canvas 中心：窗口中心 + pan = canvas 中心
  const pan = {
    x: canvas.x + canvas.w / 2 - width / 2,
    y: canvas.y + canvas.h / 2 - height / 2,
  }
  return { panel, stage, chart, canvas, pan, tabBar, pageBar }
}

/** 浮在舞台底部的属性面板（选中物体/约束、打开世界面板时） */
export function floatingSheet(stage: Rect, contentHeight: number, maxWidth = 860): Rect {
  const h = Math.min(contentHeight, stage.h - 120)
  const w = Math.min(stage.w - 24, maxWidth)
  return { x: stage.x + (stage.w - w) / 2, y: stage.y + stage.h - h - 12, w, h }
}
