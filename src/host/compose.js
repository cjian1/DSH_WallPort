/**
 * 组合层：把「模板 + 设置」编译成 DSH 启动页面能直接吃下的东西。
 *
 * 三种产物：
 *   1. composeInjectionRows()  —— webserver/index-inject 的注入行
 *      （web 模式被服务端拼进 index.html；桌面模式由前端 bootstrap 异步应用）
 *   2. composePreviewDocument()—— 独立可打开的预览页（设置页 iframe / 浏览器直接打开）
 *   3. overlayCss()/overlayHtml()—— 覆层外壳
 *
 * 注入行只用 DSH 已经验证过的三种 kind：
 *   { kind: 'style', text }                      → <style> 放 head
 *   { kind: 'html', placement: 'body', html }    → 插到 body 开头/末尾
 *   { kind: 'script', placement: 'body', text }  → <script> 放 body
 * 模板文档本身永远通过 iframe.srcdoc 播放，不做字符串拼接，
 * 所以模板里出现 </script>、引号、反引号都不会破坏宿主页面。
 */

import { BRIDGE_NAME, OVERLAY_ATTR, OVERLAY_ID } from '../shared/constants.js'
import { asFullDocument, jsonForScript } from '../shared/validate.js'
import { bootBridge, bootOverlayRuntime, bootPreviewSimulator } from './runtime.js'

/** 覆层外壳样式：只负责「盖住 + 淡出 + 跳过按钮」，动画细节全在模板文档里。 */
export function overlayCss({ theme = 'dark' } = {}) {
  const base = theme === 'light' ? '#f7f4ec' : '#05070d'
  const hintColor = theme === 'light' ? 'rgba(20,20,26,.55)' : 'rgba(255,255,255,.55)'
  const hintBg = theme === 'light' ? 'rgba(255,255,255,.72)' : 'rgba(0,0,0,.32)'
  const hintBorder = theme === 'light' ? 'rgba(20,20,26,.14)' : 'rgba(255,255,255,.14)'
  return [
    `#${OVERLAY_ID}{position:fixed;inset:0;z-index:2147483000;pointer-events:none;`,
    `opacity:1;transition:opacity .46s ease;background:${base}}`,
    `#${OVERLAY_ID}[data-dshba-state="leaving"]{opacity:0}`,
    `#${OVERLAY_ID} .dshba-frame{position:absolute;inset:0;width:100%;height:100%;border:0;display:block}`,
    `#${OVERLAY_ID} .dshba-skip{position:absolute;right:18px;bottom:16px;pointer-events:auto;cursor:pointer;`,
    `font:12px/1.4 -apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;`,
    `color:${hintColor};background:${hintBg};border:1px solid ${hintBorder};border-radius:999px;padding:5px 12px;`,
    `opacity:0;transition:opacity .2s ease}`,
    `#${OVERLAY_ID}:hover .dshba-skip{opacity:1}`,
    `#${OVERLAY_ID} .dshba-skip:focus-visible{opacity:1;outline:2px solid #4d6bfe;outline-offset:2px}`,
    `@media (prefers-reduced-motion: reduce){#${OVERLAY_ID}{transition:none}}`,
  ].join('')
}

/** 覆层容器：内容（iframe）由运行时脚本创建。 */
export function overlayHtml(templateId) {
  return `<div id="${OVERLAY_ID}" ${OVERLAY_ATTR}="${String(templateId).replaceAll('"', '')}" aria-hidden="true"></div>`
}

/**
 * 把桥接脚本插进模板文档最前面（head 内），这样模板自己的 <script> 一定能在
 * 执行时就看到 window.dshBootAnim。
 * @param html - 模板文档（片段或完整文档都可）。
 * @param extras - 追加在桥接后面的脚本源码（预览模拟器等）。
 */
export function injectBridge(html, { bridgeName = BRIDGE_NAME, extras = [] } = {}) {
  const script = `<script>(${bootBridge.toString()})(${jsonForScript(bridgeName)});${extras.join('')}</script>`
  const doc = asFullDocument(html)
  const headOpen = /<head(?:\s[^>]*)?>/i.exec(doc)
  if (headOpen) {
    const at = headOpen.index + headOpen[0].length
    return doc.slice(0, at) + script + doc.slice(at)
  }
  const htmlOpen = /<html(?:\s[^>]*)?>/i.exec(doc)
  if (htmlOpen) {
    const at = htmlOpen.index + htmlOpen[0].length
    return `${doc.slice(0, at)}<head>${script}</head>${doc.slice(at)}`
  }
  const bodyOpen = /<body(?:\s[^>]*)?>/i.exec(doc)
  if (bodyOpen) {
    const at = bodyOpen.index
    return `${doc.slice(0, at)}<head>${script}</head>${doc.slice(at)}`
  }
  return `${script}${doc}`
}

/** 运行时脚本源码（注入到宿主页面）。 */
export function composeRuntimeScript({ template, settings, bridgeName = BRIDGE_NAME, api }) {
  const cfg = {
    templateId: template.id,
    overlayId: OVERLAY_ID,
    bridgeName,
    document: injectBridge(template.document, { bridgeName }),
    minDurationMs: settings.minDurationMs,
    maxDurationMs: settings.maxDurationMs,
    skippable: settings.skippable !== false,
    rev: documentRevision(template),
    // Desktop 模式下 DSH 只在宿主启动时收集一次注入表，所以运行时还会向这个
    // 同源接口要一次「当前生效的模板」，让切换模板后刷新页面也能立刻生效。
    ...(typeof api === 'string' && api !== '' ? { api } : {}),
  }
  return `(${bootOverlayRuntime.toString()})(${jsonForScript(cfg)});`
}

/**
 * 模板修订号：id + 文档内容的短哈希。
 * 注入行进页面时带一份，页面加载时拿它和宿主当前的比一次，不同才热切换。
 */
export function documentRevision(template) {
  const text = `${template.id}\u0000${template.document ?? ''}`
  let hash = 0x811c9dc5
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return `${template.id}-${hash.toString(16).padStart(8, '0')}`
}

/** 运行时文档（带桥接）——注入行与 /active 接口共用同一份拼装逻辑。 */
export function composeRuntimeDocument(template, { bridgeName = BRIDGE_NAME } = {}) {
  return injectBridge(template.document, { bridgeName })
}

/** 组装注入行。 */
export function composeInjectionRows({ template, settings, api }) {
  return [
    { kind: 'style', text: overlayCss({ theme: template.theme }) },
    { kind: 'html', placement: 'body', html: overlayHtml(template.id) },
    { kind: 'script', placement: 'body', text: composeRuntimeScript({ template, settings, api }) },
  ]
}

/**
 * 预览文档：模板 + 桥接 + 进度模拟器，可直接丢给 iframe 或写进 .html 文件。
 * @param options.loop - 是否循环播放（预览默认 true）。
 */
export function composePreviewDocument({ template, loop = true, cycleMs = 2600, holdMs = 900, bridgeName = BRIDGE_NAME }) {
  const extras = [`(${bootPreviewSimulator.toString()})(${jsonForScript(bridgeName)},{cycleMs:${cycleMs},holdMs:${holdMs},loop:${loop ? 'true' : 'false'}});`]
  return injectBridge(template.document, { bridgeName, extras })
}
