import { App } from '@ui/app'

const canvas = document.getElementById('stage') as HTMLCanvasElement
const boot = document.getElementById('boot')
const ctx = canvas.getContext('2d', { alpha: false })
if (!ctx) throw new Error('Canvas 2D 不可用')

// 存储 key。改名前的旧 key 还要读一次，否则已经存下的建模/组件会「凭空消失」。
const STORE_KEY = 'slogan.library.v1'
const LEGACY_KEY = 'model-switch.library.v1'
// AI 设置单独存：key 是凭据，不该混进会被导出/分享的建模库
const AI_KEY = 'slogan.ai.v1'

let dpr = Math.min(window.devicePixelRatio || 1, 3)
let width = window.innerWidth
let height = window.innerHeight

const app = new App({
  ctx,
  width,
  height,
  dpr,
  host: {
    share: async (token) => {
      const url = location.origin + location.pathname + '#' + token
      try {
        await navigator.clipboard.writeText(url)
        app.toast('链接已复制，发给学生就能打开同一份场景')
      } catch {
        app.toast('链接已生成（在地址栏里）')
      }
      history.replaceState(null, '', url)
    },
    toast: (text) => console.log('[toast]', text),
    ai: {
      load: () => {
        try {
          return localStorage.getItem(AI_KEY)
        } catch {
          return null
        }
      },
      save: (value) => {
        try {
          if (value === null) localStorage.removeItem(AI_KEY)
          else localStorage.setItem(AI_KEY, value)
        } catch {
          /* 隐私模式忽略 */
        }
      },
    },
    // 建模库 / 我导入的题目都存在浏览器本地，零后端
    storage: {
      load: () => localStorage.getItem(STORE_KEY) ?? localStorage.getItem(LEGACY_KEY),
      save: (value) => {
        localStorage.setItem(STORE_KEY, value)
        // 迁完就把旧 key 删掉，免得两份数据各自漂移
        try {
          localStorage.removeItem(LEGACY_KEY)
        } catch {
          /* 隐私模式下可能抛，忽略 */
        }
      },
    },
    askProblem: (done) => {
      void openTextDialog({
        eyebrow: 'PROBLEM → MODEL',
        title: '生成建模',
        sub: '贴一段题干，生成一张能跑、能改的模型。建不了会直说缺什么，不假装能建；生成的模型会自动存进「建模库」。',
        placeholder: '例如：倾角为30°的斜面，底端接半径为0.5m 的光滑圆弧，质量为1kg 的滑块从斜面顶端由静止释放…',
        confirmText: '生成建模',
        multiline: true,
        // 生成失败就留在弹层里显示原因，不关窗
        onSubmit: (text) => done(text),
      })
    },
    prompt: (opts, done) => {
      void openTextDialog({
        eyebrow: 'NEW FOLDER',
        title: opts.title,
        placeholder: opts.placeholder,
        value: opts.value,
        confirmText: '确定',
        multiline: false,
      }).then(done)
    },
  },
})

type DialogOptions = {
  eyebrow: string
  title: string
  sub?: string
  placeholder?: string
  value?: string
  confirmText: string
  multiline?: boolean
  /** 返回结果：失败就把原因留在弹层里，不关闭 */
  onSubmit?: (text: string) => { ok: boolean; message: string }
}

/** 通用输入弹层（题干 / 文件夹名）：返回文本，取消返回 null */
function openTextDialog(opts: DialogOptions): Promise<string | null> {
  return new Promise((resolve) => {
    const wrap = document.createElement('div')
    wrap.style.cssText =
      'position:fixed;inset:0;z-index:60;background:rgba(35,39,47,.34);display:flex;align-items:center;justify-content:center;padding:20px;font-family:inherit;'
    const card = document.createElement('div')
    card.style.cssText =
      'width:min(620px,94vw);background:#fff;border-radius:18px;padding:22px;box-shadow:0 18px 60px rgba(35,39,47,.22);color:#23272f;'
    card.innerHTML = `
      <div style="font:700 9px ui-monospace,'SF Mono',Menlo,monospace;letter-spacing:2px;color:#9aa1ab;margin-bottom:8px">${opts.eyebrow}</div>
      <div style="font:600 22px 'Songti SC','Noto Serif SC',SimSun,serif;margin-bottom:6px;color:#1d2025">${opts.title}</div>
      ${opts.sub ? `<div style="font-size:12px;color:#6b7280;line-height:1.7;margin-bottom:12px">${opts.sub}</div>` : ''}
      <div id="dlg-msg" style="min-height:16px;font-size:11.5px;color:#c0392b;margin:0 0 8px"></div>
      <div style="display:flex;align-items:center;justify-content:flex-end;gap:10px">
        <button id="dlg-cancel" style="border:0;background:#f2f4f7;color:#4b5563;border-radius:10px;padding:9px 16px;font:inherit;cursor:pointer">取消</button>
        <button id="dlg-ok" style="border:0;background:#dd5735;color:#fff;border-radius:10px;padding:9px 18px;font:inherit;font-weight:600;cursor:pointer">${opts.confirmText}</button>
      </div>`
    const input = document.createElement(opts.multiline ? 'textarea' : 'input') as HTMLTextAreaElement | HTMLInputElement
    input.id = 'dlg-input'
    input.placeholder = opts.placeholder ?? ''
    if (opts.value) input.value = opts.value
    input.style.cssText = opts.multiline
      ? 'width:100%;height:150px;box-sizing:border-box;border:1px solid #dfe3ea;border-radius:12px;padding:12px;font:13px/1.6 inherit;resize:vertical;outline:none;margin-bottom:12px'
      : 'width:100%;box-sizing:border-box;border:1px solid #dfe3ea;border-radius:12px;padding:10px 12px;font:13px/1.5 inherit;outline:none;margin-bottom:12px'
    // 输入框插在提示语和按钮之间
    const msg = card.querySelector('#dlg-msg') as HTMLDivElement
    card.insertBefore(input, msg.nextSibling)
    wrap.appendChild(card)
    document.body.appendChild(wrap)

    const close = (value: string | null) => {
      document.removeEventListener('keydown', onKey)
      wrap.remove()
      resolve(value)
    }
    const submit = () => {
      const text = input.value.trim()
      if (!text) {
        msg.textContent = opts.multiline ? '至少粘一句完整的话' : '名字不能为空'
        input.focus()
        return
      }
      if (opts.onSubmit) {
        const r = opts.onSubmit(text)
        if (!r.ok) {
          msg.textContent = r.message
          input.focus()
          return
        }
        close(text)
        return
      }
      close(text)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close(null)
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') submit()
    }
    document.addEventListener('keydown', onKey)
    ;(card.querySelector('#dlg-cancel') as HTMLButtonElement).onclick = () => close(null)
    ;(card.querySelector('#dlg-ok') as HTMLButtonElement).onclick = submit
    wrap.addEventListener('click', (e) => {
      if (e.target === wrap) close(null)
    })
    input.focus()
  })
}

function applySize(): void {
  width = window.innerWidth
  height = window.innerHeight
  dpr = Math.min(window.devicePixelRatio || 1, 3)
  canvas.width = Math.round(width * dpr)
  canvas.height = Math.round(height * dpr)
  canvas.style.width = width + 'px'
  canvas.style.height = height + 'px'
  ctx!.setTransform(dpr, 0, 0, dpr, 0, 0)
  app.resize(width, height)
}

applySize()

// 分享链接优先
const hash = location.hash.replace(/^#/, '')
if ((hash.startsWith('s1.') || hash.startsWith('p1.')) && app.openFromEncoded(hash)) {
  app.toast('已打开分享的场景')
}

// 指针
let captured = false
canvas.addEventListener('pointerdown', (e) => {
  canvas.setPointerCapture(e.pointerId)
  captured = true
  app.pointerDown(e.clientX, e.clientY)
  canvas.style.cursor = 'default'
})
canvas.addEventListener('pointermove', (e) => {
  app.pointerMove(e.clientX, e.clientY)
  if (!captured) {
    const hit = (app as unknown as { ui?: { find?: (x: number, y: number) => { cursor?: string } | undefined } }).ui?.find?.(
      e.clientX,
      e.clientY,
    )
    canvas.style.cursor = hit?.cursor ?? 'default'
  }
})
function endPointer(e: PointerEvent): void {
  if (captured) {
    try {
      canvas.releasePointerCapture(e.pointerId)
    } catch {
      /* ignore */
    }
  }
  captured = false
  app.pointerUp()
}
canvas.addEventListener('pointerup', endPointer)
canvas.addEventListener('pointercancel', endPointer)

// 滚轮缩放
canvas.addEventListener(
  'wheel',
  (e) => {
    e.preventDefault()
    app.wheel(e.deltaY, e.clientX, e.clientY)
  },
  { passive: false },
)

// 键盘
window.addEventListener('keydown', (e) => {
  if (e.key === ' ') e.preventDefault()
  app.key(e.key, e.ctrlKey || e.metaKey, e.shiftKey)
})

// 双指捏合
let pinch: { distance: number; x: number; y: number } | null = null
const active = new Map<number, { x: number; y: number }>()
canvas.addEventListener('pointerdown', (e) => active.set(e.pointerId, { x: e.clientX, y: e.clientY }))
canvas.addEventListener('pointerup', (e) => active.delete(e.pointerId))
canvas.addEventListener('pointercancel', (e) => active.delete(e.pointerId))
canvas.addEventListener('pointermove', (e) => {
  if (!active.has(e.pointerId)) return
  active.set(e.pointerId, { x: e.clientX, y: e.clientY })
  if (active.size === 2) {
    const [a, b] = [...active.values()]
    if (!a || !b) return
    const distance = Math.hypot(a.x - b.x, a.y - b.y)
    const cx = (a.x + b.x) / 2
    const cy = (a.y + b.y) / 2
    if (pinch) {
      if (pinch.distance > 0) app.camera.zoomAt(cx, cy, distance / pinch.distance)
    }
    pinch = { distance, x: cx, y: cy }
  } else {
    pinch = null
  }
})

window.addEventListener('resize', applySize)
window.addEventListener('orientationchange', () => setTimeout(applySize, 120))

// 主循环
let last = performance.now()
function loop(now: number): void {
  const dt = (now - last) / 1000
  last = now
  app.frame(dt, now / 1000)
  requestAnimationFrame(loop)
}
requestAnimationFrame((t) => {
  last = t
  loop(t)
})

if (boot) {
  boot.classList.add('hide')
  setTimeout(() => boot.remove(), 400)
}

// 调试入口
;(window as unknown as { app: App }).app = app
