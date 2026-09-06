/* ============================================================
 * roulette.js — 俄罗斯轮盘（赌场转盘）自研前端 v3（Qbao · MIT）
 * 规则常量与 server/src/config/roulette.js 保持同步（裁决以服务端为准）。
 * 动画（视觉物理，两段式）：
 *   阶段A：转盘 6~8 圈 easeOutQuint 猛起缓停（8.5s），小球绝对角匀速滚动、
 *           相对轮盘先快后慢，越过拨片嗒嗒声 + 径向微弹，高速时带拖影；
 *   阶段B：球在指针正下方槽内阻尼回弹 2~3 次后精确归位（0.62R 槽位）；
 *   结束帧严格对齐 12 点指针 = 中奖格中心，无任何回跳/漂移；
 *   中奖格白描边 + 数字放大闪亮 + 指针 pop + LED 显示开奖号。
 * 声音：WebAudio 实时合成（风声/拨片嗒嗒/落定低鸣/中奖和弦），零资源文件。
 * ============================================================ */
(function () {
  'use strict';

  // —— 常量（与 server/src/config/roulette.js 同步）——
  var RED_NUMBERS = [1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36];
  var WIN_MULT = { color: 2, parity: 2, combo: 4, green: 35 };
  var MIN_BET = 1, MAX_BET = 100000, MAX_SPOTS = 3, DAILY_STAKE_CAP = 500;
  var ORDER = [0,32,15,19,4,21,2,25,17,34,6,27,13,36,11,30,8,23,10,5,24,16,33,1,20,14,31,9,22,18,29,7,28,12,35,3,26];
  function colorOf(n) { return n === 0 ? 'green' : (RED_NUMBERS.indexOf(n) >= 0 ? 'red' : 'black'); }
  function cnName(n) { var t = colorOf(n); return t === 'red' ? '红' : t === 'black' ? '黑' : '绿'; }
  function cnColor(n) { return colorOf(n) === 'green' ? '#2e9e5b' : colorOf(n) === 'red' ? '#d92b2b' : '#22262f'; }

  // —— 元素 ——
  var cv = document.getElementById('wheel');
  var ctx = cv.getContext('2d');
  var SpinBtn = document.getElementById('spin');
  var amountInput = document.getElementById('amount');
  var totalEl = document.getElementById('total');
  var spotsUl = document.getElementById('spots');
  var infoEl = document.getElementById('wheelInfo');
  var balEl = document.getElementById('bal');
  var whoEl = document.getElementById('who');
  var overlay = document.getElementById('resultOverlay');
  var toastEl = document.getElementById('toast');
  var led = document.getElementById('led');
  var addSpotBtn = document.getElementById('addSpot');

  // —— 状态 ——
  var session = null;
  var balance = 0;
  var spots = [];
  var spinning = false;          // API+动画进行中（不可取消）
  var pendingRoundId = null;
  var guest = false;
  var picks = { color: null, parity: null };

  function uuid4() {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') return window.crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      var r = (Math.random() * 16) | 0;
      return (c === 'x' ? r : ((r & 0x3) | 0x8)).toString(16);
    });
  }

  function toast(msg, isErr) {
    toastEl.textContent = msg;
    toastEl.className = 'toast' + (isErr ? ' err' : '');
    toastEl.style.display = '';
    clearTimeout(toastEl._t);
    toastEl._t = setTimeout(function () { toastEl.style.display = 'none'; }, 3400);
  }

  function setBalance(n) { balance = n; balEl.textContent = '余额 ' + n; }

  // —— 会话与余额 ——
  window.__qbaoHook.getSession(function (s) {
    session = (s && s.token) ? s : null;
    if (!session) {
      guest = true;
      whoEl.textContent = '游客';
      document.getElementById('demoNote').style.display = '';
      setBalance(500);
      enableSpinCheck();
      return;
    }
    var base = window.__qbaoHook.apiBase();
    fetch(base + '/api/v1/users/me', { headers: { 'Authorization': 'Bearer ' + session.token } })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (u) { whoEl.textContent = '👤 ' + ((u && (u.displayName || u.username)) || '已登录'); })
      .catch(function () { whoEl.textContent = '已登录'; });
    fetch(base + '/api/v1/points/balance', { headers: { 'Authorization': 'Bearer ' + session.token } })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) { if (j && typeof j.balance === 'number') setBalance(j.balance); })
      .catch(function () {});
  });

  // —— 双选 UI ——
  function spotLabel(b) {
    if (b.type === 'color') return b.value === 'red' ? '红色' : '黑色';
    if (b.type === 'parity') return b.value === 'odd' ? '奇数' : '偶数';
    if (b.type === 'combo') { var p = b.value.split('+'); return (p[0] === 'red' ? '红' : '黑') + '+' + (p[1] === 'odd' ? '奇' : '偶'); }
    return '绿色(0)';
  }
  function spotDot(b) {
    if (b.type === 'combo') { var p = b.value.split('+'); return 'linear-gradient(90deg,' + cnColor(p[0] === 'red' ? 1 : 2) + ',' + cnColor(p[1] === 'odd' ? 3 : 4) + ')'; }
    if (b.type === 'color') return cnColor(b.value === 'red' ? 1 : 2);
    if (b.type === 'parity') return cnColor(b.value === 'odd' ? 3 : 4);
    return '#2e9e5b';
  }
  function setPick(group, value) {
    if (spinning) return;
    picks[group] = (picks[group] === value) ? null : value;
    renderPicks();
  }
  function comboLabel() {
    var c = picks.color, p = picks.parity;
    if (!c && !p) return null;
    return (c ? (c === 'red' ? '红' : '黑') : '') + (c && p ? '+' : '') + (p ? (p === 'odd' ? '奇' : '偶') : '') + ' ×' + (c && p ? 4 : 2);
  }
  function renderPicks() {
    document.querySelectorAll('.pick[data-pick]').forEach(function (b) {
      var g = b.getAttribute('data-pick');
      var v = b.getAttribute('data-value');
      b.classList.remove('on-red', 'on-black', 'on-odd', 'on-even');
      if (picks[g] === v) b.classList.add('on-' + v);
    });
    var label = comboLabel();
    addSpotBtn.disabled = !label || spinning;
    addSpotBtn.textContent = label ? '+ 加入注单（' + label + '）' : '+ 加入注单（先选颜色 / 奇偶）';
    enableSpinCheck();
  }
  document.querySelectorAll('.pick[data-pick]').forEach(function (b) {
    b.addEventListener('click', function () { setPick(b.getAttribute('data-pick'), b.getAttribute('data-value')); });
  });
  document.getElementById('greenBtn').addEventListener('click', function () {
    if (spinning) return;
    var amount = currentAmount();
    if (!amount) { toast('请输入有效金额', true); return; }
    if (pushSpot({ type: 'green', value: 'green', amount: amount })) { picks.color = null; picks.parity = null; renderPicks(); }
  });

  function currentAmount() {
    var v = parseInt(amountInput.value, 10);
    return v && v >= MIN_BET ? v : null;
  }
  function pushSpot(b) {
    if (!b.amount || b.amount < MIN_BET) { toast('金额至少 ' + MIN_BET + ' 分', true); return false; }
    if (b.amount > MAX_BET) { toast('单注最多 ' + MAX_BET + ' 分', true); return false; }
    var dup = spots.some(function (x) { return x.type === b.type && x.value === b.value; });
    if (dup) { toast('该注位已在注单中', true); return false; }
    if (spots.length >= MAX_SPOTS) { toast('一局最多 ' + MAX_SPOTS + ' 个注位', true); return false; }
    if (!guest && session) {
      var total = spots.reduce(function (s, x) { return s + x.amount; }, 0) + b.amount;
      if (total > balance) { toast('总注超过当前余额', true); return false; }
    }
    spots.push(b);
    renderSpots();
    return true;
  }
  addSpotBtn.addEventListener('click', function () {
    if (spinning) return;
    var amount = currentAmount();
    if (!amount) { toast('请输入有效金额', true); return; }
    var c = picks.color, p = picks.parity;
    if (!c && !p) { toast('请先选择颜色或奇偶', true); return; }
    var b = c && p ? { type: 'combo', value: c + '+' + p, amount: amount }
      : c ? { type: 'color', value: c, amount: amount } : { type: 'parity', value: p, amount: amount };
    if (pushSpot(b)) { picks.color = null; picks.parity = null; renderPicks(); }
  });

  function renderSpots() {
    var total = spots.reduce(function (s, b) { return s + b.amount; }, 0);
    totalEl.textContent = total;
    if (spots.length === 0) {
      spotsUl.innerHTML = '<li class="empty">还没有注位，先在上方选择</li>';
    } else {
      spotsUl.innerHTML = '';
      spots.forEach(function (b, i) {
        var li = document.createElement('li');
        var tag = document.createElement('span'); tag.className = 'tag';
        tag.innerHTML = '<span class="sdot" style="background:' + spotDot(b) + '"></span>' + spotLabel(b) +
          (b.type === 'combo' ? ' ×4' : b.type === 'green' ? ' ×35' : ' ×2');
        var amt = document.createElement('span'); amt.className = 'amt'; amt.textContent = b.amount + ' 分';
        var del = document.createElement('button'); del.textContent = '✕';
        del.addEventListener('click', function () { if (!spinning) { spots.splice(i, 1); renderSpots(); } });
        li.appendChild(tag); li.appendChild(amt); li.appendChild(del);
        spotsUl.appendChild(li);
      });
    }
    enableSpinCheck();
  }
  function enableSpinCheck() {
    var total = spots.reduce(function (s, b) { return s + b.amount; }, 0);
    SpinBtn.disabled = spinning || spots.length === 0 || (guest ? false : (session && total > balance));
  }
  document.querySelectorAll('.chips button').forEach(function (b) {
    b.addEventListener('click', function () {
      if (spinning) return;
      var v = b.getAttribute('data-v');
      if (v === 'max') {
        var max = guest ? 500 : balance;
        var total = spots.reduce(function (s, x) { return s + x.amount; }, 0);
        var avail = Math.min(max - total, MAX_BET);
        amountInput.value = avail > 0 ? avail : MIN_BET;
      } else amountInput.value = v;
    });
  });

  // —— 结算判定（镜像服务端；仅游客演示模式使用）——
  function settleLocally(number) {
    return spots.map(function (b) {
      var hit = false, mult = 0;
      if (b.type === 'color') { hit = number !== 0 && colorOf(number) === b.value; mult = WIN_MULT.color; }
      else if (b.type === 'parity') { hit = number !== 0 && (b.value === 'odd' ? number % 2 === 1 : number % 2 === 0); mult = WIN_MULT.parity; }
      else if (b.type === 'combo') {
        var p = b.value.split('+');
        hit = number !== 0 && colorOf(number) === p[0] && (p[1] === 'odd' ? number % 2 === 1 : number % 2 === 0);
        mult = WIN_MULT.combo;
      } else if (b.type === 'green') { hit = number === 0; mult = WIN_MULT.green; }
      return { type: b.type, value: b.value, amount: b.amount, hit: hit, mult: mult, payout: hit ? Math.floor(b.amount * mult) : 0 };
    });
  }

  // ================================================================
  // 绘制（立体感：金属外圈+拨片 / 槽深 / 格面凸起 / 轴心 / 高光球）
  // ================================================================
  // DPR 修复：HiDPI 下 720 逻辑坐标按设备像素渲染，CSS 缩放不再发糊
  var DPR = Math.min(2, window.devicePixelRatio || 1);
  cv.width = 720 * DPR; cv.height = 720 * DPR;
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);

  var R = 340, CX = 360, CY = 360;
  var SEG = (Math.PI * 2) / 37;
  var POCKET_R = R * 0.62;      // 槽位半径（评审：槽中线，避免落在内盘边缘）
  var wheelAngle = 0;
  var ball = { angle: 0, radius: 0, visible: false };
  var trail = [];               // 拖影（记录最近球位）

  function indexOfNumber(n) { return ORDER.indexOf(n); }
  // θ_end = -(idx+0.5)·SEG - 2πN：idx 格中心精确对 12 点指针
  function finalWheelAngle(idx, turns) { return -(idx + 0.5) * SEG - Math.PI * 2 * turns; }

  function drawWheel(angle, opts) {
    opts = opts || {};
    ctx.clearRect(0, 0, 720, 720);
    var hiIdx = (opts.highlight !== undefined) ? indexOfNumber(opts.highlight) : -1;
    var hiFlash = opts.hiPulse !== undefined ? opts.hiPulse : 0;

    // —— 金属外圈（对角渐变 + 内外描边 + 拨片线）——
    var ring = ctx.createLinearGradient(0, 0, 720, 720);
    ring.addColorStop(0, '#e8e3d8');
    ring.addColorStop(0.5, '#8d8678');
    ring.addColorStop(1, '#c9c2b4');
    ctx.beginPath(); ctx.arc(CX, CY, R + 4, 0, Math.PI * 2); ctx.fillStyle = ring; ctx.fill();
    ctx.beginPath(); ctx.arc(CX, CY, R + 4, 0, Math.PI * 2); ctx.strokeStyle = '#201b12'; ctx.lineWidth = 2; ctx.stroke();
    // 内沿暗弧（外圈内阴影感）
    ctx.beginPath(); ctx.arc(CX, CY, R + 1, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(0,0,0,.35)'; ctx.lineWidth = 3; ctx.stroke();
    // 37 根拨片线（外圈 R+6 ~ R+22）
    ctx.save();
    ctx.strokeStyle = 'rgba(40,30,10,.55)';
    ctx.lineWidth = 2;
    for (var i = 0; i < 37; i++) {
      var pa = -Math.PI / 2 + i * SEG + angle;
      ctx.beginPath();
      ctx.moveTo(CX + Math.cos(pa) * (R - 16), CY + Math.sin(pa) * (R - 16));
      ctx.lineTo(CX + Math.cos(pa) * (R + 4), CY + Math.sin(pa) * (R + 4));
      ctx.stroke();
    }
    ctx.restore();

    // —— 槽底深环 + 37 格（每格：深色槽壁 → 渐变格面 → 数字）——
    ctx.beginPath(); ctx.arc(CX, CY, R - 28, 0, Math.PI * 2); ctx.fillStyle = '#171208'; ctx.fill();
    for (var k = 0; k < 37; k++) {
      var n = ORDER[k];
      var a0 = -Math.PI / 2 + k * SEG + angle;
      var a1 = a0 + SEG;
      var col = colorOf(n);
      var isHi = (k === hiIdx);
      // 槽壁（左侧略深，表纵深）
      ctx.beginPath(); ctx.moveTo(CX, CY); ctx.arc(CX, CY, R - 28, a0, a1); ctx.closePath();
      ctx.fillStyle = col === 'red' ? '#6d1010' : col === 'black' ? '#05070b' : '#0b4a29';
      ctx.fill();
      // 格面（径向渐变，中心高光表凸起；边缘压暗表槽深）
      var midA = a0 + SEG / 2;
      var gx = CX + Math.cos(midA) * (R - 160);
      var gy = CY + Math.sin(midA) * (R - 160);
      var grd = ctx.createRadialGradient(gx, gy - 40, 12, CX, CY, R);
      if (col === 'red') { grd.addColorStop(0, '#f25757'); grd.addColorStop(1, '#8f1c1c'); }
      else if (col === 'black') { grd.addColorStop(0, '#41464f'); grd.addColorStop(1, '#12151c'); }
      else { grd.addColorStop(0, '#35b874'); grd.addColorStop(1, '#0d5533'); }
      ctx.beginPath(); ctx.moveTo(CX, CY); ctx.arc(CX, CY, R - 28, a0 + 0.014, a1 - 0.014); ctx.closePath();
      ctx.fillStyle = grd; ctx.fill();
      // 格间亮边（表拨片）
      ctx.beginPath();
      ctx.moveTo(CX + Math.cos(a0) * (R - 166), CY + Math.sin(a0) * (R - 166));
      ctx.lineTo(CX + Math.cos(a0) * (R - 30), CY + Math.sin(a0) * (R - 30));
      ctx.strokeStyle = 'rgba(255,255,255,.16)'; ctx.lineWidth = 1.2; ctx.stroke();
      // 数字（中奖格放大闪亮）
      var scale = isHi && hiFlash > 0 ? 1 + 0.28 * hiFlash : 1;
      var tx = CX + Math.cos(midA) * (R - 168);
      var ty = CY + Math.sin(midA) * (R - 168);
      ctx.save();
      ctx.translate(tx, ty);
      ctx.scale(scale, scale);
      ctx.font = '900 19px system-ui, sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillStyle = 'rgba(0,0,0,.55)';
      ctx.fillText(String(n), 0, 1.6);
      ctx.fillStyle = isHi && hiFlash > 0 ? '#fff8dc' : '#ffffff';
      ctx.fillText(String(n), 0, 0);
      ctx.restore();
      // 中奖格白描边 + 辉光
      if (isHi) {
        ctx.save();
        ctx.shadowColor = 'rgba(255,255,235,.95)';
        ctx.shadowBlur = 16 * (0.4 + 0.6 * hiFlash);
        ctx.strokeStyle = 'rgba(255,255,255,' + (0.5 + 0.5 * hiFlash) + ')';
        ctx.lineWidth = 3;
        ctx.beginPath(); ctx.arc(CX, CY, R - 30, a0 + 0.03, a1 - 0.03); ctx.stroke();
        ctx.restore();
      }
    }
    // —— 内圈 ——
    ctx.beginPath(); ctx.arc(CX, CY, R - 176, 0, Math.PI * 2);
    var inner = ctx.createRadialGradient(CX, CY - 24, 8, CX, CY, R - 176);
    inner.addColorStop(0, '#2c313c'); inner.addColorStop(1, '#0a0c10');
    ctx.fillStyle = inner; ctx.fill();
    ctx.strokeStyle = 'rgba(216,180,90,.5)'; ctx.lineWidth = 2.5; ctx.stroke();
    // —— 轴心（3 层金属 + specular 高光）——
    var hub = ctx.createRadialGradient(CX - 16, CY - 20, 4, CX, CY, 118);
    hub.addColorStop(0, '#f6f1e2'); hub.addColorStop(0.35, '#b3a277'); hub.addColorStop(1, '#4c4432');
    ctx.beginPath(); ctx.arc(CX, CY, 118, 0, Math.PI * 2); ctx.fillStyle = hub; ctx.fill();
    var hub2 = ctx.createRadialGradient(CX, CY, 2, CX, CY, 54);
    hub2.addColorStop(0, '#12161d'); hub2.addColorStop(1, '#2e3546');
    ctx.beginPath(); ctx.arc(CX, CY, 54, 0, Math.PI * 2); ctx.fillStyle = hub2; ctx.fill();
    ctx.beginPath(); ctx.arc(CX - 10, CY - 12, 5, 0, Math.PI * 2); ctx.fillStyle = 'rgba(255,255,255,.6)'; ctx.fill();
    ctx.beginPath(); ctx.arc(CX, CY, 12, 0, Math.PI * 2); ctx.fillStyle = '#d8b45a'; ctx.fill();
  }

  // 小球（高光 + 拖影）
  function drawBall() {
    if (!ball.visible) return;
    var bx = CX + Math.cos(ball.angle) * ball.radius;
    var by = CY + Math.sin(ball.angle) * ball.radius;
    // 拖影（高速时 2 阶 α 拖尾）
    for (var i = 0; i < trail.length; i++) {
      var a = trail[trail.length - 1 - i];
      if (!a) continue;
      ctx.beginPath();
      ctx.arc(a.x, a.y, 9.5 - i * 2, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(240,236,223,' + (0.14 - i * 0.07) + ')';
      ctx.fill();
    }
    // 投影
    ctx.beginPath(); ctx.arc(bx, by, 11, 0, Math.PI * 2); ctx.fillStyle = 'rgba(0,0,0,.32)'; ctx.fill();
    // 球体
    var bg = ctx.createRadialGradient(bx - 4, by - 5, 1, bx, by, 10);
    bg.addColorStop(0, '#ffffff'); bg.addColorStop(0.62, '#efe9db'); bg.addColorStop(1, '#b5ad99');
    ctx.beginPath(); ctx.arc(bx, by, 9.5, 0, Math.PI * 2); ctx.fillStyle = bg; ctx.fill();
    ctx.beginPath(); ctx.arc(bx - 3.4, by - 3.8, 2.7, 0, Math.PI * 2); ctx.fillStyle = 'rgba(255,255,255,.95)'; ctx.fill();
  }
  function pushTrail() {
    trail.push({ x: CX + Math.cos(ball.angle) * ball.radius, y: CY + Math.sin(ball.angle) * ball.radius });
    if (trail.length > 2) trail.shift();
  }
  function clearTrail() { trail = []; }

  // ================================================================
  // WebAudio 合成音效（零资源）
  // ================================================================
  var AC = null, soundOn = true, spinNode = null, spinGain = null, spinFilter = null;
  function ensureAudio() {
    if (!soundOn) return;
    try {
      if (!AC) {
        var Ctor = window.AudioContext || window.webkitAudioContext;
        if (!Ctor) return;
        AC = new Ctor();
        var len = AC.sampleRate * 2;
        var buf = AC.createBuffer(1, len, AC.sampleRate);
        var d = buf.getChannelData(0);
        for (var i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * 0.5;
        spinNode = AC.createBufferSource(); spinNode.buffer = buf; spinNode.loop = true;
        spinFilter = AC.createBiquadFilter(); spinFilter.type = 'bandpass'; spinFilter.frequency.value = 700; spinFilter.Q.value = 0.7;
        spinGain = AC.createGain(); spinGain.gain.value = 0;
        spinNode.connect(spinFilter); spinFilter.connect(spinGain); spinGain.connect(AC.destination);
        spinNode.start();
      } else if (AC.state === 'suspended') { AC.resume(); }
    } catch (e) {}
  }
  function setSpinVolume(v) { if (AC && spinGain) { try { spinGain.gain.setTargetAtTime(Math.max(0, v), AC.currentTime, 0.07); } catch (e) {} } }
  function setSpinSpeed(s) { if (AC && spinFilter) { try { spinFilter.frequency.setTargetAtTime(300 + s * 2100, AC.currentTime, 0.06); } catch (e) {} } }
  function sfxTick(vol) {
    if (!AC || !soundOn) return;
    try {
      var o = AC.createOscillator(); var g = AC.createGain();
      o.type = 'triangle'; o.frequency.value = 1750 + Math.random() * 420;
      g.gain.setValueAtTime(0.05 * (vol || 1), AC.currentTime);
      g.gain.exponentialRampToValueAtTime(0.0001, AC.currentTime + 0.03);
      o.connect(g); g.connect(AC.destination); o.start(); o.stop(AC.currentTime + 0.035);
    } catch (e) {}
  }
  function sfxLand() {
    if (!AC || !soundOn) return;
    try {
      for (var k = 0; k < 3; k++) {
        var o = AC.createOscillator(); var g = AC.createGain();
        var t0 = AC.currentTime + k * 0.07;
        o.type = 'sine';
        o.frequency.setValueAtTime(96 - k * 14, t0);
        o.frequency.exponentialRampToValueAtTime(52, t0 + 0.09);
        g.gain.setValueAtTime(0.12 - k * 0.03, t0);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.11);
        o.connect(g); g.connect(AC.destination); o.start(t0); o.stop(t0 + 0.12);
      }
    } catch (e) {}
  }
  function sfxWin() {
    if (!AC || !soundOn) return;
    try {
      [880, 1175, 1568].forEach(function (f, i) {
        var o = AC.createOscillator(); var g = AC.createGain();
        var t0 = AC.currentTime + i * 0.09;
        o.type = 'triangle'; o.frequency.value = f;
        g.gain.setValueAtTime(0.07, t0);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.3);
        o.connect(g); g.connect(AC.destination); o.start(t0); o.stop(t0 + 0.32);
      });
    } catch (e) {}
  }
  (function () {
    var btn = document.createElement('button');
    btn.textContent = '🔊';
    btn.style.cssText = 'background:none;border:1px solid var(--line);border-radius:999px;padding:4px 10px;font-size:13px;cursor:pointer;color:var(--text-2)';
    btn.addEventListener('click', function () {
      soundOn = !soundOn;
      btn.textContent = soundOn ? '🔊' : '🔇';
      if (soundOn) ensureAudio(); else if (AC) AC.suspend();
      if (!soundOn && spinGain) spinGain.gain.value = 0;
    });
    var hud = document.querySelector('.hud');
    if (hud) hud.appendChild(btn);
  })();

  // ================================================================
  // 动画（两段式物理 + 严格对齐 + 隐藏暂停）
  // ================================================================
  var reducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var anim = null;
  var hiddenOffset = 0, hiddenAt = 0;
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) { hiddenAt = window.performance.now(); }
    else if (hiddenAt && anim) { hiddenOffset += window.performance.now() - hiddenAt; hiddenAt = 0; }
  });

  function startSpinAnimation(number, onDone) {
    var idx = indexOfNumber(number);
    if (reducedMotion) {
      // 无障碍：直接定格最终姿态
      wheelAngle = finalWheelAngle(idx, 0);
      ball.angle = -Math.PI / 2; ball.radius = POCKET_R; ball.visible = true;
      drawWheel(wheelAngle, { highlight: number, hiPulse: 1 });
      drawBall();
      led.textContent = String(number);
      onDone();
      return;
    }
    var DUR = 8500;
    var turns = 6 + Math.floor(Math.random() * 3);   // 6~8 圈，起速约 4 rev/s
    var W0 = wheelAngle;
    var Wf = finalWheelAngle(idx, turns);
    // 阶段A：球绝对角匀速；targetAbs = 指针正下 + 2πK（保证结束帧精确）
    var extraLaps = 9 + Math.floor(Math.random() * 3); // 球相对轮盘多转 9~11 圈
    var relStart = Math.random() * Math.PI * 2;
    var relEnd = relStart + extraLaps * Math.PI * 2;
    var K = Math.ceil((Wf + relEnd + Math.PI / 2) / (Math.PI * 2));
    var targetAbs = -Math.PI / 2 + Math.PI * 2 * K;
    var absStart = W0 + relStart;
    var lastFret = 0;
    var t0 = performance.now();

    function frame(now) {
      var t = Math.min(1, (now - hiddenOffset - t0) / DUR);
      var e5 = 1 - Math.pow(1 - t, 5);               // easeOutQuint
      wheelAngle = W0 + (Wf - W0) * e5;

      var speed = Math.max(0, 1 - t);                // 0..1 归一速度（音效）

      if (t < 0.68) {
        // 阶段A：球绝对角匀速推进（相对轮盘由快渐慢），轨道内旋
        var u = t / 0.68;
        ball.angle = absStart + (targetAbs - absStart) * u;
        ball.radius = R * 0.80 - u * (R * 0.80 - R * 0.70);
        // 拨片检测：相对角跨过格边界 → 嗒嗒 + 径向来一个脉冲
        var rel = ball.angle - wheelAngle;
        var fret = Math.floor(rel / SEG);
        if (fret !== lastFret && t > 0.03) {
          lastFret = fret;
          sfxTick(0.55 + 0.45 * speed);
          ball.radius += (Math.random() > 0.5 ? 1 : -1) * 1.6;   // 拨片径向微弹
        }
        ball.visible = true;
        pushTrail();
        setSpinVolume(0.045 + 0.10 * speed);
        setSpinSpeed(speed);
      } else {
        // 阶段B：槽内阻尼回弹（A·e^(-5τ)·sin(12τ)）后精确归位
        var tau = (t - 0.68) / 0.32;
        var A = 0.07;
        ball.angle = -Math.PI / 2 + A * Math.exp(-5 * tau) * Math.sin(12 * tau);
        ball.radius = (R * 0.70) + (POCKET_R - R * 0.70) * (1 - Math.pow(1 - tau, 3));
        ball.visible = true;
        clearTrail();
        setSpinVolume(0.05 * (1 - tau));
        setSpinSpeed(Math.max(0, 1 - tau));
      }

      drawWheel(wheelAngle);
      drawBall();
      led.textContent = '…';

      if (t < 1) {
        anim = requestAnimationFrame(frame);
      } else {
        // 结束帧：零跳变（wheelAngle 已收敛 Wf，球角已收敛 -π/2，仅显式定格 + 高亮动画）
        wheelAngle = Wf;
        ball.angle = -Math.PI / 2;
        ball.radius = POCKET_R;
        ball.visible = true;
        clearTrail();
        setSpinVolume(0);
        sfxLand();
        var ps = performance.now();
        var pfin = false;
        function pulse(now2) {
          var pt = Math.min(1, (now2 - ps) / 1300);
          var fl = (Math.sin(pt * 6) + 1) / 2;
          drawWheel(wheelAngle, { highlight: number, hiPulse: pt < 1 ? fl : 1 });
          drawBall();
          if (pt < 1) { anim = requestAnimationFrame(pulse); }
          else {
            if (!pfin) {
              pfin = true;
              drawWheel(wheelAngle, { highlight: number, hiPulse: 1 });
              drawBall();
              led.textContent = String(number);
              onDone();
            }
          }
        }
        anim = requestAnimationFrame(pulse);
      }
    }
    anim = requestAnimationFrame(frame);
  }

  function drawStatic() {
    drawWheel(wheelAngle);
    drawBall();
    led.textContent = '—';
  }

  // —— 结果浮层 ——
  function showResult(number, settled, payout, bal) {
    var num = document.getElementById('rcNumber');
    num.textContent = String(number);
    num.style.color = cnColor(number);
    led.textContent = String(number);
    document.getElementById('rcColor').textContent = '开奖 ' + cnName(number) + (number === 0 ? '（绿色，无颜色/奇偶）' : '');
    var betsEl = document.getElementById('rcBets');
    betsEl.innerHTML = '';
    settled.forEach(function (b) {
      var li = document.createElement('div');
      li.className = b.hit ? 'hit' : 'miss';
      li.textContent = (b.hit ? '✓ 命中  ' : '✗ 未中  ') + spotLabel(b) + ' ' + b.amount + ' 分 ×' + b.mult + ' → ' + b.payout + ' 分';
      betsEl.appendChild(li);
    });
    var pw = document.getElementById('rcPayout');
    var stake = settled.reduce(function (s, b) { return s + b.amount; }, 0);
    pw.textContent = payout > 0 ? '派彩 +' + payout + ' 分' : '未命中，注金 ' + stake + ' 分扣除';
    pw.className = 'rc-payout' + (payout > 0 ? '' : ' lose');
    document.getElementById('rcBalance').textContent = '当前' + (guest ? '虚拟' : '') + '余额 ' + bal + ' 分';
    overlay.style.display = 'flex';
    if (payout > 0) sfxWin();
  }

  // —— 开始转盘 ——
  SpinBtn.addEventListener('click', function () {
    if (spinning || spots.length === 0) return;
    var total = spots.reduce(function (s, b) { return s + b.amount; }, 0);
    if (!guest && session && total > balance) { toast('总注超过当前余额', true); return; }
    ensureAudio();
    spinning = true;
    enableSpinCheck();
    renderPicks();
    overlay.style.display = 'none';
    led.textContent = '…';
    infoEl.textContent = '转盘旋转中…不可取消';

    if (guest) {
      var n = Math.floor(Math.random() * 37);
      var settled = settleLocally(n);
      var payout = settled.reduce(function (s, b) { return s + b.payout; }, 0);
      startSpinAnimation(n, function () {
        spinning = false; enableSpinCheck();
        setBalance(balance - total + payout);
        showResult(n, settled, payout, balance);
        infoEl.textContent = '再来一轮：清空注单后重新放注';
      });
      return;
    }

    var roundId = pendingRoundId || uuid4();
    var body = { roundId: roundId, bets: spots.slice() };
    var base = window.__qbaoHook.apiBase();
    fetch(base + '/api/v1/roulette/spin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + session.token },
      body: JSON.stringify(body)
    }).then(function (res) {
      return res.json().then(function (j) { return { ok: res.ok, status: res.status, j: j }; });
    }).then(function (r) {
      if (!r.ok) {
        pendingRoundId = null;
        spinning = false; enableSpinCheck(); renderPicks();
        infoEl.textContent = r.j && r.j.error ? r.j.error : ('请求被拒绝（' + r.status + '）');
        toast(r.j && r.j.error ? r.j.error : '下注失败，请重试', true);
        return;
      }
      var data = r.j;
      pendingRoundId = null;
      startSpinAnimation(data.number, function () {
        spinning = false; enableSpinCheck(); renderPicks();
        setBalance(data.balance);
        showResult(data.number, data.bets, data.payout, data.balance);
        infoEl.textContent = '再来一轮：清空注单后重新放注';
      });
    }).catch(function () {
      pendingRoundId = roundId;
      spinning = false; enableSpinCheck(); renderPicks();
      infoEl.textContent = '网络异常，请重试（同轮不会重复扣分）';
      toast('网络异常：本轮未确认，再次开始将自动续投', true);
    });
  });

  document.getElementById('rcAgain').addEventListener('click', function () {
    overlay.style.display = 'none';
    spots = [];
    picks.color = null; picks.parity = null;
    renderSpots(); renderPicks();
    infoEl.textContent = '先选注，再开始转盘；结果由服务器裁决';
  });

  drawStatic();
})();