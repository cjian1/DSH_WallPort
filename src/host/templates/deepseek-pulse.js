/**
 * 内置模板：深海脉冲（默认）
 *
 * 蓝色光晕呼吸 + 官方鲸鱼标记 + 跟随真实启动进度的进度条。
 * 模板文档通过 window.dshBootAnim 读取宿主推来的进度；
 * 拿不到桥接对象时（比如被单独打开）退化成一个不确定进度动画。
 */

import { WHALE_PATH, WHALE_VIEWBOX } from '../assets/whale.js'

export default {
  id: 'deepseek-pulse',
  name: { zh: '深海脉冲', en: 'DeepSeek Pulse' },
  theme: "dark",
  description: {
    zh: '品牌蓝呼吸光晕 + 鲸鱼标记，进度条跟随真实插件加载进度。',
    en: 'Breathing brand-blue aura with the whale mark; the bar follows real boot progress.',
  },
  document: `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>DeepSeek Harness</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  html, body { height: 100%; margin: 0; }
  body {
    overflow: hidden;
    color: #e9edff;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
    background:
      radial-gradient(120% 90% at 50% 40%, #17224c 0%, #0a0f22 48%, #04060d 100%);
  }
  .stage { position: fixed; inset: 0; display: grid; place-items: center; }
  .aura {
    position: absolute; width: min(64vmin, 540px); aspect-ratio: 1; border-radius: 50%;
    background: radial-gradient(circle, rgba(77,107,254,.42) 0%, rgba(77,107,254,.10) 46%, transparent 72%);
    filter: blur(4px); animation: breathe 3.6s ease-in-out infinite;
  }
  @keyframes breathe {
    0%, 100% { transform: scale(.92); opacity: .72; }
    50%      { transform: scale(1.07); opacity: 1; }
  }
  .card { position: relative; display: flex; flex-direction: column; align-items: center; gap: 22px; }
  .mark {
    width: min(17vmin, 138px); height: auto;
    filter: drop-shadow(0 8px 30px rgba(77,107,254,.55));
    animation: float 5s ease-in-out infinite;
  }
  @keyframes float {
    0%, 100% { transform: translateY(-3px) scale(.995); }
    50%      { transform: translateY(4px) scale(1.015); }
  }
  .wordmark {
    font-size: clamp(13px, 1.6vmin, 17px); font-weight: 600;
    letter-spacing: .42em; text-indent: .42em; text-transform: uppercase;
    color: #f2f5ff; opacity: .92;
  }
  .track {
    width: min(46vmin, 320px); height: 3px; border-radius: 999px;
    background: rgba(255,255,255,.10); overflow: hidden;
  }
  .fill {
    height: 100%; width: 100%; border-radius: inherit; transform-origin: 0 50%; transform: scaleX(0);
    background: linear-gradient(90deg, #4d6bfe 0%, #7f9bff 55%, #b9c9ff 100%);
    box-shadow: 0 0 14px rgba(77,107,254,.75);
    transition: transform .3s cubic-bezier(.22,.61,.36,1);
  }
  .meta {
    display: flex; align-items: baseline; gap: 12px;
    font-size: 12px; letter-spacing: .06em; color: rgba(233,237,255,.62);
  }
  .pct { font-variant-numeric: tabular-nums; color: rgba(233,237,255,.9); min-width: 3.2em; text-align: right; }
  .scan {
    position: absolute; left: 50%; top: 50%; width: min(78vmin, 660px); height: 1px;
    transform: translate(-50%, -50%);
    background: linear-gradient(90deg, transparent, rgba(155,178,255,.55), transparent);
    animation: scan 3.2s ease-in-out infinite; opacity: .5;
  }
  @keyframes scan {
    0%, 100% { transform: translate(-50%, -6vmin); opacity: 0; }
    40%      { opacity: .6; }
    50%      { transform: translate(-50%, 6vmin); opacity: .55; }
  }
  body.done { animation: none; }
  body.done .aura { animation: none; opacity: .35; }
  body.done .mark { animation: none; }
  @media (prefers-reduced-motion: reduce) {
    .aura, .mark, .scan { animation: none !important; }
    .fill { transition: none; }
  }
</style>
</head>
<body>
  <div class="stage">
    <div class="aura"></div>
    <div class="scan"></div>
    <div class="card">
      <svg class="mark" viewBox="${WHALE_VIEWBOX}" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <defs>
          <linearGradient id="whale" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stop-color="#8ea6ff"/>
            <stop offset=".55" stop-color="#4d6bfe"/>
            <stop offset="1" stop-color="#2b3ea8"/>
          </linearGradient>
        </defs>
        <path d="${WHALE_PATH}" fill="url(#whale)"/>
      </svg>
      <div class="wordmark">DeepSeek Harness</div>
      <div class="track"><div class="fill"></div></div>
      <div class="meta"><span class="status">正在唤醒插件…</span><span class="pct">0%</span></div>
    </div>
  </div>
<script>
(function () {
  var fill = document.querySelector('.fill');
  var pct = document.querySelector('.pct');
  var status = document.querySelector('.status');
  var STAGES = [
    [0, '正在唤醒插件…'],
    [0.35, '正在装载界面…'],
    [0.75, '正在恢复会话…'],
    [0.97, '即将就绪…']
  ];
  function stageOf(p) {
    var label = STAGES[0][1];
    for (var i = 0; i < STAGES.length; i++) if (p >= STAGES[i][0]) label = STAGES[i][1];
    return label;
  }
  function render(p) {
    p = Math.max(0, Math.min(1, Number(p) || 0));
    fill.style.transform = 'scaleX(' + p + ')';
    pct.textContent = Math.round(p * 100) + '%';
    var label = stageOf(p);
    if (status.textContent !== label) status.textContent = label;
  }
  var bridge = window.dshBootAnim;
  if (bridge) {
    render(bridge.progress());
    bridge.on('progress', render);
    bridge.on('visible', function (visible) { document.body.classList.toggle('done', !visible); });
    if (bridge.reduced()) document.documentElement.setAttribute('data-reduced', '');
  } else {
    // 独立打开时的退化形态：进度条做不确定动画。
    fill.style.width = '38%';
    fill.style.transform = 'none';
    fill.style.animation = 'slide 1.5s ease-in-out infinite';
    var style = document.createElement('style');
    style.textContent = '@keyframes slide{0%{margin-left:-40%}100%{margin-left:100%}}';
    document.head.appendChild(style);
    pct.textContent = '··';
    status.textContent = 'DeepSeek Harness';
  }
})();
</script>
</body>
</html>`,
}
