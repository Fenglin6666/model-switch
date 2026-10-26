/**
 * 三个「非画布」页面（题库 / 模型 / 用户）和 App 之间的窄接口。
 *
 * 这些页面原来都长在 app.ts 里（4700 行的巨石）。拆出来的原则：
 * **页面只读状态、只调这几个动作**，不碰相机、不碰仿真、不碰命中区生命周期。
 */
import type { UI } from '../widgets'
import type { Rect } from '../widgets'
import type { Library } from '@core/library'

export type ConfirmState = {
  title: string
  message: string
  okLabel: string
  onOk: () => void
}

export type PagesHost = {
  readonly ctx: CanvasRenderingContext2D
  readonly ui: UI
  readonly width: number
  readonly height: number
  readonly insets: { top: number; right: number }
  mode: 'user' | 'bank' | 'library' | 'scene'

  library: Library
  bankCategory: string
  bankScroll: number
  bankMaxScroll: number
  problemOpen: string | null
  problemScroll: number
  problemMaxScroll: number
  libraryScroll: number
  libraryMaxScroll: number
  activeFolderId: string
  moveModelId: string | null
  confirm: ConfirmState | null

  tabBarRect(): Rect
  pageBarRect(): Rect
  toast(text: string): void
  askGenerate(): void
  openProblemDetail(id: string): void
  openModel(id: string): void
  /** 只有 AI 这一条生成路；没配 key 时返回失败并提示 */
  generateAny(text: string, problemId?: string): { ok: boolean; message: string }
  /** 编辑器兜底：开一张空白画布手动搭 */
  loadBlank(): void
  /** 用户页「AI 建模」那一行显示的副标题 */
  aiLabel(): string
  openAiSettings(): void
  newFolder(): void
  moveTo(modelId: string, folderId: string): void
  removeModel(modelId: string): void
  persist(): void
  askConfirm(opts: ConfirmState): void
  toBank(): void
  toLibrary(): void
  toUser(): void
}
