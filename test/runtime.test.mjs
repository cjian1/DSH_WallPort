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

import { bootBridge, bootOverlayRuntime, bootPreviewSimulator } from '../src/host/runtime.js'
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

/** 重置出一套干净的假文档：<body><div id="root"></div><div id="dsh-wallport"></div></body> */
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
    clearTimeout: (id) => {
      win.timeouts.delete(id)
      clearTimeout(id)
    },
    addEventListener: (type, fn) => events.push([type, fn]),
    removeEventListener: (type, fn) => {
      const at = events.findIndex(([t, f]) => t === type && f === fn)
      if (at >= 0) events.splice(at, 1)
    },
    console: { debug: () => {} },
  }
  return win
}

/** 造一个能看出有没有被吞掉的输入事件。 */
function inputEvent(type, extra = {}) {
  const event = {
    type,
    prevented: false,
    stopped: false,
    preventDefault() {
      this.prevented = true
    },
    stopPropagation() {
      this.stopped = true
    },
    ...extra,
  }
  return event
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
  /** 按真实顺序把一个事件派给 window 上登记的监听（拿当下的列表：摘掉的监听不会再收到）。 */
  const dispatch = (event) => {
    for (const [type, fn] of [...events]) if (type === event.type) fn(event)
    return event
  }
  return {
    root,
    host,
    frame,
    pushes,
    debugs,
    events,
    dispatch,
    fireClick: () => clickHandlers.forEach((fn) => fn({ key: 'Escape' })),
    /** 模拟 iframe 文档加载完成（触发 load 监听）。 */
    loadFrame: () => (frame.listeners.get('load') ?? []).forEach((fn) => fn()),
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
    { api: '/dsh-wallport-7f3a/api', rev: 'test-template-deadbeef', maxDurationMs: 800 },
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
    { api: '/dsh-wallport-7f3a/api', rev: 'test-template-deadbeef' },
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
    { api: '/dsh-wallport-7f3a/api', rev: 'test-template-deadbeef' },
    { fetchImpl: () => Promise.reject(new Error('offline')) },
  )
  await sleep(1200)
  assert.equal(documentMock.getElementById(OVERLAY_ID), null)
  assert.ok(overlay.debugs.length > 0)
})

test('启动快过一次轮询（没看见原生启动视图）也认得出应用已挂载，不傻等兜底', async () => {
  const overlay = runOverlay({ maxDurationMs: 5000 })
  // 启动视图在两次轮询之间出现又消失：直接看到的就是挂载好的应用
  const app = overlay.root.appendChild(new FakeElement('div'))
  app.setAttribute('data-app', '')
  await sleep(700)
  assert.equal(documentMock.getElementById(OVERLAY_ID), null, '应用已挂载就该退场')
  assert.ok(overlay.debugs.some((args) => String(args[1]) === 'app-mounted'), `退出原因应为 app-mounted：${JSON.stringify(overlay.debugs)}`)
  assert.ok(overlay.pushes.some(([key, value]) => key === 'progress' && value === 1), '挂载完成时进度应补到 100%')
})

test('#root 里的静态占位（noscript 等）不会被当成应用', async () => {
  const overlay = runOverlay({ maxDurationMs: 600 })
  overlay.root.appendChild(new FakeElement('noscript'))
  await sleep(300)
  assert.ok(documentMock.getElementById(OVERLAY_ID) !== null, '只有 noscript 时不能当作已挂载')
  await sleep(900)
  assert.ok(overlay.debugs.some((args) => String(args[1]) === 'timeout'))
})

test('应用挂载后还在凑最短时长时也能跳过，且那一下点击不会落到底下的应用', async () => {
  const overlay = runOverlay({ minDurationMs: 60000, maxDurationMs: 60000 })
  const app = overlay.root.appendChild(new FakeElement('div'))
  app.setAttribute('data-app', '')
  await sleep(200)
  assert.ok(documentMock.getElementById(OVERLAY_ID) !== null, '凑最短时长期间覆层还在')
  assert.equal(overlay.host.getAttribute('data-dshba-state'), null, '还没开始淡出')

  const down = overlay.dispatch(inputEvent('pointerdown'))
  assert.ok(down.prevented && down.stopped, '用来跳过的 pointerdown 应被吞掉')
  assert.equal(overlay.host.getAttribute('data-dshba-state'), 'leaving', '跳过应立刻开始淡出，而不是继续凑时长')
  const up = overlay.dispatch(inputEvent('mouseup'))
  const click = overlay.dispatch(inputEvent('click'))
  assert.ok(up.prevented && click.prevented, '同一次点击的 mouseup / click 也要吞掉')
  const later = overlay.dispatch(inputEvent('click'))
  assert.equal(later.prevented, false, '手势结束后的点击要放行')

  await sleep(600)
  assert.equal(documentMock.getElementById(OVERLAY_ID), null)
  assert.equal(overlay.events.filter(([type]) => type === 'click').length, 0, '覆层没了就摘掉 window 上的监听')
})

test('不可跳过时点击原样放行；指针移动会亮出跳过提示', async () => {
  const blocked = runOverlay({ skippable: false, maxDurationMs: 300 })
  assert.equal(blocked.host.querySelector('button.dshba-skip').style.display, 'none', '不可跳过就别显示提示')
  const click = blocked.dispatch(inputEvent('click'))
  assert.equal(click.prevented, false)
  assert.ok(documentMock.getElementById(OVERLAY_ID) !== null, '不可跳过时点击不应结束动画')
  await sleep(900)

  const overlay = runOverlay()
  overlay.dispatch(inputEvent('pointermove'))
  assert.equal(overlay.host.getAttribute('data-dshba-hint'), '', '指针移动后应打上 data-dshba-hint')
  overlay.fireClick()
  await sleep(600)
})

test('iframe 文档加载完会补推状态（加载前推的 phase / reduced 模板收不到）', async () => {
  const overlay = runOverlay({ maxDurationMs: 600 })
  overlay.pushes.length = 0
  overlay.loadFrame()
  const keys = overlay.pushes.map(([key]) => key)
  for (const key of ['reduced', 'phase', 'elapsed']) assert.ok(keys.includes(key), `load 后应补推 ${key}：${keys.join(',')}`)
  assert.deepEqual(overlay.pushes.find(([key]) => key === 'phase'), ['phase', 'boot'])
  await sleep(1100)
})

test('核对结果带回新主题与「不可跳过」：覆层跟着改，且桌面快照先不开播旧模板', async () => {
  let release
  const gate = new Promise((resolve) => {
    release = resolve
  })
  const overlay = runOverlay(
    { api: '/dsh-wallport-7f3a/api', rev: 'old', theme: 'dark', maxDurationMs: 900 },
    {
      fetchImpl: () =>
        gate.then(() => ({
          ok: true,
          json: () =>
            Promise.resolve({
              rev: 'ink-wash-1',
              id: 'ink-wash',
              theme: 'light',
              changed: true,
              settings: { enabled: true, minDurationMs: 0, maxDurationMs: 900, skippable: false },
              document: '<!doctype html><html><body>NEW</body></html>',
            }),
        })),
    },
  )
  assert.equal(overlay.frame.getAttribute('srcdoc'), null, '可能是旧快照时先等核对结果，不先闪旧模板')
  release()
  await sleep(50)
  assert.ok(String(overlay.frame.getAttribute('srcdoc')).includes('NEW'))
  assert.equal(overlay.host.getAttribute('data-dshba-theme'), 'light', '主题应跟着新模板切换')
  assert.equal(overlay.host.querySelector('button.dshba-skip').style.display, 'none', '宿主说不可跳过就藏起提示')
  const click = overlay.dispatch(inputEvent('click'))
  assert.equal(click.prevented, false, '不可跳过后点击不该被吞')
  await sleep(1500)
  assert.equal(documentMock.getElementById(OVERLAY_ID), null)
})

test('核对一直没回音时，等一会儿就先播快照里的模板', async () => {
  const overlay = runOverlay(
    { api: '/dsh-wallport-7f3a/api', rev: 'old', maxDurationMs: 800 },
    { fetchImpl: () => new Promise(() => {}) },
  )
  assert.equal(overlay.frame.getAttribute('srcdoc'), null)
  await sleep(400)
  assert.ok(String(overlay.frame.getAttribute('srcdoc')).includes('<p>tpl</p>'), '等不到核对结果也要开播')
  await sleep(1000)
})

test('桥接：reduced() 在模板脚本执行时就是真实偏好；ready 只触发一次', () => {
  const win = {
    matchMedia: () => ({ matches: true, addEventListener: () => {} }),
    console: { error: () => {} },
  }
  new Function('window', `(${bootBridge.toString()})("dshBootAnim")`)(win)
  const bridge = win.dshBootAnim
  assert.equal(bridge.reduced(), true, '用户开了减少动效，模板一启动就该知道')

  let readyCount = 0
  bridge.on('ready', () => {
    readyCount += 1
  })
  bridge._set('progress', 1)
  bridge._set('phase', 'done')
  assert.equal(readyCount, 1, '进度满 + 覆层收尾只算一次 ready')
  assert.equal(bridge.isReady(), true)
})

test('预览模拟器：loop:false 只播一遍，停在启动完成', async () => {
  const win = { matchMedia: () => ({ matches: false }), console: { error: () => {} } }
  let pending = []
  win.requestAnimationFrame = (fn) => pending.push(fn)
  new Function('window', `(${bootBridge.toString()})("dshBootAnim");(${bootPreviewSimulator.toString()})("dshBootAnim",{cycleMs:40,holdMs:10,loop:false})`)(win)
  const drain = () => {
    const batch = pending
    pending = []
    batch.forEach((fn) => fn())
  }
  drain()
  await sleep(80)
  drain()
  assert.equal(pending.length, 0, '播完一遍就不再排下一帧')
  assert.equal(win.dshBootAnim.progress(), 1)
  assert.equal(win.dshBootAnim.state.visible, false)
})
