import { describe, expect, it } from 'vitest'
import { makeMineProblem } from '@core/bank'
import {
  MAX_MODELS,
  addProblem,
  clearModels,
  clearProblems,
  UNSORTED,
  addModel,
  countIn,
  createFolder,
  deleteFolder,
  deleteModel,
  emptyLibrary,
  folderList,
  formatBytes,
  libraryBytes,
  modelsIn,
  moveModel,
  parseLibrary,
  serializeLibrary,
  updateModel,
} from '@core/library'
import { buildPresetScene } from '@core/presets'

const scene = (id = 'incline') => buildPresetScene(id)

describe('建模库：文件夹 + 收藏', () => {
  it('新建文件夹：重名/空名给出明确错误，不静默覆盖', () => {
    const lib = emptyLibrary()
    const a = createFolder(lib, '  力学  ', 1000)
    expect(a.folder?.name).toBe('力学')
    const b = createFolder(a.library, '力学', 1001)
    expect(b.folder).toBeUndefined()
    expect(b.error).toContain('同名')
    const c = createFolder(a.library, '   ', 1002)
    expect(c.error).toContain('不能为空')
  })

  it('存模型：默认进「未分类」，可以指定文件夹', () => {
    let lib = emptyLibrary()
    const f = createFolder(lib, '临界题', 1000).library
    lib = f
    const folderId = lib.folders[0]!.id
    const r1 = addModel(lib, scene(), { now: 2000 })
    lib = r1.library
    expect(r1.model?.folderId).toBe(UNSORTED)
    const r2 = addModel(lib, scene('loop'), { folderId, now: 2001 })
    lib = r2.library
    expect(r2.model?.folderId).toBe(folderId)
    expect(countIn(lib, UNSORTED)).toBe(1)
    expect(countIn(lib, folderId)).toBe(1)
    expect(modelsIn(lib, folderId)).toHaveLength(1)
    // 最新的排前面
    expect(lib.models[0]!.id).toBe(r2.model!.id)
  })

  it('移动 / 删除 / 删文件夹（里面的模型回到未分类，不跟着消失）', () => {
    let lib = emptyLibrary()
    lib = createFolder(lib, 'A', 1000).library
    const folderId = lib.folders[0]!.id
    const added = addModel(lib, scene(), { now: 2000 })
    lib = added.library
    const modelId = added.model!.id

    lib = moveModel(lib, modelId, folderId)
    expect(countIn(lib, folderId)).toBe(1)

    lib = deleteFolder(lib, folderId)
    expect(folderList(lib)).toHaveLength(1)
    expect(countIn(lib, UNSORTED)).toBe(1)
    expect(lib.models).toHaveLength(1)

    lib = deleteModel(lib, modelId)
    expect(lib.models).toHaveLength(0)
  })

  it('「未分类」不可删除', () => {
    const lib = emptyLibrary()
    expect(deleteFolder(lib, UNSORTED)).toBe(lib)
  })

  it('更新模型：场景写回，但标题不被场景改名（库里的名字是用户认的那一行）', () => {
    let lib = emptyLibrary()
    const added = addModel(lib, scene(), { now: 2000, title: '我起的名字' })
    lib = added.library
    const s = scene('trough')
    s.meta.title = '场景自己的标题'
    lib = updateModel(lib, added.model!.id, s, 3000)
    expect(lib.models[0]!.title).toBe('我起的名字')
    expect(lib.models[0]!.scene.meta.preset).toBe('trough')
    expect(lib.models[0]!.updatedAt).toBe(3000)
  })

  it('上限 60 个，满了给明确错误（不静默丢弃）', () => {
    let lib = emptyLibrary()
    for (let i = 0; i < MAX_MODELS; i++) lib = addModel(lib, scene(), { now: 1000 + i }).library
    const over = addModel(lib, scene(), { now: 9999 })
    expect(over.model).toBeUndefined()
    expect(over.error).toContain(String(MAX_MODELS))
  })

  it('序列化往返：场景、文件夹、时间都在', () => {
    let lib = emptyLibrary()
    lib = createFolder(lib, '斜面', 1000).library
    lib = addModel(lib, scene('rampArc'), { folderId: lib.folders[0]!.id, now: 2000 }).library
    const back = parseLibrary(serializeLibrary(lib))
    expect(back.folders).toHaveLength(1)
    expect(back.models).toHaveLength(1)
    expect(back.models[0]!.scene.meta.preset).toBe('rampArc')
    expect(back.models[0]!.scene.bodies.length).toBeGreaterThan(0)
    expect(back.models[0]!.createdAt).toBe(2000)
  })

  it('坏数据不炸：空串、乱码、缺字段都退回可用状态', () => {
    expect(parseLibrary(null).models).toHaveLength(0)
    expect(parseLibrary('not json').models).toHaveLength(0)
    const partial = parseLibrary(JSON.stringify({ folders: [{ id: 'x', name: 'X' }], models: [{ id: 'm1', scene: { meta: {} } }] }))
    expect(partial.models).toHaveLength(1)
    // 指向不存在文件夹 → 回落到未分类
    expect(partial.models[0]!.folderId).toBe(UNSORTED)
  })

  it('体积估算可读', () => {
    const lib = addModel(emptyLibrary(), scene(), { now: 1 }).library
    const bytes = libraryBytes(lib)
    expect(bytes).toBeGreaterThan(1000)
    expect(formatBytes(bytes)).toMatch(/KB|MB/)
  })
})

describe('用户页的数据管理', () => {
  it('清空建模不影响文件夹和我的题目', () => {
    let lib = emptyLibrary()
    lib = createFolder(lib, '力学', 1000).library
    lib = addModel(lib, scene(), { now: 2000 }).library
    lib = addProblem(lib, makeMineProblem('倾角为30°的斜面，滑块下滑。', 'mine-1', 3000)).library
    const cleared = clearModels(lib)
    expect(cleared.models).toHaveLength(0)
    expect(cleared.folders).toHaveLength(1)
    expect(cleared.problems).toHaveLength(1)
  })

  it('清空我的题目不影响建模', () => {
    let lib = emptyLibrary()
    lib = addModel(lib, scene(), { now: 2000 }).library
    lib = addProblem(lib, makeMineProblem('小球从高为1.2m的平台水平抛出。', 'mine-2', 3000)).library
    const cleared = clearProblems(lib)
    expect(cleared.problems).toHaveLength(0)
    expect(cleared.models).toHaveLength(1)
  })
})
