# 模型开关 · 会话交接（2026-10-25，v5.10）

> 新会话先读这一页，再读 `README.md`、`docs/DECISIONS.md` §22–30、`docs/DESIGN.md` §12–19。
>
> **执行入口：`docs/EXECUTION-PLAN.md`**（做什么、按什么顺序、怎么算做完、下周一开始做什么）。
>
> **2026-10-24 定位更新（优先看 `docs/DECISIONS.md` §30）**：不做课件、不做「讲法」、小程序只做分发端。
> 产品原则：**只提供「物理情境」，不提供「怎么讲」**。核心指标改为 **T = 从「手上有这道题」到「模型能拨」的秒数**（课堂 ≤10s / 备课 ≤60s）。
> 第 8 节里的「P0 图片识别 / 拍照」**已降级为 P3**（成本与「完全免费」冲突）；新的 P0 是**条件表单**（并列主入口）与**假设可勾选**（降低生成后纠错成本）。
> 当前目标已完成；没有需要延续的 goal。下面是继续做产品迭代所需的最小上下文。

---

## 1. 一分钟上手

```bash
cd D:\Slogan
npm install          # 已装过就跳过
npm run dev          # Web: http://127.0.0.1:5173
npm test             # 127 passed
npm run typecheck
npm run build        # Web 产物
npm run build:mp     # 小程序包 → apps/miniprogram/miniprogram/utils/app.js
```

- Node ≥ 20；实测 Node 24 / Chrome / Windows。
- 小程序：微信开发者工具导入 `apps/miniprogram`，AppID 换自己的；自动化验证见 `docs/MINIPROGRAM.md`。
- 截图/UI 测试用 Playwright（`channel: 'chrome'`）；页面里 `window.app` 可访问 App 实例，`a.loadPreset(id)`、`a.fastForward(s)`、`a.frame(0,0)` 可直接驱动。

---

## 2. 产品定位（不要跑偏）

「模型开关」是**高中物理的题目 → 建模工具**：把一道题变成一张形象、易懂、可拨动的物理建模，并且**生成物永远可手改**。

- **主路径是题目**：粘贴文字 → 生成建模。图片识别、拍照是已规划的入口（弹层里占位、标「即将支持」），不是现在的能力。
- 生成的是**初稿**：AI / 规则都不可能次次对，所以拖拽、检查器、世界面板、组件库、多过程链始终可用。**手动修改建模是兜底，也是产品底线。**
- **不判对错、不复现实验、不追求逼真**；只做“改一个条件，看轨迹/判据怎么变”。
- **不做 A/B 对照**；按题目假设先定模型，要比较就改条件再跑。
- 几何用**相对模型尺寸**，不要求等于真实米数。
- **生成不了必须明确拒绝**，并直接给手动建模的路；不能悄悄给一个错模型。
- **不要逐题加 preset**。新能力优先做成可复用组件/约束/观测器；示例只是组件样板。

---

## 3. 当前能力

| 领域 | 实现 | 入口 |
|---|---|---|
| 题目 → 建模 | `parseProblem`（规则生成链路 v0，8 类模型）；生成物是普通 Scene，状态条标「题目初稿 · 可改」 | 选择页「题目 → 建模」、状态条「题目」；弹层里有 文字 / 图片识别 / 拍照 三入口，后两者是占位「即将支持」 |
| 点电荷/库仑 | `world.interactions.coulomb`，成对库仑力 + 库仑势能 | 示例「点电荷」；组件「点电荷」；世界面板开关 |
| 天体/万有引力 | `world.interactions.gravityNBody`，N 体引力 + 引力势能 | 示例「卫星轨迹」；组件「天体」；世界面板开关 |
| 气缸/理想气体 | `Scene.gases` + `prismatic` + P=nRT/V，气压与外界压强差作用在活塞 | 示例「气缸」；组件「气缸」；世界面板 T |
| 碰撞/动量/能量 | 接触 + 恢复系数 + 动量/动能判据 | 示例「两球碰撞」「多体碰撞」；组件「碰撞球」 |
| 滑轮/连接体 | `pulley` 约束（Planck PulleyJoint，地面锚点/绳长/比值） | 示例「滑轮」；组件「滑轮」 |
| 多过程组合 | 斜面→水平→上坡；斜面→水平→圆弧（13 段光滑折线 + 接触） | 示例两条；左栏「多过程链」手动拼 |
| 电场/磁场 | 匀强 E/B + 电荷 + 洛伦兹力；世界面板可加场 | 示例「电场中的带电粒子」「正交电磁场」；世界面板加场 |
| 力学基础 | 斜面/半圆槽/圆轨道/圆弧/平抛/板块/弹簧/单摆；绳/杆/弹簧/铰链/轨道约束 | 示例 + 形状工具 + 连接工具 |
| 编辑/分享 | 空白画布、拖拽/旋转/速度手柄、编辑覆盖层、撤销、紧凑分享 token | 全界面 |
| **批注（v5.3）** | 临时墨迹：一支笔 + 橡皮 + 清空；世界坐标、3px 屏幕线宽、画在最上层、**不进 Scene**、换场景清空 | 左栏「批注」工具（笔尖带波浪线）；状态条「清空」 |
| **题库（v5.5）** | 首页。15 道题按物理知识分类（力学 11 / 电磁学 3 / 热学 1）；每条带「可建模 / 已建 / 暂不支持」，状态由 `parseProblem` 真实结果决定 | 首页；`packages/core/src/bank.ts` |
| **题目详情（v5.6）** | 点题**不直接建模**：先看完整题干（可滚动）+ 来源 + 标签 + 状态，底部才是「生成建模 →」；建过变「打开模型 →」；暂不支持则只有说明 | `App.renderProblemDetail`；命中区 `problem:generate` / `problem:open` / `problem:unsupported` |
| **用户页（v5.6）** | 本地数据统计（建模/文件夹/我的题目/占用）、清空建模库、清空我的题目（都先弹确认）、关于 | `App.renderUser`；`clearModels` / `clearProblems` |
| **建模库（v5.5）** | 收藏夹：文件夹自建自分类、`⋯` 移动、本地持久化、60 个上限、离开画布写回同一条 | 底部「建模库」；`packages/core/src/library.ts` |
| **删除找临界（v5.10）** | 侧栏入口、面板、`core/search.ts`、`core/threshold.ts`、`Scene.search` 全部移除；参数表独立成 `core/params.ts`（左侧滑杆仍要用） | `core/params.ts`；测试 136 → 127 |
| **拆分（v5.9）** | `app.ts` 4772 → 3905 行：页面搬进 `ui/pages/`（`PagesHost` 窄接口），布局与画图逻辑提成**纯函数**（`ui/editor/layout.ts`、`ui/editor/drawing.ts`），新增 19 个 UI 单测 | `docs/REFACTOR-PLAN.md`；`tests/ui-layout.test.ts`、`tests/ui-drawing.test.ts` |
| **编辑器布局（v5.8）** | 左参数面板（标题 / 7 个工具 / 参数滑杆 / 假设 chip / 重新开始 / 重置视图 / 读数卡 / 入口）+ 右舞台（状态药丸 + 播放键 + 分享·世界）+ 底部 v–t 图；白面板 + 冷灰舞台 + 紫色强调 | `panelRect()` / `stageRect()` / `chartRect()` / `renderSidebar()` / `renderStageChrome()` / `renderChartPanel()`；`viewPan()` 让相机对准舞台 |
| **画图（v5.7）** | 没有组件库：笔一落就识别（圆/矩形/多边形/直线/折线），画什么就是什么；电场/磁场是两个独立按钮，按住拖一个矩形就在那块区域建场（点一下=全场），建完在左侧调场强/方向；选中可拖手柄缩放 | 左栏 8 个工具；`packages/core/src/recognize.ts`、`App.finishDraw` / `finishFieldStroke` / `commitField`；`docs/DRAWING.md` |
| **假设可勾选（v5.4）** | 状态条「假设」变成可点 chip：滑块/小球/滚动、光滑/粗糙、固定/可移动、有无阻力；点一下 `layout()` 重算，分享串仍 `p1.` | 状态条；`packages/core/src/assumptions.ts` |
| **视觉语法（v5.4）** | 静态地形 45° 剖面线（固定端）、磁场 ×/· 阵列 + 方向标签、电场箭头、带电 +/−；短边 <24px 不画装饰 | 渲染层自动；`renderer.ts` |

### 手动画板组件库（v5.1）

左栏「+」打开 5 个组件，点一下放在当前视野中央：

1. **点电荷**：q=+1 的带电小球，自动开库仑力。
2. **天体**：M=1000 的静态大质量体，自动开 N 体引力。
3. **碰撞球**：rubber 小球，自动加 rubber–rubber 完全弹性接触对。
4. **气缸**：气缸（static）+ 活塞（dynamic）+ `GasSystem` + `prismatic`。
5. **滑轮**：两端质量 + `pulley` 约束（Atwood 组件组）。

插入的都是普通 body/constraint/gas，后续继续可编辑。组件放在视野中央；如果被底部面板挡住，拖/缩放即可。

### 多过程链面板（v5.0）

左栏「多过程链」：按顺序加斜面/水平/圆弧/上坡（最多 4 段），逐段调角度/长度/半径/圆心角，点「插入画布」生成地形 + 起点小球。

- 核心 API：`packages/core/src/chain.ts` 的 `buildChain(stages, start, prefix)`；返回 `bodies / contactPairs / ball / start / end`。
- 插入后每段都是普通静态地形，小球是普通动态体；可继续拖拽、改材质、加观测器。
- 当前圆弧用 13 段折线近似，不是精确圆弧约束。

---

## 4. 18 个示例

| # | id | 标题 |
|---|---|---|
| 1 | `incline` | 斜面滑块 |
| 2 | `trough` | 半圆槽 |
| 3 | `loop` | 竖直圆轨道 |
| 4 | `projectile` | 平抛 |
| 5 | `spring` | 弹簧振子 |
| 6 | `pendulum` | 单摆 |
| 7 | `rampArc` | 斜面 + 圆弧 |
| 8 | `efield` | 电场中的带电粒子 |
| 9 | `boardBlock` | 板块 + 平抛 |
| 10 | `charges` | 点电荷：电场中的轨迹 |
| 11 | `orbit` | 万有引力：卫星轨迹 |
| 12 | `collision` | 两球碰撞：动量与能量 |
| 13 | `gas` | 气缸：理想气体 |
| 14 | `pulley` | 滑轮：连接体 |
| 15 | `rampChain` | 多过程：斜面 → 水平 → 上坡 |
| 16 | `multiCollision` | 多体碰撞：动量与能量 |
| 17 | `crossedFields` | 正交电磁场：速度选择 |
| 18 | `arcChain` | 多过程：斜面 → 水平 → 圆弧 |

示例在 `packages/core/src/presets.ts`；`PRESETS` 是选择页数据源，`layout()` 负责参数→几何。

---

## 5. 架构

npm workspaces：

```
packages/core      场景类型、预置、链构建、序列化/分享、解析器、判据/搜索、形状/吸附
packages/physics   Planck 仿真、场/库仑/引力、能量/动量监视、气体、约束
packages/render    Camera、Canvas 渲染、气体/轨道/滑轮、主题、图表
packages/ui        整个 Canvas UI（App）、控件、图标、图表
apps/web           Vite Web 壳
apps/miniprogram   微信小程序薄壳（取 canvas、触摸、帧循环）
scripts            build-miniprogram / shots-build / mp-verify / validate
```

数据流：

- **Scene JSON 是唯一真源**；`layout()` 把 `params` 展开成几何；`scene.edits` 是用户编辑覆盖层，分享/重新布局后重放。
- 物理用固定步长 + substeps，确定性；`settle` 沉静期避免刚放下的形状被位置修正顶一下。
- 分享用紧凑 `p1.` token（`t/p/a/e`）；旧版 `v`-only 链接回退到 preset 默认。
- 解析器只生成已有单/双体预置；不能自动生成的明确 `unsupported`（电磁、热学、光学、波、多过程、连接体等），不要静默近似。

### 关键文件

| 文件 | 内容 |
|---|---|
| `packages/core/src/scene.ts` | `Scene`/`Body`/`Constraint`/`Field`/`Observer`/`Criterion`/`GasSystem` 类型；`World.interactions` |
| `packages/core/src/presets.ts` | 18 个 preset + layout + `blankScene` |
| `packages/core/src/chain.ts` | `buildChain`、`defaultChain`、`stageLabel` |
| `packages/core/src/problem.ts` | 题目生成链路 v0（规则解析）；Scene + 假设 + `unsupported` 契约 |
| `packages/core/src/bank.ts` | 题库：分类、15 道题、`expect`（能不能建）、导入题结构 |
| `packages/core/src/library.ts` | 建模库：文件夹 / 模型 / 我的题目、序列化与容错解析 |
| `packages/core/src/assumptions.ts` | 假设 → 可点 chip：`assumptionToggles` / `cycleAssumption`（只写 params） |
| `packages/core/src/recognize.ts` | 手绘识别：闭合圆度 / 面积占比 / 直线度 → 圆·矩形·多边形·直线·折线 |
| `packages/core/src/threshold.ts` | 临界通用化：参数区间表、候选判据、`thresholdSpec`（与旧 `scene.search` 同构） |
| `packages/core/src/serialize.ts` | 分享 token / 规范化 |
| `packages/physics/src/simulation.ts` | 仿真主循环、约束、气体、状态 |
| `packages/physics/src/forces.ts` | 场、库仑、N 体引力 |
| `packages/physics/src/monitor.ts` | 能量/动量（含势能） |
| `packages/render/src/renderer.ts` | 场景绘制、气体、pulley/prismatic/track |
| `packages/ui/src/app.ts` | UI 编排：场景页、输入、相机、历史、setter；页面/布局/画图逻辑已拆走 |
| `packages/ui/src/pages/` | 题库页 / 题目详情 / 模型页 / 用户页（`PagesHost` 窄接口） |
| `packages/ui/src/editor/layout.ts` | 布局纯函数（面板/舞台/图表/相机偏移/浮动面板） |
| `packages/ui/src/editor/drawing.ts` | 画图纯函数（拖区域建场、识别→Body、缩放） |
| `packages/ui/src/widgets.ts` | Canvas 控件（按钮/滑杆/命中区） |
| `apps/miniprogram/.../pages/index/index.js` | 小程序薄壳 |

### 数据模型补充

```ts
world.interactions = {
  coulomb?: { k: number }
  gravityNBody?: { G: number }
}

body.charge?: number
body.linearDamping?: number   // 气缸活塞“缓慢过程”用

scene.gases: Array<{
  id, cylinderId, pistonId,
  floorY, width, pistonHalf, area,
  n, temperature, ambientPressure, gasConstant?
}>

constraint:
  | { type:'rope'|'rod'|'spring'|'hinge', ... }
  | { type:'pulley', a, b, groundA, groundB, lengthA, lengthB, ratio?, pulley? }
  | { type:'prismatic', bodyId, centerBodyId, axis:'x'|'y', lower?, upper?, anchor? }
  | { type:'track', bodyId, centerBodyId, radius, side, fromAngle?, toAngle?, entry? }
```

- 气体：每步按 `P = nRT/V` 算气压，`(P − P0)·A` 作用在活塞；机械能不含气体功（热学过程不套机械能守恒）。
- 库仑/引力：成对施加；能量监视器含库仑势 `k qa qb / r` 和引力势 `−G ma mb / r`。
- 约束： rope/rod/spring/hinge 走关节；spring 是真实施力（能量更好）；track 是 DistanceJoint；pulley 是 Planck PulleyJoint；prismatic 是 Planar 约束。
- `track` 的 `entry/fromAngle/toAngle` 是为精确圆弧入口/出口写的；**目前部分圆弧链没有用它**（见第 9 节）。

---

## 6. 界面入口

- **四个页面**：`mode = 'user' | 'bank' | 'library' | 'scene'`，底部深色三栏（用户 / 题库 / 模型 N）。`problemOpen` 是盖在题库上的详情页，不算独立 mode（tab 仍可点）。
- **题库（首页）**：分类 chips（全部/力学/电磁学/热学/我的题目）+ 题目卡片（标题、来源、状态、题干两行、标签）。点卡片 → `openProblemDetail(id)`（**先看题，不建模**）；详情页按「生成建模」才走 `generateFromText`。右上角「生成建模」是贴题干入口。
- **建模库**：文件夹 chips（未分类 + 自建）+ 模型卡片（场景预览 + 标题 + 文件夹/日期）。卡片点开画布，`⋯` 打开移动面板（移动 / 删除 / 新建文件夹）。
- **生成建模弹层**：Web 是 DOM 弹层（`openTextDialog`，`onSubmit` 返回结果，失败**不关窗**在原位显示原因）；小程序是 `wx.showModal({editable})`，失败再弹一次说明。
- **没有空白画布、没有示例卡片墙、没有条件表单**（v5.4 做过条件表单，v5.5 按方向调整删除）。
- **题目弹层（Web）**：`apps/web/src/main.ts` 的 `openProblemDialog`；三入口「粘贴文字 / 图片识别 / 拍照」，后两者 disabled 且点了只说明“还没做”；失败时错误信息 + 点亮「手动搭：从空白画布开始」。
- **题目入口（小程序）**：`pages/index/index.js` 的 `openProblemDialog` 用 `wx.showModal({editable:true})`；失败二次弹窗，confirm 直接 `app.loadBlank()`。
- **左参数面板（v5.8）**：标题 + 副标题 → 7 个工具（选择/手绘/场/连接/批注/橡皮/平移，命中区 `tool:*`）→ 参数滑杆（未选中时是场景参数，选中后是物体参数）→ 假设 chips（`assume:*`）→ 重新开始 / 重置视图 → 读数卡（速度/时间/位移 + 判据）→ 世界/题目/返回。窄屏时面板变底部抽屉，内容可上下拖。
- **右舞台**：左上 播放键 + 状态药丸，右上 分享 / 世界；底部是 v–t 图面板（有 chart 观测器才有）。属性面板（选中物体/约束、世界面板）浮在舞台底部。
- **相机**：视口仍是整窗，但 `viewPan()` 把内容偏到舞台中心——所以指针坐标不用做任何换算。
- **底部**：状态条 / 组件检查器 / 约束检查器 / 世界面板；选中时才出现抽屉。
- **世界面板**：重力 g；库仑力/ N 体引力开关；加匀强电场/磁场 + E/B 滑杆；气体 T；空气阻力。
- **检查器**：质量、电荷 q、摩擦、初速度、半径/几何、角度、材质、删除、添加外力。
- **观测卡**：v–t 图、能量条；顶部图表键默认收起。
- **假设 chip**：状态条上「假设」后面的 chip 可点，点一下循环到下一个取值；窄屏（手机/小程序）状态条只留这条交互。
- **分享/题目**：顶栏分享；「题目」打开生成弹层（Web）/ 原生输入弹窗（小程序）；生成失败在弹层里直接转到空白画布。
- **多过程链面板**：阶段行、增删、参数滑杆、插入画布。
- **组件面板**：点电荷/天体/碰撞球/气缸/滑轮。

移动端：界面按 canvas 宽度自适应；链/组件面板在窄屏可能偏挤，是已知待打磨项。

---

## 7. 验证与产物

最近一次：

```
npm test                     127 passed
npm run typecheck            通过
npm run doc:check            文档行数与代码一致
node scripts/shots-draw.mjs  19/19  # 识别 5 类 / 吸附 / 缩放手柄 / 场三手势 + 区域 / 物理 / 无组件按钮
node scripts/shots-ink.mjs   9/9   # 批注：进入批注态、画一笔、世界坐标、缩放保留、清空、橡皮、换场景清空
node scripts/shots-bank.mjs  14/14  # 三栏 / 点题进详情 / 详情生成 / 打开已建 / 暂不支持 / 用户页清空 / 持久化 / 手机尺寸
node scripts/mp-verify.mjs   16 项   # 小程序端含点题进详情、详情生成、建模库、假设 chip
npm run build                452.4 KB / gzip 124.1 KB
npm run build:mp             465.7 KB
```

> `mp-verify` 在本机开发者工具负载高时**会偶发** `timeout waiting for automator response`：报错停在哪个用例是随机的（截图 / 重仿真步骤最容易撞上），重跑即过，不是断言失败。排查过：开发者工具渲染进程 CPU 时间已累计 39 小时，automator 的请求超时改不了。已做两处缓解：搜索后截图改成非致命、搜索用例把 `duration` 收到 1.5s + 步长 1/240。

- 测试覆盖：投影往返、场景物理验收、吸附、判据、序列化/分享、真实高考题覆盖、库仑/引力/碰撞、气缸/滑轮、多过程/圆弧、E/B 场、多体/交叉场、链构建。
- `scripts/shots-draw.mjs` 是画图验收（识别 / 电场磁场 / 手柄），`shots-bank.mjs` 是题库与详情页，`shots-ink.mjs` 是批注；三个都需要 dev server 在 5173。旧的 `shots-build.mjs`（形状工具）和 `shots-problem.mjs`（题目弹层）随工具改版删除了。
- 小程序包在 `apps/miniprogram/miniprogram/utils/app.js`，改源码后必须重新 `npm run build:mp`。

---

## 8. 已知边界 / 下一步（建议顺序）

> **v5.5 方向调整（2026-10-24）**：用户明确否掉了「条件表单」和「空白画布」，首页改成**题库**、产物进**建模库**。原来的阶段一 1.1（条件表单）已删除；1.2 假设 chip、1.3 视觉语法、1.4 临界通用化保留。
> 阶段二 2.1 的「场景集 `c1.`」被**本地建模库**部分替代（零后端、按文件夹分类，见 `library.ts`）；链接分享仍只有单场景 `p1.`/`s1.`。

### P0：题库内容与分类

- 现在 15 道：8 道自编示例题（覆盖 `parseProblem` 的 8 类原型）+ 7 道真实高考题（多为「暂不支持」，用来诚实展示边界）。
- 扩充就改 `packages/core/src/bank.ts`，`tests/bank.test.ts` 会逐条验证「说能建的是不是真能建」——**不要往题库里塞会失败的可建模标签**。
- 分类口径沿用真题统计的「知识模块」轴（力学/电磁学/热学），需要时加光学/近代。

### P0：老师试（非代码，最高优先）

- 打开 `npm run dev` → 题库点一道题 → 生成 → 改参数 → 存进文件夹，全程计时。
- 记录三件事：① 从「点题」到「能拨」几秒；② 他会不会自己建文件夹；③ 会不会回头再打开旧模型。
- 判断标准：如果老师根本不回访建模库，说明「收藏夹」是伪需求，下一版砍掉。

### P1：建模库的缺口（已知，先不做）

- 不能重命名模型 / 文件夹（只能新建和删）。
- 不能导出 / 导入 `.json`（换设备就丢；`docs/COLLECTION-DESIGN.md` 的链接装箱方案还在）。
- 库里存的是完整 Scene（约 8–30 KB/个），60 个上限是 localStorage 的保守值；小程序单 key 1 MB，接近时要在 UI 上提示。

### P1：题目入口扩展（图片识别 / 拍照）### P1：题目入口扩展（图片识别 / 拍照）

- 现状：弹层三入口已就位；只有「粘贴文字」可用，另外两个点了只说明“即将支持”。
- 图片识别：截图 / 题干配图 → OCR / 图形理解 → 与文字入口同一契约（Scene + assumptions + `unsupported`）。需要图片选择/压缩、识别服务（或本地模型）、以及“哪些是猜的”表达。
- 拍照：小程序 `wx.chooseMedia` / 相机；Web `getUserMedia` 或 `<input capture>`；图片不落盘，注意隐私。
- 原则：不为图片另起一套模型表达；识别失败仍落到空白画布；不假装能识别。

### P0：生成质量与「初稿」表达

- 现在 `parseProblem` 是规则链路 v0（关键词 + 数字），不是大模型；AI 接入只替换“题干 → 模型选择/参数”，输出仍是 Scene + 假设。
- 需要把“猜的”显式标出来：哪些参数是题目给的、哪些用了默认值、哪些不确定。现在只有 `meta.assumptions` 字符串；可以在状态条/检查器里区分“题目给的”和“默认/推断的”。
- 仍然不静默近似；生成不了就 `unsupported`。

### P0（阶段二）：场景集 `c1.`

- 一个链接装多个模型；Web 编辑 + 小程序只读列表；6 个场景 ≤900 字符；旧 `p1.`/`s1.` 继续有效。
- 设计稿在 `docs/COLLECTION-DESIGN.md`（零后端、按字节装箱）。注意：带批注的场景不进场景集（体积），UI 要明说。

### P1（阶段二）：约束退化

- 斜面 θ=0→水平面、弹簧 k→∞→杆、板 m→∞→地面；**必须是参数连续变化的结果**，不做隐藏开关。
- 覆盖率的第二个杠杆：6 个约束 + 退化覆盖 85% 的约束出现频次，成本只有 3 人日。

### P1：精确圆弧/圆轨道多过程链

- 现状：`arcChain` 用 13 段折线近似圆弧 + 接触，能跑、已上架；`buildArcChain` 已导出但不再用 track。
- 已有底层：`track` 约束支持 `entry`、`fromAngle`、`toAngle`，渲染器能画部分圆弧；入口/出口/释放代码在 `simulation.ts`。
- 未解决：精确圆弧入口处，球到入口挂上 DistanceJoint 后速度从 ~4.5 掉到 0；之前还遇到过固定旋转矩形在斜面/水平段最低角蹭地（圆形球已解决）。
- 下一会话建议：
  1. 用接触列表/关节 reaction 日志确认入口处是关节冲量、地面/水平段接触还是附着时机导致；
  2. 入口点放在圆弧上，按切向速度挂接；把关节 `length` 设为实际距离，避免瞬间位置修正；
  3. 或者用“多段小圆弧 + 只有法向约束”的链；保留当前折线链作为 fallback；
  4. 通过后再替换 `arcChain`，不要先改示例页。

### P1：速度空间题

- 2024 新课标 13 这类“速度空间”题，当前只有实空间轨迹和 v–t。
- 建议加一个 `observer`：`{ kind:'phase', series:[{bodyId, quantity:'vx'},{bodyId, quantity:'vy'}] }`，图表画 vx–vy 相图；再谈题目解析。
- 不要把它做成某道题的写死预置。

### P1：气缸过程

- 目前只有等温 `P=nRT/V`，T 是世界面板常量；没有等压/等容/热力学第一定律/吸放热。
- 建议：给 `GasSystem` 加 `process: 'isothermal'|'isobaric'|'isochoric'` 或加 `Q`/`W` 观测；先做状态量读数，不要急着做热机。

### P2：滑轮/连接体的一般化

- 现在“滑轮”是 Atwood 组件组；`pulley` 约束已支持 ratio，但没有任意放置滑轮的 UI。
- 可以加“滑轮工具”：先选两个 body，再在世界面板设地面锚点/绳长；或先做一个可拖的滑轮点。
- 绳/杆/弹簧的 connect 工具已有；注意锚点 local/world 的转换。

### P2：更多碰撞

- 两体、三体已验收；引擎支持更多，但没有 4+ 示例。加一个 4 球链或牛顿摆时，先确认接触对和恢复系数。

### P2：生成器覆盖扩展

- 现在明确拒绝电磁、热学、光学、波、多过程、连接体等；`docs/GAOKAO.md` 有真实题边界。
- 新组件已经能手动覆盖大部分；扩展生成器时**不要为了覆盖率静默近似**。
- 优先把“多过程链 / 点电荷 / 天体”做成明确的生成模式（同样输出 Scene + assumptions），并保留 `unsupported` 的诚实提示。

### 待打磨

- 组件插入在视野中央，可能落在底部抽屉下面；可加“自动放到可见区域上方”或插入后轻量 fit。
- 链/组件面板窄屏适配；小程序端真机再走一遍。
- `buildArcChain` 已导出但当前用折线；track 的入口代码未被示例使用，后续要么接上要么清掉。
- `package.json` 描述已修正；根目录旧截图很多，README 只引用关键图。

---

## 9. 开发/调试技巧与坑

- **PowerShell 的 backtick / UTF-8**：不要用 `Get-Content | Set-Content` 改源码；用 `write` / `edit` 工具，或 Node `fs.writeFileSync(...,'utf8')`。PowerShell here-string 里的模板字符串 backtick 会被吃掉。
- **多体组件 id**：`nextBodyId()` 连续调用两次会都返回 `b1`；同一次插入多个 body 用 `nextBodyIds(n)` 预留。
- **固定旋转矩形在斜坡上**：到水平段仍保持斜面角度，最低角可能蹭地；用圆形球或让角度归零。
- **链的圆弧**：`buildChain` 的 arc body 原点要在 `(x, y+r)`，这样弧底在 `(x,y)`；否则弧跑到水平段下方。
- **气缸活塞**：加 `linearDamping` 表达缓慢过程，避免自由振荡；能量判据不适用于有气体做功的过程。
- **相机**：`view.fit === false` 时显式 scale/center；auto-fit 会把 `ground` 排除，但会把平台/长地面算进去，必要时设 `fit:false`。
- **UI 命中**：控件用 `this.ui.*` 注册命中区；自定义行用 `this.ui.add({ id, rect, cursor, onClick })`；后画的优先。
- **scene 修改**：`this.pushHistory()` → 组装新 `this.doc` → `this.rebuild()`；需要取景再 `this.fitCamera()`。
- **分享**：`encodeShare/decodeShare`；新增字段要同步 `serialize.ts` 的 normalize。
- **题目入口**：Web 弹层在 `apps/web/src/main.ts` 的 `openProblemDialog`，小程序在 `pages/index/index.js`；两处只负责拿文本 → `app.loadProblemText`，生成逻辑只在 `packages/core/src/problem.ts`。加图片/拍照时也复用这条链路，不要在壳里另写建模。
- **生成初稿提示**：`App.fromProblem` 控制状态条「题目初稿 · 可改」；`loadScene` 会清掉，`loadProblemText` 成功后置 true。
- **小程序输入弹窗**：`wx.showModal({editable:true})` 需要基础库 2.17.1+；`confirmText` / `cancelText` 最多 4 个字，失败二次弹窗别再塞长按钮文案。
- **测试**：物理场景用 `Simulation` 步进；固定步长下 `fastForward` 与真实时间无关；判据在 `state.criteria`。
- **Playwright**：`channel:'chrome'`、`waitForFunction(() => !!window.app)`；截图 `deviceScaleFactor: 2`；Web 端截图目录 `screenshots/`。

---

## 10. 新会话第一句话（可直接粘贴）

```
项目在 D:/Slogan（模型开关）。先读 SESSION-HANDOFF.md，再读 README、docs/DRAWING.md。

现状：v5.9。底部三栏：用户 / 题库 / 模型。
- 题库：点一张题 → 题目详情（完整题干）→ 按「生成建模」→ 模型进「模型」页（收藏夹，自建文件夹，本地持久化）。
- 画布：**没有组件库**。笔一落就识别（圆/矩形/多边形/直线/折线），画什么就是什么；场笔＝画箭头→电场、点一下→磁场向外、画×→磁场向里，第二笔拖区域限定范围；选中可拖右下角手柄缩放。
127 个测试；小程序包 465 KB。假设 chip、视觉语法、画图识别都在。
app.ts 已从 4772 行拆到 3905：页面在 ui/pages/，布局/画图逻辑是纯函数（有单测），剩余拆分计划见 docs/REFACTOR-PLAN.md。
明确否掉的：条件表单、空白画布、首页示例卡片墙、组件库按钮、形状调色板——别加回来。

下一步优先级：
1) 找老师试：题库 → 详情 → 生成 → 在画布上画几笔 → 存进文件夹，全程计时；
2) 手绘识别调优（旋转矩形？多笔画组合？见 docs/DRAWING.md §6）；
3) 模型页缺口：重命名、导出/导入 .json、容量提示；
4) 约束退化（θ→0、k→∞、m→∞，参数连续变化，不做开关）；
5) 阶段三 3.1 精确圆弧验证（0.5 天，先花半天省掉 8 天）。

先跑 npm test / npm run typecheck / npm run dev 确认基线，再动代码。不要大改架构。
```

---

## 11. 文档索引

- `README.md`：产品定位、快速开始、18 示例、题目 → 建模入口、关键截图、构建命令。
- `SESSION-HANDOFF.md`：本页。
- `docs/DECISIONS.md`：§21 真实高考题边界；§22–28 通用相互作用/气缸/多过程/多体/圆弧/拼链/组件库；§29 产品定位调整（题目优先 + 手动兜底）。
- `docs/DESIGN.md`：§11 板块；§12–18 通用交互/热学/多过程/多体/圆弧/拼链/组件面板；§19 题目优先的入口层级。
- `docs/GAOKAO.md`：真实题实测与“能建/不能建”。
- `docs/CODEMAP.md`：代码地图。
- `docs/EXECUTION-PLAN.md`：**产品执行方案 v1**（三阶段路线图 + 优先级依据 + 五个待验证假设）。
- `docs/GAOKAO-20Y-CLASSIFICATION.md`：2006–2026 真题（304 卷 / 4462 题）收集与四轴分类，含可建模性分布。
- `docs/COMPONENT-SYSTEM.md`：组件体系（四类角色 + 参数 schema + 退化关系 + 优先级）。
- `docs/VISUAL-GRAMMAR.md`：视觉语法（外观即语义：固定/粗糙/带电/磁场 ×· 的编码规则）。
- `docs/ANNOTATION-DESIGN.md`：批注（临时墨迹 L2 优先，结构化批注 L1 次之；笔迹进不了场景集）。
- `docs/INTEGRATION-WITH-TEACHING-SOFTWARE.md`：老师用什么软件讲课、希沃 Web 插件能否嵌入建模（能，但需企业主体+商务合作）。
- `docs/PANEL-DESIGN.md`：属性面板（Excalidraw/myPhysicsLab 参考 + schema 驱动方案 + 迁移路径）。
- `docs/COLLECTION-DESIGN.md`：场景集（`c1.` 一个链接装多个模型）。
- `docs/POSITIONING-REVIEW-COURSEWARE.md`：为什么不做课件。
- `docs/MODELING-OSS-REVIEW.md`：建模类开源项目调研（含 myPhysicsLab 1D 路径解法）。
- `docs/MINIPROGRAM.md`：小程序壳/自动验证。
- `docs/VALIDATION.md`：技术验证。
- `screenshots/`：关键最新图 180–186（题目优先入口；186 是小程序端）；160–177 是通用组件/链；旧图保留但不要全塞 README。

---

## 12. 当前工作区状态

- 根目录无临时补丁脚本（`scripts/_*` 已清理）。
- 最新截图（v5.9）：`240-editor`、`241-editor-selected`、`242-editor-draw`、`244-user`；`220`–`232` 仍有效。
- v5.9 改动面（拆分）：新增 `packages/ui/src/pages/{host,shared,bank,library,user,index}.ts`、`packages/ui/src/editor/{layout,drawing}.ts`、`packages/ui/src/scene-bounds.ts`、`tests/ui-{layout,drawing}.test.ts`、`docs/REFACTOR-PLAN.md`、`scripts/doc-facts.mjs`（`npm run doc:check`）；`app.ts` 只留转发与编排；`docs/CODEMAP.md` 重写为「事实块 + 阅读路线」。
- 目标已完成，新会话可直接按第 10 节开新目标；不需要 resume 旧 goal。
