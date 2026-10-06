#!/usr/bin/env node
/**
 * 语法自检：对插件里所有 JS 跑一次 `node --check`（ESM/CJS 由最近的 package.json 决定）。
 * 用法：node tools/syntax-check.mjs
 */

import { execFileSync } from 'node:child_process'
import { readdirSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '.git') continue
    const path = join(dir, name)
    if (statSync(path).isDirectory()) walk(path, out)
    else if (name.endsWith('.js') || name.endsWith('.mjs')) out.push(path)
  }
  return out
}

const files = [
  ...walk(join(root, 'src')),
  ...walk(join(root, 'tools')),
  ...walk(join(root, 'test')),
  join(root, 'index.js'),
  join(root, 'client.js'),
]

let failed = 0
for (const file of files) {
  try {
    execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' })
  } catch (error) {
    failed += 1
    console.error(`✖ ${relative(root, file)}\n${error.stderr?.toString() ?? error.message}`)
  }
}
if (failed > 0) {
  console.error(`\n${failed} 个文件语法检查失败`)
  process.exit(1)
}
console.log(`✔ ${files.length} 个文件语法检查通过`)
