#!/usr/bin/env node
/**
 * 导出预览：把内置模板、示例模板或某个模板目录渲染成独立 HTML，浏览器直接打开即可看。
 *
 * 用法：
 *   node tools/preview.mjs                          # 列出所有内置模板
 *   node tools/preview.mjs starfield                # 导出到 ./preview-starfield.html
 *   node tools/preview.mjs starfield out.html       # 指定输出文件
 *   node tools/preview.mjs --all                    # 7 个内置模板 → ./previews/<id>.html
 *   node tools/preview.mjs --examples               # 内置 + examples/ 一起导出到 ./previews/
 *   node tools/preview.mjs --file examples/neon-scan.json [out.html]
 *   node tools/preview.mjs --dir <模板目录> [输出目录]
 */

import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { composePreviewDocument } from '../src/host/compose.js'
import { BUILTIN_TEMPLATES, builtinTemplate } from '../src/host/templates/index.js'
import { normalizeTemplate, textOf } from '../src/shared/validate.js'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** 写一份预览，并打印落点。 */
function write(target, template) {
  const document = composePreviewDocument({ template, loop: true })
  mkdirSync(dirname(target), { recursive: true })
  writeFileSync(target, document, 'utf8')
  console.log(`✔ ${template.id.padEnd(16)} → ${target}（${(Buffer.byteLength(document) / 1024).toFixed(1)} KiB）`)
}

/** 读一个模板 JSON 文件（自定义模板的存储格式）。 */
function readTemplateFile(path) {
  const raw = JSON.parse(readFileSync(path, 'utf8'))
  return normalizeTemplate({ ...raw, id: raw.id ?? basename(path, '.json') }, { requireDocument: true })
}

/** 读一个模板目录（$DSH_HOME/dsh-wallport/templates 的格式）。 */
function readTemplateDir(dir) {
  return readdirSync(dir)
    .filter((name) => name.endsWith('.json'))
    .map((name) => readTemplateFile(join(dir, name)))
}

function usage() {
  console.log('内置模板：')
  for (const template of BUILTIN_TEMPLATES) {
    console.log(`  ${template.id.padEnd(16)} ${textOf(template.name, 'zh')}  —  ${textOf(template.description, 'zh')}`)
  }
  console.log(`
用法：
  node tools/preview.mjs <模板id> [输出文件]
  node tools/preview.mjs --all
  node tools/preview.mjs --examples
  node tools/preview.mjs --file <模板.json> [输出文件]
  node tools/preview.mjs --dir <模板目录> [输出目录]`)
}

const args = process.argv.slice(2)
const [first, second, third] = args

if (first === undefined) {
  usage()
  process.exit(0)
}

if (first === '--all') {
  for (const template of BUILTIN_TEMPLATES) write(join(root, 'previews', `${template.id}.html`), template)
} else if (first === '--examples') {
  for (const template of BUILTIN_TEMPLATES) write(join(root, 'previews', `${template.id}.html`), template)
  for (const template of readTemplateDir(join(root, 'examples'))) {
    write(join(root, 'previews', `${template.id}.html`), template)
  }
} else if (first === '--file') {
  const template = readTemplateFile(resolve(second ?? ''))
  write(third === undefined ? join(root, 'previews', `${template.id}.html`) : resolve(third), template)
} else if (first === '--dir') {
  const outDir = third === undefined ? join(root, 'previews') : resolve(third)
  for (const template of readTemplateDir(resolve(second ?? ''))) write(join(outDir, `${template.id}.html`), template)
} else {
  const template = builtinTemplate(first)
  if (template === undefined) {
    console.error(`没有这个内置模板：${first}\n可用：${BUILTIN_TEMPLATES.map((item) => item.id).join(', ')}`)
    process.exit(1)
  }
  write(second === undefined ? join(root, `preview-${template.id}.html`) : resolve(second), template)
}
