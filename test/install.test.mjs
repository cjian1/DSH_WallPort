/**
 * 「复制链接就能装」的一致性测试。
 *
 * DSH 侧边栏的 Plugins 页面有一个 **Add plugin** 输入框，接受包名 / Git 地址 /
 * tarball / 绝对路径。用户要的「复制链接一键安装」就是把仓库地址粘进去。
 *
 * 这个测试做两件事：
 *   1. 用 **DSH 自己的** parseInstallSpec()（从 app.asar 里取出来执行）验证我们在
 *      README 里写给用户的那几种写法真的会被接受、并且被识别成正确的类型；
 *   2. 守住安装不被「兼容性闸门」拦下：package.json 不能声明 peerDependencies
 *      （插件刻意不静态 import 任何宿主包，声明 peer 只会变成一道可能拒绝安装的检查）。
 */

import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { defaultAsarPath, hasEntry, readEntry } from '../tools/asar.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const asar = defaultAsarPath()
const installSpecPath = '/dsh/node_modules/@deepseek-ai/dsh-plugin-manager/lib/types/install-spec.js'
const available = existsSync(asar) && hasEntry(asar, installSpecPath)

/** 把 DSH 的 install-spec 模块解出来跑（它只依赖 node:path）。 */
async function loadParseInstallSpec() {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-wallport-spec-'))
  const file = join(dir, 'install-spec.mjs')
  writeFileSync(file, readEntry(asar, installSpecPath), 'utf8')
  try {
    const module = await import(pathToFileURL(file).href)
    return { parseInstallSpec: module.parseInstallSpec, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
  } catch (error) {
    rmSync(dir, { recursive: true, force: true })
    throw error
  }
}

test('DSH 自己的 parseInstallSpec 接受 README 里写给用户的写法', { skip: !available }, async () => {
  const { parseInstallSpec, cleanup } = await loadParseInstallSpec()
  try {
    /** README「一键安装」一节里出现过的几种写法。 */
    const accepted = [
      ['https://github.com/example/DSH_WallPort', 'git', 'github.com'],
      ['https://github.com/example/DSH_WallPort.git', 'git', 'github.com'],
      ['github:example/DSH_WallPort', 'git', 'github.com'],
      ['git+https://github.com/example/DSH_WallPort.git', 'git', 'github.com'],
      ['git@github.com:example/DSH_WallPort.git', 'git', 'github.com'],
      ['/Users/me/DSH_WallPort', 'path', undefined],
      ['/Users/me/DSH_WallPort-0.1.1.tgz', 'tarball', undefined],
      ['https://example.com/DSH_WallPort-0.1.1.tgz', 'tarball', 'example.com'],
      ['dsh-boot-animation', 'registry', undefined],
      ['dsh-boot-animation@0.1.1', 'registry', undefined],
    ]
    for (const [spec, kind, host] of accepted) {
      const parsed = parseInstallSpec(spec)
      assert.equal(parsed.kind, kind, `${spec} 应被识别为 ${kind}，实际 ${parsed.kind}`)
      if (host !== undefined) assert.equal(parsed.host, host, `${spec} 的 host 应为 ${host}`)
      assert.equal(parsed.spec, spec, '解析结果应保留原始 spec')
    }

    // README 里明确写了「相对路径不行」——这里顺手验证这句话是对的
    assert.throws(() => parseInstallSpec('./DSH_WallPort'), /absolute/)
    assert.throws(() => parseInstallSpec(''), /must not be empty/)
    assert.throws(() => parseInstallSpec('https://example.com/not-a-repo'), /git repository or a tarball/)
  } finally {
    cleanup()
  }
})

test('安装不会被 peerDependencies 兼容检查拦下', () => {
  // DSH 在安装前（registry 规格）或安装后（git/tarball 规格）会拿包声明的 peers
  // 和当前运行时比对，不满足就直接拒绝。本插件刻意不静态 import 任何宿主包，
  // 所以不需要 peer；一旦有人加回来，这条测试会挡住。
  assert.equal(manifest.peerDependencies, undefined, 'package.json 不应声明 peerDependencies')
  assert.equal(manifest.peerDependenciesMeta, undefined, 'package.json 不应声明 peerDependenciesMeta')
  assert.deepEqual(manifest.dependencies, undefined, '插件不依赖任何包')
})

test('清单具备「能被当成 bundle 安装」的三要素', () => {
  assert.equal(manifest.private, true, '私有包：防止误发 npm；GitHub 安装不受影响')
  assert.equal(manifest.type, 'module')
  assert.equal(manifest.dsh?.bundle?.patch, './cordis.patch.yml', '必须声明 bundle patch')
  assert.equal(manifest.dsh?.client?.platform, 'web', '必须声明浏览器半侧')
  assert.equal(manifest.exports?.['.'], './index.js')
  assert.equal(manifest.exports?.['./client'], './client.js')
  assert.ok(existsSync(join(root, manifest.dsh.bundle.patch)), 'patch 文件必须存在')
  assert.ok(existsSync(join(root, 'client.js')), 'client 入口必须存在')
  // 安装下来的包会按 files 决定内容（npm/tarball 路径），GitHub 安装是整仓库
  for (const required of ['index.js', 'client.js', 'src', 'cordis.patch.yml']) {
    assert.ok(manifest.files.includes(required), `files 应包含 ${required}`)
  }
})
