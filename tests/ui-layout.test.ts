import { describe, expect, it } from 'vitest'
import { NARROW_BREAKPOINT, computeLayout, floatingSheet } from '@ui/editor/layout'

const desk = (hasChart = true, width = 1280, height = 840) =>
  computeLayout({ width, height, insetsTop: 0, insetsRight: 0, hasChart })

describe('编辑器布局（纯函数）', () => {
  it('宽屏：面板在左、舞台在右，两者严丝合缝', () => {
    const l = desk()
    expect(l.panel.x).toBe(0)
    expect(l.panel.h).toBe(840)
    expect(l.stage.x).toBe(l.panel.w)
    expect(l.stage.x + l.stage.w).toBe(1280)
    expect(l.panel.w).toBeGreaterThanOrEqual(250)
    expect(l.panel.w).toBeLessThanOrEqual(292)
  })

  it('有图表时：图表贴在舞台底部，画布不重叠', () => {
    const l = desk(true)
    expect(l.chart).not.toBeNull()
    expect(l.chart!.y + l.chart!.h).toBe(840 - 16)
    expect(l.canvas.y + l.canvas.h).toBeLessThanOrEqual(l.chart!.y)
    expect(l.canvas.h).toBeGreaterThan(300)
  })

  it('没有图表时：舞台铺满，图表为 null', () => {
    const l = desk(false)
    expect(l.chart).toBeNull()
    expect(l.canvas.h).toBe(l.stage.h)
  })

  it('相机偏移把内容对准「画布」中心，而不是窗口中心', () => {
    for (const hasChart of [true, false]) {
      for (const [w, h] of [[1280, 840], [1920, 1080], [900, 700]] as const) {
        const l = computeLayout({ width: w, height: h, insetsTop: 0, insetsRight: 0, hasChart })
        // 窗口中心 + pan 应等于 canvas 中心
        expect(w / 2 + l.pan.x).toBeCloseTo(l.canvas.x + l.canvas.w / 2, 6)
        expect(h / 2 + l.pan.y).toBeCloseTo(l.canvas.y + l.canvas.h / 2, 6)
      }
    }
  })

  it('窄屏：舞台在上、面板在下，图表收起', () => {
    const l = computeLayout({ width: 390, height: 844, insetsTop: 51, insetsRight: 100, hasChart: true })
    expect(l.chart).toBeNull()
    expect(l.stage.h).toBe(l.panel.y)
    expect(l.panel.y + l.panel.h).toBe(844)
    expect(l.panel.h).toBeGreaterThanOrEqual(250)
    expect(l.panel.h).toBeLessThanOrEqual(360)
    // 内容对准舞台中心
    expect(844 / 2 + l.pan.y).toBeCloseTo(l.stage.h / 2, 6)
  })

  it('断点两侧行为正确（759 窄 / 760 宽）', () => {
    const narrow = computeLayout({ width: NARROW_BREAKPOINT - 1, height: 800, insetsTop: 0, insetsRight: 0, hasChart: true })
    const wide = computeLayout({ width: NARROW_BREAKPOINT, height: 800, insetsTop: 0, insetsRight: 0, hasChart: true })
    expect(narrow.chart).toBeNull()
    expect(narrow.panel.w).toBe(NARROW_BREAKPOINT - 1)
    expect(wide.chart).not.toBeNull()
    expect(wide.panel.w).toBeLessThan(NARROW_BREAKPOINT)
  })

  it('底部切换栏和标题栏不会跑到屏幕外', () => {
    for (const [w, h] of [[1280, 840], [390, 844], [760, 600]] as const) {
      const l = computeLayout({ width: w, height: h, insetsTop: 44, insetsRight: 0, hasChart: true })
      expect(l.tabBar.y + l.tabBar.h).toBeLessThanOrEqual(h)
      expect(l.tabBar.x + l.tabBar.w).toBeLessThanOrEqual(w)
      expect(l.pageBar.y).toBe(10 + 44)
    }
  })

  it('浮动属性面板：贴舞台底部，且不超过舞台', () => {
    const l = desk()
    const s = floatingSheet(l.stage, 240)
    expect(s.y + s.h).toBe(840 - 12)
    expect(s.w).toBeLessThanOrEqual(l.stage.w - 24)
    // 内容比舞台还高时被截断，不会顶出屏幕
    const tall = floatingSheet(l.stage, 5000)
    expect(tall.h).toBeLessThanOrEqual(l.stage.h - 120)
  })
})
