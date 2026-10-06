/**
 * 开发用：读取 Electron app.asar 里的文件。
 *
 * 只为「对着真 DSH 的注入渲染器做一致性测试」服务（见 test/conformance.test.mjs）。
 * 生产代码不用它；asar 缺失时相关测试自动跳过。
 *
 * asar 布局： [u32 payloadSize=4][u32 headerLen][u32 headerPayload][u32 jsonLen][json][padding][files…]
 */

import fs from 'node:fs'

/** 打开 asar，返回 header、数据区起点与 json 长度。 */
export function readAsarHeader(archive) {
  const fd = fs.openSync(archive, 'r')
  const head = Buffer.alloc(16)
  fs.readSync(fd, head, 0, 16, 0)
  const jsonLen = head.readUInt32LE(12)
  const json = Buffer.alloc(jsonLen)
  fs.readSync(fd, json, 0, jsonLen, 16)
  const header = JSON.parse(json.toString('utf8'))
  const unpadded = 16 + jsonLen
  const base = unpadded + ((4 - (unpadded % 4)) % 4)
  return { fd, header, base }
}

/** 展平 header 成 [{ path, size, offset }]。 */
export function listEntries(header, node = header, prefix = '', out = []) {
  for (const [name, value] of Object.entries(node.files ?? {})) {
    const path = `${prefix}/${name}`
    if (value.files) listEntries(header, value, path, out)
    else out.push({ path, size: value.size, offset: Number(value.offset) })
  }
  return out
}

/** 默认的 DSH 安装路径（可用 DSH_ASAR 覆盖）。 */
export function defaultAsarPath() {
  if (process.env.DSH_ASAR) return process.env.DSH_ASAR
  return '/Applications/DeepSeek Harness.app/Contents/Resources/app.asar'
}

/** 读一个条目为字符串；不存在时抛错。 */
export function readEntry(archive, entryPath) {
  const { fd, header, base } = readAsarHeader(archive)
  const entry = listEntries(header).find((item) => item.path === entryPath)
  if (entry === undefined) throw new Error(`asar 里没有 ${entryPath}`)
  const buffer = Buffer.alloc(entry.size)
  fs.readSync(fd, buffer, 0, entry.size, base + entry.offset)
  return buffer.toString('utf8')
}

/** 条目是否存在。 */
export function hasEntry(archive, entryPath) {
  try {
    const { header } = readAsarHeader(archive)
    return listEntries(header).some((item) => item.path === entryPath)
  } catch {
    return false
  }
}
