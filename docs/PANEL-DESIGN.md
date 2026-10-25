# 属性面板设计：参考实现与 schema 驱动方案

> 目标：手动修改兜底的面板，要「简洁高级」，且加组件时不用改面板代码。
> 前提：**Slogan 的 UI 全部画在 canvas 上（无 DOM）**，所以不能直接 import React 组件——能拿的是**设计模式 + 数据结构 + 交互逻辑**，不是组件代码。这一点决定了「参考谁」和「怎么参考」。

---

## 1. 四个参考实现（按可借鉴度排）

| 项目 | 许可 | ★ | 能拿什么 | 能不能直接用代码 |
|---|---|---|---|---|
| **[Excalidraw](https://github.com/excalidraw/excalidraw)** | **MIT** | 134k | **面板的信息架构与视觉规则**（最接近你要的「简洁高级」） | ❌ 不能，React + DOM |
| **[myPhysicsLab](https://github.com/myphysicslab/myphysicslab)** | **Apache-2.0** | 453 | **参数反射体系**（`ParameterNumber` → 自动生成控件），同领域、同技术栈 | ⚠️ 可移植逻辑（TS，但绑 DOM） |
| **[tweakpane](https://github.com/cocopon/tweakpane)** | **MIT** | 4.6k | **参数面板的折叠/绑定模型**（`blade` + `binding`），多参数时的组织方式 | ❌ 不能，DOM 库 |
| **[Penpot](https://github.com/penpot/penpot)** | MPL-2.0 | 61k | 完整设计工具的面板分组（偏重，只作对照） | ❌ 不能 |
| ~~tldraw~~ | 自定义（免费非商业） | 51k | 视觉很精致，但**许可不是 OSI 开源**，不建议抄代码 | ❌ |
| ~~希沃~~ | 闭源 | — | 只能看形态，拿不到代码 | ❌ |

**结论：视觉规则抄 Excalidraw，参数体系抄 myPhysicsLab，多参数组织参考 tweakpane。三个都不进代码依赖。**

---

## 2. 从 Excalidraw 提炼的五条视觉规则

我读了 `packages/excalidraw/components/Actions.tsx`（942 行）。它的属性面板有约 40 个动作，但看起来毫不拥挤。做法是五条：

### 规则 1：图标化，不用文字标签

面板里几乎全是图标，文字只出现在 tooltip 里。

**为什么有效**：中文标签（「摩擦系数」）比图标宽 3–4 倍；一旦用文字，面板就会变成表单。

**对 Slogan 的映射**：`μ` 用「斜纹/平滑」两个图标，不用「摩擦系数」四个字；`θ` 用角度图标 + 数值。

### 规则 2：选项少而全可见，不用下拉

描边宽度只有 3 档（细/中/粗），填充样式只有 3 档，全部平铺可见，点一下即切换。

**为什么有效**：下拉要两次点击 + 一次视线移动；平铺只要一次。而且「3 档」本身就是一种表达——告诉用户这个量只有 3 种典型情况。

**对 Slogan 的映射**：`模型`（质点/刚体）2 档；`槽`（固定/可移动）2 档；`摩擦`（光滑/粗糙/自定义）3 档。**只有连续量才用滑杆。**

### 规则 3：分组靠分隔线，不靠标题

动作按「层级 → 对齐 → 颜色/描边 → 字体 → 箭头 → 编辑」排，组间一条 1px 线，**没有「颜色」这种小标题**。

**为什么有效**：标题本身占垂直空间，而且用户是靠位置记忆的，不是靠标题找的。

### 规则 4：动作注册表，面板不硬编码

```tsx
{renderAction("changeStrokeWidth")}
{renderAction("changeStrokeStyle")}
{renderAction("changeSloppiness")}
```

`renderAction(name)` 从 `ActionManager` 取动作，动作自己声明：图标、可用谓词（`canChangeStrokeColor`）、执行逻辑、当前值。

**这是最值钱的一条**——面板只负责「排布顺序」，不负责「有哪些控件」。加一个属性 = 注册一个动作，**面板代码不动**。

### 规则 5：不适用的动作隐藏或置灰，不报错

`getShapeActionPredicates()` 判断当前选中什么，不适用的动作不出现。

**对 Slogan 的映射**：选中地形时不显示「初速度」；选中物体时不显示「圆心角」。

---

## 3. 从 myPhysicsLab 提炼的参数体系

它的 `src/lab/controls/` 有 1 个基类 + 8 个控件：

```
LabControl      (基类)
ButtonControl   按钮
CheckBoxControl 勾选
ChoiceControl   单选（下拉）
GroupControl    分组
LabelControl    纯文字
NumericControl  数字输入
SliderControl   滑杆
TextControl     文本
```

**关键不是这些控件，是它的参数声明方式**：每个 `SimObject` 在构造时声明 `ParameterNumber`，UI 反射读取生成控件。加一个物理量 = 加一行声明，不用碰 UI。

它还有 `src/sims/common/CommonControls.ts`——**通用控件组**：把「时间倍率 / 重力 / 阻尼 / 显示选项」这类跨场景参数收在一处，所有 lab 复用。

**对 Slogan 的直接启示**：现在 `renderBodySheet()` 是 **351 行手写**（`app.ts` 2259–2610），每加一个字段就要改这里。这是不可持续的。

---

## 4. 方案：参数 schema 驱动面板

### 4.1 类型草案

```ts
// packages/core/src/spec.ts

export type ParamSpec =
  | { key: string; kind: 'number'; label: string; unit?: string
      min: number; max: number; step?: number; default: number
      /** 滑杆旁显示的派生读数，如 v = 5.0 m/s · 方向 30° */
      readout?: (v: number) => string }
  | { key: string; kind: 'enum'; label: string; default: string
      options: Array<{ value: string; label: string; icon?: string }> }
  | { key: string; kind: 'bool'; label: string; default: boolean
      /** 两态图标：[关, 开] */
      icons?: [string, string] }
  | { key: string; kind: 'vec2'; label: string; default: Vec2 }

export type ComponentSpec = {
  /** 与 Scene 里的判别字段对应：body.kind / constraint.type / field.type */
  type: string
  role: 'matter' | 'environment' | 'constraint' | 'criterion' | 'observer'
  label: string
  /** 面板分组顺序，小的在上 */
  group: number
  params: ParamSpec[]
  /** 当前选中对象是否适用（对应 Excalidraw 的 predicate） */
  appliesTo: (scene: Scene, sel: Selection) => boolean
  /** 读当前值（优先读 edits 覆盖层） */
  read: (scene: Scene, sel: Selection) => Record<string, unknown>
  /** 写值：必须走 scene.edits，保证分享/重建后不被布局冲掉 */
  write: (scene: Scene, sel: Selection, key: string, value: unknown) => Scene
}
```

### 4.2 面板变成三段循环

```ts
// packages/ui/src/panel.ts（新文件，替代 renderBodySheet 的手写分支）
const specs = SPECS
  .filter(s => s.appliesTo(this.doc, this.selection()))
  .sort((a, b) => a.group - b.group)

for (const spec of specs) {
  this.drawGroupHeader(spec)                 // 图标 + 名称（可省）
  const vals = spec.read(this.doc, this.selection())
  for (const p of spec.params) {
    if (!this.isParamVisible(spec, p, vals)) continue
    this.drawControl(p, vals[p.key])         // 按 kind 分派到 number/enum/bool
  }
  this.drawSeparator()
}
```

**收益**：加一个组件 = 加一个 `ComponentSpec`，`panel.ts` 不动。

### 4.3 控件形态（canvas 自绘，不依赖 DOM）

| kind | 形态 | 尺寸 |
|---|---|---|
| `enum`（2 档） | 两个图标按钮并排，选中态深底浅图 | 每格 44×44 |
| `enum`（3–4 档） | 一行图标按钮 | 同上 |
| `bool` | 一个开关图标，点击切换 | 44×44 |
| `number` | 滑杆 + 右侧等宽数字（数字可点改） | 高 44，滑杆占 60% |
| `vec2` | 大小滑杆 + 角度滑杆（两行） | 高 88 |

**触摸目标 ≥ 44px**（微信设计规范），这与 Excalidraw 的桌面尺寸不同，要按小程序放大。

### 4.4 分组顺序（按使用频率，不按物理分类）

| group | 内容 | 理由 |
|---|---|---|
| 0 | 几何（θ / L / R / 宽高） | 最先调，因为它决定「长什么样」 |
| 1 | 运动（v₀ 大小 + 方向） | 第二常调 |
| 2 | 物性（m / q / μ / k） | 第三 |
| 3 | 关系（固定/可移动、连接对象） | 较少 |
| 4 | 外力（Fx / Fy / 多个力） | 最少 |

**注意**：不要按「力学/电磁」分组——用户是在调一个具体对象，不是在上物理课。

---

## 5. 迁移路径（不一次性重写）

现有 `renderBodySheet()` 351 行。**不要推倒重来**，按组件逐个迁：

1. **先建 `spec.ts` + `panel.ts`**，只支持 `number` 和 `enum` 两种 kind
2. **先迁 2 个组件**：`incline`（θ/μ/L）+ `loop`（R/v₀）——它们参数最少，验证机制
3. **对比截图**：迁移前后同一场景的检查器截图必须一致或更好，否则不回退
4. **再迁其余组件**，每迁一个跑一次 `npm test` + `shots-build`
5. 全部迁完后删掉 `renderBodySheet` 的手写分支

**风险**：canvas 自绘的命中区（`this.ui.add({rect, onClick})`）需要重新计算布局。**布局代码要独立成纯函数**（输入：面板宽高 + 控件列表，输出：每个控件的 rect），这样才能写单测——现在是混在渲染里的，改起来容易错位。

---

## 6. 不做清单

| 不做 | 理由 |
|---|---|
| 数字输入框弹键盘 | 小程序里弹键盘会顶起整个画布；用滑杆 + 点按微调（±）代替 |
| 折叠面板 / 手风琴 | 参数 ≤5 个，折叠反而多一次点击 |
| 搜索参数 | 同上 |
| 参数分组标题文字 | 用图标 + 分隔线（规则 3） |
| 导入 Excalidraw / tweakpane 的代码 | canvas-only，进不来；而且会把包体积从 405KB 推高 |
| 多选批量改 | 现阶段选中单个对象是主路径，批量改等有真实需求再说 |

---

## 7. 验收标准

一个组件算「面板做好了」，要同时满足：

1. 参数 ≤ 5 个，且每个都是学生能读的物理量（不出现 `damping` / `restitution` 这种）
2. 每个参数都能用一根滑杆或一次点击驱动（不能有「只能看不能调」的）
3. 默认值对应教材典型情形（斜面 30°、μ=0.3、g=9.8）
4. 改完参数后分享串仍能压回 `p1.`（≤250 字符）
5. 选中/取消选中时，面板不跳动、不遮住被选中物体

---

## 附：相关文件

- 现有面板：`packages/ui/src/app.ts` — `renderDock()` 2147、`renderBodySheet()` 2259、`renderConstraintSheet()` 2611、`renderWorldSheet()` 2685
- 控件原语：`packages/ui/src/widgets.ts`（按钮/滑杆/命中区，479 行）
- 编辑覆盖层：`scene.edits` + `applyEdits()`（`packages/core/src/scene.ts:449`）
- 组件体系：`COMPONENT-SYSTEM.md`（配套文档，schema 的另一半在那边）
