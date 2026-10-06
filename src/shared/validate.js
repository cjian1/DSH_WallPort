/**
 * 模板校验与规范化。
 *
 * 模板 = 一个自包含的 HTML 文档字符串（可以内联 <style>/<script>），
 * 外加 id / 名称 / 描述。宿主把它塞进 iframe 的 srcdoc 里播放，
 * 所以「文档」本身不需要做 HTML 转义，但仍然要限制体积与 id 形状，
 * 免得开机时把整页 HTML 撑爆或让状态文件变成路径穿越的入口。
 */

import { LIMITS, TEMPLATE_ID_PATTERN } from '../shared/constants.js'

/** 校验失败时抛出的错误；API 层会把它转成 400 + message。 */
export class TemplateError extends Error {
  constructor(message) {
    super(message)
    this.name = 'TemplateError'
  }
}

const encoder = new TextEncoder()

/** UTF-8 字节数（写盘、注入、体积上限都以它为准）。 */
export function byteLength(text) {
  return encoder.encode(text).length
}

/** 名字/描述允许中英双语对象，也允许单个字符串。 */
export function normalizeText(value, field, { required = false } = {}) {
  if (value === undefined || value === null || value === '') {
    if (required) throw new TemplateError(`${field} 不能为空`)
    return undefined
  }
  const pick = (raw) => String(raw).replace(/\s+/g, ' ').trim()
  if (typeof value === 'string') {
    const out = pick(value)
    if (out === '') {
      if (required) throw new TemplateError(`${field} 不能为空`)
      return undefined
    }
    return out
  }
  if (typeof value === 'object' && !Array.isArray(value)) {
    const out = {}
    for (const key of ['zh', 'en']) {
      if (value[key] === undefined || value[key] === null) continue
      const text = pick(value[key])
      if (text !== '') out[key] = text
    }
    if (Object.keys(out).length === 0) {
      if (required) throw new TemplateError(`${field} 不能为空`)
      return undefined
    }
    return out
  }
  throw new TemplateError(`${field} 必须是字符串或 { zh, en } 对象`)
}

/** 语言无关地取一段展示文本（列表/工具输出用）。 */
export function textOf(value, locale = 'zh') {
  if (value === undefined || value === null) return ''
  if (typeof value === 'string') return value
  return value[locale] ?? value.zh ?? value.en ?? Object.values(value)[0] ?? ''
}

/** 模板 id：小写字母数字加连字符，且不能伪装成内置模板。 */
export function normalizeTemplateId(raw, { fallback } = {}) {
  const id = typeof raw === 'string' ? raw.trim().toLowerCase() : ''
  if (id === '') {
    if (fallback !== undefined) return fallback
    throw new TemplateError('模板 id 不能为空')
  }
  if (!TEMPLATE_ID_PATTERN.test(id)) {
    throw new TemplateError(
      `模板 id「${id}」不合法：只允许小写字母、数字和连字符，长度 2–48，且以字母或数字开头`,
    )
  }
  return id
}

/**
 * 校验并规范化一个模板。
 * @param input - 原始输入（来自 AI 工具、设置页或磁盘）。
 * @param options.requireDocument - 允许省略 document（仅改名字时）。
 * @returns 规范化后的模板对象。
 */
export function normalizeTemplate(input, { requireDocument = true } = {}) {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    throw new TemplateError('模板必须是对象')
  }
  const id = normalizeTemplateId(input.id, { fallback: undefined })
  const name = normalizeText(input.name, 'name', { required: true })
  if (typeof name === 'string' && name.length > LIMITS.nameChars) {
    throw new TemplateError(`name 过长（>${LIMITS.nameChars} 字符）`)
  }
  if (typeof name === 'object') {
    for (const [key, value] of Object.entries(name)) {
      if (value.length > LIMITS.nameChars) throw new TemplateError(`name.${key} 过长（>${LIMITS.nameChars} 字符）`)
    }
  }
  const description = normalizeText(input.description, 'description')
  if (description !== undefined) {
    const values = typeof description === 'string' ? [description] : Object.values(description)
    for (const value of values) {
      if (value.length > LIMITS.descriptionChars) {
        throw new TemplateError(`description 过长（>${LIMITS.descriptionChars} 字符）`)
      }
    }
  }

  let document = input.document
  if (document === undefined || document === null || document === '') {
    if (requireDocument) throw new TemplateError('document（整段 HTML）不能为空')
    document = undefined
  } else {
    if (typeof document !== 'string') throw new TemplateError('document 必须是字符串')
    if (document.trim() === '') throw new TemplateError('document（整段 HTML）不能为空')
    const bytes = byteLength(document)
    if (bytes > LIMITS.documentBytes) {
      throw new TemplateError(
        `document 过大：${bytes} 字节，上限 ${LIMITS.documentBytes} 字节（约 ${Math.round(LIMITS.documentBytes / 1024)} KiB）`,
      )
    }
  }

  const template = { id, name, document }
  if (description !== undefined) template.description = description
  template.theme = input.theme === 'light' ? 'light' : 'dark'
  if (typeof input.createdAt === 'string') template.createdAt = input.createdAt
  if (input.source === 'ai' || input.source === 'user' || input.source === 'builtin') template.source = input.source
  return template
}

/**
 * 把任意 HTML 片段补成一份完整文档（overlay 用 iframe.srcdoc 播放）。
 * 只做最小修补：缺 doctype/head/body 时补上，已有结构则原样保留。
 */
export function asFullDocument(html) {
  const text = String(html)
  const hasHtmlTag = /<html[\s>]/i.test(text)
  if (hasHtmlTag) return text
  if (/<body[\s>]/i.test(text)) {
    return `<!doctype html>\n<html lang="zh-CN">\n${text}\n</html>`
  }
  return [
    '<!doctype html>',
    '<html lang="zh-CN">',
    '<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>',
    '<body>',
    text,
    '</body>',
    '</html>',
  ].join('\n')
}

/**
 * 让字符串可以安全地放进 <script> 元素文本里：
 * 把 `<` 转成 `\u003c`（在 JS 字符串字面量里等价，在 HTML 解析器眼里断掉 `</script`）。
 */
export function jsonForScript(value) {
  return JSON.stringify(value ?? null)
    .replaceAll('<', '\\u003c')
    .replaceAll('\u2028', '\\u2028')
    .replaceAll('\u2029', '\\u2029')
}
