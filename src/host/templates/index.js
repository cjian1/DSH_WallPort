/**
 * 内置模板注册表。
 *
 * 顺序就是设置页里的展示顺序；第一个是默认模板。
 * 每个模板都是「一段自包含 HTML 文档」，见各文件顶部说明。
 */

import deepseekPulse from './deepseek-pulse.js'
import inkWash from './ink-wash.js'
import matrixRain from './matrix-rain.js'
import minimalFade from './minimal-fade.js'
import orbit from './orbit.js'
import starfield from './starfield.js'
import terminalBoot from './terminal-boot.js'

/** 内置模板列表（数组顺序 = 展示顺序）。 */
export const BUILTIN_TEMPLATES = [
  deepseekPulse,
  terminalBoot,
  starfield,
  matrixRain,
  orbit,
  minimalFade,
  inkWash,
]

/** 内置模板 id 集合，用于判断某个 id 是否可被删除/覆盖。 */
export const BUILTIN_IDS = new Set(BUILTIN_TEMPLATES.map((template) => template.id))

/** 按 id 找内置模板。 */
export function builtinTemplate(id) {
  return BUILTIN_TEMPLATES.find((template) => template.id === id)
}
