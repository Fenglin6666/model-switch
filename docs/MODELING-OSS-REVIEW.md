# 建模类开源项目调研（2026-10-24）

> 目的：为「Slogan」找可借鉴的开源项目。
> 方法：GitHub 搜索 API，63 条查询（topic + 关键词，中英文），采集 **859 个唯一仓库**，按 9 个维度分类后人工筛选。
>
> **结论先行：真正能用的只有 4 个，而且最值钱的那一个不是「功能」，是「换一种求解方式」。**

---

## 0. 三个必须先说的判断

**① 搜索面比预期薄。** 859 个仓库里，跟「物理建模 / 交互仿真 / 场景 DSL」真相关的不到 60 个，其中大部分是游戏引擎、科研仿真（CFD/PINN）、机器人仿真——和高中物理无关。**这个赛道没有成熟的开源基础设施可站。**

**② 搜不到「物理题 → 可运行模型」的先例。** 我专门查了 `physics problem solver`、`text to simulation`、`physics scene editor`、`物理 建模` 等组合，最接近的是 `IamCatoBot/text2sim-MCP-server`（★25）和 `AirsupHQ/machine-skill`（★382，一句话生成 HTML 仿真）。**前者太小、后者是「LLM 写 HTML」的另一条路。你这个定位确实是空白。**

**③ 空白是双刃的。** 没有竞品 = 没有可抄的。所以这份报告的重点不是「学谁做什么功能」，而是「哪个已解决的问题，恰好是你卡住的那个」。

---

## 1. 最重要的发现：myPhysicsLab 的 roller 模块

**[myphysicslab/myphysicslab](https://github.com/myphysicslab/myphysicslab)** ★453 · TypeScript · **Apache-2.0** · 530 文件 · 最后推送 2024-11

Erik Neumann 的教学物理库，网站 myphysicslab.com 上每个 lab 都配完整数学推导。技术栈和你一样（TypeScript + Canvas 2D），领域也一样（2D 物理教学仿真）。

### 它的 `src/sims/roller/` 目录，是「球在轨道上」的标准解法

```
src/sims/roller/
├── AbstractPath.ts        参数化路径基类：x_func(t) / y_func(t) / startT / finishT / isClosedLoop
├── CirclePath.ts          LoopTheLoopPath.ts   OvalPath.ts
├── SpiralPath.ts          CardioidPath.ts      LemniscatePath.ts
├── CustomPath.ts          任意自定义路径
├── RollerSingleSim.ts     单球在轨道上
├── RollerFlightSim.ts     球会飞离轨道
├── RollerDoubleSim.ts     两球
├── LagrangeRollerSim.ts   拉格朗日形式
├── RollerCollision.ts
└── PathObserver.ts / PathSelector.ts
```

**关键设计（读源码确认）**：`RollerSingleSim` 的状态变量只有两个——**弧长位置 p 和沿轨速度 v**。

```ts
// RollerSingleSim.ts 第 40 行附近
const TRACK_P = 0;   // 弧长位置
const TRACK_V = 1;   // 沿轨速度
const TIME = 2;
const X = 3;  const Y = 4;          // ← computed
const KE = 5; const PE = 6; const TE = 7;   // ← computed
...
this.getVarsList().setComputed(X, Y, KE, PE, TE);
```

也就是说：**它不在 2D 里解 (x, y, vx, vy)，而在 1D 里解 (p, v)，x/y 是派生量。**

`RollerFlightSim` 再多一个状态位：

```ts
const TRACK_MODE = 6;
const ON_TRACK = 1;    // 在轨
const OFF_TRACK = 0;   // 自由飞行
```

脱离判据写在 `jumpOffTrack()` 里（第 398–459 行），本质是**比较法向加速度与曲率要求的向心加速度**：

```ts
if (r < 0 && ar < av || r > 0 && ar > av) {   // switch to free flight
```

自由飞行时切回「只有重力 + 弹簧力」的弹道积分，重新落回轨道时再切回 `ON_TRACK`。

### 为什么这对你是「正解」而不是「又一个方案」

你现在的做法（`docs/DECISIONS.md` §2）是：Planck 刚体 + `DistanceJoint` 把球心绑在圆上，每子步读关节反力，`dot(反力, 指向圆心) < 0` 就销毁关节 = 脱离。这个方案很聪明，临界速度误差 0.24%。

但它有三个天花板，恰好是你 P1 卡住的地方：

| 你现在的问题 | 根因 | 1D 弧长解法 |
|---|---|---|
| **只能做圆**（`track` 约束的 radius 是常数） | 约束是「到圆心距离恒定」 | 任意 `ParametricPath`：圆弧、椭圆、螺旋、样条 |
| **入口速度从 4.5 掉到 0**（SESSION-HANDOFF P1） | 挂关节瞬间产生冲量，把切向速度也吃了 | **没有「挂接」这个动作**——p 连续演化，从斜面段到圆弧段只是路径导数变化 |
| **13 段折线近似圆弧**（`arcChain`） | 折线跨弦逐段投影，能量必漏 13–31% | 解析路径，没有弦 |
| 能量误差 0.24% | 关节约束 + 数值积分残差 | 1D 系统，能量误差接近机器精度 |

**换句话说：你现在花力气修「入口速度断层」，而那个问题在另一个求解范式里根本不存在。**

### 但代价必须说清

**1D 弧长解法只能用于「单个质点 + 固定轨道」。** 它做不到：

- 半圆槽（槽可移动）→ 需要槽也参与动力学
- 板块 + 平抛 → 多刚体
- 球在轨道上被另一个球撞
- 滑轮 / 气缸 / 碰撞 / 场力

**所以这不是「换掉 Planck」，是「加第三条求解路径」。** 三条路径各管一段：

| 求解路径 | 适用 | 现状 |
|---|---|---|
| Planck 刚体 | 多体、碰撞、板块、滑轮、气体、场力 | 已有，不动 |
| `track` 约束（DistanceJoint） | 轨道**可移动**或被撞 | 已有，保留 |
| **1D 弧长路径** | **轨道固定 + 单球**：圆轨道、斜面→圆弧、多过程链、任意形状 | **缺，这是要加的** |

### 落地建议：先试便宜的，不成就上这个

在动架构之前，先花半天验证一个假设：**入口速度断层是不是只是「挂接时机/长度设错」造成的冲量？**

`SESSION-HANDOFF.md` 自己已经写出了可能的解法：

> 入口点放在圆弧上，按切向速度挂接；把关节 `length` 设为实际距离，避免瞬间位置修正

**如果这半天修好了，就不必上 1D 求解器**——因为 1D 求解器是架构级改动，而 `track` 约束已经能用。

如果修不好（或者你需要「任意形状轨道」这个产品能力），再上 1D 路径。**这时它的价值不只是修 bug，是把「任意形状轨道」变成一等公民。**

成本估计：1D 路径核心（`ParametricPath` + 弧长积分 + 法向力判据）约 3–4 人日，加脱离/再入飞行 2–3 人日，加与现有 `Constraint` 联合、渲染、检查器 2–3 人日。**总计 7–10 人日。这是我的估计，不是事实。**

**许可证**：Apache-2.0，可商用、可改、可闭源，只需保留声明。**比 GPL 的 SolveSpace 友好得多。**

---

## 2. 第二个发现：解析圆弧 vs 折线

同一个仓库的 `src/lab/engine2D/` 里有一组几何基元：

```
AbstractEdge.ts    StraightEdge.ts    CircularEdge.ts    EdgeSet.ts
CornerEdgeCollision.ts   EdgeEdgeCollision.ts   CollisionHandling.ts
```

**`CircularEdge` 是解析圆弧**——不是折线近似。源码注释写得很清楚：知道圆心就直接构造，只知道半径用 `CircularEdge.make()`；两端点重合时自动识别为整圆，只保留一个顶点；还有「中点顶点」专门用于碰撞检测。

对照你的现状：`arcChain` 用 **13 段折线**近似圆弧，靠接触碰撞（`DECISIONS.md` §26）。

**可借鉴的点不是抄它的代码，是「圆弧应该是一等几何基元」这个判断。** 你的 `Body.shape` 里已经有 `arc` 类型（渲染用），但物理上走的是折线。如果做第 1 节的 1D 路径，圆弧天然是解析的，这个问题自动消失——**所以这一条不需要单独做，它是第 1 节的副产品。**

---

## 3. 第三个发现：速度空间相图几乎零成本

你的 P1 里有一条：

> 2024 新课标 13 这类「速度空间」题，当前只有实空间轨迹和 v–t。建议加一个 observer 画 vx–vy 相图。

myPhysicsLab 的做法值得抄，因为它把「记录变量」和「画图」彻底解耦了：

- **`VarsList`**：把仿真状态摊平成一个**命名数字数组**（`[p, v, time, x, y, ke, pe, te, ...]`），物理、图表、显示全部按下标读写
- **`VarsHistory`**：从 `VarsList` 采样，`setVariables([9,0,1,2,3])` 选任意几个变量，输出 CSV
- **`DisplayGraph` / `VectorGraph` / `EnergyBarGraph`**：都只是「取两列画图」

**关键差别**：你的 `chart.ts` 里 series 是 `{ bodyId, quantity: 'x'|'y'|'v'|'a'|'E'|'p' }`，图表和 body 绑死；它是「取任意两个变量的历史」。**所以它能画 vx–vy 相图，你现在不能——不是因为缺图表组件，是因为缺一层「泛型变量历史」。**

不需要引入它的 `VarsList` 架构（你的 typed Body 在可编辑性上更好）。而且你的 `Observer` 里 `chart` **已经有 `axis: 't' | 'x'` 这个字段了**，所以改动比想象的小——只缺两样：

```ts
// 1) quantity 补两个分量（现在只有合速度 'v'，没有分量）
quantity: 'x' | 'y' | 'v' | 'vx' | 'vy' | 'a' | 'E' | 'p'

// 2) axis 补一个相图取值，表示「两个量互相作轴」而不是对 t / 对 x
axis: 't' | 'x' | 'phase'
// phase 时用 series[0] 作横轴、series[1] 作纵轴：
//   series: [{ bodyId:'ball', quantity:'vx' }, { bodyId:'ball', quantity:'vy' }]
```

**成本 1–2 人日**（`chart.ts` 已有采样循环，把「对时间」换成「对另一个 series」即可）。**这是本次调研里性价比最高的一条。**

---

## 4. 竞品情报：一个中文物理仿真合集

**[mrfayshenzhen66-bit/physics-lab-suite](https://github.com/mrfayshenzhen66-bit/physics-lab-suite)** ★2 · 纯静态单文件 HTML · 零依赖

星数很低，但**它是国内同赛道最接近你形态的东西**，值得当作竞品而不是技术参考。

7 个单文件实验室：板块·传送带、三维受力分析、交流变直流、电磁振荡、声波、光现象 13 合 1、望远镜与显微镜。定位明确写「初高中物理交互仿真实验门户」「课堂投影与低配设备也能流畅运行」。

**四个具体的功能缺口（你现在没有的）：**

| 它有 | 你有什么 | 值得做吗 |
|---|---|---|
| **板块·传送带实验室** | `传送带还没有`（SESSION-HANDOFF 已知边界） | **值得**——传送带是高中力学高频题型，且你的 `prismatic` 约束已经能做 |
| **f—F 三段图象探究** | v–t、能量条、相图（待做） | 值得考虑——摩擦力的 f–F 分段图是易错点 |
| **慢动作动画与 v–t 图同步演绎** | 有速度倍率，但图表和动画各自独立 | 值得——「慢放 + 图表指针同步」是讲课刚需 |
| **规范解答卡**（统考压轴题可视化讲评） | 明确「不判对错、不替代老师讲题」 | **不做**——和你的产品定位冲突 |

**一个可直接抄的工程做法**：它的性能预算是写死的——**30 FPS 上限 / DPR ≤ 1.5 / 离屏暂停按需渲染**。你的 README 说 40 个形状 60–119 fps（桌面），但**小程序真机在教室老旧设备上的表现没有数据**。这三条是低成本保险。

⚠️ 注意：**★2 意味着它可能没有真实用户**。我不建议把它当「验证过的需求」，只当「别人想到了哪些场景」的清单。

---

## 5. 数据源候选：708 道高中物理题

**[xiaoyang111222/cn-math-taxonomy](https://github.com/xiaoyang111222/cn-math-taxonomy)** ★2,944 · CC BY-NC 4.0

中小学知识图谱，对齐课标。其中**高中物理：177 个知识点、514 条先修边、108 条课标条目、708 道题**；初中物理 92 个知识点、368 道题。

**对你的价值**：`parseProblem` 现在只有 `problem.test.ts` 的 7 道题 + `gaokaoCases.ts` 的 9 道真题。**708 道题是一个现成的回归语料**，尤其能测「什么时候该拒绝」——你现在的 `unsupported` 闸门只见过 9 道题。

**三个必须注意的限制：**

1. **许可证是 CC BY-NC 4.0（非商业）**。你现在完全免费，但**一旦接广告或收费，NC 就成了问题**。要用就只用它的「知识点标签」做测试，不要把题干数据打进产物。
2. **README 自己声明「AI 生成的初稿，未经任何教师审核」**，且「高中题没有做盲解」。质量不能当真值。
3. 题目多是选择题/填空题，**未必适合建模**。用作「负样本」（应该被拒绝的题）比「正样本」更靠谱。

**建议**：抽 50 道高中物理题，只用来测一件事——**`parseProblem` 会不会对不该建模的题静默给一个错模型**。这是你 `GAOKAO.md` 里最重要的那条边界。

---

## 6. 看了但决定不要的

| 项目 | 是什么 | 为什么不要 |
|---|---|---|
| **[solvespace/solvespace](https://github.com/solvespace/solvespace)** ★4,213 | 参数化 2D/3D CAD + 几何约束求解器（相切/共线/距离） | **过度工程**。你的 `layout()` 是每条预置一段代码，够用；「圆弧与斜面在连接点相切」是个两行公式，不值得引入求解器。而且它是 **GPL-3.0**，抄代码会传染。 |
| **[retejs/rete](https://github.com/retejs/rete)** ★12,297 / [litegraph.js](https://github.com/jagenjo/litegraph.js) ★8,173 | 节点图 / 可视化编程编辑器 | 你是「拖组件 + 检查器」，不是数据流编程。引入节点图会把产品变成「编程工具」，和「老师打开就能用」冲突。 |
| **[ManimCommunity/manim](https://github.com/ManimCommunity/manim)** ★41,811 | 动画即代码 | 你要的是**交互**，不是预渲染视频。但 `ValueTracker` + `always_redraw` 的「一个参数绑定到视觉、改参数即重画」思想，**和你 `layout()` 要做的是同一件事**——概念上可参考，代码不可用（Python）。 |
| **[Bithack/principia](https://github.com/Bithack/principia)** ★428 | 开源物理沙盒游戏（电路/机械/机器人/Lua 脚本） | 说明「自由搭建」品类成熟，但**全是游戏**（Algodoo 也是）。恰好印证了你之前的判断：这个品类天然滑向玩。 |
| **[AirsupHQ/machine-skill](https://github.com/AirsupHQ/machine-skill)** ★382 | 一句话让 Claude 生成带真实物理的 3D 仿真 HTML | **反例**。和 OpenMAIC 同一条路：LLM 现写 HTML。它宣称「屏幕上每个数字都是算出来的」，但**没有判据、没有临界搜索、不可编辑**。这条路已经很挤，而且不解决「可改」。 |
| **[KmolYuan/Pyslvs-UI](https://github.com/KmolYuan/Pyslvs-UI)** ★232 | 平面连杆机构仿真与综合 | 领域不对（机构学不是高中物理），但「参数化机构 + 动画 + 尺寸综合」的形态值得记住。 |

---

## 7. 落地顺序

| # | 做什么 | 成本 | 依据 | 建议 |
|---|---|---|---|---|
| 1 | **先花半天验证「入口速度断层」是不是挂接冲量** | 0.5 人日 | SESSION-HANDOFF P1 自己写了解法 | **立刻做，这是最便宜的** |
| 2 | **加 `phase` 相图 observer**（借第 3 节） | 1–2 人日 | `chart.ts` 已有采样循环 | **性价比最高** |
| 3 | **把 `parseProblem` 拿 50 道真题压一遍**（借第 5 节） | 1 人日 | 现在只见过 16 道题 | **该做，防静默错模型** |
| 4 | **传送带场景**（借第 4 节的竞品缺口） | 2–3 人日 | `prismatic` 已具备 | 有价值，看优先级 |
| 5 | **1D 弧长路径求解器**（借第 1 节） | 7–10 人日 | 前提是第 1 步修不好，或你要任意形状轨道 | **架构级，慎重** |
| 6 | 慢放 + 图表指针同步 | 1–2 人日 | 竞品有，讲课刚需 | 排在相图之后 |
| 7 | 30 FPS / DPR 1.5 / 离屏暂停 性能预算 | 0.5 人日 | 竞品写死的预算 | 小程序真机验证时一起做 |

---

## 8. 一个冷结论

搜了 859 个仓库，**没有一个在做「把一道题变成一张可改的物理模型」**。

这可以读成好消息（空白市场），也可以读成坏消息（**可能有人试过，发现不值得**）。我更倾向后者的一部分——因为「物理仿真」这个品类里，凡是活得久的（PhET、Algodoo、NB 实验室、小小物理盒），做的都是**通用实验台**，不是**单题建模**。

通用实验台好卖，因为老师能反复用；单题建模要每次重来。

**但你的赌注不是这个。** 你的赌注是：**「题目」才是老师真正每天面对的东西，而把题目翻译成模型这件事，现在只能靠老师在黑板上画。**

这个赌注对不对，`docs/GAOKAO.md` 那 9 道真题的「1 道能建、8 道拒绝」已经给出了警告：**如果自动建模的覆盖率长期停在 10%，那它就不是老师的日常工具，只是一个演示品。**

所以第 3 条（拿 50 道真题压一遍）比第 5 条（1D 求解器）重要得多。**先知道你能覆盖多少题，再决定值不值得为轨道精度投 10 人日。**

---

## 9. 来源与可信度

| 结论 | 依据 | 可信度 |
|---|---|---|
| 859 个唯一仓库、63 条查询 | 本机 GitHub Search API 采集，原始数据 `D:/OneAgent/model-oss-research/raw/github_model_raw.json` | **一手**（自采数据） |
| `RollerSingleSim` 状态只有 (p, v)，x/y/ke/pe/te 是 computed | 读 `src/sims/roller/RollerSingleSim.ts` 源码 | **一手**（代码） |
| `TRACK_MODE` / `ON_TRACK` / `OFF_TRACK` / `jumpOffTrack()` 脱离判据 | 读 `RollerFlightSim.ts` 源码第 398–459 行 | **一手**（代码） |
| `CircularEdge` 是解析圆弧、支持整圆与中点顶点 | 读 `src/lab/engine2D/CircularEdge.ts` 注释与构造 | **一手**（代码） |
| `VarsHistory` 可按变量下标采样、输出 CSV | 读 `src/lab/graph/VarsHistory.ts` 注释 | **一手**（代码） |
| myphysicslab 许可证 Apache-2.0、530 文件、最后推送 2024-11-25 | GitHub API 元数据 | **一手** |
| physics-lab-suite 的 7 个实验室与性能预算 | 其 README | 一手（自述，未实机验证） |
| cn-math-taxonomy 高中物理 177 知识点/514 边/708 题 | 其 README 表格 | 一手（自述；README 自称 AI 生成未审核） |
| 「搜不到题目→建模的先例」 | 63 条查询的检索结果 | **限定为「公开可检索范围内」**，不等于不存在 |
| 人日成本估算 | 我的估计 | **推断，非事实** |
| 1D 路径能解决你的三个 P1 问题 | 基于源码的机制推断，**未在你的代码上验证** | **未验证** |
