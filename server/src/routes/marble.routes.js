'use strict';

// ============================================================
// marble.routes.js — 弹猪乐（弹珠游戏）云端存档 API（v3.40）
// 挂载点：/api/v1/games/marble/*（requireAuth；
// 大厅成绩上报（best/level/plays）仍走 games.routes 的 POST /api/v1/games）
// ============================================================

const { pool } = require('../db');
const { requireAuth } = require('../middleware');
const { asyncHandler } = require('../lib/errorHandler');
const { validate } = require('../lib/validate');
const {
  roundStartSchema,
  roundResultSchema,
  exchangeSchema,
  purchaseSchema,
} = require('../schemas/marble.schema');
const svc = require('../services/marbleService');

module.exports = function (app) {
  // GET /api/v1/games/marble/profile — 弹珠档案（余额/皮肤/每日余量/积分余额）
  app.get('/api/v1/games/marble/profile', requireAuth, asyncHandler(async (req, res) => {
    res.json(await svc.getProfile(pool, req.userId));
  }));

  // POST /api/v1/games/marble/round/start — 开局（扣押珠 + 服务端摇倍率/亮灯）
  app.post('/api/v1/games/marble/round/start', validate({ body: roundStartSchema }), requireAuth, asyncHandler(async (req, res) => {
    res.json(await svc.startRound(pool, req.userId, req.body.wager));
  }));

  // POST /api/v1/games/marble/round/result — 结算（上报落槽；服务端判定输赢）
  app.post('/api/v1/games/marble/round/result', validate({ body: roundResultSchema }), requireAuth, asyncHandler(async (req, res) => {
    res.json(await svc.settleRound(pool, req.userId, req.body.roundId, req.body.slot));
  }));

  // POST /api/v1/games/marble/exchange — 单向兑换：points2marbles（积分→弹珠 1:10）/ diamonds2points（钻石→积分 1:2）
  app.post('/api/v1/games/marble/exchange', validate({ body: exchangeSchema }), requireAuth, asyncHandler(async (req, res) => {
    res.json(await svc.exchange(pool, req.userId, req.body.action, req.body.amount));
  }));

  // POST /api/v1/games/marble/purchase — 商城购买/装备（皮肤/背景/拖尾/光环/钻石换弹珠）
  app.post('/api/v1/games/marble/purchase', validate({ body: purchaseSchema }), requireAuth, asyncHandler(async (req, res) => {
    res.json(await svc.purchase(pool, req.userId, req.body.cat, req.body.idx));
  }));

  // POST /api/v1/games/marble/free-claim — 每日免费领取弹珠
  app.post('/api/v1/games/marble/free-claim', requireAuth, asyncHandler(async (req, res) => {
    res.json(await svc.claimFree(pool, req.userId));
  }));
};