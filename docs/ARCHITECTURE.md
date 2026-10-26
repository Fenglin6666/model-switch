# 架构设计

> 这份文档回答「它是怎么搭的、为什么这么搭」。产品是什么、给谁用、能做什么，见 [README](../README.md)。

---

## 1. 一句话

**一道题 → 一份 `Scene` JSON → 一个跑得动、改得动、分享得出去的物理模型。**

所有能力都挂在这条链上：AI 只负责**产出一份合法的 Scene**，渲染/物理/判据都从 Scene 派生，
用户的所有修改也都落回 Scene。没有第二条真相源。

```
题目文本 ──AI──▶ Scene JSON ──┬──▶ physics（planck 适配）──▶ 状态帧 ──▶ render
                              ├──▶ render（纯 Canvas 2D）
                              └──▶ criterion（判据 / 守恒监视）
        ▲                     │
        └──── 用户编辑 ◀───────┘（拖拽 / 滑杆 / 绘制 / 组件）
```

## 2. 分层与依赖

```
packages/core       Scene 类型、形状转换、吸附、判据、参数表、序列化、题库、库、组件、预置
packages/physics    planck 适配、自定义场力、守恒监视、轨道约束、结构校验的运行时
packages/render     正交侧视相机、2D 填充描边、受力箭头、轨迹矢量、视觉语法
packages/ui         Canvas 自绘 UI、页面（题库·模型·用户）、检查器、图表、编辑器交互
apps/web            Web 壳（Vite）
apps/miniprogram    小程序壳（原生 canvas 2d，约 160 行适配）
```

依赖是单向的：`core ← physics ← render ← ui ← apps`。`core` 零渲染、零引擎依赖，判据能在 Node 里 headless 跑。

**UI 全部画在 canvas 上（无 DOM）**：输入被归一化成 `pointerDown/Move/Up + wheel + key`，
Web 和小程序共用同一份 `@ui/app`，只换宿主。安全区由宿主通过 `insets` 传进来。

## 3. 数据模型：Scene

`Scene` 是唯一真相源（`packages/core/src/scene.ts`）：

| 字段 | 作用 |
|---|---|
| `bodies` | 物体。`kind` = static / kinematic / particle / rigid；`shape` 决定几何 |
| `constraints` | 物体之间的连接（11 种，见 §4.2） |
| `fields` | 场：匀强 E / 匀强 B / 点源 / 阻力，可限定在 `regionId` 里 |
| `regions` | 区域：场的限定范围、判据靶子 |
| `observers` | 观测器：轨迹 / 矢量 / 图表 / 能量读数 |
| `criteria` | 判据：守恒 / 脱离 / 飞出 / 到达 / 共速 / 碰撞 |
| `params` | **预置场景的标量参数**。滑杆绑它，`layout()` 在重置时把它展开成几何 |
| `edits` | **用户编辑覆盖层**。`layout()` 会重排几何，编辑必须能盖回去 |
| `guides` | 教学辅助线（等高线、目标线），不参与物理 |

三个关键约定：

1. **`params` + `layout()` 是「一改参数就换一套几何」的唯一机制**。改 θ 不是改一个数，是重排整条斜面。
   所以 UI 滑杆写 `params`，不直接改 `bodies[i].transform`。
2. **`edits` 覆盖层保证「改完不被布局冲掉」**。`layout()` 之后调 `applyEdits()` 盖回去，
   分享/撤销/重置都走这条路。
3. **形状是纯几何，物理性质在 `Body` 上**。同一个 `rect` 可以是地形、可以是滑块、可以是薄板——
   由 `kind` / `role` / `mass` / `friction` 决定。

### 3.1 形状

7 种：`circle` / `rect` / `polygon` / `arc` / `polyline` / `bezier` / `compound`。
`compound` 让一个刚体由多个形状组成（半圆槽 = 弧 + 底座），是预置级别的构造，agent 暂时不能拼。

渲染精度有两档（`Precision`）：`teach`（教学，弧采样粗、便宜）和 `verify`（校验，采样细）。

## 4. 物理层

引擎是 **planck**（Box2D 的 JS 移植），只做刚体 + 关节。**场力和弹簧不用引擎的力，自己算**：
每子步直接往物体上 `applyForceToCenter`，因为引擎的力接口不区分场/接触，没法单独读出来画箭头。

### 4.1 为什么场力必须「每子步施加」

洛伦兹力如果用「每帧加一个外力」实现，会**越算越偏**：力的大小依赖速度，而速度在帧内还在变。
现在的做法是**旋转速度矢量**（θ = −(q/m)·B·dt），速率严格不变、能量不漂——
这是 `scripts/validate/lorentz-drift.mjs` 专门验证过的一条。

### 4.2 约束 → 引擎的映射

| 约束 | 引擎实现 | 备注 |
|---|---|---|
| `rope` | RopeJoint（只拉不推） | 超过长度才绷紧 |
| `rod` | DistanceJoint（length, 无软约束） | 能推能拉 |
| `spring` | **自定义力** F = k(x−l₀) + 阻尼 | 用真实力才能画箭头、才能量守恒 |
| `hinge` | RevoluteJoint（`collideConnected: false`） | 门和门框本来就贴着，不关碰撞会互相顶 |
| `pulley` | PulleyJoint | 两端位移相等，张力按 ratio 分配 |
| `prismatic` | PrismaticJoint（可带行程限位） | 限位是**相对**建立时刻的位移，不是绝对坐标 |
| `track` | DistanceJoint 锁球心 + 每步读反力 | 反力为负（需要「拉」）就销毁关节 = 脱离 |
| `belt` | 接触求解器的 `setTangentSpeed` | 带体不动，**表面**在动；符号取决于 fixture 是 A 还是 B |
| `pin` | 静态锚点 + RevoluteJoint | 钉住的点不动，物体可绕它转 |
| `motor` | 每子步 `setAngularVelocity` | 伺服语义：确定、可复现 |
| `circuit` | **自定义力** F = −BIL，I = (BLv+emf₀)/R | 导体棒切割磁感线，见 §4.4 |

### 4.3 轨道约束：为什么要读反力

`track` 是「球被约束在圆上」，但如果用圆弧的多边形碰撞体去挡球，每跨一条弦就丢一点能量
（1/960 步长下仍漏 2–3%）。改成理想约束后偏差 0.24%，代价是**必须自己判断脱离**：
每步读关节反力，需要「拉」球时（法向力 < 0）销毁关节。脱离后留 8 mm 再接触滞回，避免贴着轨道抖。

### 4.4 电磁感应（`circuit`）

一条**约束**，不是一种场。因为它描述「棒 + 回路 + 磁场」三者的耦合：

```
ε = B·L·v + emf₀     →     I = ε/R     →     F = −B·I·L
```

安培力必须反抗相对运动（楞次定律），取负号；这也保证收尾速度 v∞ = F·R/(B²L²) 是稳定解。
每子步算一次（v 在变，I 也跟着变）。数值由 `tests/induction.test.ts` 卡死。

### 4.5 判据与守恒

`criteria` 是「物理洞察」的表达层：守恒（动量/能量）、脱离轨道、飞出区域、到达、共速、碰撞。
判据**不判对错**，只说「条件是否被检测到」——UI 用「已发生 / 未发生」，不用红绿。

## 5. 渲染层

纯 Canvas 2D，没有绘图库。正交侧视相机（`scale` + `center`），世界坐标 ↔ 屏幕坐标双向投影。

**视觉语法**（`packages/render/src/renderer.ts`）：不发明符号，用教材已有的——
静态地形画 45° 剖面线（= 固定端）、磁场画 ×·、带电体标正负、力箭头按类型分色
（重力灰、外力 F1/F2、场力 qE、安培力 F安、张力 T）。

**立即模式 UI**（`packages/ui/src/widgets.ts`）：每帧先 `ui.reset()` 清空命中区，
渲染时顺手 `ui.add({id, rect, onClick})` 重新登记。没有组件树、没有 diff，
所以「按钮位置跟着内容走」不需要任何状态同步。

## 6. 交互层

输入归一化成 `pointerDown / pointerMove / pointerUp / wheel / key`，宿主只负责把原生事件翻过来。

- **点选**：`pickBody` 按「离点击点最近」排序，不是「最后画的在上」。
- **拖拽**：屏幕位移反投影成世界位移；拖手柄缩放时按包围盒等比。
- **绘制**：笔画先 `simplifyPath` 再 `recognizeStroke` 判意图（圆/矩形/三角/直线/折线），
  再 `bodyFromRecognized` 落成带物理性质的物体。**画什么就是什么**，没有组件面板。
- **吸附**：落在斜面上的球会自动贴上去（`findSnap` / `applySnap`）。

## 7. 生成层（AI）

只有一条路：模型读题、决定怎么建。四种 mode，**没有「大概差不多」这个选项**：

| mode | 含义 | 落点 |
|---|---|---|
| `preset` | 选一个已有预置 + 参数 | `buildPresetScene` + `layout()`，几何一定合法 |
| `chain` | 拼阶段（斜面/水平/圆弧/上坡，≤6 段） | `sceneFromStages` |
| `build` | 用基元指令现搭 | `sceneFromOps`，见 §7.1 |
| `unsupported` | 明确说建不了 | 原地说明缺什么，题目存进「我的题目」 |

### 7.1 build 子集：为什么不给任意代码

给 agent 的是一套**受限指令**（借 Base Modelica 的思路），三条规矩：

1. **只能从三种 op 里选**：`addBody` / `addConstraint` / `addField`。不能写代码，也不能直接吐 Scene JSON。
2. **约束两端只能引用端口**，不许算坐标——模型不知道场景尺度。
3. **参数只填题干给的**，缺的走默认值，UI 会标出来。

`CONSTRAINT_OPS` 和 `Constraint` 联合类型之间有**编译期断言**：加一种约束忘了暴露给 agent，`tsc` 直接报错。

### 7.2 端口：约束连「接点」，不连坐标

`Anchor` 三选一：`{bodyId, port}` / `{bodyId, local}` / `{world}`。

- **派生端口**：每个物体自带 `center/top/bottom/left/right/tl/tr/bl/br`，从包围盒算出来，不用声明。
- **语义端口**：转轴 `axle`、挂钩 `hook`、销钉 `pin`，在 `Body.ports` 里声明。

好处：几何变了（改半径、换形状），约束不用跟着改；agent 说「接球的上端」就够了。

### 7.3 结构校验

产出后立刻过 `analyzeScene`（`packages/core/src/validate.ts`）：自由度分析 + 9 类诊断
（悬空端口、退化几何、零质量、过约束、马达装在锁转动的物体上……）。
**error 级诊断会降级成 warnings 返回**——agent 出的招自己先验算一遍，人能看到问题在哪。

自由度算法：动态体 3、锁转动 2；绳/轨道/滑轮消 1，铰链/销钉/导轨消 2，马达/传送带/电路消 0。并查集分组。

### 7.4 失败要失败得比没有 AI 更好

401 / 超时 / 返回不是 JSON / 场景不存在 / 结构不合法——每一类都有**具体到下一步**的文案
（`explainAiError`），并且会做 **key 形态 × 端点** 的错配检测（`sk-…` 是 DeepSeek，`xxx.yyyy` 是智谱）。

## 8. 可塑性：两张属性表

「组件必须是可塑的」不是口号，是两张表：

| 表 | 管什么 | 加一个属性要改几处 |
|---|---|---|
| `core/body-fields.ts` | 物体的质量/摩擦/电荷/角度/阻尼/角速度 | 一处（表里加一行） |
| `core/constraint-fields.ts` | 11 种约束各自的可调参数 | 一处 |

面板渲染、面板高度、setter 全部读表。之前这三处各写一份，加一个属性忘改任何一处，
就会出现「滑杆画到面板外面」或「点了没反应」。

**为什么表驱动可行**：高中物理的属性集是**封闭**的（质量/位置/角度/速度/角速度/摩擦/恢复系数/电荷；
绳长/k/l₀/阻尼/马达转速/导轨行程；场强/方向/点源强度；n/T/P₀/V；k/G/阻力系数），列得完。
电路板不是——每加一种器件就带一组新属性，表会无限长。所以「不做电路」是架构判断，不是偷懒。

约束分两类，UI 位置也不同：

- **有线的**（绳/杆/弹簧/铰链/滑轮/轨道）：画布上点线选中。
- **贴身的**（传送带/马达/电路/销钉/导轨）：没有可点的线，挂在物体面板的「机制」区。
  否则传送带的速度、电路的电阻根本改不了。

## 9. 关键决策

| 决策 | 理由 |
|---|---|
| **Scene 是唯一真相源** | 渲染/物理/判据/分享/撤销都从它派生，没有第二份状态要对齐 |
| **`params` + `layout()`** | 「改一个数换一套几何」必须能用 JSON 表达，否则分享出去滑杆就失效 |
| **`edits` 覆盖层** | 布局会重排几何，用户的手改必须能盖回去 |
| **AI 只做决定，不写 Scene** | 让它直接吐 JSON = 几何全靠猜；受限指令 + 结构校验才能保证「建出来的东西一定跑得动」 |
| **端口代替坐标** | 模型不知道尺度；「接上端」比「接 (0, 0.15)」稳定一个数量级 |
| **场力/弹簧用真实力，不用引擎接口** | 引擎不区分力来源，读不出来就没法画受力箭头，也没法单独验算 |
| **洛伦兹力旋转速度，不加力** | 每帧加外力会累积漂移；旋转保证速率严格不变 |
| **轨道用理想约束，不用多边形碰撞** | 多边形近似每跨一条弦丢能量，1/960 步长仍漏 2–3% |
| **判据不判对错** | 它只表示「条件是否被检测到」；对错是老师的事 |
| **不做 A/B 对照** | 学生容易只看两个动画而不建模，「改了什么」被藏在两个世界之间 |
| **不做「一键跳临界」** | 演示时暂停 + 慢放，人自己找临界，才是「可拨动」的意义 |
| **零后端** | 建模库/文件夹/题目全在本地；分享靠 URL 编码，不登录、不上传 |

## 10. 边界

不是「还没做」，是**当前不做**（每一条都有理由）：

| 建不了 | 为什么 |
|---|---|
| 静力学平衡（缓慢下放、三力平衡） | 引擎是动力学的，没有「求合力为零」的求解器 |
| 电容 / 电感 / 双棒 / 线圈转动 | `circuit` 只做单棒动生电动势 + 电阻，没有储能元件 |
| 运动学追及、声速、相对运动 | 没有「事件到达」的语义 |
| 光学、振动与波、近代物理 | 完全没做 |
| 多体复合刚体（小车 = 车身 + 轮） | `compound` 只给预置用，agent 不能拼 |

**注意区分「自动生成不了」和「软件做不了」**：上面大部分能手动搭（点电荷、N 体引力、碰撞、气缸、
滑轮、传送带、多过程链、单棒切割都有预置或组件），只是没有专门的生成分支。

## 11. 文件地图

<!-- FACTS:START -->

| 文件 | 行数 |
|---|---:|
| `packages/ui/src/app.ts` | 4357 |
| `packages/ui/src/editor/layout.ts` | 93 |
| `packages/ui/src/editor/drawing.ts` | 131 |
| `packages/ui/src/pages/bank.ts` | 381 |
| `packages/ui/src/pages/library.ts` | 275 |
| `packages/ui/src/pages/user.ts` | 178 |
| `packages/ui/src/pages/host.ts` | 60 |
| `packages/ui/src/pages/shared.ts` | 57 |
| `packages/ui/src/scene-bounds.ts` | 37 |
| `packages/ui/src/widgets.ts` | 491 |
| `packages/ui/src/icons.ts` | 407 |
| `packages/ui/src/chart.ts` | 194 |
| `packages/core/src/presets.ts` | 1631 |
| `packages/core/src/scene.ts` | 555 |
| `packages/core/src/ai-plan.ts` | 981 |
| `packages/core/src/ai-client.ts` | 243 |
| `packages/core/src/recognize.ts` | 142 |
| `packages/core/src/bank.ts` | 235 |
| `packages/core/src/library.ts` | 240 |
| `packages/core/src/components.ts` | 212 |
| `packages/core/src/ports.ts` | 162 |
| `packages/core/src/body-fields.ts` | 165 |
| `packages/core/src/constraint-fields.ts` | 230 |
| `packages/core/src/validate.ts` | 317 |
| `packages/core/src/params.ts` | 77 |
| `packages/core/src/criterion.ts` | 241 |
| `packages/core/src/serialize.ts` | 235 |
| `packages/render/src/renderer.ts` | 1264 |
| `packages/render/src/camera.ts` | 253 |
| `packages/physics/src/simulation.ts` | 946 |
| `packages/physics/src/forces.ts` | 126 |
| `apps/web/src/main.ts` | 285 |
| `apps/miniprogram/miniprogram/pages/index/index.js` | 179 |

> 这张表由 `node scripts/doc-facts.mjs --write` 生成，`node scripts/doc-facts.mjs` 校验。
> **别手改数字**——手改一定会漂。

<!-- FACTS:END -->

常见改动从哪下手：

| 想改 | 去哪 |
|---|---|
| 加一种约束 | `scene.ts` 的 `Constraint` 联合 + `constraint-fields.ts` 加一行 + `simulation.ts` 建关节 |
| 加一个物体属性 | `body-fields.ts` 加一行（面板/高度/setter 自动跟上） |
| 加一种形状 | `scene.ts` 的 `Shape` + `shapes.ts` 的转换 + `renderer.ts` 的绘制 |
| 改 AI 提示词 | `ai-plan.ts` 的 `AI_SYSTEM_PROMPT` |
| 加一个预置场景 | `presets.ts` 写 `build` + `layout`，注册进 `PRESETS` |
| 加一道题库题 | `bank.ts`；`tests/bank.test.ts` 会逐条验证「说能建的是不是真能建」 |
| 改小程序壳 | `apps/miniprogram/miniprogram/pages/index/index.js`（约 160 行） |

## 12. 怎么验证

| 层 | 手段 |
|---|---|
| 物理正确性 | `tests/*.test.ts`：拿课本闭式解卡数值（r = mv/(qB)、T = 2π√(m/k)、v∞ = FR/(B²L²)…） |
| 结构合法性 | `tests/validate.test.ts` + `tests/ports.test.ts` |
| 界面 | `scripts/shots-*.mjs`：Playwright 截图 + 几何/状态断言（不只截图给人看） |
| 小程序 | `scripts/mp-verify.mjs`：真机开发者工具自动化 |
| 文档与代码一致 | `npm run doc:check`：本文 §11 的行数由脚本写入 |

**一条规矩：加基元必须带一个数值用例**，否则它只是类型上的谎话。
审计时发现过 `probe` 观测器只活在类型里、`drawEnergyBar` 实现了从没被调用、
`belt/prismatic/pin/hinge` 被注释写成「已覆盖」但其实一次仿真都没跑过。
