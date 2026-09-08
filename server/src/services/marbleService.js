'use strict';

// ============================================================
// marbleService.js — 弹猪乐（弹珠游戏）账号云端存档服务（v3.40）
// 弹珠/钻石余额与皮肤资产服务端权威（user_marble_profiles）；对局倍率/亮灯
// 槽位由服务端随机（user_marble_rounds），客户端只做物理表现与落槽上报。
// 积分双向兑换走 pointsService（reason: marble_in / marble_out，固定汇率），
// 弹珠→积分每日上限按台账 SUM 截断；赢取也有单日上限防脚本铸币。
// 合规边界（roulette 下架整改的延续）：随机输赢仅作用于弹珠/钻石余额，
// 积分只参与固定汇率兑换且全程台账留痕、随学期清零，不做押注。
// 所有函数接收 db（pool / 事务 client / 测试 fake），与 pointsService 同构。
// ============================================================

const { ApiError } = require('../lib/errorHandler');
const P = require('../config/points');
const pts = require('./pointsService');

// 服务端道具目录（与上游微信版一致；服务端只存价格与归属组，展示文案在前端）
const CATALOG = {
  skins: { currency: 'marbles', costs: [0, 1500, 1500, 3000, 3000, 3000, 5000] },
  bgs: { currency: 'marbles', costs: [0, 0, 0] },
  trails: { currency: 'diamonds', costs: [0, 100, 300, 600] },
  halos: { currency: 'diamonds', costs: [0, 50, 150, 300] },
};
const DIAMOND2MARBLE = { cost: 50, gain: 1000 };
const MULTIPLIER_POOL = [
  { multiplier: 2, litCount: 5 },
  { multiplier: 3, litCount: 4 },
  { multiplier: 5, litCount: 2 },
  { multiplier: 10, litCount: 1 },
];
const ROUND_TTL_MIN = 10;
const SLOT_COUNT = 10;

function defaultData() {
  return {
    owned: { skins: [0], bgs: [0], trails: [0], halos: [0] },
    equipped: { skin: 0, bg: 0, trail: 0, halo: 0 },
  };
}

// 服务端随机：倍率 + 该倍率下的亮灯槽位
function rollMultiplier() {
  const pick = MULTIPLIER_POOL[Math.floor(Math.random() * MULTIPLIER_POOL.length)];
  const arr = [];
  for (let i = 0; i < SLOT_COUNT; i += 1) arr.push(i);
  for (let i = 0; i < pick.litCount; i += 1) {
    const j = i + Math.floor(Math.random() * (arr.length - i));
    const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
  }
  return { multiplier: pick.multiplier, lit: arr.slice(0, pick.litCount).sort((a, b) => a - b) };
}

// 档案不存在则建（含初始赠送），并做每日滚点（免费领取/赢取上限按服务器本地日）
async function ensureProfile(db, userId) {
  await db.query(
    'INSERT INTO user_marble_profiles (user_id, marbles, data) VALUES ($1, $2, $3::jsonb) ON CONFLICT (user_id) DO NOTHING',
    [userId, P.MARBLE_START_MARBLES, JSON.stringify(defaultData())]
  );
  await db.query(
    'UPDATE user_marble_profiles SET free_date = CURRENT_DATE, free_claims = 0 WHERE user_id = $1 AND free_date IS DISTINCT FROM CURRENT_DATE',
    [userId]
  );
}

// GET 档案（游戏启动拉取，含积分余额与兑换余量供 HUD/商城展示）
async function getProfile(db, userId) {
  await ensureProfile(db, userId);
  const r = await db.query(
    'SELECT marbles, diamonds, data, free_claims FROM user_marble_profiles WHERE user_id = $1',
    [userId]
  );
  const row = r.rows[0] || {};
  const data = Object.assign(defaultData(), row.data || {});
  data.owned = Object.assign({ skins: [0], bgs: [0], trails: [0], halos: [0] }, data.owned || {});
  data.equipped = Object.assign({ skin: 0, bg: 0, trail: 0, halo: 0 }, data.equipped || {});
  const usedOut = await pts.sumSince(db, userId, 'marble_diamond_out', pts.localStartOfDay());
  const pointsBalance = await pts.getBalance(db, userId);
  return {
    marbles: parseInt(row.marbles != null ? row.marbles : P.MARBLE_START_MARBLES),
    diamonds: parseInt(row.diamonds || 0),
    owned: data.owned,
    equipped: data.equipped,
    freeLeft: Math.max(0, P.MARBLE_FREE_CLAIMS_DAILY - (parseInt(row.free_claims) || 0)),
    freeAmount: P.MARBLE_FREE_AMOUNT,
    exchangeRate: P.MARBLE_EXCHANGE_RATE,
    diamondToPoints: P.MARBLE_DIAMOND_TO_POINTS,
    diamondOutCap: P.MARBLE_DIAMOND_OUT_DAILY_POINTS,
    diamondOutUsed: usedOut,
    diamondOutLeft: Math.max(0, P.MARBLE_DIAMOND_OUT_DAILY_POINTS - usedOut),
    pointsBalance,
  };
}

// 开局：扣押珠 + 服务端摇倍率/亮灯槽；幂等（同 wager 的重放返回原对局）
async function startRound(db, userId, wager) {
  await ensureProfile(db, userId);
  // 过期未结算对局自动退回押珠（防网络中断吞珠）
  const expired = await db.query(
    'DELETE FROM user_marble_rounds WHERE user_id = $1 AND settled_at IS NULL AND created_at < NOW() - $2::interval RETURNING wager',
    [userId, ROUND_TTL_MIN + ' minutes']
  );
  const refund = (expired.rows || []).reduce((s, x) => s + (parseInt(x.wager) || 0), 0);
  if (refund > 0) {
    await db.query('UPDATE user_marble_profiles SET marbles = marbles + $2 WHERE user_id = $1', [userId, refund]);
  }
  const open = await db.query(
    'SELECT id, wager, multiplier, lit FROM user_marble_rounds WHERE user_id = $1 AND settled_at IS NULL AND created_at >= NOW() - $2::interval ORDER BY created_at DESC LIMIT 1',
    [userId, ROUND_TTL_MIN + ' minutes']
  );
  if (open.rows.length > 0) {
    const o = open.rows[0];
    if (parseInt(o.wager) !== wager) throw new ApiError(409, '请先完成当前对局');
    const b = await db.query('SELECT marbles FROM user_marble_profiles WHERE user_id = $1', [userId]);
    return {
      roundId: o.id, multiplier: parseInt(o.multiplier), lit: o.lit,
      marbles: parseInt((b.rows[0] || {}).marbles || 0),
      replayed: true,
    };
  }
  const dec = await db.query(
    'UPDATE user_marble_profiles SET marbles = marbles - $2, updated_at = NOW() WHERE user_id = $1 AND marbles >= $2 RETURNING marbles',
    [userId, wager]
  );
  if (dec.rows.length === 0) throw new ApiError(400, '弹珠不足');
  const roll = rollMultiplier();
  const ins = await db.query(
    'INSERT INTO user_marble_rounds (user_id, wager, multiplier, lit) VALUES ($1, $2, $3, $4::int[]) RETURNING id',
    [userId, wager, roll.multiplier, roll.lit]
  );
  return {
    roundId: ins.rows[0].id,
    multiplier: roll.multiplier,
    lit: roll.lit,
    marbles: parseInt(dec.rows[0].marbles),
  };
}

// 结算：客户端上报落槽 → 服务端按亮灯判定；单开一局保证不会并发双重结算
async function settleRound(db, userId, roundId, slot) {
  const del = await db.query(
    'DELETE FROM user_marble_rounds WHERE id = $1 AND user_id = $2 AND settled_at IS NULL RETURNING wager, multiplier, lit',
    [roundId, userId]
  );
  if (del.rows.length === 0) throw new ApiError(400, '对局不存在或已结束');
  const wager = parseInt(del.rows[0].wager);
  const multiplier = parseInt(del.rows[0].multiplier);
  const lit = del.rows[0].lit || [];
  const gross = wager * multiplier;
  const won = lit.indexOf(slot) >= 0;
  let reward = 0;
  let diamonds = 0;
  if (won) {
    // 获取不设上限：命中即按 毛收益 = wager×multiplier 全额入账，钻石 = 每 50 毛收益折算 1 颗
    reward = gross;
    diamonds = Math.floor(gross / 50);
    await db.query(
      'UPDATE user_marble_profiles SET marbles = marbles + $2, diamonds = diamonds + $3, updated_at = NOW() WHERE user_id = $1',
      [userId, reward, diamonds]
    );
  }

  const b = await db.query('SELECT marbles, diamonds FROM user_marble_profiles WHERE user_id = $1', [userId]);
  return {
    won,
    reward,
    diamonds,
    marbles: parseInt((b.rows[0] || {}).marbles || 0),
    diamondBalance: parseInt((b.rows[0] || {}).diamonds || 0),
  };
}

// 每日免费领取（弹珠耗尽时的救济，防止无珠可玩）
async function claimFree(db, userId) {
  await ensureProfile(db, userId);
  const up = await db.query(
    'UPDATE user_marble_profiles SET marbles = marbles + $2, free_claims = free_claims + 1, updated_at = NOW() WHERE user_id = $1 AND free_claims < $3 RETURNING marbles, free_claims',
    [userId, P.MARBLE_FREE_AMOUNT, P.MARBLE_FREE_CLAIMS_DAILY]
  );
  if (up.rows.length === 0) throw new ApiError(400, '今日免费弹珠已领完');
  const row = up.rows[0];
  return {
    marbles: parseInt(row.marbles),
    freeLeft: Math.max(0, P.MARBLE_FREE_CLAIMS_DAILY - parseInt(row.free_claims)),
  };
}

// 商城：购买/装备 皮肤/背景/拖尾/光环 + 钻石换弹珠
async function purchase(db, userId, cat, idx) {
  await ensureProfile(db, userId);
  if (cat === 'diamond2marble') {
    const up = await db.query(
      'UPDATE user_marble_profiles SET diamonds = diamonds - $2, marbles = marbles + $3, updated_at = NOW() WHERE user_id = $1 AND diamonds >= $2 RETURNING marbles, diamonds',
      [userId, DIAMOND2MARBLE.cost, DIAMOND2MARBLE.gain]
    );
    if (up.rows.length === 0) throw new ApiError(400, '钻石不足');
    const r = up.rows[0];
    return { marbles: parseInt(r.marbles), diamonds: parseInt(r.diamonds) };
  }
  const item = CATALOG[cat];
  if (!item) throw new ApiError(400, '未知道具分类');
  const i = Number(idx);
  if (!Number.isInteger(i) || i < 0 || i >= item.costs.length) throw new ApiError(400, '未知道具');
  const cost = item.costs[i];
  const currency = item.currency;
  const sel = await db.query('SELECT marbles, diamonds, data FROM user_marble_profiles WHERE user_id = $1', [userId]);
  const row = sel.rows[0] || {};
  const data = Object.assign(defaultData(), row.data || {});
  const ownedList = Array.isArray(data.owned[cat]) ? data.owned[cat].slice() : [];
  const isOwned = ownedList.indexOf(i) >= 0;
  let balance = parseInt(row[currency] || 0);
  if (!isOwned && cost > 0) {
    const spend = await db.query(
      'UPDATE user_marble_profiles SET ' + currency + ' = ' + currency + ' - $2, updated_at = NOW() WHERE user_id = $1 AND ' + currency + ' >= $2 RETURNING ' + currency,
      [userId, cost]
    );
    if (spend.rows.length === 0) throw new ApiError(400, currency === 'marbles' ? '弹珠不足' : '钻石不足');
    balance = parseInt(spend.rows[0][currency]);
    ownedList.push(i);
  } else if (!isOwned) {
    ownedList.push(i); // 免费道具直接入库
  }
  data.owned[cat] = ownedList;
  data.equipped[cat] = i;
  await db.query('UPDATE user_marble_profiles SET data = $2::jsonb, updated_at = NOW() WHERE user_id = $1', [userId, JSON.stringify(data)]);
  const resp = { marbles: null, diamonds: null };
  resp[currency] = balance;
  return Object.assign({ owned: data.owned, equipped: data.equipped }, resp);
}

// 单向兑换（经济模型 2026-09 定版）：积分 → 弹珠（1:10）与钻石 → 积分（1 钻 = 2 分）。
// 弹珠不可兑积分；积分不可购钻石；钻石只能来自对局命中（服务端结算发钻，单日 40 颗上限）。
async function exchange(db, userId, action, amount) {
  if (!Number.isInteger(amount) || amount < 1) throw new ApiError(400, 'amount 非法');
  if (action === 'points2marbles') {
    const rate = P.MARBLE_EXCHANGE_RATE;
    if (amount % rate !== 0 || amount < rate) throw new ApiError(400, '兑换数量须为 ' + rate + ' 弹珠的整数倍');
    await ensureProfile(db, userId);
    const ptsCost = amount / rate;
    const spent = await pts.spendPoints(db, userId, ptsCost, {
      reason: 'marble_in', note: '弹珠游戏：积分兑换弹珠（1 积分 = ' + rate + ' 弹珠）',
    });
    const up = await db.query(
      'UPDATE user_marble_profiles SET marbles = marbles + $2, updated_at = NOW() WHERE user_id = $1 RETURNING marbles',
      [userId, amount]
    );
    return { pointsBalance: spent.balance, marbles: parseInt(up.rows[0].marbles) };
  }
  if (action === 'diamonds2points') {
    // 钻石 → 积分：每日最多 MARBLE_DIAMOND_OUT_DAILY_POINTS 分（按当日台账 SUM 截断）
    const usedOut = await pts.sumSince(db, userId, 'marble_diamond_out', pts.localStartOfDay());
    const outLeft = Math.max(0, P.MARBLE_DIAMOND_OUT_DAILY_POINTS - usedOut);
    const ptsEarn = amount * P.MARBLE_DIAMOND_TO_POINTS;
    if (ptsEarn > outLeft) throw new ApiError(400, '今日钻石兑换积分已达上限（还可兑 ' + outLeft + ' 积分）');
    await ensureProfile(db, userId);
    const dec = await db.query(
      'UPDATE user_marble_profiles SET diamonds = diamonds - $2, updated_at = NOW() WHERE user_id = $1 AND diamonds >= $2 RETURNING diamonds',
      [userId, amount]
    );
    if (dec.rows.length === 0) throw new ApiError(400, '钻石不足');
    const aw = await pts.awardPoints(db, userId, ptsEarn, {
      reason: 'marble_diamond_out', note: '弹珠游戏：钻石兑换积分（1 钻石 = ' + P.MARBLE_DIAMOND_TO_POINTS + ' 积分）',
    });
    return { pointsBalance: aw.balance, awarded: aw.awarded, diamonds: parseInt(dec.rows[0].diamonds), diamondOutLeft: Math.max(0, outLeft - ptsEarn) };
  }
  throw new ApiError(400, '未支持的动作');
}

module.exports = { getProfile, startRound, settleRound, claimFree, purchase, exchange };