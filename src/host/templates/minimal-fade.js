/**
 * 内置模板：极简微光
 *
 * 给不喜欢花哨动画的人：深色底、字标淡入、下方一条 1px 微光进度线，
 * 没有任何大幅运动，几秒后安静地让位给应用。
 */

export default {
  id: 'minimal-fade',
  name: { zh: '极简微光', en: 'Minimal Glow' },
  theme: "dark",
  description: {
    zh: '近乎静止的深色画面 + 1px 微光进度线，适合日常不打扰。',
    en: 'An almost still dark screen with a 1px glow progress line — quiet, everyday boot.',
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
    background: #07090f;
    color: #e8ecf6; overflow: hidden;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
  }
  .stage { position: fixed; inset: 0; display: grid; place-items: center; }
  .inner { display: flex; flex-direction: column; align-items: center; gap: 20px;
    opacity: 0; animation: appear 1.1s ease-out .12s forwards; }
  @keyframes appear { to { opacity: 1; } }
  .glyph {
    width: 34px; height: 34px; border-radius: 9px;
    background: linear-gradient(135deg, #4d6bfe, #2b3ea8);
    box-shadow: 0 6px 26px rgba(77,107,254,.35);
    display: grid; place-items: center;
    font-size: 15px; font-weight: 700; color: #fff; letter-spacing: 0;
  }
  .wordmark { font-size: 13px; letter-spacing: .3em; text-indent: .3em; text-transform: uppercase; color: rgba(232,236,246,.86); }
  .line { position: relative; width: min(40vmin, 260px); height: 1px; background: rgba(255,255,255,.10); overflow: hidden; }
  .line i { position: absolute; inset: 0 100% 0 0; background: linear-gradient(90deg, rgba(77,107,254,.2), #9db4ff); box-shadow: 0 0 10px rgba(120,155,255,.7); transition: right .35s cubic-bezier(.22,.61,.36,1); }
  .hint { font-size: 11px; letter-spacing: .16em; color: rgba(232,236,246,.34); }
  @media (prefers-reduced-motion: reduce) { .inner { animation: none; opacity: 1; } }
</style>
</head>
<body>
  <div class="stage">
    <div class="inner">
      <div class="glyph">DS</div>
      <div class="wordmark">DeepSeek Harness</div>
      <div class="line"><i id="bar"></i></div>
      <div class="hint" id="hint">正在启动</div>
    </div>
  </div>
<script>
(function () {
  var bar = document.getElementById('bar');
  var hint = document.getElementById('hint');
  var bridge = window.dshBootAnim;
  var HINTS = [[0, '正在启动'], [0.4, '正在装载插件'], [0.8, '正在准备界面']];
  function render(p) {
    p = Math.max(0, Math.min(1, Number(p) || 0));
    bar.style.right = (100 - p * 100).toFixed(2) + '%';
    var text = HINTS[0][1];
    for (var i = 0; i < HINTS.length; i++) if (p >= HINTS[i][0]) text = HINTS[i][1];
    if (hint.textContent !== text) hint.textContent = text;
  }
  if (bridge) {
    render(bridge.progress());
    bridge.on('progress', render);
  } else {
    var t0 = Date.now();
    setInterval(function () { render(((Date.now() - t0) / 2800) % 1.02); }, 60);
  }
})();
</script>
</body>
</html>`,
}
