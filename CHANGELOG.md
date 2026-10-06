# Changelog

本项目遵循 [语义化版本](https://semver.org/lang/zh-CN/)；日期为本地时间。

## 0.1.2 — 2026-10-05

**一键安装（复制链接即可）**

- 去掉 `peerDependencies`：插件刻意不静态 import 任何宿主包，声明 peer 只会变成
  DSH 安装时的兼容性闸门（原来写的 `@deepseek-ai/schemastery: ^1.0.0` 与实际运行时
  3.18.4 不符，会直接拒绝安装）。现在安装不会再被 peer 检查拦下。
- 新增 `test/install.test.mjs`：直接执行 **DSH 自己的** `parseInstallSpec()`，
  逐条验证 README 里写给用户的链接写法（Git 网页地址 / `github:` 简写 / git+https / SSH /
  tarball / 绝对路径 / npm 包名）都被接受，并守住「不声明 peer / 不引入依赖」。
- README 新增「一键安装：复制链接就能装」：Plugins → Add plugin → 粘贴仓库地址 →
  Install → Enable now → 重启一次 DSH；并补了安装失败排查（相对路径、私有仓库、GitHub 不可达）。
- 文档自检新增两条断言：一键安装说明必须写清 UI 入口；CHANGELOG 版本号必须与 package.json 一致。
- 新增 `.github/workflows/publish.yml`：打 `v*` 标签（或手动触发）即发布，
  发之前跑测试、校验标签与版本一致、拒绝重复发版；npm 账号开了 2FA 时用带 Bypass 2FA 的
  granular access token（仓库 secret `NPM_TOKEN`）。
- **支持「填包名安装」**：去掉 `private`、加 `publishConfig.access: "public"`，
  `files` 覆盖运行时全部文件（`npm pack` 后 33 个文件 / 70 KB）；新增断言把「发布就绪」钉住，
  并用真实的 tarball 走了一遍 pnpm 安装 + 宿主半侧加载验证。

## 0.1.1 — 2026-10-05

**设置页 / 文案**

- 「用 AI 自定义」补上真正的**输入框**：可以直接打字，下面的提示词**实时**带上你写的内容；
  之前那块只有一段只读提示词，却写着「把那行改成你自己的描述」——打不了字（使用者反馈）。
- 三条示例改为**点一下填进输入框**（而不是只复制），可以先改再复制。
- 新增「清空」按钮；没写内容时复制按钮禁用，提示词框给出说明而不是一段空白提示词。
- 修复英文文案缺失 `copyPrompt`（英文界面下会显示成键名）。

**测试 / 文档**

- 新增「可以打字」测试：用带 state 语义的 React 桩真实模拟 `onChange → setState → 重渲染`。
- 新增文案 key 守卫测试：代码里每个 `t('…')` 都必须在中文/英文字典里存在。
- 新增 `test/docs.test.mjs` 与 `tools/check-docs.mjs`：README 的相对链接、模板清单、
  预览数量、测试数量都能被机器核对。
- 新增 `docs/AI-自定义指南.md`（使用者分步指南）、`examples/`（示例模板 + 注释版最小骨架）、
  `previews/`（9 份可直接打开的预览）、`.github/workflows/checks.yml`。
- README 重写为面向 GitHub 的完整文档（仓库名 **DSH_WallPort**）。

## 0.1.0 — 2026-10-05

首个可用版本。

- **宿主半侧**：通过 `webserver/index-inject` 注入 `<style>` + 覆层 + 运行时脚本；
  读取 DSH 写在 `[data-dsh-boot-spinner]` 上的 `--dsh-boot-arc` 作为真实启动进度。
- **浏览器半侧**：设置 → 外观 →「开机动画」分区：开关、时长、模板画廊、预览、导入。
- **7 个内置模板**：深海脉冲 / 终端启动 / 曲速星野 / 代码雨 / 轨道粒子 / 极简微光 / 水墨。
- **6 个 Agent 工具**：`boot_animation_list / save / apply / preview / remove / settings`。
- **安全的退出条件**：应用挂载、点击跳过、超时兜底、启动报错让路；覆层平时 `pointer-events:none`。
- **两种承载**：`dsh web` 与桌面 App（`dsh-app://`）走同一张注入表；桌面模式下用
  `/api/active?rev=…` 做一次同源核对，让「换模板 → 刷新」立即生效。
- 状态持久化在 `$DSH_HOME/dsh-boot-animation/`，目录不可写时退回内存。
