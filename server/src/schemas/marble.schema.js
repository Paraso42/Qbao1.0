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
// POST /games/marble/exchange — 积分 ⇄ 弹珠（固定汇率，双向同价）
const exchangeSchema = z.object({
  dir: z.enum(['in', 'out'], { errorMap: () => ({ message: 'dir 仅支持 in/out' }) }),
  marbles: z.number().int('marbles 必须为整数')
    .min(P.MARBLE_EXCHANGE_RATE, '兑换数量不足')
    .max(1000000, '单次兑换过大')
    .refine((v) => v % P.MARBLE_EXCHANGE_RATE === 0, { message: '兑换数量需为 ' + P.MARBLE_EXCHANGE_RATE + ' 的整数倍' }),
});
// POST /games/marble/purchase — 皮肤/拖尾/光环/钻石兑换
const purchaseSchema = z.object({
  cat: z.enum(['skins', 'bgs', 'trails', 'halos', 'diamond2marble'], { errorMap: () => ({ message: '未知分类' }) }),
  idx: z.number().int('idx 必须为整数').min(0, 'idx 不能为负').max(99, 'idx 越界'),
});

module.exports = { roundStartSchema, roundResultSchema, exchangeSchema, purchaseSchema };
