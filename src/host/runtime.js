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
 *   只有「应用挂载」会凑满 minDurationMs，跳过 / 报错 / 关闭都是立刻淡出。
 * - 跳过：覆层还盖着界面时（包括应用已挂载、正在凑最短时长），用来跳过的那一下点击/按键
 *   会被吞掉，不会顺带点到底下看不见的按钮。
 *
 * @param cfg - { overlayId, bridgeName, document, theme, minDurationMs, maxDurationMs, skippable, api?, rev? }
 */
export function bootOverlayRuntime(cfg) {
  var overlayId = cfg.overlayId
  var bridgeName = cfg.bridgeName
  var doc = cfg.document
  var FADE_MS = 460
  /**
   * 注入行可能是旧快照时（桌面模式：表是宿主启动时收集的），最多等这么久的核对结果再开播，
   * 免得先闪一下旧模板再跳到新模板。web 模式的行是本次请求现渲染的，不用等。
   */
  var HOLD_MS = 250
  /** 跳过那一下的余波（同一次点击后续的 mouseup / click、按键的 keyup）在这段时间内一并吞掉。 */
  var GESTURE_MS = 1000
  /** 不算「应用内容」的 #root 子节点（静态占位之类）。 */
  var INERT = /^(SCRIPT|NOSCRIPT|STYLE|LINK|TEMPLATE)$/
  var INPUT_EVENTS = ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']
  var startedAt = Date.now()
  /** 已决定退场（可能还在凑最短时长）。 */
  var finished = false
  /** 已开始淡出。 */
  var leaving = false
  var sawBoot = false
  var shown = false
  var frame = null
  var host = null
  var timer = null
  var holdTimer = null
  var leaveTimer = null
  var skipButton = null
  var gestureUntil = 0
  /** 推给模板的最新状态：iframe 文档每次（重新）加载完都整份补推一遍。 */
  var pushed = {}
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

  function setTheme(theme) {
    if (host && typeof theme === 'string') host.setAttribute('data-dshba-theme', theme === 'light' ? 'light' : 'dark')
  }

  /** 跳过提示跟着「当前是否允许跳过」走（宿主核对后可能改变）。 */
  function syncSkipButton() {
    if (skipButton) skipButton.style.display = live.skippable ? '' : 'none'
  }

  function build() {
    host = byId(overlayId)
    if (!host) {
      host = document.createElement('div')
      host.id = overlayId
      host.setAttribute('data-dsh-wallport', cfg.templateId || '')
      ;(document.body || document.documentElement).appendChild(host)
    }
    host.setAttribute('aria-hidden', 'true')
    setTheme(cfg.theme)
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
    // 文档（重新）加载完就补推一遍状态：加载前推的（phase / reduced…）模板一个都收不到。
    frame.addEventListener('load', function () {
      for (var key in pushed) push(key, pushed[key])
    })

    skipButton = host.querySelector('button.dshba-skip')
    if (!skipButton) {
      skipButton = document.createElement('button')
      skipButton.type = 'button'
      skipButton.className = 'dshba-skip'
      skipButton.setAttribute('tabindex', '-1')
      skipButton.textContent =
        navigator.language && navigator.language.indexOf('zh') === 0 ? '点击任意处跳过' : 'Click to skip'
      host.appendChild(skipButton)
    }
    syncSkipButton()
  }

  /** 开播：把模板文档交给 iframe。srcdoc 用属性赋值：模板里带 script 结束标签也不会破坏宿主页。 */
  function show(next) {
    if (holdTimer !== null) {
      window.clearTimeout(holdTimer)
      holdTimer = null
    }
    if (finished || frame === null) return
    doc = next
    shown = true
    frame.setAttribute('srcdoc', doc)
  }

  /** 把状态推给 iframe 里的模板（同一源，直接调桥接对象），并记下来供文档加载后补推。 */
  function push(key, value) {
    pushed[key] = value
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

  /**
   * 应用是否已挂载：原生启动视图已经不在，且 #root 里出现了别的内容。
   * 不要求「先看见过启动视图」——启动快过一次轮询时也认得出来，而不是傻等到兜底时长。
   */
  function appMounted() {
    if (document.querySelector('[data-dsh-boot]') !== null) return false
    var root = byId('root')
    if (!root) return sawBoot
    for (var i = 0; i < root.children.length; i++) {
      var child = root.children[i]
      if (child.id === overlayId || child.hasAttribute('data-dsh-boot') || INERT.test(String(child.tagName))) continue
      return true
    }
    return false
  }

  function detach() {
    if (typeof window.removeEventListener !== 'function') return
    for (var i = 0; i < INPUT_EVENTS.length; i++) window.removeEventListener(INPUT_EVENTS[i], onInput, true)
    window.removeEventListener('keydown', onKey, true)
    window.removeEventListener('keyup', onKey, true)
    window.removeEventListener('pointermove', onMove, true)
  }

  /** 覆层没了就摘掉监听；跳过手势还没收尾时等它收尾。 */
  function detachSoon() {
    var rest = gestureUntil - Date.now()
    if (rest > 0) window.setTimeout(detach, rest)
    else detach()
  }

  /** 开始淡出，淡完从 DOM 移除。 */
  function leave() {
    if (leaving) return
    leaving = true
    if (leaveTimer !== null) {
      window.clearTimeout(leaveTimer)
      leaveTimer = null
    }
    if (!host) {
      detachSoon()
      return
    }
    host.setAttribute('data-dshba-state', 'leaving')
    window.setTimeout(function () {
      try {
        if (host && host.parentNode) host.parentNode.removeChild(host)
      } catch (error) {
        /* 已被别的东西移除 */
      }
      host = null
      frame = null
      skipButton = null
      detachSoon()
    }, FADE_MS)
  }

  /** 决定退场：只有「应用挂载」凑满最短时长，其余原因（跳过 / 报错 / 关闭 / 超时）立刻淡出。 */
  function finish(reason) {
    if (finished) return
    finished = true
    if (timer !== null) {
      window.clearInterval(timer)
      timer = null
    }
    if (holdTimer !== null) {
      window.clearTimeout(holdTimer)
      holdTimer = null
    }
    if (reason === 'app-mounted') push('progress', 1)
    push('visible', false)
    push('phase', 'done')
    var elapsed = Date.now() - startedAt
    var wait = reason === 'app-mounted' && !reduced ? Math.max(0, live.minDurationMs - elapsed) : 0
    if (wait > 0) leaveTimer = window.setTimeout(leave, wait)
    else leave()
    if (window.console && window.console.debug) {
      window.console.debug('[dsh-wallport] overlay finished:', reason, Math.round(elapsed) + 'ms')
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
      if (/failed to load|did not activate|import failed/i.test(String(boot.textContent || ''))) {
        finish('boot-failed')
        return
      }
    }
    var progress = readProgress()
    if (progress !== null) push('progress', progress)
    push('elapsed', Date.now() - startedAt)
    if (appMounted()) finish('app-mounted')
    else if (Date.now() - startedAt >= live.maxDurationMs) finish('timeout')
  }

  /** 吞掉一个输入事件：覆层盖着界面时，用来跳过的那一下不该再落到底下的应用上。 */
  function swallow(event) {
    if (!event) return
    if (typeof event.preventDefault === 'function') event.preventDefault()
    if (typeof event.stopPropagation === 'function') event.stopPropagation()
  }

  /** 用户要跳过：记下手势窗口，立刻淡出（应用已挂载、正在凑最短时长时也一样）。 */
  function skip(event) {
    gestureUntil = Date.now() + GESTURE_MS
    swallow(event)
    finish('skip')
    leave()
  }

  function onInput(event) {
    if (!leaving) {
      if (live.skippable) skip(event)
      return
    }
    if (Date.now() < gestureUntil) {
      swallow(event)
      if (event && event.type === 'click') gestureUntil = 0
    }
  }

  function onKey(event) {
    if (!event || (event.key !== 'Escape' && event.key !== ' ' && event.key !== 'Enter')) return
    if (!leaving) {
      if (live.skippable && event.type !== 'keyup') skip(event)
      return
    }
    if (Date.now() < gestureUntil) swallow(event)
  }

  /** 指针一动就把「点击任意处跳过」亮出来（覆层不吃指针事件，:hover 指望不上）。 */
  function onMove() {
    if (host && !leaving && live.skippable) host.setAttribute('data-dshba-hint', '')
  }

  /**
   * 与宿主核对「此刻真正生效的模板与参数」。
   * - 注入表是宿主启动时的快照（桌面模式），这里让我们能跟上之后的切换（模板、主题、时长、能否跳过）；
   * - 失败/超时都不影响动画：只是保持快照内容继续播。
   * @returns 是否真的发出了请求。
   */
  function syncActive() {
    if (typeof cfg.api !== 'string' || cfg.api === '' || typeof window.fetch !== 'function') return false
    var url = cfg.api + '/active?rev=' + encodeURIComponent(cfg.rev || '')
    var request
    try {
      request = window.fetch(url, { cache: 'no-store', credentials: 'same-origin' })
    } catch (error) {
      return false
    }
    if (!request || typeof request.then !== 'function') return false
    request
      .then(function (response) {
        return response && response.ok ? response.json() : null
      })
      .then(function (data) {
        if (finished) return
        if (!data) {
          if (!shown) show(doc)
          return
        }
        if (data.settings && typeof data.settings === 'object') {
          if (typeof data.settings.enabled === 'boolean') live.enabled = data.settings.enabled
          if (data.settings.minDurationMs !== undefined) live.minDurationMs = Math.max(0, Number(data.settings.minDurationMs) || 0)
          if (data.settings.maxDurationMs !== undefined) live.maxDurationMs = Math.max(0, Number(data.settings.maxDurationMs) || 0)
          if (typeof data.settings.skippable === 'boolean') live.skippable = data.settings.skippable
          if (live.maxDurationMs < live.minDurationMs) live.maxDurationMs = live.minDurationMs
          syncSkipButton()
        }
        if (live.enabled === false) {
          tick()
          return
        }
        setTheme(data.theme)
        if (data.changed === true && typeof data.document === 'string') {
          show(data.document)
          if (window.console && window.console.debug) window.console.debug('[dsh-wallport] 热切换到模板', data.id)
        } else if (!shown) {
          show(doc)
        }
      })
      .catch(function () {
        // 拿不到就继续播快照里的模板
        if (!shown) show(doc)
      })
    return true
  }

  build()
  push('reduced', reduced)
  push('phase', 'boot')
  for (var i = 0; i < INPUT_EVENTS.length; i++) window.addEventListener(INPUT_EVENTS[i], onInput, true)
  window.addEventListener('keydown', onKey, true)
  window.addEventListener('keyup', onKey, true)
  window.addEventListener('pointermove', onMove, true)
  timer = window.setInterval(tick, 120)

  // 注入行会不会是旧快照：脚本在 HTML 解析途中执行 = 服务端为本次请求现渲染的（web 模式），一定是新的；
  // 解析完才被插进来 = 启动壳拿宿主启动时那张表应用的（桌面模式），可能已经过期，先等一下核对结果。
  var maybeStale = document.readyState !== 'loading'
  if (syncActive() && maybeStale) {
    holdTimer = window.setTimeout(function () {
      holdTimer = null
      show(doc)
    }, HOLD_MS)
  } else {
    show(doc)
  }
  tick()

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
  var media = null
  try {
    media = window.matchMedia('(prefers-reduced-motion: reduce)')
  } catch (error) {
    media = null
  }
  var state = {
    progress: 0,
    elapsed: 0,
    phase: 'boot',
    ready: false,
    visible: true,
    // 在 iframe 里自己读：模板脚本在文档解析时就会调 reduced()，那时宿主还来不及推任何东西。
    reduced: Boolean(media && media.matches),
    done: false,
  }

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
        if (window.console && window.console.error) window.console.error('[dsh-wallport] listener failed:', error)
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
      if (key === 'phase' && value === 'done') state.done = true
      fire(key, value)
      // ready 只在「没就绪 → 就绪」那一下触发一次（进度到 100% 与覆层收尾都会走到这里）
      if (!state.ready && (state.done || state.progress >= 1)) {
        state.ready = true
        fire('ready', true)
      }
    },
  }

  // 用户中途改了「减少动效」也跟上
  if (media) {
    var onReducedChange = function (event) {
      api._set('reduced', Boolean(event && event.matches))
    }
    try {
      if (typeof media.addEventListener === 'function') media.addEventListener('change', onReducedChange)
      else if (typeof media.addListener === 'function') media.addListener(onReducedChange)
    } catch (error) {
      /* 老引擎不支持监听：保持初始值 */
    }
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
  var loop = !options || options.loop !== false
  var period = cycleMs + holdMs
  var startedAt = Date.now()
  var cycle = 0
  bridge._set('phase', 'preview')

  function frame() {
    var elapsed = Date.now() - startedAt
    if (!loop && elapsed >= cycleMs) {
      // 只播一遍：停在「启动完成」的样子
      bridge._set('elapsed', cycleMs)
      bridge._set('progress', 1)
      bridge._set('visible', false)
      return
    }
    var index = Math.floor(elapsed / period)
    if (index !== cycle) {
      // 新一轮：让 ready 能再触发一次，模板的「就绪」效果每轮都看得到
      cycle = index
      bridge.state.ready = false
    }
    var t = elapsed % period
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
