/**
 * 一致性测试：用「真 DSH 里的那段代码」来验证我们的假设。
 *
 * 注入行在两种承载下走的是不同代码，两条路径都要覆盖：
 *   A. web 模式（dsh web / 本机 HTTP）：宿主用
 *      @deepseek-ai/dsh-host-webserver 的 renderIndexInjections 把行拼进 index.html；
 *   B. 桌面模式（dsh-app:// 承载）：前端 bootstrap 用 IPC 拿到同一张表后，
 *      由 dsh-web-frontend 里的注入表解释器逐行执行。
 * 另外钉住覆层运行时依赖的启动视图契约（data-dsh-boot / 进度弧 / 失败文案 / 挂载交接），
 * 以及 HTTP 路由鉴权用的 connection.requestRejection()。
 *
 * 代码都直接从 app.asar 里取来执行或比对，而不是照抄一份。前端 bundle 的文件名带内容哈希、
 * 函数名是压缩后的，每个 DSH 版本都不同，所以这里按 index.html 与代码形状去找；
 * 装了 DSH 却找不到时测试**失败**（DSH 改了形状，我们得知道），只有没装 DSH 时才跳过。
 */

import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import test from 'node:test'

import { composeInjectionRows, composePreviewDocument } from '../src/host/compose.js'
import { DEFAULTS } from '../src/shared/constants.js'
import { BUILTIN_TEMPLATES } from '../src/host/templates/index.js'
import { defaultAsarPath, readEntry } from '../tools/asar.mjs'

const asar = defaultAsarPath()
const installed = existsSync(asar)
const webserverPath = '/dsh/node_modules/@deepseek-ai/dsh-host-webserver/lib/index.js'
const frontendDist = '/dsh/node_modules/@deepseek-ai/dsh-web-frontend/dist'
const indexPath = `${frontendDist}/index.html`
const uiRendererPath = '/dsh/node_modules/@deepseek-ai/dsh-client-ui-renderer/lib/client.js'
const connectionPath = '/dsh/node_modules/@deepseek-ai/dsh-client-connection/lib/index.js'

/** 前端入口 bundle：从 index.html 的 <script type="module"> 里读出带哈希的文件名。 */
function frontendSource() {
  const html = readEntry(asar, indexPath)
  const match = /<script[^>]*type="module"[^>]*src="\.\/([^"]+\.js)"/.exec(html)
  assert.ok(match, 'index.html 里找不到前端入口 <script type="module" src="./assets/…js">')
  return readEntry(asar, `${frontendDist}/${match[1]}`)
}

/** 从 source[start] 处的函数声明切出完整函数（数花括号，跳过字符串与模板字符串）。 */
function sliceFunction(source, start) {
  let depth = 0
  for (let at = source.indexOf('{', start); at < source.length; at += 1) {
    const char = source[at]
    if (char === '"' || char === "'" || char === '`') {
      for (at += 1; at < source.length && source[at] !== char; at += 1) if (source[at] === '\\') at += 1
      continue
    }
    if (char === '{') depth += 1
    else if (char === '}' && (depth -= 1) === 0) return source.slice(start, at + 1)
  }
  throw new Error('函数源码切片不完整')
}

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
 * 从桌面前端 bundle 里切出注入表解释器并求值。
 * 函数名是压缩后的（hM、UZ…），按形状找：`async function X(rows, load){for(const r of rows)switch(r.kind){…}}`。
 * 真代码引用全局 document，这里把它作为参数注入，避免动全局状态。
 */
function loadDesktopApplier(document) {
  const source = frontendSource()
  const head = /async function ([\w$]+)\(([\w$]+),([\w$]+)\)\{for\(const ([\w$]+) of \2\)switch\(\4\.kind\)\{/.exec(source)
  assert.ok(head, '在 dsh-web-frontend 里找不到注入表解释器（async function X(rows, load){for(const r of rows)switch(r.kind){…}}）')
  const body = sliceFunction(source, head.index)
  for (const kind of ['style', 'html', 'script']) assert.ok(body.includes(`case"${kind}"`), `注入表解释器不再认识 ${kind} 行`)
  return new Function('document', `return ${body}`)(document)
}

/** 极简 DOM 打桩，够注入表解释器用即可。 */
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

test('shipped web renderer: 注入行渲染进 index.html', { skip: !installed }, () => {
  const { renderIndexInjections } = loadShippedRenderer()
  const indexHtml = readEntry(asar, indexPath)
  for (const template of BUILTIN_TEMPLATES) {
    const rows = composeInjectionRows({
      template,
      settings: { ...DEFAULTS, minDurationMs: 1000, maxDurationMs: 8000 },
    })
    const html = renderIndexInjections(indexHtml, rows)

    assert.ok(html.includes('<div id="dsh-wallport"'), `${template.id}: 覆层容器没有注入`)
    assert.ok(html.includes('dshba-frame'), `${template.id}: 覆层样式没有注入`)
    assert.ok(html.includes('dshBootAnim'), `${template.id}: 运行时脚本没有注入`)
    assert.ok(html.includes('__DSH_BOOT_READY__'), `${template.id}: 启动就绪 tail 丢失`)

    // 行文本里不能出现裸的 </script（否则会把宿主 <script> 提前闭合）
    const scriptCount = (html.match(/<\/script>/g) ?? []).length
    const openCount = (html.match(/<script/g) ?? []).length
    assert.equal(scriptCount, openCount, `${template.id}: script 标签数量不匹配（注入内容里出现了裸 </script）`)

    // 覆层必须出现在 </body> 之前
    assert.ok(html.indexOf('<div id="dsh-wallport"') < html.lastIndexOf('</body>'), `${template.id}: 覆层位置异常`)
  }
})

test('shipped desktop interpreter: 三种注入行都能被应用', { skip: !installed }, async () => {
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
    assert.ok(String(body.html ?? '').includes('<div id="dsh-wallport"'), `${template.id}: html 行没有落进 body`)
  }
})

test('shipped boot view: 覆层依赖的启动视图契约还在', { skip: !installed }, () => {
  const source = frontendSource()
  // 覆层靠这几样认出原生启动视图、读真实进度、发现启动失败
  assert.ok(source.includes('.dataset.dshBoot=""'), '启动视图不再打 data-dsh-boot')
  assert.ok(source.includes('.dataset.dshBootSpinner=""'), '进度转圈不再打 data-dsh-boot-spinner')
  assert.match(
    source,
    /"--dsh-boot-arc",`\$\{String\(Math\.round\(72\+[\w$.]+\*216\)\)\}deg`/,
    '--dsh-boot-arc 的换算（72deg + 进度 × 216deg）变了，runtime.js 的 readProgress() 要跟着改',
  )
  assert.ok(/failed to load|did not activate|import failed/i.test(source), '启动失败文案变了（覆层靠它给报错让路）')
  // 应用挂载：ui-renderer 从 #root 下的启动视图接手（hydrate 后换成应用），启动视图节点随之消失
  const renderer = readEntry(asar, uiRendererPath)
  assert.ok(renderer.includes(':scope > [data-dsh-boot]'), 'ui-renderer 不再从 #root > [data-dsh-boot] 接手启动视图')
})

test('shipped connection: HTTP 路由鉴权用的 requestRejection() 还在', { skip: !installed }, () => {
  const source = readEntry(asar, connectionPath)
  assert.match(source, /super\(ctx, "connection"\)/, 'connection 服务名变了（index.js 用 ctx.get("connection") 取它）')
  assert.match(source, /requestRejection\(request\) \{/, 'connection 服务不再提供 requestRejection(request)')
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
