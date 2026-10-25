# OpenMAIC 借鉴评估（2026-10-24）

> 对象：[THU-MAIC/OpenMAIC](https://github.com/THU-MAIC/OpenMAIC)（清华 MAIC，MIT，2026-10-23 最新提交，760 commits）
> 结论：**借它的「动作编排层」和「内容标准」，不要借它的「生成方式」和「技术栈」。**

---

## 0. 一句话结论

OpenMAIC 和「Slogan」是**同一条链路上的两端**：

| | OpenMAIC | Slogan |
|---|---|---|
| 输入 | 任何主题 / 文档 | **一道具体的物理题** |
| 产出 | 一整堂课（幻灯片 + 测验 + 仿真 + PBL） | **一张可运行、可改的物理模型** |
| 仿真怎么来 | **LLM 现生成 HTML**，塞进 iframe | **Scene JSON + 真实物理引擎** |
| 物理对不对 | 不保证，也没有判据 | **有判据、有临界搜索、有 84 个测试兜底** |
| 体量 | Next.js 16 + React 19 + PostgreSQL，4351 个文件 | 纯 TS + Canvas，405 KB，小程序主包 |

**所以：它的仿真比我们弱，它的编排比我们强。**

我们能拿的是它「怎么把一堆操作串成一次讲解」的那套东西——这正是「老师是主要人群」这个定位下最缺的一环。我们绝不能拿的是它「让 LLM 写 HTML」的做法，那等于放弃 Scene JSON 这个唯一资产。

---

## 1. 能借的五样东西（按性价比排序）

### 借 ①（最高价值）动作 + 编排层 → 「演示脚本」

**它是什么**

OpenMAIC 把课堂里发生的一切都抽象成 `Action` 对象，由一个 `ActionEngine` 统一执行（`lib/action/engine.ts`，注释原话：*"Replaces the 28 Vercel AI SDK tools with a single engine that both online (streaming) and offline (playback) paths share"*）。

它把动作分成两种执行语义，这个区分很关键：

| 模式 | 动作 | 语义 |
|---|---|---|
| **fire-and-forget** | spotlight、laser | 派发完立刻返回，不阻塞后续 |
| **synchronous（await）** | speech、whiteboard、discussion | 必须等它做完才继续 |

再加一个 `lib/choreography` 模块集中放时长常量（`WB_OPEN_MS`、`WB_DRAW_MS`、`WIDGET_MS`、`EFFECT_AUTO_CLEAR_MS`…），以及 `lib/playback/engine.ts` 的三态状态机：**idle → playing → live**。

`live` 这个态是精髓：**脚本播完，控制权交还给学习者**。

**我们为什么需要**

现在 `packages/ui/src/app.ts` 里只有一个 `playing: boolean`。老师上课的真实动作是：

> 把 μ 调到 0.5 → 高亮那个滑块 → 按播放 → 等它停在斜面上 → 标注「这里 a=0」

这四步现在要老师手动做四次，而且第二次上课要重做一遍。**这就是「不是日活产品」的真实痛点：老师每次都要重新搭一遍讲解路径。**

**具体落法**

`Scene` 加一个可选字段（不动现有任何结构）：

```ts
// packages/core/src/scene.ts
export type ScriptAction =
  | { id: string; kind: 'setState'; bodyId: string; field: 'friction' | 'mass' | 'angle' | 'vx' | 'vy'; value: number; label?: string }
  | { id: string; kind: 'highlight'; bodyId: string; hold?: number }
  | { id: string; kind: 'annotate'; bodyId: string; text: string; hold?: number }
  | { id: string; kind: 'reveal'; target: 'trail' | 'criterion' | 'chart' | 'energy'; observerId?: string; criterionId?: string }
  | { id: string; kind: 'run'; duration: number; until?: string }   // until = criterionId，跑到判据触发为止
  | { id: string; kind: 'pause'; text?: string }                    // 停下来，交还控制权

// Scene 里加一行：
//   script?: ScriptAction[]
```

注意 `setState` 不需要新机制——它写的就是 `scene.edits`，`applyEdits` 已经能把用户编辑重放回去（DECISIONS §15）。`highlight` 复用 `selectedId` 的高亮渲染。`annotate` 可以复用 `Guide.label`，只是改成屏幕锚定而非世界坐标。

**成本**：4–6 人日（含 UI 上的「按脚本演示 / 单步」两个按钮）。**这是本次评估里唯一值得立刻做的一件事。**

**最小实现骨架**（放在 `packages/ui/src/app.ts`，约 60 行；`choreography` 的时长常量集中成一个 `SCRIPT_MS` 对象，不要散在各处写 `setTimeout`）：

```ts
// 三态：脚本播完不是「停止」，而是「交还控制权」——这是 OpenMAIC 的 live 语义
mode: 'idle' | 'playing' | 'live' = 'idle'
scriptIndex = 0

private tickScript(now: number): void {
  if (this.mode !== 'playing') return
  const act = this.doc.script?.[this.scriptIndex]
  if (!act) { this.mode = 'live'; return }          // 播完 → live，用户可自由操作

  switch (act.kind) {
    case 'setState':                                   // 复用 edits 覆盖层
      this.pushHistory()
      this.writeEdit(act.bodyId, act.field, act.value)  // 已有检查器写入路径
      this.scriptIndex++; return                        // fire-and-forget，立即下一条
    case 'highlight':
      this.selectedId = act.bodyId                       // 复用选中高亮
      if (now >= this.actionStartedAt + (act.hold ?? 1500)) this.scriptIndex++
      return
    case 'annotate':
      this.activeAnnotation = { bodyId: act.bodyId, text: act.text }   // 新字段，屏幕锚定
      if (now >= this.actionStartedAt + (act.hold ?? 2000)) { this.activeAnnotation = null; this.scriptIndex++ }
      return
    case 'reveal':                                     // 借 ② 的可见性集合
      this.revealed.add(act.target)
      this.scriptIndex++; return
    case 'run':                                        // 同步等待：跑到时长或判据触发
      this.playing = true
      const done = act.until ? this.simA?.state.criteria[act.until]?.pass : false
      if (done || this.simA!.state.t >= act.duration) { this.playing = false; this.scriptIndex++ }
      return
    case 'pause':
      this.playing = false
      this.mode = 'live'                               // 主动交还控制权，等老师继续
      return
  }
}
```

**边界**：脚本必须是**可编辑的**，不能是黑盒。老师改不了脚本的演示模式，等于又一个「场景控制面板」（v3.1 已经因为「参数和物体脱钩」把它删掉了，别再犯）。

---

### 借 ②（和产品定位耦合最强）REVEAL —— 先不给看结果

**它是什么**

OpenMAIC 给生成的仿真 HTML 规定了四类 `postMessage` 动作，其中一个是 `REVEAL_ELEMENT`：

```js
case 'REVEAL_ELEMENT':
  const revealEl = document.querySelector(target);
  revealEl.style.display = '';
  revealEl.style.opacity = '1';
```

配合 `diagram` 的 `revealOrder: string[]`（节点按序揭示），它把「逐步揭示」做成了内容契约的一部分。

**为什么这条对我们特别重要**

我们的产品定义是「**改一个条件，看结果怎么变**」。而学习真正发生的地方，是**在结果出现之前**——学生先押一个预测，然后被打脸。

现在的实现是：一按播放，轨迹、v–t、判据 chip 全都同步出现。**学生没有「预测」的窗口。**

`reveal` 让我们可以做成：

```
默认：轨迹关、判据关、图表关，只有一个「你觉得会怎样？」的输入
       ↓ 学生选完（或老师提问完）
逐条揭示：先出轨迹 → 再出判据 → 最后出图表
```

这和之前讨论的 POE（Predict–Observe–Explain）是同一件事，而且**不需要接大模型、不需要新物理**，只是在渲染层加一个可见性集合。

**成本**：2–3 人日。轨迹和引导线在 `renderer.ts` 里已经按块绘制（`drawTrails` 第 603 行、`drawGuides` 第 845 行、`drawVectors` 第 641 行），加个 `Set<string>` 过滤即可；判据 chip 不在 renderer，在 `ui/app.ts` 的 `criteriaChips()`（第 3122 行）和状态栏（第 2170 行），要单独加过滤。

---

### 借 ③（零成本，立刻能改）场景命名与说明的内容标准

**它是什么**

OpenMAIC 的 `skills/agent-runtime/deep-interactive/SKILL.md` 里有一节「Scene naming」，原文：

> Titles name what the learner does or discovers, not the topic heading.
> - Good: 「拖动倾角，看射程怎么变」「顺着数据流走一遍」「猜下一步会发生什么」
> - Bad: 「抛体运动」「数据流概述」「知识点回顾」

还有两条：

> Consecutive interactive scenes must not use the same `widgetType`. Two simulations in a row is a design failure.
>
> `keyPoints` describe the **interaction and what it reveals** — what the learner changes, what they observe, what conclusion the observation forces. Not a bullet list of facts to be read out.

以及「一个场景只隔离一个机制、一个变量」。

**我们能直接用的**

我原以为我们的文案是「知识点标题」，核对 `presets.ts` 后发现**问题比这更微妙**：**好文案已经写好了，但放错了位置。**

看第 2 个示例（`presets.ts` 第 388 行附近）：

```
title:    '半圆槽'                                    ← 知识点标签
subtitle: '槽放在光滑水平面上：球还能到等高位置吗？'      ← 这才是 OpenMAIC 说的 Good
```

第 3 个：

```
title:    '竖直圆轨道'
subtitle: '拖到某个速度，轨迹突然翻转：恰好过最高点'        ← Good
```

**18 个示例的 subtitle 全部是「交互 + 它揭示了什么」的好写法**（`拖到某个速度，轨迹突然翻转`、`把 E 调到 0 就回到直线`、`升温看活塞上移`、`换半径/圆心角就是新题`）。**没有一条需要重写。**

问题在于：**标题承担了「分类」，副标题承担了「发现」，而用户第一眼看到的是标题。**

所以这不是文案工作，是**信息层级**工作。三个可选改法：

| 改法 | 做法 | 代价 |
|---|---|---|
| A 换位 | 选择页把 subtitle 提到 title 位置，标题降为小字分类标签 | 只改 UI 排版 |
| B 合并 | `半圆槽：球还能到等高位置吗`（现在只有 6 个示例是这种冒号格式） | 改 18 行字符串 |
| C 保持 | 只在生成器产出的 `meta.note` 里用 Good 写法 | 零成本，但不动选择页 |

我倾向 **A**——因为 subtitle 已经足够好，重写是浪费，换位置就够了。而且它顺带解决了另一个问题：老师扫一眼卡片，看到的是「这个场景能讲什么」，而不是「这属于哪一章」。

同理，生成器返回的 `assumptions` 现在写成「假设：μ=0.3」这种参数清单，应该改成「把 μ 调到 0.3，它恰好不下滑」——**假设本身就是一句话的结论**。

**成本**：0.5 人日（改法 A 甚至不到）。收益是**老师第一眼就能判断这个场景能不能用在课上**。

---

### 借 ④（老师侧分发）PPTX 占位页 + 二维码 / 单文件 HTML

**它是什么**

OpenMAIC 的导出（README「Export」）：

- **PPTX**：交互、测验、PBL 场景保留为**占位幻灯片**，带「Open online」按钮和**二维码**
- **Offline HTML**：一个文件，无网络播放整堂课；导出时把 KaTeX、Three.js、Tailwind CDN、Google Fonts、图片全部内联成 `data:` URI

**为什么这对我们有用**

老师上课用 PPT，这是不会变的事实。让他「上课前先打开一个网页」是增加步骤，让他「PPT 里有一页，扫一下就能操作」才是嵌入他现有工作流。

而且**单文件 HTML 这件事我们天生就有**：Web 产物是 405 KB 的单个 bundle，没有外部 CDN 依赖。缺的只是一个「导出 html」按钮。

⚠️ 但要说清：**在教室里用 PPT 上的二维码是别扭的**（老师投屏，学生扫，学生手机上是小程序）。更实用的形态是「截图 + 一句话 + 小程序码」，用来**课后发给学生**，而不是课堂当场用。课堂当场还是应该用 Web 全屏。

**成本**：单文件 HTML 导出 1–2 人日（Vite 加 inline 插件 + 下载按钮）；PPTX 2–3 人日（需要 pptxgenjs，约 300 KB，**只放 Web 端，绝不进小程序包**）。

**优先级**：低于 ①②③。这是分发优化，不是产品能力。

---

### 借 ⑤（技术选型参考，不是代码）图片识别用 MinerU 这条路

**它是什么**

OpenMAIC 的 `document` 槽位可指向 `mineru-cloud`（官方 API）或自托管 MinerU，README 写明用途是「**为复杂表格、公式和 OCR 提供增强解析**」。

**对我们的意义**

`SESSION-HANDOFF.md` 的 P0 是「图片识别 / 拍照」。物理题干的难点恰好是**公式和上下标**，普通 OCR 会把 `v₀` 读成 `vo`、把 `μ` 读成 `u`。

所以选型时要注意：**通用 OCR 不够，需要公式识别**。MinerU 是已知的一条路，但它是**按次计费或需要自托管 GPU**——与「完全免费」直接冲突（这正是之前 L2 变动成本那一档）。

**结论**：MinerU 只能作为 **Web 端可选增强**，绝不能作为小程序默认路径。小程序端的图片识别如果要免费，只能是「本地轻量 OCR + 规则兜底 + 明确说识别不确定」，或者干脆继续标「即将支持」。

**成本**：3–5 人日 + 持续服务成本。**建议推迟到有真实付费/采购信号之后。**

---

## 2. 明确不要借的四样

| 不要借 | 为什么 |
|---|---|
| **LLM 现生成 HTML 仿真** | 这是它的核心做法，也是它最弱的地方。生成的仿真没有物理保证、没有判据、不能找临界。我们照做等于用 4351 个文件的架构去换一个「好看但可能错」的动画，把 84 个测试和 Scene JSON 全丢掉。**我们的物理是资产，不是负担。** |
| **技术栈（Next.js 16 / React 19 / PostgreSQL）** | 我们 405 KB、小程序主包 2 MB 上限、纯 Canvas 无 DOM。它的 4351 个文件里绝大多数是 Web 后台、多端持久化、i18n 十二种语言——单机教学工具一样都用不上。 |
| **多智能体课堂 / TTS / 白板 / PBL** | 那是「课程」，我们是「工具」。而且 TTS/ASR 是**持续变动成本**，与「完全免费」根本冲突（详见免费模式那版分析：L2 档必须整类排除）。 |
| **知识库 / 素材 `@` 引用 / 版本化 DSL 生成器** | 我们没有素材库概念；`serialize.ts` 251 行 + 测试已经在做「向后兼容 + 规范化」这件事，再引一套 schema 生成是过度工程。 |

---

## 3. 一个反向机会：把场景导出成 OpenMAIC 的 widget

这条不是「借」，是「接入」，但可能是最省力的分发路径。

OpenMAIC 的 `interactive` 场景是一个 **iframe `srcDoc` 的完整 HTML 文档**（`packages/@openmaic/dsl/src/interactive.ts` 原文：*"`html` is a complete HTML document rendered via iframe `srcDoc`"*）。也就是说：

> **如果我们能把一个 Scene 导出成「单文件 HTML + 四个 postMessage 监听」，它就天然是一个 OpenMAIC 的 `simulation` widget。**

它要求的四类消息我们已经能对上：

| OpenMAIC 动作 | 我们已有的对应物 |
|---|---|
| `SET_WIDGET_STATE` | `scene.edits` 覆盖层（DECISIONS §15） |
| `HIGHLIGHT_ELEMENT` | `selectedId` 选中高亮 |
| `ANNOTATE_ELEMENT` | `Guide.label`（改屏幕锚定） |
| `REVEAL_ELEMENT` | 借 ② 的可见性集合 |

它还有一条命名约定（`{variable}-slider` / `{action}-btn` / `{variable}-display`）用于让高亮能定位到控件——我们的 canvas 控件没有 DOM id，但可以在导出的 HTML 里给一个 `window.slogan` 桥接对象，把 id 映射到场景内元素。

**这条路的价值**：接上之后，我们的模型能出现在 AI 课堂里被调用——正好接上之前那轮「面向 AI 调用」的讨论。而且**成本只是「单文件 HTML 导出 + 一个消息桥」**，1–2 人日。

⚠️ **诚实标注**：我读了它的契约定义和提示词，**没有实际跑过 OpenMAIC 实例验证这条路能不能通**。它的 widget 校验、iframe 沙箱策略、以及「AI 教师操作 widget」的实际调用链路，我没有实测。要做的话，第一步是本地起一个实例，手工塞一个我们导出的 HTML 进去看能不能渲染。

---

## 4. 落地顺序（按「收益 ÷ 成本」排）

| # | 做什么 | 成本 | 收益 | 建议 |
|---|---|---|---|---|
| 1 | **调整示例卡片标题/副标题层级**（借 ③，副标题已是好文案，换位置即可） | 0.5 人日 | 老师一眼能判断能不能用 | **立刻做** |
| 2 | **`reveal` 可见性 + 「先预测」流程**（借 ②） | 2–3 人日 | 直接强化「原理验证」定位 | **立刻做** |
| 3 | **`scene.script` 动作编排 + 演示模式**（借 ①） | 4–6 人日 | 老师备课路径可复用；这是「不是日活产品」的解药 | 本轮主任务 |
| 4 | **单文件 HTML 导出**（借 ④ + 反向机会前置） | 1–2 人日 | 课后分发；也是接入 OpenMAIC 的前置 | 紧随其后 |
| 5 | **PPTX 占位页 + 小程序码**（借 ④） | 2–3 人日 | 嵌入老师现有工作流 | 有老师反馈后 |
| 6 | **OpenMAIC widget 兼容（postMessage 桥）** | 1 人日 | 多一条 AI 分发通道 | 先手工验证再投入 |
| 7 | **图片识别 / MinerU**（借 ⑤） | 3–5 人日 + 服务费 | 补 P0 入口 | 推迟（成本与「免费」冲突） |

---

## 5. 三个提醒

**① 不要因为「人家是清华的项目」就降低判断标准。**
它的 star 数我没取到静态值（README 用 shields 徽章动态引用）。它的体量和论文背书说明它是个严肃项目，但**严肃不等于适合我们**——它的目标是把任何主题变成一堂课，我们的目标是把一道题变成一张能拨的模型。目标不同，可借的东西就有限。

**② 许可证要看清楚。**
根仓库是 MIT，可商用。但 README 明确写了两个例外：`packages/mathml2omml` 是 **LGPL-3.0-or-later**，`packages/pptxgenjs` 是第三方 MIT。**如果要抄代码，避开 `mathml2omml`。**（我们暂时也不需要 MathML→OMML，因为我们不做公式编辑。）

**③ 这次评估里我唯一有把握的是「动作编排层」这一条。**
其余几条里，③ 是纯文案、风险为零；②④ 的收益依赖「老师真的会用它演示」这个尚未验证的前提；⑤ 和反向机会都带技术不确定性。**别把它们当成一个打包方案一次性上。**

---

## 6. 来源与可信度

| 结论 | 依据 | 可信度 |
|---|---|---|
| ActionEngine 两种执行语义、17 个动作类型导入、choreography 常量 | `lib/action/engine.ts` 源码 | **一手**（代码） |
| `SET_WIDGET_STATE` / `HIGHLIGHT` / `ANNOTATE` / `REVEAL` 四类消息与命名约定 | `packages/@openmaic/generation/templates/simulation-content/system.md` | **一手**（提示词） |
| 场景命名 / 一个场景一个机制 / 连续场景不用同一 widgetType | `skills/agent-runtime/deep-interactive/SKILL.md` | **一手**（技能文档） |
| `interactive` = iframe srcDoc 的完整 HTML | `packages/@openmaic/dsl/src/interactive.ts` | **一手**（类型定义） |
| PPTX 占位页 + 二维码 / 离线 HTML 内联 CDN | README「Export」 | 一手（README 自述，未实测） |
| MinerU 用于表格/公式/OCR | README「Optional: MinerU」 | 一手（README 自述） |
| 我们的 `scene.edits` 可承载 setState | 本仓库 DECISIONS §15 + `serialize.ts` | **一手**（本仓库代码） |
| 18 个示例的 subtitle 已符合「交互+揭示」写法，问题在层级 | `packages/core/src/presets.ts` 逐条核对 | **一手**（本仓库代码） |
| 成本估算（人日） | 我的估计 | **推断，非事实** |
| 反向机会（导出即 widget）能否跑通 | 只读了契约，**未实测** | **未验证** |
