/**
 * 内置模板：代码雨
 *
 * canvas 字符雨，落速跟随真实进度；中央用描边字缓慢亮起，
 * 底部显示一行「harness boot」状态。致敬经典，但配色收敛在品牌蓝。
 */

export default {
  id: 'matrix-rain',
  name: { zh: '代码雨', en: 'Code Rain' },
  theme: "dark",
  description: {
    zh: '字符雨落速跟随真实进度，中央字标逐渐亮起。',
    en: 'Canvas code rain whose fall speed tracks progress, with a wordmark fading in at the centre.',
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
  body { background: #02040a; overflow: hidden; color: #d7e3ff;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif; }
  canvas { position: fixed; inset: 0; width: 100%; height: 100%; display: block; opacity: .78; }
  .veil { position: fixed; inset: 0; background: radial-gradient(60% 55% at 50% 50%, rgba(2,4,10,.92) 0%, rgba(2,4,10,.55) 45%, rgba(2,4,10,.15) 100%); }
  .center { position: fixed; inset: 0; display: grid; place-items: center; text-align: center; }
  .mark {
    font-size: clamp(19px, 3.6vmin, 38px); font-weight: 600; letter-spacing: .3em; text-indent: .3em;
    text-transform: uppercase; color: #eef3ff;
    text-shadow: 0 0 18px rgba(77,107,254,.65), 0 0 60px rgba(77,107,254,.35);
    opacity: .35; transition: opacity .8s ease;
  }
  .mark.on { opacity: 1; }
  .sub { margin-top: 16px; font-size: clamp(11px, 1.3vmin, 13px); letter-spacing: .3em; color: rgba(215,227,255,.5); }
  .meter {
    position: fixed; left: 50%; bottom: 9vmin; transform: translateX(-50%);
    width: min(46vmin, 320px); height: 2px; background: rgba(255,255,255,.1); border-radius: 999px; overflow: hidden;
  }
  .meter i { display: block; height: 100%; width: 0%; background: linear-gradient(90deg, #4d6bfe, #9db4ff); box-shadow: 0 0 12px rgba(77,107,254,.8); }
  @media (prefers-reduced-motion: reduce) { .mark { transition: none; } }
</style>
</head>
<body>
  <canvas id="rain"></canvas>
  <div class="veil"></div>
  <div class="center">
    <div>
      <div class="mark" id="mark">DeepSeek Harness</div>
      <div class="sub" id="sub">booting</div>
    </div>
  </div>
  <div class="meter"><i id="bar"></i></div>
<script>
(function () {
  var canvas = document.getElementById('rain');
  var ctx = canvas.getContext('2d');
  var bridge = window.dshBootAnim;
  var dpr = Math.min(2, window.devicePixelRatio || 1);
  var GLYPHS = 'アイウエオカキクケコサシスセソタチツテトナニヌネノ0123456789ABCDEFλΔΣΦΨΩ<>/\\|=+*';
  var fontSize = Math.round(15 * dpr);
  var columns = 0, drops = [], speeds = [];
  var progress = 0;
  var reduced = bridge ? bridge.reduced() : false;

  function resize() {
    canvas.width = Math.floor(window.innerWidth * dpr);
    canvas.height = Math.floor(window.innerHeight * dpr);
    columns = Math.ceil(canvas.width / fontSize);
    drops = []; speeds = [];
    for (var i = 0; i < columns; i++) {
      drops.push(Math.random() * (canvas.height / fontSize));
      speeds.push(0.5 + Math.random() * 0.8);
    }
    ctx.font = fontSize + 'px ui-monospace, Menlo, Consolas, monospace';
  }

  function frame() {
    ctx.fillStyle = 'rgba(2,4,10,0.09)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    var rate = 0.55 + progress * 2.4;
    for (var i = 0; i < columns; i++) {
      var ch = GLYPHS.charAt(Math.floor(Math.random() * GLYPHS.length));
      var x = i * fontSize;
      var y = drops[i] * fontSize;
      var lead = Math.random() > 0.86;
      ctx.fillStyle = lead ? 'rgba(190,215,255,0.95)' : 'rgba(90,125,235,0.62)';
      ctx.fillText(ch, x, y);
      drops[i] += speeds[i] * rate * (reduced ? 0.25 : 1);
      if (y > canvas.height && Math.random() > 0.975) {
        drops[i] = 0;
        speeds[i] = 0.5 + Math.random() * 0.8;
      }
    }
    requestAnimationFrame(frame);
  }

  var mark = document.getElementById('mark');
  var sub = document.getElementById('sub');
  var bar = document.getElementById('bar');
  var lit = false;

  function render(p) {
    progress = Math.max(0, Math.min(1, Number(p) || 0));
    bar.style.width = (progress * 100).toFixed(1) + '%';
    sub.textContent = progress >= 1 ? 'ready' : 'booting ' + Math.round(progress * 100) + '%';
    if (progress > 0.35 && !lit) { lit = true; mark.classList.add('on'); }
  }

  window.addEventListener('resize', resize);
  resize();
  requestAnimationFrame(frame);

  if (bridge) {
    render(bridge.progress());
    bridge.on('progress', render);
  } else {
    mark.classList.add('on');
    var t0 = Date.now();
    setInterval(function () { render(((Date.now() - t0) / 3000) % 1.02); }, 70);
  }
})();
</script>
</body>
</html>`,
}
