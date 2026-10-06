/**
 * 浏览器侧运行时（三块自包含代码，由宿主「函数源码 → 注入脚本」的方式送进页面）：
 *
 *   1. bootOverlayRuntime(cfg)   —— 注入到 DSH 页面，负责覆层生命周期：
 *                                   播放模板 iframe、跟随真实启动进度、启动完成后淡出。
 *   2. bootBridge(name)          —— 注入到 iframe 文档最前面，给模板 JS 一个稳定的小 API。
 *   3. bootPreviewSimulator(name)—— 只用于设置页/浏览器预览：模拟进度循环播放。
 *
 * 为什么不写成字符串常量：函数源码可以被 node --check / 单元测试真正执行，
 * 也能用 Function.prototype.toString() 原样注入，避免手写模板字符串带来的转义 bug。
 */

/**
 * 1) 覆层运行时。
 *
 * 关键设计：
 * - 覆层只是「盖在最上面」：完全不改 DSH 自己的启动 DOM（`[data-dsh-boot]`），
 *   所以我们崩了/超时了，原生启动界面原样露出来，绝不会把用户锁在黑屏里。
 * - 真实进度：DSH 的启动视图会在 `[data-dsh-boot-spinner]` 上写
 *   `--dsh-boot-arc: 72deg…288deg`，把它读出来就是「插件加载进度」。
 * - 退出条件（满足其一）：原生启动视图消失（应用挂载完成）、点击/按键跳过、
 *   达到 maxDurationMs 兜底；启动失败文案出现时立即让路。
 *
 * @param cfg - { overlayId, bridgeName, document, minDurationMs, maxDurationMs, skippable }
 */
export function bootOverlayRuntime(cfg) {
  var overlayId = cfg.overlayId
  var bridgeName = cfg.bridgeName
  var doc = cfg.document
  var FADE_MS = 460
  var startedAt = Date.now()
  var finished = false
  var sawBoot = false
  var frame = null
  var host = null
  var timer = null
  var skipButton = null
  /**
   * 实时设置。Desktop 模式下注入表是宿主启动时的快照，所以运行时再向
   * `cfg.api` 核对一次当前生效的模板与参数，让「切换模板 → 刷新」立即生效。
   */
  var live = {
    enabled: true,
    minDurationMs: Math.max(0, Number(cfg.minDurationMs) || 0),
    maxDurationMs: Math.max(0, Number(cfg.maxDurationMs) || 0),
    skippable: cfg.skippable !== false,
  }
  if (live.maxDurationMs < live.minDurationMs) live.maxDurationMs = live.minDurationMs

  var reduced = false
  try {
    reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  } catch (error) {
    reduced = false
  }

  function byId(id) {
    return document.getElementById(id)
  }

  function build() {
    host = byId(overlayId)
    if (!host) {
      host = document.createElement('div')
      host.id = overlayId
      host.setAttribute('data-dsh-boot-animation', cfg.templateId || '')
      ;(document.body || document.documentElement).appendChild(host)
    }
    host.setAttribute('aria-hidden', 'true')
    frame = host.querySelector('iframe.dshba-frame')
    if (!frame) {
      frame = document.createElement('iframe')
      frame.className = 'dshba-frame'
      frame.setAttribute('title', 'boot animation')
      frame.setAttribute('scrolling', 'no')
      frame.setAttribute('frameborder', '0')
      frame.setAttribute('tabindex', '-1')
      host.appendChild(frame)
    }
    // srcdoc 用属性赋值而不是 innerHTML：模板文档里带 script 结束标签也不会破坏宿主页。
    frame.setAttribute('srcdoc', doc)

    if (live.skippable) {
      skipButton = host.querySelector('button.dshba-skip')
      if (!skipButton) {
        skipButton = document.createElement('button')
        skipButton.type = 'button'
        skipButton.className = 'dshba-skip'
        skipButton.addEventListener('click', function (event) {
          event.stopPropagation()
          finish('skip')
        })
        host.appendChild(skipButton)
      }
      skipButton.textContent =
        navigator.language && navigator.language.indexOf('zh') === 0 ? '点击任意处跳过' : 'Click to skip'
    } else if (skipButton) {
      skipButton.style.display = 'none'
    }
  }

  /** 把状态推给 iframe 里的模板（同一源，直接调桥接对象）。 */
  function push(key, value) {
    try {
      var win = frame && frame.contentWindow
      var bridge = win && win[bridgeName]
      if (bridge && typeof bridge._set === 'function') bridge._set(key, value)
    } catch (error) {
      /* 跨源/未就绪时静默忽略：模板拿不到进度也不该影响启动 */
    }
  }

  /** 读 DSH 启动视图的真实进度：72deg=0%，288deg=100%。 */
  function readProgress() {
    var spinner = document.querySelector('[data-dsh-boot-spinner]')
    if (!spinner || !spinner.style) return null
    var raw = spinner.style.getPropertyValue('--dsh-boot-arc')
    if (!raw) return null
    var deg = parseFloat(raw)
    if (!isFinite(deg)) return null
    return Math.min(1, Math.max(0, (deg - 72) / 216))
  }

  function bootText() {
    var boot = document.querySelector('[data-dsh-boot]')
    return boot ? String(boot.textContent || '') : ''
  }

  function appMounted() {
    if (document.querySelector('[data-dsh-boot]') !== null) return false
    var root = byId('root')
    if (!root) return sawBoot
    for (var i = 0; i < root.children.length; i++) {
      var child = root.children[i]
      if (child.id !== overlayId && !child.hasAttribute('data-dsh-boot')) return true
    }
    return false
  }

  function finish(reason) {
    if (finished) return
    finished = true
    if (timer !== null) {
      window.clearInterval(timer)
      timer = null
    }
    push('visible', false)
    push('phase', 'done')
    var elapsed = Date.now() - startedAt
    var wait = reduced ? 0 : Math.max(0, live.minDurationMs - elapsed)
    var leave = function () {
      if (!host) return
      host.setAttribute('data-dshba-state', 'leaving')
      window.setTimeout(function () {
        try {
          if (host && host.parentNode) host.parentNode.removeChild(host)
        } catch (error) {
          /* 已被别的东西移除 */
        }
        host = null
        frame = null
      }, FADE_MS)
    }
    if (wait > 0) window.setTimeout(leave, wait)
    else leave()
    if (window.console && window.console.debug) {
      window.console.debug('[dsh-boot-animation] overlay finished:', reason, Math.round(elapsed) + 'ms')
    }
  }

  function tick() {
    if (finished) return
    if (live.enabled === false) {
      finish('disabled')
      return
    }
    var boot = document.querySelector('[data-dsh-boot]')
    if (boot) {
      sawBoot = true
      var text = bootText()
      if (/failed to load|did not activate|import failed/i.test(text)) {
        finish('boot-failed')
        return
      }
    }
    var progress = readProgress()
    if (progress !== null) push('progress', progress)
    push('elapsed', Date.now() - startedAt)
    if (sawBoot && appMounted()) finish('app-mounted')
    else if (Date.now() - startedAt >= live.maxDurationMs) finish('timeout')
  }

  function onKey(event) {
    if (!live.skippable) return
    if (event && (event.key === 'Escape' || event.key === ' ' || event.key === 'Enter')) finish('skip')
  }

  /**
   * 与宿主核对「此刻真正生效的模板与参数」。
   * - 注入表是宿主启动时的快照（桌面模式），这里让我们能跟上之后的切换；
   * - 失败/超时都不影响动画：只是保持快照内容继续播。
   */
  function syncActive() {
    if (typeof cfg.api !== 'string' || cfg.api === '' || typeof window.fetch !== 'function') return
    var url = cfg.api + '/active?rev=' + encodeURIComponent(cfg.rev || '')
    var request
    try {
      request = window.fetch(url, { cache: 'no-store', credentials: 'same-origin' })
    } catch (error) {
      return
    }
    if (!request || typeof request.then !== 'function') return
    request
      .then(function (response) {
        return response && response.ok ? response.json() : null
      })
      .then(function (data) {
        if (!data || finished) return
        if (data.settings && typeof data.settings === 'object') {
          if (typeof data.settings.enabled === 'boolean') live.enabled = data.settings.enabled
          if (data.settings.minDurationMs !== undefined) live.minDurationMs = Math.max(0, Number(data.settings.minDurationMs) || 0)
          if (data.settings.maxDurationMs !== undefined) live.maxDurationMs = Math.max(0, Number(data.settings.maxDurationMs) || 0)
          if (typeof data.settings.skippable === 'boolean') live.skippable = data.settings.skippable
          if (live.maxDurationMs < live.minDurationMs) live.maxDurationMs = live.minDurationMs
        }
        if (data.changed === true && typeof data.document === 'string' && frame !== null) {
          doc = data.document
          frame.setAttribute('srcdoc', doc)
          if (window.console && window.console.debug) window.console.debug('[dsh-boot-animation] 热切换到模板', data.id)
        }
      })
      .catch(function () {
        /* 拿不到就继续播快照里的模板 */
      })
  }

  build()
  push('reduced', reduced)
  push('phase', 'boot')
  timer = window.setInterval(tick, 120)
  tick()
  syncActive()

  if (live.skippable) {
    window.addEventListener('click', function () {
      finish('skip')
    }, true)
    window.addEventListener('keydown', onKey, true)
  }
  window.addEventListener('beforeunload', function () {
    if (timer !== null) window.clearInterval(timer)
  })
}

/**
 * 2) 桥接对象（在 iframe 文档内部）：模板 JS 通过 `window.dshBootAnim` 拿到
 *    真实启动进度与生命周期事件。
 *
 *   dshBootAnim.progress()           当前进度 0…1
 *   dshBootAnim.isReady()            应用是否已经挂载
 *   dshBootAnim.phase()              'boot' | 'preview' | 'done'
 *   dshBootAnim.reduced()            是否 prefers-reduced-motion
 *   dshBootAnim.on('progress', fn)   进度变化（同一个值不会重复触发）
 *   dshBootAnim.on('ready', fn)      启动完成
 *   dshBootAnim.on('visible', fn)    覆层是否还可见
 *
 * @param name - 全局对象名（默认 dshBootAnim）。
 */
export function bootBridge(name) {
  var listeners = {}
  var state = { progress: 0, elapsed: 0, phase: 'boot', ready: false, visible: true, reduced: false, done: false }

  function on(event, fn) {
    if (typeof fn !== 'function') return function () {}
    var list = listeners[event] || (listeners[event] = [])
    list.push(fn)
    return function () {
      var at = list.indexOf(fn)
      if (at >= 0) list.splice(at, 1)
    }
  }

  function fire(event, value) {
    var list = listeners[event]
    if (!list) return
    for (var i = 0; i < list.length; i++) {
      try {
        list[i](value, state)
      } catch (error) {
        if (window.console && window.console.error) window.console.error('[boot-animation] listener failed:', error)
      }
    }
  }

  var api = {
    on: on,
    onProgress: function (fn) {
      return on('progress', fn)
    },
    onReady: function (fn) {
      return on('ready', fn)
    },
    progress: function () {
      return state.progress
    },
    elapsed: function () {
      return state.elapsed
    },
    isReady: function () {
      return state.ready
    },
    phase: function () {
      return state.phase
    },
    reduced: function () {
      return state.reduced
    },
    state: state,
    _set: function (key, value) {
      if (state[key] === value) return
      state[key] = value
      if (key === 'phase' && value === 'done') {
        state.ready = true
        state.done = true
        fire('ready', true)
      }
      if (key === 'progress') state.ready = state.ready || value >= 1
      fire(key, value)
      if (key === 'progress' && value >= 1) fire('ready', true)
    },
  }

  window[name] = api
}

/**
 * 3) 预览模拟器：设置页与浏览器预览里没有真实启动流程，
 *    这里用一个循环把 progress 推上去、短暂 ready，再重播。
 *
 * @param name - 桥接对象名。
 * @param options - { cycleMs, holdMs, loop }
 */
export function bootPreviewSimulator(name, options) {
  var bridge = window[name]
  if (!bridge) return
  var cycleMs = (options && options.cycleMs) || 2600
  var holdMs = (options && options.holdMs) || 900
  var period = cycleMs + holdMs
  var startedAt = Date.now()
  bridge._set('phase', 'preview')

  function frame() {
    var t = (Date.now() - startedAt) % period
    if (t <= cycleMs) {
      var p = Math.min(1, t / cycleMs)
      var eased = 1 - Math.pow(1 - p, 2.2)
      bridge._set('visible', true)
      bridge._set('elapsed', t)
      bridge._set('progress', Math.round(eased * 1000) / 1000)
    } else {
      bridge._set('progress', 1)
      bridge._set('visible', false)
    }
    window.requestAnimationFrame(frame)
  }
  window.requestAnimationFrame(frame)
}
