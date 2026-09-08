'use strict';
// 弹猪乐 Web 移植补丁 v2：窗口/括号匹配，不依赖含换行的精确字面量。
const fs = require('fs');
const path = 'D:/Qbao/app/public/games/marble/game.js';
let raw = fs.readFileSync(path, 'utf8');
const CR = raw.includes('\r\n');
const nl = CR ? '\r\n' : '\n';
const NL = nl;

function fail(msg) { console.error('FAIL [' + msg + ']'); process.exit(1); }

function win(startMark, endMark, newText, label) {
  const s = raw.indexOf(startMark);
  if (s < 0) fail('win-start:' + label);
  const e = raw.indexOf(endMark, s + startMark.length);
  if (e < 0) fail('win-end:' + label);
  raw = raw.slice(0, s) + newText + raw.slice(e);
  console.log('ok [win:' + label + ']');
}

function rep(oldS, newS, label) {
  let i = raw.indexOf(oldS);
  if (i < 0) fail('rep:' + label);
  if (raw.indexOf(oldS, i + 1) >= 0) fail('rep-ambig:' + label);
  raw = raw.slice(0, i) + newS + raw.slice(i + oldS.length);
  console.log('ok [rep:' + label + ']');
}

function braceBlock(startMark, label) {
  const s = raw.indexOf(startMark);
  if (s < 0) fail('brace-start:' + label);
  let depth = 0;
  let i = s;
  for (; i < raw.length; i += 1) {
    const c = raw[i];
    if (c === '{') depth += 1;
    else if (c === '}') { depth -= 1; if (depth === 0) { i += 1; break; } }
  }
  if (depth !== 0) fail('brace-unbalanced:' + label);
  return { start: s, end: i };
}

rep(
  "const Matter = require('./matter.js');",
  "const Matter = (typeof window !== 'undefined' && window.Matter) || (typeof globalThis !== 'undefined' && globalThis.Matter);",
  'matter-import'
);

rep(
  "const canvas = wx.createCanvas();",
  "const CLOUD = (typeof window !== 'undefined' && window.__qbMarbleCloud) || null;" + NL +
  "function cloudOn() { return !!CLOUD && CLOUD.ready && CLOUD.mode === 'cloud'; }" + NL +
  "const canvas = wx.createCanvas();",
  'cloud-bridge'
);

rep(
  "const saved = wx.getStorageSync('galtonGame') || {};",
  "let saved = wx.getStorageSync('galtonGame') || {};",
  'saved-let'
);

rep(
  "function save() { wx.setStorageSync('galtonGame', { marbles: state.marbles, diamonds: state.diamonds, freeClaims: state.freeClaims, freeDate: today, skin: state.skin, bg: state.bg, trail: state.trail, halo: state.halo, owned: state.owned }); }",
  "function save() { wx.setStorageSync('galtonGame', { marbles: state.marbles, diamonds: state.diamonds, freeClaims: state.freeClaims, freeDate: today, skin: state.skin, bg: state.bg, trail: state.trail, halo: state.halo, owned: state.owned }); }" + NL +
  "function cloudApplySeed(seed) {" + NL +
  "  if (!seed) return;" + NL +
  "  saved = seed;" + NL +
  "  state.marbles = Number.isFinite(seed.marbles) ? seed.marbles : state.marbles;" + NL +
  "  state.diamonds = Number.isFinite(seed.diamonds) ? seed.diamonds : state.diamonds;" + NL +
  "  if (seed.skin != null) state.skin = seed.skin;" + NL +
  "  if (seed.bg != null) state.bg = seed.bg;" + NL +
  "  if (seed.trail != null) state.trail = seed.trail;" + NL +
  "  if (seed.halo != null) state.halo = seed.halo;" + NL +
  "  if (seed.owned && seed.owned.skins) state.owned = seed.owned;" + NL +
  "  save();" + NL +
  "}",
  'cloud-apply-seed'
);

win(
  'function randomize() ', 'function showFree() ',
  [
  'function randomize() {',
  '  state.multiplierReady = false; state.randomizing = true;',
  '  const timer = setInterval(() => { state.multiplier = [2, 3, 5, 10][Math.floor(Math.random() * 4)]; draw(); }, 70);',
  '  const finish = (multiplier, lit) => { clearInterval(timer); state.randomizing = false; state.multiplier = multiplier; state.lit = new Set(lit); state.multiplierReady = true; state.phase = \'charge\'; draw(); };',
  '  if (!cloudOn()) {',
  '    setTimeout(() => { const i = Math.floor(Math.random() * 4); const count = [5, 4, 2, 1][i]; const picks = []; while (picks.length < count) { const slot = Math.floor(Math.random() * slotCount); if (picks.indexOf(slot) < 0) picks.push(slot); } finish([2, 3, 5, 10][i], picks); }, 14 * 70);',
  '  } else {',
  '    CLOUD.startRound(state.wager).then((r) => { state.marbles = r.marbles; save(); finish(r.multiplier, r.lit); }).catch((err) => { clearInterval(timer); state.randomizing = false; state.phase = \'confirm\'; draw(); CLOUD.toast((err && err.message) || \'开局失败，请重试\'); CLOUD.refresh().then(() => draw()).catch(() => {}); });',
  '  }',
  '}',
  ].join(NL),
  'randomize'
);

rep(
  "const wager = Math.min(state.wager, state.marbles); state.marbles -= wager; save();",
  "const wager = Math.min(state.wager, state.marbles); if (!cloudOn()) { state.marbles -= wager; save(); }",
  'wager-deduct'
);

(function () {
  const blk = braceBlock('if (b.settleFrames >= 55) {', 'settle');
  const newBlk = [
  'if (b.settleFrames >= 55) {',
  '  if (!cloudOn()) {',
  '    const win = state.lit.has(b.slot);',
  '    const reward = win ? b.wager * state.multiplier : 0;',
  '    state.marbles += reward; state.diamonds += Math.floor(reward / 50);',
  '    World.remove(engine.world, b.body); state.ball = null; state.running = false; state.phase = \'confirm\'; state.multiplierReady = false; state.multiplier = 0; state.wager = 0; state.lit = new Set();',
  '    save();',
  '    if (CLOUD && CLOUD.reportReward) CLOUD.reportReward(reward);',
  '    wx.showModal({ title: win ? \'恭喜你\' : \'很遗憾\', content: win ? (\'获得 \' + reward + \' 颗弹珠\\n钻石 +\' + Math.floor(reward / 50) + \' 颗\') : \'再试一次吧\', showCancel: false });',
  '  } else {',
  '    const slot = b.slot;',
  '    World.remove(engine.world, b.body); state.ball = null; state.running = false; state.phase = \'confirm\'; state.multiplierReady = false; state.multiplier = 0; state.wager = 0; state.lit = new Set();',
  '    save();',
  '    CLOUD.settleRound(slot).then(function (r) {',
  '      state.marbles = r.marbles; state.diamonds = r.diamondBalance; save();',
  '      if (CLOUD.reportReward) CLOUD.reportReward(r.won ? r.reward : 0);',
  '      wx.showModal({ title: r.won ? \'恭喜你\' : \'很遗憾\', content: r.won ? (\'获得 \' + r.reward + \' 颗弹珠\\n钻石 +\' + r.diamonds + \' 颗\' + (r.capped ? \'\\n（今日赢取已达上限）\' : \'\')) : \'再试一次吧\', showCancel: false });',
  '    }).catch(function (err) {',
  '      CLOUD.toast((err && err.message) || \'结算失败，请重试\');',
  '      CLOUD.refresh().then(function () { draw(); }).catch(function () {});',
  '    });',
  '  }',
  '}',
  ].join(NL);
  raw = raw.slice(0, blk.start) + newBlk + raw.slice(blk.end);
  console.log('ok [block:settle]');
})();

win(
  'function showFree() ', 'function launch() ',
  [
  'function showFree() {',
  '  if (state.marbles !== 0 || state.modal) return;',
  '  if (cloudOn()) {',
  '    if (CLOUD.meta.freeLeft <= 0) { state.modal = true; wx.showModal({ title: \'弹珠不足\', content: \'今日免费弹珠已领完，可在商城用 Qbao 积分兑换，或明天再来\', confirmText: \'知道了\', showCancel: false, complete: () => { state.modal = false; } }); return; }',
  '    state.modal = true; CLOUD.freeClaim().then((r) => { state.modal = false; state.marbles = r.marbles; CLOUD.meta.freeLeft = r.freeLeft; save(); draw(); CLOUD.toast(\'领取 \' + CLOUD.meta.freeAmount + \' 颗弹珠\'); }).catch((err) => { state.modal = false; CLOUD.toast((err && err.message) || \'领取失败\'); }); return;',
  '  }',
  '  if (state.freeClaims >= 2 || state.modal) return;',
  '  state.modal = true; wx.showModal({ title: \'弹珠不足\', content: \'今日还剩 \' + (2 - state.freeClaims) + \' 次免费领取\\n每次补充 50 颗弹珠\', confirmText: \'领取50颗\', cancelText: \'关闭\', complete: (r) => { state.modal = false; if (r.confirm) { state.marbles += 50; state.freeClaims += 1; save(); draw(); } } });',
  '}',
  ].join(NL),
  'showFree'
);

win(
  'function handleShopTap(it) ', 'function randomize() ',
  [
  'function handleShopTap(it) {',
  '  if (it.action === \'exchangeIn\' || it.action === \'exchangeOut\') {',
  '    if (!cloudOn()) { wx.showToast({ title: \'游客模式不可兑换积分\', icon: \'none\' }); draw(); return; }',
  '    const dir = it.action === \'exchangeIn\' ? \'in\' : \'out\';',
  '    const amount = CLOUD.meta.exchangeRate * 10;',
  '    CLOUD.exchange(dir, amount).then((r) => { state.marbles = r.marbles; if (dir === \'out\') CLOUD.meta.dailyOutLeft = Math.max(0, CLOUD.meta.dailyOutLeft - 10); save(); draw(); CLOUD.toast(dir === \'in\' ? \'兑换成功：积分 → 弹珠\' : \'兑换成功：弹珠 → 积分\'); }).catch((err) => { CLOUD.toast((err && err.message) || \'兑换失败\'); draw(); });',
  '    return;',
  '  }',
  '  const doLocal = (cat, arr, key, cur) => { const i = it.arg; if (state[key] === i) return; if (state.owned[arr].indexOf(i) >= 0) { state[key] = i; } else { const c = cat[i].cost; if (state[cur] >= c) { state[cur] -= c; state.owned[arr].push(i); state[key] = i; } else { wx.showToast({ title: cur === \'marbles\' ? \'弹珠不足\' : \'钻石不足\', icon: \'none\' }); draw(); return; } } };',
  '  const doCloud = (catKey) => { CLOUD.purchase(catKey, it.arg).then((r) => { state.owned[catKey] = (r.owned && r.owned[catKey]) || state.owned[catKey]; if (r.equipped && r.equipped[catKey] != null) { if (catKey === \'skins\') state.skin = r.equipped[catKey]; else if (catKey === \'halos\') state.halo = r.equipped[catKey]; else state.trail = r.equipped[catKey]; } if (r.marbles != null) state.marbles = r.marbles; if (r.diamonds != null) state.diamonds = r.diamonds; save(); draw(); }).catch((err) => { CLOUD.toast((err && err.message) || \'购买失败\'); draw(); }); };',
  '  if (it.action === \'skin\') { if (cloudOn()) { doCloud(\'skins\'); return; } doLocal(skins, \'skins\', \'skin\', \'marbles\'); }',
  '  else if (it.action === \'halo\') { if (cloudOn()) { doCloud(\'halos\'); return; } doLocal(halos, \'halos\', \'halo\', \'diamonds\'); }',
  '  else if (it.action === \'trail\') { if (cloudOn()) { doCloud(\'trails\'); return; } doLocal(trails, \'trails\', \'trail\', \'diamonds\'); }',
  '  else if (it.action === \'exchange\') {',
  '    if (cloudOn()) { CLOUD.purchase(\'diamond2marble\', 0).then((r) => { state.diamonds = r.diamonds; state.marbles = r.marbles; save(); draw(); }).catch((err) => { CLOUD.toast((err && err.message) || \'兑换失败\'); draw(); }); return; }',
  '    if (state.diamonds >= 50) { state.diamonds -= 50; state.marbles += 1000; } else { wx.showToast({ title: \'钻石不足\', icon: \'none\' }); draw(); return; }',
  '  }',
  '  save(); draw();',
  '}',
  ].join(NL),
  'shopTap'
);

(function () {
  const s = raw.indexOf('钻石 \${state.diamonds}');
  if (s < 0) fail('balance-line');
  const e = raw.indexOf(';', s);
  if (e < 0) fail('balance-line-end');
  const newLine = 'ctx.fillText(\'钻石 \' + state.diamonds + \'    弹珠 \' + state.marbles + (cloudOn() ? \'    积分 \' + CLOUD.meta.pointsBalance : \'（游客模式）\'), px, topY + 54);';
  raw = raw.slice(0, s) + newLine + raw.slice(e + 1);
  console.log('ok [line:balance]');
})();

rep(
  "  section('钻石兑换弹珠');",
  "  if (cloudOn()) {" + NL +
  "    section('Qbao 积分 ⇄ 弹珠（1 积分 = ' + CLOUD.meta.exchangeRate + ' 弹珠）');" + NL +
  "    item('10 积分 → 100 弹珠', '点击兑换', false, 'exchangeIn', 0);" + NL +
  "    item('100 弹珠 → 10 积分', '今日可兑 ' + CLOUD.meta.dailyOutLeft + '/' + CLOUD.meta.dailyOutCap + ' 分', false, 'exchangeOut', 0);" + NL +
  "  }" + NL +
  "  section('钻石兑换弹珠');",
  'shop-section'
);

rep(
  "frame(loop); draw(); if (state.marbles === 0) setTimeout(showFree, 300);",
  "if (CLOUD && !CLOUD.ready) {" + NL +
  "  CLOUD.onReady(function (seed) { if (seed) cloudApplySeed(seed); frame(loop); draw(); if (state.marbles === 0) setTimeout(showFree, 300); });" + NL +
  "} else {" + NL +
  "  frame(loop); draw(); if (state.marbles === 0) setTimeout(showFree, 300);" + NL +
  "}",
  'boot'
);

fs.writeFileSync(path, raw);
console.log('PATCH DONE bytes=' + raw.length);
