<div align="center">

# DSH_WallPort

**给 DeepSeek Harness 的开机画面换一块你喜欢的墙纸。**

内置 7 套动画开箱即用 · 说一句话让 AI 现场做一个 · 换模板刷新页面即可生效

[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](./LICENSE)
[![Platform: DeepSeek Harness](https://img.shields.io/badge/platform-DeepSeek%20Harness-4d6bfe.svg)](https://github.com/deepseek-ai)
[![Plugin: DSH bundle](https://img.shields.io/badge/plugin-DSH%20bundle-7b2bff.svg)(#快速开始)
[![No build step](https://img.shields.io/badge/build-none%20(plain%20ESM)-success.svg)](#开发)

[这是什么](#这是什么) · [快速开始](#快速开始) · [内置模板](#内置模板) · [用-ai-自定义](#用-ai-自定义) ·
[工作原理](#工作原理) · [常见问题](#常见问题) · [维护与发版](#维护与发版) · [English](#english)

</div>

> **命名说明**：仓库叫 **DSH_WallPort**，插件包名是 **`dsh-boot-animation`**（DSH 配置树里的行 id 为 `boot-animation`）。
> 仓库名取自「Wall（开机画面）+ Port（把它接进 DSH）」，包名描述的是实现；两者指同一个东西。

---

## 这是什么

DeepSeek Harness 启动时会先显示一个画面（原生那张是「HARNESS + 转圈 + Loading plugins…」）。
DSH_WallPort 是一个 DSH 插件，它把这段画面换成你选的动画：

- **7 套内置模板**：深海脉冲、终端启动、曲速星野、代码雨、轨道粒子、极简微光、水墨；
- **用 AI 自定义**：在设置页写一句「我想要的样子」，复制提示词丢给对话里的 AI，它会写好动画、存成模板并应用；
- **真实进度**：进度条/星速/雨量跟随 DSH 自己的插件加载进度，不是假装在加载；
- **不碰 DSH 源码**：走官方注入接口，改的是一个覆层；插件掉了/卡了，原生启动画面原样露出来；
- **零构建**：纯 ESM + 原生浏览器代码，没有打包步骤、没有运行时依赖。

不需要写代码，不需要重装；**首次安装**和**关闭动画**需要重启一次 DSH（见[生效时机](#生效时机)）。

## 亮点

| | |
|---|---|
| 📎 **一键安装** | 在 Plugins 页面粘贴仓库链接即可安装（Git 地址 / tarball / npm 名 / 本地路径都收） |
| 🎬 **开箱即用** | 装完就有 7 套动画，设置页点一下「应用」即可 |
| 🤖 **AI 原生** | 6 个 Agent 工具让 AI 直接生成/切换/预览模板，不用手写 HTML |
| 📈 **真进度** | 读取 DSH 写在 `[data-dsh-boot-spinner]` 上的 `--dsh-boot-arc`，换算成 0–100% |
| 🖥️ **两种承载都支持** | 桌面 App（`dsh-app://`）与 `dsh web`（本机 HTTP）走同一张注入表 |
| 🛟 **不会锁死界面** | 应用挂载即淡出；启动报错立刻让路；超时兜底；随处点击可跳过；平时 `pointer-events:none` |
| 🧩 **模板即 HTML** | 一个模板 = 一段自包含 HTML，AI 能写、你能改、能单独预览 |
| 🧪 **有验证** | 32 个测试，其中两项直接执行 DSH 自己的注入渲染代码 |

## 快速开始

### 一键安装：复制链接就能装（推荐）

DSH 侧边栏的 **Plugins** 页面自带 **Add plugin** 输入框，它接受 Git 地址——所以把仓库地址粘进去就行：

1. 打开侧边栏的 **Plugins**；
2. 点 **Add plugin**，粘贴仓库地址：

   ```text
   https://github.com/cjian1/DSH_WallPort
   ```

3. **Install** → 装完点 **Enable now**（默认就会启用这个 bundle）；
4. **重启一次 DSH**，然后 设置 → 外观 → **开机动画**。

输入框接受下面这些写法（都由 DSH 自己解析；本仓库的 `test/install.test.mjs` 会拿 DSH 的解析器逐条验证）：

| 写法 | 例子 | 备注 |
|---|---|---|
| **Git 网页地址** | `https://github.com/cjian1/DSH_WallPort` | 最省事：浏览器地址栏复制即可 |
| GitHub 简写 | `github:cjian1/DSH_WallPort` | 更短，gitlab / bitbucket / gist 同理 |
| git+https / SSH | `git+https://…`、`git@github.com:cjian1/DSH_WallPort.git` | 私有仓库用 SSH |
| tarball | `https://…/DSH_WallPort-0.1.2.tgz`，或本地 `/abs/x.tgz` | `pnpm pack` 出来的离线包 |
| 本地目录 | `/Users/你/DSH_WallPort` | **必须绝对路径**，相对路径会被拒绝 |
| npm 包名 | `dsh-boot-animation` | 如果你把它发到了 npm |

安装过程：DSH 先用 `git ls-remote` 探一次仓库连通性（默认 5 秒超时），再交给 pnpm 拉取。
本插件**没有任何依赖、没有构建脚本**，所以不会弹「允许运行安装脚本」那一类确认；
装完在 Plugins 页面的 **Installed** 分组里能看到它。

> 网络受限时：GitHub 被墙的话，界面会提示 **Cannot access GitHub** 并建议国内镜像——
> 但镜像只镜像 npm registry，**不镜像 GitHub 仓库本身**，所以要改用 npm 包名或 tarball 地址。

### 让 AI 帮你装（等价路径）

在 DSH 会话里说一句「装一下 https://github.com/cjian1/DSH_WallPort」，或直接给工具参数：

```text
plugin_manager(action: "install_bundle", target: "https://github.com/cjian1/DSH_WallPort")
```

也可以把本仓库克隆到本地后按绝对路径装（开发时最常用）：

```text
plugin_manager(action: "install_bundle", target: "/本仓库所在目录的绝对路径")
```

这条路径的结果里 `application: applied` 即成功。`install_bundle` 与 Plugins 页面走的是同一套服务，
区别只是前者需要 `danger-full-access` 或一次批准。

<details>
<summary>手动安装（等价于插件管理器做的事）</summary>

在目标 profile 的 `package.json` 里把本目录加进 `dependencies`（`link:` / `file:` 均可），
并把包名加进 `dsh.profile.bundles`，再让 pnpm 装一次。插件管理器做的就是这两步，推荐直接用管理器。
</details>

### 换一个内置模板

设置 → 外观 → **开机动画** → 卡片上点「预览」看效果 → 「应用」→ **刷新页面**。

### 让 AI 现场做一个

在任意会话里说：

> 把开机动画换成赛博霓虹风格的，紫粉色光带 + 扫描线，节奏快一点

AI 会调用 `boot_animation_list` → 写动画 → `boot_animation_save`（存成模板并启用）→
`boot_animation_preview`（给你一份能直接打开的预览），然后告诉你当前生效的是哪个模板。
不满意就继续说「再亮一点」「慢一些」。

更稳的做法：设置页 → 开机动画 → **「用 AI 自定义」**，在输入框里写下你的描述，
点「复制提示词给 AI」，整段粘到对话里发送（那段提示词自带工具用法与模板格式，AI 一次就能做对）。

## 内置模板

| id | 名字 | 说明 | 预览 |
|---|---|---|---|
| `deepseek-pulse` | 深海脉冲 | 品牌蓝呼吸光晕 + 官方鲸鱼标记，进度条跟随真实进度（默认） | [预览](previews/deepseek-pulse.html) |
| `terminal-boot` | 终端启动 | 等宽终端逐行打印启动日志，块状进度条 | [预览](previews/terminal-boot.html) |
| `starfield` | 曲速星野 | canvas 星野向中心曲速飞行，速度跟随进度 | [预览](previews/starfield.html) |
| `matrix-rain` | 代码雨 | 字符雨落速跟随进度，中央字标渐亮 | [预览](previews/matrix-rain.html) |
| `orbit` | 轨道粒子 | 三条倾斜轨道上的粒子环绕核心 | [预览](previews/orbit.html) |
| `minimal-fade` | 极简微光 | 近乎静止 + 1px 微光进度线，不打扰 | [预览](previews/minimal-fade.html) |
| `ink-wash` | 水墨 | 宣纸底墨点扩散 + 中文落款（亮色主题友好） | [预览](previews/ink-wash.html) |

> 「预览」是**可直接打开的 HTML**：下载后用浏览器打开就会循环播放（带模拟进度）。
> 想一次全部导出：`node tools/preview.mjs --all`。

`examples/` 里还有两个**真的由 AI 生成**的模板（[极光漂移](previews/aurora-drift.html) /
[赛博霓虹](previews/neon-scan.html)）和一个[带注释的最小骨架](examples/minimal-template.html)。

## 用 AI 自定义

默认走这条路：**你说需求，AI 写动画**。插件注册了 6 个工具：

| 工具 | 作用 |
|---|---|
| `boot_animation_list` | 列出所有模板与当前生效项 |
| `boot_animation_save` | 把一段 HTML 存成自定义模板（可立即启用）——**AI 生成动画的主入口** |
| `boot_animation_apply` | 切换生效模板（或整体关闭） |
| `boot_animation_preview` | 导出一份独立预览 HTML 并返回路径，先看后启用 |
| `boot_animation_remove` | 删除自定义模板（内置模板删不掉） |
| `boot_animation_settings` | 最短时长 / 兜底时长 / 是否可跳过 |

### 模板契约（给 AI，也给你）

模板就是**一段自包含 HTML 文档**，插件把它塞进铺满全屏的 iframe（`srcdoc`）里播放：

1. 占满视口，不要滚动；可以是完整文档，也可以只是片段（插件会补 `<html>/<body>`）；
2. **不能依赖任何网络资源**（外链字体/图片/CDN 在开机那一刻都不可用）：图形用内联 SVG / CSS / canvas；
3. 想跟随真实进度就用 `window.dshBootAnim`：

   ```js
   dshBootAnim.progress()          // 0…1，来自 DSH 的插件加载进度
   dshBootAnim.on('progress', fn)  // 进度变化（同一个值不会重复触发）
   dshBootAnim.isReady()           // 应用是否已挂载
   dshBootAnim.on('ready', fn)
   dshBootAnim.reduced()           // 用户是否偏好减少动效
   dshBootAnim.on('visible', fn)   // 覆层是否仍可见（false = 正在淡出）
   ```

   拿不到桥接对象时（比如你单独打开文件）请降级成自播动画——内置模板都做了这个兜底；
4. 颜色/字体自备：开机阶段 DSH 的主题 CSS 还没生效，`--dsw-alias-*` 变量不可用；
5. 时长由插件统一控制（默认最短 1.2s、兜底 12s），模板自己循环播放即可，不用自己结束；
6. 建议写上 `<meta name="viewport">` 与 `prefers-reduced-motion` 媒体查询。

### 手动导入

不想用 AI 也行：设置页 → 「手动导入模板」→ 粘模板 JSON（`id` / `name` / `description` / `theme` / `document`）
或直接粘一整段 HTML → 「导入并启用」。`examples/` 里两个 JSON 就是可以直接粘的例子。

## 工作原理

### 注入行怎么进页面

插件通过官方注入表 `webserver/index-inject` 往启动页塞三行：一段 `<style>`、一个铺满全屏的
`<div id="dsh-boot-animation">`、一段运行时 `<script>`。运行时创建 iframe 播放当前模板。

| 承载 | 注入行怎么进页面 | 什么时候重新收集 |
|---|---|---|
| `dsh web` / 本机 HTTP | 宿主 `renderIndex` 把行直接拼进 `index.html` | 每次渲染 index（≈ 每次刷新） |
| 桌面 App（`dsh-app://`） | 前端 bootstrap 通过 IPC 拿到注入表后逐行应用 | **只在宿主进程启动时收集一次** |

桌面模式这条「只收集一次」是 DSH 自身的设计，所以运行时脚本还会做**一次同源核对**：
注入行里带着当前模板的修订号（`rev`），页面加载时向 `…/api/active?rev=…` 问一次
「现在生效的是不是这个」，不一致就把 iframe 热切换到新模板，并把最新时长/开关应用到正在播放的覆层上。

### 真实进度与退出条件

- **进度**：DSH 的启动视图会在 `[data-dsh-boot-spinner]` 上写 `--dsh-boot-arc: 72deg…288deg`；
  插件把它读出来换算成 0–100% 推给模板（`72deg` = 0%，`288deg` = 100%）；
- **退出**（任意一条先到）：应用挂载完成（原生启动视图消失）· 用户点击/按键跳过 ·
  到达兜底时长 · **原生启动界面出现报错文案**（这一条保证我们绝不挡住错误信息）；
- **兜底**：覆层平时 `pointer-events:none`，即使它异常停留，界面依然可点；淡出后把自己从 DOM 移除。

### 一次启动的时序

```text
页面加载
  ├─ 注入行应用：<style> + 覆层 <div> + 运行时脚本   ← web 模式：服务端已拼进 HTML
  │                                                  ← 桌面模式：IPC 拿到表后逐行应用
  ├─ 运行时：创建 iframe(srcdoc=模板) → 覆层出现
  ├─ DSH 原生启动视图出现 → 插件读它的 --dsh-boot-arc → 推给模板（真进度）
  ├─ 客户端插件加载完成 → React 挂载 → 原生启动视图消失
  └─ 覆层淡出并从 DOM 移除（此前可按 Esc/空格/点击立即跳过）
```

## 设置页

设置 → 外观 → **开机动画**：

- **开关**：启用/关闭开机动画（关闭需要重启一次 DSH）；
- **最短展示时长 / 兜底时长 / 允许跳过**；
- **模板画廊**：预览（独立文档循环播放）、应用、删除自定义模板；
- **用 AI 自定义**：① 输入框写下你想要的样子（提示词实时带上它）→ ② 复制提示词给 AI →
  ③ AI 存模板并给你预览；下面还有三条点一下就能填进输入框的示例；
- **手动导入模板**：粘 JSON 或整段 HTML。

预览用 `sandbox="allow-scripts"`（不透明源）跑：模板动画照常播放，但读不到设置页的任何数据。

## 生效时机

| 动作 | 什么时候看到 |
|---|---|
| 换模板 / 改时长 / 改是否可跳过 | **刷新页面**即可（桌面版也一样，靠运行时那次核对） |
| **刚装好插件后的第一次** | 需要**重启一次 DSH**：启动注入表是宿主启动时生成的 |
| 关闭开机动画 | 需要**重启一次 DSH**（关闭意味着连注入行都不再下发） |

## 数据与文件

```
$DSH_HOME/dsh-boot-animation/
├── state.json            # enabled / template / minDurationMs / maxDurationMs / skippable
├── templates/<id>.json   # 自定义模板（AI 生成或手动导入）
└── previews/<id>.html    # boot_animation_preview 导出的预览
```

部署默认值写在 profile 的插件行 config 里（`cordis.patch.yml`），用户级改动存在 `state.json`，
优先级：`state.json` > 行 config。目录不可写时自动退回内存（设置页会提示「状态目录不可写」），
插件绝不因为磁盘问题把 DSH 的启动流程带崩。

插件还提供同源 JSON 接口（供设置页使用，也可自己脚本化）：

```text
GET  /dsh-boot-animation-7f3a/api/state              设置 + 模板列表
GET  /dsh-boot-animation-7f3a/api/active?rev=…       当前生效模板（页面加载时核对用）
GET  /dsh-boot-animation-7f3a/api/preview?id=…       独立预览文档（text/html）
POST /dsh-boot-animation-7f3a/api/settings           改开关/模板/时长
POST /dsh-boot-animation-7f3a/api/save               存自定义模板
POST /dsh-boot-animation-7f3a/api/remove             删自定义模板
```

## 安全与隐私

- **模板就是网页代码**，它在**同源 iframe** 里执行，权限级别等同于一个已安装的 DSH 插件。
  所以：只用你自己（或你信任的 AI 会话）生成的模板；**来源不明的模板先预览再启用**；
- 设置页里的预览是沙箱化的（不透明源，只允许脚本）；「在新标签打开」会以普通页面打开同一份预览；
- **不联网、不收集数据**：动画不使用网络资源，设置与模板都只存在本机 `$DSH_HOME` 下；
  唯一的对外交互是你与 AI 的对话本身；
- 体积/性能：单个模板上限 **512 KiB**；默认最短展示 1.2s、兜底 12s，到点一定让位给界面。

## 环境要求与兼容性

| 项 | 要求 |
|---|---|
| DeepSeek Harness | 带 `webServer` 服务的 profile（桌面 App 与 `dsh web` 都满足） |
| Node | DSH 自带运行时即可（无额外依赖、无构建步骤） |
| 模块格式 | 纯 ESM，宿主半侧与浏览器半侧各一个入口 |
| 可选服务 | `tools`（没有它时插件照常工作，只是不注册 Agent 工具） |

宿主半侧刻意**不静态 import 任何 `@deepseek-ai/*` 包**：插件通常以 `link:` 方式装进 profile，
真实路径在工作区，而 DSH 的裸包名解析拦截层只覆盖 profile 内部的模块——一句静态 import
就会让整个 entry「failed to import」。需要宿主能力时走「可选动态导入 + 本地兜底」。

## 开发

```bash
npm test                  # 32 个测试（等价于 `node --test`，不带目录参数）
npm run check             # 全量语法检查
npm run check:docs        # README 链接 / 模板清单 / 测试数量自检
npm run check:all         # 上面三件事一起跑（CI 跑的就是它）
npm run preview           # 导出内置模板 + examples/ 的预览
```

也可以不用 npm，直接 `node tools/xxx.mjs`。CI 在 `.github/workflows/checks.yml`，
Node 20 / 22 / 24 各跑一遍；其中两项一致性测试需要本机装有 DSH（读它的 `app.asar`），
在 CI 上会自动 skip 而不是失败（可用 `DSH_ASAR` 指定安装路径）。

### 目录结构

```
DSH_WallPort/
├── index.js                 # 宿主半侧入口（Cordis 插件）：注入行 + 路由 + 工具
├── client.js                # 浏览器半侧：设置页（一个 settings.section）
├── cordis.patch.yml         # bundle 声明：往配置树插入插件行
├── src/
│   ├── shared/              # 常量与校验（两端共用）
│   └── host/
│       ├── runtime.js       # 注入到页面的运行时（覆层生命周期 / 桥接 / 预览模拟器）
│       ├── compose.js       # 模板 + 设置 → 注入行 / 预览文档
│       ├── service.js       # 状态 + 模板库 + 当前生效项
│       ├── store.js         # $DSH_HOME 持久化（原子写 + 内存兜底）
│       ├── api.js           # 设置页用的 HTTP 接口
│       ├── tools.js         # 6 个 Agent 工具
│       ├── define-tool.js   # 自带的工具定义器（不依赖宿主包）
│       └── templates/       # 7 个内置模板（每个是一段自包含 HTML）
├── docs/AI-自定义指南.md      # 给使用者的分步指南
├── examples/                # 示例模板 + 带注释的最小骨架
├── previews/                # 预生成的独立预览（可直接用浏览器打开）
├── .github/workflows/       # CI：语法检查 + 测试 + 文档自检
└── CHANGELOG.md
```

### 测试

| 文件 | 覆盖什么 |
|---|---|
| `test/conformance.test.mjs` | 从本机 `app.asar` 取出 DSH **自己的** `renderIndexInjections()`（宿主如何把注入行拼进 `index.html`）和 `hM()`（桌面前端如何应用注入表）来执行我们的行 —— DSH 升级后形状一变，测试立刻失败，而不是等用户看到黑屏 |
| `test/runtime.test.mjs` | 用最小 DOM 打桩真实跑覆层生命周期：应用挂载 / 启动报错 / 跳过 / 超时 / 模板热切换 / 宿主说已关闭 / 核对请求失败 |
| `test/entry.test.mjs` | 直接 import `index.js` 并用假 ctx 跑 `apply()`：注入行、HTTP 路由、6 个工具、非法配置兜底 |
| `test/client.test.mjs` | 在沙箱里按 `window.__ModuleLoader__.load()` 契约执行 `client.js`：模块面、`settings.section` 注册、设置页渲染、**输入框真的能打字**、提示词内容、文案 key 无遗漏 |
| `test/unit.test.mjs` | 模板校验、状态仓（含目录不可写兜底）、服务、HTTP 接口 |

### 加一个内置模板（三步）

1. 在 `src/host/templates/` 新建 `<id>.js`，导出 `{ id, name:{zh,en}, description:{zh,en}, theme, document }`，
   `document` 就是一段自包含 HTML（可以直接抄 `examples/minimal-template.html`）；
2. 在 `src/host/templates/index.js` 里 import 并加进 `BUILTIN_TEMPLATES`（数组顺序 = 设置页顺序）；
3. `node --test test/` → `node tools/preview.mjs --examples` → 刷新页面即可在画廊里看到。

## 常见问题

<details>
<summary><b>粘贴链接后安装失败</b></summary>

- **相对路径**会被直接拒绝（`pluginManager` 只收绝对路径）；
- 私有仓库要用 SSH 写法（`git@github.com:…`）并保证 profile 的 git 凭据可用；
- 报「连不上 GitHub / 超时」时：界面给的国内镜像只镜像 npm registry，
  不会镜像 GitHub 仓库本身——改用 npm 包名或 tarball 地址，或者先用 `git clone` 到本地再按绝对路径装；
- 装完记得**重启一次 DSH**，否则启动注入表里还没有本插件。
</details>

<details>
<summary><b>装完没反应 / 看不到动画</b></summary>

- 首次安装后**重启一次 DSH**：桌面模式的启动注入表是宿主启动时生成的，重启后才会包含本插件；
- 确认插件已启用：设置 → 插件 里「开机动画」是启用状态；也可以用
  `plugin_manager(action: "list_plugins")` 看 entry 的 `fiberPhase` 是否为 `active`。
</details>

<details>
<summary><b>换了模板但画面没变</b></summary>

先刷新页面。桌面模式下注入表是启动快照，插件靠页面加载时的一次同源核对来热切换——
如果这次核对请求失败（比如宿主正忙），页面会继续播旧模板，再刷新一次即可。
</details>

<details>
<summary><b>关闭动画后还在播</b></summary>

「关闭」意味着不再下发注入行，需要在**重启一次 DSH** 后生效。
</details>

<details>
<summary><b>AI 说找不到 boot_animation_* 工具</b></summary>

说明插件没在这个 profile 里激活：确认已安装并启用，然后重启 DSH。
工具注册是全局的（跟随插件行激活），任意会话都能用。
</details>

<details>
<summary><b>设置页里输入框打不了字</b></summary>

那是旧版本（当时那块只有一段只读提示词）。刷新页面拿到最新前端即可；
仓库里的 `test/client.test.mjs` 现在会真实模拟「打字 → 回显 → 进提示词」。
</details>

<details>
<summary><b>AI 生成的动画不好看 / 太吵</b></summary>

把意见说清楚让它改（「慢一点」「只留进度条」「换成深蓝」），或先切回 `minimal-fade` 这类安静的模板。
模板就是一段 HTML，你也可以在设置页导入自己改过的版本。
</details>

## 维护与发版

仓库地址：<https://github.com/cjian1/DSH_WallPort> —— 推上去之后，上面那条链接就是别人安装用的链接。

**改完东西怎么发**：

```bash
npm run check:all        # 语法 + 32 个测试 + 文档自检，全绿再提交
git add -A
git commit -m "feat: ..."
git push                 # CI（.github/workflows/checks.yml）会自动跑同一套检查
```

**发新版本**：改 `package.json` 的 `version` → 在 [CHANGELOG.md](CHANGELOG.md) 顶部加一条 →
提交推送。文档自检会核对「CHANGELOG 最新条目 == package.json 版本」，写漏了直接报错。
更新版本号后，从 Git 地址安装的人需要**卸载再装一次**（DSH 的插件不会自动升级）。

**可选：加一段录屏**。README 顶部没有放图片（避免出现挂掉的图）。
录一段开机动画的 GIF/MP4 放进 `docs/media/`，然后在标题下方加：

```md
![开机动画](docs/media/demo.gif)
```

**可选：发到 npm**。先去掉 `package.json` 里的 `"private": true`（它是防止误发布的），
包名 `dsh-boot-animation` 未被占用的话 `npm publish` 即可；之后别人能直接在
Plugins → Add plugin 里填包名，或用
`plugin_manager(action:"install_bundle", target:"dsh-boot-animation")`。

## English

**DSH_WallPort** replaces the DeepSeek Harness boot screen with an animation of your choice.

- **7 built-in templates** (DeepSeek Pulse, Terminal Boot, Warp Starfield, Code Rain, Orbital Particles,
  Minimal Glow, Ink Wash) — pick one in Settings → Appearance → **Boot animation** and refresh the page.
- **AI-generated animations**: 6 agent tools (`boot_animation_list / save / apply / preview / remove / settings`)
  let you say *"give me a cyber-neon boot animation"* in any session; the AI writes one self-contained
  HTML document, saves it as a template and exports an openable preview.
- **Real progress**: the overlay reads the progress DSH itself writes on `[data-dsh-boot-spinner]`
  (`--dsh-boot-arc`), so bars, star speed and rain density follow the actual plugin-loading progress.
- **Safe by construction**: the plugin never touches DSH's own boot DOM — it layers an overlay on top,
  fades out as soon as the app mounts, gets out of the way on boot errors, and stays `pointer-events:none`.

Install in one click: open **Plugins** in the DSH sidebar → **Add plugin** → paste
`https://github.com/<you>/DSH_WallPort` → **Install** → **Enable now**, then restart DSH once.
(The same field also takes `github:<you>/DSH_WallPort`, a `.tgz` URL, an absolute local path, or an npm package name.
The agent path is `plugin_manager(action: "install_bundle", target: "https://github.com/<you>/DSH_WallPort")`.)
A template is just one self-contained HTML file — see [`examples/minimal-template.html`](examples/minimal-template.html)
for an annotated skeleton, and [`docs/AI-自定义指南.md`](docs/AI-自定义指南.md) (Chinese) for the walkthrough.

Verified with 32 tests; two of them execute DSH's own injection-rendering code extracted from `app.asar`
(`renderIndexInjections()` for `dsh web`, `hM()` for the desktop shell).

## License

[MIT](./LICENSE)。

- 「深海脉冲」模板里的 DeepSeek 鲸鱼标志取自 DSH 自带的前端 favicon
  （`@deepseek-ai/dsh-web-frontend/dist/favicon.svg`），版权归 DeepSeek 所有，仅用于品牌标记；
- DeepSeek Harness 本身与本项目无隶属关系，本项目是一个第三方插件。
