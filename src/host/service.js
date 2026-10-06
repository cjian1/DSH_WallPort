/**
 * 插件核心服务：设置 + 模板库 + 注入行，宿主半侧与设置页 API 共用同一份状态。
 *
 * 状态优先级：state.json（用户在设置页/AI 工具里改的） > 插件 config（部署默认值）。
 * 每次读取都重新读盘：设置页改完立即生效，不需要重启 DSH。
 */

import { API_PREFIX, DEFAULTS } from '../shared/constants.js'
import { textOf } from '../shared/validate.js'
import { composeInjectionRows, composePreviewDocument, composeRuntimeDocument, documentRevision } from './compose.js'
import { createStore } from './store.js'
import { BUILTIN_IDS, BUILTIN_TEMPLATES, builtinTemplate } from './templates/index.js'

/** 列表项：不含完整文档，避免设置页/工具输出被大段 HTML 淹没。 */
function describeTemplate(template, activeId) {
  return {
    id: template.id,
    name: template.name,
    description: template.description ?? { zh: '', en: '' },
    theme: template.theme ?? 'dark',
    builtin: BUILTIN_IDS.has(template.id),
    active: template.id === activeId,
    source: template.source ?? (BUILTIN_IDS.has(template.id) ? 'builtin' : 'user'),
    documentBytes: typeof template.document === 'string' ? Buffer.byteLength(template.document, 'utf8') : 0,
  }
}

/**
 * @param options.defaults - 部署默认值（插件 config）。
 * @param options.logger - DSH logger（可选）。
 * @param options.dir - 状态目录覆盖（测试用）。
 * @param options.home - DSH home（宿主上下文的 dshHomePath，可选）。
 */
export async function createBootAnimationService({ defaults = DEFAULTS, logger, dir, home } = {}) {
  const store = await createStore({ defaults, logger, dir, home })

  const service = {
    store,
    defaults,

    /** 当前生效设置。 */
    settings() {
      return store.readSettings()
    },

    /** 全部模板（内置 + 自定义），内置在前。 */
    allTemplates() {
      const custom = store.listTemplates()
      const customIds = new Set(custom.map((template) => template.id))
      return [...BUILTIN_TEMPLATES.filter((template) => !customIds.has(template.id)), ...custom]
    },

    /** 按 id 找模板（自定义优先，允许用户覆盖内置同名模板）。 */
    findTemplate(id) {
      const key = typeof id === 'string' ? id.trim() : ''
      return store.getTemplate(key) ?? builtinTemplate(key)
    },

    /** 当前该播哪个模板；配置指向不存在的模板时退回第一个内置模板。 */
    activeTemplate() {
      const settings = service.settings()
      return service.findTemplate(settings.template) ?? BUILTIN_TEMPLATES[0]
    },

    /** 设置页 / 工具用的一份快照。 */
    snapshot() {
      const settings = service.settings()
      const active = service.activeTemplate()
      const templates = service.allTemplates().map((template) => describeTemplate(template, active.id))
      return {
        settings,
        active: active.id,
        enabled: settings.enabled,
        degraded: store.degraded,
        baseDir: store.baseDir,
        templates,
      }
    },

    /** 注入行（供 webserver/index-inject 使用）。 */
    injectionRows() {
      const settings = service.settings()
      if (settings.enabled !== true) return []
      return composeInjectionRows({ template: service.activeTemplate(), settings, api: API_PREFIX })
    },

    /**
     * 页面加载时核对用的「当前生效模板」。
     *
     * 桌面模式下 DSH 只在宿主启动时收集一次注入表，注入行里带的可能是旧模板；
     * 前端运行时拿注入行里的 rev 调这里，不一致就把 iframe 热切换过去，
     * 于是「换模板 → 刷新页面」在两种承载下都成立。
     *
     * @param knownRev - 注入行里带的修订号，省略表示调用方没有快照（总是返回文档）。
     */
    activeDocument(knownRev) {
      const settings = service.settings()
      const template = service.activeTemplate()
      const rev = documentRevision(template)
      const changed = knownRev === undefined || knownRev !== rev
      return {
        rev,
        id: template.id,
        changed,
        enabled: settings.enabled,
        settings: {
          enabled: settings.enabled,
          minDurationMs: settings.minDurationMs,
          maxDurationMs: settings.maxDurationMs,
          skippable: settings.skippable,
        },
        ...(changed ? { document: composeRuntimeDocument(template) } : {}),
      }
    },

    /** 预览文档（完整 HTML，可直接给 iframe 或写文件）。 */
    previewDocument(id, options) {
      const template = service.findTemplate(id)
      if (template === undefined) throw new Error(`模板不存在：${id}`)
      return composePreviewDocument({ template, ...options })
    },

    /** 切换模板 / 改开关与时长。 */
    updateSettings(patch = {}) {
      if (patch.template !== undefined && service.findTemplate(patch.template) === undefined) {
        throw new Error(`模板不存在：${patch.template}`)
      }
      return store.writeSettings(patch)
    },

    /** 保存（新建或覆盖）一个自定义模板。 */
    saveTemplate(input, { activate = false } = {}) {
      const saved = store.saveTemplate({ ...input, source: input?.source ?? 'ai' })
      if (activate) store.writeSettings({ template: saved.id, enabled: true })
      return saved
    },

    /** 删除自定义模板；内置模板不可删。 */
    removeTemplate(id) {
      if (BUILTIN_IDS.has(id)) throw new Error(`内置模板不可删除：${id}（可以切换或覆盖同名自定义模板）`)
      const existed = store.getTemplate(id) !== undefined
      store.removeTemplate(id)
      if (store.readSettings().template === id) {
        store.writeSettings({ template: BUILTIN_TEMPLATES[0].id })
      }
      return existed
    },

    /** 给工具输出用的中文摘要。 */
    describe(id, locale = 'zh') {
      const template = service.findTemplate(id)
      if (template === undefined) return id
      return `${textOf(template.name, locale)}（${template.id}）`
    },
  }

  return service
}
