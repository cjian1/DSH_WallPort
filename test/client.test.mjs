/**
 * 浏览器半侧冒烟测试：在一个沙箱里按 DSH 模块系统的真实契约执行 client.js。
 *
 * 覆盖：
 *   - `window.__ModuleLoader__.load({ id, factory })` 的形状；
 *   - 模块面导出的 name / inject / apply；
 *   - apply() 后真的往 `settings.section` 注册了「开机动画」分区；
 *   - 设置页能完成渲染（用真实双语文案，不联网）；
 *   - **能在「用 AI 自定义」里打字**：输入框是受控组件，打字会回显、会进提示词；
 *   - 完整提示词真的包含工具名与模板契约。
 *
 * 「打字会不会生效」这条曾经真的出过问题（当时那一段只能读不能写），
 * 所以这里用带 state 语义的 React 桩真实模拟 onChange + 重渲染，
 * 而不是只看一眼 DOM 结构。
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const source = readFileSync(join(root, 'client.js'), 'utf8')
const NS = 'dsh-boot-animation'

const SNAPSHOT = {
  settings: { enabled: true, minDurationMs: 1200, maxDurationMs: 12000, skippable: true },
  active: 'deepseek-pulse',
  enabled: true,
  degraded: false,
  baseDir: '/tmp/dsh-boot-animation',
  templates: [
    {
      id: 'deepseek-pulse',
      name: { zh: '深海脉冲', en: 'DeepSeek Pulse' },
      description: { zh: '品牌蓝呼吸光晕', en: 'Blue aura' },
      theme: 'dark',
      builtin: true,
      active: true,
      source: 'builtin',
      documentBytes: 8192,
    },
    {
      id: 'aurora-drift',
      name: { zh: '极光漂移', en: 'Aurora Drift' },
      description: { zh: 'AI 生成', en: 'AI generated' },
      theme: 'dark',
      builtin: false,
      active: false,
      source: 'ai',
      documentBytes: 7168,
    },
  ],
}

/**
 * 最小 React 桩，但**hooks 有真实语义**：
 * - 每个 hook 调用占一个槽位（顺序稳定），useState 的值跨渲染保留；
 * - setState 会触发重渲染，重渲染后的树可以继续断言。
 * useEffect 只占位不执行（避免测试里发起 fetch）。
 */
function makeReact({ firstState } = {}) {
  const hooks = []
  let slot = -1
  let rerender = () => {}

  const createElement = (type, props, ...children) => ({
    type: typeof type === 'function' ? type.name || 'Component' : type,
    props: { ...(props ?? {}), children: children.length === 0 ? undefined : children.length === 1 ? children[0] : children },
    rawType: type,
  })

  return {
    createElement,
    Fragment: 'Fragment',
    useState: (initial) => {
      const at = (slot += 1)
      if (!(at in hooks)) hooks[at] = at === 0 && firstState !== undefined ? firstState : initial
      const set = (next) => {
        hooks[at] = typeof next === 'function' ? next(hooks[at]) : next
        rerender()
      }
      return [hooks[at], set]
    },
    useRef: (initial) => {
      const at = (slot += 1)
      if (!(at in hooks)) hooks[at] = { current: initial }
      return hooks[at]
    },
    useEffect: () => {
      slot += 1
    },
    useMemo: (factory) => {
      slot += 1
      return factory()
    },
    useCallback: (fn) => {
      slot += 1
      return fn
    },
    /** 测试用：接上重渲染回调 / 每次渲染前重置槽位。 */
    __bind: (fn) => {
      rerender = fn
    },
    __reset: () => {
      slot = -1
    },
  }
}

/** 在沙箱里加载 client.js，返回模块面、注册结果与真实文案字典。 */
function loadClient({ react } = {}) {
  const React = react ?? makeReact()
  const registered = []
  const injected = []
  const warnings = []
  let module

  const require = (specifier) => {
    if (specifier === 'react') return React
    if (specifier === 'react/jsx-runtime') return { jsx: React.createElement, jsxs: React.createElement }
    throw new Error(`client.js 请求了未声明的模块：${specifier}`)
  }

  const sandbox = {
    window: {
      __ModuleLoader__: {
        load({ id, factory }) {
          assert.equal(id, NS, '模块 id 必须等于包名')
          module = factory(require)
        },
      },
      confirm: () => true,
    },
    navigator: { language: 'zh-CN', clipboard: { writeText: async () => {} } },
    fetch: async () => ({ ok: true, json: async () => SNAPSHOT }),
    setTimeout,
    clearTimeout,
    console: {
      log: () => {},
      warn: (message) => warnings.push(String(message)),
      error: (message) => warnings.push(String(message)),
    },
  }
  vm.createContext(sandbox)
  vm.runInContext(source, sandbox, { filename: 'client.js' })
  assert.ok(module !== undefined, 'client.js 必须调用 window.__ModuleLoader__.load()')

  /** 捕获真实双语文案：register 收到的字典就是产品里显示的那份。 */
  const dictionaries = {}
  const ctx = {
    locale: {
      register: (ns, dicts) => {
        dictionaries[ns] = dicts
        return () => {}
      },
      bind: (ns) => (key) => dictionaries[ns]?.zh?.[key] ?? key,
    },
    slots: {
      inject(key, callback) {
        injected.push(key)
        const iterator = callback()
        for (const value of iterator) registered.push(value)
        return () => {}
      },
      register(options, component) {
        return { ...options, component }
      },
    },
    effect: (callback) => {
      callback()
      return () => {}
    },
  }
  module.apply(ctx)
  return { module, registered, injected, warnings, React, dictionaries, ctx }
}

/** 收集渲染树里的所有文案（字符串子节点 + label/title/placeholder 属性）。 */
function collectStrings(node, out) {
  if (node === null || node === undefined || typeof node === 'boolean') return out
  if (typeof node === 'string') {
    out.push(node)
    return out
  }
  if (typeof node === 'number') {
    out.push(String(node))
    return out
  }
  if (Array.isArray(node)) {
    node.forEach((child) => collectStrings(child, out))
    return out
  }
  if (typeof node !== 'object') return out
  for (const key of ['label', 'title', 'placeholder']) {
    if (typeof node.props?.[key] === 'string') out.push(node.props[key])
  }
  collectStrings(node.props?.children, out)
  return out
}

/** 在渲染树里按 data-action 找节点。 */
function findActionNode(node, action) {
  if (node === null || node === undefined || typeof node !== 'object') return undefined
  if (Array.isArray(node)) {
    for (const child of node) {
      const hit = findActionNode(child, action)
      if (hit !== undefined) return hit
    }
    return undefined
  }
  if (node.props?.['data-action'] === action) return node
  return findActionNode(node.props?.children, action)
}

/** 在渲染树里按 className 找节点（className 可能是多个类名）。 */
function findNode(node, className) {
  if (node === null || node === undefined || typeof node !== 'object') return undefined
  if (Array.isArray(node)) {
    for (const child of node) {
      const hit = findNode(child, className)
      if (hit !== undefined) return hit
    }
    return undefined
  }
  const own = node.props?.className
  if (typeof own === 'string' && own.split(/\s+/).includes(className)) return node
  return findNode(node.props?.children, className)
}

/**
 * 挂载设置页：返回一个可交互的界面对象。
 * `type(className, value)` 模拟用户打字；`text()` 取当前所有文案。
 */
function mountSettings(firstState = SNAPSHOT) {
  const react = makeReact({ firstState })
  const client = loadClient({ react })
  const translate = (key) => client.dictionaries[NS]?.zh?.[key] ?? key
  let tree

  const render = () => {
    react.__reset()
    tree = client.registered[0].component({ t: translate })
  }
  react.__bind(render)
  render()

  return {
    ...client,
    get tree() {
      return tree
    },
    text: () => collectStrings(tree, []).join('\n'),
    strings: () => collectStrings(tree, []),
    find: (className) => findNode(tree, className),
    findAction: (action) => findActionNode(tree, action),
    type(className, value) {
      const node = findNode(tree, className)
      assert.ok(node !== undefined, `界面上找不到 .${className}`)
      assert.equal(typeof node.props.onChange, 'function', `.${className} 必须能接收输入（onChange）`)
      node.props.onChange({ target: { value } })
    },
    valueOf(className) {
      const node = findNode(tree, className)
      assert.ok(node !== undefined, `界面上找不到 .${className}`)
      return node.props.value
    },
    click(className) {
      const node = findNode(tree, className)
      assert.ok(node !== undefined, `界面上找不到 .${className}`)
      assert.equal(typeof node.props.onClick, 'function', `.${className} 必须可点击`)
      node.props.onClick()
    },
  }
}

test('client.js：模块系统契约与设置分区注册', () => {
  const { module, registered, injected } = loadClient()
  assert.equal(module.name, NS)
  assert.deepEqual([...module.inject].sort(), ['locale', 'slots'])
  assert.deepEqual(injected, ['settings.section'])
  assert.equal(registered.length, 1)

  const registration = registered[0]
  assert.equal(registration.name, 'settings.section')
  assert.equal(registration.id, 'boot-animation')
  assert.equal(typeof registration.label, 'function')
  assert.equal(registration.label(), '开机动画')
  assert.equal(typeof registration.component, 'function')
  assert.equal(typeof registration.inject, 'function')
  assert.deepEqual(Object.keys(registration.inject()), ['t'])
})

test('client.js：设置页渲染出开关、模板画廊与「用 AI 自定义」', () => {
  const ui = mountSettings()
  const text = ui.text()
  for (const expected of [
    '开机动画',
    '启用开机动画',
    '最短展示时长',
    '允许跳过',
    '模板',
    '使用中',
    '预览',
    '应用',
    'deepseek-pulse',
    '深海脉冲',
    'aurora-drift',
    '极光漂移',
    '用 AI 自定义',
    '复制提示词给 AI',
  ]) {
    assert.ok(text.includes(expected), `首屏应包含文案「${expected}」`)
  }
})

test('client.js：「用 AI 自定义」里可以打字，输入会回显并进入提示词', () => {
  const ui = mountSettings()

  // 1) 输入框存在、初始为空、带 placeholder
  const box = ui.find('dshba-idea')
  assert.ok(box !== undefined, '「用 AI 自定义」里必须有可输入的输入框')
  assert.equal(ui.valueOf('dshba-idea'), '')
  assert.ok(String(box.props.placeholder).length > 0, '输入框应有 placeholder 引导')

  // 2) 打字 → 回显（受控组件真的接上了 setState）
  const typed = '赛博霓虹，紫粉色光带 + 扫描线，节奏快一点'
  ui.type('dshba-idea', typed)
  assert.equal(ui.valueOf('dshba-idea'), typed, '输入后输入框应显示刚打的内容')

  // 3) 打的字进入提示词
  const text = ui.text()
  assert.ok(text.includes(typed), '完整提示词应带上用户输入的内容')
  const prompt = ui
    .strings()
    .filter((value) => typeof value === 'string' && value.includes('boot_animation_save'))
    .sort((a, b) => b.length - a.length)[0]
  assert.ok(prompt !== undefined && prompt.includes(typed), '最长那段提示词里应包含用户输入')

  // 4) 点示例 → 填进输入框（而不是只复制）
  ui.click('dshba-chip')
  const filled = ui.valueOf('dshba-idea')
  assert.ok(filled.includes('赛博霓虹风格'), `点示例应把示例填进输入框，实际：${filled}`)

  // 5) 清空（按 data-action 精确定位，别误点模板卡片上的按钮）
  const clear = ui.findAction('clear-idea')
  assert.ok(clear !== undefined, '应有「清空」按钮')
  assert.equal(clear.props.disabled, false, '有内容时「清空」应可用')
  clear.props.onClick()
  assert.equal(ui.valueOf('dshba-idea'), '', '「清空」应清掉输入框')
  assert.equal(ui.findAction('clear-idea').props.disabled, true, '清空后按钮应禁用')

  // 复制按钮：没写字时禁用，写了字可用
  assert.equal(ui.findAction('copy-prompt').props.disabled, true, '没写内容时复制按钮应禁用')
  ui.type('dshba-idea', '极简风')
  assert.equal(ui.findAction('copy-prompt').props.disabled, false, '写了内容后复制按钮应可用')

  // 6) 手动导入的 textarea 同样可输入
  ui.type('dshba-textarea', '{"id":"my-boot","document":"<p>x</p>"}')
  assert.ok(ui.valueOf('dshba-textarea').includes('my-boot'), '手动导入框也应能打字')
})

test('client.js：完整提示词包含工具名与模板契约（可直接粘给 AI）', () => {
  const ui = mountSettings()
  ui.type('dshba-idea', '水墨风，浅色底，落款「深度求索」')
  const prompt = ui
    .strings()
    .filter((value) => typeof value === 'string' && value.includes('boot_animation_save'))
    .sort((a, b) => b.length - a.length)[0]
  assert.ok(prompt !== undefined, '应给出一份包含工具用法的完整提示词')

  for (const needle of [
    'boot_animation_save',
    'boot_animation_preview',
    'activate',
    'dshBootAnim',
    'progress()',
    'reduced()',
    '不依赖任何网络资源',
    '不要依赖 DSH 的 CSS 变量',
    '我想要的样子',
    '水墨风，浅色底，落款「深度求索」',
  ]) {
    assert.ok(prompt.includes(needle), `完整提示词应包含「${needle}」`)
  }
  assert.ok(prompt.split('\n').length >= 10, `完整提示词应该多行，实际 ${prompt.split('\n').length} 行`)
})

test('client.js：代码里用到的每个文案 key 都在中英文字典里', () => {
  const keys = new Set([...source.matchAll(/\bt\('([A-Za-z0-9_]+)'\)/g)].map((match) => match[1]))
  assert.ok(keys.size > 20, `应能扫到足够多的文案 key，实际 ${keys.size}`)
  const { dictionaries } = loadClient()
  const { zh, en } = dictionaries[NS]
  const missingZh = [...keys].filter((key) => !(key in zh))
  const missingEn = [...keys].filter((key) => !(key in en))
  assert.deepEqual(missingZh, [], `中文文案缺少：${missingZh.join(', ')}`)
  assert.deepEqual(missingEn, [], `英文文案缺少：${missingEn.join(', ')}`)
})

test('client.js：还没加载完时显示加载提示而不是崩掉', () => {
  const ui = mountSettings(null)
  assert.ok(ui.text().includes('正在读取开机动画设置'), '加载中应显示提示')
})
