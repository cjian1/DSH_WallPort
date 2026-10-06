/**
 * dsh-boot-animation —— 浏览器半侧（设置页）
 *
 * 一个设置分区「开机动画」：
 *   - 总开关 / 最短时长 / 兜底时长 / 是否可跳过；
 *   - 模板画廊（内置 7 个 + 用户/AI 自定义），可预览、应用、删除；
 *   - 预览弹窗用宿主路由返回的独立预览文档（iframe），不污染设置页；
 *   - 「AI 自定义」面板：复制给 AI 的提示词，或直接粘贴模板 JSON 导入。
 *
 * 只依赖 slots / locale 两个客户端服务；不 import 任何 Harness Client 包，
 * 控件与样式都按宿主主题 token（--dsw-alias-*）自己写。
 */

window.__ModuleLoader__.load({
  id: 'dsh-boot-animation',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useCallback, useEffect, useMemo, useRef, useState } = React

    /** 与宿主半侧 src/shared/constants.js 保持一致。 */
    const API = '/dsh-boot-animation-7f3a/api'
    const NS = 'dsh-boot-animation'

    const zh = {
      nav: '开机动画',
      title: '开机动画',
      subtitle: '启动 DSH 时盖在界面上的那段动画：内置模板直接用，也可以让 AI 现场写一个。切换后刷新页面即可看到（插件刚装好时需重启一次 DSH）。',
      enabled: '启用开机动画',
      enabledHint: '关闭后启动时直接进入界面，不播放任何动画。',
      minDuration: '最短展示时长',
      minDurationHint: '启动再快也至少展示这么久（毫秒）。',
      maxDuration: '兜底时长',
      maxDurationHint: '超过这个时间就撤掉动画，把界面交给用户（毫秒）。',
      skippable: '允许跳过',
      skippableHint: '点击页面任意位置或按 Esc / 空格立即结束动画。',
      templates: '模板',
      builtin: '内置',
      custom: '自定义',
      inUse: '使用中',
      apply: '应用',
      applied: '已应用',
      preview: '预览',
      remove: '删除',
      removeConfirm: '确定删除这个自定义模板？',
      save: '保存设置',
      saved: '设置已保存',
      loading: '正在读取开机动画设置…',
      retry: '重试',
      storageDegraded: '状态目录不可写：设置只在本次运行内有效。',
      storageAt: '状态目录',
      aiPromptIntro: '请帮我做一个 DeepSeek Harness 的开机动画，做好后保存并启用它。',
      aiPromptWantLabel: '我想要的样子：',
      aiPromptWantHint: '（把这一行改成你自己的描述，例如：赛博霓虹，紫粉色光带 + 扫描线，节奏快一点）',
      aiPromptRules: '要求：\n1. 用 boot_animation_save 保存成自定义模板：id 用小写字母/数字/连字符（例如 neon-cyber），activate 传 true；\n2. document 是一段自包含 HTML（可含 <style>/<script>，也可以是完整文档）：铺满全屏、不要滚动，不依赖任何网络资源（外链字体/图片/CDN 在开机时不可用）；\n3. 想跟随真实启动进度就用 window.dshBootAnim：progress() 返回 0…1，on("progress", fn) 订阅，isReady()/on("ready") 表示应用已挂载，reduced() 表示用户偏好减少动效；\n4. 颜色/字体自带，不要依赖 DSH 的 CSS 变量（开机阶段样式还没加载）；\n5. 时长由插件统一控制（默认最短 1.2s、最长 12s），动画自己循环播放即可，不需要自己结束；\n6. 保存后用 boot_animation_preview 导出一份预览文件给我，并告诉我当前生效的是哪个模板。\n\n先把第一版做出来，我看完预览再让你调。',
      copyPrompt: '复制',
      aiTitle: '用 AI 自定义（推荐）',
      aiHint: '不用写代码：在这里写下你想要的样子，复制提示词，粘到任意对话里发送即可。',
      aiIdeaLabel: '① 我想要的开机动画（在这里打字）',
      aiIdeaPlaceholder: '例如：赛博霓虹，紫粉色光带 + 扫描线，节奏快一点；或者：水墨风、浅色底、落款「深度求索」',
      aiStep2: '② 点「复制提示词给 AI」，粘贴到任意会话里发送 —— 提示词里已经带上了工具用法和模板格式。',
      aiStep3: '③ AI 会存成模板并给你一份预览；满意就刷新页面，想改继续说一句。',
      aiExampleLabel: '懒得想？点一句填进上面的输入框：',
      aiEg1: '把开机动画换成赛博霓虹风格：紫粉色光带 + 扫描线，节奏快一点',
      aiEg2: '做一个水墨风的开机动画，浅色底、墨点扩散，落款写「深度求索」',
      aiEg3: '把现在的开机动画改成极简风，只留一条微光进度线',
      aiCopyFull: '复制提示词给 AI',
      aiClear: '清空',
      aiPromptTitle: '完整提示词（已包含你上面写的内容）',
      aiPromptEmpty: '（还没写？上面输入框里写一句，这里会自动带上）',
      aiTools: 'AI 可用工具：boot_animation_list / save / apply / preview / remove / settings',
      aiGuide: '更细的说明见插件目录里的 docs/AI-自定义指南.md',
      copied: '已复制',
      importTitle: '手动导入模板',
      importHint: '粘贴模板 JSON（字段：id、name、description、theme、document），或直接粘贴一段 HTML。',
      importPlaceholder: '{"id":"my-boot","name":"我的开机动画","document":"<!doctype html>…"}',
      import: '导入并启用',
      importFailed: '导入失败',
      previewTitle: '预览',
      openInTab: '在新标签打开',
      close: '关闭',
      kicker: '外观',
      footerHint: '预览会在独立文档里循环播放并模拟启动进度；真实开机时进度来自 DSH 的插件加载进度。桌面 App 里切换模板后刷新页面即可生效；「关闭开机动画」需要重启一次 DSH。',
    }
    const en = {
      nav: 'Boot animation',
      title: 'Boot animation',
      subtitle: 'The animation shown while DSH boots: pick a built-in template or have the AI write one. Refresh to see a change (restart DSH once right after installing the plugin).',
      enabled: 'Enable boot animation',
      enabledHint: 'When off, DSH goes straight to the UI at startup.',
      minDuration: 'Minimum duration',
      minDurationHint: 'Show the animation at least this long, even on a fast boot (ms).',
      maxDuration: 'Maximum duration',
      maxDurationHint: 'Hand the screen back after this long no matter what (ms).',
      skippable: 'Allow skipping',
      skippableHint: 'Any click, Esc or Space ends the animation immediately.',
      templates: 'Templates',
      builtin: 'Built-in',
      custom: 'Custom',
      inUse: 'In use',
      apply: 'Apply',
      applied: 'Applied',
      preview: 'Preview',
      remove: 'Delete',
      removeConfirm: 'Delete this custom template?',
      save: 'Save settings',
      saved: 'Settings saved',
      loading: 'Loading boot animation settings…',
      retry: 'Retry',
      storageDegraded: 'Storage directory is not writable: changes only last for this run.',
      storageAt: 'Storage',
      aiPromptIntro: 'Please build a DeepSeek Harness boot animation for me, then save and enable it.',
      aiPromptWantLabel: 'What I want: ', 
      aiPromptWantHint: '(edit this line — e.g. cyber-neon, purple-pink light bands plus scanlines, a bit faster)',
      aiPromptRules: 'Requirements:\n1. Save it with boot_animation_save as a custom template: lowercase letters/digits/hyphens for the id (e.g. neon-cyber), pass activate: true;\n2. document is one self-contained HTML string (inline <style>/<script> allowed, a full document is fine): fill the viewport, no scrolling, no network resources (external fonts/images/CDNs are unavailable during boot);\n3. To follow real boot progress use window.dshBootAnim: progress() returns 0…1, on("progress", fn) subscribes, isReady()/on("ready") means the app has mounted, reduced() means the user prefers less motion;\n4. Bring your own colours and fonts; DSH CSS variables are not available yet during boot;\n5. Duration is owned by the plugin (1200ms minimum, 12000ms cap) — just loop the animation, do not end it yourself;\n6. After saving, export an openable preview with boot_animation_preview and tell me which template is active.\n\nShip a first version; I will look at the preview and then ask for tweaks.',
      aiTitle: 'Customize with AI (recommended)',
      aiHint: 'No code needed: type what you want below, copy the prompt, paste it into any chat and send.',
      aiIdeaLabel: '1. The boot animation I want (type here)',
      aiIdeaPlaceholder: 'e.g. cyber-neon: purple-pink light bands plus scanlines, a bit faster — or ink-wash, light paper, signed "DeepSeek"',
      aiStep2: '2. Press "Copy prompt for the AI" and paste it into any session — it already carries the tool usage and template contract.',
      aiStep3: '3. The AI saves it as a template and exports a preview; refresh when you like it, or just keep describing changes.',
      aiExampleLabel: 'No idea where to start? Click one to fill the box above:',
      aiEg1: 'Replace the boot animation with a cyber-neon look: purple-pink light bands plus scanlines, a bit faster',
      aiEg2: 'Make an ink-wash boot animation: light paper, spreading ink blots, signed "DeepSeek"',
      aiEg3: 'Turn the current boot animation into a minimal one: just a thin glowing progress line',
      aiCopyFull: 'Copy prompt for the AI',
      copyPrompt: 'Copy',
      aiClear: 'Clear',
      aiPromptTitle: 'The prompt (already contains what you typed above)',
      aiPromptEmpty: '(nothing typed yet — write a line above and it appears here)',
      aiTools: 'AI tools: boot_animation_list / save / apply / preview / remove / settings',
      aiGuide: 'See docs/AI-自定义指南.md inside the plugin for the full walkthrough.',
      copied: 'Copied',
      importTitle: 'Import a template',
      importHint: 'Paste template JSON (id, name, description, theme, document) or a raw HTML document.',
      importPlaceholder: '{"id":"my-boot","name":"My boot","document":"<!doctype html>…"}',
      import: 'Import and enable',
      importFailed: 'Import failed',
      previewTitle: 'Preview',
      openInTab: 'Open in new tab',
      close: 'Close',
      kicker: 'Appearance',
      footerHint: 'Previews loop in their own document with simulated progress; a real boot reports DSH plugin-loading progress. In the desktop app a template switch applies on refresh; turning the animation off needs a DSH restart.',
    }

    const CSS = `
.dshba-root{display:flex;flex-direction:column;gap:22px;padding:2px 0 8px;color:var(--dsw-alias-label-primary,#e8ecf6)}
.dshba-card{background:var(--dsw-alias-bg-layer-1,rgba(255,255,255,.03));border:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.1));border-radius:var(--dsw-radius-lg,12px);padding:16px 18px}
.dshba-h2{margin:0 0 4px;font-size:14px;font-weight:600;line-height:22px}
.dshba-sub{margin:0 0 14px;font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary,#9aa0a8)}
.dshba-row{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:10px 0;border-top:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.06))}
.dshba-row:first-of-type{border-top:0}
.dshba-rowText{display:flex;flex-direction:column;gap:2px;min-width:0}
.dshba-rowLabel{font-size:13px;line-height:20px}
.dshba-rowHint{font-size:11.5px;line-height:17px;color:var(--dsw-alias-label-tertiary,#9aa0a8)}
.dshba-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(232px,1fr));gap:12px}
.dshba-tpl{position:relative;display:flex;flex-direction:column;gap:8px;text-align:left;background:var(--dsw-alias-bg-layer-2,rgba(255,255,255,.04));border:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.1));border-radius:var(--dsw-radius-md,10px);padding:12px 13px;transition:border-color .15s ease,transform .15s ease}
.dshba-tpl[data-active="true"]{border-color:var(--dsw-alias-brand-primary,#4d6bfe);box-shadow:0 0 0 1px var(--dsw-alias-brand-primary,#4d6bfe) inset}
.dshba-tplName{display:flex;align-items:center;gap:8px;font-size:13px;font-weight:600;line-height:20px}
.dshba-badge{font-size:10.5px;line-height:16px;padding:1px 6px;border-radius:999px;border:1px solid var(--dsw-alias-border-l3,rgba(255,255,255,.16));color:var(--dsw-alias-label-secondary,#c3c8cf);white-space:nowrap}
.dshba-badge[data-kind="brand"]{border-color:var(--dsw-alias-brand-primary,#4d6bfe);color:var(--dsw-alias-brand-primary,#6f88ff)}
.dshba-tplDesc{font-size:11.5px;line-height:17px;color:var(--dsw-alias-label-tertiary,#9aa0a8);min-height:34px}
.dshba-tplMeta{font-size:10.5px;color:var(--dsw-alias-label-dimmed,#7c828a)}
.dshba-actions{display:flex;gap:8px;margin-top:2px}
.dshba-btn{appearance:none;font:inherit;font-size:12px;line-height:18px;padding:4px 12px;border-radius:var(--dsw-radius-sm,8px);border:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.14));background:transparent;color:var(--dsw-alias-label-primary,#e8ecf6);cursor:pointer}
.dshba-btn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.07))}
.dshba-btn:disabled{opacity:.5;cursor:default}
.dshba-btn[data-variant="primary"]{background:var(--dsw-alias-button-primary-fill,#4d6bfe);border-color:transparent;color:var(--dsw-alias-label-primary-foreground,#fff)}
.dshba-btn[data-variant="primary"]:hover:not(:disabled){background:var(--dsw-alias-button-primary-hover,#5f7bff)}
.dshba-btn[data-variant="danger"]:hover:not(:disabled){color:var(--dsw-alias-state-error-primary,#ff6b6b);border-color:var(--dsw-alias-state-error-primary,#ff6b6b)}
.dshba-switch{position:relative;width:38px;height:22px;flex:none;border-radius:999px;border:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.16));background:var(--dsw-alias-bg-layer-3,rgba(255,255,255,.06));cursor:pointer;transition:background .15s ease}
.dshba-switch[aria-checked="true"]{background:var(--dsw-alias-brand-primary,#4d6bfe);border-color:transparent}
.dshba-switch i{position:absolute;top:2px;left:2px;width:16px;height:16px;border-radius:50%;background:var(--dsw-alias-switch-thumb,#fff);transition:transform .15s ease;display:block}
.dshba-switch[aria-checked="true"] i{transform:translateX(16px)}
.dshba-input{width:104px;font:inherit;font-size:12px;padding:4px 8px;border-radius:var(--dsw-radius-sm,8px);border:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.16));background:var(--dsw-alias-bg-base,transparent);color:var(--dsw-alias-label-primary,#e8ecf6)}
.dshba-textarea{width:100%;min-height:104px;font-family:var(--ds-font-family-code,ui-monospace,Menlo,Consolas,monospace);font-size:12px;line-height:18px;padding:10px;border-radius:var(--dsw-radius-md,10px);border:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.16));background:var(--dsw-alias-bg-base,transparent);color:var(--dsw-alias-label-primary,#e8ecf6);resize:vertical}
.dshba-code{font-family:var(--ds-font-family-code,ui-monospace,Menlo,Consolas,monospace);font-size:11.5px;line-height:18px;background:var(--dsw-alias-bg-module-platform,rgba(255,255,255,.05));border-radius:var(--dsw-radius-sm,8px);padding:8px 10px;color:var(--dsw-alias-label-secondary,#c3c8cf);word-break:break-word}
.dshba-note{font-size:11.5px;line-height:17px;color:var(--dsw-alias-label-tertiary,#9aa0a8)}
.dshba-warn{font-size:11.5px;line-height:17px;color:var(--dsw-alias-state-warn-primary,#e8b339)}
.dshba-err{font-size:12px;line-height:18px;color:var(--dsw-alias-state-error-primary,#ff6b6b)}
.dshba-modal{position:fixed;inset:0;z-index:60;display:flex;align-items:center;justify-content:center;padding:4vh 4vw;background:rgba(6,8,14,.66);backdrop-filter:blur(3px)}
.dshba-modalBox{display:flex;flex-direction:column;gap:10px;width:min(1040px,92vw);height:min(760px,88vh);background:var(--dsw-alias-bg-layer-1,#12151c);border:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.12));border-radius:var(--dsw-radius-lg,14px);padding:14px 16px;box-shadow:0 24px 60px rgba(0,0,0,.45)}
.dshba-modalHead{display:flex;align-items:center;justify-content:space-between;gap:12px}
.dshba-modalFrame{flex:1;min-height:0;border:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.12));border-radius:var(--dsw-radius-md,10px);overflow:hidden;background:#05070d}
.dshba-modalFrame iframe{width:100%;height:100%;border:0;display:block}
.dshba-flexRow{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.dshba-steps{margin:0;padding-left:20px;display:flex;flex-direction:column;gap:6px;font-size:12px;line-height:19px;color:var(--dsw-alias-label-secondary,#c3c8cf)}
.dshba-steps li{list-style:decimal}
.dshba-chip{appearance:none;font:inherit;font-size:11.5px;line-height:17px;text-align:left;padding:5px 10px;border-radius:999px;border:1px dashed var(--dsw-alias-border-l3,rgba(255,255,255,.2));background:transparent;color:var(--dsw-alias-label-secondary,#c3c8cf);cursor:pointer;max-width:100%}
.dshba-chip:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.07));color:var(--dsw-alias-label-primary,#e8ecf6)}
.dshba-idea{width:100%;min-height:56px;margin-top:8px;font:inherit;font-size:12.5px;line-height:19px;padding:9px 11px;border-radius:var(--dsw-radius-md,10px);border:1px solid var(--dsh-alias-border-l2,rgba(255,255,255,.16));background:var(--dsw-alias-bg-base,transparent);color:var(--dsw-alias-label-primary,#e8ecf6);resize:vertical;box-sizing:border-box}
.dshba-idea:focus{outline:none;border-color:var(--dsw-alias-brand-primary,#4d6bfe);box-shadow:0 0 0 2px var(--dsw-alias-brand-primary,#4d6bfe)}
.dshba-idea::placeholder{color:var(--dsw-alias-label-dimmed,#7c828a)}
.dshba-pre-empty{font-family:inherit;color:var(--dsw-alias-label-dimmed,#7c828a)}
.dshba-pre{margin:8px 0 0;padding:10px 12px;max-height:190px;overflow:auto;white-space:pre-wrap;word-break:break-word;font-family:var(--ds-font-family-code,ui-monospace,Menlo,Consolas,monospace);font-size:11.5px;line-height:18px;background:var(--dsw-alias-bg-module-platform,rgba(255,255,255,.05));border:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.08));border-radius:var(--dsw-radius-sm,8px);color:var(--dsw-alias-label-secondary,#c3c8cf)}
`

    /** 统一的 fetch 包装：非 2xx 抛错，错误信息来自服务端。 */
    async function api(path, body) {
      const res = await fetch(API + path, {
        method: body === undefined ? 'GET' : 'POST',
        headers: body === undefined ? undefined : { 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      })
      let data = {}
      try {
        data = await res.json()
      } catch (error) {
        data = {}
      }
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
      return data
    }

    function Switch(props) {
      return h('button', {
        type: 'button',
        className: 'dshba-switch',
        role: 'switch',
        'aria-checked': props.checked ? 'true' : 'false',
        'aria-label': props.label,
        disabled: props.disabled,
        onClick: () => props.onChange(!props.checked),
      }, h('i'))
    }

    function Row(props) {
      return h('div', { className: 'dshba-row' },
        h('div', { className: 'dshba-rowText' },
          h('span', { className: 'dshba-rowLabel' }, props.label),
          props.hint ? h('span', { className: 'dshba-rowHint' }, props.hint) : null,
        ),
        props.children,
      )
    }

    function PreviewModal(props) {
      const t = props.t
      const url = `${API}/preview?id=${encodeURIComponent(props.id)}&loop=1`
      useEffect(() => {
        const onKey = (event) => {
          if (event.key === 'Escape') props.onClose()
        }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
      }, [props.onClose])
      return h('div', { className: 'dshba-modal', role: 'dialog', 'aria-modal': 'true', onClick: props.onClose },
        h('div', { className: 'dshba-modalBox', onClick: (event) => event.stopPropagation() },
          h('div', { className: 'dshba-modalHead' },
            h('strong', { style: { fontSize: '13px' } }, `${t('previewTitle')} · ${props.name || props.id}`),
            h('div', { className: 'dshba-flexRow' },
              h('a', { className: 'dshba-btn', href: url, target: '_blank', rel: 'noreferrer' }, t('openInTab')),
              h('button', { type: 'button', className: 'dshba-btn', onClick: props.onClose }, t('close')),
            ),
          ),
          h('div', { className: 'dshba-modalFrame' },
            // 预览用不透明源（只允许脚本）跑：模板动画照常播放，但读不到设置页的任何数据。
            h('iframe', { src: url, title: 'boot animation preview', sandbox: 'allow-scripts' }),
          ),
          h('div', { className: 'dshba-note' }, t('footerHint')),
        ),
      )
    }

    function BootAnimationSettings(props) {
      const t = props.t
      const [snapshot, setSnapshot] = useState(null)
      const [error, setError] = useState('')
      const [notice, setNotice] = useState('')
      const [busy, setBusy] = useState('')
      const [preview, setPreview] = useState(null)
      /** 用户在「用 AI 自定义」里打的那句话；下面的提示词会实时带上它。 */
      const [idea, setIdea] = useState('')
      const ideaRef = useRef(null)
      const [importText, setImportText] = useState('')
      const [importError, setImportError] = useState('')
      const [copied, setCopied] = useState('')
      const loaded = useRef(false)

      const load = useCallback(async () => {
        try {
          setError('')
          const data = await api('/state')
          setSnapshot(data)
        } catch (err) {
          setError(err.message || String(err))
        }
      }, [])

      useEffect(() => {
        if (loaded.current) return
        loaded.current = true
        load()
      }, [load])

      const patch = useCallback(async (body, key) => {
        setBusy(key)
        setNotice('')
        try {
          await api('/settings', body)
          await load()
        } catch (err) {
          setError(err.message || String(err))
        } finally {
          setBusy('')
        }
      }, [load])

      const applyTemplate = useCallback(async (id) => {
        setBusy(`apply:${id}`)
        setNotice('')
        try {
          await api('/settings', { template: id, enabled: true })
          await load()
          setNotice(t('applied'))
        } catch (err) {
          setError(err.message || String(err))
        } finally {
          setBusy('')
        }
      }, [load, t])

      const removeTemplate = useCallback(async (id) => {
        if (!window.confirm(t('removeConfirm'))) return
        setBusy(`remove:${id}`)
        try {
          await api('/remove', { id })
          await load()
        } catch (err) {
          setError(err.message || String(err))
        } finally {
          setBusy('')
        }
      }, [load, t])

      const importTemplate = useCallback(async () => {
        setImportError('')
        const text = importText.trim()
        if (text === '') return
        let payload
        try {
          payload = JSON.parse(text)
        } catch (err) {
          // 允许直接粘贴一段 HTML：自动补一个 id
          payload = {
            id: `custom-${Date.now().toString(36)}`,
            name: 'Imported boot animation',
            document: text,
          }
        }
        if (payload !== null && typeof payload === 'object' && payload.document === undefined && typeof payload.html === 'string') {
          payload.document = payload.html
        }
        try {
          setBusy('import')
          await api('/save', { template: payload, activate: true })
          setImportText('')
          await load()
        } catch (err) {
          setImportError(err.message || String(err))
        } finally {
          setBusy('')
        }
      }, [importText, load])

      const settings = snapshot ? snapshot.settings : null
      const templates = snapshot ? snapshot.templates : []

      /**
       * 完整提示词：用户直接整段粘进对话就能让 AI 把动画做出来。
       * 里面写清了工具用法与模板契约，所以即使 AI 没看过本插件文档也能一次做对。
       */
      const promptText = useMemo(() => {
        const want = idea.trim() === '' ? t('aiPromptWantHint') : idea.trim()
        return [t('aiPromptIntro'), '', `${t('aiPromptWantLabel')}${want}`, '', t('aiPromptRules')].join('\n')
      }, [t, idea])

      const copyText = useCallback(async (text) => {
        try {
          await navigator.clipboard.writeText(text)
          setCopied(text)
          setTimeout(() => setCopied(''), 1600)
        } catch (err) {
          // 剪贴板不可用时也要让人能用：提示词在下方代码框里可以手动选中复制。
          setImportError(String(err))
        }
      }, [])

      return h('div', { className: 'dshba-root' },
        h('style', null, CSS),
        h('div', null,
          h('h2', { className: 'dshba-h2' }, t('title')),
          h('p', { className: 'dshba-sub' }, t('subtitle')),
          error ? h('div', { className: 'dshba-err' }, error, ' ', h('button', { type: 'button', className: 'dshba-btn', onClick: load }, t('retry'))) : null,
          notice ? h('div', { className: 'dshba-note' }, notice) : null,
        ),

        snapshot === null
          ? h('div', { className: 'dshba-note' }, t('loading'))
          : h(React.Fragment, null,
            h('div', { className: 'dshba-card' },
              h(Row, {
                label: t('enabled'),
                hint: t('enabledHint'),
              }, h(Switch, {
                checked: settings.enabled === true,
                label: t('enabled'),
                disabled: busy !== '',
                onChange: (value) => patch({ enabled: value }, 'enabled'),
              })),
              h(Row, {
                label: t('minDuration'),
                hint: t('minDurationHint'),
              }, h('input', {
                className: 'dshba-input',
                type: 'number',
                min: 0,
                max: 60000,
                step: 100,
                defaultValue: settings.minDurationMs,
                disabled: busy !== '',
                onBlur: (event) => {
                  const value = Number(event.target.value)
                  if (Number.isFinite(value) && value !== settings.minDurationMs) patch({ minDurationMs: value }, 'min')
                },
                onKeyDown: (event) => {
                  if (event.key === 'Enter') event.target.blur()
                },
              })),
              h(Row, {
                label: t('maxDuration'),
                hint: t('maxDurationHint'),
              }, h('input', {
                className: 'dshba-input',
                type: 'number',
                min: 0,
                max: 60000,
                step: 100,
                defaultValue: settings.maxDurationMs,
                disabled: busy !== '',
                onBlur: (event) => {
                  const value = Number(event.target.value)
                  if (Number.isFinite(value) && value !== settings.maxDurationMs) patch({ maxDurationMs: value }, 'max')
                },
                onKeyDown: (event) => {
                  if (event.key === 'Enter') event.target.blur()
                },
              })),
              h(Row, {
                label: t('skippable'),
                hint: t('skippableHint'),
              }, h(Switch, {
                checked: settings.skippable === true,
                label: t('skippable'),
                disabled: busy !== '',
                onChange: (value) => patch({ skippable: value }, 'skip'),
              })),
              snapshot.degraded ? h('div', { className: 'dshba-warn' }, t('storageDegraded')) : null,
              h('div', { className: 'dshba-note', style: { marginTop: '8px' } }, `${t('storageAt')}: ${snapshot.baseDir}`),
            ),

            h('div', { className: 'dshba-card' },
              h('h3', { className: 'dshba-h2' }, `${t('templates')} · ${templates.length}`),
              h('div', { className: 'dshba-grid' },
                templates.map((template) => h('div', {
                  key: template.id,
                  className: 'dshba-tpl',
                  'data-active': template.active ? 'true' : 'false',
                },
                  h('div', { className: 'dshba-tplName' },
                    h('span', null, (template.name && (template.name.zh || template.name.en)) || template.id),
                    h('span', { className: 'dshba-badge' }, template.builtin ? t('builtin') : t('custom')),
                    template.active ? h('span', { className: 'dshba-badge', 'data-kind': 'brand' }, t('inUse')) : null,
                  ),
                  h('div', { className: 'dshba-tplDesc' }, (template.description && (template.description.zh || template.description.en)) || ''),
                  h('div', { className: 'dshba-tplMeta' }, `${template.id} · ${(template.documentBytes / 1024).toFixed(1)} KiB`),
                  h('div', { className: 'dshba-actions' },
                    h('button', {
                      type: 'button',
                      className: 'dshba-btn',
                      onClick: () => setPreview(template),
                    }, t('preview')),
                    h('button', {
                      type: 'button',
                      className: 'dshba-btn',
                      'data-variant': template.active ? undefined : 'primary',
                      disabled: template.active || busy !== '',
                      onClick: () => applyTemplate(template.id),
                    }, template.active ? t('applied') : t('apply')),
                    template.builtin ? null : h('button', {
                      type: 'button',
                      className: 'dshba-btn',
                      'data-variant': 'danger',
                      disabled: busy !== '',
                      onClick: () => removeTemplate(template.id),
                    }, t('remove')),
                  ),
                )),
              ),
            ),

            h('div', { className: 'dshba-card' },
              h('h3', { className: 'dshba-h2' }, t('aiTitle')),
              h('p', { className: 'dshba-sub' }, t('aiHint')),
              h('div', { className: 'dshba-rowLabel', style: { marginTop: '10px' } }, t('aiIdeaLabel')),
              h('textarea', {
                className: 'dshba-idea',
                'data-action': 'idea-input',
                ref: ideaRef,
                rows: 2,
                value: idea,
                placeholder: t('aiIdeaPlaceholder'),
                onChange: (event) => setIdea(event.target.value),
              }),
              h('ol', { className: 'dshba-steps' },
                h('li', null, t('aiStep2')),
                h('li', null, t('aiStep3')),
              ),
              h('div', { className: 'dshba-rowLabel', style: { marginTop: '14px' } }, t('aiExampleLabel')),
              h('div', { className: 'dshba-flexRow', style: { marginTop: '8px' } },
                ...[t('aiEg1'), t('aiEg2'), t('aiEg3')].map((example) =>
                  h('button', {
                    key: example,
                    type: 'button',
                    className: 'dshba-chip',
                    'data-action': 'idea-example',
                    title: t('copyPrompt'),
                    onClick: () => {
                      setIdea(example)
                      if (ideaRef.current && typeof ideaRef.current.focus === 'function') ideaRef.current.focus()
                    },
                  }, example),
                ),
              ),
              h('div', { className: 'dshba-rowLabel', style: { marginTop: '16px' } }, t('aiPromptTitle')),
              idea.trim() === ''
                ? h('pre', { className: 'dshba-pre dshba-pre-empty' }, t('aiPromptEmpty'))
                : h('pre', { className: 'dshba-pre' }, promptText),
              h('div', { className: 'dshba-flexRow', style: { marginTop: '10px' } },
                h('button', {
                  type: 'button',
                  className: 'dshba-btn',
                  'data-variant': 'primary',
                  'data-action': 'copy-prompt',
                  disabled: idea.trim() === '',
                  onClick: () => copyText(promptText),
                }, copied !== '' && copied === promptText ? t('copied') : t('aiCopyFull')),
                h('button', {
                  type: 'button',
                  className: 'dshba-btn',
                  'data-action': 'clear-idea',
                  disabled: idea === '',
                  onClick: () => setIdea(''),
                }, t('aiClear')),
                h('span', { className: 'dshba-note' }, t('aiTools')),
              ),
              h('p', { className: 'dshba-note', style: { marginTop: '10px' } }, t('aiGuide')),
              h('h4', { className: 'dshba-h2', style: { marginTop: '18px' } }, t('importTitle')),
              h('p', { className: 'dshba-sub' }, t('importHint')),
              h('textarea', {
                className: 'dshba-textarea',
                placeholder: t('importPlaceholder'),
                value: importText,
                onChange: (event) => setImportText(event.target.value),
              }),
              importError ? h('div', { className: 'dshba-err', style: { marginTop: '8px' } }, `${t('importFailed')}: ${importError}`) : null,
              h('div', { className: 'dshba-flexRow', style: { marginTop: '10px' } },
                h('button', {
                  type: 'button',
                  className: 'dshba-btn',
                  'data-variant': 'primary',
                  disabled: busy !== '' || importText.trim() === '',
                  onClick: importTemplate,
                }, t('import')),
              ),
            ),
          ),

        preview ? h(PreviewModal, {
          id: preview.id,
          name: (preview.name && (preview.name.zh || preview.name.en)) || preview.id,
          t,
          onClose: () => setPreview(null),
        }) : null,
      )
    }

    function apply(ctx) {
      ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-boot-animation: dictionaries')
      const t = ctx.locale.bind(NS)
      ctx.slots.inject('settings.section', function* () {
        yield ctx.slots.register({
          name: 'settings.section',
          id: 'boot-animation',
          order: 40,
          label: () => t('nav'),
          inject: () => ({ t }),
        }, BootAnimationSettings)
      })
    }

    return { name: NS, inject: ['slots', 'locale'], apply }
  },
})
