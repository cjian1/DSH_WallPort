/**
 * 开发用：读取 Electron app.asar 里的文件。
 *
 * 只为「对着真 DSH 的代码做一致性测试」服务（见 test/conformance.test.mjs、test/install.test.mjs）。
 * 生产代码不用它；asar 缺失时相关测试自动跳过。
 *
 * asar 布局： [u32 payloadSize=4][u32 headerLen][u32 headerPayload][u32 jsonLen][json][padding][files…]
 * 标了 unpacked 的条目不在包里，而在旁边的 `app.asar.unpacked/` 目录。
 */

import fs from 'node:fs'

/** 解析过的 header（DSH 的 header 有上万个条目，每个包只解析一次）。 */
const cache = new Map()

/** 读 asar 的 header，返回 header 与数据区起点（不留打开的文件句柄）。 */
export function readAsarHeader(archive) {
  const fd = fs.openSync(archive, 'r')
  try {
    const head = Buffer.alloc(16)
    fs.readSync(fd, head, 0, 16, 0)
    const jsonLen = head.readUInt32LE(12)
    const json = Buffer.alloc(jsonLen)
    fs.readSync(fd, json, 0, jsonLen, 16)
    const header = JSON.parse(json.toString('utf8'))
    const unpadded = 16 + jsonLen
    const base = unpadded + ((4 - (unpadded % 4)) % 4)
    return { header, base }
  } finally {
    fs.closeSync(fd)
  }
}

/** 展平 header 成 [{ path, size, offset, unpacked }]。 */
export function listEntries(header, node = header, prefix = '', out = []) {
  for (const [name, value] of Object.entries(node.files ?? {})) {
    const path = `${prefix}/${name}`
    if (value.files) listEntries(header, value, path, out)
    else out.push({ path, size: value.size, offset: value.unpacked ? undefined : Number(value.offset), unpacked: value.unpacked === true })
  }
  return out
}

/** 解析并缓存一个包：{ base, entries: Map<path, entry> }。 */
function load(archive) {
  let loaded = cache.get(archive)
  if (loaded === undefined) {
    const { header, base } = readAsarHeader(archive)
    loaded = { base, entries: new Map(listEntries(header).map((entry) => [entry.path, entry])) }
    cache.set(archive, loaded)
  }
  return loaded
}

/** 默认的 DSH 安装路径（可用 DSH_ASAR 覆盖）。 */
export function defaultAsarPath() {
  if (process.env.DSH_ASAR) return process.env.DSH_ASAR
  return '/Applications/DeepSeek Harness.app/Contents/Resources/app.asar'
}

/** 读一个条目为字符串；不存在时抛错。 */
export function readEntry(archive, entryPath) {
  const { base, entries } = load(archive)
  const entry = entries.get(entryPath)
  if (entry === undefined) throw new Error(`asar 里没有 ${entryPath}`)
  if (entry.unpacked) return fs.readFileSync(`${archive}.unpacked${entryPath}`, 'utf8')
  const fd = fs.openSync(archive, 'r')
  try {
    const buffer = Buffer.alloc(entry.size)
    fs.readSync(fd, buffer, 0, entry.size, base + entry.offset)
    return buffer.toString('utf8')
  } finally {
    fs.closeSync(fd)
  }
}

/** 条目是否存在。 */
export function hasEntry(archive, entryPath) {
  try {
    return load(archive).entries.has(entryPath)
  } catch {
    return false
  }
}
