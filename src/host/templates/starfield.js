/**
 * 内置模板：曲速星野
 *
 * canvas 星野向中心曲速飞行，速度与亮度跟随真实启动进度；
 * 进度到 1 时星野骤停并闪出一行字标。
 */

export default {
  id: 'starfield',
  name: { zh: '曲速星野', en: 'Warp Starfield' },
  theme: "dark",
  description: {
    zh: 'canvas 星野向中心曲速飞行，速度跟随真实进度，就绪时闪出字标。',
    en: 'A canvas starfield warps toward the centre; speed tracks progress and the wordmark flashes on ready.',
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
  body { background: #03040a; overflow: hidden; color: #eaf1ff;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif; }
  canvas { position: fixed; inset: 0; width: 100%; height: 100%; display: block; }
  .hud {
    position: fixed; inset: 0; display: grid; place-items: center; pointer-events: none;
  }
  .title {
    text-align: center; opacity: 0; transform: translateY(10px) scale(.98);
    transition: opacity .6s ease, transform .6s ease;
  }
  .title.on { opacity: 1; transform: none; }
  .title h1 {
    margin: 0; font-size: clamp(18px, 3.4vmin, 34px); font-weight: 600;
    letter-spacing: .34em; text-indent: .34em; text-transform: uppercase;
  }
  .title p { margin: 14px 0 0; font-size: clamp(11px, 1.4vmin, 14px); letter-spacing: .22em; color: rgba(234,241,255,.55); }
  .speed {
    position: fixed; left: 50%; bottom: 8vmin; transform: translateX(-50%);
    font-size: 12px; letter-spacing: .2em; color: rgba(234,241,255,.45);
    font-variant-numeric: tabular-nums;
  }
  @media (prefers-reduced-motion: reduce) { .title { transition: none; } }
</style>
</head>
<body>
  <canvas id="sky"></canvas>
  <div class="hud">
    <div class="title" id="title">
      <h1>DeepSeek Harness</h1>
      <p id="sub">曲速启动中</p>
    </div>
  </div>
  <div class="speed" id="speed">· · ·</div>
<script>
(function () {
  var canvas = document.getElementById('sky');
  var ctx = canvas.getContext('2d');
  var bridge = window.dshBootAnim;
  var dpr = Math.min(2, window.devicePixelRatio || 1);
  var w = 0, h = 0, cx = 0, cy = 0;
  var stars = [];
  var progress = 0;
  var targetSpeed = 0.6;
  var speed = 0.6;
  var reduced = bridge ? bridge.reduced() : false;

  function resize() {
    w = canvas.width = Math.floor(window.innerWidth * dpr);
    h = canvas.height = Math.floor(window.innerHeight * dpr);
    cx = w / 2; cy = h / 2;
    var count = Math.round((w * h) / (26000 * dpr));
    stars = [];
    for (var i = 0; i < count; i++) stars.push(newStar(true));
  }
  function newStar(spread) {
    return {
      x: (Math.random() * 2 - 1) * w,
      y: (Math.random() * 2 - 1) * h,
      z: spread ? Math.random() * w : w,
      pz: 0
    };
  }
  function frame() {
    speed += (targetSpeed - speed) * 0.06;
    ctx.fillStyle = 'rgba(3,4,10,' + (reduced ? 1 : 0.28) + ')';
    ctx.fillRect(0, 0, w, h);
    for (var i = 0; i < stars.length; i++) {
      var s = stars[i];
      s.pz = s.z;
      s.z -= speed * (14 + progress * 44) * dpr;
      if (s.z < 1) { stars[i] = newStar(false); continue; }
      var k = 128 / s.z, pk = 128 / s.pz;
      var x = cx + s.x * k, y = cy + s.y * k;
      var px = cx + s.x * pk, py = cy + s.y * pk;
      if (x < -50 || x > w + 50 || y < -50 || y > h + 50) continue;
      var shade = Math.min(255, 120 + (1 - s.z / w) * 165);
      ctx.strokeStyle = 'rgba(' + Math.round(shade * 0.72) + ',' + Math.round(shade * 0.84) + ',255,' + Math.min(1, 0.35 + (1 - s.z / w)) + ')';
      ctx.lineWidth = Math.max(1, (1 - s.z / w) * 2.4 * dpr);
      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.lineTo(x, y);
      ctx.stroke();
    }
    requestAnimationFrame(frame);
  }

  var title = document.getElementById('title');
  var sub = document.getElementById('sub');
  var speedEl = document.getElementById('speed');
  var shown = false;

  function render(p) {
    progress = Math.max(0, Math.min(1, Number(p) || 0));
    targetSpeed = 0.5 + progress * 1.5;
    speedEl.textContent = '曲速 ' + String(Math.round(progress * 100)).padStart(3, ' ') + '%';
    if (progress > 0.62 && !shown) { shown = true; title.classList.add('on'); }
    if (progress >= 1) {
      sub.textContent = '就绪';
      targetSpeed = 0.08;
    }
  }

  window.addEventListener('resize', resize);
  resize();
  requestAnimationFrame(frame);

  if (bridge) {
    render(bridge.progress());
    bridge.on('progress', render);
  } else {
    title.classList.add('on');
    sub.textContent = 'DeepSeek Harness';
    var t0 = Date.now();
    setInterval(function () { render(((Date.now() - t0) / 3200) % 1.05); }, 60);
  }
  if (reduced) { targetSpeed = 0.2; }
})();
</script>
</body>
</html>`,
}
