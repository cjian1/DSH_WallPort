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
 * - 没能落盘的改动在本进程内优先于磁盘上的旧文件（只读目录里也能切模板）；
 * - 模板文件按 mtime/size/inode 缓存解析结果：文件没变就不重复读盘 + 校验，
 *   改了（包括手工编辑）下次读取立刻生效；
 * - 目录可由测试注入，默认目录用 @deepseek-ai/dsh-home-paths 解析
 *   （解析不到时依次退回 $DSH_HOME、~/.dsh）。
 */

import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

import { DEFAULTS, DURATION_RANGE, LIMITS, STATE_VERSION, TEMPLATE_ID_PATTERN } from '../shared/constants.js'
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
    minDurationMs: clampNumber(raw.minDurationMs, { ...DURATION_RANGE, fallback: defaults.minDurationMs }),
    maxDurationMs: clampNumber(raw.maxDurationMs, { ...DURATION_RANGE, fallback: defaults.maxDurationMs }),
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
  /**
   * 磁盘不可用时的内存兜底，保证本次进程内功能仍然完整：
   * - state：最近一次写入的设置；stateUnsaved 为 true 时（没能落盘）读设置以它为准，
   *   否则磁盘上的旧 state.json 会把刚做的改动「吃掉」；
   * - templates：没能落盘的模板，覆盖磁盘上的同名旧文件；
   * - removed：没能从磁盘删掉的模板 id，读的时候当作已删除。
   */
  const memory = {
    state: normalizeSettings({}, defaults),
    stateUnsaved: false,
    templates: new Map(),
    removed: new Set(),
  }
  /** 模板文件的解析缓存：id → { key: mtime/size/inode, template }（损坏的文件缓存为 undefined）。 */
  const parsed = new Map()

  const warn = (error) => {
    logger?.warn?.(`[dsh-wallport] 状态目录不可写（${baseDir}）：${error?.message ?? error}`)
  }

  function ensureDir() {
    mkdirSync(templatesDir, { recursive: true })
  }

  function writeJson(path, value) {
    const tmp = `${path}.tmp-${process.pid}-${Date.now()}`
    try {
      writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
      renameSync(tmp, path)
    } catch (error) {
      rmSync(tmp, { force: true })
      throw error
    }
  }

  function readStateFile() {
    try {
      return JSON.parse(readFileSync(statePath, 'utf8'))
    } catch {
      return undefined
    }
  }

  function readTemplateFile(id) {
    const path = join(templatesDir, `${id}.json`)
    let key
    try {
      const stat = statSync(path)
      key = `${stat.mtimeMs}:${stat.size}:${stat.ino}`
    } catch {
      parsed.delete(id)
      return undefined
    }
    const hit = parsed.get(id)
    if (hit !== undefined && hit.key === key) return hit.template
    let template
    try {
      const raw = JSON.parse(readFileSync(path, 'utf8'))
      template = normalizeTemplate({ ...raw, id }, { requireDocument: true })
    } catch {
      template = undefined
    }
    parsed.set(id, { key, template })
    return template
  }

  /** 模板目录里形状合法的 id（不读内容）。 */
  function templateFileIds() {
    let names
    try {
      names = readdirSync(templatesDir)
    } catch {
      return []
    }
    const ids = []
    for (const name of names) {
      if (!name.endsWith('.json')) continue
      const id = name.slice(0, -'.json'.length)
      if (TEMPLATE_ID_PATTERN.test(id)) ids.push(id)
    }
    return ids
  }

  const store = {
    baseDir,
    statePath,
    templatesDir,
    /** 旧目录迁移来源（没有迁移时为 undefined），日志与测试用。 */
    migratedFrom,

    /** 当前生效设置（磁盘优先，读不到用默认值；最近一次写入没能落盘时以内存为准）。 */
    readSettings() {
      if (!memory.stateUnsaved) {
        const fromDisk = readStateFile()
        if (fromDisk !== undefined) return normalizeSettings({ ...memory.state, ...fromDisk }, defaults)
      }
      return { ...memory.state }
    },

    /** 覆盖若干设置项并落盘。 */
    writeSettings(patch) {
      const next = normalizeSettings({ ...store.readSettings(), ...patch }, defaults)
      memory.state = next
      try {
        ensureDir()
        writeJson(statePath, next)
        memory.stateUnsaved = false
      } catch (error) {
        memory.stateUnsaved = true
        warn(error)
      }
      return next
    },

    /** 所有自定义模板（按 id 排序，损坏的文件直接跳过）。 */
    listTemplates() {
      const byId = new Map()
      for (const id of templateFileIds()) {
        if (memory.removed.has(id)) continue
        const template = readTemplateFile(id)
        if (template !== undefined) byId.set(id, template)
      }
      for (const [id, template] of memory.templates) byId.set(id, template)
      return [...byId.values()].sort((a, b) => a.id.localeCompare(b.id))
    },

    getTemplate(id) {
      let safeId
      try {
        safeId = normalizeTemplateId(id)
      } catch {
        return undefined
      }
      if (memory.templates.has(safeId)) return memory.templates.get(safeId)
      if (memory.removed.has(safeId)) return undefined
      return readTemplateFile(safeId)
    },

    /** 新建/覆盖一个自定义模板。 */
    saveTemplate(input) {
      const template = normalizeTemplate(input, { requireDocument: true })
      const existing = store.listTemplates()
      if (!existing.some((item) => item.id === template.id) && existing.length >= LIMITS.customTemplates) {
        throw new Error(`自定义模板数量已达上限（${LIMITS.customTemplates}）`)
      }
      // 存进来的永远是自定义模板：source 只有 ai / user 两种
      const record = { ...template, source: template.source === 'ai' ? 'ai' : 'user' }
      memory.removed.delete(record.id)
      try {
        ensureDir()
        writeJson(join(templatesDir, `${record.id}.json`), record)
        memory.templates.delete(record.id)
      } catch (error) {
        memory.templates.set(record.id, record)
        warn(error)
      }
      return record
    },

    /** 删除一个自定义模板；返回它原本是否存在。 */
    removeTemplate(id) {
      let safeId
      try {
        safeId = normalizeTemplateId(id)
      } catch {
        return false
      }
      const had = store.getTemplate(safeId) !== undefined
      memory.templates.delete(safeId)
      try {
        rmSync(join(templatesDir, `${safeId}.json`), { force: true })
        memory.removed.delete(safeId)
        parsed.delete(safeId)
      } catch (error) {
        memory.removed.add(safeId)
        warn(error)
      }
      return had
    },

    /** 有改动只存在内存里（没能落盘）时为 true，用于设置页与工具输出里如实说明。 */
    get degraded() {
      return memory.stateUnsaved || memory.templates.size > 0 || memory.removed.size > 0
    },
  }
  return store
}
