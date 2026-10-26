 /**
 * 应用主体：一?canvas 内的全部 UI（无 DOM 依赖，小程序壳可复用同一份）? *
 * 布局：顶?· 左侧工具?· 底部参数?/ 属性面?· 右上观测?· 场景选择页? * 输入：宿主把 pointer / wheel / key 归一化成像素坐标传进来? */
import { Camera } from '@render/camera'
import { pickBody, renderScene, type BodyVisual, type VisualState } from '@render/renderer'
import { drawInk, inkHitTest, shouldSample, type InkStroke } from '@render/ink'
import { THEME, font, rgba, roundRect } from '@render/theme'
import { bodyAABB, pointInShape, renderGeometries, shapeArea } from '@core/shapes'
import { clamp, rot, simplifyPath, type Vec2 } from '@core/math'
import {
  type Body,
  type Anchor,     
  type Constraint,
  type Criterion,
  type ForceDef,
  type Field,
  type GasSystem,
  type Region,
  type Shape,
  type Scene,
  applyEdits,
  recordBodyEdit,
  recordConstraintEdit,
  cloneScene,
  findBody,
  findMaterial,
  setAtPath,
} from '@core/scene'
import { blankScene, presetById } from '@core/presets'
import { buildChain, defaultChain, stageLabel, type ChainStage, type ChainStageKind } from '@core/chain'
import { applySnap, findSnap } from '@core/snap'
import { describeRecognized, recognizeStroke } from '@core/recognize'
import { decodeShare, encodeShare } from '@core/serialize'
import { parseProblem } from '@core/problem'
import { sceneFromPlan } from '@core/ai-plan'
import { anchorLocal } from '@core/ports'
import { DEFAULT_AI_CONFIG, aiConfigReady, askPlan, type AiConfig } from '@core/ai-client'
import { componentSelection, extractComponent, instantiateComponent, type SavedComponent } from '@core/components'
import { sceneParams } from '@core/params'
import { BANK_PROBLEMS, bankCategoryName, bankStats, makeMineProblem, visibleCategories, type BankProblem } from '@core/bank'
import {
  UNSORTED,
  addModel,
  addProblem,
  countIn,
  addComponent,
  clearModels,
  clearProblems,
  deleteComponent,
  renameComponent,
  createFolder,
  deleteModel,
  deleteProblem,
  emptyLibrary,
  folderList,
  formatBytes,
  libraryBytes,
  modelsIn,
  moveModel,
  parseLibrary,
  serializeLibrary,
  updateModel,
  type Library,
  type LibraryModel,
} from '@core/library'
import { assumptionToggles, cycleAssumption } from '@core/assumptions'
import { Simulation, runCriterion } from '@physics/simulation'
import { UI, inRect, type HitRegion, type Rect } from './widgets'
import { sceneBoundsPoints } from './scene-bounds'
import { computeLayout, floatingSheet, type EditorLayout } from './editor/layout'
import { FIELD_B, FIELD_E, bodyFromRecognized, fieldDraftFromDrag, scaleShape } from './editor/drawing'
import {
  renderBank as renderBankPage,
  renderLibrary as renderLibraryPage,
  renderUser as renderUserPage,
  renderMoveSheet as renderMoveSheetPage,
  renderConfirm as renderConfirmPage,
  askConfirm as askConfirmPage,
  openProblemDetail as openProblemDetailPage,
  allProblems as allProblemsOf,
  modelForProblem as modelForProblemOf,
  type ConfirmState,
} from './pages'
import { drawIcon, type IconName } from './icons'
import { drawChart, drawEnergyBar, type ChartSample, type ChartSeries } from './chart'

export type AppHost = {
  /** 拿到的是可序列化的分享 token（不是完整 URL），宿主自己拼链接 */
  share?: (token: string) => void
  /**
   * 打开「生成建模」输入框：壳负责弹输入，拿到题干后回调。
   * `done` 返回生成结果——壳可以据此**不关闭弹层**、把失败原因显示在原地（别让人贴完才知道建不了）。
   */
  askProblem?: (done: (text: string | null) => { ok: boolean; message: string }) => void
  /** 输入一行文字（新建文件夹）。壳没有输入能力就不实现 */
  prompt?: (opts: { title: string; placeholder?: string; value?: string }, done: (text: string | null) => void) => void
  /** 本地持久化：不实现就只在内存里活着（建模库、我导入的题目都存这里） */
  storage?: { load: () => string | null; save: (value: string) => void }
  /**
   * AI 设置（API key / 模型 / 端点）的本地存储。
   * **和建模库分开存**：key 是凭据，不该混进会被分享/导出的数据里。
   * 不实现 → AI 入口显示「当前壳不支持」。
   */
  ai?: { load: () => string | null; save: (value: string | null) => void }
  /** 小程序右上角有原生胶囊菜单，顶栏不再放分享键 */
  hideShare?: boolean
  toast?: (text: string) => void
  baseUrl?: string
}

export type AppOptions = {
  ctx: CanvasRenderingContext2D
  width: number
  height: number
  /** 设备像素比：画布物理像素 = CSS 像素 × dpr */
  dpr?: number
  /** 平台安全区：小程序的状态栏 + 右上角胶囊会盖住顶栏 */
  insets?: { top?: number; right?: number }
  host?: AppHost
}

type Tool = 'select' | 'pen' | 'fieldE' | 'fieldB' | 'connect' | 'ink' | 'eraser' | 'hand'

/** 本地存的 AI 设置：坏数据就当没配，别让一段脏 JSON 把整个 App 弄崩 */
function parseAiConfig(raw: string | null): AiConfig | null {
  if (!raw) return null
  try {
    const o = JSON.parse(raw) as Partial<AiConfig>
    if (!o || typeof o.key !== 'string' || !o.key.trim()) return null
    return {
      key: o.key.trim(),
      model: typeof o.model === 'string' && o.model.trim() ? o.model.trim() : DEFAULT_AI_CONFIG.model,
      endpoint: typeof o.endpoint === 'string' && o.endpoint.trim() ? o.endpoint.trim() : DEFAULT_AI_CONFIG.endpoint,
    }
  } catch {
    return null
  }
}

type DragState =
  | { kind: 'pan'; lastX: number; lastY: number }
  | { kind: 'orbit'; lastX: number; lastY: number }
  | { kind: 'move'; bodyId: string; offset: Vec2; moved: boolean }
  | { kind: 'rotate'; bodyId: string; startAngle: number; startPointer: number; moved: boolean }
  | { kind: 'velocity'; bodyId: string; moved: boolean }
  | { kind: 'erase'; moved: boolean }
  | { kind: 'ink' }
  | { kind: 'draw'; start: Vec2; current: Vec2; tool: Tool; points?: Vec2[] }
  | { kind: 'scale'; bodyId: string; base: Body; center: Vec2; startDist: number }



const SPEEDS = [0.5, 1, 2]
/**
 * 工具栏只剩「笔」和几种手势，没有组件按钮：
 * 画什么，什么就是组件（识别 + 物理性质），见 docs/DRAWING.md。
 */
const TOOLS: Array<{ id: Tool; icon: IconName; label: string }> = [
  { id: 'select', icon: 'select', label: '选择 / 拖动' },
  { id: 'pen', icon: 'pen', label: '手绘（自动规整）' },
  { id: 'fieldE', icon: 'field', label: '电场（拖一块区域）' },
  { id: 'fieldB', icon: 'fieldB', label: '磁场（拖一块区域）' },
  { id: 'connect', icon: 'link', label: '连接（绳）' },
  { id: 'ink', icon: 'ink', label: '批注（讲课用）' },
  { id: 'eraser', icon: 'eraser', label: '橡皮擦' },
  { id: 'hand', icon: 'hand', label: '平移' },
]

function shapeLength(shape: Extract<Shape, { type: 'polyline' | 'polygon' }>): number {
  if (shape.type === 'polyline') {
    let total = 0
    for (let i = 1; i < shape.points.length; i++) {
      total += Math.hypot(shape.points[i]!.x - shape.points[i - 1]!.x, shape.points[i]!.y - shape.points[i - 1]!.y)
    }
    return total
  }
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
  for (const p of shape.points) { minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y) }
  return Math.max(maxX - minX, maxY - minY)
}

export class App {
  readonly ctx: CanvasRenderingContext2D
  private host: AppHost
  readonly ui: UI
  camera = new Camera()
  width: number
  height: number
  dpr: number
  insets: { top: number; right: number }

  mode: 'user' | 'bank' | 'library' | 'scene' = 'bank'
  doc: Scene = blankScene()
  presetId: string | null = null

  private simA: Simulation | null = null

  playing = false
  speed = 1
  private accum = 0
  showChart = true
  showForces = true
  private showLabels = true
  selectedId: string | null = null
  tool: Tool = 'select'

  /**
   * 批注墨迹：老师的临时痕迹，**不进 Scene**、不参与物理、不影响分享串。
   * 点存世界坐标、线宽存屏幕像素（见 docs/DRAWING.md §6）。
   * 切场景 / 回选择页时清空。
   */
  ink: InkStroke[] = []

  private trailsA: Record<string, Vec2[]> = {}
  private chartA: Record<string, ChartSample[]> = {}
  private lastRecordT = -1

  private history: Scene[] = []
  private future: Scene[] = []

  private pointer = { x: 0, y: 0, down: false }
  private activeRegion: HitRegion | null = null
  private pendingClick: { region: HitRegion; x0: number; y0: number } | null = null
  /** 按下物体时先记下，松手（没拖动）才真正选中——否则面板弹开会挪相机、拖拽会 */
  private pendingSelectId: string | null = null
  private drag: DragState | null = null
  private pageDrag: { lastY: number } | null = null
  bankScroll = 0
  bankMaxScroll = 0
  libraryScroll = 0
  libraryMaxScroll = 0
  /** 本地建模库 + 我导入的题目（零后端，存在宿主 storage 里） */
  library: Library = emptyLibrary()
  /** 当前打开的画布对应库里哪个模型（离开时写回） */
  currentModelId: string | null = null
  bankCategory = 'all'
  activeFolderId = UNSORTED
  moveModelId: string | null = null
  /** 题库里打开的那道题（先看完整题干，再决定建不建模） */
  problemOpen: string | null = null
  problemScroll = 0
  problemMaxScroll = 0
  /** 二次确认（清空之类的破坏性操作） */
  confirm: { title: string; message: string; okLabel: string; onOk: () => void } | null = null
  private toastText = ''
  private toastUntil = 0
  private now = 0
  /** 当前场景是「题目 → 建模」生成的初稿：状态条提示可以直接改 */
  private fromProblem = false
  private lastTap: { id: string; t: number; wx: number; wy: number } | null = null
  /** 连接工具：先?A 记下锚点，再?B 生成 */
  private linkFrom: { bodyId: string; local: Vec2 } | null = null
  private selectedConstraintId: string | null = null
  private selectedForceId: string | null = null
  private showWorld = false
  private chainOpen = false
  private chainStages: ChainStage[] = defaultChain()
  private chainSelected = 0
  private chainSeq = 0
  /** 左侧参数面板的滚动（窄屏装不下时） */
  private panelScroll = 0
  private panelMaxScroll = 0
  private panelDrag: { lastY: number } | null = null
  /** 选中的场（拖出来的那块）；选中时左侧面板显示场强/方向 */
  selectedFieldId: string | null = null
  /** 组件库面板（从场景里存下来的组件） */
  private componentsOpen = false
  /** AI 设置（key 只在本机）；null = 没配，生成走规则解析 */
  private aiConfig: AiConfig | null = null
  /** AI 设置面板是否打开 */
  private aiOpen = false
  /** 正在等 AI 返回（防重复点） */
  private aiBusy = false

  constructor(opts: AppOptions) {
    this.ctx = opts.ctx
    this.width = opts.width
    this.height = opts.height
    this.dpr = opts.dpr ?? 1
    this.insets = { top: opts.insets?.top ?? 0, right: opts.insets?.right ?? 0 }
    this.host = opts.host ?? {}
    this.ui = new UI(opts.ctx)
    this.camera.setViewport(this.width, this.height)
    try {
      this.library = parseLibrary(this.host.storage?.load?.() ?? null)
    } catch {
      this.library = emptyLibrary()
    }
    this.aiConfig = parseAiConfig(this.host.ai?.load?.() ?? null)
  }

  // -------------------------------------------------------------------------
  // 生命周期
  // -------------------------------------------------------------------------

  resize(width: number, height: number): void {
    this.width = width
    this.height = height
    this.camera.setViewport(width, height)
    if (this.mode === 'scene') this.fitCamera()
  }

  frame(dt: number, now: number): void {
    this.now = now
    this.ui.pointer = { x: this.pointer.x, y: this.pointer.y }
    this.ui.pointerDown = this.pointer.down
    if (this.mode === 'scene') {
      if (this.playing) this.advance(dt)
      this.checkFinished()
    }
    this.ui.reset()
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0)
    this.ctx.fillStyle = THEME.paper
    this.ctx.fillRect(0, 0, this.width, this.height)
    if (this.mode === 'user') this.renderUser()
    else if (this.mode === 'bank') this.renderBank()
    else if (this.mode === 'library') this.renderLibrary()
    else this.renderSceneMode()
    // AI 设置是全局弹层：哪个页面都能打开，画在所有内容之上
    if (this.aiOpen) this.renderAiSheet()
    if (this.toastText && now < this.toastUntil) {
      // 画布上放在图表上方，题库/建模库页贴着底部切换栏
      const chart = this.chartRect()
      const dockOpen = !!(this.selectedId || this.selectedConstraintId || this.showWorld)
      const toastY =
        this.mode === 'scene'
          ? Math.min(chart ? chart.y : this.stageRect().y + this.stageRect().h, dockOpen ? this.dockRect().y : Infinity) - 28
          : this.tabBarRect().y - 30
      this.ui.toast(this.toastText, this.width / 2, toastY)
    }
    this.ui.hoverId = null
  }

  openFromEncoded(text: string): boolean {
    try {
      const scene = decodeShare(text)
      this.loadScene(scene, null)
      return true
    } catch {
      return false
    }
  }

  /** 无渲染快进：自动化测?演示用，不受 rAF 节流影响 */
  fastForward(seconds: number): void {
    const n = Math.max(1, Math.round(seconds * 60))
    const was = this.playing
    this.playing = true
    for (let i = 0; i < n; i++) this.advance(1 / 60)
    this.playing = was
  }

  private advance(dt: number): void {
    const step = this.doc.world.timeStep
    this.accum += Math.min(dt, 0.08) * this.speed
    let n = 0
    const cap = 900
    while (this.accum >= step && n < cap) {
      this.simA?.step()
      this.accum -= step
      n++
    }
    if (n >= cap) this.accum = 0
    if (n > 0) this.record()
  }

  private checkFinished(): void {
    if (!this.playing) return
    const dur = this.doc.world.duration
    const t = this.simA?.state.t ?? 0
    if (dur !== undefined && t >= dur - 1e-9) {
      this.playing = false
      this.accum = 0
    }
  }

  // -------------------------------------------------------------------------
  // 场景装载 / 重建
  // -------------------------------------------------------------------------

  loadPreset(id: string): void {
    const preset = presetById(id)
    if (!preset) return
    const scene = preset.build()
    scene.meta.preset = id
    preset.layout?.(scene)
    this.loadScene(scene, id)
  }

  loadBlank(): void {
    this.loadScene(blankScene(), null)
  }

  loadScene(scene: Scene, presetId: string | null): void {
    this.toastText = ''
    this.toastUntil = 0
    this.fromProblem = false
    // 批注是「这一张图上的临时痕迹」，换场景就清掉（不进 Scene，见 docs/DRAWING.md §6）
    this.ink = []
    this.doc = cloneScene(scene)
    this.presetId = presetId ?? (this.doc.meta.preset && presetById(this.doc.meta.preset) ? this.doc.meta.preset : null)
    if (this.presetId) {
      presetById(this.presetId)?.layout?.(this.doc)
      applyEdits(this.doc)
    }
    this.mode = 'scene'
    // 图表默认收起：先让场景当主角，顶栏图表键随时打开
    this.showChart = false
    this.selectedId = null
    this.selectedFieldId = null
    this.history = []
    this.future = []
    this.playing = false
    this.accum = 0
    this.selectedConstraintId = null
    this.showWorld = false
    this.chainOpen = false
    this.tool = 'select'
    this.applyCamera()
    this.rebuild()
  }

  private applyCamera(): void {
    const cam = this.camera
    const v = this.doc.world.view
    cam.setViewport(this.width, this.height)
    cam.plane = this.doc.plane
    cam.elevation = v.elevation
    cam.azimuth = v.azimuth
    cam.scale = v.scale
    cam.center = { ...v.center }
    cam.zoom = 1
    cam.pan = { x: 0, y: 0 }
    cam.update()
    this.fitCamera()
  }

  private fitCamera(): void {
    const cam = this.camera
    const v = this.doc.world.view
    cam.plane = this.doc.plane
    cam.elevation = v.elevation
    cam.azimuth = v.azimuth
    cam.zoom = 1
    cam.pan = { x: 0, y: 0 }
    const pan = this.viewPan()
    if (v.fit === false) {
      cam.scale = clamp(v.scale, 0.05, 2000)
      cam.center = { ...v.center }
      cam.pan = pan
      cam.update()
      return
    }
    cam.update()
    // 辅助线不参与取景：它常常比场景本身宽，会把主体挤
const pts = sceneBoundsPoints(this.doc, false)
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
    for (const p of pts) {
      minX = Math.min(minX, p.x)
      maxX = Math.max(maxX, p.x)
      minY = Math.min(minY, p.y)
      maxY = Math.max(maxY, p.y)
    }
    // 取景只按「舞台」算：左边是参数面板，底部是图表
    const st = this.stageRect()
    const chart = this.chartRect()
    const availW = Math.max(180, st.w - 72)
    const availH = Math.max(180, (chart ? chart.y : st.y + st.h) - 110)
    const uv = [
      { x: minX, y: minY },
      { x: maxX, y: minY },
      { x: maxX, y: maxY },
      { x: minX, y: maxY },
    ].map((p) => cam.toUV(p, 0))
    const du = Math.max(...uv.map((p) => p.u)) - Math.min(...uv.map((p) => p.u))
    const dv = Math.max(...uv.map((p) => p.v)) - Math.min(...uv.map((p) => p.v))
    const fitScale = Math.min(availW / Math.max(du, 0.2), availH / Math.max(dv, 0.2))
    // 空白画布只有地面时，别按 5m 的默认范围缩太小（手机上会小到看不清
const onlyGround = !this.doc.bodies.some((b) => b.id !== 'ground')
    cam.scale = onlyGround
      ? this.width < 560
        ? 110
        : 235
      : clamp(Math.min(v.scale * 1.8, fitScale), 30, 460)
    cam.center = { x: (minX + maxX) / 2, y: (minY + maxY) / 2 }
    // 相机偏到舞台中心（左边面板、底部图表都不算可视区）
    cam.pan = pan
    cam.update()
  }

  private rebuild(): void {
    this.simA = new Simulation(this.doc)
    this.clearRecords()
    this.accum = 0
  }

  private clearRecords(): void {
    this.trailsA = {}
    this.chartA = {}
    this.lastRecordT = -1
  }

  reset(): void {
    if (this.presetId) {
      presetById(this.presetId)?.layout?.(this.doc)
      applyEdits(this.doc)
    }
    this.rebuild()
    this.accum = 0
  }

  togglePlay(): void {
    if (!this.simA) return
    const dur = this.doc.world.duration
    if (!this.playing && dur !== undefined && this.simA.state.t >= dur - 1e-6) {
      this.rebuild()
      this.playing = true
      return
    }
    this.playing = !this.playing
  }

  private record(): void {
    this.recordSim(this.simA, this.trailsA, this.chartA)
  }

  private recordSim(
    sim: Simulation | null,
    trails: Record<string, Vec2[]>,
    charts: Record<string, ChartSample[]>,
  ): void {
    if (!sim) return
    const t = sim.state.t
    for (const obs of this.doc.observers) {
      if (obs.kind === 'trail') {
        const b = sim.state.bodies[obs.bodyId]
        if (!b) continue
        const arr = trails[obs.bodyId] ?? (trails[obs.bodyId] = [])
        arr.push({ x: b.x, y: b.y })
        if (arr.length > obs.len) arr.splice(0, arr.length - obs.len)
      } else if (obs.kind === 'chart') {
        for (const s of obs.series) {
          const b = sim.state.bodies[s.bodyId]
          if (!b) continue
          const arr = charts[s.bodyId] ?? (charts[s.bodyId] = [])
          arr.push({
            t,
            x: b.x,
            y: b.y,
            v: Math.hypot(b.vx, b.vy),
            a: Math.hypot(b.ax, b.ay),
            E: sim.state.energy.total,
            p: sim.state.momentum.x,
          })
          if (arr.length > 3000) arr.splice(0, arr.length - 3000)
        }
      }
    }
  }

  private pushHistory(): void {
    this.history.push(cloneScene(this.doc))
    if (this.history.length > 40) this.history.shift()
    this.future = []
  }

  undo(): void {
    const prev = this.history.pop()
    if (!prev) return
    this.future.push(cloneScene(this.doc))
    this.doc = prev
    this.rebuild()
    this.selectedId = null
  }

  redo(): void {
    const next = this.future.pop()
    if (!next) return
    this.history.push(cloneScene(this.doc))
    this.doc = next
    this.rebuild()
    this.selectedId = null
  }

  addBody(b: Body): void {
    this.pushHistory()
    this.doc = { ...this.doc, bodies: [...this.doc.bodies, b] }
    this.rebuild()
  }

  deleteSelected(): void {
    if (this.selectedConstraintId) {
      const id = this.selectedConstraintId
      this.pushHistory()
      this.doc = { ...this.doc, constraints: this.doc.constraints.filter((c) => c.id !== id) }
      if (this.doc.edits?.constraints) delete this.doc.edits.constraints[id]
      this.selectedConstraintId = null
      this.rebuild()
      return
    }
    if (!this.selectedId) return
    if (this.selectedId === 'ground') return
    this.removeBody(this.selectedId)
  }

  private removeBody(id: string): void {
    this.pushHistory()
    this.doc = {
      ...this.doc,
      bodies: this.doc.bodies.filter((b) => b.id !== id),
      constraints: this.doc.constraints.filter(
        (c) => !(c.type === 'track' && (c.bodyId === id || c.centerBodyId === id)),
      ),
      observers: this.doc.observers.filter((o) => !('bodyId' in o && o.bodyId === id)),
      criteria: this.doc.criteria.filter(
        (c) =>
          !(
            (c.kind === 'detach' && (c.bodyId === id || c.trackId === id)) ||
            ((c.kind === 'reach' || c.kind === 'escape') && c.bodyId === id) ||
            ((c.kind === 'coincide' || c.kind === 'collide') && (c.bodyA === id || c.bodyB === id))
          ),
      ),
    }
    if (this.doc.edits?.bodies) delete this.doc.edits.bodies[id]
    if (this.selectedId === id) this.selectedId = null
    this.rebuild()
  }

  // -------------------------------------------------------------------------
  // 输入
  // -------------------------------------------------------------------------

  private selectBody(id: string | null): void {
    if (id === this.selectedId) return
    this.selectedConstraintId = null
    this.selectedId = id
    // 面板弹出来后，保证选中的组件还在面板上方（不要被盖住）
// 不再按面板高度差整体平移相机——开关面板各移一次会让场景越漂越低
if (id) this.ensureBodyVisible(id)
  }

  private ensureBodyVisible(id: string): void {
    const body = findBody(this.doc, id)
    if (!body) return
    const p = this.camera.project(this.bodyAnchor(body), 0)
    const dock = this.dockRect()
    const need = p.y - (dock.y - 70)
    if (need > 0) this.camera.panBy(0, -Math.min(need, 320))
  }

  private syncViewToDoc(): void {
    this.doc = {
      ...this.doc,
      world: {
        ...this.doc.world,
        view: {
          ...this.doc.world.view,
          preset: this.camera.preset,
          elevation: this.camera.elevation,
          azimuth: this.camera.azimuth,
        },
      },
    }
  }

  // ---- 用户自建组件：从场景里「存」，再插到别处 ----

  /**
   * 把「点中的这一坨」存成组件。
   * 画布是单选，所以从选中的物体出发沿约束找整段（点球 A 会带上绳和球 B）。
   */
  saveComponent(): void {
    const seed = this.selectedId
    if (!seed) {
      this.toast('先选中画布上的一个物体，再存为组件')
      return
    }
    const ids = componentSelection(this.doc, seed)
    const comp = extractComponent(this.doc, ids)
    if (!comp) {
      this.toast('没抽出来东西')
      return
    }
    const added = addComponent(this.library, comp)
    if (added.error) {
      this.toast(added.error)
      return
    }
    this.library = added.library
    this.persist()
    this.componentsOpen = true
    this.toast(`已存为组件「${comp.name}」（${comp.bodies.length} 个物体）· 以后在「组件」里插入`)
  }

  /** 把组件插到舞台中央；插完选中它，方便马上拖 */
  insertSavedComponent(id: string): void {
    const comp = this.library.components.find((c) => c.id === id)
    if (!comp) return
    const st = this.stageRect()
    const at = this.camera.unproject(st.x + st.w / 2, st.y + st.h * 0.4)
    const prefix = `k${Date.now().toString(36)}-`
    const inst = instantiateComponent(comp, { x: at.x, y: Math.max(0.4, at.y) }, { prefix })
    this.pushHistory()
    this.doc = {
      ...this.doc,
      bodies: [...this.doc.bodies, ...inst.bodies],
      constraints: [...this.doc.constraints, ...inst.constraints],
      gases: [...this.doc.gases, ...inst.gases],
      world: inst.interactions
        ? { ...this.doc.world, interactions: { ...this.doc.world.interactions, ...inst.interactions } }
        : this.doc.world,
    }
    this.rebuild()
    this.selectedId = inst.ids[0] ?? null
    this.selectedFieldId = null
    this.toast(`已插入「${comp.name}」· 直接拖或改参数`)
  }

  private renderComponentsPanel(): void {
    const st = this.stageRect()
    const w = Math.min(st.w - 24, 520)
    const rows = Math.max(1, Math.min(this.library.components.length, 8))
    const h = Math.min(st.h - 100, 92 + rows * 52 + 16)
    const r: Rect = { x: st.x + (st.w - w) / 2, y: 76 + this.insets.top, w, h }
    this.ui.card(r, { radius: 16, fill: THEME.card, stroke: THEME.panelLine, shadow: true })
    this.ui.add({ id: 'comp:card', rect: r })
    this.ui.text('组件', r.x + 18, r.y + 24, { size: 13, weight: 700 })
    this.ui.text(`${this.library.components.length} 个 · 选中画布上的东西就能再存一个`, r.x + 56, r.y + 24, {
      size: 9,
      color: THEME.inkFaint,
      maxWidth: r.w - 120,
    })
    this.ui.iconButton({ x: r.x + r.w - 42, y: r.y + 8, w: 30, h: 30 }, 'close', {
      onClick: () => {
        this.componentsOpen = false
      },
    })

    if (!this.library.components.length) {
      this.ui.text('还没有组件', r.x + 18, r.y + 62, { size: 11.5, weight: 600, color: THEME.inkSoft })
      this.ui.text('选中画布上的一个物体 → 左侧「＋ 存为组件」', r.x + 18, r.y + 82, {
        size: 9.5,
        color: THEME.inkFaint,
      })
      return
    }

    let y = r.y + 46
    for (const comp of this.library.components.slice(0, 8)) {
      const row: Rect = { x: r.x + 10, y, w: r.w - 20, h: 46 }
      this.ui.text(comp.name, row.x + 8, row.y + 16, { size: 11.5, weight: 650, maxWidth: row.w - 170 })
      this.ui.text(`${comp.bodies.length} 个物体 · ${comp.constraints.length} 个约束`, row.x + 8, row.y + 33, {
        size: 9,
        color: THEME.inkFaint,
      })
      const btn = (label: string, x: number, w2: number, fn: () => void, active = false) =>
        this.ui.pillButton({ x, y: row.y + 9, w: w2, h: 28 }, label, { size: 9.5, weight: 600, active, onClick: fn })
      btn('插入', row.x + row.w - 128, 56, () => this.insertSavedComponent(comp.id), true)
      btn('改名', row.x + row.w - 68, 46, () => this.renameSavedComponent(comp))
      btn('删', row.x + row.w - 22, 22, () => {
        this.library = deleteComponent(this.library, comp.id)
        this.persist()
        this.toast(`已删除组件「${comp.name}」`)
      })
      y += 52
    }
    // 面板只画 8 行（再多就超出舞台了）。剩下的说清楚，别让人以为存丢了。
    const rest = this.library.components.length - 8
    if (rest > 0) {
      this.ui.text(`还有 ${rest} 个没显示（面板放不下）· 先删几个不用的`, r.x + 18, y + 8, {
        size: 9,
        color: THEME.inkFaint,
      })
    }
  }

  private renameSavedComponent(comp: SavedComponent): void {
    if (!this.host.prompt) {
      this.toast('这个壳没有输入框')
      return
    }
    this.host.prompt({ title: '给组件改名', placeholder: comp.name, value: comp.name }, (name) => {
      if (!name) return
      this.library = renameComponent(this.library, comp.id, name)
      this.persist()
    })
  }

  /** 点在哪块场区里（场区是虚线框，点框内就算选中） */
  private pickFieldAt(world: Vec2): Field | null {
    for (const region of this.doc.regions) {
      if (region.role !== 'field') continue
      const local = rot({ x: world.x - region.transform.x, y: world.y - region.transform.y }, -region.transform.angle)
      if (pointInShape(region.shape, local)) {
        const field = this.doc.fields.find((f) => f.kind === 'uniform' && f.regionId === region.id)
        if (field) return field
      }
    }
    return null
  }

  private selectField(id: string | null): void {
    this.selectedFieldId = id
    this.selectedId = null
    this.selectedConstraintId = null
    this.showWorld = false
  }

  /** 选中的场：把它的虚线框描一遍，让「选中了哪个」一眼可见 */
  private renderFieldSelection(): void {
    const field = this.doc.fields.find((f) => f.id === this.selectedFieldId)
    if (!field || field.kind !== 'uniform' || !field.regionId) return
    const region = this.doc.regions.find((r) => r.id === field.regionId)
    if (!region) return
    const ctx = this.ctx
    const geoms = renderGeometries(region.shape, 'teach')
    ctx.save()
    ctx.strokeStyle = THEME.accent
    ctx.lineWidth = 2
    ctx.setLineDash([5, 4])
    for (const g of geoms) {
      const local = g.kind === 'fill' ? (g.outlines[0] ?? []) : g.points
      if (local.length < 2) continue
      const pts = local.map((pt) => {
        const c = Math.cos(region.transform.angle)
        const sn = Math.sin(region.transform.angle)
        return this.camera.project(
          { x: region.transform.x + pt.x * c - pt.y * sn, y: region.transform.y + pt.x * sn + pt.y * c },
          0,
        )
      })
      ctx.beginPath()
      ctx.moveTo(pts[0]!.x, pts[0]!.y)
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i]!.x, pts[i]!.y)
      ctx.closePath()
      ctx.stroke()
    }
    ctx.restore()
  }

  /** 场强：E 保持方向改大小；B 保持正负改大小 */
  private setFieldMagnitude(id: string, v: number): void {
    const f = this.doc.fields.find((x) => x.id === id)
    if (!f || f.kind !== 'uniform') return
    if (f.type === 'E') {
      const a = Math.atan2(f.vector.y, f.vector.x)
      const vec = { x: Math.cos(a) * v, y: Math.sin(a) * v }
      this.doc = { ...this.doc, fields: this.doc.fields.map((x) => (x.id === id ? { ...f, vector: vec } : x)) }
    } else if (f.type === 'B') {
      const sign = f.bz >= 0 ? 1 : -1
      this.doc = { ...this.doc, fields: this.doc.fields.map((x) => (x.id === id ? { ...f, bz: sign * v } : x)) }
    }
    this.rebuild()
  }

  /** 电场方向：角度制，0° 指向右，90° 向上 */
  private setFieldAngle(id: string, deg: number): void {
    const f = this.doc.fields.find((x) => x.id === id)
    if (!f || f.kind !== 'uniform' || f.type !== 'E') return
    const mag = Math.max(1e-6, Math.hypot(f.vector.x, f.vector.y))
    const a = (deg * Math.PI) / 180
    const vec = { x: Math.cos(a) * mag, y: Math.sin(a) * mag }
    this.doc = { ...this.doc, fields: this.doc.fields.map((x) => (x.id === id ? { ...f, vector: vec } : x)) }
    this.rebuild()
  }

  /** 磁场朝向：+1 向外（·）/ -1 向里（×） */
  private setFieldSign(id: string, sign: 1 | -1): void {
    const f = this.doc.fields.find((x) => x.id === id)
    if (!f || f.kind !== 'uniform' || f.type !== 'B') return
    const mag = Math.abs(f.bz)
    this.doc = { ...this.doc, fields: this.doc.fields.map((x) => (x.id === id ? { ...f, bz: sign * mag } : x)) }
    this.rebuild()
  }

  private removeField(id: string): void {
    const f = this.doc.fields.find((x) => x.id === id)
    if (!f) return
    this.pushHistory()
    const regionId = f.kind === 'uniform' ? f.regionId : undefined
    this.doc = {
      ...this.doc,
      fields: this.doc.fields.filter((x) => x.id !== id),
      regions: regionId ? this.doc.regions.filter((r) => r.id !== regionId) : this.doc.regions,
    }
    this.selectedFieldId = null
    this.rebuild()
    this.toast('已删除这块场')
  }

  /** 按比例缩放一个形状（实现在 editor/drawing.ts，有单测） */
  private scaledShape(shape: Shape, f: number): Shape {
    return scaleShape(shape, f)
  }

  /** 选中物体的缩放手柄：包围盒右下角 */
  private resizeHandleScreen(): { x: number; y: number; center: Vec2; dist: number } | null {
    if (!this.selectedId || this.playing) return null
    const body = findBody(this.doc, this.selectedId)
    if (!body) return null
    const state = this.simA?.state.bodies[body.id]
    const t = state ? { x: state.x, y: state.y, angle: state.angle } : body.transform
    const box = bodyAABB(body.shape, t)
    const corner = this.camera.project({ x: box.max.x, y: box.min.y }, 0)
    const center = { x: (box.min.x + box.max.x) / 2, y: (box.min.y + box.max.y) / 2 }
    const cScreen = this.camera.project(center, 0)
    return { x: corner.x, y: corner.y, center, dist: Math.hypot(corner.x - cScreen.x, corner.y - cScreen.y) }
  }

  private renderResizeHandle(): void {
    const h = this.resizeHandleScreen()
    if (!h) return
    const ctx = this.ctx
    ctx.save()
    ctx.fillStyle = THEME.card
    ctx.strokeStyle = THEME.accent
    ctx.lineWidth = 1.6
    roundRect(ctx, h.x - 5, h.y - 5, 10, 10, 2.5)
    ctx.fill()
    ctx.stroke()
    ctx.restore()
    this.ui.add({
      id: 'resize-handle',
      rect: { x: h.x - 12, y: h.y - 12, w: 24, h: 24 },
      cursor: 'ew-resize',
      onPress: () => {
        const body = findBody(this.doc, this.selectedId ?? '')
        if (!body) return
        this.pushHistory()
        const world = this.camera.unproject(h.x, h.y)
        this.drag = {
          kind: 'scale',
          bodyId: body.id,
          base: cloneScene(body),
          center: h.center,
          startDist: Math.max(0.05, Math.hypot(world.x - h.center.x, world.y - h.center.y)),
        }
      },
    })
  }

  private bodyAnchor(body: Body): Vec2 {
    const s = this.simA?.state.bodies[body.id]
    return s ? { x: s.x, y: s.y } : { x: body.transform.x, y: body.transform.y }
  }

  private rotateHandleScreen(): { x: number; y: number } | null {
    if (!this.selectedId || this.playing) return null
    const body = findBody(this.doc, this.selectedId)
    if (!body) return null
    if (body.kind === 'static' || body.kind === 'kinematic') return null
    const p = this.camera.project(this.bodyAnchor(body), 0)
    return { x: p.x, y: p.y - 58 }
  }

  private eraseAt(x: number, y: number): void {
    // 先擦墨迹：批注在最上层，橡皮也应该先吃到它，否则会「擦不动」看不见的物体
    if (this.ink.length) {
      const world = this.camera.unproject(x, y)
      const hit = inkHitTest(this.ink, world, 14 / this.camera.pixelScale)
      if (hit >= 0) {
        this.ink.splice(hit, 1)
        return
      }
    }
    const body = pickBody(this.doc, this.camera, this.visualState(), x, y)
    if (!body || body.id === 'ground') return
    this.removeBody(body.id)
  }

  private bodyLocal(body: Body, world: Vec2): Vec2 {
    const c = Math.cos(-body.transform.angle)
    const s = Math.sin(-body.transform.angle)
    const dx = world.x - body.transform.x
    const dy = world.y - body.transform.y
    return { x: dx * c - dy * s, y: dx * s + dy * c }
  }

  private anchorWorldOf(body: Body, local: Vec2): Vec2 {
    const c = Math.cos(body.transform.angle)
    const s = Math.sin(body.transform.angle)
    return { x: body.transform.x + local.x * c - local.y * s, y: body.transform.y + local.x * s + local.y * c }
  }

  /** 同类地形合并：把两块静态地形烘焙成一个复合体，形成连续的斜面/轨道 */
  private mergeTerrain(aId: string, bId: string): void {
    const a = findBody(this.doc, aId)
    const b = findBody(this.doc, bId)
    if (!a || !b) return
    if (a.id === 'ground' || b.id === 'ground') {
      this.toast('地面不参与合并')
      return
    }
    const anchorId = (a: Anchor): string | undefined => ('bodyId' in a ? a.bodyId : undefined)
    const referenced = (id: string) =>
      this.doc.constraints.some((c) => 'a' in c && (anchorId(c.a) === id || anchorId(c.b) === id)) ||
      this.doc.observers.some((o) => 'bodyId' in o && o.bodyId === id)
    if (referenced(aId) || referenced(bId)) {
      this.toast('先删掉和这两块地形相连的绳或观测')
      return
    }
    if (a.shape.type === 'circle' || b.shape.type === 'circle') {
      this.toast('圆形地形暂不支持合并')
      return
    }
    const parts: Shape[] = []
    const worldOf = (body: Body, p: Vec2): Vec2 => {
      const c = Math.cos(body.transform.angle)
      const sn = Math.sin(body.transform.angle)
      return {
        x: body.transform.x + p.x * c - p.y * sn,
        y: body.transform.y + p.x * sn + p.y * c,
      }
    }
    for (const body of [a, b]) {
      for (const g of renderGeometries(body.shape, 'teach')) {
        if (g.kind === 'fill') {
          for (const outline of g.outlines) {
            if (outline.length >= 3) parts.push({ type: 'polygon', points: outline.map((p) => worldOf(body, p)) })
          }
        } else {
          parts.push({
            type: 'polyline',
            points: g.points.map((p) => worldOf(body, p)),
            thick: g.thick,
            closed: g.closed,
          })
        }
      }
    }
    if (parts.length === 0) {
      this.toast('这两块地形没有可合并的轮廓')
      return
    }
    let minX = Infinity
    let maxX = -Infinity
    let minY = Infinity
    let maxY = -Infinity
    for (const part of parts) {
      if (part.type !== 'polygon' && part.type !== 'polyline') continue
      for (const p of part.points) {
        minX = Math.min(minX, p.x)
        maxX = Math.max(maxX, p.x)
        minY = Math.min(minY, p.y)
        maxY = Math.max(maxY, p.y)
      }
    }
    const cx = (minX + maxX) / 2
    const cy = (minY + maxY) / 2
    const centered = parts.map((part) =>
      part.type === 'polygon' || part.type === 'polyline'
        ? { ...part, points: part.points.map((p) => ({ x: p.x - cx, y: p.y - cy })) }
        : part,
    ) as Shape[]
    const merged: Body = {
      ...a,
      shape: { type: 'compound', parts: centered },
      transform: { x: cx, y: cy, angle: 0 },
      kind: 'static',
      role: 'terrain',
      label: '合并地形',
    }
    this.pushHistory()
    this.doc = {
      ...this.doc,
      bodies: this.doc.bodies.filter((x) => x.id !== bId).map((x) => (x.id === aId ? merged : x)),
    }
    if (this.doc.edits?.bodies) {
      delete this.doc.edits.bodies[aId]
      delete this.doc.edits.bodies[bId]
    }
    this.selectedId = aId
    this.selectedConstraintId = null
    this.rebuild()
    this.toast('两块地形合并成一条')
  }

  private handleConnectClick(x: number, y: number, world: Vec2): void {
    const hit = pickBody(this.doc, this.camera, this.visualState(), x, y)
    if (!hit) {
      this.linkFrom = null
      this.toast('先点一个物体作为绳的一端')
      return
    }
    if (!this.linkFrom) {
      this.linkFrom = { bodyId: hit.id, local: this.bodyLocal(hit, world) }
      this.toast('再点另一个物体，生成一根绳')
      return
    }
    if (this.linkFrom.bodyId === hit.id) {
      this.linkFrom = null
      this.toast('不能连到自己')
      return
    }
    const fromBody = findBody(this.doc, this.linkFrom.bodyId)
    if (!fromBody) {
      this.linkFrom = null
      return
    }
    const roleOf = (b: Body) => b.role ?? (b.kind === 'static' ? 'terrain' : 'object')
    if (roleOf(fromBody) === 'terrain' && roleOf(hit) === 'terrain') {
      this.linkFrom = null
      this.mergeTerrain(fromBody.id, hit.id)
      return
    }
    const a = this.anchorWorldOf(fromBody, this.linkFrom.local)
    const length = Math.max(0.05, Math.hypot(world.x - a.x, world.y - a.y))
    const id = `link${this.doc.constraints.length + 1}`
    const c: Constraint = {
      id,
      type: 'rope',
      a: { bodyId: fromBody.id, local: this.linkFrom.local },
      b: { bodyId: hit.id, local: this.bodyLocal(hit, world) },
      length,
    }
    this.pushHistory()
    this.doc = { ...this.doc, constraints: [...this.doc.constraints, c] }
    this.linkFrom = null
    this.rebuild()
    this.toast('已用绳连接 · 拖动物体试试')
  }

  private renderLinkPreview(): void {
    if (!this.linkFrom) return
    const body = findBody(this.doc, this.linkFrom.bodyId)
    if (!body) return
    const a = this.anchorWorldOf(body, this.linkFrom.local)
    const pa = this.camera.project(a, 0)
    const pb = { x: this.pointer.x, y: this.pointer.y }
    const ctx = this.ctx
    ctx.save()
    ctx.strokeStyle = rgba(THEME.green, 0.85)
    ctx.lineWidth = 1.6
    ctx.setLineDash([5, 4])
    ctx.beginPath()
    ctx.moveTo(pa.x, pa.y)
    ctx.lineTo(pb.x, pb.y)
    ctx.stroke()
    ctx.setLineDash([])
    ctx.fillStyle = THEME.green
    ctx.beginPath()
    ctx.arc(pa.x, pa.y, 4, 0, Math.PI * 2)
    ctx.fill()
    ctx.restore()
  }

  pointerDown(x: number, y: number): void {
    this.pointer = { x, y, down: true }
    this.pendingClick = null
    this.pendingSelectId = null
    // 左侧面板：空白处按住 = 滚面板（窄屏内容比面板高）
    if (this.mode === 'scene' && this.panelMaxScroll > 0 && inRect(this.panelRect(), x, y)) {
      const probe = this.ui.find(x, y)
      if (!probe || probe.id === 'panel:bg') {
        this.panelDrag = { lastY: y }
        return
      }
    }
    const hit = this.ui.find(x, y)
    if (hit) {
      if (hit.slider || hit.onDrag) {
        this.activeRegion = hit
        hit.onPress?.(x, y)
      } else if (hit.onClick) {
        this.pendingClick = { region: hit, x0: x, y0: y }
      } else if (hit.onPress) {
        hit.onPress(x, y)
      }
      return
    }
    if (this.mode !== 'scene') {
      this.pageDrag = { lastY: y }
      return
    }
    const world = this.camera.unproject(x, y)
    if (this.tool === 'connect') {
      this.handleConnectClick(x, y, world)
      return
    }
    if (this.tool === 'eraser') {
      this.eraseAt(x, y)
      this.drag = { kind: 'erase', moved: false }
      return
    }
    if (this.tool === 'ink') {
      // 批注：起笔。单点也是一笔（点一下标个位置）
      this.ink.push({ points: [world] })
      this.drag = { kind: 'ink' }
      return
    }
    if (this.tool === 'hand' || (this.tool === 'select' && !this.doc.bodies.length)) {
      this.drag = { kind: 'pan', lastX: x, lastY: y }
      return
    }
    if (this.tool === 'select') {
      // 旋转手柄
      const rh = this.rotateHandleScreen()
      if (rh && Math.hypot(x - rh.x, y - rh.y) < 20) {
        const rb = findBody(this.doc, this.selectedId ?? '')
        if (rb) {
          const c = this.bodyAnchor(rb)
          this.drag = {
            kind: 'rotate',
            bodyId: rb.id,
            startAngle: rb.transform.angle,
            startPointer: Math.atan2(world.y - c.y, world.x - c.x),
            moved: false,
          }
          return
        }
      }
      // 速度箭头手柄
      const vel = this.velocityHandle()
      if (vel && !this.playing && Math.hypot(x - vel.x, y - vel.y) < 18) {
        this.drag = { kind: 'velocity', bodyId: vel.bodyId, moved: false }
        return
      }
      const body = pickBody(this.doc, this.camera, this.visualState(), x, y)
      if (body) {
        // 双击 = 切换分类（地??物体 ?轨道），不是选中
        if (
          this.lastTap &&
          this.lastTap.id === body.id &&
          this.now - this.lastTap.t < 0.45 &&
          Math.hypot(world.x - this.lastTap.wx, world.y - this.lastTap.wy) < 0.2
        ) {
          this.lastTap = null
          this.cycleClassification(body.id)
          return
        }
        this.lastTap = { id: body.id, t: this.now, wx: world.x, wy: world.y }
        if (this.playing) {
          this.selectBody(body.id)
          return
        }
        this.pendingSelectId = this.selectedId === body.id ? null : body.id
        const b = this.simA?.state.bodies[body.id]
        const pos = b ? { x: b.x, y: b.y } : body.transform
        this.drag = {
          kind: 'move',
          bodyId: body.id,
          offset: { x: world.x - pos.x, y: world.y - pos.y },
          moved: false,
        }
        return
      }
      const con = this.pickConstraintAt(x, y)
      if (con) {
        this.selectConstraint(con.id)
        return
      }
      // 没点到物体/约束，再看是不是点在某块场区里
      const field = this.pickFieldAt(world)
      if (field) {
        this.selectField(field.id)
        return
      }
      this.selectField(null)
      this.selectBody(null)
      this.drag = { kind: 'pan', lastX: x, lastY: y }
      return
    }
    // 绘图
    const points = this.tool === 'pen' ? [world] : undefined
    this.drag = { kind: 'draw', start: world, current: world, tool: this.tool, points }
  }

  pointerMove(x: number, y: number): void {
    this.pointer = { x, y, down: this.pointer.down }
    if (this.panelDrag) {
      const dy = y - this.panelDrag.lastY
      this.panelDrag.lastY = y
      this.panelScroll = clamp(this.panelScroll + dy, -this.panelMaxScroll, 0)
      return
    }
    if (this.activeRegion) {
      this.activeRegion.onDrag?.(x, y)
      return
    }
    if (this.pendingClick) {
      if (Math.hypot(x - this.pendingClick.x0, y - this.pendingClick.y0) > 8) {
        // 从卡片上开始拖?= 滚动 / 平移，而不是点开
        this.pendingClick = null
        if (this.mode !== 'scene') this.pageDrag = { lastY: y }
      }
      return
    }
    if (this.drag) {
      this.moveDrag(x, y)
      return
    }
    if (this.pageDrag) {
      const dy = y - this.pageDrag.lastY
      this.pageDrag.lastY = y
      if (this.mode === 'bank') {
        if (this.problemOpen) this.problemScroll = clamp(this.problemScroll + dy, -this.problemMaxScroll, 0)
        else this.bankScroll = clamp(this.bankScroll + dy, -this.bankMaxScroll, 0)
      } else if (this.mode === 'library') this.libraryScroll = clamp(this.libraryScroll + dy, -this.libraryMaxScroll, 0)
    }
  }

  private moveDrag(x: number, y: number): void {
    const d = this.drag
    if (!d) return
    if (d.kind === 'pan') {
      this.camera.panBy(x - d.lastX, y - d.lastY)
      d.lastX = x
      d.lastY = y
    } else if (d.kind === 'erase') {
      this.eraseAt(x, y)
    } else if (d.kind === 'ink') {
      const stroke = this.ink[this.ink.length - 1]
      if (stroke) {
        const world = this.camera.unproject(x, y)
        const last = stroke.points[stroke.points.length - 1]
        if (shouldSample(last, world)) stroke.points.push(world)
      }
    } else if (d.kind === 'scale') {
      const world = this.camera.unproject(x, y)
      const dist = Math.hypot(world.x - d.center.x, world.y - d.center.y)
      const f = clamp(dist / Math.max(d.startDist, 0.05), 0.2, 5)
      const body = findBody(this.doc, d.bodyId)
      if (!body) return
      const next: Body = {
        ...body,
        shape: this.scaledShape(d.base.shape, f),
        transform: { ...d.base.transform },
      }
      this.doc = { ...this.doc, bodies: this.doc.bodies.map((b) => (b.id === d.bodyId ? next : b)) }
      this.simA = new Simulation(this.doc)
      this.clearRecords()
    } else if (d.kind === 'rotate') {
      if (!d.moved) {
        d.moved = true
        this.pushHistory()
      }
      const body = findBody(this.doc, d.bodyId)
      if (!body) return
      const c = this.bodyAnchor(body)
      const world = this.camera.unproject(x, y)
      let angle = d.startAngle + (Math.atan2(world.y - c.y, world.x - c.x) - d.startPointer)
      const step = Math.PI / 12
      const near = Math.round(angle / step) * step
      if (Math.abs(angle - near) < (2.5 * Math.PI) / 180) angle = near
      this.doc = {
        ...this.doc,
        bodies: this.doc.bodies.map((b) =>
          b.id === d.bodyId ? { ...b, transform: { ...b.transform, angle } } : b,
        ),
      }
      this.rebuild()
    } else if (d.kind === 'move') {
      if (!d.moved) {
        d.moved = true
        this.pushHistory()
      }
      const body = findBody(this.doc, d.bodyId)
      if (!body) return
      const world = this.camera.unproject(x, y)
      const p = { x: world.x - d.offset.x, y: world.y - d.offset.y }
      const candidate = { ...body, transform: { ...body.transform, x: p.x, y: p.y } }
      // 只有"被观测物"才吸附；斜面/轨道这类长条地形只按指针移动，并且最低点贴地
      const snapable = body.kind === 'particle' || body.kind === 'rigid'
      const hit = snapable ? findSnap(this.doc, candidate, p, { threshold: 0.26 }) : null
      let next = hit ? applySnap(candidate, hit) : candidate
      if (!snapable) {
        const box = bodyAABB(next.shape, next.transform)
        if (box.min.y < 0 || box.min.y < 0.18) {
          next = { ...next, transform: { ...next.transform, y: next.transform.y - box.min.y } }
        }
        recordBodyEdit(this.doc, body.id, { x: next.transform.x, y: next.transform.y })
      }
      this.doc = {
        ...this.doc,
        bodies: this.doc.bodies.map((b) => (b.id === d.bodyId ? next : b)),
      }
      this.rebuild()
    } else if (d.kind === 'velocity') {
      const b = this.doc.bodies.find((bb) => bb.id === d.bodyId)
      if (!b) return
      if (!d.moved) {
        d.moved = true
        this.pushHistory()
      }
      const world = this.camera.unproject(x, y)
      const v = { x: (world.x - b.transform.x) / 0.35, y: (world.y - b.transform.y) / 0.35 }
      this.doc = {
        ...this.doc,
        bodies: this.doc.bodies.map((bb) => (bb.id === d.bodyId ? { ...bb, velocity: v } : bb)),
      }
      this.rebuild()
    } else if (d.kind === 'draw') {
      d.current = this.camera.unproject(x, y)
      if (d.tool === 'pen') {
        const pts = d.points ?? (d.points = [d.start])
        const last = pts[pts.length - 1]!
        if (Math.hypot(d.current.x - last.x, d.current.y - last.y) > 0.025) pts.push(d.current)
      }
    }
  }

  pointerUp(): void {
    if (this.panelDrag) {
      this.panelDrag = null
      this.pointer.down = false
      return
    }
    if (this.activeRegion) {
      this.activeRegion.onRelease?.()
      this.activeRegion = null
        this.pointer.down = false
      return
    }
    if (this.pendingClick) {
      const p = this.pendingClick
      this.pendingClick = null
      this.pointer.down = false
      this.pageDrag = null
      p.region.onClick?.()
      return
    }
    this.pageDrag = null
    const d = this.drag
    this.drag = null
    this.pointer.down = false
    if (!d) return
    if (d.kind === 'draw') {
      this.finishDraw(d)
    } else if (d.kind === 'move' || d.kind === 'velocity') {
      if (d.moved) this.rebuild()
      if (this.pendingSelectId) {
        this.selectBody(this.pendingSelectId)
        this.pendingSelectId = null
      }
    } else if (d.kind === 'rotate') {
      this.rebuild()
    } else if (d.kind === 'scale') {
      this.rebuild()
      this.toast('已调整大小')
    }
  }

  wheel(delta: number, x: number, y: number): void {
    if (this.mode === 'scene' && inRect(this.panelRect(), x, y) && this.panelMaxScroll > 0) {
      this.panelScroll = clamp(this.panelScroll - delta * 0.6, -this.panelMaxScroll, 0)
      return
    }
    if (this.mode === 'bank') {
      if (this.problemOpen) this.problemScroll = clamp(this.problemScroll - delta * 0.6, -this.problemMaxScroll, 0)
      else this.bankScroll = clamp(this.bankScroll - delta * 0.6, -this.bankMaxScroll, 0)
      return
    }
    if (this.mode === 'library') {
      this.libraryScroll = clamp(this.libraryScroll - delta * 0.6, -this.libraryMaxScroll, 0)
      return
    }
    const factor = Math.exp(-delta * 0.0016)
    this.camera.zoomAt(x, y, factor)
  }

  key(key: string, ctrl = false, shift = false): void {
    if (key === 'Escape' && this.aiOpen) {
      this.aiOpen = false
      return
    }
    if (key === 'Escape' && this.componentsOpen) {
      this.componentsOpen = false
      return
    }
    if (key === 'Escape' && this.confirm) {
      this.confirm = null
      return
    }
    if (key === 'Escape' && this.problemOpen) {
      this.problemOpen = null
      return
    }
    if (key === 'Escape' && this.moveModelId) {
      this.moveModelId = null
      return
    }
    if (ctrl && (key === 'z' || key === 'Z')) {
      if (shift) this.redo()
      else this.undo()
      return
    }
    if (ctrl && (key === 'y' || key === 'Y')) {
      this.redo()
      return
    }
    if (key === ' ') {
      this.togglePlay()
      return
    }
    if (key === 'r' || key === 'R') {
      this.playing = false
      this.reset()
      return
    }
    if (key === 'Delete' || key === 'Backspace') {
      this.deleteSelected()
      return
    }
    if (key === 'Escape') {
      if (this.mode === 'scene') this.toLibrary()
    }
  }

  // -------------------------------------------------------------------------
  // 绘图
  // -------------------------------------------------------------------------

  private finishDraw(d: Extract<DragState, { kind: 'draw' }>): void {
    if (d.tool === 'fieldE' || d.tool === 'fieldB') {
      this.createField(d.tool === 'fieldE' ? 'E' : 'B', d.start, d.current)
      return
    }
    // 手绘：先识别意图，再按意图建物体（画什么就是什么）
    const raw = d.points ?? [d.start, d.current]
    const rec = recognizeStroke(raw)
    if (!rec) return

    const id = this.nextBodyId()
    let body: Body = bodyFromRecognized(rec, id)

    // 地形贴地：画在地面附近的就落到地面上
    if (body.kind === 'static') {
      const box = bodyAABB(body.shape, body.transform)
      if (box.min.y < 0.18) {
        body = { ...body, transform: { ...body.transform, y: body.transform.y - box.min.y } }
      }
    }

    this.pushHistory()
    this.doc = { ...this.doc, bodies: [...this.doc.bodies, body] }
    if (rec.kind === 'circle') this.snapBodyNow(id)
    this.selectedId = id
    this.rebuild()
    this.ensureBodyVisible(id)
    this.tool = 'select'
    this.toast(`识别为${describeRecognized(rec)} · 双击切换地形/物体/轨道`)
  }

  // ---- 场：画箭头 = 电场，点 = 磁场向外，× = 磁场向里 ----

  /** 场笔第一笔：定方向；第二笔：拖一块区域 = 限定范围，点一下 = 全场 */
  /**
   * 电场 / 磁场：拖一个矩形 → 场长在这块区域里（拖太小 = 全场）。
   * 建完就选中它，左侧面板立刻能调场强和方向。
   */
  private createField(kind: 'E' | 'B', start: Vec2, current: Vec2): void {
    const draft = fieldDraftFromDrag(kind, start, current)
    const stamp = Date.now().toString(36)
    const fieldId = `field-${stamp}`
    const regionId = draft.region ? `region-${stamp}` : undefined
    this.pushHistory()
    const field: Field =
      draft.field.type === 'E'
        ? { id: fieldId, kind: 'uniform', type: 'E', vector: { ...draft.field.vector }, regionId, enabled: true }
        : { id: fieldId, kind: 'uniform', type: 'B', bz: draft.field.bz, regionId, enabled: true }
    const regions: Region[] = draft.region
      ? [
          ...this.doc.regions,
          {
            id: regionId!,
            shape: { type: 'rect', w: draft.region.w, h: draft.region.h },
            transform: { x: draft.region.x, y: draft.region.y, angle: 0 },
            label: draft.region.label,
            role: 'field',
          },
        ]
      : this.doc.regions
    this.doc = { ...this.doc, fields: [...this.doc.fields, field], regions }
    this.rebuild()
    this.tool = 'select'
    this.selectedId = null
    this.selectedConstraintId = null
    this.selectedFieldId = fieldId
    const name = kind === 'E' ? '电场' : '磁场'
    this.toast(
      draft.region
        ? `已画${name}，只作用在虚线框里 · 左侧可调场强和方向`
        : `已画${name}（全场）· 场只作用于带电体，检查器里设 q`,
    )
  }

  private nextBodyId(): string {
    let i = 1
    while (this.doc.bodies.some((b) => b.id === `b${i}`)) i++
    return `b${i}`
  }

  private nextBodyIds(n: number): string[] {
    const used = new Set(this.doc.bodies.map((b) => b.id))
    const out: string[] = []
    let i = 1
    while (out.length < n) {
      const id = `b${i}`
      if (!used.has(id)) {
        out.push(id)
        used.add(id)
      }
      i++
    }
    return out
  }

  /** 组件的分类：地形（不动）/ 物体（会动）/ 轨道（圆?+ 连一个小球） */
  private classifyBody(body: Body, role: 'terrain' | 'object' | 'track'): Body {
    if (role === 'terrain') {
      return {
        ...body,
        role,
        kind: 'static',
        material: 'stone',
        label: '地形',
        appearance: { ...body.appearance, color: THEME.terrain },
      }
    }
    if (role === 'track') {
      return {
        ...body,
        role,
        kind: 'static',
        material: 'smooth',
        label: '轨道',
        appearance: { ...body.appearance, color: THEME.track },
      }
    }
    const area = Math.max(0.01, shapeArea(body.shape))
    return {
      ...body,
      role,
      kind: 'particle',
      material: 'metal',
      mass: clamp(area * 2, 0.05, 5),
      fixedRotation: true,
      velocity: { x: 0, y: 0 },
      label: '物体',
      appearance: { ...body.appearance, color: THEME.blue },
    }
  }

  private cycleClassification(id: string): void {
    const body = findBody(this.doc, id)
    if (!body) return
    const cur: 'terrain' | 'object' =
      body.role === 'object' || (body.kind !== 'static' && body.kind !== 'kinematic') ? 'object' : 'terrain'
    const order: Array<'terrain' | 'object'> = ['terrain', 'object']
    const next = order[(order.indexOf(cur) + 1) % order.length]!
    this.pushHistory()
    let updated = this.classifyBody(body, next)
    if (next === 'object') {
      const hit = findSnap(this.doc, updated, updated.transform, { threshold: 0.32 })
      if (hit) updated = applySnap(updated, hit)
    }
    this.doc = {
      ...this.doc,
      bodies: this.doc.bodies.map((b) => (b.id === id ? updated : b)),
    }
    this.selectedId = id
    this.rebuild()
    this.ensureBodyVisible(id)
    this.toast(
      next === 'terrain' ? '已切成地形（固定不动）' : '已切成物体（会动、会吸附）',
    )
  }

  /** 把轨道圆弧和附近的小球连起来（这就是“组件之间的逻辑”） */
  private attachTrack(trackBody: Body): void {
    const s = trackBody.shape
    if (s.type !== 'arc' && s.type !== 'circle') return
    const center = trackBody.transform
    let best: Body | null = null
    let bestD = Infinity
    for (const b of this.doc.bodies) {
      if (b.id === trackBody.id) continue
      if (b.kind !== 'particle' && b.kind !== 'rigid') continue
      if (b.shape.type !== 'circle') continue
      const d = Math.hypot(b.transform.x - center.x, b.transform.y - center.y)
      if (d < s.r + 0.9 && d < bestD) {
        best = b
        bestD = d
      }
    }
    if (!best || best.shape.type !== 'circle') return
    const radius = Math.max(0.03, s.r - best.shape.r)
    const constraint: Constraint = {
      id: `trk-${trackBody.id}`,
      type: 'track',
      bodyId: best.id,
      centerBodyId: trackBody.id,
      radius,
      side: 'inner',
    }
    const dir = { x: best.transform.x - center.x, y: best.transform.y - center.y }
    const len = Math.hypot(dir.x, dir.y) || 1
    const placed: Body = {
      ...best,
      transform: {
        ...best.transform,
        x: center.x + (dir.x / len) * radius,
        y: center.y + (dir.y / len) * radius,
      },
    }
    this.doc = {
      ...this.doc,
      bodies: this.doc.bodies.map((b) => (b.id === best!.id ? placed : b)),
      constraints: [
        ...this.doc.constraints.filter((c) => !(c.type === 'track' && c.id === constraint.id)),
        constraint,
      ],
    }
    this.toast('已把小球连到轨道上')
  }

  private snapBodyNow(id: string): void {
    const body = findBody(this.doc, id)
    if (!body) return
    const hit = findSnap(this.doc, body, body.transform, { threshold: 0.32 })
    if (!hit) return
    const snapped = applySnap(body, hit)
    this.doc = {
      ...this.doc,
      bodies: this.doc.bodies.map((b) => (b.id === id ? snapped : b)),
    }
  }

  // -------------------------------------------------------------------------
  // 渲染
  // -------------------------------------------------------------------------

  // -------------------------------------------------------------------------
  // 编辑器布局：左参数面板 + 右舞台 + 底部图表（参考图的结构）
  // -------------------------------------------------------------------------

  /** 布局全是纯算术，见 editor/layout.ts（那边有单测） */
  private layout(): EditorLayout {
    return computeLayout({
      width: this.width,
      height: this.height,
      insetsTop: this.insets.top,
      insetsRight: this.insets.right,
      hasChart: this.doc.observers.some((o) => o.kind === 'chart'),
    })
  }

  private panelRect(): Rect {
    return this.layout().panel
  }

  private stageRect(): Rect {
    return this.layout().stage
  }

  /** 舞台底部的图表面板；没有图表观测器就不占地方 */
  private chartRect(): Rect | null {
    return this.layout().chart
  }

  private viewPan(): { x: number; y: number } {
    return this.layout().pan
  }

  /** 属性面板（选中物体/约束/世界时）浮在舞台底部 */
  private dockRect(): Rect {
    return floatingSheet(this.stageRect(), this.sheetHeight())
  }

  /** 属性面板要多高：按选中对象决定，和布局分开算 */
  private sheetHeight(): number {
    let h = 64
    if (this.selectedConstraintId) {
      const c = this.doc.constraints.find((x) => x.id === this.selectedConstraintId)
      h = c?.type === 'spring' ? 186 : 146
    } else if (this.selectedId) {
      const body = findBody(this.doc, this.selectedId)
      const isStatic = !body || body.kind === 'static' || body.kind === 'kinematic'
      const nForces = body?.forces?.length ?? 0
      const arcTerrain = !!body && (body.shape.type === 'circle' || body.shape.type === 'arc') && (body.role ?? 'terrain') === 'terrain'
      const geometry = !!body && (body.shape.type === 'circle' || body.shape.type === 'arc' || body.shape.type === 'polyline' || body.shape.type === 'polygon' || (body.id === 'loop' && this.doc.params.R !== undefined) || (body.id === 'board' && this.doc.params.l !== undefined) || (body.id === 'platform' && this.doc.params.h !== undefined))
      h = isStatic ? 162 : 242 + (nForces ? 28 : 0) + (this.selectedForceId ? 58 : 0)
      if (geometry) h += 68
      if (this.doc.world.interactions?.coulomb) h += 54
      if (arcTerrain) h += 32
    } else if (this.showWorld) {
      const hasE = this.doc.params.E !== undefined && this.doc.fields.some((f) => f.kind === 'uniform' && f.type === 'E')
      const hasDrag = this.doc.fields.some((f) => f.kind === 'drag')
      const hasB = this.doc.fields.some((f) => f.kind === 'uniform' && f.type === 'B')
      h = 150 + 38 + (this.doc.gases.length ? 96 : 0) + (hasE ? 54 : 36) + (hasB ? 54 : 36) + (hasDrag ? 36 : 0)
    }
    return h
  }

  private renderSceneMode(): void {
    const st = this.stageRect()
    const ctx = this.ctx
    ctx.save()
    ctx.fillStyle = THEME.stage
    ctx.fillRect(st.x, st.y, st.w, st.h)
    ctx.restore()

    const stateA = this.visualState()
    renderScene({
      ctx,
      scene: this.doc,
      camera: this.camera,
      state: stateA,
      trails: this.trailsA,
      selectedId: this.selectedId,
      selectedConstraintId: this.selectedConstraintId,
      showVectors: true,
      showForces: this.showForces,
      showGuides: true,
      showLabels: this.showLabels,
      time: this.simA?.state.t ?? 0,
    })
    // 批注在最上层（模型之上、UI 之下）：老师写的东西不能被物体盖住
    this.renderFieldSelection()
    drawInk(ctx, this.camera, this.ink)
    if (this.drag?.kind === 'draw') this.renderDrawPreview(this.drag)
    this.renderLinkPreview()
    this.renderRotateHandle()
    this.renderResizeHandle()
    this.renderEraserHover()
    this.renderStageChrome()
    this.renderChartPanel()
    this.renderSidebar()
    if (this.selectedId || this.selectedConstraintId || this.showWorld) this.renderDock()
    if (this.componentsOpen) this.renderComponentsPanel()
    if (this.chainOpen) this.renderChainPanel()
  }

  // ---- 舞台：状态药丸 + 播放键 + 右上角分享 ----

  private renderStageChrome(): void {
    const st = this.stageRect()
    const x = st.x + 16
    const y = st.y + 14
    // 播放键
    this.ui.playButton({ x, y: y + 1, w: 34, h: 34 }, this.playing, () => this.togglePlay())
    // 状态药丸
    const label = this.playing ? '运行中' : '已暂停'
    const ctx = this.ctx
    ctx.save()
    ctx.font = font(10.5, 650)
    const w = ctx.measureText(label).width + 26
    ctx.restore()
    const pill: Rect = { x: x + 42, y: y + 4, w, h: 28 }
    ctx.save()
    ctx.fillStyle = this.playing ? THEME.okSoft : 'rgba(29,32,37,0.05)'
    roundRect(ctx, pill.x, pill.y, pill.w, pill.h, 14)
    ctx.fill()
    ctx.restore()
    ctx.save()
    ctx.beginPath()
    ctx.arc(pill.x + 13, pill.y + 14, 3, 0, Math.PI * 2)
    ctx.fillStyle = this.playing ? THEME.ok : THEME.inkFaint
    ctx.fill()
    ctx.restore()
    this.ui.text(label, pill.x + 21, pill.y + 14.5, {
      size: 10.5,
      weight: 650,
      color: this.playing ? THEME.ok : THEME.inkSoft,
    })

    // 「题目初稿」标记：生成的模型不是终点，得让人知道它随时能改。
    // 只画不点——真正的修改入口是左侧检查器，别在这里多一个按钮抢注意力。
    if (this.fromProblem) {
      const tag = '题目初稿 · 可改'
      ctx.save()
      ctx.font = font(10, 600)
      const tw = ctx.measureText(tag).width + 20
      ctx.restore()
      const box: Rect = { x: pill.x + pill.w + 8, y: pill.y + 3, w: tw, h: 22 }
      ctx.save()
      ctx.fillStyle = 'rgba(124,58,237,0.08)'
      roundRect(ctx, box.x, box.y, box.w, box.h, 11)
      ctx.fill()
      ctx.restore()
      this.ui.text(tag, box.x + 10, box.y + 11.5, { size: 10, weight: 600, color: THEME.accent })
    }

    // 右上角：分享 / 世界
    const right = st.x + st.w - 14
    this.ui.iconButton({ x: right - 34, y: y + 2, w: 34, h: 32 }, 'share', {
      onClick: () => this.share(),
    })
    this.ui.iconButton({ x: right - 72, y: y + 2, w: 34, h: 32 }, 'orbit', {
      active: this.showWorld,
      quiet: true,
      onClick: () => {
        this.showWorld = !this.showWorld
        this.selectedId = null
        this.selectedConstraintId = null
      },
    })
  }

  private renderChartPanel(): void {
    const r = this.chartRect()
    if (!r) return
    const chart = this.doc.observers.find((o) => o.kind === 'chart')
    if (!chart || chart.kind !== 'chart') return
    this.ui.card(r, { radius: 12, fill: THEME.card, stroke: THEME.panelLine, shadow: false })
    const series: ChartSeries[] = []
    for (const s of chart.series) {
      const arr = this.chartA[s.bodyId]
      if (!arr || arr.length < 2) continue
      series.push({
        label: s.bodyId,
        color: THEME.accent,
        points: arr.map((v) => ({ x: chart.axis === 't' ? v.t : v.x, y: pickQuantity(v, s.quantity) })),
      })
    }
    drawChart(
      this.ctx,
      { x: r.x + 14, y: r.y + 12, w: r.w - 28, h: r.h - 24 },
      {
        title: chart.title ?? '观测',
        xLabel: chart.axis === 't' ? 't (s)' : 'x (m)',
        yLabel: chart.unit ?? '',
        series,
        emptyHint: '按播放，曲线自己长出来',
      },
    )
  }

  // ---- 左侧参数面板 ----

  private renderSidebar(): void {
    const p = this.panelRect()
    const ctx = this.ctx
    const narrow = this.width < 760
    ctx.save()
    ctx.fillStyle = THEME.panel
    ctx.fillRect(p.x, p.y, p.w, p.h)
    ctx.restore()
    // 和舞台之间的分隔线
    ctx.save()
    ctx.strokeStyle = THEME.panelLine
    ctx.lineWidth = 1
    ctx.beginPath()
    if (narrow) {
      ctx.moveTo(p.x, p.y + 0.5)
      ctx.lineTo(p.x + p.w, p.y + 0.5)
    } else {
      ctx.moveTo(p.w - 0.5, p.y)
      ctx.lineTo(p.w - 0.5, p.y + p.h)
    }
    ctx.stroke()
    ctx.restore()
    // 面板自己吞掉点击，别透到画布
    this.ui.add({ id: 'panel:bg', rect: p })

    const pad = narrow ? 16 : 18
    const innerW = p.w - pad * 2
    const body = findBody(this.doc, this.selectedId ?? '')
    const con = this.doc.constraints.find((c) => c.id === this.selectedConstraintId)
    const field = this.doc.fields.find((f): f is Extract<Field, { kind: 'uniform' }> => f.kind === 'uniform' && f.id === this.selectedFieldId)

    // 内容超出面板高度就滚动（窄屏尤其需要）
    const ctxClip = this.ctx
    ctxClip.save()
    ctxClip.beginPath()
    ctxClip.rect(p.x, p.y + (narrow ? 6 : 0), p.w, p.h - (narrow ? 6 : 0))
    ctxClip.clip()

    // ---- 头部 ----
    let y = p.y + (narrow ? 12 : 20) + this.panelScroll
    if (!narrow) {
      this.ui.text('SLOGAN', p.x + pad, y, {
        size: 8,
        weight: 700,
        color: THEME.inkFaint,
        mono: true,
        tracking: 1.4,
      })
      y += 18
    }
    const title = this.doc.meta.title || '未命名模型'
    this.ui.text(title, p.x + pad, y + 8, { size: narrow ? 16 : 18, weight: 650, maxWidth: innerW })
    y += narrow ? 26 : 30
    const subtitle = body
      ? `${body.label ?? body.id} · ${body.kind === 'static' ? '固定' : body.kind === 'kinematic' ? '匀速' : '可动'}`
      : field
        ? `${field.type === 'E' ? '电场' : '磁场'} · ${field.regionId ? '限定区域' : '全场'}`
      : con
        ? `${con.type === 'rope' ? '绳' : con.type === 'spring' ? '弹簧' : con.type}约束`
        : (this.doc.meta.tags ?? []).slice(0, 2).join(' · ') || this.doc.meta.note?.slice(0, 22) || '点一下物体看参数'
    this.ui.text(subtitle, p.x + pad, y, { size: 9.5, color: THEME.inkSoft, maxWidth: innerW })
    y += 18

    // ---- 工具行 ----
    const toolSize = narrow ? 32 : 30
    const toolGap = 4
    // 8 个工具在窄面板里一行放不下：算出来的行数如果是「7+1」，就改成 4+4 对称排
    const fit = Math.max(4, Math.floor((innerW + toolGap) / (toolSize + toolGap)))
    const perRow = Math.ceil(TOOLS.length / Math.ceil(TOOLS.length / fit))
    TOOLS.forEach((tool, i) => {
      const col = i % perRow
      const row = Math.floor(i / perRow)
      const rect: Rect = {
        x: p.x + pad + col * (toolSize + toolGap),
        y: y + row * (toolSize + toolGap),
        w: toolSize,
        h: toolSize,
      }
      this.ui.iconButton(rect, tool.icon, {
        active: this.tool === tool.id,
        onClick: () => this.pickTool(tool.id),
      })
      this.ui.add({ id: `tool:${tool.id}`, rect, cursor: 'pointer', onClick: () => this.pickTool(tool.id) })
    })
    const toolRows = Math.ceil(TOOLS.length / perRow)
    y += toolRows * (toolSize + toolGap) + 6
    this.ui.divider(p.x + pad, y, p.x + p.w - pad, y)
    y += 12

    // ---- 参数 ----
    this.ui.text(body ? '物体参数' : field ? '场的参数' : con ? '约束参数' : '参数', p.x + pad, y, {
      size: 10,
      weight: 700,
      color: THEME.inkFaint,
      tracking: 0.4,
    })
    y += 16
    if (body) y = this.renderBodyParams(p.x + pad, y, innerW, body)
    else if (field) y = this.renderFieldParams(p.x + pad, y, innerW, field)
    else if (con) y = this.renderConstraintParams(p.x + pad, y, innerW, con)
    else y = this.renderSceneParams(p.x + pad, y, innerW)

    // ---- 主按钮 ----
    const btnW = innerW
    this.ui.pillButton({ x: p.x + pad, y, w: btnW, h: 42 }, '重新开始', {
      active: true,
      size: 12.5,
      weight: 650,
      onClick: () => {
        this.playing = false
        this.reset()
      },
    })
    y += 48
    this.ui.pillButton({ x: p.x + pad, y, w: btnW, h: 36 }, '重置视图', {
      size: 11,
      weight: 600,
      onClick: () => {
        this.playing = false
        this.reset()
        this.applyCamera()
      },
    })
    y += 44

    // ---- 假设（可点） ----
    const toggles = assumptionToggles(this.doc)
    if (toggles.length) {
      let cx = p.x + pad
      for (const t of toggles.slice(0, 3)) {
        const opt = t.options.find((o) => o.value === t.value)
        const label = `${t.label}：${opt?.label ?? t.value}`
        const w = Math.min(innerW - (cx - p.x - pad), 20 + label.length * 10)
        if (w < 40) break
        const rect: Rect = { x: cx, y, w, h: 26 }
        this.ui.pillButton(rect, label, {
          size: 9.5,
          weight: 600,
          onClick: () => this.toggleAssumption(t.id),
        })
        this.ui.add({ id: `assume:${t.id}`, rect, cursor: 'pointer', onClick: () => this.toggleAssumption(t.id) })
        cx += w + 6
        if (cx > p.x + p.w - pad - 30) break
      }
      y += 34
    }

    // ---- 底部：读数 + 入口（宽屏钉在底部，窄屏跟着内容滚） ----
    let linkY = p.y + p.h - (narrow ? 4 : 8)
    if (narrow) {
      this.renderReadouts(p.x + pad, y, innerW, 96)
      y += 104
      linkY = y + 24
    } else {
      const footH = 104
      const footY = p.y + p.h - footH - 16
      this.renderReadouts(p.x + pad, footY, innerW, footH)
    }
    this.panelMaxScroll = Math.max(0, y + 40 - (p.y + p.h))
    this.panelScroll = clamp(this.panelScroll, -this.panelMaxScroll, 0)

    const links: Array<[string, () => void]> = [
      ['世界', () => {
        this.showWorld = !this.showWorld
        this.selectedId = null
        this.selectedConstraintId = null
      }],
      ['组件', () => {
        this.componentsOpen = !this.componentsOpen
        this.selectedId = null
        this.selectedFieldId = null
        this.showWorld = false
      }],
      ['题目', () => this.askGenerate()],
      ['返回', () => this.toLibrary()],
    ]
    let lx = p.x + pad
    for (const [label, fn] of links) {
      const w = 16 + label.length * 10
      if (lx + w > p.x + p.w - pad) break
      this.ui.pillButton({ x: lx, y: linkY - 24, w, h: 22 }, label, {
        size: 9.5,
        weight: 600,
        onClick: fn,
      })
      lx += w + 6
    }
    ctxClip.restore()
  }

  /** 场景参数：题干用词的那几个（θ、μ、v₀、R…） */
  private renderSceneParams(x: number, y0: number, w: number): number {
    let y = y0
    const params = sceneParams(this.doc).slice(0, 4)
    if (!params.length) {
      this.ui.text('这个场景没有可调参数', x, y + 8, { size: 10, color: THEME.inkFaint })
      y += 24
    }
    for (const meta of params) {
      this.ui.slider({ x, y, w, h: 48 }, {
        id: `scene:${meta.key}`,
        label: meta.label,
        value: this.doc.params[meta.key] ?? meta.min,
        min: meta.min,
        max: meta.max,
        step: meta.step,
        unit: meta.unit ? ` ${meta.unit}` : '',
        decimals: meta.decimals,
        onScrubStart: () => this.pushHistory(),
        onChange: (v) => {
          this.doc = { ...this.doc, params: { ...this.doc.params, [meta.key]: v } }
          if (this.presetId) {
            presetById(this.presetId)?.layout?.(this.doc)
            applyEdits(this.doc)
          }
          this.rebuild()
        },
      })
      y += 56
    }
    return y
  }

  /** 物体参数：质量 / 摩擦 / 电荷 / 半径或长度 / 角度 / 初速度 */
  private renderBodyParams(x: number, y0: number, w: number, body: Body): number {
    let y = y0
    const isStatic = body.kind === 'static' || body.kind === 'kinematic'
    this.ui.slider({ x, y, w, h: 48 }, {
      id: 'body-mass',
      label: '质量 m',
      value: body.mass ?? 0.5,
      min: 0.05,
      max: 5,
      step: 0.05,
      unit: ' kg',
      decimals: 2,
      onScrubStart: () => this.pushHistory(),
      onChange: (v) => this.setBodyMass(body.id, v),
    })
    y += 56
    this.ui.slider({ x, y, w, h: 62 }, {
      id: 'body-mu',
      label: '摩擦系数 μ',
      value: body.friction ?? findMaterial(this.doc, body.material)?.mu ?? 0.3,
      min: 0,
      max: 0.8,
      step: 0.01,
      decimals: 2,
      hintLeft: '光滑 (0)',
      hintRight: '粗糙 (0.8)',
      onScrubStart: () => this.pushHistory(),
      onChange: (v) => this.setBodyFriction(body.id, v),
    })
    y += 74
    if (body.shape.type === 'circle' || body.shape.type === 'arc') {
      this.ui.slider({ x, y, w, h: 48 }, {
        id: 'body-r',
        label: body.shape.type === 'circle' ? '半径 r' : '圆弧半径 R',
        value: body.shape.r,
        min: 0.04,
        max: 2,
        step: 0.01,
        unit: ' m',
        decimals: 2,
        onScrubStart: () => this.pushHistory(),
        onChange: (v) => this.setBodyRadius(body.id, v),
      })
      y += 56
    } else if (body.shape.type === 'polyline' || body.shape.type === 'polygon') {
      const len = shapeLength(body.shape)
      this.ui.slider({ x, y, w, h: 48 }, {
        id: 'body-len',
        label: '长度 L',
        value: len,
        min: 0.2,
        max: 6,
        step: 0.05,
        unit: ' m',
        decimals: 2,
        onScrubStart: () => this.pushHistory(),
        onChange: (v) => this.setBodyLength(body.id, v),
      })
      y += 56
    }
    if (!isStatic) {
      const v = body.velocity ?? { x: 0, y: 0 }
      const mag = Math.hypot(v.x, v.y)
      const ang = mag > 1e-6 ? (Math.atan2(v.y, v.x) * 180) / Math.PI : 0
      this.ui.slider({ x, y, w, h: 48 }, {
        id: 'body-v0',
        label: '初速度 v₀',
        value: mag,
        min: 0,
        max: 15,
        step: 0.1,
        unit: ' m/s',
        decimals: 2,
        onScrubStart: () => this.pushHistory(),
        onChange: (m) => this.setBodyVelocity(body.id, m, ang),
      })
      y += 56
    }
    // 角色 + 更多
    const w2 = (w - 6) / 2
    const role = body.role ?? (body.kind === 'static' ? 'terrain' : 'object')
    this.ui.pillButton({ x, y, w: w2, h: 28 }, role === 'terrain' ? '地形（固定）' : role === 'track' ? '轨道' : '物体（可动）', {
      size: 9.5,
      weight: 600,
      onClick: () => this.cycleClassification(body.id),
    })
    this.ui.pillButton({ x: x + w2 + 6, y, w: w2, h: 28 }, '删除', {
      size: 9.5,
      weight: 600,
      onClick: () => this.deleteSelected(),
    })
    y += 34
    // 觉得这一坨好用 → 存成组件，以后任何场景都能插
    const saveBtn: Rect = { x, y, w, h: 28 }
    this.ui.pillButton(saveBtn, '＋ 存为组件', {
      size: 9.5,
      weight: 600,
      onClick: () => this.saveComponent(),
    })
    this.ui.add({ id: 'comp:save', rect: saveBtn, cursor: 'pointer', onClick: () => this.saveComponent() })
    y += 34
    return y
  }

  /** 场的参数：E 是「大小 + 方向角」，B 是「大小 + 向外/向里」 */
  private renderFieldParams(x: number, y0: number, w: number, field: Extract<Field, { kind: 'uniform' }>): number {
    let y = y0
    if (field.kind !== 'uniform') return y
    if (field.type === 'E') {
      const mag = Math.hypot(field.vector.x, field.vector.y)
      const deg = (((Math.atan2(field.vector.y, field.vector.x) * 180) / Math.PI) + 360) % 360
      this.ui.slider({ x, y, w, h: 48 }, {
        id: 'field-mag',
        label: '场强 E',
        value: mag,
        min: 0,
        max: 120,
        step: 1,
        unit: ' N/C',
        decimals: 0,
        onScrubStart: () => this.pushHistory(),
        onChange: (v) => this.setFieldMagnitude(field.id, v),
      })
      y += 56
      this.ui.slider({ x, y, w, h: 48 }, {
        id: 'field-angle',
        label: '方向',
        value: deg,
        min: 0,
        max: 360,
        step: 5,
        unit: '°',
        decimals: 0,
        hintLeft: '向右 0°',
        hintRight: '向上 90°',
        onScrubStart: () => this.pushHistory(),
        onChange: (v) => this.setFieldAngle(field.id, v),
      })
      y += 66
    } else if (field.type === 'B') {
      this.ui.slider({ x, y, w, h: 48 }, {
        id: 'field-mag',
        label: '磁感应强度 B',
        value: Math.abs(field.bz),
        min: 0,
        max: 6,
        step: 0.1,
        decimals: 1,
        onScrubStart: () => this.pushHistory(),
        onChange: (v) => this.setFieldMagnitude(field.id, v),
      })
      y += 56
      this.ui.segmented({ x, y, w: Math.min(w, 220), h: 44 }, {
        id: 'field-dir',
        label: '方向',
        options: [
          { label: '向外 ·', value: 'out' },
          { label: '向里 ×', value: 'in' },
        ],
        value: field.bz >= 0 ? 'out' : 'in',
        onChange: (v) => {
          this.pushHistory()
          this.setFieldSign(field.id, v === 'out' ? 1 : -1)
        },
      })
      y += 52
    }
    this.ui.pillButton({ x, y, w: 96, h: 24 }, '删除这块场', {
      size: 9,
      weight: 600,
      onClick: () => this.removeField(field.id),
    })
    y += 30
    if (!field.regionId) {
      this.ui.text('这块场作用于整个场景', x, y + 6, { size: 9, color: THEME.inkFaint, maxWidth: w })
      y += 18
    }
    return y
  }

  private renderConstraintParams(x: number, y0: number, w: number, con: Constraint): number {
    let y = y0
    if (con.type === 'rope' || con.type === 'rod') {
      this.ui.slider({ x, y, w, h: 48 }, {
        id: 'con-len',
        label: '长度 L',
        value: con.length,
        min: 0.2,
        max: 6,
        step: 0.05,
        unit: ' m',
        decimals: 2,
        onScrubStart: () => this.pushHistory(),
        onChange: (v) => this.setConstraintValue(con.id, 'length', v),
      })
      y += 56
    } else if (con.type === 'spring') {
      this.ui.slider({ x, y, w, h: 48 }, {
        id: 'con-k',
        label: '劲度系数 k',
        value: con.k,
        min: 5,
        max: 200,
        step: 5,
        unit: ' N/m',
        decimals: 0,
        onScrubStart: () => this.pushHistory(),
        onChange: (v) => this.setConstraintValue(con.id, 'k', v),
      })
      y += 56
    }
    this.ui.pillButton({ x, y, w, h: 28 }, '删除这个约束', {
      size: 9.5,
      weight: 600,
      onClick: () => this.deleteSelected(),
    })
    y += 34
    return y
  }

  private renderReadouts(x: number, y: number, w: number, h: number): void {
    const ctx = this.ctx
    ctx.save()
    ctx.fillStyle = THEME.panelSoft
    roundRect(ctx, x, y, w, h, 12)
    ctx.fill()
    ctx.restore()
    const body = this.focusBody(this.doc)
    const state = body ? this.simA?.state.bodies[body.id] : undefined
    const speed = state ? Math.hypot(state.vx, state.vy) : 0
    const t = this.simA?.state.t ?? 0
    const dx = body && state ? Math.abs(state.x - body.transform.x) : 0
    const rows: Array<[string, string]> = [
      ['当前速度', `${speed.toFixed(2)} m/s`],
      ['已运行', `${t.toFixed(2)} s`],
      ['位移', `${dx.toFixed(2)} m`],
    ]
    let ry = y + 20
    for (const [label, value] of rows) {
      this.ui.text(label, x + 12, ry, { size: 9.5, color: THEME.inkSoft })
      this.ui.text(value, x + w - 12, ry, { size: 11, weight: 650, align: 'right', mono: true })
      ry += 22
    }
    const chips = this.criteriaChips(this.doc, this.simA)
    if (chips.length) {
      let cx = x + 12
      for (const c of chips.slice(0, 2)) {
        const cw = this.ui.chip(cx, y + h - 12, c.label, c.color)
        cx += cw + 5
        if (cx > x + w - 14) break
      }
    }
  }

  /** 工具点击：统一在这里清掉「待选区」之类的一次性状态 */
  private pickTool(id: Tool): void {
    this.tool = id
    this.selectedId = null
    this.selectedConstraintId = null
    this.selectedFieldId = null
    if (id !== 'connect') this.linkFrom = null
    if (id === 'ink' && this.ink.length === 0) this.toast('批注：在模型上直接写；切到橡皮擦可以擦')
    if (id === 'fieldE') this.toast('电场：按住拖一块区域；拖太小 = 全场。建完在左侧调场强和方向')
    if (id === 'fieldB') this.toast('磁场：按住拖一块区域；建完在左侧调强度和向外/向里')
    if (id === 'pen') this.toast('画什么都行：圆、方块、直线会自动规整')
  }

  private visualState(): VisualState | null {
    const sim = this.simA
    if (!sim) return null
    return { bodies: sim.state.bodies as Record<string, BodyVisual>, trackAttached: sim.state.trackAttached, gases: sim.state.gases }
  }

  private chainRect(): Rect {
    const w = Math.min(this.width - 24, 660)
    const h = Math.min(this.height - 170, 430)
    return { x: (this.width - w) / 2, y: 84 + this.insets.top, w, h }
  }

  private addChainStage(kind: ChainStageKind): void {
    if (this.chainStages.length >= 4) {
      this.toast('最多 4 段；先把不需要的删掉')
      return
    }
    const stage: ChainStage =
      kind === 'slope' || kind === 'upslope'
        ? { kind, angle: 35, length: 2.5, radius: 1, arcDeg: 60 }
        : kind === 'flat'
          ? { kind, angle: 0, length: 2, radius: 1, arcDeg: 60 }
          : { kind, angle: 0, length: 1, radius: 0.9, arcDeg: 60 }
    this.chainStages = [...this.chainStages, stage]
    this.chainSelected = this.chainStages.length - 1
  }

  private updateChainStage(index: number, patch: Partial<ChainStage>): void {
    this.chainStages = this.chainStages.map((s, i) => (i === index ? { ...s, ...patch } : s))
  }

  private removeChainStage(index: number): void {
    this.chainStages = this.chainStages.filter((_, i) => i !== index)
    this.chainSelected = Math.max(0, Math.min(this.chainSelected, this.chainStages.length - 1))
  }

  private insertChain(): void {
    if (this.chainStages.length === 0) return
    this.pushHistory()
    const bounds = this.camera.visibleBounds()
    const others = this.doc.bodies.filter((b) => b.id !== 'ground')
    let start = { x: bounds.minX + 1.4, y: Math.max(1.8, bounds.maxY - 0.6) }
    if (others.length) {
      let maxX = -Infinity
      let topY = -Infinity
      for (const b of others) {
        const box = bodyAABB(b.shape, b.transform)
        maxX = Math.max(maxX, box.max.x)
        topY = Math.max(topY, box.max.y)
      }
      start = { x: maxX + 0.8, y: Math.max(1.8, topY + 0.4) }
    }
    this.chainSeq++
    const prefix = 'chain' + this.chainSeq
    const built = buildChain(this.chainStages, start, prefix)
    const ballId = built.ball.id
    const observers = [
      ...this.doc.observers,
      { id: ballId + '-trail', kind: 'trail' as const, bodyId: ballId, len: 1200 },
      { id: ballId + '-vel', kind: 'vector' as const, bodyId: ballId, which: ['v' as const], scale: 0.2 },
      { id: ballId + '-chart', kind: 'chart' as const, axis: 't' as const, series: [{ bodyId: ballId, quantity: 'v' as const }], title: 'v–t', unit: 'm/s' },
    ]
    const pairs = [...this.doc.contactPairs]
    for (const p of built.contactPairs) {
      if (!pairs.some((q) => q.a === p.a && q.b === p.b)) pairs.push(p)
    }
    this.doc = {
      ...this.doc,
      bodies: [...this.doc.bodies, ...built.bodies, built.ball],
      contactPairs: pairs,
      observers,
      world: { ...this.doc.world, duration: 6 },
    }
    this.rebuild()
    this.chainOpen = false
    this.tool = 'select'
    this.selectedId = null
    this.selectedConstraintId = null
    this.fitCamera()
    this.toast('已插入多过程链；每段都可继续编辑')
  }

  private renderChainPanel(): void {
    const r = this.chainRect()
    this.ui.card(r, { radius: 16, stroke: THEME.hairline, shadow: true })
    const pad = 16
    this.ui.text('多过程链', r.x + pad, r.y + 26, { size: 15, weight: 700 })
    this.ui.text('按顺序拼；插入后每段仍是可编辑地形', r.x + pad, r.y + 44, { size: 10, color: THEME.inkSoft })
    this.ui.iconButton({ x: r.x + r.w - 42, y: r.y + 12, w: 30, h: 30 }, 'close', {
      onClick: () => {
        this.chainOpen = false
      },
    })

    let y = r.y + 62
    const kinds: Array<[ChainStageKind, string]> = [
      ['slope', '斜面'],
      ['flat', '水平'],
      ['arc', '圆弧'],
      ['upslope', '上坡'],
    ]
    const bw = Math.min(72, (r.w - pad * 2 - 12) / 4)
    kinds.forEach(([kind, label], i) => {
      this.ui.pillButton({ x: r.x + pad + i * (bw + 4), y, w: bw, h: 28 }, label, {
        size: 10,
        onClick: () => this.addChainStage(kind),
      })
    })
    y += 40

    this.ui.text('阶段', r.x + pad, y, { size: 10, weight: 600, color: THEME.inkSoft })
    y += 12
    const rowH = 34
    this.chainStages.forEach((stage, i) => {
      const row: Rect = { x: r.x + pad, y: y + i * rowH, w: r.w - pad * 2, h: rowH - 4 }
      if (i === this.chainSelected) {
        this.ctx.save()
        this.ctx.fillStyle = rgba(THEME.ink, 0.06)
        roundRect(this.ctx, row.x, row.y, row.w, row.h, 8)
        this.ctx.fill()
        this.ctx.restore()
      }
      this.ui.add({ id: 'chain-row-' + i, rect: row, cursor: 'pointer', onClick: () => (this.chainSelected = i) })
      this.ui.text(String(i + 1).padStart(2, '0'), row.x + 6, row.y + row.h / 2 + 3, {
        size: 10,
        mono: true,
        color: THEME.inkFaint,
      })
      this.ui.text(stageLabel(stage), row.x + 30, row.y + row.h / 2 + 3, { size: 11, weight: 550 })
      this.ui.iconButton({ x: row.x + row.w - 28, y: row.y + 2, w: 24, h: 24 }, 'trash', {
        size: 12,
        onClick: () => this.removeChainStage(i),
      })
    })
    y += this.chainStages.length * rowH + 6

    const stage = this.chainStages[this.chainSelected]
    if (stage) {
      if (stage.kind === 'slope' || stage.kind === 'upslope') {
        this.ui.slider(
          { x: r.x + pad, y, w: r.w - pad * 2, h: 40 },
          {
            id: 'chain-angle',
            label: '角度',
            value: stage.angle,
            min: 10,
            max: 70,
            step: 1,
            decimals: 0,
            unit: '°',
            onChange: (v) => this.updateChainStage(this.chainSelected, { angle: v }),
          },
        )
        y += 44
        this.ui.slider(
          { x: r.x + pad, y, w: r.w - pad * 2, h: 40 },
          {
            id: 'chain-length',
            label: '长度',
            value: stage.length,
            min: 1,
            max: 5,
            step: 0.1,
            decimals: 1,
            unit: ' m',
            onChange: (v) => this.updateChainStage(this.chainSelected, { length: v }),
          },
        )
        y += 44
      } else if (stage.kind === 'flat') {
        this.ui.slider(
          { x: r.x + pad, y, w: r.w - pad * 2, h: 40 },
          {
            id: 'chain-length',
            label: '长度',
            value: stage.length,
            min: 1,
            max: 6,
            step: 0.1,
            decimals: 1,
            unit: ' m',
            onChange: (v) => this.updateChainStage(this.chainSelected, { length: v }),
          },
        )
        y += 44
      } else {
        this.ui.slider(
          { x: r.x + pad, y, w: r.w - pad * 2, h: 40 },
          {
            id: 'chain-radius',
            label: '半径',
            value: stage.radius,
            min: 0.4,
            max: 2,
            step: 0.05,
            decimals: 2,
            unit: ' m',
            onChange: (v) => this.updateChainStage(this.chainSelected, { radius: v }),
          },
        )
        y += 44
        this.ui.slider(
          { x: r.x + pad, y, w: r.w - pad * 2, h: 40 },
          {
            id: 'chain-arcdeg',
            label: '圆心角',
            value: stage.arcDeg,
            min: 20,
            max: 100,
            step: 5,
            decimals: 0,
            unit: '°',
            onChange: (v) => this.updateChainStage(this.chainSelected, { arcDeg: v }),
          },
        )
        y += 44
      }
    }

    const fy = r.y + r.h - 46
    this.ui.pillButton({ x: r.x + pad, y: fy, w: 76, h: 32 }, '清空', {
      size: 10,
      onClick: () => {
        this.chainStages = []
        this.chainSelected = 0
      },
    })
    this.ui.pillButton({ x: r.x + r.w - pad - 112, y: fy, w: 112, h: 32 }, '插入画布', {
      active: this.chainStages.length > 0,
      size: 11,
      weight: 650,
      onClick: () => this.insertChain(),
    })
  }

  private renderDock(): void {
    const r = this.dockRect()
    this.ui.card(r, { radius: 16, stroke: THEME.panelLine, shadow: true })
    if (this.selectedConstraintId) this.renderConstraintSheet(r)
    else if (this.selectedId) this.renderBodySheet(r)
    else if (this.showWorld) this.renderWorldSheet(r)
  }

  // -------------------------------------------------------------------------
  // 底部：组件检查器 / 约束检查器 / 世界 / 状态条
  // -------------------------------------------------------------------------

  /** 点假设：循环到下一个取值，重算几何 */
  private toggleAssumption(id: string): void {
    const res = cycleAssumption(this.doc, id)
    if (!res) return
    this.pushHistory()
    this.doc = res.scene
    this.rebuild()
    const opt = res.toggle.options.find((o) => o.value === res.toggle.value)
    this.toast(`${res.toggle.label} → ${opt?.label ?? res.toggle.value}`)
  }

  private renderBodySheet(r: Rect): void {
    const body = findBody(this.doc, this.selectedId ?? '')
    if (!body) {
      this.selectedId = null
      return
    }
    const pad = 16
    const isStatic = body.kind === 'static' || body.kind === 'kinematic'
    const role = body.role ?? (body.kind === 'static' ? 'terrain' : 'object')
    this.ui.text(body.label ?? body.id, r.x + pad, r.y + 27, { size: 13, weight: 700 })
    this.ui.text(role === 'terrain' ? '地形' : role === 'track' ? '轨道' : '物体', r.x + pad + 86, r.y + 27, {
      size: 9.5,
      color: THEME.inkSoft,
      tracking: 0.2,
    })
    this.ui.iconButton({ x: r.x + r.w - 76, y: r.y + 10, w: 30, h: 30 }, 'trash', {
      onClick: () => this.deleteSelected(),
    })
    this.ui.iconButton({ x: r.x + r.w - 42, y: r.y + 10, w: 30, h: 30 }, 'close', {
      onClick: () => this.selectBody(null),
    })
    const thinStyle = body.appearance.style === 'thin'
    this.ui.pillButton({ x: r.x + r.w - 128, y: r.y + 12, w: 46, h: 26 }, thinStyle ? '细线' : '实心', {
      active: thinStyle,
      size: 9.5,
      onClick: () => this.setBodyStyle(body.id, thinStyle ? 'solid' : 'thin'),
    })

    const s = this.simA?.state.bodies[body.id]
    const mass = s?.mass ?? body.mass ?? 0
    const speed = s ? Math.hypot(s.vx, s.vy) : Math.hypot(body.velocity?.x ?? 0, body.velocity?.y ?? 0)
    const posY = s ? s.y : body.transform.y
    this.ui.text(
      `v ${speed.toFixed(2)} m/s   ·   m ${mass.toFixed(2)} kg   ·   h ${posY.toFixed(2)} m`,
      r.x + pad,
      r.y + 47,
      { size: 9.5, color: THEME.inkSoft, maxWidth: r.w - 100, mono: true },
    )

    const half = (r.w - pad * 2 - 10) / 2
    let y = r.y + 60
    const deg = (body.transform.angle * 180) / Math.PI
    this.ui.slider(
      { x: r.x + pad, y, w: half, h: 40 },
      {
        id: 'body-angle',
        label: '角度',
        value: deg,
        min: -180,
        max: 180,
        step: 0.5,
        decimals: 1,
        unit: '°',
        onScrubStart: () => {
          this.playing = false
          this.pushHistory()
        },
        onScrubEnd: () => {},
        onChange: (v) => this.setBodyAngle(body.id, v),
      },
    )
    const mu = body.friction ?? findMaterial(this.doc, body.material)?.mu ?? 0.3
    this.ui.slider(
      { x: r.x + pad + half + 10, y, w: half, h: 40 },
      {
        id: 'body-mu',
        label: '摩擦 μ',
        value: mu,
        min: 0,
        max: 1,
        step: 0.05,
        decimals: 2,
        onScrubStart: () => {
          this.playing = false
          this.pushHistory()
        },
        onScrubEnd: () => {},
        onChange: (v) => this.setBodyFriction(body.id, v),
      },
    )
    y += 54
    if (this.doc.world.interactions?.coulomb) {
      this.ui.slider(
        { x: r.x + pad, y, w: r.w - pad * 2, h: 40 },
        {
          id: 'body-charge',
          label: '电荷 q',
          value: body.charge ?? 0,
          min: -5,
          max: 5,
          step: 0.1,
          decimals: 1,
          onScrubStart: () => {
            this.playing = false
            this.pushHistory()
          },
          onScrubEnd: () => {},
          onChange: (v) => this.setBodyCharge(body.id, v),
        },
      )
      y += 54
    }

    const geometry =
      body.shape.type === 'circle' || body.shape.type === 'arc'
        ? { kind: 'radius' as const, value: body.shape.r }
        : body.shape.type === 'polyline' || body.shape.type === 'polygon'
          ? { kind: 'length' as const, value: shapeLength(body.shape) }
          : body.id === 'loop' && this.doc.params.R !== undefined
            ? { kind: 'loop' as const, value: this.doc.params.R ?? 0.6 }
            : body.id === 'board' && this.doc.params.l !== undefined
              ? { kind: 'boardL' as const, value: this.doc.params.l ?? 1 }
              : body.id === 'platform' && this.doc.params.h !== undefined
                ? { kind: 'platformH' as const, value: this.doc.params.h ?? 0.8 }
                : null
    if (geometry) {
      const isRadius = geometry.kind === 'radius'
      const isLength = geometry.kind === 'length'
      const isBoardL = geometry.kind === 'boardL'
      const isPlatformH = geometry.kind === 'platformH'
      this.ui.slider(
        { x: r.x + pad, y, w: r.w - pad * 2, h: 40 },
        {
          id: 'body-geometry',
          label: isRadius ? '半径' : isLength ? '长度' : isBoardL ? '板长' : isPlatformH ? '平台高度' : '轨道半径',
          value: geometry.value,
          min: isRadius ? 0.05 : isLength ? 0.3 : isBoardL ? 0.4 : isPlatformH ? 0.2 : 0.3,
          max: isRadius ? 3 : isLength ? 8 : isBoardL ? 2 : isPlatformH ? 3 : 0.7,
          step: isLength || isBoardL || isPlatformH ? 0.05 : 0.01,
          decimals: 2,
          onScrubStart: () => {
            this.playing = false
            this.pushHistory()
          },
          onScrubEnd: () => {},
          onChange: (v) => {
            if (isRadius) this.setBodyRadius(body.id, v)
            else if (isLength) this.setBodyLength(body.id, v)
            else if (isBoardL) this.setBoardParam('l', v)
            else if (isPlatformH) this.setBoardParam('h', v)
            else this.setLoopRadius(v)
          },
        },
      )
      y += 54
      this.ui.text('几何为相对模型尺寸，不必等于真实米数', r.x + pad, y, {
        size: 8.5,
        color: THEME.inkFaint,
        maxWidth: r.w - pad * 2,
      })
      y += 14
    }

    if (!isStatic) {
      const vx = body.velocity?.x ?? 0
      const vy = body.velocity?.y ?? 0
      const mag = Math.hypot(vx, vy)
      const phi = (Math.atan2(vy, vx) * 180) / Math.PI
      this.ui.slider(
        { x: r.x + pad, y, w: half, h: 40 },
        {
          id: 'body-v',
          label: '初速度 v₀',
          value: mag,
          min: 0,
          max: 12,
          step: 0.1,
          decimals: 2,
          unit: ' m/s',
          onScrubStart: () => {
            this.playing = false
            this.pushHistory()
          },
          onScrubEnd: () => {},
          onChange: (v) => this.setBodyVelocity(body.id, v, phi),
        },
      )
      this.ui.slider(
        { x: r.x + pad + half + 10, y, w: half, h: 40 },
        {
          id: 'body-phi',
          label: '方向',
          value: phi,
          min: -180,
          max: 180,
          step: 1,
          decimals: 0,
          unit: '°',
          onScrubStart: () => {
            this.playing = false
            this.pushHistory()
          },
          onScrubEnd: () => {},
          onChange: (v) => this.setBodyVelocity(body.id, mag, v),
        },
      )
      y += 50
      this.ui.text(`v₀ ${mag.toFixed(2)} m/s · ${phi.toFixed(0)}°（水平 0°）`, r.x + pad, y, {
        size: 9,
        color: THEME.inkSoft,
        maxWidth: r.w - pad * 2,
        mono: true,
      })
      y += 14
      // 质量 + 添加外力
      const halfW = (r.w - pad * 2 - 10) / 2
      this.ui.slider(
        { x: r.x + pad, y, w: halfW, h: 40 },
        {
          id: 'body-mass',
          label: '质量',
          value: body.mass ?? 0.2,
          min: 0.05,
          max: 5,
          step: 0.05,
          decimals: 2,
          unit: ' kg',
          onScrubStart: () => {
            this.playing = false
            this.pushHistory()
          },
          onScrubEnd: () => {},
          onChange: (v) => this.setBodyMass(body.id, v),
        },
      )
      this.ui.pillButton({ x: r.x + pad + halfW + 10, y: y + 8, w: halfW, h: 30 }, '＋ 添加外力', {
        onClick: () => this.addBodyForce(body.id),
        size: 10,
      })
      y += 48

      const forces = body.forces ?? []
      if (forces.length) {
        let cx = r.x + pad
        const chipY = y
        forces.forEach((f, i) => {
          const color = THEME.forceColors[i % THEME.forceColors.length]!
          const mag = Math.hypot(f.x, f.y)
          const text = `F${i + 1} ${mag.toFixed(0)}N`
          this.ui.ctx.save()
          this.ui.ctx.font = font(10, 700)
          const w = this.ui.ctx.measureText(text).width + 16
          this.ui.ctx.restore()
          if (cx + w > r.x + r.w - pad - 34) return
          const active = this.selectedForceId === f.id
          this.ui.ctx.save()
          this.ui.ctx.fillStyle = active ? color : 'rgba(255,255,255,0.9)'
          roundRect(this.ui.ctx, cx, chipY, w, 24, 8)
          this.ui.ctx.fill()
          this.ui.ctx.strokeStyle = active ? color : 'rgba(35,39,47,0.16)'
          this.ui.ctx.lineWidth = 1.2
          this.ui.ctx.stroke()
          this.ui.ctx.restore()
          this.ui.text(text, cx + w / 2, chipY + 12, {
            size: 10,
            weight: 700,
            color: active ? THEME.white : color,
            align: 'center',
          })
          this.ui.add({
            id: `force:${f.id}`,
            rect: { x: cx, y: chipY, w, h: 24 },
            cursor: 'pointer',
            onClick: () => {
              this.selectedForceId = this.selectedForceId === f.id ? null : f.id
            },
          })
          cx += w + 6
        })
        if (this.selectedForceId) {
          this.ui.iconButton({ x: r.x + r.w - pad - 28, y: chipY - 2, w: 26, h: 26 }, 'trash', {
            onClick: () => this.removeBodyForce(body.id, this.selectedForceId!),
          })
        }
        y += 28
        const sel = forces.find((f) => f.id === this.selectedForceId)
        if (sel) {
          const mag = Math.hypot(sel.x, sel.y)
          const phi = (Math.atan2(sel.y, sel.x) * 180) / Math.PI
          this.ui.slider(
            { x: r.x + pad, y, w: halfW, h: 40 },
            {
              id: 'force-mag',
              label: '外力大小',
              value: mag,
              min: 0,
              max: 30,
              step: 0.5,
              decimals: 1,
              unit: ' N',
              onScrubStart: () => {
                this.playing = false
                this.pushHistory()
              },
              onScrubEnd: () => {},
              onChange: (v) => this.setForceVector(body.id, sel.id, v, phi),
            },
          )
          this.ui.slider(
            { x: r.x + pad + halfW + 10, y, w: halfW, h: 40 },
            {
              id: 'force-dir',
              label: '方向',
              value: phi,
              min: -180,
              max: 180,
              step: 1,
              decimals: 0,
              unit: '°',
              onScrubStart: () => {
                this.playing = false
                this.pushHistory()
              },
              onScrubEnd: () => {},
              onChange: (v) => this.setForceVector(body.id, sel.id, mag, v),
            },
          )
          y += 54
        }
      }

    }

    const shape = body.shape
    const isTrackShape = shape.type === 'arc' || shape.type === 'circle'
    const ball = this.doc.bodies.find(
      (b) => b.id !== body.id && (b.kind === 'particle' || b.kind === 'rigid') && b.shape.type === 'circle',
    )
    const trackC = this.doc.constraints.find((c) => c.type === 'track' && c.centerBodyId === body.id)
    if (isTrackShape && ball && role === 'terrain') {
      this.ui.pillButton(
        { x: r.x + pad, y, w: Math.min(240, r.w - pad * 2), h: 28 },
        trackC ? '小球贴着轨道走：开' : '让小球贴着轨道走',
        {
          active: !!trackC,
          onClick: () => {
            if (trackC) {
              this.doc = { ...this.doc, constraints: this.doc.constraints.filter((c) => c.id !== trackC.id) }
              this.rebuild()
              this.toast('已取消轨道连接')
            } else {
              this.attachTrack(body)
              this.rebuild()
            }
          },
          size: 10,
        },
      )
      y += 32
    }
  }

  private renderConstraintSheet(r: Rect): void {
    const c = this.doc.constraints.find((x) => x.id === this.selectedConstraintId)
    if (!c) {
      this.selectedConstraintId = null
      return
    }
    const pad = 16
    const label = c.type === 'rope' ? '绳' : c.type === 'rod' ? '杆' : c.type === 'spring' ? '弹簧' : '铰链'
    this.ui.text(label, r.x + pad, r.y + 24, { size: 13, weight: 700 })
    this.ui.text(c.type === 'track' ? '轨道约束' : '连接约束', r.x + pad + 46, r.y + 24, { size: 10, color: THEME.inkSoft })
    this.ui.iconButton({ x: r.x + r.w - 80, y: r.y + 6, w: 36, h: 32 }, 'trash', {
      onClick: () => this.deleteSelected(),
    })
    this.ui.iconButton({ x: r.x + r.w - 44, y: r.y + 6, w: 36, h: 32 }, 'close', {
      onClick: () => {
        this.selectedConstraintId = null
      },
    })
    if (c.type === 'rope' || c.type === 'rod') {
      this.ui.slider(
        { x: r.x + pad, y: r.y + 64, w: r.w - pad * 2, h: 40 },
        {
          id: 'con-length',
          label: '长度',
          value: c.length,
          min: 0.1,
          max: 6,
          step: 0.01,
          decimals: 2,
          unit: ' m',
          onScrubStart: () => this.pushHistory(),
          onScrubEnd: () => {},
          onChange: (v) => this.setConstraintValue(c.id, 'length', v),
        },
      )
      this.ui.text('绳只能拉不能推；杆是刚性连接', r.x + pad, r.y + 126, { size: 10, color: THEME.inkSoft })
    } else if (c.type === 'spring') {
      this.ui.slider(
        { x: r.x + pad, y: r.y + 64, w: r.w - pad * 2, h: 40 },
        {
          id: 'con-k',
          label: '劲度系数 k',
          value: c.k,
          min: 1,
          max: 120,
          step: 1,
          decimals: 0,
          unit: ' N/m',
          onScrubStart: () => this.pushHistory(),
          onScrubEnd: () => {},
          onChange: (v) => this.setConstraintValue(c.id, 'k', v),
        },
      )
      this.ui.slider(
        { x: r.x + pad, y: r.y + 116, w: r.w - pad * 2, h: 40 },
        {
          id: 'con-l0',
          label: '原长 l₀',
          value: c.l0,
          min: 0.1,
          max: 5,
          step: 0.01,
          decimals: 2,
          unit: ' m',
          onScrubStart: () => this.pushHistory(),
          onScrubEnd: () => {},
          onChange: (v) => this.setConstraintValue(c.id, 'l0', v),
        },
      )
    } else {
      this.ui.text('铰链只固定连接点，不限制转动', r.x + pad, r.y + 70, { size: 10, color: THEME.inkSoft })
    }
  }

  private renderWorldSheet(r: Rect): void {
    const pad = 16
    this.ui.text('世界', r.x + pad, r.y + 24, { size: 13, weight: 700 })
    this.ui.iconButton({ x: r.x + r.w - 44, y: r.y + 6, w: 36, h: 32 }, 'close', {
      onClick: () => {
        this.showWorld = false
      },
    })
    let y = r.y + 60
    this.ui.slider(
      { x: r.x + pad, y, w: r.w - pad * 2, h: 40 },
      {
        id: 'world-g',
        label: '重力 g',
        value: this.doc.world.gravity,
        min: 0,
        max: 20,
        step: 0.1,
        decimals: 1,
        unit: ' m/s²',
        onScrubStart: () => {
          this.playing = false
          this.pushHistory()
        },
        onScrubEnd: () => {},
        onChange: (v) => {
          this.doc = { ...this.doc, world: { ...this.doc.world, gravity: v } }
          this.rebuild()
        },
      },
    )
    y += 54
    const ci = this.doc.world.interactions?.coulomb
    const gi = this.doc.world.interactions?.gravityNBody
    this.ui.pillButton({ x: r.x + pad, y, w: 118, h: 30 }, ci ? '库仑力：开' : '库仑力：关', {
      active: !!ci,
      size: 10,
      onClick: () => {
        this.pushHistory()
        this.doc = { ...this.doc, world: { ...this.doc.world, interactions: { ...this.doc.world.interactions, coulomb: ci ? undefined : { k: 1 } } } }
        this.rebuild()
      },
    })
    this.ui.pillButton({ x: r.x + pad + 126, y, w: 118, h: 30 }, gi ? 'N体引力：开' : 'N体引力：关', {
      active: !!gi,
      size: 10,
      onClick: () => {
        this.pushHistory()
        this.doc = { ...this.doc, world: { ...this.doc.world, interactions: { ...this.doc.world.interactions, gravityNBody: gi ? undefined : { G: 1 } } } }
        this.rebuild()
      },
    })
    y += 38
    const efield = this.doc.fields.find((f) => f.kind === 'uniform' && f.type === 'E')
    if (efield) {
      this.ui.slider(
        { x: r.x + pad, y, w: r.w - pad * 2, h: 40 },
        {
          id: 'world-E',
          label: '场强 E',
          value: this.doc.params.E ?? 0,
          min: -80,
          max: 80,
          step: 1,
          decimals: 0,
          unit: ' N/C',
          onScrubStart: () => this.pushHistory(),
          onScrubEnd: () => {},
          onChange: (v) => this.setField('E', v),
        },
      )
      y += 54
    } else {
      this.ui.pillButton({ x: r.x + pad, y, w: 112, h: 30 }, '加匀强电场', {
        size: 10,
        onClick: () => this.addField('E'),
      })
      y += 36
    }
    const bfield = this.doc.fields.find((f) => f.kind === 'uniform' && f.type === 'B')
    if (bfield) {
      this.ui.slider(
        { x: r.x + pad, y, w: r.w - pad * 2, h: 40 },
        {
          id: 'world-B',
          label: '磁感应强度 B',
          value: this.doc.params.B ?? 0,
          min: -40,
          max: 40,
          step: 0.5,
          decimals: 1,
          unit: ' T',
          onScrubStart: () => this.pushHistory(),
          onScrubEnd: () => {},
          onChange: (v) => this.setField('B', v),
        },
      )
      y += 54
    } else {
      this.ui.pillButton({ x: r.x + pad, y, w: 112, h: 30 }, '加匀强磁场', {
        size: 10,
        onClick: () => this.addField('B'),
      })
      y += 36
    }
    const drag = this.doc.fields.find((f) => f.kind === 'drag')
    if (drag) {
      this.ui.pillButton(
        { x: r.x + pad, y, w: 120, h: 30 },
        drag.enabled === false ? '空气阻力：关' : '空气阻力：开',
        {
          active: drag.enabled !== false,
          onClick: () => {
            this.pushHistory()
            this.doc = {
              ...this.doc,
              fields: this.doc.fields.map((f) => (f.id === drag.id ? { ...f, enabled: f.enabled === false } : f)),
            }
            this.rebuild()
          },
          size: 10,
        },
      )
    }
  }

  // ---- body setters ----
  private setBodyAngle(id: string, deg: number): void {
    const rad = (deg * Math.PI) / 180
    this.doc = {
      ...this.doc,
      bodies: this.doc.bodies.map((b) => (b.id === id ? { ...b, transform: { ...b.transform, angle: rad } } : b)),
    }
    const nb = findBody(this.doc, id)
    let yAfter: number | undefined
    if (nb && (nb.kind === 'static' || nb.kind === 'kinematic')) {
      const box = bodyAABB(nb.shape, nb.transform)
      if (box.min.y < 0) {
        this.doc = {
          ...this.doc,
          bodies: this.doc.bodies.map((b) =>
            b.id === id ? { ...b, transform: { ...b.transform, y: b.transform.y - box.min.y } } : b,
          ),
        }
        yAfter = nb.transform.y - box.min.y
      }
    }
    recordBodyEdit(this.doc, id, { angle: rad, y: yAfter })
    if (this.presetId === 'incline' && id === 'ramp') {
      this.doc = { ...this.doc, params: { ...this.doc.params, theta: clamp(-deg, 10, 55) } }
      // 预设的斜面：转完让物块跟着重新落到斜面
presetById(this.presetId)?.layout?.(this.doc)
    }
    this.rebuild()
  }

  private setBodyFriction(id: string, mu: number): void {
    this.doc = {
      ...this.doc,
      bodies: this.doc.bodies.map((b) => (b.id === id ? { ...b, friction: mu } : b)),
    }
    recordBodyEdit(this.doc, id, { friction: mu })
    if (this.presetId === 'incline' && id === 'ramp') {
      this.doc = { ...this.doc, params: { ...this.doc.params, mu } }
    }
    this.rebuild()
  }

  private setBodyVelocity(id: string, mag: number, phiDeg: number): void {
    const a = (phiDeg * Math.PI) / 180
    const v = { x: Math.cos(a) * mag, y: Math.sin(a) * mag }
    this.doc = {
      ...this.doc,
      bodies: this.doc.bodies.map((b) => (b.id === id ? { ...b, velocity: v } : b)),
    }
    recordBodyEdit(this.doc, id, { velocity: v })
    // 预置场景?v₀ 参数跟着走，A/B 时不会被布局改回
const focus = this.focusBody(this.doc)
    if (focus && focus.id === id && this.doc.params.v0 !== undefined) {
      this.doc = { ...this.doc, params: { ...this.doc.params, v0: mag } }
    }
    this.rebuild()
  }

  private addBodyForce(id: string): void {
    const body = findBody(this.doc, id)
    if (!body) return
    const forces = [...(body.forces ?? [])]
    let n = 1
    while (forces.some((f) => f.id === `f${n}`)) n++
    const f: ForceDef = { id: `f${n}`, x: 5, y: 0 }
    forces.push(f)
    this.selectedForceId = f.id
    this.setBodyForces(id, forces)
  }

  private setBodyForces(id: string, forces: ForceDef[]): void {
    this.doc = {
      ...this.doc,
      bodies: this.doc.bodies.map((b) => (b.id === id ? { ...b, forces: forces.length ? forces : undefined } : b)),
    }
    recordBodyEdit(this.doc, id, { forces })
    this.rebuild()
  }

  private setForceVector(id: string, forceId: string, mag: number, phiDeg: number): void {
    const body = findBody(this.doc, id)
    if (!body) return
    const a = (phiDeg * Math.PI) / 180
    const forces = (body.forces ?? []).map((f) =>
      f.id === forceId ? { ...f, x: Math.cos(a) * mag, y: Math.sin(a) * mag } : f,
    )
    this.setBodyForces(id, forces)
  }

  private removeBodyForce(id: string, forceId: string): void {
    const body = findBody(this.doc, id)
    if (!body) return
    const forces = (body.forces ?? []).filter((f) => f.id !== forceId)
    this.selectedForceId = null
    this.setBodyForces(id, forces)
  }

  private setAppliedForce(id: string, x: number, y: number): void {
    const mag = Math.hypot(x, y)
    this.doc = {
      ...this.doc,
      bodies: this.doc.bodies.map((b) =>
        b.id === id ? { ...b, appliedForce: mag < 1e-6 ? undefined : { x, y } } : b,
      ),
    }
    this.rebuild()
  }

  private setBodyRadius(id: string, radius: number): void {
    const tracks = this.doc.constraints.filter((c) => c.type === 'track' && c.centerBodyId === id)
    this.doc = {
      ...this.doc,
      bodies: this.doc.bodies.map((b) =>
        b.id === id && (b.shape.type === 'arc' || b.shape.type === 'circle')
          ? { ...b, shape: { ...b.shape, r: radius } as Body['shape'] }
          : b,
      ),
      constraints: this.doc.constraints.map((c) => {
        if (c.type !== 'track' || c.centerBodyId !== id) return c
        const ball = this.doc.bodies.find((b) => b.id === c.bodyId)
        const br = ball && ball.shape.type === 'circle' ? ball.shape.r : 0
        return { ...c, radius: Math.max(0.02, radius - br) }
      }),
    }
    recordBodyEdit(this.doc, id, { radius })
    for (const c of tracks) {
      const next = this.doc.constraints.find((x) => x.id === c.id)
      if (next && next.type === 'track') recordConstraintEdit(this.doc, next.id, { radius: next.radius })
    }
    this.rebuild()
  }

  private addField(type: 'E' | 'B'): void {
    if (this.doc.fields.some((f) => f.kind === 'uniform' && f.type === type)) return
    this.pushHistory()
    const id = type === 'E' ? 'E-field' : 'B-field'
    this.doc = {
      ...this.doc,
      fields: [
        ...this.doc.fields,
        type === 'E'
          ? { id, kind: 'uniform', type: 'E', vector: { x: 0, y: 0 } }
          : { id, kind: 'uniform', type: 'B', bz: 0 },
      ],
      params: { ...this.doc.params, [type]: 0 },
    }
    this.rebuild()
  }

  private setField(type: 'E' | 'B', value: number): void {
    this.doc = {
      ...this.doc,
      params: { ...this.doc.params, [type]: value },
      fields: this.doc.fields.map((f) =>
        f.kind === 'uniform' && f.type === type && !f.regionId
          ? type === 'E'
            ? { ...f, vector: { x: value, y: 0 } }
            : { ...f, bz: value }
          : f,
      ),
    }
    this.rebuild()
  }

  private setGasTemperature(id: string, temperature: number): void {
    this.doc = {
      ...this.doc,
      gases: this.doc.gases.map((g) => (g.id === id ? { ...g, temperature } : g)),
    }
    this.rebuild()
  }

  private setBodyCharge(id: string, charge: number): void {
    this.doc = {
      ...this.doc,
      bodies: this.doc.bodies.map((b) => (b.id === id ? { ...b, charge } : b)),
    }
    recordBodyEdit(this.doc, id, { charge })
    this.rebuild()
  }

  private setBodyLength(id: string, length: number): void {
    const body = findBody(this.doc, id)
    if (!body || (body.shape.type !== 'polyline' && body.shape.type !== 'polygon')) return
    const current = shapeLength(body.shape)
    if (current < 1e-9) return
    const f = length / current
    this.doc = {
      ...this.doc,
      bodies: this.doc.bodies.map((b) =>
        b.id === id && (b.shape.type === 'polyline' || b.shape.type === 'polygon')
          ? { ...b, shape: { ...b.shape, points: b.shape.points.map((p) => ({ x: p.x * f, y: p.y * f })) } }
          : b,
      ),
    }
    recordBodyEdit(this.doc, id, { length })
    this.rebuild()
  }

  private setLoopRadius(v: number): void {
    this.doc = { ...this.doc, params: { ...this.doc.params, R: v } }
    presetById('loop')?.layout?.(this.doc)
    applyEdits(this.doc)
    this.rebuild()
  }

  private setBoardParam(key: 'l' | 'h', v: number): void {
    this.doc = { ...this.doc, params: { ...this.doc.params, [key]: v } }
    presetById('boardBlock')?.layout?.(this.doc)
    applyEdits(this.doc)
    this.rebuild()
  }

  private setBodyStyle(id: string, style: 'solid' | 'thin'): void {
    this.doc = {
      ...this.doc,
      bodies: this.doc.bodies.map((b) =>
        b.id === id ? { ...b, appearance: { ...b.appearance, style } } : b,
      ),
    }
    recordBodyEdit(this.doc, id, { style })
    this.rebuild()
  }

  private setBodyMass(id: string, mass: number): void {
    this.doc = {
      ...this.doc,
      bodies: this.doc.bodies.map((b) => (b.id === id ? { ...b, mass } : b)),
    }
    recordBodyEdit(this.doc, id, { mass })
    if (this.doc.params.mass !== undefined) {
      this.doc = { ...this.doc, params: { ...this.doc.params, mass } }
    }
    this.rebuild()
  }

  private setBodyRole(id: string, role: 'terrain' | 'object' | 'track'): void {
    const body = findBody(this.doc, id)
    if (!body) return
    const cur = body.role ?? (body.kind === 'static' ? 'terrain' : 'object')
    if (cur === role) return
    this.pushHistory()
    let updated = this.classifyBody(body, role)
    if (role === 'object') {
      const hit = findSnap(this.doc, updated, updated.transform, { threshold: 0.32 })
      if (hit) updated = applySnap(updated, hit)
    }
    this.doc = {
      ...this.doc,
      bodies: this.doc.bodies.map((b) => (b.id === id ? updated : b)),
    }
    recordBodyEdit(this.doc, id, { role, kind: updated.kind })
    if (role === 'track') this.attachTrack(updated)
    this.selectedId = id
    this.rebuild()
  }

  private setConstraintValue(id: string, key: 'length' | 'k' | 'l0', v: number): void {
    this.doc = {
      ...this.doc,
      constraints: this.doc.constraints.map((c) => {
        if (c.id !== id) return c
        if (key === 'length' && (c.type === 'rope' || c.type === 'rod')) return { ...c, length: v }
        if (key === 'k' && c.type === 'spring') return { ...c, k: v }
        if (key === 'l0' && c.type === 'spring') return { ...c, l0: v }
        return c
      }),
    }
    recordConstraintEdit(this.doc, id, { [key]: v })
    this.rebuild()
  }

  private selectConstraint(id: string): void {
    this.selectedConstraintId = id
    this.selectedId = null
    this.showWorld = false
  }

  private constraintAnchorWorld(a: Anchor, state: VisualState | null): Vec2 {
    if ('world' in a) return a.world
    const body = findBody(this.doc, a.bodyId)
    if (!body) return { x: 0, y: 0 }
    const local = anchorLocal(this.doc, a)
    if (!local) return { x: 0, y: 0 }
    const s = state?.bodies[a.bodyId]
    const t = s ? { x: s.x, y: s.y, angle: s.angle } : body.transform
    const c = Math.cos(t.angle)
    const sn = Math.sin(t.angle)
    return { x: t.x + local.x * c - local.y * sn, y: t.y + local.x * sn + local.y * c }
  }

  private pickConstraintAt(x: number, y: number): Constraint | null {
    const state = this.visualState()
    let best: Constraint | null = null
    let bestD = 12
    for (const c of this.doc.constraints) {
      if (c.type !== 'rope' && c.type !== 'rod' && c.type !== 'spring' && c.type !== 'hinge') continue
      const a = this.camera.project(this.constraintAnchorWorld(c.a, state), 0)
      const b = this.camera.project(this.constraintAnchorWorld(c.b, state), 0)
      const dx = b.x - a.x
      const dy = b.y - a.y
      const len2 = dx * dx + dy * dy
      let tt = len2 > 1e-6 ? ((x - a.x) * dx + (y - a.y) * dy) / len2 : 0
      tt = Math.max(0, Math.min(1, tt))
      const d = Math.hypot(x - (a.x + dx * tt), y - (a.y + dy * tt))
      if (d < bestD) {
        bestD = d
        best = c
      }
    }
    return best
  }

  private criteriaChips(scene: Scene, sim: Simulation | null): Array<{ label: string; color: string }> {
    if (!sim) return []
    const out: Array<{ label: string; color: string }> = []
    for (const c of scene.criteria) {
      const res = sim.state.criteria[c.id]
      if (!res) continue
      if (c.kind === 'conserve' && res.detail?.error === undefined) continue
      const label = criterionChipLabel(c, res)
      const color = criterionChipColor(c, res)
      if (label) out.push({ label, color })
    }
    return out
  }

  private focusBody(scene: Scene): Body | undefined {
    const trail = scene.observers.find((o) => o.kind === 'trail')
    if (trail && trail.kind === 'trail') return findBody(scene, trail.bodyId)
    return scene.bodies.find((b) => b.kind === 'particle' || b.kind === 'rigid')
  }

  private renderRotateHandle(): void {
    if (!this.selectedId || this.playing || this.drag?.kind === 'move') return
    const body = findBody(this.doc, this.selectedId)
    if (!body) return
    if (body.kind === 'static' || body.kind === 'kinematic') return
    const c = this.bodyAnchor(body)
    const p = this.camera.project(c, 0)
    const hx = p.x
    const hy = p.y - 58
    const ctx = this.ctx
    ctx.save()
    ctx.strokeStyle = rgba(THEME.accent, 0.45)
    ctx.lineWidth = 1.2
    ctx.setLineDash([3, 4])
    ctx.beginPath()
    ctx.moveTo(p.x, p.y)
    ctx.lineTo(hx, hy + 12)
    ctx.stroke()
    ctx.setLineDash([])
    ctx.fillStyle = THEME.white
    ctx.strokeStyle = THEME.accent
    ctx.lineWidth = 1.8
    ctx.beginPath()
    ctx.arc(hx, hy, 11, 0, Math.PI * 2)
    ctx.fill()
    ctx.stroke()
    ctx.beginPath()
    ctx.arc(hx, hy, 5.5, -0.7, Math.PI * 1.5)
    ctx.stroke()
    ctx.restore()
    if (this.drag?.kind === 'rotate') {
      const deg = Math.round((body.transform.angle * 180) / Math.PI)
      this.ui.text(`${deg}°`, hx + 17, hy - 7, { size: 10, weight: 700, color: THEME.accent })
    }
  }

  private renderEraserHover(): void {
    if (this.tool !== 'eraser' || this.mode !== 'scene') return
    const body = pickBody(this.doc, this.camera, this.visualState(), this.pointer.x, this.pointer.y)
    if (!body || body.id === 'ground') return
    const box = bodyAABB(body.shape, body.transform)
    const a = this.camera.project(box.min, 0)
    const b = this.camera.project(box.max, 0)
    const x = Math.min(a.x, b.x) - 6
    const y = Math.min(a.y, b.y) - 6
    const w = Math.abs(b.x - a.x) + 12
    const h = Math.abs(b.y - a.y) + 12
    const ctx = this.ctx
    ctx.save()
    ctx.setLineDash([5, 4])
    ctx.strokeStyle = rgba(THEME.red, 0.85)
    ctx.lineWidth = 1.6
    ctx.strokeRect(x, y, w, h)
    ctx.restore()
    this.ui.text('松手删除', x + w / 2, y - 10, { size: 9, color: THEME.red, align: 'center' })
  }

  private velocityHandle(): { x: number; y: number; bodyId: string } | null {
    if (!this.selectedId) return null
    const body = findBody(this.doc, this.selectedId)
    if (!body) return null
    const b = this.simA?.state.bodies[body.id]
    const pos = b ? { x: b.x, y: b.y } : body.transform
    const v = b ? { x: b.vx, y: b.vy } : body.velocity ?? { x: 0, y: 0 }
    if (Math.hypot(v.x, v.y) < 0.05) return null
    const tip = this.camera.project({ x: pos.x + v.x * 0.35, y: pos.y + v.y * 0.35 }, 0)
    return { x: tip.x, y: tip.y, bodyId: body.id }
  }

  private renderDrawPreview(d: Extract<DragState, { kind: 'draw' }>): void {
    const ctx = this.ctx
    ctx.save()
    ctx.strokeStyle = THEME.accent
    ctx.lineWidth = 1.6
    if (d.tool === 'fieldE' || d.tool === 'fieldB') {
      // 拖着的那块区域就是场的作用范围
      ctx.setLineDash([6, 5])
      const a = this.camera.project(d.start, 0)
      const b = this.camera.project(d.current, 0)
      const x = Math.min(a.x, b.x)
      const y = Math.min(a.y, b.y)
      const w = Math.abs(b.x - a.x)
      const h = Math.abs(b.y - a.y)
      ctx.strokeRect(x, y, w, h)
      ctx.setLineDash([])
      ctx.font = font(10, 600)
      ctx.fillStyle = THEME.accent
      ctx.textAlign = 'left'
      ctx.textBaseline = 'bottom'
      const label = d.tool === 'fieldE' ? 'E 区' : 'B 区'
      ctx.fillText(label, x + 2, y - 4)
      ctx.restore()
      return
    }
    // 手绘：把真实笔迹画出来（松手才规整）
    const pts = d.points ?? [d.start, d.current]
    ctx.beginPath()
    const first = this.camera.project(pts[0]!, 0)
    ctx.moveTo(first.x, first.y)
    for (let i = 1; i < pts.length; i++) {
      const p = this.camera.project(pts[i]!, 0)
      ctx.lineTo(p.x, p.y)
    }
    ctx.stroke()
    ctx.restore()
  }



  // -------------------------------------------------------------------------
  // 题库（首页）/ 建模库（收藏夹）
  // -------------------------------------------------------------------------

  /** 题库可见题目：我导入的排前面，然后是内置题 */








  pageBarRect(): Rect {
    return this.layout().pageBar
  }

  tabBarRect(): Rect {
    return this.layout().tabBar
  }

  toBank(): void {
    if (this.mode === 'scene') this.persistCurrent()
    this.mode = 'bank'
    this.bankScroll = 0
    this.libraryScroll = 0
    this.moveModelId = null
    this.problemOpen = null
    this.problemScroll = 0
    this.confirm = null
  }

  toLibrary(): void {
    if (this.mode === 'scene') this.persistCurrent()
    this.playing = false
    this.mode = 'library'
    this.libraryScroll = 0
    this.moveModelId = null
    this.problemOpen = null
    this.confirm = null
  }

  toUser(): void {
    if (this.mode === 'scene') this.persistCurrent()
    this.playing = false
    this.mode = 'user'
    this.problemOpen = null
    this.moveModelId = null
    this.confirm = null
  }

  /** 离开画布时把改动写回库里（同一个模型，不新增） */
  private persistCurrent(): void {
    if (!this.currentModelId) return
    const m = this.library.models.find((x) => x.id === this.currentModelId)
    if (!m) return
    this.library = updateModel(this.library, m.id, this.doc)
    this.persist()
  }

  persist(): void {
    try {
      this.host.storage?.save(serializeLibrary(this.library))
    } catch {
      this.toast('本地存不下（可能满了），先删几个模型')
    }
  }

  // ---- 生成建模（唯一入口） ----

  /** 点「生成建模」：壳负责弹输入框，拿到题干后走同一条生成链路 */
  askGenerate(): void {
    if (!this.host.askProblem) {
      this.toast('这个壳没有题目输入入口')
      return
    }
    this.host.askProblem((text) => {
      if (!text) return { ok: false, message: '' }
      // 配了 AI 就是异步的：先把弹层关掉，结果用 toast + 自动进画布反馈。
      // 不在这里 await，因为壳的弹层接口是同步返回。
      if (this.aiReady()) {
        void this.generateAsync(text)
        return { ok: true, message: 'AI 正在读题…' }
      }
      return this.generateFromText(text)
    })
  }

  /**
   * 题目文本 → 模型 → 存进建模库 → 打开画布。
   * 失败时**不假装**：说明缺什么，并把题存进「我的题目」方便以后重试。
   *
   * 这是**规则解析**那条路（离线、确定性）。配了 AI 的壳走 `generateAsync`。
   */
  generateFromText(text: string, problemId?: string): { ok: boolean; message: string } {
    return this.commitGenerated(parseProblem(text), text, problemId, 'rules')
  }

  /**
   * 配了 AI 就走 AI：让模型决定用哪个场景、填哪些参数、补哪些假设。
   *
   * 三道保险，保证「AI 挂了不比没有 AI 更差」：
   *   1. 没配 key / 当前壳不支持 → 直接走规则解析；
   *   2. 请求失败（超时、余额、JSON 不合法、选了不存在的场景）→ 记一条 toast，回退规则解析；
   *   3. AI 明确说 unsupported → **不回退**（回退等于把它的判断推翻），按拒绝处理。
   */
  async generateAsync(text: string, problemId?: string): Promise<{ ok: boolean; message: string }> {
    if (!this.aiReady() || this.aiBusy) {
      if (this.aiBusy) return { ok: false, message: 'AI 正在读题，稍等' }
      return this.generateFromText(text, problemId)
    }
    this.aiBusy = true
    this.toast(`AI 正在读题（${this.aiConfig!.model}）…`)
    try {
      const r = await askPlan(this.aiConfig!, text)
      if (!r.ok) {
        this.toast(`AI 没给出可用的模型（${r.error}），已改用规则解析`)
        return this.generateFromText(text, problemId)
      }
      const parsed = sceneFromPlan(r.plan)
      return this.commitGenerated(parsed, text, problemId, 'ai', r.ms)
    } finally {
      this.aiBusy = false
    }
  }

  /** 把一次生成结果落到库里并打开。AI 和规则解析共用这一段，避免两条路各写一遍。 */
  private commitGenerated(
    r: ReturnType<typeof parseProblem>,
    text: string,
    problemId: string | undefined,
    source: 'ai' | 'rules',
    ms?: number,
  ): { ok: boolean; message: string } {
    if (!r.ok) {
      const message = [r.error, ...r.hints].join(' ')
      if (!problemId) {
        const added = addProblem(this.library, makeMineProblem(text, `mine-${Date.now().toString(36)}`))
        if (!added.error) {
          this.library = added.library
          this.persist()
        }
      }
      this.toast(`${r.error}${problemId ? '' : ' 题目已存进「我的题目」'}`)
      return { ok: false, message }
    }
    const problem = problemId ? this.allProblems().find((x) => x.id === problemId) : undefined
    // 库里的名字：题目标题 → 场景名（去掉「· 题目」这种解析器后缀）
    const fallback = r.scene.meta.title.replace(/\s*·\s*题目$/, '')
    const added = addModel(this.library, r.scene, { problemId, title: problem?.title ?? fallback })
    if (added.error) {
      this.toast(added.error)
      return { ok: false, message: added.error }
    }
    this.library = added.library
    this.persist()
    this.openModel(added.model!.id)
    // openModel → loadScene 会把 fromProblem 清掉，所以要在它之后置位：
    // 这份场景确实是「题目生成的初稿」，舞台上得标出来。
    this.fromProblem = true
    const how = source === 'ai' ? `AI · ${this.aiConfig?.model ?? ''}` : '规则解析'
    const took = ms !== undefined ? ` · ${(ms / 1000).toFixed(1)}s` : ''
    this.toast(`已生成「${problem?.title ?? r.scene.meta.title}」（${how}${took}）· 已存进建模库`)
    return { ok: true, message: `已生成「${r.scene.meta.title}」` }
  }

  // ---- AI 设置 ----

  aiReady(): boolean {
    return aiConfigReady(this.aiConfig)
  }

  /** 用户页「AI 建模」那一行显示什么 */
  aiLabel(): string {
    if (!this.host.ai) return '当前壳不支持'
    if (!this.aiReady()) return '未配置 · 用规则解析'
    return `${this.aiConfig!.model} · 已就绪`
  }

  openAiSettings(): void {
    this.aiOpen = true
  }

  /** 改 key：直接用壳的输入框（Web 是 DOM 弹层，小程序是原生 modal） */
  private editAiKey(): void {
    if (!this.host.ai) {
      this.toast('这个壳没有本地存储，存不了 key')
      return
    }
    this.host.prompt?.(
      { title: '粘贴 API Key', placeholder: '只存在这台设备上', value: this.aiConfig?.key ?? '' },
      (v) => {
        if (v === null) return
        const key = v.trim()
        if (!key) return
        this.aiConfig = { ...(this.aiConfig ?? DEFAULT_AI_CONFIG), key }
        this.persistAi()
        this.toast('Key 已保存（只在本机）')
      },
    )
  }

  private editAiModel(): void {
    this.host.prompt?.(
      { title: '模型名', placeholder: 'glm-4.6', value: this.aiConfig?.model ?? DEFAULT_AI_CONFIG.model },
      (v) => {
        if (v === null) return
        const model = v.trim()
        if (!model) return
        // 没配过 key 时先存成空 key：aiReady() 会返回 false，生成仍走规则解析
        this.aiConfig = { key: this.aiConfig?.key ?? '', ...DEFAULT_AI_CONFIG, ...this.aiConfig, model }
        this.persistAi()
        this.toast(`模型改为 ${model}`)
      },
    )
  }

  private clearAi(): void {
    this.aiConfig = null
    this.persistAi()
    this.toast('已清除 AI 设置，生成改回规则解析')
  }

  private persistAi(): void {
    try {
      this.host.ai?.save?.(this.aiConfig ? JSON.stringify(this.aiConfig) : null)
    } catch {
      /* 隐私模式下可能抛，忽略 */
    }
  }

  private renderAiSheet(): void {
    const W = this.width
    const H = this.height
    const ctx = this.ctx
    ctx.save()
    ctx.fillStyle = 'rgba(29,32,37,0.42)'
    ctx.fillRect(0, 0, W, H)
    ctx.restore()
    this.ui.add({ id: 'ai:backdrop', rect: { x: 0, y: 0, w: W, h: H }, onClick: () => (this.aiOpen = false) })

    const w = Math.min(W - 40, 400)
    const h = 300
    const r: Rect = { x: (W - w) / 2, y: (H - h) / 2, w, h }
    this.ui.card(r, { radius: 16, fill: THEME.card, stroke: THEME.panelLine, shadow: true })
    this.ui.add({ id: 'ai:card', rect: r })
    this.ui.text('AI 建模', r.x + 20, r.y + 28, { size: 14, weight: 700 })
    this.ui.text('让模型决定用哪个场景、填哪些参数', r.x + 20, r.y + 48, { size: 9.5, color: THEME.inkFaint })
    this.ui.iconButton({ x: r.x + r.w - 44, y: r.y + 12, w: 30, h: 30 }, 'close', {
      onClick: () => (this.aiOpen = false),
    })

    const rows: Array<{ label: string; value: string; onClick: () => void }> = [
      { label: 'API Key', value: this.aiConfig?.key ? `${this.aiConfig.key.slice(0, 6)}…${this.aiConfig.key.slice(-4)}` : '未设置', onClick: () => this.editAiKey() },
      { label: '模型', value: this.aiConfig?.model ?? DEFAULT_AI_CONFIG.model, onClick: () => this.editAiModel() },
    ]
    let y = r.y + 72
    for (const row of rows) {
      this.ui.text(row.label, r.x + 20, y + 14, { size: 10.5, weight: 600, color: THEME.inkSoft })
      this.ui.text(row.value, r.x + 90, y + 14, { size: 10.5, mono: true, maxWidth: r.w - 130 })
      const rr: Rect = { x: r.x + 12, y, w: r.w - 24, h: 34 }
      this.ui.add({ id: `ai:${row.label}`, rect: rr, cursor: 'pointer', onClick: row.onClick })
      y += 38
    }

    this.ui.text('Key 只存在这台设备上，不上传、不进仓库。', r.x + 20, y + 6, { size: 9, color: THEME.inkFaint })
    this.ui.text('浏览器直连厂商接口会被跨域拦住，所以走本地转发（npm run dev 已配好）。', r.x + 20, y + 22, {
      size: 9,
      color: THEME.inkFaint,
      maxWidth: r.w - 40,
    })

    if (this.aiConfig) {
      this.ui.pillButton({ x: r.x + 20, y: r.y + h - 48, w: 96, h: 32 }, '清除', {
        size: 10.5,
        weight: 600,
        onClick: () => this.clearAi(),
      })
    }
    this.ui.pillButton({ x: r.x + r.w - 116, y: r.y + h - 48, w: 96, h: 32 }, '完成', {
      active: true,
      size: 10.5,
      weight: 650,
      onClick: () => (this.aiOpen = false),
    })
  }


  /** 打开库里某个模型 */
  openModel(id: string): void {
    const m = this.library.models.find((x) => x.id === id)
    if (!m) return
    this.currentModelId = id
    this.loadScene(m.scene, m.scene.meta.preset ?? null)
  }

  /** 点题库卡片：建过就直接打开，没建过就生成（不重复建同一道题） */
  openProblem(problemId: string): void {
    const p = this.allProblems().find((x) => x.id === problemId)
    if (!p) return
    const existing = this.modelForProblem(problemId)
    if (existing) {
      this.openModel(existing.id)
      return
    }
    this.generateAny(p.text, problemId)
  }

  /** 供页面调用：有 AI 走 AI（异步），没有就同步走规则 */
  generateAny(text: string, problemId?: string): { ok: boolean; message: string } {
    if (this.aiReady()) {
      void this.generateAsync(text, problemId)
      return { ok: true, message: 'AI 正在读题…' }
    }
    return this.generateFromText(text, problemId)
  }

  // ---- 文件夹 ----

  newFolder(): void {
    if (!this.host.prompt) {
      this.toast('这个壳没有输入框，建不了文件夹')
      return
    }
    this.host.prompt({ title: '新建文件夹', placeholder: '例如：临界题 / 力学第一章' }, (name) => {
      if (!name) return
      const r = createFolder(this.library, name)
      if (r.error || !r.folder) {
        this.toast(r.error ?? '建不了')
        return
      }
      this.library = r.library
      this.activeFolderId = r.folder.id
      this.persist()
      this.toast(`已建文件夹「${r.folder.name}」`)
    })
  }

  moveTo(modelId: string, folderId: string): void {
    this.library = moveModel(this.library, modelId, folderId)
    this.persist()
    this.moveModelId = null
    const name = folderList(this.library).find((f) => f.id === folderId)?.name ?? '未分类'
    this.toast(`已移到「${name}」`)
  }

  removeModel(modelId: string): void {
    this.library = deleteModel(this.library, modelId)
    if (this.currentModelId === modelId) this.currentModelId = null
    this.persist()
    this.moveModelId = null
    this.toast('已删除')
  }

  // ---- 题库 / 建模库 / 详情 / 用户页的实现在 pages/，见下方转发 ----

  // -------------------------------------------------------------------------
  // 分享 / 提示
  // -------------------------------------------------------------------------

  /**
   * 题目 → 建模。当前生成链路是 `parseProblem`（规则解析）；
   * AI / 图片 / 拍照入口后续接同一条契约：Scene + 假设 + unsupported，失败一律落到手动编辑。
   */
  loadProblemText(text: string): { ok: boolean; message: string } {
    const r = parseProblem(text)
    if (!r.ok) {
      return { ok: false, message: [r.error, ...r.hints].join(' ') }
    }
    this.loadScene(r.scene, null)
    this.fromProblem = true
    const used = Object.entries(r.used)
      .filter(([k]) => k !== 'arc')
      .map(([k, v]) => `${k}=${typeof v === 'number' ? Number(v.toFixed(2)) : v}`)
      .join(' ')
    const assumptions = r.assumptions.length ? ` · 假设：${r.assumptions.join('、')}` : ''
    const msg = `已生成「${r.scene.meta.title}」${assumptions}${used ? ` · ${used}` : ''}${r.warnings.length ? `（${r.warnings.join('；')}）` : ''} · 初稿可直接改`
    this.toast(msg)
    return { ok: true, message: msg }
  }

  // -------------------------------------------------------------------------
  // 页面（实现在 pages/：题库 / 详情 / 模型 / 用户）
  // -------------------------------------------------------------------------

  private renderBank(): void {
    renderBankPage(this)
  }

  private renderLibrary(): void {
    renderLibraryPage(this)
  }

  private renderUser(): void {
    renderUserPage(this)
  }

  private renderMoveSheet(): void {
    renderMoveSheetPage(this)
  }

  private renderConfirm(): void {
    renderConfirmPage(this)
  }

  askConfirm(opts: ConfirmState): void {
    askConfirmPage(this, opts)
  }

  openProblemDetail(id: string): void {
    openProblemDetailPage(this, id)
  }

  /** 题库可见题目（内置 + 我导入的） */
  private allProblems(): ReturnType<typeof allProblemsOf> {
    return allProblemsOf(this)
  }

  private modelForProblem(problemId: string): ReturnType<typeof modelForProblemOf> {
    return modelForProblemOf(this, problemId)
  }

  share(): void {
    const token = encodeShare(this.doc)
    if (this.host.share) this.host.share(token)
    else this.toast('已生成分享串')
  }

  toast(text: string): void {
    this.toastText = text
    this.toastUntil = this.now + 2.4
    this.host.toast?.(text)
  }
}

function pickQuantity(s: ChartSample, q: string): number {
  switch (q) {
    case 'x':
      return s.x
    case 'y':
      return s.y
    case 'v':
      return s.v
    case 'a':
      return s.a
    case 'E':
      return s.E
    case 'p':
      return s.p
    default:
      return s.v
  }
}

export function criterionChipLabel(c: Criterion, res: { pass: boolean; triggeredAt?: number } | undefined): string {
  if (!res) return ''
  if (c.kind === 'conserve') {
    const q = c.quantity === 'E' ? '机械能' : c.label ?? '动量'
    return res.pass ? `${q}：守恒` : `${q}：不守恒`
  }
  const name = c.label ?? (c.kind === 'detach' ? '脱离轨道' : c.kind === 'reach' ? '到达' : c.kind === 'collide' ? '碰撞' : '共速')
  return res.pass ? `${name} · ${res.triggeredAt?.toFixed(2) ?? '?'} s` : `${name}：未发生`
}

export function criterionChipColor(c: Criterion, res: { pass: boolean; triggeredAt?: number } | undefined): string {
  if (!res) return THEME.inkSoft
  if (c.kind === 'conserve') return res.pass ? THEME.green : THEME.inkSoft
  return res.pass ? THEME.accent : THEME.inkSoft
}
