/**
 * 单元测试：校验、状态仓、服务、HTTP API。
 * 全部跑在临时目录里，不碰真实的 $DSH_HOME。
 */

import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { createApiHandler } from '../src/host/api.js'
import { composeInjectionRows, composePreviewDocument, injectBridge, overlayCss } from '../src/host/compose.js'
import { createBootAnimationService } from '../src/host/service.js'
import { LEGACY_STATE_DIR_NAME, STATE_DIR_NAME, createStore } from '../src/host/store.js'
import { BUILTIN_TEMPLATES } from '../src/host/templates/index.js'
import { API_PREFIX, DEFAULTS, LIMITS, ROUTE_PREFIX } from '../src/shared/constants.js'
import { asFullDocument, jsonForScript, normalizeTemplate, normalizeTemplateId } from '../src/shared/validate.js'

function tempDir() {
  return mkdtempSync(join(tmpdir(), 'dsh-wallport-test-'))
}

const sample = (id = 'my-boot') => ({
  id,
  name: { zh: '我的开机动画', en: 'My boot' },
  description: '测试用',
  document: '<!doctype html><html><head><title>t</title></head><body><p>hi</p></body></html>',
})

test('模板 id 规范化', () => {
  assert.equal(normalizeTemplateId('Aurora-Night'), 'aurora-night')
  assert.throws(() => normalizeTemplateId(''), /不能为空/)
  assert.throws(() => normalizeTemplateId('../evil'), /不合法/)
  assert.throws(() => normalizeTemplateId('-lead'), /不合法/)
  assert.throws(() => normalizeTemplateId('a'.repeat(60)), /不合法/)
})

test('模板校验：尺寸 / 主题 / 文档', () => {
  const ok = normalizeTemplate(sample())
  assert.equal(ok.id, 'my-boot')
  assert.equal(ok.theme, 'dark')

  const light = normalizeTemplate({ ...sample(), theme: 'light' })
  assert.equal(light.theme, 'light')

  assert.throws(() => normalizeTemplate({ ...sample(), document: '' }), /不能为空/)
  assert.throws(
    () => normalizeTemplate({ ...sample(), document: 'x'.repeat(LIMITS.documentBytes + 1) }),
    /过大/,
  )
  assert.throws(() => normalizeTemplate({ id: 'ok-id', name: 'x', document: 42 }), /必须是字符串/)
  assert.throws(() => normalizeTemplate({ id: 'ok-id', document: 'a' }), /name 不能为空/)
  assert.throws(() => normalizeTemplate({ id: 'ok-id', name: 'x'.repeat(LIMITS.nameChars + 1), document: 'a' }), /过长/)
})

test('片段补全成完整文档 / 脚本安全序列化', () => {
  const fragment = asFullDocument('<div class="x">hi</div>')
  assert.ok(fragment.startsWith('<!doctype html>'))
  assert.ok(fragment.includes('<div class="x">hi</div>'))
  const withBody = asFullDocument('<body><b>x</b></body>')
  assert.ok(withBody.includes('<html'))
  const full = '<!doctype html><html><body>x</body></html>'
  assert.equal(asFullDocument(full), full)

  assert.equal(jsonForScript('</script>'), '"\\u003c/script>"')
  assert.equal(jsonForScript({ a: 1 }), '{"a":1}')
})

test('桥接脚本插在模板脚本之前', () => {
  const template = '<!doctype html><html><head><title>x</title></head><body><script>1</script></body></html>'
  const out = injectBridge(template)
  assert.ok(out.includes('dshBootAnim'), '桥接对象缺失')
  assert.ok(out.indexOf('dshBootAnim') < out.indexOf('<body>'), '桥接没有插在 body 之前')

  const noHead = injectBridge('<p>hi</p>')
  assert.ok(noHead.includes('dshBootAnim'))
  assert.ok(noHead.includes('<body>'))
})

test('状态仓：默认值、落盘、增删改', async () => {
  const dir = tempDir()
  try {
    const store = await createStore({ dir })
    const initial = store.readSettings()
    assert.equal(initial.enabled, DEFAULTS.enabled)
    assert.equal(initial.template, DEFAULTS.template)

    store.writeSettings({ template: 'terminal-boot', minDurationMs: 999999, maxDurationMs: 10 })
    const again = await createStore({ dir })
    const persisted = again.readSettings()
    assert.equal(persisted.template, 'terminal-boot')
    assert.equal(persisted.minDurationMs, 60000, '超出范围应被夹紧')
    assert.ok(persisted.maxDurationMs >= persisted.minDurationMs, 'max 不能小于 min')

    const saved = again.saveTemplate(sample('my-boot'))
    assert.equal(saved.id, 'my-boot')
    assert.equal(again.getTemplate('my-boot').name.zh, '我的开机动画')
    assert.equal(again.listTemplates().length, 1)

    // 磁盘上确实有文件
    const reloaded = await createStore({ dir })
    assert.equal(reloaded.listTemplates().length, 1)

    assert.equal(reloaded.removeTemplate('my-boot'), true)
    assert.equal((await createStore({ dir })).listTemplates().length, 0)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('状态目录改名：旧目录（dsh-boot-animation）自动迁移，模板与设置不丢', async () => {
  const home = mkdtempSync(join(tmpdir(), 'dsh-wallport-home-'))
  try {
    // 造一份「旧版」状态目录
    const legacy = join(home, LEGACY_STATE_DIR_NAME)
    mkdirSync(join(legacy, 'templates'), { recursive: true })
    writeFileSync(
      join(legacy, 'state.json'),
      JSON.stringify({ version: 1, enabled: true, template: 'legacy-boot', minDurationMs: 800, maxDurationMs: 5000, skippable: false }),
    )
    writeFileSync(
      join(legacy, 'templates', 'legacy-boot.json'),
      JSON.stringify({ id: 'legacy-boot', name: '旧模板', document: '<!doctype html><html><body>旧</body></html>' }),
    )

    const store = await createStore({ home })
    assert.equal(store.migratedFrom, legacy, '应报告迁移来源')
    assert.equal(store.baseDir, join(home, STATE_DIR_NAME))
    assert.ok(existsSync(join(home, STATE_DIR_NAME, 'state.json')), '新目录应有 state.json')
    // 设置与模板都搬过来了
    const settings = store.readSettings()
    assert.equal(settings.template, 'legacy-boot')
    assert.equal(settings.skippable, false)
    assert.equal(settings.minDurationMs, 800)
    assert.equal(store.getTemplate('legacy-boot').name, '旧模板')
    // 是拷贝不是移动：旧目录原样还在
    assert.ok(existsSync(join(legacy, 'state.json')), '旧目录应保留')
    assert.ok(existsSync(join(legacy, 'templates', 'legacy-boot.json')))

    // 第二次启动不再重复迁移，且读到的是已迁移的内容
    const again = await createStore({ home })
    assert.equal(again.migratedFrom, undefined)
    assert.equal(again.readSettings().template, 'legacy-boot')
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test('状态仓：目录不可写时退回内存而不是崩掉', async () => {
  const dir = tempDir()
  try {
    // 用一个「文件」当目录，mkdir 必然失败
    const blocked = join(dir, 'blocked')
    writeFileSync(blocked, 'not a directory')
    const store = await createStore({ dir: blocked })
    assert.doesNotThrow(() => store.writeSettings({ template: 'orbit' }))
    assert.equal(store.readSettings().template, 'orbit', '内存兜底应生效')
    assert.equal(store.degraded, true)
    assert.doesNotThrow(() => store.saveTemplate(sample('mem-boot')))
    assert.equal(store.getTemplate('mem-boot').id, 'mem-boot')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('服务：快照 / 生效模板 / 删除保护', async () => {
  const dir = tempDir()
  try {
    const service = await createBootAnimationService({ dir })
    const snapshot = service.snapshot()
    assert.equal(snapshot.templates.length, BUILTIN_TEMPLATES.length)
    assert.ok(snapshot.templates.every((template) => template.builtin))
    assert.equal(snapshot.active, DEFAULTS.template)

    // 配置指向不存在的模板 → 退回第一个内置模板
    service.store.writeSettings({ template: 'does-not-exist' })
    assert.equal(service.activeTemplate().id, BUILTIN_TEMPLATES[0].id)

    // 保存自定义并启用
    const saved = service.saveTemplate(sample('custom-one'), { activate: true })
    assert.equal(saved.id, 'custom-one')
    assert.equal(service.snapshot().active, 'custom-one')
    assert.equal(service.snapshot().templates.length, BUILTIN_TEMPLATES.length + 1)

    // 关闭后不注入
    service.updateSettings({ enabled: false })
    assert.deepEqual(service.injectionRows(), [])
    service.updateSettings({ enabled: true })
    assert.equal(service.injectionRows().length, 3)

    // 内置模板不可删；删掉生效中的自定义模板会退回默认
    assert.throws(() => service.removeTemplate('deepseek-pulse'), /内置模板不可删除/)
    assert.equal(service.removeTemplate('custom-one'), true)
    assert.equal(service.snapshot().active, BUILTIN_TEMPLATES[0].id)

    assert.throws(() => service.previewDocument('nope'), /模板不存在/)
    assert.throws(() => service.updateSettings({ template: 'nope' }), /模板不存在/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('注入行形状：style / html / script，且设置生效', () => {
  const template = BUILTIN_TEMPLATES[0]
  const rows = composeInjectionRows({
    template,
    settings: { ...DEFAULTS, minDurationMs: 1500, maxDurationMs: 9000, skippable: false },
  })
  assert.equal(rows.length, 3)
  assert.equal(rows[0].kind, 'style')
  assert.equal(rows[1].kind, 'html')
  assert.equal(rows[1].placement, 'body')
  assert.equal(rows[2].kind, 'script')
  assert.ok(rows[1].html.includes('id="dsh-wallport"'))
  assert.ok(rows[2].text.includes('9000'), '运行时脚本应带上 maxDurationMs')
  assert.ok(rows[2].text.includes('"skippable":false'), '运行时脚本应带上 skippable')
  assert.ok(overlayCss({ theme: 'light' }).includes('#f7f4ec'))
  assert.ok(!rows[2].text.includes('</script'), '脚本里不能出现裸的 </script>')
})

test('预览文档可独立播放（每个内置模板）', () => {
  for (const template of BUILTIN_TEMPLATES) {
    const document = composePreviewDocument({ template, loop: true })
    assert.ok(document.includes('dshBootAnim'), `${template.id} 缺少桥接`)
    assert.ok(document.includes('requestAnimationFrame'), `${template.id} 缺少模拟器`)
    assert.ok(document.length > 500, `${template.id} 预览过短`)
  }
})

/** 构造一个最小的 req/res 组合来跑 API handler。 */
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

test('activeDocument：rev 一致就不重复下发文档', async () => {
  const dir = tempDir()
  try {
    const service = await createBootAnimationService({ dir })
    const first = service.activeDocument()
    assert.equal(first.changed, true, '没有快照时必须返回文档')
    assert.ok(first.document.includes('dshBootAnim'))
    assert.equal(first.id, DEFAULTS.template)

    const same = service.activeDocument(first.rev)
    assert.equal(same.changed, false)
    assert.equal(same.document, undefined, 'rev 相同就不该再传文档')
    assert.equal(same.rev, first.rev)
    assert.equal(same.settings.enabled, true)

    // 切换模板后 rev 必须变，并且带回新文档
    service.updateSettings({ template: 'orbit' })
    const after = service.activeDocument(first.rev)
    assert.equal(after.changed, true)
    assert.equal(after.id, 'orbit')
    assert.notEqual(after.rev, first.rev)
    assert.ok(after.document.includes('dshBootAnim'))

    // 关闭动画时也如实告诉页面
    service.updateSettings({ enabled: false })
    const off = service.activeDocument(after.rev)
    assert.equal(off.enabled, false)
    assert.equal(off.settings.enabled, false)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('HTTP API：state / settings / save / remove / preview / 404', async () => {
  const dir = tempDir()
  try {
    const service = await createBootAnimationService({ dir })
    const handler = createApiHandler(service)

    const health = await callApi(handler, { path: `${ROUTE_PREFIX}/health` })
    assert.equal(health.status, 200)
    assert.equal(JSON.parse(health.payload).ok, true)

    const state = await callApi(handler, { path: `${API_PREFIX}/state` })
    assert.equal(state.status, 200)
    const parsed = JSON.parse(state.payload)
    assert.equal(parsed.templates.length, BUILTIN_TEMPLATES.length)
    assert.ok(parsed.baseDir.startsWith(dir))

    const switched = await callApi(handler, {
      method: 'POST',
      path: `${API_PREFIX}/settings`,
      body: { template: 'starfield', skippable: false },
    })
    assert.equal(switched.status, 200)
    assert.equal(JSON.parse(switched.payload).settings.template, 'starfield')
    assert.equal(JSON.parse(switched.payload).settings.skippable, false)

    const badSwitch = await callApi(handler, { method: 'POST', path: `${API_PREFIX}/settings`, body: { template: 'nope' } })
    assert.equal(badSwitch.status, 400)

    const saved = await callApi(handler, {
      method: 'POST',
      path: `${API_PREFIX}/save`,
      body: { template: sample('api-boot'), activate: true },
    })
    assert.equal(saved.status, 200)
    assert.equal(JSON.parse(saved.payload).id, 'api-boot')
    assert.equal(JSON.parse(saved.payload).active, 'api-boot')

    const badSave = await callApi(handler, { method: 'POST', path: `${API_PREFIX}/save`, body: { template: { id: 'x' } } })
    assert.equal(badSave.status, 400)
    assert.ok(JSON.parse(badSave.payload).error.length > 0)

    const activeFresh = await callApi(handler, { path: `${API_PREFIX}/active?rev=stale-rev` })
    assert.equal(activeFresh.status, 200)
    const activePayload = JSON.parse(activeFresh.payload)
    assert.equal(activePayload.changed, true)
    assert.equal(activePayload.id, 'api-boot')
    assert.ok(activePayload.document.includes('dshBootAnim'))

    const activeSame = await callApi(handler, { path: `${API_PREFIX}/active?rev=${encodeURIComponent(activePayload.rev)}` })
    assert.equal(activeSame.status, 200)
    assert.equal(JSON.parse(activeSame.payload).changed, false)

    const activeMethod = await callApi(handler, { method: 'POST', path: `${API_PREFIX}/active` })
    assert.equal(activeMethod.status, 405)

    const preview = await callApi(handler, { path: `${API_PREFIX}/preview?id=api-boot` })
    assert.equal(preview.status, 200)
    assert.ok(preview.headers['content-type'].startsWith('text/html'))
    assert.ok(preview.payload.includes('dshBootAnim'))

    const unknownPreview = await callApi(handler, { path: `${API_PREFIX}/preview?id=missing` })
    assert.equal(unknownPreview.status, 400)

    const removed = await callApi(handler, { method: 'POST', path: `${API_PREFIX}/remove`, body: { id: 'api-boot' } })
    assert.equal(removed.status, 200)
    assert.equal(JSON.parse(removed.payload).existed, true)

    const methodNotAllowed = await callApi(handler, { method: 'DELETE', path: `${API_PREFIX}/state` })
    assert.equal(methodNotAllowed.status, 405)

    const notFound = await callApi(handler, { path: `${ROUTE_PREFIX}/nope` })
    assert.equal(notFound.status, 404)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
