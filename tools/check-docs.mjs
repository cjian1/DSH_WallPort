#!/usr/bin/env node
/**
 * 文档自检：README 之类「要发到 GitHub」的文档最容易出的两类问题——
 *   1. 相对链接指向不存在的文件（发布后变成 404）；
 *   2. 内置模板 / 文件清单和实际代码对不上（说了 7 个模板，结果只剩 6 个）。
 * 这个脚本把两件事都当断言来跑。
 *
 * 用法：node tools/check-docs.mjs
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { BUILTIN_TEMPLATES } from '../src/host/templates/index.js'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const DOCS = ['README.md', 'docs/AI-自定义指南.md', 'examples/README.md', 'CHANGELOG.md']

const failures = []
const note = (file, message) => failures.push(`${file}: ${message}`)

/**
 * 收集一个 markdown 文件里的相对链接目标（忽略 http(s)、mailto、纯锚点）。
 * 代码块和行内代码里的「链接」是示例文本，不算文档链接。
 */
function relativeLinks(markdown) {
  const stripped = markdown.replace(/```[\s\S]*?```/g, '').replace(/`[^`\n]*`/g, '')
  const targets = []
  const pattern = /\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g
  for (const match of stripped.matchAll(pattern)) {
    const target = match[1]
    if (/^(https?:|mailto:|#)/.test(target)) continue
    targets.push(target.split('#')[0])
  }
  return targets
}

/** GitHub 的标题锚点规则：小写、去掉标点（保留字母数字下划线连字符）、空格换连字符。 */
function slugify(heading) {
  return heading
    .trim()
    .toLowerCase()
    .replace(/`([^`]*)`/g, '$1')
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .replace(/\s+/g, '-')
}

for (const doc of DOCS) {
  const path = join(root, doc)
  if (!existsSync(path)) {
    note(doc, '文件不存在')
    continue
  }
  const markdown = readFileSync(path, 'utf8')

  for (const target of relativeLinks(markdown)) {
    if (target === '') continue
    const resolved = resolve(dirname(path), decodeURIComponent(target))
    if (!existsSync(resolved)) note(doc, `链接指向不存在的文件：${target}`)
  }

  // 目录/正文里的文档内锚点必须在标题里真的存在（发布了才发现死链最尴尬）
  const plain = markdown.replace(/```[\s\S]*?```/g, '')
  const slugs = new Set(
    [...plain.matchAll(/^#{1,6}\s+(.+)$/gm)].map((match) => slugify(match[1])),
  )
  for (const match of plain.matchAll(/\]\(#([^)\s]+)\)/g)) {
    const anchor = decodeURIComponent(match[1]).toLowerCase()
    if (!slugs.has(anchor)) note(doc, `锚点没有对应标题：#${match[1]}`)
  }

  // 文档里提到的模板预览必须真的存在
  for (const match of markdown.matchAll(/previews\/([a-z0-9-]+)\.html/g)) {
    if (!existsSync(join(root, 'previews', `${match[1]}.html`))) {
      note(doc, `引用了未生成的预览：previews/${match[1]}.html`)
    }
  }
}

// README 必须逐个介绍内置模板
const readme = readFileSync(join(root, 'README.md'), 'utf8')
for (const template of BUILTIN_TEMPLATES) {
  if (!readme.includes(`\`${template.id}\``)) note('README.md', `内置模板 \`${template.id}\` 没有出现在模板表里`)
}

// 目录结构清单里点到的路径必须存在
for (const required of ['index.js', 'client.js', 'cordis.patch.yml', 'src', 'docs', 'examples', 'previews', 'test', 'tools', 'LICENSE', 'CHANGELOG.md', '.github/workflows/checks.yml']) {
  if (!existsSync(join(root, required))) note('repo', `README 提到的 ${required} 不存在`)
}

// previews 目录里的文件数应与「内置模板 + examples 模板」一致
const previewFiles = existsSync(join(root, 'previews'))
  ? readdirSync(join(root, 'previews')).filter((name) => name.endsWith('.html'))
  : []
const exampleTemplates = readdirSync(join(root, 'examples')).filter((name) => name.endsWith('.json'))
const expectedPreviews = BUILTIN_TEMPLATES.length + exampleTemplates.length
if (previewFiles.length !== expectedPreviews) {
  note('previews', `应有 ${expectedPreviews} 个预览（${BUILTIN_TEMPLATES.length} 内置 + ${exampleTemplates.length} 示例），实际 ${previewFiles.length} 个：${previewFiles.join(', ')}`)
}

// CHANGELOG 最新版本必须和 package.json 一致（发版时最容易忘的一步）
const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const changelog = readFileSync(join(root, 'CHANGELOG.md'), 'utf8')
const latest = /^##\s+(\d+\.\d+\.\d+)/m.exec(changelog)?.[1]
if (latest !== manifest.version) {
  note('CHANGELOG.md', `最新条目是 ${latest ?? '(缺失)'}，package.json 是 ${manifest.version}`)
}

// 「复制链接一键安装」要把 UI 入口和可粘贴的写法写清楚，否则这条卖点是空的
for (const needle of ['Add plugin', 'github:', '重启一次 DSH']) {
  if (!readme.includes(needle)) note('README.md', `一键安装说明缺少「${needle}」`)
}

// README 里写的测试数量必须和 test/ 目录里实际的 test() 数量一致
const testFiles = readdirSync(join(root, 'test')).filter((name) => name.endsWith('.test.mjs'))
const declaredTests = testFiles.reduce(
  (sum, name) => sum + (readFileSync(join(root, 'test', name), 'utf8').match(/^test\(/gm) ?? []).length,
  0,
)
const claimed = [...readme.matchAll(/(\d+)\s*个测试/g)].map((match) => Number(match[1]))
claimed.push(...[...readme.matchAll(/Verified with (\d+) tests/g)].map((match) => Number(match[1])))
if (claimed.length === 0) note('README.md', '没有写测试数量（写了才能被这道自检盯住）')
for (const value of claimed) {
  if (value !== declaredTests) note('README.md', `写着 ${value} 个测试，实际 test/ 里有 ${declaredTests} 个`)
}

// 每个文件都别太大（GitHub 单文件 100MB 会拒绝，README 太长也没人看）
for (const path of ['README.md', 'docs/AI-自定义指南.md']) {
  const size = statSync(join(root, path)).size
  if (size > 64 * 1024) note(path, `文档过大：${(size / 1024).toFixed(1)} KiB`)
}

if (failures.length > 0) {
  console.error('✖ 文档自检失败：')
  for (const failure of failures) console.error(`  - ${failure}`)
  process.exit(1)
}
console.log(`✔ 文档自检通过：${DOCS.length} 个文档、${BUILTIN_TEMPLATES.length} 个内置模板、${previewFiles.length} 个预览`)
