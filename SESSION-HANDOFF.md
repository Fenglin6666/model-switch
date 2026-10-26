# 交接：接手的第一个人先读这个

> 读完这篇应该能：跑起来、知道现在做到哪、知道下一步该干什么、避开已经踩过的坑。
>
> 想知道「为什么这么做」看 [docs/DECISIONS.md](docs/DECISIONS.md)；
> 想知道「代码在哪」看 [docs/CODEMAP.md](docs/CODEMAP.md)；
> 想知道「产品长什么样」看 [README.md](README.md)。

---

## 1. 一分钟上手

```bash
cd D:\Slogan
npm install          # 已装过就跳过
npm run dev          # Web: http://127.0.0.1:5173
npm test             # 145 passed
npm run typecheck
npm run doc:check    # 文档行数与代码一致
npm run build        # Web 产物
npm run build:mp     # 小程序包 → apps/miniprogram/miniprogram/utils/app.js
```

- Node ≥ 20；实测 Node 24 / Chrome / Windows。
- 小程序：微信开发者工具导入 `apps/miniprogram`，AppID 换自己的；自动化验证见 [docs/MINIPROGRAM.md](docs/MINIPROGRAM.md)。
- 页面里 `window.app` 就是 App 实例：`a.loadPreset('trough')`、`a.fastForward(s)`、`a.frame(0,0)` 可直接驱动。
- 截图脚本用 Playwright（`channel: 'chrome'`），需要 dev server 在 5173。

## 2. 产品定位（不要跑偏）

**一道高中物理题 → 一张形象、易懂、可拨动、可手改的物理模型。**

- **主路径是题目**：题库点一道题 → 看详情 → 生成建模。图片识别 / 拍照是规划中的入口，不是现在的能力。
- **生成的是初稿**：模型不可能次次对，所以拖拽、检查器、世界面板、手绘、组件始终可用。
  **手动修改是兜底，也是产品底线。**
- **不判对错、不复现实验、不追求逼真**；只做「改一个条件，看轨迹/判据怎么变」。
- **生成不了必须明确拒绝**，并给手动建模的路；不能悄悄给一个错模型。
- **不要逐题加 preset**。新能力优先做成可复用的约束/观测器/组件；示例只是落点。

> **产品只提供「物理情境」，不提供「怎么讲」。**
> 判据：新增功能若在表达「先这样、再那样」→ 不做；若在扩展「这个情境能被怎么摆弄」→ 做。

## 3. 当前能力

| 领域 | 有 | 入口 |
|---|---|---|
| 题目 → 建模 | **只有 AI 一条路**（选场景 / 拼阶段 / 搭指令 / 明确拒绝）；没 key 或失败 → 明确提示 + 手动搭 | 题库首页 / 「生成建模」贴题干 |
| 编辑器兜底 | 详情页「手动搭 →」开空白画布；画什么就是什么 | 题库详情页 |
| AI 建模 | BYO-key，存本机；四种 mode（preset / chain / build / unsupported）；**没有第二套生成器**，失败落到手动搭 | 用户页 →「AI 建模」；`docs/AI.md` |
| 端口 | 约束连「接点」而不是裸坐标：几何派生 center/top/四角 + 语义 axle/hook | `core/ports.ts` |
| 结构校验 | 自由度分析、悬空引用、退化几何、过约束；agent 产出后自动验算 | `core/validate.ts` |
| 题库 | 15 道（8 自编示例 + 7 真题），按 力学/电磁学/热学 分类，每条带真实可建状态 | 底部「题库」 |
| 建模库 | 文件夹自建自分类、本地持久化、60 上限、离开画布写回同一条 | 底部「模型」 |
| 用户页 | 本地数据统计、清空建模库/我的题目（都先确认） | 底部「用户」 |
| 画图 | 一笔识别圆/矩形/多边形/直线/折线；电场/磁场两个按钮拖区域；手柄缩放 | 左栏 8 个工具 |
| 组件 | 选中物体 →「存为组件」（沿约束抓整段）→「组件」面板插入 | 检查器 / 侧栏 |
| 假设 chip | 滑块/小球、光滑/粗糙、固定/可移动、有无阻力，点一下重算 | 左侧面板 |
| 力学 | 斜面/半圆槽/圆轨道/圆弧/平抛/板块/弹簧/单摆；绳/杆/弹簧/铰链/轨道约束 | 预置 + 手绘 + 连接工具 |
| 场 | 匀强 E/B（洛伦兹力用速度旋转）、点源、阻力、库仑、N 体引力 | 世界面板 + 场按钮 |
| 热学/连接体 | 气缸 + 理想气体（等温 P=nRT/V）、滑轮（Atwood） | 预置场景 |
| 多过程 | 斜面→水平→上坡 / →圆弧，可在画布上拼链 | 预置 + 多过程链面板 |
| 批注 | 一支笔 + 橡皮 + 清空；世界坐标、不进 Scene、换场景清空 | 左栏批注工具 |
| 分享 | `p1.` 短串（预置 + 参数/假设/编辑）、`s1.` 完整 JSON | 舞台右上角 |

**明确没有的**：预置组件库、空白画布、条件表单、A/B 对照、找临界、传送带、图片识别、课件/讲法/白板。
理由见 [docs/DECISIONS.md](docs/DECISIONS.md) §6。

## 4. 界面结构

- **四个页面**：`mode = 'user' | 'bank' | 'library' | 'scene'`，底部三栏（用户 / 题库 / 模型 N）。
  `problemOpen` 是盖在题库上的详情页，不算独立 mode。
- **题库（首页）**：分类 chips + 题目卡片。点卡片 → 详情页（**先看题，不建模**）；详情页按「生成建模」才生成。
- **建模库**：文件夹 chips + 模型卡片（场景预览）。`⋯` 打开移动面板。
- **画布（v5.8 起）**：左参数面板（品牌字 + 标题 + 8 工具 + 参数滑杆 + 假设 chip + 重新开始/重置视图 +
  读数卡 + 世界/组件/题目/返回）+ 右舞台（播放键 + 状态药丸 + 分享/世界）+ 底部 v–t 图。
  窄屏（< 760）面板变底部抽屉、图表收起。
- **相机视口是整窗**，但 `viewPan()` 把内容偏到舞台中心——所以指针坐标不用换算。
- **没有常驻状态条了**：状态在舞台左上药丸，选中的东西在底部抽屉（检查器 / 世界 / 组件 / 多过程链）。

## 5. 验证

```bash
npm test                      222 passed
npm run typecheck             通过
npm run doc:check             28 个文件一致
node scripts/shots-editor.mjs 3/3    # 编辑器截图（README 的 240/241）+ 8 工具 + 「存为组件」入口
node scripts/shots-draw.mjs   25/25  # 识别 / 吸附 / 手柄 / 场两按钮 / 物理 / 存组件→插入
node scripts/shots-ink.mjs    9/9    # 批注
node scripts/shots-bank.mjs   19/19  # 三栏 / 详情 / 生成 / 暂不支持 / 清空 / 持久化 / 手机尺寸 / 改名迁移 / AI 设置与回退
LLM_KEY=xxx node scripts/ai-check.mjs   # 打真实接口：6 道题看 AI 怎么决定（需 dev server）
node scripts/mp-verify.mjs    15/15  # 小程序（需 9420 端口）
npm run build                 483 KB / gzip 135 KB
npm run build:mp              473 KB
```

**跑验收的两个注意事项**：

1. **别用 `for` 循环连着跑四个截图脚本**。上一个浏览器刚关、Vite 还没缓过来，下一个会 navigation timeout。
   逐个跑，失败的单独重试就过。
2. `mp-verify` 在开发者工具负载高时**会偶发** `timeout waiting for automator response`，报错停在哪个用例是随机的，
   **重跑即过，不是断言失败**。已做的缓解：截图改成非致命、重仿真用例把 duration 收到 1.5s + 步长 1/240。

## 6. 下一步（建议顺序）

> 完整的能力面分析在 [docs/AGENT.md](docs/AGENT.md)。那里的结论是：
> **agent 不缺更聪明的模型，缺的是手（op 层）、眼（回读）、尺（校验）**——尺已经有了。

### ✅ 属性表 + 面板表驱动（已完成 2026-10-26）

检查器面板是**写死的**（`renderBodySheet` 353 行、12 根滑杆）。后果很直接：
AI 用 build 搭出来的场景，界面上没有对应的滑杆——**agent 造什么都调不了**。

做法：先列一张属性表（key / 标签 / 范围 / 单位 / 必需性 / 适用 kind），面板按表渲染。
判据：**21 年 4462 道真题里没出现过的属性，就不进表**（属性集是封闭的，见 [DECISIONS.md](docs/DECISIONS.md) §2.10）。

顺手能削掉 `renderBodySheet` 大半，也是拆 `sheets`（~800 行）的入口。

### P0：找老师试（非代码，最高优先）

打开 `npm run dev` → 题库点一道题 → 生成 → 改参数 → 存进文件夹 → 存一个常用组件，**全程计时**。
记录三件事：① 从「点题」到「能拨」几秒；② 他会不会自己建文件夹；③ 会不会回头再打开旧模型。

判断标准：**如果老师根本不回访建模库，说明「收藏夹」是伪需求，下一版砍掉。**

### P1：组件参数槽（让自举成立）

`SavedComponent` 现在是**冻结快照**（没有参数）。agent 造了「v=2 的传送带」，下一道题是 v=3 就得重造，
结果是「每个实例一个组件」，40 个上限瞬间爆掉。

加 `paramSlots: [{key, label, unit, min, max, path}]`，插入时按路径写值。
**不需要 `layout()`**——只有"参数改几何"才需要，而绝大多数参数是数值行为。
参数改几何的那类，别沉淀，让 agent 每次重造。

### P1：判据 → 动作

判据现在只检测不动作，所以"绳断了球飞出去"表达不了。给判据加一个数据化的动作列表：

```ts
{ kind:'detach', bodyId:'ball', then:[{ op:'removeConstraint', id:'rope' }] }
```

`op` 的集合正好是那 12 个工具——**一份定义两处用**。

### P1：生成质量与「初稿」表达

生成现在由模型读题决定（规则解析已删）。需要把「猜的」显式标出来：
哪些参数是题目给的、哪些用了默认值。现在只有 `meta.assumptions` 字符串。

### P1：组件与建模库的缺口

- 组件不能导出 / 导入 `.json`（换设备就丢，也没法发给同事）——和建模库是同一件事，一起做。
- 建模库不能重命名模型 / 文件夹（只能新建和删）。
- 库里的完整 Scene 约 8–30 KB/个，60 个上限是 localStorage 的保守值；小程序单 key 1 MB，接近时要在 UI 提示。

### P1：约束退化

斜面 θ=0→水平面、弹簧 k→∞→杆、板 m→∞→地面。**必须是参数连续变化的结果**，不做隐藏开关。
这是覆盖率的第二个杠杆（第一个是组件可串联）。

### P1：精确圆弧入口

`arcChain` 用 13 段折线近似圆弧 + 接触，能跑、已上架。`track` 约束已支持 `entry`/`fromAngle`/`toAngle`，
但精确圆弧入口处球挂上 `DistanceJoint` 后速度从 ~4.5 掉到 0，没解决。

排查建议：① 用关节 reaction 日志确认是关节冲量还是地面接触导致；② 入口点放在圆弧上、按切向速度挂接、
关节 `length` 设成实际距离（避免瞬间位置修正）；③ 或用「多段小圆弧 + 只有法向约束」；④ 通过后再替换 `arcChain`。

### P2

- **速度空间相图**：加 `observer: { kind:'phase', series:[{bodyId, quantity:'vx'}, …] }`。不要写成某道题的预置。
- **气缸过程**：现在只有等温 `P=nRT/V`；加 `process: 'isothermal'|'isobaric'|'isochoric'`，先做状态量读数。
- **滑轮一般化**：现在只有 Atwood；`pulley` 已支持 ratio，缺任意放置滑轮的 UI。
- **图片识别**：弹层三入口已就位，只有「粘贴文字」可用。原则是**不为图片另起一套模型表达**，识别失败仍落到手动建模。

### 拆分（见 [docs/REFACTOR-PLAN.md](docs/REFACTOR-PLAN.md)）

`app.ts` 已从 4772 拆到 3923 行。剩下：sheets（~800）、scene-chrome（~250）、sidebar（~330），
**输入层最后拆**（拆之前先补 dispatch 测试）。

## 7. 坑

- **PowerShell 的 backtick / UTF-8**：不要用 `Get-Content | Set-Content` 改源码；用 `write` / `edit` 工具，
  或 Node `fs.writeFileSync(...,'utf8')`。here-string 里的模板字符串 backtick 会被吃掉。
- **多体组件 id**：`nextBodyId()` 连续调用两次都会返回 `b1`；同一次插入多个 body 要用 `nextBodyIds(n)` 预留。
- **固定旋转矩形在斜坡上**：到水平段仍保持斜面角度，最低角可能蹭地；用圆形球或让角度归零。
- **链的圆弧**：`buildChain` 的 arc body 原点要在 `(x, y+r)`，这样弧底才在 `(x,y)`；否则弧跑到水平段下方。
- **命中区会晚一帧**：`loadPreset` 之后立刻 `pointerDown`，命中的还是上一帧的命中区。
  截图脚本里加一帧（`a.frame(0,0)`）再点。
- **用 `visibleBounds()` 算屏幕位置会算到面板底下**：取舞台屏幕坐标（`stageRect()`）最稳。
- **小程序包是构建产物**：改源码后必须 `npm run build:mp`；开发者工具还要 `cli.bat open` 重新编译，
  否则 `getCurrentPages()` 返回 0。
- **改产品名时存储 key 要迁移**：现在是 `slogan.library.v1`，旧 `model-switch.library.v1` 作为
  `LEGACY_KEY` 保留。**别删**，删了老用户的建模库就读不出来（`shots-bank` 有断言锁这条）。

## 8. 文档索引

| 文档 | 内容 |
|---|---|
| [README.md](README.md) | 产品是什么、怎么跑、能力、边界 |
| [docs/CODEMAP.md](docs/CODEMAP.md) | Scene 数据模型、文件地图、常见改动从哪下手 |
| [docs/PHYSICS.md](docs/PHYSICS.md) | 物理断言、实测数字、能建/不能建的边界 |
| [docs/AI.md](docs/AI.md) | AI 建模：四种模式、转发层、key 安全、已知局限 |
| [docs/AGENT.md](docs/AGENT.md) | agent 能力面：手（op 层）/ 眼（回读）/ 尺（校验），T1-T3 判定，权限分层 |
| [docs/DECISIONS.md](docs/DECISIONS.md) | 关键取舍、被推翻的结论、已废弃的方案 |
| [docs/RESEARCH.md](docs/RESEARCH.md) | 真题分布 / 开源生态 / 竞品 / 定位（含可信度标注） |
| [docs/DRAWING.md](docs/DRAWING.md) | 画布：识别阈值、场笔手势、视觉语法、批注 |
| [docs/COMPONENTS.md](docs/COMPONENTS.md) | 组件：存什么、怎么插、边界 |
| [docs/MINIPROGRAM.md](docs/MINIPROGRAM.md) | 小程序壳与真机验证 |
| [docs/REFACTOR-PLAN.md](docs/REFACTOR-PLAN.md) | `app.ts` 拆分进度与剩余计划 |

## 9. 新会话第一句话（可直接粘贴）

```
项目在 D:/Slogan（产品名 Slogan）。先读 SESSION-HANDOFF.md，再读 README、docs/CODEMAP.md。

现状：v5.14。底部三栏：用户 / 题库 / 模型。
- 题库：点一张题 → 题目详情 → 按「生成建模」→ 模型进「模型」页（收藏夹，本地持久化）。
- 画布：没有预置组件库。笔一落就识别（圆/矩形/多边形/直线/折线）；电场/磁场是两个独立按钮，
  按住拖一个矩形就在那块区域建场（点一下=全场）；选中可拖右下角手柄缩放。
- 组件：选中一个物体 →「＋ 存为组件」，顺着约束把整段抓出来；「组件」面板插入到舞台中央，id 全部换新。
- AI：用户页填 API key（只存本机），生成由模型决定用哪个场景/怎么拼阶段；没 key 或失败就明确提示，落到手动搭。
222 个测试；小程序包 473 KB。生成只有 AI 一条路，建不了就手动搭。
app.ts 已从 4772 行拆到 3923：页面在 ui/pages/，布局/画图逻辑是纯函数（有单测），
剩余拆分计划见 docs/REFACTOR-PLAN.md。
明确否掉的：条件表单、首页示例卡片墙、预置组件库、形状调色板、A/B 对照、找临界、**离线规则解析**——别加回来。
（空白画布没被否掉，它现在是「手动搭」的兜底入口。）

下一步优先级：
1) 找老师试：题库 → 详情 → 生成 → 画几笔 → 存进文件夹 → 存一个组件，全程计时；
2) 组件 + 建模库的导出/导入 .json（跨设备 + 可分享，是同一件事）；
3) 生成质量：把「猜的参数」显式标出来；
4) 约束退化（θ→0、k→∞、m→∞，参数连续变化，不做开关）；
5) 精确圆弧入口（track 的 entry 处速度掉到 0，还没解决）。

先跑 npm test / npm run typecheck / npm run dev 确认基线，再动代码。不要大改架构。
```
