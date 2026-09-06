/* ============================================================
 * roulette.js — 俄罗斯轮盘（赌场转盘）自研前端（Qbao · MIT）
 * 规则常量与 server/src/config/roulette.js 保持同步（裁决以服务端为准，
 * 本文件仅用于渲染与展示；结算结果一律来自 POST /api/v1/roulette/spin）。
 * 动画为视觉物理模拟（转盘减速 + 小球摩擦滚动入槽），最终落点=服务端开奖号。
 * ============================================================ */
(function () {
  'use strict';

  // —— 常量（与 server/src/config/roulette.js 同步）——
  var RED_NUMBERS = [1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36];
  var WIN_MULT = { color: 2, parity: 2, combo: 4, green: 35 };
  var COMBO_PAIRS = [['red','even'], ['black','odd']];
  var MIN_BET = 1, MAX_BET = 100000, MAX_SPOTS = 3, DAILY_STAKE_CAP = 500;
  // 欧版数字顺序（顺时针，指针在 12 点；索引即绘制顺序）
  var ORDER = [0,32,15,19,4,21,2,25,17,34,6,27,13,36,11,30,8,23,10,5,24,16,33,1,20,14,31,9,22,18,29,7,28,12,35,3,26];
  function colorOf(n) { return n === 0 ? 'green' : (RED_NUMBERS.indexOf(n) >= 0 ? 'red' : 'black'); }
  function cnName(n) { var t = colorOf(n); return t === 'red' ? '红' : t === 'black' ? '黑' : '绿'; }

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

  // —— 状态 ——
  var session = null;          // { token, isDesktop } 或 null（游客）
  var balance = 0;             // 当前余额（游客=虚拟）
  var spots = [];              // [{type,value,amount}]
  var spinning = false;        // 动画/请求进行中（不可取消）
  var pendingRoundId = null;   // 未确认的 roundId（网络失败重试防双扣）
  var isSpinningDemo = false;
  var guest = false;

  function uuid4() {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') return window.crypto.randomUUID();
    // 非安全上下文 fallback（仅作幂等键，裁决不依赖其随机性）
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      var r = (Math.random() * 16) | 0;
      var v = c === 'x' ? r : ((r & 0x3) | 0x8);
      return v.toString(16);
    });
  }

  function toast(msg, isErr) {
    toastEl.textContent = msg;
    toastEl.className = 'toast' + (isErr ? ' err' : '');
    toastEl.style.display = '';
    clearTimeout(toastEl._t);
    toastEl._t = setTimeout(function () { toastEl.style.display = 'none'; }, 3200);
  }

  function fmtBal(n) { return '余额 ' + n; }
  function setBalance(n) { balance = n; balEl.textContent = fmtBal(n); }

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

  // —— 注位管理 ——
  var spotMeta = {
    color: { red: '红色', black: '黑色' },
    parity: { odd: '奇数', even: '偶数' },
    combo: { 'red+even': '红+偶', 'black+odd': '黑+奇' },
    green: { green: '绿色(0)' }
  };
  function spotLabel(b) { return (spotMeta[b.type] && spotMeta[b.type][b.value]) || (b.type + ':' + b.value); }

  function addSpot(type, value) {
    if (spinning) return;
    var amount = parseInt(amountInput.value, 10);
    if (!amount || amount < MIN_BET) { toast('金额至少 ' + MIN_BET + ' 分', true); return; }
    if (amount > MAX_BET) { toast('单注最多 ' + MAX_BET + ' 分', true); return; }
    var exists = spots.some(function (b) { return b.type === type && b.value === value; });
    if (exists) { toast('该注位已在注单中', true); return; }
    if (spots.length >= MAX_SPOTS) { toast('一局最多 ' + MAX_SPOTS + ' 个注位', true); return; }
    var total = spots.reduce(function (s, b) { return s + b.amount; }, 0) + amount;
    if (!guest && session && total > balance) { toast('总注超过当前余额', true); return; }
    spots.push({ type: type, value: value, amount: amount });
    renderSpots();
  }

  function renderSpots() {
    var total = spots.reduce(function (s, b) { return s + b.amount; }, 0);
    totalEl.textContent = total;
    if (spots.length === 0) {
      spotsUl.innerHTML = '<li class="empty">还没有注位，点击上方选择</li>';
    } else {
      spotsUl.innerHTML = '';
      spots.forEach(function (b, i) {
        var li = document.createElement('li');
        var tag = document.createElement('span'); tag.className = 'tag'; tag.textContent = spotLabel(b);
        var amt = document.createElement('span'); amt.className = 'amt'; amt.textContent = b.amount + ' 分';
        var del = document.createElement('button'); del.textContent = '✕';
        del.addEventListener('click', function () { if (!spinning) { spots.splice(i, 1); renderSpots(); } });
        li.appendChild(tag); li.appendChild(amt); li.appendChild(del);
        spotsUl.appendChild(li);
      });
    }
    document.getElementById('capNote').textContent = guest || session ? '' : '';
    enableSpinCheck();
  }

  function enableSpinCheck() {
    var total = spots.reduce(function (s, b) { return s + b.amount; }, 0);
    SpinBtn.disabled = spinning || spots.length === 0 || total < MIN_BET || (guest ? false : (session && total > balance));
  }
  enableSpinCheck();

  // 金额快捷
  document.querySelectorAll('.chips button').forEach(function (b) {
    b.addEventListener('click', function () {
      if (spinning) return;
      var v = b.getAttribute('data-v');
      if (v === 'max') {
        var max = guest ? 500 : balance;
        // 不超过硬顶，同时留出本局其余注位空间（简化：直接取可取最大值）
        var total = spots.reduce(function (s, x) { return s + x.amount; }, 0);
        var avail = Math.min(max - total, MAX_BET);
        amountInput.value = avail > 0 ? avail : MIN_BET;
      } else {
        amountInput.value = v;
      }
    });
  });

  document.querySelectorAll('.spot').forEach(function (btn) {
    btn.addEventListener('click', function () {
      addSpot(btn.getAttribute('data-type'), btn.getAttribute('data-value'));
    });
  });

  // —— 结算判定（镜像服务端；仅游客演示模式使用）——
  function colorWins(color, n) { return n !== 0 && colorOf(n) === color; }
  function parityWins(parity, n) { return n !== 0 && (parity === 'odd' ? n % 2 === 1 : n % 2 === 0); }
  function settleLocally(number) {
    return spots.map(function (b) {
      var hit = false, mult = 0;
      if (b.type === 'color') { hit = colorWins(b.value, number); mult = WIN_MULT.color; }
      else if (b.type === 'parity') { hit = parityWins(b.value, number); mult = WIN_MULT.parity; }
      else if (b.type === 'combo') {
        var p = b.value.split('+');
        hit = colorWins(p[0], number) && parityWins(p[1], number);
        mult = WIN_MULT.combo;
      } else if (b.type === 'green') { hit = number === 0; mult = WIN_MULT.green; }
      return { type: b.type, value: b.value, amount: b.amount, hit: hit, mult: mult, payout: hit ? Math.floor(b.amount * mult) : 0 };
    });
  }

  // —— 轮盘绘制 ——
  var R = 340;               // 画布半径（720 画布，中心 360）
  var cx = 360, cy = 360;
  function drawWheel(angle) {
    ctx.clearRect(0, 0, 720, 720);
    var seg = (Math.PI * 2) / 37;
    for (var i = 0; i < 37; i++) {
      var n = ORDER[i];
      var a0 = -Math.PI / 2 + i * seg + angle;
      var a1 = a0 + seg;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, R, a0, a1);
      ctx.closePath();
      ctx.fillStyle = colorOf(n);
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,.14)';
      ctx.lineWidth = 1;
      ctx.stroke();
      // 数字
      var mid = a0 + seg / 2;
      var tx = cx + Math.cos(mid) * R * 0.66;
      var ty = cy + Math.sin(mid) * R * 0.66;
      ctx.save();
      ctx.translate(tx, ty);
      ctx.fillStyle = '#fff';
      ctx.font = '900 18px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.shadowColor = 'rgba(0,0,0,.6)';
      ctx.shadowBlur = 3;
      ctx.fillText(String(n), 0, 0);
      ctx.restore();
    }
    // 内圈
    ctx.beginPath();
    ctx.arc(cx, cy, R * 0.42, 0, Math.PI * 2);
    ctx.fillStyle = '#0d141c';
    ctx.fill();
    ctx.strokeStyle = 'rgba(216,180,90,.5)';
    ctx.lineWidth = 3;
    ctx.stroke();
    // 轮轴
    ctx.beginPath();
    ctx.arc(cx, cy, 26, 0, Math.PI * 2);
    ctx.fillStyle = '#d8b45a';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(cx, cy, 14, 0, Math.PI * 2);
    ctx.fillStyle = '#0d141c';
    ctx.fill();
  }

  // —— 转盘动画（视觉物理：轮盘减速 + 小球摩擦滚动入槽，落点=服务端开奖号）——
  var wheelAngle = 0;
  var ball = { angle: 0, radius: R * 0.86, visible: false, wob: 0 };
  var anim = null;

  function pocketAngleOf(number) {
    var idx = ORDER.indexOf(number);
    var seg = (Math.PI * 2) / 37;
    // 指针在正上（-PI/2）；该格中心角
    return -Math.PI / 2 + idx * seg + seg / 2;
  }

  function easeOutCubic(t) { return 1 - Math.pow(1 - t, 3); }
  function easeInQuad(t) { return t * t; }

  function startSpinAnimation(number, onDone) {
    var DUR = 6000;
    var targetPocket = pocketAngleOf(number);
    // 让转盘至少转 4~6 圈后停在目标格正对指针（并微调让球落到格中心）
    var spinTurns = 4 + Math.floor(Math.random() * 3);
    var targetWheel = targetPocket - Math.PI * 2 * spinTurns;
    var ballStart = wheelAngle + Math.random() * Math.PI * 2;
    var ballExtra = Math.PI * 2 * (2 + Math.random() * 3); // 同向先快后慢
    ball.visible = true;
    ball.wob = 0;
    var t0 = performance.now();

    function frame(now) {
      var t = Math.min(1, (now - t0) / DUR);
      var e = easeOutCubic(t);
      wheelAngle = targetWheel + (ballStart - targetWheel) * (1 - e);
      // 球：反向在轨道上运动（相对轮盘），先快后慢 + 抖动，末端落入目标格
      if (t < 0.82) {
        var bt = t / 0.82;
        ball.angle = wheelAngle + ballExtra * (1 - easeInQuad(1 - bt)) * 0.4 + Math.PI * 2;
        ball.radius = R * 0.86 + Math.sin(bt * 30) * 2;
        ball.visible = true;
      } else {
        // 入槽阶段：球被挡板扫入目标格中心
        var st = (t - 0.82) / 0.18;
        var ease = easeOutCubic(st);
        ball.angle = targetPocket + (ball.angle - targetPocket) * (1 - ease) + Math.sin(st * 12) * 0.015 * (1 - st);
        ball.radius = R * (0.86 - 0.40 * ease);
        ball.visible = true;
      }
      drawWheel(wheelAngle);
      drawBall();
      if (t < 1) {
        anim = requestAnimationFrame(frame);
      } else {
        wheelAngle = targetWheel + (ballStart - targetWheel) * 0; // 定格
        // 校正到目标格（整数对齐）
        wheelAngle = (-targetPocket) - Math.PI * 2 * spinTurns; // 保持轮盘最终角度
        ball.angle = targetPocket;
        ball.radius = R * 0.46;
        drawWheel(wheelAngle);
        drawBall();
        onDone();
      }
    }
    anim = requestAnimationFrame(frame);
  }

  function drawBall() {
    if (!ball.visible) return;
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx + Math.cos(ball.angle) * ball.radius, cy + Math.sin(ball.angle) * ball.radius, 9, 0, Math.PI * 2);
    ctx.fillStyle = '#f6f3ea';
    ctx.shadowColor = 'rgba(0,0,0,.45)';
    ctx.shadowBlur = 5;
    ctx.fill();
    ctx.restore();
  }

  // —— 结果浮层 ——
  function showResult(number, settled, payout, bal) {
    var num = document.getElementById('rcNumber');
    num.textContent = String(number);
    num.style.color = colorOf(number) === 'green' ? '#43d27e' : colorOf(number) === 'red' ? '#ff7070' : '#f2ecd9';
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
    pw.textContent = payout > 0 ? '派彩 +' + payout + ' 分' : '未命中，注金 ' + settled.reduce(function (s, b) { return s + b.amount; }, 0) + ' 分扣除';
    pw.className = 'rc-payout' + (payout > 0 ? '' : ' lose');
    document.getElementById('rcBalance').textContent = '当前 ' + (guest ? '虚拟' : '') + '余额 ' + bal + ' 分';
    overlay.style.display = 'flex';
  }

  // —— 开始转盘 ——
  SpinBtn.addEventListener('click', function () {
    if (spinning || spots.length === 0) return;
    var total = spots.reduce(function (s, b) { return s + b.amount; }, 0);
    if (!guest && session && total > balance) { toast('总注超过当前余额', true); return; }
    spinning = true;
    isSpinningDemo = guest;
    enableSpinCheck();
    overlay.style.display = 'none';
    infoEl.textContent = '转盘旋转中…不可取消';

    if (guest) {
      // 游客演示：本地随机开奖（不落库不进账）
      var n = Math.floor(Math.random() * 37);
      var settled = settleLocally(n);
      var payout = settled.reduce(function (s, b) { return s + b.payout; }, 0);
      startSpinAnimation(n, function () {
        spinning = false;
        isSpinningDemo = false;
        setBalance(balance - total + payout);
        showResult(n, settled, payout, balance);
        infoEl.textContent = '点击押注区放注，或再来一轮';
        enableSpinCheck();
      });
      return;
    }

    // 登录：服务端裁决；roundId 未确认则重用（网络失败重试不双扣）
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
        spinning = false; enableSpinCheck();
        infoEl.textContent = r.j && r.j.error ? r.j.error : ('请求被拒绝（' + r.status + '）');
        toast(r.j && r.j.error ? r.j.error : '下注失败，请重试', true);
        return;
      }
      var data = r.j;
      pendingRoundId = null;
      startSpinAnimation(data.number, function () {
        spinning = false; enableSpinCheck();
        setBalance(data.balance);
        showResult(data.number, data.bets, data.payout, data.balance);
        infoEl.textContent = '点击押注区放注，或再来一轮';
      });
    }).catch(function () {
      // 网络异常：保留 roundId，下次点击自动重试（服务端幂等，不会双扣）
      pendingRoundId = roundId;
      spinning = false; enableSpinCheck();
      infoEl.textContent = '网络异常，请重试（同轮不会重复扣分）';
      toast('网络异常：本轮未确认，再次开始将自动续投', true);
    });
  });

  // 再来一轮
  document.getElementById('rcAgain').addEventListener('click', function () {
    overlay.style.display = 'none';
    spots = [];
    renderSpots();
    infoEl.textContent = '点击押注区放注，然后开始转盘';
  });

  drawWheel(wheelAngle);
})();
