/**
 * 文档自检：README 是要发到 GitHub 的门面，链接失效或数字对不上都属于「发出去才发现」的问题。
 * 这里直接跑 tools/check-docs.mjs，把它的断言变成测试的一部分。
 */

import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

test('文档自检：README 的相对链接都能打开、模板清单与代码一致', () => {
  const output = execFileSync(process.execPath, [join(root, 'tools', 'check-docs.mjs')], {
    cwd: root,
    encoding: 'utf8',
  })
  assert.ok(output.includes('✔'), `自检应通过，实际输出：${output}`)
})
