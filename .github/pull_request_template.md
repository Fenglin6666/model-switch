## 改了什么

<!-- 一句话说清这个 PR 的目的 -->

## 自检

- [ ] `npm run typecheck` 通过
- [ ] `npm test` 通过
- [ ] 动了 `packages/ui/src/app.ts` 的方法名 → 已 grep `docs/` 里有没有旧名字
- [ ] 改了文件体积 / 新增文件 → 已跑 `npm run doc:facts`（CI 也会查 `doc:check`）
- [ ] 动了界面 → 跑过对应验收：`shots-draw.mjs` / `shots-bank.mjs` / `shots-ink.mjs` / `mp-verify.mjs`
- [ ] 新能力补了断言（纯逻辑优先，别只靠截图）

## 截图 / 数据

<!-- 界面改动贴图；物理改动贴误差数字 -->
