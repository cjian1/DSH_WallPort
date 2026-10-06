/**
 * 持久化：状态（开关 / 当前模板 / 时长）与自定义模板。
 *
 * 位置：`$DSH_HOME/dsh-wallport/`
 *   - state.json          当前生效的设置（设置页与 AI 工具都写它）
 *   - templates/<id>.json 自定义（AI 生成 / 手写导入）的模板
 *
 * 设计要点：
 * - 全部写入走「临时文件 + rename」，避免开机那一刻读到半个 JSON；
 * - 任何一次读失败都退回默认值，任何一次写失败都退回内存，
 *   插件绝不因为磁盘问题把 DSH 的启动流程带崩；
 * - 目录可由测试注入，默认目录用 @deepseek-ai/dsh-home-paths 解析
 *   （解析不到时依次退回 $DSH_HOME、~/.dsh）。
 */

import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

import { DEFAULTS, LIMITS, STATE_VERSION, TEMPLATE_ID_PATTERN } from '../shared/constants.js'
import { normalizeTemplate, normalizeTemplateId } from '../shared/validate.js'

/**
 * 解析 DSH home。
 *
 * 解析顺序（每一步失败就退下一步，绝不让磁盘/包解析问题影响启动）：
 *   1. 调用方显式给的 home（宿主上下文里的 dshHomePath）；
 *   2. 官方 @deepseek-ai/dsh-home-paths（插件装在 profile 里时可用）；
 *   3. $DSH_HOME（DSH 启动时会设置）；
 *   4. ~/.dsh。
 */
async function resolveHome(explicit) {
  if (typeof explicit === 'string' && explicit !== '') return explicit
  try {
    const mod = await import('@deepseek-ai/dsh-home-paths')
    const home = mod.resolveDshHome()
    if (typeof home === 'string' && home !== '') return home
  } catch {
    /* 插件以 link: 方式安装、或被独立运行时解析不到这个包，走下面的兜底 */
  }
  return process.env.DSH_HOME && process.env.DSH_HOME !== '' ? process.env.DSH_HOME : join(homedir(), '.dsh')
}

/** 状态目录名（$DSH_HOME/dsh-wallport）。 */
export const STATE_DIR_NAME = 'dsh-wallport'

/** 项目改名前的旧目录名；老用户第一次跑新版时把状态搬过来。 */
export const LEGACY_STATE_DIR_NAME = 'dsh-boot-animation'

/** 默认状态目录：$DSH_HOME/dsh-wallport */
export async function defaultBaseDir(home) {
  return join(await resolveHome(home), STATE_DIR_NAME)
}

/**
 * 一次性迁移：把旧目录（dsh-boot-animation）整棵拷到新目录（dsh-wallport）。
 * 只在新目录还不存在、且旧目录存在时做；是「拷贝」而不是「移动」，
 * 这样万一旧版本进程还在跑，它也不会写到一半发现目录没了。
 * @returns 迁移来源路径，或 undefined（不需要迁移）。
 */
export function migrateLegacyState(baseDir, home) {
  if (typeof home !== 'string' || home === '') return undefined
  const legacy = join(home, LEGACY_STATE_DIR_NAME)
  try {
    if (existsSync(baseDir) || !existsSync(legacy)) return undefined
    cpSync(legacy, baseDir, { recursive: true })
    return legacy
  } catch {
    return undefined
  }
}

function clampNumber(value, { min, max, fallback }) {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, Math.round(n)))
}

/** 把任意输入压成一份合法设置（缺项用 defaults 补）。 */
export function normalizeSettings(input, defaults = DEFAULTS) {
  const raw = input !== null && typeof input === 'object' ? input : {}
  const settings = {
    version: STATE_VERSION,
    enabled: typeof raw.enabled === 'boolean' ? raw.enabled : defaults.enabled,
    template: typeof raw.template === 'string' && raw.template.trim() !== '' ? raw.template.trim() : defaults.template,
    minDurationMs: clampNumber(raw.minDurationMs, { min: 0, max: 60000, fallback: defaults.minDurationMs }),
    maxDurationMs: clampNumber(raw.maxDurationMs, { min: 0, max: 60000, fallback: defaults.maxDurationMs }),
    skippable: typeof raw.skippable === 'boolean' ? raw.skippable : defaults.skippable,
  }
  if (settings.maxDurationMs < settings.minDurationMs) settings.maxDurationMs = settings.minDurationMs
  return settings
}

/**
 * 建一个状态仓。
 * @param options.dir - 显式目录（测试用）；省略时用 <home>/dsh-wallport。
 * @param options.home - DSH home（宿主上下文提供的 dshHomePath 优先）。
 * @param options.defaults - 部署默认值（来自插件 config）。
 */
export async function createStore({ dir, home, defaults = DEFAULTS, logger } = {}) {
  let baseDir = dir
  let migratedFrom
  if (baseDir === undefined) {
    const resolvedHome = await resolveHome(home)
    baseDir = join(resolvedHome, STATE_DIR_NAME)
    migratedFrom = migrateLegacyState(baseDir, resolvedHome)
    if (migratedFrom !== undefined) {
      logger?.info?.(`[dsh-wallport] 已把旧状态目录迁移过来：${migratedFrom} → ${baseDir}`)
    }
  }
  const statePath = join(baseDir, 'state.json')
  const templatesDir = join(baseDir, 'templates')
  /** 磁盘不可用时的内存兜底，保证本次进程内功能仍然完整。 */
  const memory = { state: normalizeSettings({}, defaults), templates: new Map(), degraded: false }

  const warn = (error) => {
    memory.degraded = true
    logger?.warn?.(`[dsh-wallport] 状态目录不可写（${baseDir}）：${error?.message ?? error}`)
  }

  function ensureDir() {
    mkdirSync(templatesDir, { recursive: true })
  }

  function writeJson(path, value) {
    const tmp = `${path}.tmp-${process.pid}-${Date.now()}`
    writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
    renameSync(tmp, path)
  }

  function readStateFile() {
    try {
      return JSON.parse(readFileSync(statePath, 'utf8'))
    } catch {
      return undefined
    }
  }

  function readTemplateFile(id) {
    try {
      const raw = JSON.parse(readFileSync(join(templatesDir, `${id}.json`), 'utf8'))
      return normalizeTemplate({ ...raw, id }, { requireDocument: true })
    } catch {
      return undefined
    }
  }

  return {
    baseDir,
    statePath,
    templatesDir,
    /** 旧目录迁移来源（没有迁移时为 undefined），日志与测试用。 */
    migratedFrom,

    /** 当前生效设置（磁盘优先，读不到用默认值）。 */
    readSettings() {
      const fromDisk = readStateFile()
      return fromDisk === undefined ? { ...memory.state } : normalizeSettings({ ...memory.state, ...fromDisk }, defaults)
    },

    /** 覆盖若干设置项并落盘。 */
    writeSettings(patch) {
      const next = normalizeSettings({ ...this.readSettings(), ...patch }, defaults)
      memory.state = next
      try {
        ensureDir()
        writeJson(statePath, next)
      } catch (error) {
        warn(error)
      }
      return next
    },

    /** 所有自定义模板（按 id 排序，损坏的文件直接跳过）。 */
    listTemplates() {
      let names = []
      try {
        names = readdirSync(templatesDir).filter((name) => name.endsWith('.json'))
      } catch {
        names = []
      }
      const out = []
      for (const name of names) {
        const id = name.slice(0, -'.json'.length)
        if (!TEMPLATE_ID_PATTERN.test(id)) continue
        const template = readTemplateFile(id)
        if (template !== undefined) out.push(template)
      }
      for (const template of memory.templates.values()) {
        if (!out.some((item) => item.id === template.id)) out.push(template)
      }
      out.sort((a, b) => a.id.localeCompare(b.id))
      return out
    },

    getTemplate(id) {
      let safeId
      try {
        safeId = normalizeTemplateId(id)
      } catch {
        return undefined
      }
      return readTemplateFile(safeId) ?? memory.templates.get(safeId)
    },

    /** 新建/覆盖一个自定义模板。 */
    saveTemplate(input) {
      const template = normalizeTemplate(input, { requireDocument: true })
      const existing = this.listTemplates()
      if (!existing.some((item) => item.id === template.id) && existing.length >= LIMITS.customTemplates) {
        throw new Error(`自定义模板数量已达上限（${LIMITS.customTemplates}）`)
      }
      const record = { ...template, source: template.source ?? 'user' }
      memory.templates.set(record.id, record)
      try {
        ensureDir()
        writeJson(join(templatesDir, `${record.id}.json`), record)
      } catch (error) {
        warn(error)
      }
      return record
    },

    /** 删除一个自定义模板；返回是否真的删掉了。 */
    removeTemplate(id) {
      let safeId
      try {
        safeId = normalizeTemplateId(id)
      } catch {
        return false
      }
      const had = memory.templates.delete(safeId)
      try {
        rmSync(join(templatesDir, `${safeId}.json`), { force: true })
        return true
      } catch (error) {
        warn(error)
        return had
      }
    },

    /** 磁盘不可用（已退回内存）时为 true，用于工具输出里如实说明。 */
    get degraded() {
      return memory.degraded
    },
  }
}
