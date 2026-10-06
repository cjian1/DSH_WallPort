/**
 * 运行时行为测试：在没有浏览器的环境里验证覆层的生命周期。
 *
 * 这是整个插件风险最高的一段逻辑——如果它不退出，用户就会看到一块盖住界面的黑屏。
 * 这里用最小 DOM 打桩真实执行 src/host/runtime.js 的 bootOverlayRuntime()，
 * 覆盖三条退出路径：应用挂载完成、原生启动界面报错、超时兜底，
 * 外加一次「模板拿得到真实进度」的桥接调用。
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import { bootOverlayRuntime } from '../src/host/runtime.js'
import { OVERLAY_ID } from '../src/shared/constants.js'

class FakeElement {
  constructor(tag) {
    this.tagName = String(tag).toUpperCase()
    this.attrs = new Map()
    this.children = []
    this.parentNode = null
    this.styleValues = new Map()
    this.listeners = new Map()
    this.textContent = ''
    this.className = ''
    this.contentWindow = undefined
    this.style = {
      setProperty: (key, value) => this.styleValues.set(key, String(value)),
      getPropertyValue: (key) => this.styleValues.get(key) ?? '',
    }
  }
  setAttribute(key, value) {
    this.attrs.set(key, String(value))
  }
  getAttribute(key) {
    return this.attrs.has(key) ? this.attrs.get(key) : null
  }
  hasAttribute(key) {
    return this.attrs.has(key)
  }
  appendChild(child) {
    child.parentNode = this
    this.children.push(child)
    documentMock.all.push(child)
    return child
  }
  removeChild(child) {
    const at = this.children.indexOf(child)
    if (at >= 0) this.children.splice(at, 1)
    const anywhere = documentMock.all.indexOf(child)
    if (anywhere >= 0) documentMock.all.splice(anywhere, 1)
    child.parentNode = null
    return child
  }
  addEventListener(type, fn) {
    const list = this.listeners.get(type) ?? []
    list.push(fn)
    this.listeners.set(type, list)
  }
  querySelector(selector) {
    if (selector === 'iframe.dshba-frame') return this.children.find((child) => child.tagName === 'IFRAME' && child.className === 'dshba-frame') ?? null
    if (selector === 'button.dshba-skip') return this.children.find((child) => child.tagName === 'BUTTON') ?? null
    return null
  }
}

const documentMock = {
  all: [],
  body: undefined,
  documentElement: undefined,
  getElementById(id) {
    return this.all.find((element) => element.attrs.get('id') === id) ?? null
  },
  querySelector(selector) {
    if (selector === '[data-dsh-boot-spinner]') return this.all.find((element) => element.hasAttribute('data-dsh-boot-spinner')) ?? null
    if (selector === '[data-dsh-boot]') return this.all.find((element) => element.hasAttribute('data-dsh-boot')) ?? null
    return null
  },
  createElement(tag) {
    return new FakeElement(tag)
  },
}

/** 重置出一套干净的假文档：<body><div id="root"></div><div id="dsh-boot-animation"></div></body> */
function setupDom() {
  documentMock.all = []
  documentMock.body = new FakeElement('body')
  documentMock.documentElement = new FakeElement('html')
  documentMock.all.push(documentMock.body, documentMock.documentElement)
  const root = documentMock.body.appendChild(new FakeElement('div'))
  root.setAttribute('id', 'root')
  const host = documentMock.body.appendChild(new FakeElement('div'))
  host.setAttribute('id', OVERLAY_ID)
  return { root, host }
}

function setupWindow(events) {
  const win = {
    intervals: new Set(),
    timeouts: new Set(),
    matchMedia: () => ({ matches: false }),
    setInterval: (fn, ms) => {
      const id = setInterval(fn, ms)
      win.intervals.add(id)
      return id
    },
    clearInterval: (id) => {
      win.intervals.delete(id)
      clearInterval(id)
    },
    setTimeout: (fn, ms) => {
      const id = setTimeout(() => {
        win.timeouts.delete(id)
        fn()
      }, ms)
      win.timeouts.add(id)
      return id
    },
    addEventListener: (type, fn) => events.push([type, fn]),
    console: { debug: () => {} },
  }
  return win
}

/** 跑一次覆层：返回 { host, frame, pushes, fireClick } */
function runOverlay(overrides = {}, { fetchImpl } = {}) {
  const { root, host } = setupDom()
  const events = []
  const win = setupWindow(events)
  const debugs = []
  win.console = { debug: (...args) => debugs.push(args) }
  if (fetchImpl !== undefined) win.fetch = fetchImpl
  const pushes = []
  const config = {
    overlayId: OVERLAY_ID,
    bridgeName: 'dshBootAnim',
    document: '<!doctype html><html><body><p>tpl</p></body></html>',
    minDurationMs: 0,
    maxDurationMs: 400,
    skippable: true,
    templateId: 'test-template',
    ...overrides,
  }
  const runtime = new Function(
    'window',
    'document',
    'navigator',
    `(${bootOverlayRuntime.toString()})(${JSON.stringify(config)})`,
  )
  runtime(win, documentMock, { language: 'zh-CN' })

  const frame = host.querySelector('iframe.dshba-frame')
  // 模拟模板侧已创建桥接对象
  if (frame) {
    frame.contentWindow = {
      dshBootAnim: {
        _set: (key, value) => pushes.push([key, value]),
      },
    }
  }
  const clickHandlers = events.filter(([type]) => type === 'click').map(([, fn]) => fn)
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
  return {
    root,
    host,
    frame,
    pushes,
    debugs,
    fireClick: () => clickHandlers.forEach((fn) => fn({ key: 'Escape' })),
    wait,
  }
}

/** 造一个只有 JSON 能力的 fetch 替身。 */
function jsonFetch(payload, calls = []) {
  return (url) => {
    calls.push(String(url))
    return Promise.resolve({ ok: true, json: () => Promise.resolve(payload) })
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

test('应用挂载后覆层淡出并从 DOM 移除', async () => {
  const overlay = runOverlay()
  assert.ok(overlay.frame !== null, '应该创建了 iframe')
  assert.ok(String(overlay.frame.getAttribute('srcdoc')).includes('<p>tpl</p>'), 'iframe.srcdoc 应该拿到模板文档')
  assert.ok(overlay.host.querySelector('button.dshba-skip') !== null, '可跳过时应渲染跳过按钮')

  // 原生启动视图出现 → 然后消失（= React 挂载完成）
  const boot = documentMock.body.appendChild(new FakeElement('div'))
  boot.setAttribute('data-dsh-boot', '')
  await sleep(150)
  documentMock.body.removeChild(boot)
  const app = overlay.root.appendChild(new FakeElement('div'))
  app.setAttribute('data-app', '')

  await sleep(700)
  assert.equal(documentMock.getElementById(OVERLAY_ID), null, '覆层应该已经从 DOM 移除')
  assert.ok(overlay.pushes.some(([key, value]) => key === 'phase' && value === 'done'), '应该通知模板进入 done')
  assert.ok(overlay.pushes.some(([key, value]) => key === 'visible' && value === false), '应该通知模板隐藏')
})

test('真实进度通过桥接推给模板', async () => {
  const overlay = runOverlay()
  const boot = documentMock.body.appendChild(new FakeElement('div'))
  boot.setAttribute('data-dsh-boot', '')
  const spinner = boot.appendChild(new FakeElement('span'))
  spinner.setAttribute('data-dsh-boot-spinner', '')
  spinner.style.setProperty('--dsh-boot-arc', '180deg')

  await sleep(200)
  const progress = overlay.pushes.filter(([key]) => key === 'progress').map(([, value]) => value)
  assert.ok(progress.length > 0, '应该推送过 progress')
  assert.ok(Math.abs(progress[progress.length - 1] - 0.5) < 0.001, `180deg 应换算成 0.5，实际 ${progress[progress.length - 1]}`)

  overlay.fireClick()
  await sleep(600)
  assert.equal(documentMock.getElementById(OVERLAY_ID), null, '点击跳过后覆层应移除')
})

test('原生启动报错时立刻让路（不遮挡错误信息）', async () => {
  const overlay = runOverlay()
  const boot = documentMock.body.appendChild(new FakeElement('div'))
  boot.setAttribute('data-dsh-boot', '')
  boot.textContent = 'Failed to load plugins\nfoo: import failed'
  await sleep(700)
  assert.equal(documentMock.getElementById(OVERLAY_ID), null, '启动失败时覆层必须退出')
  assert.ok(overlay.pushes.some(([key, value]) => key === 'phase' && value === 'done'))
})

test('没有原生启动视图时按兜底时长退出', async () => {
  runOverlay()
  assert.ok(documentMock.getElementById(OVERLAY_ID) !== null)
  await sleep(1100)
  assert.equal(documentMock.getElementById(OVERLAY_ID), null, 'maxDurationMs 之后必须退出')
})

test('页面加载时与宿主核对，模板变了就热切换', async () => {
  const calls = []
  const overlay = runOverlay(
    { api: '/dsh-boot-animation-7f3a/api', rev: 'test-template-deadbeef', maxDurationMs: 800 },
    {
      fetchImpl: jsonFetch(
        {
          rev: 'aurora-drift-1234abcd',
          id: 'aurora-drift',
          changed: true,
          enabled: true,
          settings: { enabled: true, minDurationMs: 0, maxDurationMs: 800, skippable: false },
          document: '<!doctype html><html><body><p>NEW-TEMPLATE</p></body></html>',
        },
        calls,
      ),
    },
  )
  assert.equal(calls.length, 1, '应该请求一次当前生效模板')
  assert.ok(calls[0].includes('/active?rev=test-template-deadbeef'), `rev 应带上注入行里的快照：${calls[0]}`)
  await sleep(80)
  assert.ok(
    String(overlay.frame.getAttribute('srcdoc')).includes('NEW-TEMPLATE'),
    '模板变了应该把 iframe 热切换过去',
  )
  await sleep(1500)
  assert.equal(documentMock.getElementById(OVERLAY_ID), null, '热切换后仍应正常退出')
})

test('宿主说动画已关闭时立即让路', async () => {
  const overlay = runOverlay(
    { api: '/dsh-boot-animation-7f3a/api', rev: 'test-template-deadbeef' },
    {
      fetchImpl: jsonFetch({
        rev: 'test-template-deadbeef',
        changed: false,
        enabled: false,
        settings: { enabled: false },
      }),
    },
  )
  await sleep(1200)
  assert.equal(documentMock.getElementById(OVERLAY_ID), null, '关闭后覆层必须退出')
  assert.ok(
    overlay.debugs.some((args) => String(args[1]) === 'disabled'),
    `退出原因应为 disabled，实际 ${JSON.stringify(overlay.debugs)}`,
  )
})

test('核对请求失败也不影响动画退出', async () => {
  const overlay = runOverlay(
    { api: '/dsh-boot-animation-7f3a/api', rev: 'test-template-deadbeef' },
    { fetchImpl: () => Promise.reject(new Error('offline')) },
  )
  await sleep(1200)
  assert.equal(documentMock.getElementById(OVERLAY_ID), null)
  assert.ok(overlay.debugs.length > 0)
})
