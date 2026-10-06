/**
 * 共享常量：插件身份、路由前缀、覆层契约与各种上限。
 *
 * 这些值同时被宿主半侧（index.js / src/host/*）和浏览器半侧（client.js）读取，
 * 因此单独放一个不依赖任何 DSH 包的文件里，两端都能安全导入。
 */

/** 展示名：仓库、README、插件卡片等处统一用它。 */
export const DISPLAY_NAME = 'DSH_WallPort'

/**
 * 包名，同时是 Loader 行名与浏览器模块 id（__ModuleLoader__.load({ id })）。
 * 必须是全小写：npm 不接受大写包名，DSH 的 parseInstallSpec 也只认 [a-z0-9._~-]。
 */
export const PLUGIN_ID = 'dsh-wallport'

/** 注入到 <body> 里的开机覆层容器 id。 */
export const OVERLAY_ID = 'dsh-wallport'

/**
 * 插件自有 HTTP 路由前缀。
 * 带随机后缀是为了不和别的插件抢路径；桌面模式会把它转发给宿主进程。
 */
export const ROUTE_PREFIX = '/dsh-wallport-7f3a'

/** 设置页调用的 JSON API 前缀。 */
export const API_PREFIX = `${ROUTE_PREFIX}/api`

/** 状态文件版本号；结构变化时 +1，旧文件按默认值兜底。 */
export const STATE_VERSION = 1

/** 覆层元素的 data 属性，供 CSS / 测试 / 模板 JS 选中。 */
export const OVERLAY_ATTR = 'data-dsh-wallport'

/** 模板 id 规则：小写字母数字与连字符，2–48 位。 */
export const TEMPLATE_ID_PATTERN = /^[a-z0-9][a-z0-9-]{1,47}$/

/** 各类输入上限，防止 AI 生成超大文档把开机 HTML 撑爆。 */
export const LIMITS = {
  /** 单个模板 HTML 文档最大字节数（UTF-8）。 */
  documentBytes: 512 * 1024,
  /** 模板显示名的最大字符数。 */
  nameChars: 60,
  /** 模板描述的最大字符数。 */
  descriptionChars: 240,
  /** 自定义模板数量上限。 */
  customTemplates: 60,
  /** 预览接口返回文档的最大字节数。 */
  previewBytes: 640 * 1024,
}

/** 部署默认值；state.json 里的同名字段优先。 */
export const DEFAULTS = {
  enabled: true,
  template: 'deepseek-pulse',
  minDurationMs: 1200,
  maxDurationMs: 12000,
  skippable: true,
}

/** 时长可调范围（毫秒）。 */
export const DURATION_RANGE = { min: 0, max: 60000 }

/** 预览/开机文档里由宿主注入的桥接对象名（模板 JS 通过它拿到真实启动进度）。 */
export const BRIDGE_NAME = 'dshBootAnim'
