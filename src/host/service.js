/**
 * 插件核心服务：设置 + 模板库 + 注入行，宿主半侧与设置页 API 共用同一份状态。
 *
 * 状态优先级：state.json（用户在设置页/AI 工具里改的） > 插件 config（部署默认值）。
 * 每次读取都重新读盘：设置页改完立即生效，不需要重启 DSH。
 */

import { API_PREFIX, DEFAULTS, DURATION_RANGE } from '../shared/constants.js'
import { TemplateError, textOf } from '../shared/validate.js'
import { composeInjectionRows, composePreviewDocument, composeRuntimeDocument, documentRevision } from './compose.js'
import { createStore } from './store.js'
import { BUILTIN_IDS, BUILTIN_TEMPLATES, builtinTemplate } from './templates/index.js'

/** 内置模板本身（而不是覆盖了内置 id 的同名自定义模板）。 */
function isBuiltinObject(template) {
  return BUILTIN_TEMPLATES.includes(template)
}

/** 列表项：不含完整文档，避免设置页/工具输出被大段 HTML 淹没。 */
function describeTemplate(template, activeId) {
  const builtin = isBuiltinObject(template)
  return {
    id: template.id,
    name: template.name,
    description: template.description ?? { zh: '', en: '' },
    theme: template.theme ?? 'dark',
    builtin,
    /** 自定义模板占用了内置模板的 id：删掉它就恢复内置版本。 */
    overridesBuiltin: !builtin && BUILTIN_IDS.has(template.id),
    active: template.id === activeId,
    source: builtin ? 'builtin' : (template.source ?? 'user'),
    documentBytes: typeof template.document === 'string' ? Buffer.byteLength(template.document, 'utf8') : 0,
  }
}

/**
 * 校验并整理一份设置补丁（HTTP 接口与 Agent 工具共用）：
 * 类型不对直接报错，而不是悄悄改成默认值。
 */
function settingsPatch(input) {
  const patch = {}
  for (const key of ['enabled', 'skippable']) {
    if (input[key] === undefined) continue
    if (typeof input[key] !== 'boolean') throw new TemplateError(`${key} 必须是布尔值`)
    patch[key] = input[key]
  }
  for (const key of ['minDurationMs', 'maxDurationMs']) {
    if (input[key] === undefined) continue
    const value = typeof input[key] === 'string' && input[key].trim() !== '' ? Number(input[key]) : input[key]
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new TemplateError(`${key} 必须是 ${DURATION_RANGE.min}–${DURATION_RANGE.max} 之间的毫秒数`)
    }
    patch[key] = value
  }
  if (input.template !== undefined) {
    if (typeof input.template !== 'string' || input.template.trim() === '') throw new TemplateError('template 必须是模板 id')
    patch.template = input.template
  }
  return patch
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

    /** 全部模板（内置 + 自定义），内置在前；同 id 的自定义模板覆盖内置模板。 */
    allTemplates() {
      const custom = store.listTemplates()
      const customIds = new Set(custom.map((template) => template.id))
      return [...BUILTIN_TEMPLATES.filter((template) => !customIds.has(template.id)), ...custom]
    },

    /** 按 id 找模板（自定义优先，允许用户覆盖内置同名模板；id 不区分大小写）。 */
    findTemplate(id) {
      const key = typeof id === 'string' ? id.trim().toLowerCase() : ''
      return store.getTemplate(key) ?? builtinTemplate(key)
    },

    /** 当前该播哪个模板；配置指向不存在的模板时退回第一个内置模板。 */
    activeTemplate(settings = service.settings()) {
      return service.findTemplate(settings.template) ?? BUILTIN_TEMPLATES[0]
    },

    /** 当前生效模板的 id（不需要列出全部模板时用它，便宜得多）。 */
    activeId() {
      return service.activeTemplate().id
    },

    /** 设置页 / 工具用的一份快照。 */
    snapshot() {
      const settings = service.settings()
      const active = service.activeTemplate(settings)
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
      return composeInjectionRows({ template: service.activeTemplate(settings), settings, api: API_PREFIX })
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
      const template = service.activeTemplate(settings)
      const rev = documentRevision(template)
      const changed = knownRev === undefined || knownRev !== rev
      return {
        rev,
        id: template.id,
        theme: template.theme === 'light' ? 'light' : 'dark',
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

    /**
     * 切换模板 / 改开关与时长。
     * @param input - { enabled?, template?, minDurationMs?, maxDurationMs?, skippable? }；类型不对会抛错。
     */
    updateSettings(input = {}) {
      const patch = settingsPatch(input ?? {})
      if (patch.template !== undefined) {
        const template = service.findTemplate(patch.template)
        if (template === undefined) throw new Error(`模板不存在：${patch.template}`)
        // 存规范化后的 id（大小写、空白），设置页/工具读回来的才和模板列表一致
        patch.template = template.id
      }
      return store.writeSettings(patch)
    },

    /** 保存（新建或覆盖）一个自定义模板。 */
    saveTemplate(input, { activate = false } = {}) {
      const saved = store.saveTemplate({ ...input, source: input?.source ?? 'ai' })
      if (activate) store.writeSettings({ template: saved.id, enabled: true })
      return saved
    },

    /**
     * 删除自定义模板；内置模板不可删。
     * 自定义模板占用了内置 id 时，删掉的是这份覆盖，内置版本随即恢复。
     * @returns 是否真的删掉了一个模板。
     */
    removeTemplate(id) {
      const key = typeof id === 'string' ? id.trim().toLowerCase() : ''
      const custom = store.getTemplate(key)
      if (custom === undefined) {
        if (BUILTIN_IDS.has(key)) throw new Error(`内置模板不可删除：${key}（可以切换到别的模板，或保存一个同名自定义模板来覆盖它）`)
        return false
      }
      store.removeTemplate(custom.id)
      // 删掉的正在生效：普通自定义模板退回默认模板；覆盖内置的那份删掉后自然回到内置版本
      if (!BUILTIN_IDS.has(custom.id) && service.findTemplate(store.readSettings().template) === undefined) {
        store.writeSettings({ template: BUILTIN_TEMPLATES[0].id })
      }
      return true
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
