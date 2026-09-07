'use strict';

const { z } = require('zod');

// 与 app/public/games/manifest（gamesManifest.js）保持同步的游戏白名单
const GAME_IDS = ['2048', 'froggy', 'gridgarden', 'tetris', 'werewolf'];

// POST /api/v1/games — 单游戏成绩上报
const reportSchema = z.object({
  gameId: z.enum(GAME_IDS, { errorMap: () => ({ message: '未知的游戏类型' }) }),
  score: z.number().int('score 必须为整数').min(0, 'score 不能为负').max(999999999, 'score 超出范围').optional(),
  level: z.number().int('level 必须为整数').min(0, 'level 不能为负').max(100000, 'level 超出范围').optional(),
  plays: z.number().int('plays 必须为整数').min(1).max(200, 'plays 单次最多 200').optional(),
}).refine((v) => v.score !== undefined || v.level !== undefined || v.plays !== undefined, {
  message: '上报内容为空',
});

module.exports = { reportSchema, GAME_IDS };
