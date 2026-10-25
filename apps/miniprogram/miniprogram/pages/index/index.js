// 小程序壳：只做四件事——取 canvas、喂尺寸与安全区、转发触摸、驱动帧循环。
// 其余全部来自 utils/app.js（core + physics + render + ui 的打包产物）。
const { App } = require('../../utils/app.js')

const STORE_KEY = 'model-switch.library.v1'

Page({
  data: {},

  onLoad(query) {
    this.initialToken = query && query.s ? decodeURIComponent(query.s) : ''
  },

  onReady() {
    wx.createSelectorQuery()
      .select('#stage')
      .fields({ node: true, size: true })
      .exec((res) => {
        const info = res && res[0]
        if (!info || !info.node) {
          console.error('[model-switch] 找不到 canvas 节点')
          return
        }
        const canvas = info.node
        const win = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync()
        const dpr = Math.min(win.pixelRatio || 1, 3)
        // 右上角胶囊 + 状态栏：不让它们盖住顶栏和播放键
        let topInset = (win.statusBarHeight || 0) + 2
        let rightInset = 0
        try {
          const menu = wx.getMenuButtonBoundingClientRect()
          if (menu && menu.width > 0) {
            rightInset = Math.max(0, win.windowWidth - menu.left + 6)
            topInset = Math.max(topInset, menu.top)
          }
        } catch (e) {
          // 部分基础库没有这个 API，保持默认安全区
        }

        const width = info.width
        const height = info.height
        canvas.width = Math.round(width * dpr)
        canvas.height = Math.round(height * dpr)
        const ctx = canvas.getContext('2d')
        this.canvas = canvas

        this.app = new App({
          ctx,
          width,
          height,
          dpr,
          insets: { top: topInset, right: rightInset },
          host: {
            share: (token) => {
              this.shareToken = token
            },
            hideShare: true,
            toast: () => {
              // 画布自己会画 toast，别再叠一个原生弹层
            },
            // 建模库 / 我导入的题目都存在小程序本地存储，零后端
            storage: {
              load: () => {
                try {
                  return wx.getStorageSync(STORE_KEY) || null
                } catch (e) {
                  return null
                }
              },
              save: (value) => wx.setStorageSync(STORE_KEY, value),
            },
            askProblem: (done) =>
              this.askText(
                {
                  title: '生成建模',
                  placeholder: '粘贴题干，例如：倾角为30°的斜面，底端接半径为0.5m 的光滑圆弧…',
                  confirmText: '生成',
                },
                (text) => {
                  if (!text) return
                  const r = done(text)
                  // 小程序的原生 modal 关不掉又改不了，失败就再弹一次把原因说清楚
                  if (r && !r.ok) {
                    wx.showModal({
                      title: '这题还不能自动生成',
                      content: r.message,
                      showCancel: false,
                      confirmText: '知道了',
                    })
                  }
                },
              ),
            prompt: (opts, done) =>
              this.askText({ title: opts.title, placeholder: opts.placeholder || '', confirmText: '确定' }, done),
          },
        })

        if (this.initialToken) {
          const ok = this.app.openFromEncoded(this.initialToken)
          if (!ok) wx.showToast({ title: '分享的场景打不开', icon: 'none' })
        }

        this.last = 0
        this.loop()
      })
  },

  loop() {
    const canvas = this.canvas
    if (!canvas) return
    const step = (ts) => {
      if (!this.app) return
      const now = ts / 1000
      const dt = this.last ? Math.min(now - this.last, 0.1) : 0.016
      this.last = now
      this.app.frame(dt, now)
      canvas.requestAnimationFrame(step)
    }
    canvas.requestAnimationFrame(step)
  },

  onTouchStart(e) {
    const t = e.touches && e.touches[0]
    if (t && this.app) this.app.pointerDown(t.x != null ? t.x : t.clientX, t.y != null ? t.y : t.clientY)
  },

  onTouchMove(e) {
    const t = e.touches && e.touches[0]
    if (t && this.app) this.app.pointerMove(t.x != null ? t.x : t.clientX, t.y != null ? t.y : t.clientY)
  },

  onTouchEnd() {
    if (this.app) this.app.pointerUp()
  },

  /**
   * 通用文字输入：小程序没有 DOM 弹层，用带输入框的原生 modal（基础库 2.17.1+）。
   * 题干和文件夹名都走这一个入口，回调拿不到文本就传 null。
   */
  askText(opts, done) {
    wx.showModal({
      title: opts.title,
      editable: true,
      placeholderText: opts.placeholder,
      confirmText: opts.confirmText,
      cancelText: '取消',
      success: (res) => {
        const text = (res.content || '').trim()
        done(res.confirm && text ? text : null)
      },
      fail: () => done(null),
    })
  },

  onShareAppMessage() {
    const token = this.shareToken || ''
    return {
      title: '模型开关 · 把物理题变成能拨的模型',
      path: '/pages/index/index' + (token ? '?s=' + encodeURIComponent(token) : ''),
    }
  },

  onShareTimeline() {
    return {
      title: '模型开关 · 一道题，一张能拨动的模型',
      query: this.shareToken ? 's=' + encodeURIComponent(this.shareToken) : '',
    }
  },
})
