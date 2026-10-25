# app.ts 拆分计划

> 起因：审计指出 `packages/ui/src/app.ts` 是 4772 行的巨石——顶栏、工具轨、检查器、临界浮层、题库、详情、画图、场笔全在一个类里。
> 结论：**先不动架构，只做文件级拆分 + 纯逻辑外提**。目标不是「好看」，是让 UI 逻辑能被单测覆盖、改一处不牵连全身。

行数以 `npm run doc:facts` 生成的 [CODEMAP](CODEMAP.md) 事实块为准，本文不手写数字。

---

## 已完成（2026-10-25）

| 模块 | 内容 | 拆法 |
|---|---|---|
| `packages/ui/src/pages/` | 题库页、题目详情、模型页、移动面板、用户页、确认弹层、底部三栏 | `PagesHost` 窄接口 + 无状态渲染函数；`app.ts` 只留转发 |
| `packages/ui/src/editor/layout.ts` | 面板 / 舞台 / 图表 / 画布 / 相机偏移 / 底栏 / 标题栏 / 浮动面板 | **纯函数** `computeLayout(input) → EditorLayout` |
| `packages/ui/src/editor/drawing.ts` | 场笔手势判定、手势→场、识别→Body、形状缩放 | **纯函数** |
| `packages/ui/src/scene-bounds.ts` | 取景包围点 | 纯函数 |
| `tests/ui-layout.test.ts` | 8 项：宽屏/窄屏/断点/相机对准画布中心/浮动面板 | — |
| `tests/ui-drawing.test.ts` | 11 项：三种手势、交叉判定、四种 Body 映射、缩放 | — |

拆分原则（后面继续拆时照这个来）：

1. **纯逻辑先走**：能在 node 里断言的（几何、手势、映射）一律提成纯函数，不留 `this`。
2. **渲染函数收窄接口**：页面只读状态、只调十来个动作，用 `PagesHost` 表达；不碰相机、不碰仿真、不碰命中区生命周期。
3. **App 保留薄转发**：`private renderBank() { renderBankPage(this) }`。这样调用点和 `frame()` 的编排不用改，回归风险最小。
4. **每拆一步跑三件套**：`tsc` + `shots-bank/shots-draw/shots-ink` + `npm test`。这一步不能省——UI 没有单测兜底。

---

## 还没拆（按收益排序）

### 1. `editor/sheets.ts`（约 800 行，最大一块）

`renderBodySheet` / `renderConstraintSheet` / `renderWorldSheet`。

- 难点：它们直接调 `setBodyMass` / `setBodyVelocity` / `setConstraintValue` / `addField` 等二十来个 setter。
- 做法：定义 `SheetHost`，把这二十个 setter 列进去（和 `PagesHost` 同款）。setter 本身**不动**——它们改 doc、pushHistory、rebuild，属于 App 的职责。
- 验收：`shots-draw` 里「选中后拖手柄」「双击切分类」+ 手工点一遍检查器各字段。

### 2. `editor/scene-chrome.ts`（约 250 行）

`renderSceneMode` 的编排 + `renderStageChrome` + `renderChartPanel` + `renderFieldHint`。

- 这层几乎全是「读 doc、画、注册命中区」，适合整块搬。
- 注意：`renderSceneMode` 是编排入口，搬走之后 App 只留 `this.renderSceneMode()` 一行转发。

### 3. `editor/sidebar.ts`（约 330 行）

`renderSidebar` + `renderSceneParams` / `renderBodyParams` / `renderConstraintParams` + `renderReadouts`。

- 参数滑杆的「读值 → 写回」目前散在闭包里，搬的时候顺手收敛成一张表：
  ```ts
  type ParamRow = { key: string; label: string; min: number; max: number; step: number; get(): number; set(v: number): void }
  ```
  这样「哪些参数能调」变成数据，而不是 8 段重复的滑杆代码。

### 4. `editor/threshold-overlay.ts`（约 200 行）

`openSearchPanel` / `renderSearchPanel` / `renderSearchOverlay` / `activeThresholdSpec`。

- 这层已经基本无状态（全靠 `search` 字段），拆起来最轻松，可以顺手做。

### 5. 输入层（暂不拆）

`pointerDown/Move/Up`、`moveDrag`、`wheel`、`key`——状态机式代码，硬拆容易出隐蔽 bug。
**先补测试再拆**：把「命中区 → 动作」的分发逻辑提成 `dispatchHit(hit, ctx)`，用假 hit 跑断言。

---

## 不做的事

- **不引入框架**（React/Vue）：整套 UI 是 canvas 自绘，换框架等于重写。
- **不改 Scene 数据模型**：拆 UI 不动 core，`p1.` 分享串、库里的 JSON 都不受影响。
- **不为拆而拆**：如果某个方法只被调用一次、也不含逻辑（纯绘制），留在 App 里比硬提一个 300 行的模块更清楚。

---

## 顺手要做的两件（低成本）

1. **`npm run doc:check` 进 CI**：行数漂了直接红。已经写好 `scripts/doc-facts.mjs`。
2. **PR 模板加一条**：改了 `app.ts` 的方法名 → 顺手 grep 一遍 `docs/` 里有没有旧名字（`renderTopBar`、`SHAPE_TOOLS` 这些已经死掉的符号还在 CODEMAP 里躺过很久）。
