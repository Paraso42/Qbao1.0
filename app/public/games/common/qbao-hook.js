/*
 * Qbao 游戏空间数据钩子（v0）— 由每个游戏页引入：
 *   <script>window.__QBAO_GAME_ID__ = '2048';</script>
 *   <script src="../common/qbao-hook.js"></script>
 *
 * 职责：
 *   1. 读取登录凭据 — 网页端：同源 localStorage('qbao_token') 混淆值（只读，不写不删）；
 *      桌面端：preload 桥 __qbaoDesktop.secretLoad('token')（主进程 safeStorage）。
 *   2. 窗口内合并游戏上报事件（3 秒抖动窗口），统一 POST /api/v1/games 保存成绩。
 *   3. 注入「返回游戏空间」悬浮按钮，保证无导航栏环境（Electron 子窗口）可回大厅。
 *
 * 注意：deobfuscate 与 app/src/services/secureStore.js 必须保持同步（改动两端互指）。
 */
(function (global) {
  'use strict';

  var GAME_ID = global.__QBAO_GAME_ID__ || 'unknown';
  var OBF_PREFIX = 'qb1:';
  var B64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  var OBF_SALT = 'qbao-local-obf-2026';

  // —— UTF-8 字节编解码（与 secureStore.js 同款，base64 按字节处理）——
  function utf8Bytes(str) {
    var out = [];
    for (var i = 0; i < str.length; i++) {
      var c = str.charCodeAt(i);
      if (c < 0x80) out.push(c);
      else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f));
      else if (c >= 0xd800 && c <= 0xdbff && i + 1 < str.length) {
        var c2 = str.charCodeAt(i + 1);
        if (c2 >= 0xdc00 && c2 <= 0xdfff) {
          var cp = 0x10000 + ((c - 0xd800) << 10) + (c2 - 0xdc00);
          out.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 0x3f), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
          i++;
        } else out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
      } else out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
    }
    return out;
  }
  function utf8String(bytes) {
    var out = '';
    for (var i = 0; i < bytes.length;) {
      var b = bytes[i];
      if (b < 0x80) { out += String.fromCharCode(b); i++; }
      else if (b < 0xe0) { out += String.fromCharCode(((b & 0x1f) << 6) | (bytes[i + 1] & 0x3f)); i += 2; }
      else if (b < 0xf0) {
        out += String.fromCharCode(((b & 0x0f) << 12) | ((bytes[i + 1] & 0x3f) << 6) | (bytes[i + 2] & 0x3f));
        i += 3;
      } else {
        var cp = ((b & 0x07) << 18) | ((bytes[i + 1] & 0x3f) << 12) | ((bytes[i + 2] & 0x3f) << 6) | (bytes[i + 3] & 0x3f);
        out += String.fromCharCode(0xd800 + ((cp - 0x10000) >> 10), 0xdc00 + ((cp - 0x10000) & 0x3ff));
        i += 4;
      }
    }
    return out;
  }
  function b64decode(str) {
    var clean = String(str || '').replace(/=+$/, '');
    if (!clean) return '';
    var bytes = [];
    for (var i = 0; i < clean.length; i += 4) {
      var c1 = B64_CHARS.indexOf(clean[i]);
      var c2 = B64_CHARS.indexOf(clean[i + 1]);
      var c3 = clean[i + 2] ? B64_CHARS.indexOf(clean[i + 2]) : -1;
      var c4 = clean[i + 3] ? B64_CHARS.indexOf(clean[i + 3]) : -1;
      if (c1 < 0 || c2 < 0) return null;
      bytes.push((c1 << 2) | (c2 >> 4));
      if (c3 >= 0) bytes.push(((c2 & 15) << 4) | (c3 >> 2));
      if (c4 >= 0) bytes.push(((c3 & 3) << 6) | c4);
    }
    return utf8String(bytes);
  }
  function deobfuscate(value) {
    if (value == null) return value;
    var s = String(value);
    if (s.indexOf(OBF_PREFIX) !== 0) return s;
    try {
      var decoded = b64decode(s.slice(OBF_PREFIX.length));
      if (decoded === null || decoded === '') return null;
      var out = '';
      for (var i = 0; i < decoded.length; i++) {
        out += String.fromCharCode(decoded.charCodeAt(i) ^ OBF_SALT.charCodeAt(i % OBF_SALT.length));
      }
      return out;
    } catch (e) { return null; }
  }

  function apiBase() {
    var R = global.__QBAO_RUNTIME__;
    if (R && R.apiBase) return String(R.apiBase).replace(/\/+$/, '');
    return '';
  }

  var _token = null;
  var _tokenResolved = false;

  // 统一会话读取：cb({ token, isDesktop })，桌面通道为异步 IPC
  function resolveSession(cb) {
    if (global.__qbaoDesktop && typeof global.__qbaoDesktop.secretLoad === 'function') {
      try {
        global.__qbaoDesktop.secretLoad('token').then(function (r) {
          _token = r && r.ok && r.value ? String(r.value) : null;
          _tokenResolved = true;
          cb({ token: _token, isDesktop: true });
        }).catch(function () {
          _token = null; _tokenResolved = true;
          cb({ token: null, isDesktop: true });
        });
        return;
      } catch (e) { /* 走网页回退 */ }
    }
    try {
      var raw = global.localStorage.getItem('qbao_token');
      _token = raw ? deobfuscate(raw) : null;
    } catch (e) { _token = null; }
    _tokenResolved = true;
    cb({ token: _token, isDesktop: false });
  }

  // —— 上报合并窗口 ——
  var pending = null;
  var timer = null;

  function send() {
    if (!pending) return;
    var payload = pending;
    pending = null;
    if (!_token) {
      console.info('[qbao-games] 未登录，本局成绩不保存');
      return;
    }
    var body = { gameId: GAME_ID };
    if (payload.best >= 0) body.score = payload.best;
    if (payload.level >= 0) body.level = payload.level;
    if (payload.plays > 0) body.plays = payload.plays;
    if (body.score === undefined && body.level === undefined && body.plays === undefined) return;
    var base = apiBase();
    if (!base) {
      console.info('[qbao-games] 无 API 基址，本局成绩不保存');
      return;
    }
    fetch(base + '/api/v1/games', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + _token },
      body: JSON.stringify(body),
      keepalive: true
    }).then(function (res) {
      if (res.status === 401) console.info('[qbao-games] 登录已过期，请回 Qbao 重新登录');
      else if (!res.ok) console.info('[qbao-games] 成绩上报被拒绝 (' + res.status + ')');
    }).catch(function () {
      console.info('[qbao-games] 网络异常，本局成绩未保存');
    });
  }

  // 游戏内注入「返回游戏空间」悬浮按钮（Electron 子窗口无导航栏，避免困在游戏页）
  function injectBackButton() {
    if (GAME_ID === 'portal' || !global.document) return;
    try {
      if (global.document.getElementById('qbao-games-back')) return;
      var a = global.document.createElement('a');
      a.id = 'qbao-games-back';
      a.href = '../index.html';
      a.textContent = '← 返回游戏空间';
      a.setAttribute('style',
        'position:fixed;left:12px;bottom:12px;z-index:2147483000;' +
        'background:rgba(20,30,50,.82);color:#fff;' +
        'font:600 13px/1 system-ui,sans-serif;text-decoration:none;' +
        'padding:8px 14px;border-radius:999px;' +
        'box-shadow:0 2px 10px rgba(0,0,0,.35);backdrop-filter:blur(4px);' +
        'opacity:.72;transition:opacity .2s;');
      a.onmouseover = function () { a.style.opacity = '1'; };
      a.onmouseout = function () { a.style.opacity = '.72'; };
      global.document.body.appendChild(a);
    } catch (e) { /* 注入失败不影响游戏 */ }
  }

  global.__qbaoGame = {
    report: function (data) {
      data = data || {};
      if (!pending) pending = { best: -1, level: -1, plays: 0 };
      if (typeof data.score === 'number' && data.score > pending.best) pending.best = data.score;
      if (typeof data.best === 'number' && data.best > pending.best) pending.best = data.best;
      if (typeof data.level === 'number' && data.level > pending.level) pending.level = data.level;
      pending.plays += 1;
      if (timer) clearTimeout(timer);
      timer = setTimeout(send, 3000);
      if (!_tokenResolved) resolveSession(function () {});
    }
  };

  // 大厅/页面通用会话读取（portal 也引入本文件）
  global.__qbaoHook = {
    getSession: resolveSession,
    apiBase: apiBase,
    gameId: GAME_ID
  };

  injectBackButton();
  resolveSession(function () { /* 预热（桌面异步握手尽早完成） */ });
})(window);
