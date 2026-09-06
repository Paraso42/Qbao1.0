'use strict';

// ============================================================
// roulette.routes.js — 俄罗斯轮盘（赌场转盘）押注 API（v3.38）
// 积分试点第一站：唯一接入点 POST /api/v1/roulette/spin（一轮制）：
//   下注 → 服务端 crypto 随机开奖 → 按倍率结算。
// 账本：下注扣 Total via points_ledger reason='roulette_bet'；
//       派彩 award reason='roulette_win'（refType='roulette', refId=roundId，
//       points_ledger UNIQUE 幂等兜底）；本局结果存 roulette_bets。
// 防刷：金额硬顶（schema）+ 每日押注总额护栏 + 既有 120/min/IP 限流
//       + roundId 幂等重放（超时重试不双扣）。
// ============================================================

const crypto = require('crypto');
const { pool } = require('../db');
const { requireAuth } = require('../middleware');
const { asyncHandler, ApiError } = require('../lib/errorHandler');
const { validate } = require('../lib/validate');
const { spinSchema } = require('../schemas/roulette.schema');
const R = require('../config/roulette');
const pts = require('../services/pointsService');

// 服务器本地时区当日 00:00（日历日口径与积分系统一致）
function localStartOfDay(now) {
  const d = now || new Date();
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

// 单注位结算 → { hit, mult, payout }
function settleSpot(spot, number) {
  let hit = false;
  let mult = 0;
  switch (spot.type) {
    case 'color':
      hit = R.colorWins(spot.value, number);
      mult = R.WIN_MULT.color;
      break;
    case 'parity':
      hit = R.parityWins(spot.value, number);
      mult = R.WIN_MULT.parity;
      break;
    case 'combo':
      hit = R.comboWins(spot.value.split('+'), number);
      mult = R.WIN_MULT.combo;
      break;
    case 'green':
      hit = number === 0;
      mult = R.WIN_MULT.green;
      break;
  }
  return { hit, mult, payout: hit ? Math.floor(spot.amount * mult) : 0 };
}

module.exports = function (app) {
  app.post('/api/v1/roulette/spin', validate({ body: spinSchema }), requireAuth, asyncHandler(async (req, res) => {
    const { roundId, bets } = req.body;
    const userId = req.userId;
    const totalStake = bets.reduce((s, b) => s + b.amount, 0);

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // —— 幂等重放：同 roundId 已结算 → 返回原结果，不重复扣分 ——
      const ins = await client.query(
        'INSERT INTO roulette_bets (id, user_id, total_stake, number, color, bets, payout) VALUES ($1, $2, $3, 0, $4, $5, 0) ON CONFLICT (id) DO NOTHING',
        [roundId, userId, totalStake, 'pending', JSON.stringify(bets)]
      );
      if (ins.rowCount === 0) {
        const old = await client.query('SELECT id, user_id, total_stake, number, color, bets, payout FROM roulette_bets WHERE id = $1', [roundId]);
        await client.query('ROLLBACK');
        if (old.rows.length === 0) throw new ApiError(409, 'roundId 冲突，请重试');
        if (String(old.rows[0].user_id) !== String(userId)) throw new ApiError(409, 'roundId 不属于当前账号');
        const row = old.rows[0];
        return res.json({
          roundId,
          number: row.number,
          color: row.color,
          bets: row.bets,
          totalStake: row.total_stake,
          payout: row.payout,
          balance: await pts.getBalance(pool, userId),
          replayed: true,
        });
      }

      // —— 每日押注总额护栏 ——
      if (R.DAILY_STAKE_CAP > 0) {
        const dayStart = localStartOfDay();
        const sum = await client.query(
          "SELECT COALESCE(SUM(-delta), 0)::int AS total FROM points_ledger WHERE user_id = $1 AND reason = 'roulette_bet' AND created_at >= $2",
          [userId, dayStart]
        );
        const used = parseInt((sum.rows[0] && sum.rows[0].total) || 0);
        if (used + totalStake > R.DAILY_STAKE_CAP) {
          throw new ApiError(400, '今日轮盘押注已达上限（每日 ' + R.DAILY_STAKE_CAP + ' 分）');
        }
      }

      // —— 扣注（原子条件更新：余额不足 → 400，无负余额可能）——
      await pts.spendPoints(client, userId, totalStake, {
        reason: 'roulette_bet',
        note: '俄罗斯轮盘押注 ' + totalStake + ' 分',
      });

      // —— 开奖（crypto 权威随机，结算响应统一揭示）——
      const number = crypto.randomInt(0, 37);
      const color = R.NUMBER_COLORS[number];

      // —— 逐注位结算 ——
      const settled = bets.map((b) => Object.assign({}, b, settleSpot(b, number)));
      const payout = settled.reduce((s, b) => s + b.payout, 0);
      if (payout > 0) {
        await pts.awardPoints(client, userId, payout, {
          reason: 'roulette_win',
          refType: 'roulette',
          refId: roundId,
          note: '轮盘赢彩 ' + payout + ' 分',
        });
      }

      await client.query(
        'UPDATE roulette_bets SET number = $2, color = $3, bets = $4::jsonb, payout = $5 WHERE id = $1',
        [roundId, number, color, JSON.stringify(settled), payout]
      );
      await client.query('COMMIT');

      res.json({
        roundId,
        number,
        color,
        bets: settled,
        totalStake,
        payout,
        balance: await pts.getBalance(pool, userId),
      });
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      throw e;
    } finally {
      client.release();
    }
  }));
};
