# 代码地图（从哪看起）

项目根目录：`D:\Slogan`

```bash
npm run dev               # Web: http://127.0.0.1:5173
npm test                  # 145 个单测，最快了解行为
npm run doc:check         # 校验本文件的行数与代码一致（CI 会跑）
```

> **行数不手写。** 下面的表由 `node scripts/doc-facts.mjs --write` 生成；`npm run doc:check` 会拿它和实际文件比对，不一致就报错。
> 正文里也不再写「（NNN 行）」——那正是上次漂成「app.ts 1798 行」的原因。

<!-- FACTS:START -->

| 文件 | 行数 |
|---|---:|
| `packages/ui/src/app.ts` | 4142 |
| `packages/ui/src/editor/layout.ts` | 93 |
| `packages/ui/src/editor/drawing.ts` | 131 |
| `packages/ui/src/pages/bank.ts` | 365 |
| `packages/ui/src/pages/library.ts` | 275 |
| `packages/ui/src/pages/user.ts` | 178 |
| `packages/ui/src/pages/host.ts` | 59 |
| `packages/ui/src/pages/shared.ts` | 57 |
| `packages/ui/src/scene-bounds.ts` | 37 |
| `packages/ui/src/widgets.ts` | 496 |
| `packages/ui/src/icons.ts` | 407 |
| `packages/ui/src/chart.ts` | 194 |
| `packages/core/src/presets.ts` | 1525 |
| `packages/core/src/scene.ts` | 510 |
| `packages/core/src/problem.ts` | 279 |
| `packages/core/src/ai-plan.ts` | 758 |
| `packages/core/src/ai-client.ts` | 116 |
| `packages/core/src/recognize.ts` | 142 |
| `packages/core/src/bank.ts` | 239 |
| `packages/core/src/library.ts` | 246 |
| `packages/core/src/components.ts` | 212 |
| `packages/core/src/ports.ts` | 166 |
| `packages/core/src/validate.ts` | 315 |
| `packages/core/src/params.ts` | 72 |
| `packages/core/src/criterion.ts` | 297 |
| `packages/core/src/serialize.ts` | 251 |
| `packages/render/src/renderer.ts` | 1247 |
| `packages/render/src/camera.ts` | 253 |
| `packages/physics/src/simulation.ts` | 895 |
| `packages/physics/src/forces.ts` | 126 |
| `apps/web/src/main.ts` | 285 |
| `apps/miniprogram/miniprogram/pages/index/index.js` | 179 |

> 这张表由 `node scripts/doc-facts.mjs --write` 生成，`node scripts/doc-facts.mjs` 校验。
> **别手改数字**——手改一定会漂。

<!-- FACTS:END -->

## Scene：唯一真相源

**所有东西都从 `Scene`（`packages/core/src/scene.ts`）派生**：渲染、仿真、分享、持久化、卡片预览。
先记住它的五个字段，代码就好读了——这五个不是按力学/电磁分的，是按**在物理上扮演什么**分的：

| 字段 | 角色 | 参与动力学 | 例子 |
|---|---|---|---|
| `bodies` | **主体**：有质量、会被力推动 | ✅ | 质点、小球、滑块、板、带电粒子 |
| `world` + `fields` | **环境**：不参与动力学，但作用于主体 | ❌ | 重力、匀强 E/B、点源场、介质阻力 |
| `constraints` | **约束**：限制主体能去哪 | 部分 | 地面、斜面、圆弧、绳、杆、弹簧、导轨、滑轮 |
| `criteria` | **判据**：检测「某事是否发生」 | ❌ | 脱离、到达、穿出、相遇、碰撞、守恒 |
| `observers` | **观测**：把状态读出来给人看 | ❌ | 轨迹、矢量、图表、能量条、探针 |

**为什么按角色分而不按学科分**：按力学/电磁分会让「同一个东西出现在两个分类里」（带电小球），按角色分不会。
这个分类决定了面板分几组、序列化怎么写、组合规则怎么校验。

两条贯穿全代码的约定：

- **`params` + `layout()`**：几何参数（θ、R、板长…）不直接改坐标，而是写进 `params`，由预置场景的
  `layout(scene)` 重算几何。这样滑杆、假设 chip、分享串才能共用一条通路。
- **`edits`**：手动拖拽/改参数记在 `scene.edits` 里，`layout()` 之后重新应用——否则改 θ 会把用户拖过的位置冲掉。

## 三条阅读路线

### A. 先懂「产品在做什么」——读 3 个文件

1. [`packages/core/src/scene.ts`](../packages/core/src/scene.ts) — 上面那五个字段的定义。
2. [`packages/core/src/problem.ts`](../packages/core/src/problem.ts) + [`bank.ts`](../packages/core/src/bank.ts)
   — 题目 → 模型的契约（`Scene + assumptions + unsupported`），以及题库里每道题的「能不能建」。
3. [`packages/physics/src/simulation.ts`](../packages/physics/src/simulation.ts)
   — Planck 适配：建世界、每步施力、接触对摩擦、守恒监视、`track` 理想约束（脱离/再接触）。

### B. 想知道「凭什么说那个物理结论是对的」

- [`tests/acceptance.test.ts`](../tests/acceptance.test.ts)：半圆槽等高、动量、圆轨道临界值 vs √(5gR)，全是可执行断言。
- [`docs/PHYSICS.md`](PHYSICS.md)：实测数字、被推翻的方案、能建/不能建的边界。
- [`packages/core/src/criterion.ts`](../packages/core/src/criterion.ts)：6 种判据怎么从事件流里判；判据只看事件流，不判对错。

### C. 想改视觉 / 交互

- [`packages/render/src/renderer.ts`](../packages/render/src/renderer.ts)：2D 填充、描边、阴影、约束线、受力箭头、轨迹、矢量、
  视觉语法（固定剖面线 / 磁场 ×· / 带电符号）。
- [`packages/render/src/theme.ts`](../packages/render/src/theme.ts)：白面板 + 冷灰舞台 + 紫色强调，全在这一个文件。
- [`docs/DRAWING.md`](DRAWING.md)：画图识别阈值、场笔手势、视觉语法、批注约定。
- [`packages/ui/src/app.ts`](../packages/ui/src/app.ts)：**UI 主线，也是最大的技术债**。按方法名跳，别从头读：
  - 场景页：`renderSceneMode` → `renderStageChrome` → `renderChartPanel` → `renderSidebar` → `renderDock`
  - 三个页：`renderBank` / `renderProblemDetail` / `renderLibrary` / `renderUser`
  - 画图：`finishDraw` / `finishFieldStroke` / `commitField` / `renderDrawPreview`
  - 组件：`saveComponent` / `insertSavedComponent` / `renderComponentsPanel`
  - 输入：`pointerDown` / `pointerMove` / `pointerUp` / `key`
  - 拆分计划见 [`REFACTOR-PLAN.md`](REFACTOR-PLAN.md)
- [`packages/ui/src/widgets.ts`](../packages/ui/src/widgets.ts)：滑杆/开关/分段控件，命中区登记也在这里。
- [`packages/ui/src/chart.ts`](../packages/ui/src/chart.ts)：v–t / h–t / y–x 图 + 能量条。

## 文件地图

```
D:\Slogan
├─ README.md                    产品是什么、怎么跑、能力与边界
├─ SESSION-HANDOFF.md           交接：现状 / 坑 / 下一步
├─ docs/
│  ├─ CODEMAP.md                本文件（行数自动校验）
│  ├─ PHYSICS.md                物理正确性：断言、实测数字、边界
│  ├─ AI.md                     AI 建模：三种模式、转发层、key 安全、局限
│  ├─ DRAWING.md                画布：识别 / 场 / 视觉语法 / 批注
│  ├─ COMPONENTS.md             组件：从使用中沉淀
│  ├─ DECISIONS.md              关键取舍、被推翻的结论、已废弃的方案
│  ├─ RESEARCH.md               调研：真题分布 / 开源 / 竞品 / 定位
│  ├─ REFACTOR-PLAN.md          app.ts 拆分计划与进度
│  └─ MINIPROGRAM.md            小程序壳与验证实录
├─ packages/
│  ├─ core/src/
│  │  ├─ scene.ts               Scene 类型 / JSON Pointer / 材质对
│  │  ├─ presets.ts             18 个预置场景 + layout（生成器的落点）
│  │  ├─ problem.ts             题干 → Scene 的规则解析（v0，离线兜底）
│  │  ├─ ai-plan.ts             LLM 的决定层：目录 / 提示词 / 解析 / 校验（纯函数）
│  │  ├─ ai-client.ts           调接口（key 由前端带，服务端不存）
│  │  ├─ recognize.ts           手绘一笔 → 圆/矩形/多边形/直线/折线
│  │  ├─ bank.ts                题库：分类 + 15 道题 + 每条的 expect
│  │  ├─ library.ts             建模库：文件夹 / 模型 / 我的题目 / 组件 + 持久化
│  │  ├─ components.ts          选中集 → 组件（抽取 / 插入 / id 重映射）
│  │  ├─ ports.ts               端口：约束连「接点」而不是裸坐标
│  │  ├─ validate.ts            结构校验：自由度 / 欠过约束 / 悬空引用
│  │  ├─ params.ts              场景参数的可调区间（左侧滑杆的数据源）
│  │  ├─ assumptions.ts         假设 → 可点 chip（只写 params）
│  │  ├─ criterion.ts           判据（detach/reach/escape/coincide/collide/conserve）
│  │  ├─ serialize.ts           存取 / 分享（p1 短串、s1 完整 JSON）
│  │  ├─ shapes.ts              意图形状 → 物理 fixture / 渲染几何
│  │  ├─ snap.ts                吸附：最近表面点 + 法线 + 切线角
│  │  ├─ chain.ts               多过程链构建
│  │  └─ math.ts                向量与几何
│  ├─ physics/src/
│  │  ├─ simulation.ts          ★ Planck 适配 + 绳/杆/弹簧/铰链/轨道 + 受力快照
│  │  ├─ forces.ts              匀强 E/B、点源、阻力（B 用速度旋转，不是加力）
│  │  └─ monitor.ts             动能/势能/动量
│  ├─ render/src/
│  │  ├─ camera.ts              ★ 正交侧视相机（平移/缩放）
│  │  ├─ renderer.ts            ★ 绘制 + 视觉语法
│  │  ├─ ink.ts                 批注墨迹（世界坐标）
│  │  └─ theme.ts               颜色/字体/圆角
│  └─ ui/src/
│     ├─ app.ts                 ★ UI 主线（待拆分，见 REFACTOR-PLAN）
│     ├─ pages/                 题库 / 详情 / 模型 / 用户页（PagesHost 窄接口）
│     ├─ editor/                布局与画图纯函数（layout.ts / drawing.ts）
│     ├─ widgets.ts             控件 + 命中区
│     ├─ chart.ts               图表
│     └─ icons.ts               线性图标
├─ apps/
│  ├─ web/src/main.ts           Web 壳：canvas、指针、键盘、输入弹层、localStorage
│  └─ miniprogram/miniprogram/
│     ├─ pages/index/index.js   ★ 小程序壳（canvas / 触摸 / 原生 modal / 本地存储）
│     └─ utils/app.js           构建产物，别手改
├─ tests/                       + packages/*/src/*.test.ts：21 个文件 / 145 个断言
├─ scripts/
│  ├─ doc-facts.mjs             文档行数校验（npm run doc:check）
│  ├─ build-miniprogram.mjs     打包小程序
│  ├─ mp-verify.mjs             小程序自动化验证（15 项）
│  ├─ shots-editor.mjs          编辑器截图（3 项：README 的 240/241）
│  ├─ shots-draw.mjs            画图 + 组件验收（25 项）
│  ├─ shots-bank.mjs            题库/详情/建模库/用户页 + 改名迁移 + AI 回退（19 项）
│  ├─ ai-check.mjs              打真实接口验 6 道题（需 LLM_KEY 环境变量）
│  ├─ shots-ink.mjs             批注验收（9 项）
│  └─ validate/                 三个前置技术验证（npm run validate）
└─ screenshots/                 桌面端 + 小程序截图（编号越大越新）
```

## 常见改动从哪下手

| 想做的事 | 改哪里 |
|---|---|
| 加一道题库题目 | `core/bank.ts` 加一条（带 `expect`），`tests/bank.test.ts` 会验证「说能建的是不是真能建」 |
| 改题干解析规则 | `core/problem.ts` 的 `parseProblem` |
| 改 AI 提示词 / 模型目录 | `core/ai-plan.ts`（`AI_SYSTEM_PROMPT`，目录从 PRESETS 自动派生） |
| 改 AI 请求（端点/超时/参数） | `core/ai-client.ts` 的 `askPlan` |
| 改手绘识别阈值 | `core/recognize.ts`（圆度 / 面积占比 / 直线度） |
| 改场笔手势 | `ui/app.ts` 的 `finishFieldStroke` / `commitField` |
| 加一种判据 | `core/scene.ts` 的 `Criterion` + `core/criterion.ts` 的 `updateOne` |
| 改左侧参数滑杆 | `core/params.ts`（参数表）+ `ui/app.ts` 的 `renderSceneParams` |
| 改配色 / 字体 | `render/theme.ts`（一套 token 管全部） |
| 改编辑器布局 | `ui/editor/layout.ts` 的 `computeLayout`（纯函数，有单测） |
| 改物体属性面板 | `ui/app.ts` 的 `renderBodySheet` / `setBodyAngle` / `setBodyFriction` / `setBodyVelocity` |
| 改题库页 / 详情页 | `ui/pages/bank.ts` |
| 改建模库 | `core/library.ts` + `ui/pages/library.ts` |
| 改组件抽取 / 插入 | `core/components.ts` + `ui/app.ts` 的 `saveComponent` / `insertSavedComponent` |
| 加一种端口 / 改派生规则 | `core/ports.ts` 的 `derivedPorts` |
| 加一条结构检查 | `core/validate.ts` 的 `analyzeScene` |
| 改 agent 的搭建指令集 | `core/ai-plan.ts` 的 `BuildOp` + `sceneFromOps` |
| 加小程序能力 | `apps/miniprogram/miniprogram/pages/index/index.js` |
| 改吸附规则 | `core/snap.ts` |
| 双击分类 | `ui/app.ts` 的 `cycleClassification` / `classifyBody` |
| 视觉语法（固定/磁场/带电） | `render/renderer.ts` 的 `drawFixedHatch` / `drawFields` / `drawChargeSign` |

## 调试入口

- Web：控制台里 `window.app` 就是 App 实例。`app.loadPreset('trough')`、`app.openProblem('s-loop')`、`app.camera.scale`、`app.simA.state` 都能直接看。
- 小程序：开发者工具控制台里 `getCurrentPages()[0].app` 同理。
- 物理单步：`app.simA.step()`，然后看 `app.simA.state.bodies`。
- 命中区：`app.ui.hits.map(h => h.id)` —— 自动化脚本就是靠 id 点的（`tool:*` / `assume:*` / `bank:*` / `problem:*` / `model:*` / `comp:*`）。
- 截图：`node scripts/shots-editor.mjs` / `shots-draw.mjs` / `shots-bank.mjs` / `shots-ink.mjs`（Web）、
  `node scripts/mp-verify.mjs`（小程序，需 9420 端口）。
