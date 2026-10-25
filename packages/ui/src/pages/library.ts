/** 模型页（收藏夹）：文件夹、移动、场景预览。 */
import { THEME, rgba, roundRect } from '@render/theme'
import { Camera } from '@render/camera'
import { renderScene } from '@render/renderer'
import { countIn, folderList, formatBytes, libraryBytes, modelsIn, type LibraryModel } from '@core/library'
import { clamp } from '@core/math'
import { inRect } from '../widgets'
import type { Rect } from '../widgets'
import { sceneBoundsPoints } from '../scene-bounds'
import type { PagesHost } from './host'
import { renderTabs, shortDate } from './shared'

export function renderLibrary(h: PagesHost): void {

  const W = h.width
  const H = h.height
  const ctx = h.ctx
  ctx.save()
  ctx.fillStyle = THEME.paper
  ctx.fillRect(0, 0, W, H)
  ctx.restore()

  const bar = h.pageBarRect()
  const narrow = W < 560
  h.ui.text('SLOGAN · 收藏夹', bar.x, bar.y + 12, {
    size: 8.5,
    weight: 700,
    color: THEME.inkFaint,
    mono: true,
    tracking: 1.3,
  })
  h.ui.text('建模库', bar.x, bar.y + 36, { size: narrow ? 22 : 26, weight: 600, serif: true })
  h.ui.text(
    `${h.library.models.length} 个模型 · ${formatBytes(libraryBytes(h.library))}`,
    bar.x + (narrow ? 76 : 92),
    bar.y + 36,
    { size: 10, color: THEME.inkFaint, maxWidth: W - 220 },
  )
  const ctaW = narrow ? 96 : 108
  h.ui.pillButton({ x: bar.x + bar.w - ctaW, y: bar.y + 10, w: ctaW, h: 38 }, '+ 文件夹', {
    size: narrow ? 10.5 : 11,
    weight: 600,
    onClick: () => h.newFolder(),
  })

  // 文件夹 chips
  const folders = folderList(h.library)
  const chipsY = bar.y + 60
  let cx = bar.x
  let cy = chipsY
  let chipRows = 1
  for (const f of folders) {
    const count = countIn(h.library, f.id)
    const label = `${f.name} ${count}`
    const w = Math.min(120, 26 + label.length * 10)
    if (cx + w > bar.x + bar.w && cx > bar.x) {
      cx = bar.x
      cy += 32
      chipRows++
    }
    h.ui.pillButton({ x: cx, y: cy, w, h: 28 }, label, {
      active: h.activeFolderId === f.id,
      size: 10,
      weight: 600,
      onClick: () => {
        h.activeFolderId = f.id
        h.libraryScroll = 0
      },
    })
    cx += w + 6
  }

  // 模型网格
  const listTop = chipsY + chipRows * 32 + 6
  const listBottom = h.tabBarRect().y - 8
  const cols = W >= 1080 ? 4 : W >= 780 ? 3 : 2
  const gap = narrow ? 8 : 12
  const cardW = (bar.w - gap * (cols - 1)) / cols
  const cardH = cardW * 0.6 + 44
  const models = modelsIn(h.library, h.activeFolderId)
  const rows = Math.ceil(models.length / cols)
  const contentH = rows * (cardH + gap)
  h.libraryMaxScroll = Math.max(0, contentH - (listBottom - listTop))
  h.libraryScroll = clamp(h.libraryScroll, -h.libraryMaxScroll, 0)

  ctx.save()
  ctx.beginPath()
  ctx.rect(bar.x - 4, listTop - 4, bar.w + 8, listBottom - listTop + 8)
  ctx.clip()
  models.forEach((m, i) => {
    const col = i % cols
    const row = Math.floor(i / cols)
    const r: Rect = {
      x: bar.x + col * (cardW + gap),
      y: listTop + row * (cardH + gap) + h.libraryScroll,
      w: cardW,
      h: cardH,
    }
    if (r.y > listBottom || r.y + r.h < listTop - 8) return
    renderModelCard(h, r, m)
  })
  ctx.restore()

  if (models.length === 0) {
    const empty = h.library.models.length === 0
    h.ui.text(empty ? '建模库还是空的' : '这个文件夹是空的', W / 2, listTop + 44, {
      size: 13,
      weight: 600,
      color: THEME.inkSoft,
      align: 'center',
    })
    h.ui.text(
      empty ? '去「题库」点一道题，生成后会自动存到这里' : '点模型卡片右上角的 ⋯ 可以把它移过来',
      W / 2,
      listTop + 68,
      { size: 10, color: THEME.inkFaint, align: 'center' },
    )
  }

  renderTabs(h)
  if (h.moveModelId) renderMoveSheet(h)
}

export function renderModelCard(h: PagesHost, r: Rect, m: LibraryModel): void {

  const hover = h.width >= 700 && inRect(r, h.ui.pointer.x, h.ui.pointer.y)
  h.ui.card(r, {
    radius: 12,
    stroke: hover ? rgba(THEME.accent, 0.5) : THEME.hairline,
    shadow: hover,
  })
  const pr: Rect = { x: r.x + 6, y: r.y + 6, w: r.w - 12, h: r.h - 44 }
  const ctx = h.ctx
  ctx.save()
  roundRect(ctx, pr.x, pr.y, pr.w, pr.h, 8)
  ctx.clip()
  ctx.fillStyle = THEME.paper
  ctx.fillRect(pr.x, pr.y, pr.w, pr.h)
  ctx.translate(pr.x, pr.y)
  const cam = new Camera()
  cam.setViewport(pr.w, pr.h)
  const scene = m.scene
  cam.plane = scene.plane
  cam.elevation = scene.world.view.elevation
  cam.azimuth = scene.world.view.azimuth
  cam.scale = scene.world.view.scale
  cam.center = { ...scene.world.view.center }
  cam.update()
  cam.fit(sceneBoundsPoints(scene, false), 8)
  renderScene({
    ctx,
    scene,
    camera: cam,
    state: null,
    showVectors: false,
    showGuides: false,
    showTrails: false,
    showLabels: false,
  })
  ctx.restore()

  h.ui.text(m.title, r.x + 10, r.y + r.h - 26, {
    size: 11.5,
    weight: 650,
    maxWidth: r.w - 40,
  })
  const folder = folderList(h.library).find((f) => f.id === m.folderId)?.name ?? '未分类'
  h.ui.text(`${folder} · ${shortDate(m.updatedAt)}`, r.x + 10, r.y + r.h - 12, {
    size: 8.5,
    color: THEME.inkFaint,
    maxWidth: r.w - 40,
  })

  // ⋯ 菜单（移动 / 删除）
  const dotsX = r.x + r.w - 26
  const dotsY = r.y + r.h - 30
  ctx.save()
  ctx.fillStyle = hover ? THEME.ink : THEME.inkFaint
  for (let i = 0; i < 3; i++) {
    ctx.beginPath()
    ctx.arc(dotsX + i * 5, dotsY, 1.4, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.restore()
  h.ui.add({
    id: `move:${m.id}`,
    rect: { x: dotsX - 6, y: dotsY - 12, w: 26, h: 24 },
    cursor: 'pointer',
    onClick: () => {
      h.moveModelId = m.id
    },
  })
  h.ui.add({
    id: `model:${m.id}`,
    rect: { x: r.x, y: r.y, w: r.w - 30, h: r.h },
    cursor: 'pointer',
    onClick: () => h.openModel(m.id),
  })
}

/** 移动模型：选文件夹（像把歌拖进歌单） */
export function renderMoveSheet(h: PagesHost): void {

  const W = h.width
  const H = h.height
  const model = h.library.models.find((m) => m.id === h.moveModelId)
  if (!model) {
    h.moveModelId = null
    return
  }
  const ctx = h.ctx
  ctx.save()
  ctx.fillStyle = 'rgba(29,32,37,0.42)'
  ctx.fillRect(0, 0, W, H)
  ctx.restore()
  h.ui.add({ id: 'move:backdrop', rect: { x: 0, y: 0, w: W, h: H }, onClick: () => { h.moveModelId = null } })

  const folders = folderList(h.library)
  const w = Math.min(W - 28, 380)
  const rowH = 42
  const sheetH = 62 + folders.length * rowH + 54
  const r: Rect = { x: (W - w) / 2, y: (H - sheetH) / 2, w, h: sheetH }
  h.ui.card(r, { radius: 16, fill: THEME.card, stroke: THEME.hairline })
  h.ui.add({ id: 'move:card', rect: r })

  h.ui.text('移到文件夹', r.x + 16, r.y + 22, { size: 12, weight: 700 })
  h.ui.text(model.title, r.x + 16, r.y + 42, { size: 9.5, color: THEME.inkFaint, maxWidth: r.w - 32 })
  h.ui.iconButton({ x: r.x + r.w - 42, y: r.y + 8, w: 30, h: 30 }, 'close', {
    onClick: () => {
      h.moveModelId = null
    },
  })

  folders.forEach((f, i) => {
    const y = r.y + 58 + i * rowH
    const active = model.folderId === f.id
    const rr: Rect = { x: r.x + 10, y, w: r.w - 20, h: rowH - 4 }
    if (active) {
      ctx.save()
      ctx.fillStyle = THEME.accentSoft
      roundRect(ctx, rr.x, rr.y, rr.w, rr.h, 9)
      ctx.fill()
      ctx.restore()
    }
    h.ui.text(f.name, rr.x + 12, rr.y + rr.h / 2, {
      size: 11,
      weight: active ? 700 : 500,
      color: active ? THEME.accent : THEME.ink,
    })
    h.ui.text(String(countIn(h.library, f.id)), rr.x + rr.w - 12, rr.y + rr.h / 2, {
      size: 10,
      color: THEME.inkFaint,
      align: 'right',
      mono: true,
    })
    h.ui.add({
      id: `move:to:${f.id}`,
      rect: rr,
      cursor: 'pointer',
      onClick: () => h.moveTo(model.id, f.id),
    })
  })

  const footY = r.y + sheetH - 46
  h.ui.pillButton({ x: r.x + 12, y: footY, w: 104, h: 32 }, '+ 新建文件夹', {
    size: 10,
    weight: 600,
    onClick: () => h.newFolder(),
  })
  h.ui.pillButton({ x: r.x + r.w - 100, y: footY, w: 88, h: 32 }, '删除', {
    size: 10,
    weight: 600,
    onClick: () => h.removeModel(model.id),
  })
}