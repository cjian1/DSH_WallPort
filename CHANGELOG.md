# Changelog

本项目遵循 [语义化版本](https://semver.org/lang/zh-CN/)；日期为本地时间。

## Unreleased

**安全**

- 插件的 HTTP 接口（`/dsh-wallport-7f3a/api/*`）此前**没有任何鉴权**：外站网页用一个 `no-cors` 的
  「简单请求」就能保存并启用一个模板，而模板会在 DSH 页面里同源执行。现在每个请求都先过 DSH 自己的
  connection 服务（与 DSH 内置路由同一套 Host/Origin 栅栏 + 会话 cookie；没有它时退回同源检查），
  POST 只收 `application/json`（415），请求体必须是 JSON 对象。
- 预览接口返回 `Content-Security-Policy: sandbox allow-scripts`：「在新标签打开」的预览也跑在不透明源里。
- `boot_animation_preview` 不再能写任意路径：只写 `.html`，相对路径落在插件的 `previews/` 目录，
  不覆盖不是预览的已有文件（此前 AI 可以借它把模板内容写进 `~/.zshrc` 之类的文件）。

**修复**

- 桌面模式偶尔整个会话都没有开机动画：宿主在插件激活后只收集一次注入表，而插件的初始化是异步的，
  抢不过就没有注入行。`apply()` 现在等服务就绪才返回；注入行生成出错也只影响这一次，不会连累 DSH。
- `dshBootAnim.reduced()` 永远是 `false`：宿主在 iframe 文档还没加载时就推了一次，模板收不到。
  现在桥接在 iframe 里自己读 `prefers-reduced-motion`（并跟随变化），文档加载完还会补推一遍全部状态。
- 启动快过一次轮询（没看见原生启动视图）时覆层要傻等到兜底时长（默认 12 秒）才退场。
- 跳过 / 启动报错也要凑满最短展示时长才淡出；现在只有「应用挂载」才凑时长，其余立刻让路。
- 应用已挂载、覆层还在凑时长时点击跳过不生效，而且那一下会点到底下看不见的界面；现在立刻淡出，
  并吞掉这一下点击/按键（`pointer-events:none` 不变，覆层仍不会锁死界面）。
- 「点击任意处跳过」提示几乎永远看不见（覆层不吃指针事件，`:hover` 不成立）；现在鼠标一动就亮出来。
- 桌面模式热切换模板时：不先闪一下旧模板（最多等 250ms 核对结果）；底色主题跟着新模板换；
  宿主改了「能否跳过」也会跟上（提示与点击行为都会变）。
- `ready` 事件可能触发两次；预览模拟器的 `loop: false` 没有生效、循环播放时 `isReady()` 第二轮起一直为真。
- 状态目录只读、但里面已有 `state.json` 时，改动会被旧文件「吃掉」；没能落盘/删掉的模板现在也优先于磁盘。
- 覆盖了内置 id 的自定义模板删不掉（设置页不显示删除、工具报「内置模板不可删除」）；现在可以删，删掉即恢复内置版本。
- 设置页：AI 存的模板名字是纯字符串时画廊里显示成 id；名字/描述现在按当前语言显示。
- 设置页：时长被服务端夹紧或联动后输入框仍显示旧值；导入时 JSON 写错会被当成 HTML 存成模板；
  剪贴板不可用时复制失败的提示显示在「导入」下面（现在退回 `execCommand('copy')`，失败提示放在复制按钮旁）。
- `/api/settings` 收到非法类型（如 `"enabled": "yes"`）时悄悄改成默认值；现在返回 400。

**改进**

- 模板文件按 mtime/size/inode 缓存解析结果，设置页每次刷新不再重新读盘 + 校验全部模板。
- 一致性测试不再依赖带哈希的 bundle 文件名与压缩后的函数名（DSH 升级后桌面解释器那项曾被悄悄跳过）；
  装了 DSH 却对不上形状时直接失败。新增启动视图契约与 connection 鉴权接口两项一致性测试。
- `tools/asar.mjs`：header 只解析一次、不再泄漏文件句柄、能读 unpacked 条目。
- 测试从 34 个增加到 48 个。

## 0.2.1 — 2026-10-06

- **首次真正上线 npm**：`dsh-wallport@0.2.1`。内容与 0.2.0 完全一致。
- 为什么不是 0.2.0：那次 `npm publish`（npm 11 的分阶段发布流程）在 registry 上占用了
  0.2.0 这个版本号，但没有对外可见的版本；npm 的版本号一经使用不可复用，
  因此跳到 0.2.1 重新发布（`npm stage publish` → `npm stage approve <stage-id>`）。

## 0.2.0 — 2026-10-06

**统一命名为 DSH_WallPort**

- 展示名处处统一为 **DSH_WallPort**：仓库、README、插件卡片标题（`meta.title` 与语言包）、
  启动日志、图标说明。
- 机器标识改为全小写的 **`dsh-wallport`**：npm 包名 / DSH 插件行名 / 浏览器模块 id /
  覆层 DOM id / HTTP 路由前缀（`/dsh-wallport-7f3a`）/ 状态目录。大写包名会被 npm 拒绝，
  DSH 的 `parseInstallSpec()` 也只接受 `[a-z0-9._~-]`，所以这是唯一两边都能用的写法。
- **状态自动迁移**：首次启动时把 `$DSH_HOME/dsh-boot-animation/` 整棵拷贝到
  `$DSH_HOME/dsh-wallport/`（拷贝而非移动），自定义模板与当前设置不丢。
- 因为包名变了，装过 0.1.x 的 profile 需要卸载重装一次。
- 文档：README 增加「从旧名字升级」一节与命名说明；本地目录名也改成 `DSH_WallPort`。

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
- 状态持久化在 `$DSH_HOME/dsh-wallport/`，目录不可写时退回内存。
