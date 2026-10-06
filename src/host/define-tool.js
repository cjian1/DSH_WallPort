/**
 * 本地的工具定义器。
 *
 * 为什么不用 @deepseek-ai/dsh-tools 的 defineTool：插件是以 `link:` 方式装进
 * profile 的（真实路径在工作区），而 DSH 的裸包名解析拦截层只覆盖 profile 内部
 * 的模块——从工作区路径出发 import '@deepseek-ai/dsh-tools' 会直接
 * ERR_MODULE_NOT_FOUND。工具定义本身只是「JSON Schema + execute + render」，
 * 这里按同一个形状自己产出，插件因此不依赖任何宿主包就能注册工具。
 *
 * ctx.tools.register() 收到的是最终定义（parameters 已经是 JSON Schema），
 * 与 defineTool() 的产物同形；这里额外做一层宽松的入参校验，让模型传错参数时
 * 报错清晰。
 */

/** 参数 schema 里允许的类型（够本插件用，也是 DSH 支持的子集）。 */
const TYPES = new Set(['string', 'number', 'integer', 'boolean', 'array', 'object'])

function assertJsonSchema(schema, where) {
  if (schema === null || typeof schema !== 'object' || Array.isArray(schema)) {
    throw new Error(`defineTool: ${where} 必须是 JSON Schema 对象`)
  }
  if (schema.type !== undefined && !TYPES.has(schema.type)) {
    throw new Error(`defineTool: ${where}.type 不支持 ${JSON.stringify(schema.type)}`)
  }
}

/** 极简校验：必填、类型、枚举。返回违规描述数组（空 = 通过）。 */
function validateArgs(schema, args, path = '') {
  const violations = []
  const where = path === '' ? '参数' : path
  if (args === null || typeof args !== 'object' || Array.isArray(args)) {
    return [`${where} 必须是对象`]
  }
  const properties = schema.properties ?? {}
  for (const key of schema.required ?? []) {
    if (args[key] === undefined || args[key] === null) violations.push(`${where}.${key} 必填`)
  }
  for (const [key, value] of Object.entries(args)) {
    if (value === undefined || value === null) continue
    const spec = properties[key]
    if (spec === undefined) {
      if (schema.additionalProperties === false) violations.push(`${where}.${key} 不是已知参数`)
      continue
    }
    if (spec.enum !== undefined && !spec.enum.includes(value)) {
      violations.push(`${where}.${key} 必须是 ${spec.enum.map((item) => JSON.stringify(item)).join(' | ')} 之一`)
      continue
    }
    const type = spec.type
    if (type === 'integer' && !Number.isInteger(value)) violations.push(`${where}.${key} 必须是整数`)
    else if (type === 'number' && typeof value !== 'number') violations.push(`${where}.${key} 必须是数字`)
    else if (type === 'string' && typeof value !== 'string') violations.push(`${where}.${key} 必须是字符串`)
    else if (type === 'boolean' && typeof value !== 'boolean') violations.push(`${where}.${key} 必须是布尔值`)
    else if (type === 'array' && !Array.isArray(value)) violations.push(`${where}.${key} 必须是数组`)
  }
  return violations
}

/**
 * 定义一个工具。
 * @param options.name - 模型可见的工具名。
 * @param options.description - 模型可见的描述。
 * @param options.parameters - 完整 JSON Schema（type: object）。
 * @param options.output - { schema, render(args, value) }。
 * @param options.execute - (args, exec) => value | Promise<value>。
 * @param options.presentCall - 可选：会话里展示调用卡片。
 */
export function defineTool(options) {
  if (typeof options?.name !== 'string' || options.name === '') throw new Error('defineTool: name 不能为空')
  if (typeof options.execute !== 'function') throw new Error(`defineTool(${options.name}): execute 必须是函数`)
  const parameters = options.parameters ?? { type: 'object', properties: {}, additionalProperties: false }
  assertJsonSchema(parameters, `${options.name}.parameters`)
  if (options.output?.schema !== undefined) assertJsonSchema(options.output.schema, `${options.name}.output.schema`)

  const tool = {
    name: options.name,
    description: options.description ?? '',
    parameters,
    output: {
      schema: options.output?.schema ?? { type: 'object', additionalProperties: true },
      render: options.output?.render ?? (() => []),
    },
    async execute(args, exec) {
      const violations = validateArgs(parameters, args ?? {})
      if (violations.length > 0) {
        const error = new Error(`invalid arguments: ${violations.join('; ')}`)
        error.code = 'INVALID_ARGS'
        throw error
      }
      return options.execute(args ?? {}, exec)
    },
  }
  if (typeof options.presentCall === 'function') {
    tool.presentCall = (args) => (validateArgs(parameters, args ?? {}).length > 0 ? undefined : options.presentCall(args))
  }
  return tool
}
