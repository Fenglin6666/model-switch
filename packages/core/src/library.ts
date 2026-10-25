/**
 * 建模库：生成出来的模型都存在这里，像音乐收藏夹——分文件夹、自己挑分类。
 *
 * 存储完全在本地（Web: localStorage；小程序: wx.setStorageSync），零后端。
 * 一条记录里存**完整 Scene**，所以打开就是当时那一份，不需要重新生成。
 *
 * 体积约束：一个 Scene 约 8–30 KB，上限 60 个模型，并在 UI 上显示占用——不做静默丢弃。
 */
import type { Scene } from './scene'
import type { BankProblem } from './bank'
import type { SavedComponent } from './components'
import { normalizeScene } from './serialize'

export const UNSORTED = 'unsorted'
export const MAX_MODELS = 60

export type LibraryFolder = { id: string; name: string; createdAt: number }

export type LibraryModel = {
  id: string
  title: string
  folderId: string
  scene: Scene
  /** 从题库哪条题生成（用于「原题」入口） */
  problemId?: string
  createdAt: number
  updatedAt: number
}

/**
 * 本地工作区：文件夹 + 模型 + 我导入的题目。
 * 三样都存在同一个 blob 里——零后端时少一个存储键，也不会出现「库在、题没了」。
 */
export type Library = {
  version: 1
  folders: LibraryFolder[]
  models: LibraryModel[]
  /** 用户导入的题目（题库「我的题目」分类） */
  problems: BankProblem[]
  /** 用户自己「存」出来的组件（从场景里抽的一段模型） */
  components: SavedComponent[]
}

export function emptyLibrary(): Library {
  return { version: 1, folders: [], models: [], problems: [], components: [] }
}

export const MAX_COMPONENTS = 40

/** 存一个组件；重名不合并（同一个组合可能有不同参数，让用户自己删） */
export function addComponent(
  lib: Library,
  comp: SavedComponent,
): { library: Library; error?: string } {
  if (lib.components.length >= MAX_COMPONENTS) {
    return { library: lib, error: `组件库最多 ${MAX_COMPONENTS} 个，先删几个` }
  }
  return { library: { ...lib, components: [comp, ...lib.components] } }
}

export function renameComponent(lib: Library, id: string, name: string): Library {
  const clean = name.trim().slice(0, 16)
  if (!clean) return lib
  return { ...lib, components: lib.components.map((c) => (c.id === id ? { ...c, name: clean } : c)) }
}

export function deleteComponent(lib: Library, id: string): Library {
  return { ...lib, components: lib.components.filter((c) => c.id !== id) }
}

/** 导入题目；同一段题干只存一次（重复导入返回已有那条） */
export function addProblem(
  lib: Library,
  problem: BankProblem,
): { library: Library; problem?: BankProblem; error?: string } {
  const dup = lib.problems.find((p) => p.text === problem.text)
  if (dup) return { library: lib, problem: dup }
  if (lib.problems.length >= 40) return { library: lib, error: '「我的题目」最多 40 道，先删几道' }
  return { library: { ...lib, problems: [problem, ...lib.problems] }, problem }
}

export function deleteProblem(lib: Library, problemId: string): Library {
  return { ...lib, problems: lib.problems.filter((p) => p.id !== problemId) }
}

const clampName = (name: string) => name.replace(/\s+/g, ' ').trim().slice(0, 12)

/** 新建文件夹；重名自动加序号（不静默覆盖） */
export function createFolder(lib: Library, name: string, now = Date.now()): { library: Library; folder?: LibraryFolder; error?: string } {
  const clean = clampName(name)
  if (!clean) return { library: lib, error: '文件夹名不能为空' }
  if (lib.folders.length >= 20) return { library: lib, error: '最多 20 个文件夹' }
  if (lib.folders.some((f) => f.name === clean)) return { library: lib, error: '已有同名文件夹' }
  const folder: LibraryFolder = { id: `f-${now.toString(36)}-${lib.folders.length}`, name: clean, createdAt: now }
  return { library: { ...lib, folders: [...lib.folders, folder] }, folder }
}

export function deleteFolder(lib: Library, folderId: string): Library {
  if (folderId === UNSORTED) return lib
  return {
    ...lib,
    folders: lib.folders.filter((f) => f.id !== folderId),
    // 文件夹删掉，里面的模型回到「未分类」，不跟着消失
    models: lib.models.map((m) => (m.folderId === folderId ? { ...m, folderId: UNSORTED } : m)),
  }
}

export function renameFolder(lib: Library, folderId: string, name: string): Library {
  const clean = clampName(name)
  if (!clean) return lib
  return { ...lib, folders: lib.folders.map((f) => (f.id === folderId ? { ...f, name: clean } : f)) }
}

/** 存一个模型；超过上限返回 error（UI 要明说，不能静默丢） */
export function addModel(
  lib: Library,
  scene: Scene,
  opts: { folderId?: string; problemId?: string; now?: number; title?: string } = {},
): { library: Library; model?: LibraryModel; error?: string } {
  const now = opts.now ?? Date.now()
  if (lib.models.length >= MAX_MODELS) {
    return { library: lib, error: `建模库已满（${MAX_MODELS} 个），先删掉几个再存` }
  }
  const folderId = opts.folderId && (opts.folderId === UNSORTED || lib.folders.some((f) => f.id === opts.folderId)) ? opts.folderId : UNSORTED
  const model: LibraryModel = {
    id: `m-${now.toString(36)}-${lib.models.length}`,
    title: opts.title ?? scene.meta.title ?? '未命名模型',
    folderId,
    scene,
    problemId: opts.problemId,
    createdAt: now,
    updatedAt: now,
  }
  return { library: { ...lib, models: [model, ...lib.models] }, model }
}

/**
 * 写回画布上的改动。
 * 标题**不跟着场景走**：库里那一行是「这首曲子叫什么」，不该因为改了个参数就被重命名。
 */
export function updateModel(lib: Library, modelId: string, scene: Scene, now = Date.now()): Library {
  return {
    ...lib,
    models: lib.models.map((m) => (m.id === modelId ? { ...m, scene, updatedAt: now } : m)),
  }
}

export function moveModel(lib: Library, modelId: string, folderId: string): Library {
  const target = folderId === UNSORTED || lib.folders.some((f) => f.id === folderId) ? folderId : UNSORTED
  return { ...lib, models: lib.models.map((m) => (m.id === modelId ? { ...m, folderId: target, updatedAt: Date.now() } : m)) }
}

export function deleteModel(lib: Library, modelId: string): Library {
  return { ...lib, models: lib.models.filter((m) => m.id !== modelId) }
}

/** 清空建模（保留文件夹与我的题目）——用户页里的「清空」用它 */
export function clearModels(lib: Library): Library {
  return { ...lib, models: [] }
}

/** 清空「我的题目」（保留建模） */
export function clearProblems(lib: Library): Library {
  return { ...lib, problems: [] }
}

export function modelsIn(lib: Library, folderId: string): LibraryModel[] {
  return lib.models.filter((m) => m.folderId === folderId)
}

export function countIn(lib: Library, folderId: string): number {
  return lib.models.reduce((n, m) => n + (m.folderId === folderId ? 1 : 0), 0)
}

/** 文件夹列表（含「未分类」，永远排第一） */
export function folderList(lib: Library): LibraryFolder[] {
  return [{ id: UNSORTED, name: '未分类', createdAt: 0 }, ...lib.folders]
}

export function serializeLibrary(lib: Library): string {
  return JSON.stringify(lib)
}

/** 容错解析：坏数据不炸，退回空库（旧版本 / 手改过都算） */
export function parseLibrary(raw: string | null | undefined): Library {
  if (!raw) return emptyLibrary()
  try {
    const parsed = JSON.parse(raw) as Partial<Library>
    const folders = Array.isArray(parsed.folders)
      ? parsed.folders
          .filter((f): f is LibraryFolder => !!f && typeof f.id === 'string' && typeof f.name === 'string')
          .slice(0, 20)
      : []
    const models: LibraryModel[] = []
    for (const m of Array.isArray(parsed.models) ? parsed.models : []) {
      if (!m || typeof m.id !== 'string' || !m.scene) continue
      try {
        models.push({
          id: m.id,
          title: typeof m.title === 'string' ? m.title : '未命名模型',
          folderId: typeof m.folderId === 'string' ? m.folderId : UNSORTED,
          scene: normalizeScene(m.scene),
          problemId: typeof m.problemId === 'string' ? m.problemId : undefined,
          createdAt: typeof m.createdAt === 'number' ? m.createdAt : Date.now(),
          updatedAt: typeof m.updatedAt === 'number' ? m.updatedAt : Date.now(),
        })
      } catch {
        /* 单条坏了就跳过，别让整个库打不开 */
      }
      if (models.length >= MAX_MODELS) break
    }
    // 指向不存在文件夹的模型回落到未分类
    const known = new Set([UNSORTED, ...folders.map((f) => f.id)])
    const problems = Array.isArray(parsed.problems)
      ? parsed.problems.filter(
          (p): p is BankProblem =>
            !!p && typeof p.id === 'string' && typeof p.text === 'string' && typeof p.title === 'string',
        )
      : []
    const components = Array.isArray((parsed as Partial<Library>).components)
      ? ((parsed as Partial<Library>).components as SavedComponent[]).filter(
          (c) => !!c && typeof c.id === 'string' && typeof c.name === 'string' && Array.isArray(c.bodies) && c.bodies.length > 0,
        )
      : []
    return {
      version: 1,
      folders,
      models: models.map((m) => (known.has(m.folderId) ? m : { ...m, folderId: UNSORTED })),
      problems,
      components,
    }
  } catch {
    return emptyLibrary()
  }
}

/** 占用字节数（UTF-16 估个大概，用来给容量提示） */
export function libraryBytes(lib: Library): number {
  return serializeLibrary(lib).length * 2
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}
