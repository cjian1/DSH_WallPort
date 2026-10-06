/**
 * Agent 工具：让「用 AI 自定义开机动画」变成一条可执行的路径。
 *
 * 用户只要说一句「把开机动画换成星空主题」，模型就能：
 *   boot_animation_list   → 看现有模板与当前生效项
 *   （自己写一段 HTML 文档）
 *   boot_animation_save   → 存成自定义模板（可选立即启用）
 *   boot_animation_preview→ 落一个预览 HTML，用户可以马上打开看
 *   boot_animation_apply  → 切换生效模板（下次刷新页面即生效）
 *
 * 工具定义走本包自带的 src/host/define-tool.js（JSON Schema 形状与
 * @deepseek-ai/dsh-tools 的产物一致），所以插件不依赖任何宿主包也能注册工具。
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

import { DEFAULTS, DURATION_RANGE, LIMITS } from '../shared/constants.js'
import { textOf } from '../shared/validate.js'
import { defineTool } from './define-tool.js'

/** 工具名统一前缀，避免和别的插件撞名。 */
export const TOOL_NAMES = {
  list: 'boot_animation_list',
  save: 'boot_animation_save',
  apply: 'boot_animation_apply',
  preview: 'boot_animation_preview',
  remove: 'boot_animation_remove',
  settings: 'boot_animation_settings',
}

const TEMPLATE_DOC_CONTRACT = [
  'document 必须是一段自包含的 HTML（可以含 <style>/<script>，也可以是完整文档）：',
  '1) 它会被放进一个铺满全屏的 iframe（srcdoc）里播放，请让画面占满视口、不要依赖滚动；',
  '2) 不能依赖任何网络资源（外链字体/图片/CDN 在开机时不可用），需要图形就用内联 SVG/CSS/canvas；',
  '3) 想跟随真实启动进度就用 window.dshBootAnim：progress() 返回 0…1，on("progress", fn) 订阅，',
  '   isReady()/on("ready") 表示应用已挂载，reduced() 表示用户偏好减少动效；',
  '4) 不要假设 DSH 的 CSS 变量已经可用（开机阶段样式还没加载），颜色/字体请自带；',
  '5) 时长由插件统一控制（默认最长 12 秒），动画自己循环播放即可，不需要自己结束。',
].join('\n')

const OUTPUT_OK = {
  type: 'object',
  additionalProperties: true,
  properties: { ok: { type: 'boolean' } },
}

function templateSummary(template) {
  return {
    id: template.id,
    name: textOf(template.name, 'zh'),
    nameEn: textOf(template.name, 'en'),
    description: textOf(template.description, 'zh'),
    builtin: template.builtin,
    active: template.active,
    theme: template.theme,
    kib: Math.round((template.documentBytes / 1024) * 10) / 10,
  }
}

/**
 * 注册全部工具。
 * @param ctx - 带 tools 服务的上下文。
 * @param service - createBootAnimationService() 的返回值。
 * @returns 注册的工具数量。
 */
export function registerTools(ctx, service) {
  const listTool = defineTool({
    name: TOOL_NAMES.list,
    description:
      '列出 DeepSeek Harness 当前可用的开机动画模板（内置 + 用户自定义）与当前生效项。要帮用户更换/查看开机动画时先调用它。',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        required: ['active', 'enabled', 'settings', 'templates'],
        properties: {
          active: { type: 'string' },
          enabled: { type: 'boolean' },
          settings: {
            type: 'object',
            additionalProperties: false,
            required: ['minDurationMs', 'maxDurationMs', 'skippable'],
            properties: {
              minDurationMs: { type: 'integer' },
              maxDurationMs: { type: 'integer' },
              skippable: { type: 'boolean' },
            },
          },
          templates: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['id', 'name', 'builtin', 'active'],
              properties: {
                id: { type: 'string' },
                name: { type: 'string' },
                nameEn: { type: 'string' },
                description: { type: 'string' },
                builtin: { type: 'boolean' },
                active: { type: 'boolean' },
                theme: { type: 'string' },
                kib: { type: 'number' },
              },
            },
          },
        },
      },
      render: (_args, value) => [
        {
          type: 'text',
          text: [
            `当前开机动画：${value.active}${value.enabled ? '' : '（已关闭，启动时不播放）'}`,
            `时长：最短 ${value.settings.minDurationMs}ms，兜底 ${value.settings.maxDurationMs}ms，可跳过：${value.settings.skippable ? '是' : '否'}`,
            '可用模板：',
            ...value.templates.map(
              (item) =>
                `- ${item.active ? '★ ' : '  '}${item.id}｜${item.name}${item.nameEn ? ` / ${item.nameEn}` : ''}｜${item.builtin ? '内置' : '自定义'}｜${item.kib}KiB${item.description ? `｜${item.description}` : ''}`,
            ),
          ].join('\n'),
        },
      ],
    },
    execute() {
      const snapshot = service.snapshot()
      return Promise.resolve({
        active: snapshot.active,
        enabled: snapshot.enabled,
        settings: {
          minDurationMs: snapshot.settings.minDurationMs,
          maxDurationMs: snapshot.settings.maxDurationMs,
          skippable: snapshot.settings.skippable,
        },
        templates: snapshot.templates.map(templateSummary),
      })
    },
    presentCall: () => ({ card: 'generic', title: '查看开机动画模板', kind: 'other' }),
  })

  const saveTool = defineTool({
    name: TOOL_NAMES.save,
    description: [
      '把一段 HTML 保存成 DeepSeek Harness 的自定义开机动画模板（同名会覆盖）。',
      '这是「用 AI 自定义开机动画」的主入口：用户描述想要的动画后，你写好 document 再调用它。',
      TEMPLATE_DOC_CONTRACT,
    ].join('\n'),
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['id', 'name', 'document'],
      properties: {
        id: {
          type: 'string',
          description: '模板 id：小写字母/数字/连字符，2–48 位，例如 "aurora-night"。同名会覆盖已有自定义模板。',
        },
        name: { type: 'string', description: '展示名，例如「极光之夜」。' },
        document: { type: 'string', description: '完整 HTML 文档字符串（单文件、无外链）。' },
        description: { type: 'string', description: '一句话说明这个动画长什么样，会显示在设置页卡片上。' },
        theme: { type: 'string', enum: ['dark', 'light'], description: '底色主题，决定覆层淡出前的背景色，默认 dark。' },
        activate: { type: 'boolean', description: '保存后是否立即启用（默认 true）。' },
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'name', 'bytes', 'active', 'directory'],
        properties: {
          id: { type: 'string' },
          name: { type: 'string' },
          bytes: { type: 'integer' },
          active: { type: 'boolean' },
          directory: { type: 'string' },
        },
      },
      render: (_args, value) => [
        {
          type: 'text',
          text: `已保存开机动画模板「${value.name}」（${value.id}，${Math.round(value.bytes / 1024)}KiB）${value.active ? '，并已设为当前开机动画' : ''}。存储目录：${value.directory}。刷新 DSH 页面即可看到；如果这是刚装好插件后的第一次，请重启一次 DSH 让启动注入生效。`,
        },
      ],
    },
    execute(args) {
      const activate = args.activate !== false
      const saved = service.saveTemplate(
        {
          id: args.id,
          name: args.name,
          description: args.description,
          document: args.document,
          theme: args.theme,
          source: 'ai',
        },
        { activate },
      )
      return Promise.resolve({
        id: saved.id,
        name: textOf(saved.name, 'zh'),
        bytes: Buffer.byteLength(saved.document, 'utf8'),
        active: service.snapshot().active === saved.id,
        directory: service.store.templatesDir,
      })
    },
    presentCall: (args) => ({
      card: 'generic',
      title: `保存开机动画：${args.name ?? args.id}`,
      kind: 'other',
      rawInput: { id: args.id },
    }),
  })

  const applyTool = defineTool({
    name: TOOL_NAMES.apply,
    description:
      '切换 DeepSeek Harness 的开机动画（内置模板或已保存的自定义模板）。切换立即写入状态，用户下次刷新页面/重启应用就能看到。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['id'],
      properties: {
        id: { type: 'string', description: '模板 id；用 boot_animation_list 查可用值。' },
        enabled: { type: 'boolean', description: '是否启用开机动画，默认 true；false 表示启动时不播放动画。' },
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        required: ['active', 'name', 'enabled'],
        properties: {
          active: { type: 'string' },
          name: { type: 'string' },
          enabled: { type: 'boolean' },
        },
      },
      render: (_args, value) => [
        {
          type: 'text',
          text: value.enabled
            ? `已把开机动画切换为「${value.name}」（${value.active}）。刷新 DSH 页面即可看到（首次安装插件后需要重启一次 DSH）。`
            : `已关闭开机动画（当前模板仍是「${value.name}」）。刷新页面生效；首次安装插件后需要重启一次 DSH。`,
        },
      ],
    },
    execute(args) {
      const settings = service.updateSettings({
        template: String(args.id),
        ...(args.enabled === undefined ? {} : { enabled: args.enabled === true }),
      })
      return Promise.resolve({
        active: settings.template,
        name: service.describe(settings.template),
        enabled: settings.enabled,
      })
    },
    presentCall: (args) => ({ card: 'generic', title: `切换开机动画：${args.id}`, kind: 'other', rawInput: args }),
  })

  const previewTool = defineTool({
    name: TOOL_NAMES.preview,
    description:
      '把某个开机动画模板导出成一份独立 HTML 预览文件并返回路径，用户可以直接在浏览器里打开预览（不需要重启 DSH）。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        id: { type: 'string', description: '模板 id，省略则导出当前生效的模板。' },
        path: {
          type: 'string',
          description: '导出路径；省略则写到插件数据目录的 previews/ 下。相对路径按宿主进程工作目录解析。',
        },
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'path', 'url', 'bytes'],
        properties: {
          id: { type: 'string' },
          path: { type: 'string' },
          url: { type: 'string' },
          bytes: { type: 'integer' },
        },
      },
      render: (_args, value) => [
        {
          type: 'text',
          text: `已导出预览：${value.path}\n用浏览器打开这个文件即可看到「${value.id}」的开机动画（预览会循环播放并模拟启动进度）。`,
        },
      ],
    },
    execute(args) {
      const id = args.id === undefined || args.id === '' ? service.snapshot().active : String(args.id)
      const document = service.previewDocument(id, { loop: true })
      const target =
        args.path === undefined || args.path === ''
          ? join(service.store.baseDir, 'previews', `${id}.html`)
          : resolve(process.cwd(), String(args.path))
      mkdirSync(dirname(target), { recursive: true })
      writeFileSync(target, document, 'utf8')
      return Promise.resolve({
        id,
        path: target,
        url: pathToFileURL(target).href,
        bytes: Buffer.byteLength(document, 'utf8'),
      })
    },
    presentCall: (args) => ({
      card: 'generic',
      title: `导出开机动画预览：${args.id ?? '当前模板'}`,
      kind: 'other',
      rawInput: args,
    }),
  })

  const removeTool = defineTool({
    name: TOOL_NAMES.remove,
    description: '删除一个自定义开机动画模板（内置模板不可删除）。删除后如果它正在生效，会自动切回默认的内置模板。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['id'],
      properties: { id: { type: 'string', description: '要删除的自定义模板 id。' } },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'existed', 'active'],
        properties: {
          id: { type: 'string' },
          existed: { type: 'boolean' },
          active: { type: 'string' },
        },
      },
      render: (_args, value) => [
        {
          type: 'text',
          text: value.existed
            ? `已删除自定义模板「${value.id}」；当前生效模板为「${value.active}」。`
            : `没有找到自定义模板「${value.id}」（内置模板不能删除）。`,
        },
      ],
    },
    execute(args) {
      const id = String(args.id)
      const existed = service.removeTemplate(id)
      return Promise.resolve({ id, existed, active: service.snapshot().active })
    },
    presentCall: (args) => ({ card: 'generic', title: `删除开机动画模板：${args.id}`, kind: 'other', rawInput: args }),
  })

  const settingsTool = defineTool({
    name: TOOL_NAMES.settings,
    description: [
      '调整开机动画的播放参数：总开关、最短展示时长、兜底时长、是否允许点击跳过。',
      `时长范围 ${DURATION_RANGE.min}–${DURATION_RANGE.max}ms。minDurationMs 保证启动再快也能看清动画；`,
      `maxDurationMs 是兜底上限，超过就撤掉动画让应用显示出来（默认 ${DEFAULTS.maxDurationMs}）。`,
    ].join('\n'),
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        enabled: { type: 'boolean', description: '是否启用开机动画。' },
        minDurationMs: { type: 'integer', description: `最短展示时长（毫秒），默认 ${DEFAULTS.minDurationMs}。` },
        maxDurationMs: { type: 'integer', description: `兜底最长时长（毫秒），默认 ${DEFAULTS.maxDurationMs}。` },
        skippable: { type: 'boolean', description: '是否允许点击/按键跳过动画。' },
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        required: ['enabled', 'minDurationMs', 'maxDurationMs', 'skippable'],
        properties: {
          enabled: { type: 'boolean' },
          minDurationMs: { type: 'integer' },
          maxDurationMs: { type: 'integer' },
          skippable: { type: 'boolean' },
        },
      },
      render: (_args, value) => [
        {
          type: 'text',
          text: `开机动画设置已更新：${value.enabled ? '已启用' : '已关闭'}，最短 ${value.minDurationMs}ms，兜底 ${value.maxDurationMs}ms，可跳过：${value.skippable ? '是' : '否'}。`,
        },
      ],
    },
    execute(args) {
      const patch = {}
      if (args.enabled !== undefined) patch.enabled = args.enabled === true
      if (args.minDurationMs !== undefined) patch.minDurationMs = args.minDurationMs
      if (args.maxDurationMs !== undefined) patch.maxDurationMs = args.maxDurationMs
      if (args.skippable !== undefined) patch.skippable = args.skippable === true
      const settings = service.updateSettings(patch)
      return Promise.resolve({
        enabled: settings.enabled,
        minDurationMs: settings.minDurationMs,
        maxDurationMs: settings.maxDurationMs,
        skippable: settings.skippable,
      })
    },
    presentCall: (args) => ({ card: 'generic', title: '调整开机动画设置', kind: 'other', rawInput: args }),
  })

  const tools = [listTool, saveTool, applyTool, previewTool, removeTool, settingsTool]
  for (const tool of tools) ctx.tools.register(tool)
  ctx.logger?.info?.(
    `[dsh-wallport] 已注册 ${tools.length} 个工具（最大文档 ${Math.round(LIMITS.documentBytes / 1024)}KiB）`,
  )
  return tools.length
}
