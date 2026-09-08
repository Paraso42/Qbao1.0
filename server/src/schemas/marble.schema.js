'use strict';

const { z } = require('zod');
const P = require('../config/points');

// 弹猪乐（marble）请求校验
// POST /games/marble/round/start
const roundStartSchema = z.object({
  wager: z.number().int('wager 必须为整数').min(1, 'wager 至少 1').max(100, 'wager 最大 100'),
});
// POST /games/marble/round/result
const roundResultSchema = z.object({
  roundId: z.string().trim().min(8, '缺少 roundId').max(40, 'roundId 非法'),
  slot: z.number().int('slot 必须为整数').min(0, 'slot 不能为负').max(9, 'slot 越界'),
});
// POST /games/marble/exchange — 单向兑换（经济模型 2026-09 定版）：
//   points2marbles：积分 → 弹珠（1 积分 = MARBLE_EXCHANGE_RATE 弹珠）
//   diamonds2points：钻石 → 积分（1 钻石 = MARBLE_DIAMOND_TO_POINTS 积分；钻石仅来自对局命中）
const exchangeSchema = z.object({
  action: z.enum(['points2marbles', 'diamonds2points'], { errorMap: () => ({ message: 'action 仅支持 points2marbles / diamonds2points' }) }),
  amount: z.number().int('amount 必须为整数').min(1, 'amount 至少 1').max(1000000, 'amount 过大'),
}).refine((v) => {
  if (v.action === 'points2marbles') return v.amount % P.MARBLE_EXCHANGE_RATE === 0 && v.amount >= P.MARBLE_EXCHANGE_RATE;
  return true;
}, { message: '积分兑换弹珠数量需为 ' + P.MARBLE_EXCHANGE_RATE + ' 的整数倍' });
// POST /games/marble/purchase — 皮肤/拖尾/光环/钻石兑换
const purchaseSchema = z.object({
  cat: z.enum(['skins', 'bgs', 'trails', 'halos', 'diamond2marble'], { errorMap: () => ({ message: '未知分类' }) }),
  idx: z.number().int('idx 必须为整数').min(0, 'idx 不能为负').max(99, 'idx 越界'),
});

module.exports = { roundStartSchema, roundResultSchema, exchangeSchema, purchaseSchema };