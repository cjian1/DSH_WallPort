/**
 * 插件入口的冒烟测试：直接 import index.js 并用假 ctx 跑一遍 apply()。
 *
 * 这个测试存在的理由很具体：插件是以 `link:` 方式装进 profile 的，真实路径在工作区，
 * 不在 DSH 的裸包名解析拦截层里——任何一句静态 `import '@deepseek-ai/...'`
 * 都会让 entry 直接「failed to import」，而组件测试是发现不了的。
 * 所以这里 import 真正的入口、真的挂一次插件、真的取一次注入行。
 */

import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { API_PREFIX, ROUTE_PREFIX } from '../src/shared/constants.js'

/** 最小 Cordis 上下文替身：只实现插件真正用到的那几个成员。 */
function fakeContext() {
  const listeners = new Map()
  const registered = []
  const routes = []
  const logs = []
  const ctx = {
    baseUrl: 'file:///tmp/profile/',
    logger: {
      info: (message) => logs.push(['info', String(message)]),
      warn: (message) => logs.push(['warn', String(message)]),
      error: (message) => logs.push(['error', String(message)]),
    },
    on(event, listener) {
      listeners.set(event, listener)
      return () => listeners.delete(event)
    },
    effect(callback) {
      const disposer = callback()
      return () => disposer?.()
    },
    inject(deps, callback) {
      if (Array.isArray(deps) && deps.includes('tools') && ctx.tools !== undefined) callback(ctx)
    },
    get() {
      return undefined
    },
    webServer: {
      register(route) {
        routes.push(route)
        return () => {}
      },
    },
    tools: {
      register(tool) {
        registered.push(tool)
      },
    },
    emit(event, payload) {
      listeners.get(event)?.(payload)
    },
    logs,
    registered,
    routes,
  }
  return ctx
}

function callApi(handler, { method = 'GET', path, body }) {
  const chunks = body === undefined ? [] : [Buffer.from(JSON.stringify(body))]
  const req = {
    method,
    url: path,
    async *[Symbol.asyncIterator]() {
      for (const chunk of chunks) yield chunk
    },
  }
  const res = {
    status: 0,
    headers: {},
    payload: undefined,
    writeHead(status, headers) {
      this.status = status
      this.headers = headers ?? {}
    },
    end(payload) {
      this.payload = payload
    },
  }
  return handler(req, res).then(() => res)
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

test('入口 import + apply：注入行、路由、工具、配置兜底', async () => {
  const home = mkdtempSync(join(tmpdir(), 'dsh-wallport-entry-'))
  const previousHome = process.env.DSH_HOME
  process.env.DSH_HOME = home
  try {
    const module = await import('../index.js')
    assert.equal(typeof module.apply, 'function', 'index.js 必须导出 apply')
    assert.equal(module.name, 'dsh-wallport')
    assert.deepEqual(module.inject, ['webServer'])

    const ctx = fakeContext()
    module.apply(ctx, {
      enabled: true,
      template: 'orbit',
      minDurationMs: 800,
      maxDurationMs: 6000,
      skippable: false,
    })

    // 路由立刻注册（handler 内再等 service 就绪）
    assert.equal(ctx.routes.length, 1)
    assert.equal(ctx.routes[0].kind, 'prefix')
    assert.equal(ctx.routes[0].path, ROUTE_PREFIX)

    // 服务是异步初始化的：轮询注入行直到就绪
    let rows = []
    for (let attempt = 0; attempt < 60 && rows.length === 0; attempt += 1) {
      await sleep(25)
      const table = []
      ctx.emit('webserver/index-inject', table)
      rows = table
    }
    assert.equal(rows.length, 3, '就绪后应注入 style/html/script 三行')
    assert.equal(rows[0].kind, 'style')
    assert.equal(rows[1].kind, 'html')
    assert.equal(rows[2].kind, 'script')
    assert.ok(rows[1].html.includes('id="dsh-wallport"'))
    assert.ok(rows[2].text.includes('"maxDurationMs":6000'), '运行时脚本应带上 config 里的兜底时长')
    assert.ok(rows[2].text.includes('"skippable":false'), '运行时脚本应带上 config 里的 skippable')

    // 工具注册（6 个，且 parameters 已是 JSON Schema）
    assert.equal(ctx.registered.length, 6)
    assert.deepEqual(
      ctx.registered.map((tool) => tool.name).sort(),
      [
        'boot_animation_apply',
        'boot_animation_list',
        'boot_animation_preview',
        'boot_animation_remove',
        'boot_animation_save',
        'boot_animation_settings',
      ],
    )
    for (const tool of ctx.registered) {
      assert.equal(tool.parameters.type, 'object', `${tool.name} 的 parameters 必须是 JSON Schema`)
      assert.equal(typeof tool.execute, 'function')
      assert.equal(typeof tool.output.render, 'function')
    }

    // HTTP 路由通过插件的 API handler 正常应答
    const state = await callApi(ctx.routes[0].handler, { path: `${API_PREFIX}/state` })
    assert.equal(state.status, 200)
    const parsed = JSON.parse(state.payload)
    assert.ok(parsed.templates.length >= 7, '内置模板应不少于 7 个')

    // 工具真的能改状态：切到 starfield 并关闭动画
    const applyTool = ctx.registered.find((tool) => tool.name === 'boot_animation_apply')
    const applied = await applyTool.execute({ id: 'starfield', enabled: false }, {})
    assert.equal(applied.active, 'starfield')
    assert.equal(applied.enabled, false)

    // 关闭后不再注入
    const afterOff = []
    ctx.emit('webserver/index-inject', afterOff)
    assert.deepEqual(afterOff, [], '关闭后不应再注入任何行')

    // 非法配置只影响自己：回落到默认值并留下警告（换一个干净的 home，避免读到上面的状态）
    const home2 = mkdtempSync(join(tmpdir(), 'dsh-wallport-entry2-'))
    process.env.DSH_HOME = home2
    const ctx2 = fakeContext()
    module.apply(ctx2, { enabled: 'yes', minDurationMs: -5, maxDurationMs: 999999, template: 42 })
    const defaultsRows = []
    for (let attempt = 0; attempt < 60 && defaultsRows.length === 0; attempt += 1) {
      await sleep(25)
      const table = []
      ctx2.emit('webserver/index-inject', table)
      defaultsRows.push(...table)
    }
    assert.equal(defaultsRows.length, 3)
    assert.ok(
      ctx2.logs.some(([level, message]) => level === 'warn' && message.includes('config.enabled')),
      '非法 enabled 应产生警告',
    )
    assert.ok(defaultsRows[2].text.includes('"minDurationMs":1200'), '非法时长应回落默认值')
    rmSync(home2, { recursive: true, force: true })
  } finally {
    if (previousHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previousHome
    rmSync(home, { recursive: true, force: true })
  }
})
