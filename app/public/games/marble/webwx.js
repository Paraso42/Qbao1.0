(function () {
'use strict';
var hook = window.__qbaoHook || null;
var api = '';
try { api = hook && hook.apiBase ? String(hook.apiBase()).replace(/\/+$/, '') : ''; } catch (e) { api = ''; }
var chip = document.getElementById('qbMarbleChip');
var chipText = document.getElementById('qbMarbleChipText');
function setChip(t, g) { if (!chip) return; chipText.textContent = t; chip.className = g ? 'guest' : ''; }
var toastEl = null;
function toast(msg) {
  if (!toastEl) { toastEl = document.createElement('div'); toastEl.className = 'qb-toast'; document.body.appendChild(toastEl); }
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  clearTimeout(toastEl._t);
  toastEl._t = setTimeout(function () { toastEl.classList.remove('show'); }, 1600);
}
function modal(opts) {
  var mask = document.createElement('div');
  mask.className = 'qb-modal-mask';
  var box = document.createElement('div');
  box.className = 'qb-modal';
  var title = document.createElement('div');
  title.className = 'qb-modal-title';
  title.textContent = opts.title || '';
  var desc = document.createElement('div');
  desc.className = 'qb-modal-desc';
  desc.textContent = opts.content || '';
  var btns = document.createElement('div');
  btns.className = 'qb-modal-btns';
  box.appendChild(title);
  box.appendChild(desc);
  box.appendChild(btns);
  mask.appendChild(box);
  document.body.appendChild(mask);
  function done(r) { if (mask.parentNode) mask.parentNode.removeChild(mask); if (opts.complete) opts.complete(r || { confirm: false, cancel: true }); }
  if (opts.showCancel !== false && opts.cancelText) {
    var cbtn = document.createElement('button');
    cbtn.className = 'ghost';
    cbtn.textContent = opts.cancelText || '取消';
    cbtn.addEventListener('click', function () { done({ confirm: false, cancel: true }); });
    btns.appendChild(cbtn);
  }
  var obtn = document.createElement('button');
  obtn.className = 'primary';
  obtn.textContent = opts.confirmText || '确定';
  obtn.addEventListener('click', function () { done({ confirm: true, cancel: false }); });
  btns.appendChild(obtn);
  mask.addEventListener('click', function (e) { if (e.target === mask && opts.showCancel !== false) done({ confirm: false, cancel: true }); });
}
var canvasEl = null;
function ensureCanvas() {
  if (canvasEl) return canvasEl;
  canvasEl = document.createElement('canvas');
  canvasEl.id = 'game-canvas';
  document.body.insertBefore(canvasEl, document.body.firstChild);
  return canvasEl;
}
function toTouch(e) { return { touches: [{ clientX: e.clientX || 0, clientY: e.clientY || 0 }] }; }
function bindPointer(ev, cb) {
  window.addEventListener(ev, function (e) { e.preventDefault(); cb(toTouch(e)); }, { passive: false });
}
window.wx = {
  createCanvas: ensureCanvas,
  getSystemInfoSync: function () {
    return {
      pixelRatio: Math.min(window.devicePixelRatio || 1, 2),
      windowWidth: window.innerWidth || document.documentElement.clientWidth || 320,
      windowHeight: window.innerHeight || document.documentElement.clientHeight || 480,
    };
  },
  requestAnimationFrame: function (fn) {
    if (typeof window.requestAnimationFrame === 'function') return window.requestAnimationFrame(fn);
    return setTimeout(function () { fn(Date.now()); }, 16);
  },
  getStorageSync: function (k) {
    try { var v = localStorage.getItem('qb:' + k); return v ? JSON.parse(v) : ''; } catch (e) { return ''; }
  },
  setStorageSync: function (k, v) {
    try { localStorage.setItem('qb:' + k, JSON.stringify(v)); } catch (e) {}
  },
  showToast: function (o) { toast(o && o.title ? o.title : ''); },
  showModal: modal,
  onTouchStart: function (cb) { bindPointer('pointerdown', cb); },
  onTouchEnd: function (cb) { bindPointer('pointerup', cb); },
  onTouchCancel: function (cb) { bindPointer('pointercancel', cb); },
};
window.addEventListener('error', function (e) {
  try { document.title = 'ERR|' + (e && e.message ? e.message : 'unknown') + '|' + document.title; } catch (err) {}
});
window.addEventListener('unhandledrejection', function () {
  try { document.title = 'ERR|unhandledrejection|' + document.title; } catch (err) {}
});
var bridge = window.__qbMarbleCloud = {
  ready: false,
  mode: 'guest',
  seed: null,
  meta: { pointsBalance: 0, exchangeRate: 10, diamondToPoints: 2, diamondOutCap: 50, diamondOutUsed: 0, diamondOutLeft: 50, freeLeft: 2, freeAmount: 50 },
  _cbs: [],
  _token: null,
  _current: null,
  onReady: function (cb) { if (this.ready) { try { cb(this.seed); } catch (e) {} } else this._cbs.push(cb); },
  _flush: function () {
    renderChip();
    var cbs = this._cbs;
    this._cbs = [];
    for (var i = 0; i < cbs.length; i += 1) { try { cbs[i](this.seed); } catch (e) {} }
  },
  toast: toast,
  _applyProfile: function (p) {
    this.meta = {
      pointsBalance: p.pointsBalance || 0,
      exchangeRate: p.exchangeRate || 10,
      diamondToPoints: p.diamondToPoints != null ? p.diamondToPoints : 2,
      diamondOutCap: p.diamondOutCap != null ? p.diamondOutCap : 50,
      diamondOutUsed: p.diamondOutUsed || 0,
      diamondOutLeft: p.diamondOutLeft != null ? p.diamondOutLeft : 50,
      freeLeft: p.freeLeft != null ? p.freeLeft : 0,
      freeAmount: p.freeAmount || 50,
    };
    var owned = p.owned || {};
    var eq = p.equipped || {};
    this.seed = {
      marbles: p.marbles != null ? p.marbles : 1000,
      diamonds: p.diamonds || 0,
      skin: eq.skins != null ? eq.skins : (eq.skin || 0),
      bg: eq.bgs != null ? eq.bgs : (eq.bg || 0),
      trail: eq.trails != null ? eq.trails : (eq.trail || 0),
      halo: eq.halos != null ? eq.halos : (eq.halo || 0),
      owned: { skins: owned.skins || [0], bgs: owned.bgs || [0], trails: owned.trails || [0], halos: owned.halos || [0] },
    };
  },
  _request: function (path, opts) {
    opts = opts || {};
    opts.headers = Object.assign({ 'Content-Type': 'application/json' }, opts.headers || {});
    if (this._token) opts.headers.Authorization = 'Bearer ' + this._token;
    return fetch(api + path, opts).then(function (res) {
      if (res.ok) return res.json();
      return res.json().catch(function () { return { error: 'HTTP ' + res.status }; }).then(function (j) {
        var e = new Error((j && (j.error || j.message)) || ('HTTP ' + res.status));
        e.status = res.status;
        throw e;
      });
    });
  },
  refresh: function () {
    var self = this;
    return self._request('/api/v1/games/marble/profile').then(function (p) { self._applyProfile(p); renderChip(); return p; });
  },
  startRound: function (wager) {
    var self = this;
    return self._request('/api/v1/games/marble/round/start', { method: 'POST', body: JSON.stringify({ wager: wager }) }).then(function (r) {
      self._current = { roundId: r.roundId, wager: wager, multiplier: r.multiplier };
      return r;
    });
  },
  settleRound: function (slot) {
    var self = this;
    var cur = self._current;
    if (!cur) return Promise.reject(new Error('对局信息丢失，请重新开始'));
    self._current = null;
    return self._request('/api/v1/games/marble/round/result', { method: 'POST', body: JSON.stringify({ roundId: cur.roundId, slot: slot }) }).then(function (r) {
      return r;
    });
  },
  exchangeP2M: function (marbles) {
    var self = this;
    return self._request('/api/v1/games/marble/exchange', { method: 'POST', body: JSON.stringify({ action: 'points2marbles', amount: marbles }) }).then(function (r) {
      self.meta.pointsBalance = r.pointsBalance;
      return r;
    });
  },
  exchangeD2P: function (diamonds) {
    var self = this;
    return self._request('/api/v1/games/marble/exchange', { method: 'POST', body: JSON.stringify({ action: 'diamonds2points', amount: diamonds }) }).then(function (r) {
      self.meta.pointsBalance = r.pointsBalance;
      self.meta.diamondOutLeft = r.diamondOutLeft != null ? r.diamondOutLeft : self.meta.diamondOutLeft;
      return r;
    });
  },
  freeClaim: function () {
    var self = this;
    return self._request('/api/v1/games/marble/free-claim', { method: 'POST', body: '{}' }).then(function (r) {
      self.meta.freeLeft = r.freeLeft != null ? r.freeLeft : self.meta.freeLeft;
      return r;
    });
  },
  purchase: function (cat, idx) {
    return this._request('/api/v1/games/marble/purchase', { method: 'POST', body: JSON.stringify({ cat: cat, idx: idx }) });
  },
  reportReward: function (score) {
    if (window.__qbaoGame && typeof window.__qbaoGame.report === 'function') {
      window.__qbaoGame.report({ score: score || 0 });
    }
  },
};
function renderChip() {
  if (!bridge.ready) return setChip('加载中…', true);
  if (bridge.mode === 'guest') return setChip('游客模式 · 登录后云存档', true);
  return setChip('Qbao 积分 ' + bridge.meta.pointsBalance, false);
}
if (chip) {
  chip.addEventListener('click', function () {
    if (!bridge.ready) return;
    if (bridge.mode === 'guest') { toast('登录 Qbao 后：弹珠云存档 + 积分双向兑换'); return; }
    bridge.refresh().then(function () { toast('积分已刷新'); }).catch(function () { toast('刷新失败'); });
  });
}
function finishReady(seed) {
  bridge.ready = true;
  var bootEl = document.getElementById('qbBoot');
  if (bootEl && bootEl.parentNode) bootEl.parentNode.removeChild(bootEl);
  bridge._flush();
}
function boot() {
  // QA 后门（仅 ?qa=1&token=... 显式启用）：把测试令牌写入 localStorage（qbao-hook 会读取）
  try {
    var qs = new URLSearchParams(location.search);
    if (qs.get('qa') === '1' && qs.get('token')) localStorage.setItem('qbao_token', qs.get('token'));
  } catch (e) { /* ignore */ }
  if (!hook || !hook.getSession) { finishReady(null); tryStartQA(); return; }
  hook.getSession(function (s) {
    bridge._token = s && s.token ? String(s.token) : null;
    bridge.mode = 'cloud';
    bridge.refresh().then(function () {
      finishReady(bridge.seed);
      tryStartQA();
    }).catch(function () {
      bridge._token = null;
      bridge.mode = 'guest';
      bridge.seed = null;
      finishReady(null);
      tryStartQA();
    });
  });
}
function tryStartQA() {
  // 游客与云存档（登录态）都可自动冒烟；云模式会真实走 开局→结算 API
  if (!/qa=1/.test(location.search)) return;
  setTimeout(function () {
    var W = window.innerWidth;
    var H = window.innerHeight;
    var rowY = H - 66;
    var infoW = 68, addR = 27, actionW = 88, shopW = 54, gap = 7;
    var totalW = infoW + addR * 2 + actionW + shopW + gap * 3;
    var startX = Math.max(8, (W - totalW) / 2);
    var addX = startX + infoW + gap + addR;
    var actionX = addX + addR + gap + actionW / 2;
    function tap(x, y) {
      window.dispatchEvent(new PointerEvent('pointerdown', { clientX: x, clientY: y, bubbles: true, cancelable: true }));
      window.dispatchEvent(new PointerEvent('pointerup', { clientX: x, clientY: y, bubbles: true, cancelable: true }));
    }
    document.title = 'QA|bet5|' + document.title;
    for (var i = 0; i < 5; i += 1) tap(addX, rowY);
    setTimeout(function () {
      document.title = 'QA|confirm|' + document.title;
      tap(actionX, rowY);
      setTimeout(function () {
        document.title = 'QA|charge|' + document.title;
        window.dispatchEvent(new PointerEvent('pointerdown', { clientX: actionX, clientY: rowY, bubbles: true, cancelable: true }));
        setTimeout(function () {
          window.dispatchEvent(new PointerEvent('pointerup', { clientX: actionX, clientY: rowY, bubbles: true, cancelable: true }));
          document.title = 'QA|launched|' + document.title;
        }, 2600);
      }, 1100);
    }, 400);
  }, 1200);
}
boot();
})();