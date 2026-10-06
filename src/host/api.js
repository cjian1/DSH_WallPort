/**
 * 设置页 / 工具的 HTTP API。
 *
 * 走宿主 webServer 的前缀路由：web 模式就是同源请求；
 * 桌面模式下 dsh-app:// 协议会把未命中的路径连同 cookie 转发给宿主，同样可达。
 *
 * 路由：
 *   GET  {prefix}/api/state                     → 设置 + 模板列表快照
 *   GET  {prefix}/api/preview?id=<tpl>          → 预览文档（text/html）
 *   POST {prefix}/api/settings                  → 改开关/当前模板/时长
 *   POST {prefix}/api/save   { template: {...} }→ 新建或覆盖自定义模板
 *   POST {prefix}/api/remove { id }             → 删除自定义模板
 *   GET  {prefix}/health                        → 探活（测试用）
 */

import { API_PREFIX, LIMITS, ROUTE_PREFIX } from '../shared/constants.js'
import { normalizeTemplate } from '../shared/validate.js'

const MAX_BODY_BYTES = LIMITS.documentBytes + 64 * 1024

/** 统一 JSON 回复。 */
function sendJson(res, status, value) {
  const body = `${JSON.stringify(value)}\n`
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(body),
  })
  res.end(body)
}

/** 读取并解析请求体（带上限，避免超大 body 打爆内存）。 */
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
  try {
    return JSON.parse(text)
  } catch (error) {
    throw new Error(`请求体不是合法 JSON：${error.message}`)
  }
}

/**
 * 建一个 handler 交给 webServer.register（handler 自己拥有整条响应）。
 * @param service - createBootAnimationService() 的返回值。
 */
export function createApiHandler(service) {
  return async function handle(req, res) {
    let url
    try {
      url = new URL(req.url ?? '/', 'http://localhost')
    } catch {
      sendJson(res, 400, { error: 'bad url' })
      return
    }
    const path = url.pathname
    try {
      if (path === `${ROUTE_PREFIX}/health`) {
        sendJson(res, 200, { ok: true, plugin: 'dsh-boot-animation' })
        return
      }
      if (path === `${API_PREFIX}/state`) {
        if (req.method !== 'GET' && req.method !== 'HEAD') {
          sendJson(res, 405, { error: 'method not allowed' })
          return
        }
        sendJson(res, 200, service.snapshot())
        return
      }
      if (path === `${API_PREFIX}/active`) {
        if (req.method !== 'GET' && req.method !== 'HEAD') {
          sendJson(res, 405, { error: 'method not allowed' })
          return
        }
        const rev = url.searchParams.get('rev')
        sendJson(res, 200, service.activeDocument(rev === null ? undefined : rev))
        return
      }
      if (path === `${API_PREFIX}/preview`) {
        if (req.method !== 'GET' && req.method !== 'HEAD') {
          sendJson(res, 405, { error: 'method not allowed' })
          return
        }
        const id = url.searchParams.get('id') ?? service.snapshot().active
        const loop = url.searchParams.get('loop') !== '0'
        const document = service.previewDocument(id, { loop })
        if (Buffer.byteLength(document, 'utf8') > LIMITS.previewBytes) {
          sendJson(res, 500, { error: '预览文档过大' })
          return
        }
        res.writeHead(200, {
          'content-type': 'text/html; charset=utf-8',
          'cache-control': 'no-store',
        })
        res.end(req.method === 'HEAD' ? undefined : document)
        return
      }
      if (path === `${API_PREFIX}/settings`) {
        if (req.method !== 'POST') {
          sendJson(res, 405, { error: 'method not allowed' })
          return
        }
        const body = await readJsonBody(req)
        const settings = service.updateSettings({
          ...(body.enabled === undefined ? {} : { enabled: body.enabled === true }),
          ...(body.template === undefined ? {} : { template: String(body.template) }),
          ...(body.minDurationMs === undefined ? {} : { minDurationMs: Number(body.minDurationMs) }),
          ...(body.maxDurationMs === undefined ? {} : { maxDurationMs: Number(body.maxDurationMs) }),
          ...(body.skippable === undefined ? {} : { skippable: body.skippable === true }),
        })
        sendJson(res, 200, { ok: true, settings })
        return
      }
      if (path === `${API_PREFIX}/save`) {
        if (req.method !== 'POST') {
          sendJson(res, 405, { error: 'method not allowed' })
          return
        }
        const body = await readJsonBody(req)
        const template = normalizeTemplate(body.template ?? body, { requireDocument: true })
        const saved = service.saveTemplate(template, { activate: body.activate === true })
        sendJson(res, 200, { ok: true, id: saved.id, active: service.snapshot().active })
        return
      }
      if (path === `${API_PREFIX}/remove`) {
        if (req.method !== 'POST') {
          sendJson(res, 405, { error: 'method not allowed' })
          return
        }
        const body = await readJsonBody(req)
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
