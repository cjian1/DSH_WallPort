/**
 * 一致性测试：用「真 DSH 里的那段渲染代码」来验证我们产出的注入行。
 *
 * 两条路径都要覆盖，因为同一个插件在两种承载下走的是不同代码：
 *   A. web 模式（dsh web / 本机 HTTP）：宿主用
 *      @deepseek-ai/dsh-host-webserver 的 renderIndexInjections 把行拼进 index.html；
 *   B. 桌面模式（dsh-app:// 承载）：前端 bootstrap 用 IPC 拿到同一张表后，
 *      由 dsh-web-frontend 里的 hM() 解释执行。
 *
 * 两个函数都直接从 app.asar 里取源码来执行，而不是照抄一份，
 * 这样 DSH 升级后测试会立刻告诉我们注入行是否还对得上。
 */

import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import test from 'node:test'

import { composeInjectionRows, composePreviewDocument } from '../src/host/compose.js'
import { DEFAULTS } from '../src/shared/constants.js'
import { BUILTIN_TEMPLATES } from '../src/host/templates/index.js'
import { defaultAsarPath, hasEntry, readEntry } from '../tools/asar.mjs'

const asar = defaultAsarPath()
const webserverPath = '/dsh/node_modules/@deepseek-ai/dsh-host-webserver/lib/index.js'
const frontendPath = '/dsh/node_modules/@deepseek-ai/dsh-web-frontend/dist/assets/index-5SrrfWpU.js'
const indexPath = '/dsh/node_modules/@deepseek-ai/dsh-web-frontend/dist/index.html'

const available =
  existsSync(asar) &&
  hasEntry(asar, webserverPath) &&
  hasEntry(asar, indexPath)

/** 从宿主 webServer 源码里切出注入渲染区并求值（该区不含 import）。 */
function loadShippedRenderer() {
  const source = readEntry(asar, webserverPath)
  const start = source.indexOf('//#region lib/types/injections.js')
  const end = source.indexOf('//#endregion', start)
  assert.ok(start >= 0 && end > start, '在 dsh-host-webserver 里找不到注入渲染区')
  const region = source.slice(start, end)
  const factory = new Function(`${region}\nreturn { renderIndexInjections, renderRow }`)
  return factory()
}

/**
 * 从桌面前端 bundle 里切出 hM()（应用注入表的解释器）并求值。
 * 真代码引用全局 document，这里把它作为参数注入，避免动全局状态。
 */
function loadDesktopApplier(document) {
  const source = readEntry(asar, frontendPath)
  const start = source.indexOf('async function hM(')
  const end = source.indexOf('const fo=globalThis.dshDesktopBoot', start)
  assert.ok(start >= 0 && end > start, '在 dsh-web-frontend 里找不到注入解释器 hM()')
  const body = source.slice(start, end).trim()
  assert.ok(body.endsWith('}'), 'hM() 源码切片不完整')
  return new Function('document', `return ${body}`)(document)
}

/** 极简 DOM 打桩，够 hM() 用即可。 */
function makeDom() {
  const makeElement = (tag) => ({
    tag,
    textContent: '',
    src: '',
    children: [],
    append(child) {
      this.children.push(child)
    },
    insertAdjacentHTML(position, html) {
      this.html = `${this.html ?? ''}${html}`
      this.position = position
    },
  })
  const head = makeElement('head')
  const body = makeElement('body')
  const document = {
    head,
    body,
    createElement: (tag) => makeElement(tag),
  }
  return { document, head, body }
}

test('shipped web renderer: 注入行渲染进 index.html', { skip: !available }, () => {
  const { renderIndexInjections } = loadShippedRenderer()
  const indexHtml = readEntry(asar, indexPath)
  for (const template of BUILTIN_TEMPLATES) {
    const rows = composeInjectionRows({
      template,
      settings: { ...DEFAULTS, minDurationMs: 1000, maxDurationMs: 8000 },
    })
    const html = renderIndexInjections(indexHtml, rows)

    assert.ok(html.includes('<div id="dsh-boot-animation"'), `${template.id}: 覆层容器没有注入`)
    assert.ok(html.includes('dshba-frame'), `${template.id}: 覆层样式没有注入`)
    assert.ok(html.includes('dshBootAnim'), `${template.id}: 运行时脚本没有注入`)
    assert.ok(html.includes('__DSH_BOOT_READY__'), `${template.id}: 启动就绪 tail 丢失`)

    // 行文本里不能出现裸的 </script（否则会把宿主 <script> 提前闭合）
    const scriptCount = (html.match(/<\/script>/g) ?? []).length
    const openCount = (html.match(/<script/g) ?? []).length
    assert.equal(scriptCount, openCount, `${template.id}: script 标签数量不匹配（注入内容里出现了裸 </script）`)

    // 覆层必须出现在 </body> 之前
    assert.ok(html.indexOf('<div id="dsh-boot-animation"') < html.lastIndexOf('</body>'), `${template.id}: 覆层位置异常`)
  }
})

test('shipped desktop interpreter: 三种注入行都能被应用', { skip: !available || !hasEntry(asar, frontendPath) }, async () => {
  const { document, head, body } = makeDom()
  const applyInjections = loadDesktopApplier(document)

  for (const template of BUILTIN_TEMPLATES) {
    const rows = composeInjectionRows({
      template,
      settings: { ...DEFAULTS, minDurationMs: 1000, maxDurationMs: 8000 },
    })
    head.children.length = 0
    body.children.length = 0
    delete body.html
    await applyInjections(rows, () => Promise.resolve())

    assert.equal(head.children.filter((node) => node.tag === 'style').length, 1, `${template.id}: style 行没有落进 head`)
    assert.equal(body.children.filter((node) => node.tag === 'script').length, 1, `${template.id}: script 行没有落进 body`)
    assert.ok(String(body.html ?? '').includes('<div id="dsh-boot-animation"'), `${template.id}: html 行没有落进 body`)
  }
})

test('预览文档：模板 + 桥接 + 模拟器齐全', () => {
  for (const template of BUILTIN_TEMPLATES) {
    const preview = composePreviewDocument({ template })
    assert.ok(preview.includes('<!doctype html') || preview.includes('<!DOCTYPE html'), `${template.id}: 预览缺少 doctype`)
    assert.ok(preview.includes('window.dshBootAnim'), `${template.id}: 预览缺少桥接对象`)
    assert.ok(preview.includes('bootPreviewSimulator') || preview.includes('requestAnimationFrame'), `${template.id}: 预览缺少模拟器`)
    assert.ok(preview.includes(`<title>`), `${template.id}: 预览缺少 title`)
    // 桥接必须在模板自己的脚本之前
    const bridgeAt = preview.indexOf('dshBootAnim')
    const bodyAt = preview.indexOf('<body')
    assert.ok(bridgeAt > 0 && bridgeAt < bodyAt, `${template.id}: 桥接脚本没有插在模板之前`)
  }
})
