/**
 * dsh-wallport —— 宿主半侧入口（Cordis 插件）
 *
 * 职责：
 *   1. 把「当前开机动画」编译成 DSH 启动页面的注入行
 *      （挂 webserver/index-inject；web 模式由服务端拼进 index.html，
 *        桌面模式由前端 bootstrap 通过 IPC 拿到同一张表后再应用）；
 *   2. 注册设置页/工具用的 HTTP 路由（同源，web 与桌面两种承载都可达）；
 *   3. 注册 6 个 Agent 工具，让「用 AI 自定义开机动画」可以真的落地；
 *   4. 维护状态：$DSH_HOME/dsh-wallport/{state.json,templates/}。
 *
 * 与 DSH 原生启动画面的关系：
 *   我们不改 DSH 的启动 DOM（`[data-dsh-boot]`），只是在最上面盖一层自己的动画，
 *   并读取它在 `[data-dsh-boot-spinner]` 上写的 `--dsh-boot-arc` 作为真实进度。
 *   应用挂载（启动视图消失）后覆层淡出；启动失败文案出现时立刻让路。
 */

import { DEFAULTS, DISPLAY_NAME, DURATION_RANGE, ROUTE_PREFIX } from './src/shared/constants.js'
import { createApiHandler } from './src/host/api.js'
import { createBootAnimationService } from './src/host/service.js'
import { registerTools } from './src/host/tools.js'

/** Loader 行身份。 */
export const name = 'dsh-wallport'

/**
 * 只有 webServer 是硬依赖（没有它就没有启动页面可注入）；
 * tools 走 ctx.inject 可选注入，profile 里没有工具集时插件依然可用。
 */
export const inject = ['webServer']

/**
 * 行配置 → 生效默认值。
 *
 * 这里不用 @deepseek-ai/schemastery 声明 Config：插件以 `link:` 方式装进 profile 时，
 * 它的真实路径（工作区）不在 DSH 的裸包名解析拦截层里，静态 import 宿主包会直接
 * 让整个 entry「failed to import」。开机动画这种小插件不值得为此换安装方式，
 * 于是改成自己校验：非法值只影响这一行，并在日志里说清楚。
 */
function normalizeConfig(config, logger) {
  const raw = config !== null && typeof config === 'object' ? config : {}
  const number = (value, fallback, field) => {
    if (value === undefined) return fallback
    const n = Number(value)
    if (!Number.isFinite(n) || n < DURATION_RANGE.min || n > DURATION_RANGE.max) {
      logger?.warn?.(`[dsh-wallport] config.${field}=${JSON.stringify(value)} 非法，改用 ${fallback}`)
      return fallback
    }
    return Math.round(n)
  }
  const bool = (value, fallback, field) => {
    if (value === undefined) return fallback
    if (typeof value !== 'boolean') {
      logger?.warn?.(`[dsh-wallport] config.${field}=${JSON.stringify(value)} 非布尔值，改用 ${fallback}`)
      return fallback
    }
    return value
  }
  const settings = {
    enabled: bool(raw.enabled, DEFAULTS.enabled, 'enabled'),
    template: typeof raw.template === 'string' && raw.template.trim() !== '' ? raw.template.trim() : DEFAULTS.template,
    minDurationMs: number(raw.minDurationMs, DEFAULTS.minDurationMs, 'minDurationMs'),
    maxDurationMs: number(raw.maxDurationMs, DEFAULTS.maxDurationMs, 'maxDurationMs'),
    skippable: bool(raw.skippable, DEFAULTS.skippable, 'skippable'),
  }
  if (settings.maxDurationMs < settings.minDurationMs) settings.maxDurationMs = settings.minDurationMs
  return settings
}

/**
 * 挂载插件。
 * @param ctx - 带 webServer 的宿主上下文。
 * @param config - 行配置（部署默认值）。
 */
export function apply(ctx, config) {
  const defaults = normalizeConfig(config, ctx.logger)
  /** 服务与 API handler 都是异步就绪的，先占位，注入行/路由每次调用时再取。 */
  const ref = { service: undefined, api: undefined }
  const ready = createBootAnimationService({
    defaults,
    logger: ctx.logger,
    // 宿主在启动时 provide 了 dshHomePath；拿不到就让 store 走 $DSH_HOME/~/.dsh 兜底。
    home: typeof ctx.get === 'function' ? ctx.get('dshHomePath') : undefined,
  })

  // 1) 启动页面注入：renderIndex 每次都会 emit，所以拿到的永远是当前设置。
  ctx.effect(
    () =>
      ctx.on('webserver/index-inject', (table) => {
        if (!Array.isArray(table) || ref.service === undefined) return
        table.push(...ref.service.injectionRows())
      }),
    'dsh-wallport: index injection',
  )

  // 2) HTTP 路由：设置页读写状态、预览文档。
  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: 'prefix',
        path: ROUTE_PREFIX,
        handler: async (req, res) => {
          if (ref.api === undefined) {
            res.writeHead(503, { 'content-type': 'application/json; charset=utf-8' })
            res.end('{"error":"dsh-wallport 正在初始化"}\n')
            return
          }
          await ref.api(req, res)
        },
      }),
    'dsh-wallport: http route',
  )

  ready
    .then((service) => {
      ref.service = service
      ref.api = createApiHandler(service)
      const snapshot = service.snapshot()
      ctx.logger?.info?.(
        `[dsh-wallport] ${DISPLAY_NAME} 就绪：模板 ${snapshot.templates.length} 个，当前「${snapshot.active}」，` +
          `${snapshot.enabled ? '已启用' : '已关闭'}，状态目录 ${service.store.baseDir}`,
      )

      // 3) Agent 工具（可选依赖：profile 没有 tools 服务时自动跳过）。
      ctx.inject(['tools'], (toolCtx) => {
        toolCtx.effect(
          () => {
            let disposed = false
            try {
              const count = registerTools(toolCtx, service)
              if (disposed) return () => {}
              toolCtx.logger?.info?.(`[dsh-wallport] 工具注册完成：${count} 个`)
            } catch (error) {
              toolCtx.logger?.warn?.(`[dsh-wallport] 工具注册失败：${error?.message ?? error}`)
            }
            return () => {
              disposed = true
            }
          },
          'dsh-wallport: agent tools',
        )
      })
    })
    .catch((error) => {
      ctx.logger?.error?.(`[dsh-wallport] 初始化失败：${error?.stack ?? error}`)
    })
}
