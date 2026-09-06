'use strict';

const { z } = require('zod');
const R = require('../config/roulette');

// 组合注 value 形态：'red+even' / 'black+odd'（由 config 派生，配置即 schema）
const COMBO_VALUES = R.COMBO_PAIRS.map((pair) => pair.join('+'));

const spotSchema = z.object({
  type: z.enum(['color', 'parity', 'combo', 'green'], { errorMap: () => ({ message: '未知的注位类型' }) }),
  value: z.string().trim().min(1, '缺少注位值').max(16, '注位值过长'),
  amount: z
    .number().int('金额必须为整数')
    .min(R.MIN_BET, '单注至少 ' + R.MIN_BET + ' 分')
    .max(R.MAX_BET, '单注最多 ' + R.MAX_BET + ' 分'),
});

const COLOR_VALUES = ['red', 'black'];
const PARITY_VALUES = ['odd', 'even'];

// 注位类型与值合法性（统一 refine，友好报错）
function spotError(spot) {
  if (spot.type === 'color') {
    if (COLOR_VALUES.indexOf(spot.value) < 0) return '颜色注位值应为 red 或 black';
  } else if (spot.type === 'parity') {
    if (PARITY_VALUES.indexOf(spot.value) < 0) return '奇偶注位值应为 odd 或 even';
  } else if (spot.type === 'combo') {
    if (COMBO_VALUES.indexOf(spot.value) < 0) return '组合注位值应在配置白名单内（' + COMBO_VALUES.join(' / ') + '）';
  } else if (spot.type === 'green') {
    if (spot.value !== 'green') return '绿色注位值应为 green';
  }
  return null;
}

const spinSchema = z
  .object({
    roundId: z.string().uuid('roundId 必须为 UUID'),
    bets: z.array(spotSchema).min(1, '至少一个注位').max(R.MAX_SPOTS, '一局最多 ' + R.MAX_SPOTS + ' 个注位'),
  })
  .refine((v) => v.bets.reduce((s, b) => s + b.amount, 0) <= R.MAX_BET, {
    message: '一局总注最多 ' + R.MAX_BET + ' 分',
    path: ['bets'],
  })
  .refine((v) => v.bets.every((b) => !spotError(b)), {
    message: '注位类型与值不匹配',
    path: ['bets'],
  });

module.exports = { spinSchema, COMBO_VALUES, COLOR_VALUES, PARITY_VALUES };
