/**
 * 设置页 / 工具的 HTTP API。
 *
 * 走宿主 webServer 的前缀路由：web 模式就是同源请求；
 * 桌面模式下 dsh-app:// 协议会把未命中的路径连同 cookie 转发给宿主，同样可达。
 *
 * 路由：
 *   GET  {prefix}/api/state                     → 设置 + 模板列表快照
 *   GET  {prefix}/api/active?rev=<rev>          → 当前生效模板（页面加载时核对用）
 *   GET  {prefix}/api/preview?id=<tpl>          → 预览文档（text/html，强制沙箱）
 *   POST {prefix}/api/settings                  → 改开关/当前模板/时长
 *   POST {prefix}/api/save   { template: {...} }→ 新建或覆盖自定义模板
 *   POST {prefix}/api/remove { id }             → 删除自定义模板
 *   GET  {prefix}/health                        → 探活（测试用）
 *
 * 访问控制（模板是会在 DSH 页面里同源执行的代码，写接口必须挡住外站）：
 *   - 每个请求先过 `authorize(req)`：插件入口传进来的是 DSH 自己的 connection 服务
 *     （Host/Origin 栅栏 + 浏览器会话 cookie，与 DSH 内置路由同一套规则）；
 *     拿不到时退回 {@link sameOriginRejection}；
 *   - POST 只收 `content-type: application/json`：跨站页面发这种请求必须先过 CORS 预检，
 *     而这里从不应答预检，所以「表单 / no-cors fetch」那类简单请求伪造不了写操作。
 */

import { API_PREFIX, LIMITS, PLUGIN_ID, ROUTE_PREFIX } from '../shared/constants.js'
import { normalizeTemplate } from '../shared/validate.js'

const MAX_BODY_BYTES = LIMITS.documentBytes + 64 * 1024

/** 所有响应都带：不缓存、不嗅探类型。 */
const BASE_HEADERS = { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' }

/**
 * 预览文档永远在沙箱里跑（不透明源，只允许脚本）：设置页的 iframe 本来就带 sandbox，
 * 这个响应头让「在新标签打开」也一样——模板读不到 DSH 页面的任何东西。
 */
const PREVIEW_CSP = 'sandbox allow-scripts'

/** 请求被拒时的状态码文案。 */
const REJECTION_TEXT = { 401: 'unauthorized', 403: 'forbidden' }

/** 统一 JSON 回复。 */
function sendJson(res, status, value, headers = {}) {
  const body = `${JSON.stringify(value)}\n`
  res.writeHead(status, {
    ...BASE_HEADERS,
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    ...headers,
  })
  res.end(body)
}

/** 读一个请求头（Node 的 headers 对象键名是小写）。 */
function header(req, name) {
  const value = req.headers?.[name]
  return Array.isArray(value) ? value[0] : value
}

/**
 * 兜底的同源检查（profile 里没有 DSH connection 服务时用）：
 * 浏览器给跨站请求带 `sec-fetch-site: cross-site`，给跨源请求带别的 Origin；
 * 两者都没有（非浏览器客户端 / 桌面壳转发）时放行。
 * @returns 拒绝时的状态码，放行时 undefined。
 */
export function sameOriginRejection(req) {
  if (header(req, 'sec-fetch-site') === 'cross-site') return 403
  const origin = header(req, 'origin')
  if (origin === undefined) return undefined
  const host = header(req, 'host')
  try {
    return host !== undefined && new URL(origin).host === host ? undefined : 403
  } catch {
    return 403
  }
}

/** POST 只收 JSON（见文件头「访问控制」）。 */
function isJsonRequest(req) {
  const type = header(req, 'content-type')
  return typeof type === 'string' && type.split(';', 1)[0].trim().toLowerCase() === 'application/json'
}

/** 读取并解析请求体（带上限，避免超大 body 打爆内存）；必须是 JSON 对象。 */
async function readJsonBody(req) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > MAX_BODY_BYTES) throw new Error(`请求体过大（>${Math.round(MAX_BODY_BYTES / 1024)} KiB）`)
    chunks.push(chunk)
  }
  if (size === 0) return {}
  const text = Buffer.concat(chunks).toString('utf8')
  let body
  try {
    body = JSON.parse(text)
  } catch (error) {
    throw new Error(`请求体不是合法 JSON：${error.message}`)
  }
  if (body === null || typeof body !== 'object' || Array.isArray(body)) throw new Error('请求体必须是 JSON 对象')
  return body
}

/** 方法不对：405 + Allow。 */
function methodNotAllowed(res, allow) {
  sendJson(res, 405, { error: 'method not allowed' }, { allow })
}

/**
 * 建一个 handler 交给 webServer.register（handler 自己拥有整条响应）。
 * @param service - createBootAnimationService() 的返回值。
 * @param options.authorize - (req) => 拒绝状态码 | undefined；默认 {@link sameOriginRejection}。
 */
export function createApiHandler(service, { authorize = sameOriginRejection } = {}) {
  const readable = (req) => req.method === 'GET' || req.method === 'HEAD'

  return async function handle(req, res) {
    let url
    try {
      url = new URL(req.url ?? '/', 'http://localhost')
    } catch {
      sendJson(res, 400, { error: 'bad url' })
      return
    }
    const rejection = authorize(req)
    if (rejection !== undefined) {
      sendJson(res, rejection, { error: REJECTION_TEXT[rejection] ?? 'rejected' })
      return
    }
    const path = url.pathname
    try {
      if (path === `${ROUTE_PREFIX}/health`) {
        sendJson(res, 200, { ok: true, plugin: PLUGIN_ID })
        return
      }
      if (path === `${API_PREFIX}/state`) {
        if (!readable(req)) return methodNotAllowed(res, 'GET, HEAD')
        sendJson(res, 200, service.snapshot())
        return
      }
      if (path === `${API_PREFIX}/active`) {
        if (!readable(req)) return methodNotAllowed(res, 'GET, HEAD')
        const rev = url.searchParams.get('rev')
        sendJson(res, 200, service.activeDocument(rev === null ? undefined : rev))
        return
      }
      if (path === `${API_PREFIX}/preview`) {
        if (!readable(req)) return methodNotAllowed(res, 'GET, HEAD')
        const id = url.searchParams.get('id') ?? service.activeId()
        const loop = url.searchParams.get('loop') !== '0'
        const document = service.previewDocument(id, { loop })
        const bytes = Buffer.byteLength(document, 'utf8')
        if (bytes > LIMITS.previewBytes) {
          sendJson(res, 500, { error: '预览文档过大' })
          return
        }
        res.writeHead(200, {
          ...BASE_HEADERS,
          'content-type': 'text/html; charset=utf-8',
          'content-length': bytes,
          'content-security-policy': PREVIEW_CSP,
        })
        res.end(req.method === 'HEAD' ? undefined : document)
        return
      }
      if (path === `${API_PREFIX}/settings` || path === `${API_PREFIX}/save` || path === `${API_PREFIX}/remove`) {
        if (req.method !== 'POST') return methodNotAllowed(res, 'POST')
        if (!isJsonRequest(req)) {
          sendJson(res, 415, { error: 'content-type 必须是 application/json' })
          return
        }
        const body = await readJsonBody(req)
        if (path === `${API_PREFIX}/settings`) {
          sendJson(res, 200, { ok: true, settings: service.updateSettings(body) })
          return
        }
        if (path === `${API_PREFIX}/save`) {
          const input = body.template ?? body
          const template = normalizeTemplate(input, { requireDocument: true })
          // 设置页导入的模板默认记为「用户」来源，除非 JSON 里自己写明是 AI 生成的
          const saved = service.saveTemplate({ ...template, source: template.source ?? 'user' }, { activate: body.activate === true })
          sendJson(res, 200, { ok: true, id: saved.id, active: service.activeId() })
          return
        }
        const existed = service.removeTemplate(String(body.id ?? ''))
        sendJson(res, 200, { ok: true, existed, ...service.snapshot() })
        return
      }
      sendJson(res, 404, { error: 'not found' })
    } catch (error) {
      sendJson(res, 400, { error: error?.message ?? String(error) })
    }
  }
}
