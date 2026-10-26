# 小程序壳：实现与验证实录

> 状态：**已跑通并被自动化验证**（2026-10-21，微信开发者工具，模拟器 iPhone 12 / 390×844 @3x）。
> 验证脚本：[scripts/mp-verify.mjs](../scripts/mp-verify.mjs)（15 项全过）。

## 1. 为什么壳可以很薄

`core / physics / render / ui` 都没有 DOM 依赖：

- `@core`：纯数据 + 纯函数（手写 base64/UTF-8，不需要 `btoa`/`TextEncoder`）；
- `@physics`：Planck + 纯计算；
- `@render`：只要求一个标准 Canvas 2D 上下文；小程序 `type="2d"` 的 context 是同一套 API；
- `@ui`：全部 UI 画在 canvas 上，输入归一化为 `pointerDown/Move/Up`、`wheel`、`key`。

打包产物里 `document.` / `window.` / `navigator.` / `localStorage` 的出现次数都是 **0**。

## 2. 文件

```
apps/miniprogram/
  project.config.json          # appid / miniprogramRoot / 编译配置
  miniprogram/
    app.js · app.json · app.wxss · sitemap.json
    pages/index/index.{js,json,wxml,wxss}
    utils/app.js               # 构建产物（405 KB），不要手改
scripts/build-miniprogram.mjs  # esbuild 打包
scripts/mp-verify.mjs          # 自动化验证
```

页面 130 行左右：取 canvas、喂尺寸与安全区、转发触摸、驱动帧循环、`onShareAppMessage`、题目输入弹窗。

## 3. 构建

```bash
npm run build:mp
# 等价于 scripts/build-miniprogram.mjs：
#   esbuild packages/ui/src/index.ts --bundle --format=cjs --target=es2017
#   用插件把 @core/@physics/@render/@ui 解析到 packages/*/src
```

- 405 KB / 单包上限 2 MB，余量充足；
- 如果以后超了：先砍 Planck 的 testbed 相关导出（已经 tree-shake），再考虑把预置场景拆分包。

## 4. 适配点（都已实现）

| 项 | 处理 |
|---|---|
| 画布尺寸 | `createSelectorQuery().select('#stage').fields({node,size})`，`canvas.width = css × dpr`；App 内部 `ctx.setTransform(dpr…)` |
| 帧循环 | `canvas.requestAnimationFrame`（不要用全局的） |
| 触摸 | `bindtouchstart/move/end` → `t.x / t.y`（相对 canvas）→ `app.pointerDown/Move/Up` |
| 状态栏 | `insets.top = statusBarHeight + 2`，顶栏、工具栏、观测卡、取景都整体下移 |
| 右上角胶囊 | `getMenuButtonBoundingClientRect()` 算出 `insets.right`，顶栏右侧按键组整体左移；同时隐藏顶栏分享键（原生菜单里有） |
| 分享 | `host.share(token)` 只拿到 token；`onShareAppMessage().path` 拼 `?s=<token>`；`onLoad(query)` 里 `decodeURIComponent` 后 `app.openFromEncoded` |
| 题目入口 | `wx.showModal({editable:true})`（基础库 2.17.1+）拿题干 → `app.loadProblemText`；失败时二次弹窗，confirm 直接 `app.loadBlank()`，把「手动搭」作为兜底 |
| 手机上的观测卡 | 默认收起（顶栏图表键打开），否则会盖住圆轨道上半部分 |
| `ctx.roundRect` | 不用它，主题里有手写的 `roundRect`（暂停图标的圆角改成了直角） |
| 字体 | 系统字体栈（PingFang SC / Microsoft YaHei 回退） |
| 读取 AppID | CLI 打开项目时校验登录态下的真实 AppID；`touristappid` 会报「不存在此 AppID」 |

## 5. 验证（`node scripts/mp-verify.mjs`，16 项）

```
PASS  页面启动
PASS  App 实例 + canvas
PASS  安全区（状态栏 + 胶囊）
PASS  预置场景步进
PASS  判据（机械能守恒）
PASS  水平动量守恒
PASS  圆弧场景：光滑圆弧摩擦为 0
PASS  分享串进 path（< 200 字符）
PASS  触摸拖拽走逆投影
PASS  首屏是题库（分类题目卡片可点）
PASS  点题先进详情，不直接建模
PASS  详情页点生成 → 小程序没有 AI，明确失败且不建模型
PASS  AI 计划落库 → 进画布并写入本地建模库
PASS  假设 chip 可点（滑块 → 小球）
PASS  建模库卡片点开回到画布
PASS  无运行时错误

16/16 通过
```

> 注意「点生成 → 明确失败」这一条：小程序端调不了 AI（域名白名单过不去），
> 所以生成必须是**明确失败**而不是静默什么都不做。落库链路用 `app.applyPlan()` 单独测，不碰网络。

截图：`screenshots/mp-02-trough.png`、`mp-03-assumption.png`、`mp-09-generated.png`、`mp-10-library.png`。

## 6. 踩过的坑

1. **服务端口默认关闭**：CLI 会报 `IDE service port disabled`，且 IDE 有自我保护、`taskkill` 拿不到进程。手动在「设置 → 安全设置 → 服务端口」打开即可（写进了 README）。
2. **AppID 校验**：登录态下 CLI 会去后台校验，`touristappid` 和空值都不行；测试号要在 IDE 里建项目时生成，或用自己的 AppID。
3. **分享 path 有长度限制**：完整场景 4.6 KB 会被截断。改成 `p1.<预设>.<参数/假设/编辑>`，约 100–250 字符；自由画布仍用完整编码（Web 端无此限制）。
4. **拖拽第一帧会跳**：按下小球时属性面板立刻弹出、相机上移，逆投影基准变了。改成「松手才算选中」后，26 px 对应 0.18 m，和相机比例一致。
5. **手机上的取景**：辅助线（等高线）常常比主体宽，会把圆轨道挤得很小；取景时忽略辅助线，只框主体和靶区。
6. **automator 的 `reLaunch`**：首次连接时偶发 `getPageMetaByWebviewId` 为空，改用 `currentPage()` / 直接操作 `getCurrentPages()` 更稳。

## 7. 还没做的

- 真机（iOS/Android）与低端机帧率：模拟器 60 fps，真机需要实测；降级位（关阴影 → 关厚度 → 减采样）已留好。
- 分享卡片的自定义封面图：现在是默认标题 + 场景 token，够用但不惊艳。
- 小程序内「保存到相册」导出场景截图：`canvas.toTempFilePath` 可以做，这一版没接。
