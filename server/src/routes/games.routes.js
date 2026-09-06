'use strict';

// ============================================================
// games.routes.js — 游戏空间数据 API（v3.38）
// 每用户单行 JSONB（user_games_stats）：best/level 只升不降、plays 累加。
// 写入采用「读-改-写 + data CAS 重试（≤3 次）」防并发覆盖；409 兜底。
// 联机/积分契约见 docs/GAMES.md（v0 仅本地成绩记录）。
// ============================================================

const { pool } = require('../db');
const { requireAuth } = require('../middleware');
const { asyncHandler, ApiError } = require('../lib/errorHandler');
const { validate } = require('../lib/validate');
const { reportSchema } = require('../schemas/games.schema');

// plays 统计上限（防长时间刷写导致 JSONB 膨胀；v0 不参与任何权益）
const PLAYS_CAP = 100000;
const CAS_MAX_ATTEMPTS = 3;

module.exports = function (app) {
  // GET /api/v1/games — 当前用户全部游戏数据
  app.get('/api/v1/games', requireAuth, asyncHandler(async (req, res) => {
    const r = await pool.query('SELECT data FROM user_games_stats WHERE user_id = $1', [req.userId]);
    const data = (r.rows[0] && r.rows[0].data) || {};
    res.json({ data });
  }));

  // POST /api/v1/games — 上报/合并单游戏成绩
  // body: { gameId, score?, level?, plays? }；plays 表示本次合并窗口内的游玩事件数
  app.post('/api/v1/games', validate({ body: reportSchema }), requireAuth, asyncHandler(async (req, res) => {
    const { gameId, score, level, plays } = req.body;
    // 缺省视为一次游玩事件（每次成功上报至少 +1；上限 200/次由 schema 保证）
    const delta = Math.max(1, Math.min(Number(plays || 0), 200));

    for (let attempt = 0; attempt < CAS_MAX_ATTEMPTS; attempt++) {
      const r = await pool.query('SELECT data FROM user_games_stats WHERE user_id = $1', [req.userId]);
      const data = (r.rows[0] && r.rows[0].data) || {};
      const cur = data[gameId] || {};

      const next = {
        best: Math.max(Number(cur.best) || 0, Number(score) || 0),
        level: Math.max(Number(cur.level) || 0, Number(level) || 0),
        plays: Math.min((Number(cur.plays) || 0) + delta, PLAYS_CAP),
        lastAt: new Date().toISOString(),
      };
      const nextData = Object.assign({}, data, { [gameId]: next });

      if (r.rows.length === 0) {
        // 新用户首写（并发首写由 ON CONFLICT DO NOTHING 收敛，冲突则重试）
        const ins = await pool.query(
          'INSERT INTO user_games_stats (user_id, data, updated_at) VALUES ($1, $2::jsonb, NOW()) ON CONFLICT (user_id) DO NOTHING',
          [req.userId, JSON.stringify(nextData)]
        );
        if (ins.rowCount === 1) return res.json({ data: nextData });
        continue;
      }

      // 已存在：data CAS（旧值比对）防并发覆盖；失败进入下一轮重读
      const upd = await pool.query(
        'UPDATE user_games_stats SET data = $2::jsonb, updated_at = NOW() WHERE user_id = $1 AND data = $3::jsonb',
        [req.userId, JSON.stringify(nextData), JSON.stringify(data)]
      );
      if (upd.rowCount === 1) return res.json({ data: nextData });
    }

    throw new ApiError(409, '并发写入冲突，请重试');
  }));
};
