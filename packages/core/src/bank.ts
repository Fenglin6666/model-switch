/**
 * 题库：按物理知识模块组织的题目清单。
 *
 * 首页就是它——不再是「18 个示例卡片」，而是「一道一道题」，点一下生成建模。
 * 三类来源：
 *  - `gaokao`：高考原卷题干（标出处，可核）；
 *  - `sample`：为覆盖可建模情形自编的示例题（明确标「示例」，不冒充真题）；
 *  - `mine`：用户导入的题目（存在本地，不进这个常量表）。
 *
 * 每条都带 `expect`，由 `tests/bank.test.ts` 锁死：说能建的必须真的建出来，
 * 说不能建的必须真的被拒绝。题库不允许出现「点了才知道建不了」的假承诺。
 */
import { GAOKAO_CASES } from './gaokaoCases'

export type BankCategory = {
  id: string
  name: string
  /** 一句话说明这一类在讲什么（空态时用） */
  hint: string
}

export const BANK_CATEGORIES: BankCategory[] = [
  { id: 'mechanics', name: '力学', hint: '运动、力、能量、动量' },
  { id: 'em', name: '电磁学', hint: '电场、磁场、电磁感应' },
  { id: 'thermo', name: '热学', hint: '气体、热力学定律' },
]

export type BankExpect = { kind: 'model'; archetype: string } | { kind: 'unsupported' }

export type BankProblem = {
  id: string
  title: string
  /** 题干原文 */
  text: string
  category: string
  tags: string[]
  /** 出处；自编示例写「示例题（自编）」 */
  source: string
  origin: 'gaokao' | 'sample' | 'mine'
  expect: BankExpect
}

const SAMPLE = '示例题（自编，非真题）'

export const BANK_PROBLEMS: BankProblem[] = [
  // ---- 力学：能建模的示例题（覆盖 parseProblem 支持的 8 类原型） ----
  {
    id: 's-incline',
    title: '斜面滑块：改倾角看加速度',
    category: 'mechanics',
    tags: ['牛顿定律', '斜面'],
    source: SAMPLE,
    origin: 'sample',
    text: '倾角为30°的粗糙斜面，质量为0.5kg的滑块从斜面顶端由静止释放，动摩擦因数为0.25，求滑块沿斜面下滑的加速度。',
    expect: { kind: 'model', archetype: 'incline' },
  },
  {
    id: 's-ramp-arc',
    title: '斜面 + 光滑圆弧：滑到底端的速度',
    category: 'mechanics',
    tags: ['能量', '圆周运动'],
    source: SAMPLE,
    origin: 'sample',
    text: '倾角为30°的斜面底端与半径为0.5m的光滑圆弧相切。质量为1kg的滑块从斜面顶端由静止释放，斜面动摩擦因数为0.2，求滑块到达圆弧最低点时的速度。',
    expect: { kind: 'model', archetype: 'rampArc' },
  },
  {
    id: 's-trough',
    title: '半圆槽：槽会被推走吗',
    category: 'mechanics',
    tags: ['动量守恒', '条件层'],
    source: SAMPLE,
    origin: 'sample',
    text: '质量为1kg的半圆槽放在光滑水平面上，质量为0.2kg的小球从槽的一端由静止释放，判断小球能否回到等高位置。',
    expect: { kind: 'model', archetype: 'trough' },
  },
  {
    id: 's-projectile',
    title: '平抛：落点由什么决定',
    category: 'mechanics',
    tags: ['抛体运动', '理想化假设'],
    source: SAMPLE,
    origin: 'sample',
    text: '小球从高为1.2m的平台边缘以初速度为5m/s水平抛出，不计空气阻力，求小球落地点到平台边缘的水平距离。',
    expect: { kind: 'model', archetype: 'projectile' },
  },
  {
    id: 's-pendulum',
    title: '单摆：周期与摆长的关系',
    category: 'mechanics',
    tags: ['简谐运动', '单摆'],
    source: SAMPLE,
    origin: 'sample',
    text: '摆长为1.5m的细线一端固定，另一端系质量为0.5kg的小球，将小球拉至与竖直方向成40°后由静止释放，求小球经过最低点时的速度。',
    expect: { kind: 'model', archetype: 'pendulum' },
  },
  {
    id: 's-spring',
    title: '弹簧振子：周期由谁决定',
    category: 'mechanics',
    tags: ['简谐运动', '弹簧'],
    source: SAMPLE,
    origin: 'sample',
    text: '劲度系数为40N/m的弹簧一端固定，另一端连接质量为0.5kg的物块，在光滑水平面上做简谐运动，求振动周期。',
    expect: { kind: 'model', archetype: 'spring' },
  },
  {
    id: 's-loop',
    title: '竖直圆轨道：恰好过最高点',
    category: 'mechanics',
    tags: ['临界', '圆周运动'],
    source: SAMPLE,
    origin: 'sample',
    text: '小球在最低点获得初速度为5.5m/s，进入半径为0.6m的竖直圆轨道，判断小球能否通过最高点。',
    expect: { kind: 'model', archetype: 'loop' },
  },
  // ---- 力学：真题（含当前建不了的，诚实标注） ----
  {
    id: 'g-2024-xkb-12',
    title: '2024 新课标 12：板块 + 平抛',
    category: 'mechanics',
    tags: ['动量', '板块', '平抛'],
    source: '2024 新课标卷 第 12 题',
    origin: 'gaokao',
    text: GAOKAO_CASES.find((c) => c.id === '2024-xkb-12')!.text,
    expect: { kind: 'model', archetype: 'boardBlock' },
  },
  {
    id: 'g-2024-jj-11',
    title: '2024 全国甲 11：救护车追及与声速',
    category: 'mechanics',
    tags: ['运动学', '追及'],
    source: '2024 全国甲卷 第 11 题',
    origin: 'gaokao',
    text: GAOKAO_CASES.find((c) => c.id === '2024-jj-11')!.text,
    expect: { kind: 'unsupported' },
  },
  {
    id: 'g-2023-yj-25',
    title: '2023 全国乙 25：圆管、圆盘与多次碰撞',
    category: 'mechanics',
    tags: ['碰撞', '多体'],
    source: '2023 全国乙卷 第 25 题',
    origin: 'gaokao',
    text: GAOKAO_CASES.find((c) => c.id === '2023-yj-25')!.text,
    expect: { kind: 'unsupported' },
  },
  {
    id: 'g-2024-xkb-11',
    title: '2024 新课标 11：两根绳缓慢下放重物',
    category: 'mechanics',
    tags: ['连接体', '绳子'],
    source: '2024 新课标卷 第 11 题',
    origin: 'gaokao',
    text: GAOKAO_CASES.find((c) => c.id === '2024-xkb-11')!.text,
    expect: { kind: 'unsupported' },
  },
  // ---- 电磁学 ----
  {
    id: 'g-2024-xkb-13',
    title: '2024 新课标 13：电场与磁场中的带电粒子',
    category: 'em',
    tags: ['电场', '磁场', '速度空间'],
    source: '2024 新课标卷 第 13 题',
    origin: 'gaokao',
    text: GAOKAO_CASES.find((c) => c.id === '2024-xkb-13')!.text,
    expect: { kind: 'unsupported' },
  },
  {
    id: 'g-2023-yj-24',
    title: '2023 全国乙 24：三个点电荷的电场',
    category: 'em',
    tags: ['静电场', '场叠加'],
    source: '2023 全国乙卷 第 24 题',
    origin: 'gaokao',
    text: GAOKAO_CASES.find((c) => c.id === '2023-yj-24')!.text,
    expect: { kind: 'unsupported' },
  },
  {
    id: 'g-2024-jj-12',
    title: '2024 全国甲 12：导轨、电容与电磁感应',
    category: 'em',
    tags: ['电磁感应', '电容'],
    source: '2024 全国甲卷 第 12 题',
    origin: 'gaokao',
    text: GAOKAO_CASES.find((c) => c.id === '2024-jj-12')!.text,
    expect: { kind: 'unsupported' },
  },
  // ---- 热学 ----
  {
    id: 'g-2024-jj-13',
    title: '2024 全国甲 13：汽缸与理想气体',
    category: 'thermo',
    tags: ['理想气体', '活塞'],
    source: '2024 全国甲卷 第 13 题',
    origin: 'gaokao',
    text: GAOKAO_CASES.find((c) => c.id === '2024-jj-13')!.text,
    expect: { kind: 'unsupported' },
  },
]

export function bankCategoryName(id: string): string {
  if (id === 'mine') return '我的题目'
  return BANK_CATEGORIES.find((c) => c.id === id)?.name ?? id
}

export function bankProblemById(id: string): BankProblem | undefined {
  return BANK_PROBLEMS.find((p) => p.id === id)
}

/** 题库里「能建」的比例，用来在页面上给一句诚实的说明 */
export function bankStats(list: BankProblem[] = BANK_PROBLEMS): { total: number; buildable: number } {
  return {
    total: list.length,
    buildable: list.filter((p) => p.expect.kind === 'model').length,
  }
}

/** 用户导入的题目也走同一个结构（origin='mine'，默认「能建」与否由解析结果决定） */
export function makeMineProblem(text: string, id: string, now = Date.now()): BankProblem {
  const clean = text.trim()
  const head = clean.replace(/\s+/g, ' ')
  const title = head.length > 24 ? head.slice(0, 24) + '…' : head
  return {
    id,
    title: title || '未命名题目',
    text: clean,
    category: 'mine',
    tags: ['我的题目'],
    source: '我的题目',
    origin: 'mine',
    expect: { kind: 'unsupported' },
  }
}

/** 「我的题目」是动态分类：有导入的题目时才出现 */
export function visibleCategories(mineCount: number): BankCategory[] {
  return mineCount > 0 ? [...BANK_CATEGORIES, { id: 'mine', name: '我的题目', hint: '自己导入的题' }] : BANK_CATEGORIES
}
