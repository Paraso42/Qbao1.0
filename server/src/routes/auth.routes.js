'use strict';

const { pool } = require('../db');
const { hashPassword, comparePassword, signToken, isAdminUsername } = require('../auth');
const { requireAuth } = require('../middleware');
const { asyncHandler, ApiError } = require('../lib/errorHandler');
const { validate } = require('../lib/validate');
const { registerSchema, loginSchema } = require('../schemas/auth.schema');
const pointsService = require('../services/pointsService');

function userToObj(row) {
  return {
    id: row.id, username: row.username,
    displayName: row.display_name, role: row.role,
    avatarUrl: row.avatar_url || null,
    storagePoints: parseInt(row.storage_points) || 0
  };
}

module.exports = function (app) {
  // POST /api/v1/auth/register
  app.post('/api/v1/auth/register', validate({ body: registerSchema }), asyncHandler(async (req, res) => {
    const { username, password, displayName } = req.body;
    // T3 整改：仅当库中无管理员且用户名在 ADMIN_USERNAMES 环境变量中时才授予 admin；
    // 杜绝「首个注册用户自动成为管理员」的提权风险（公网可达时尤甚）。
    // AUTO_ADMIN=1（仅内测环境可设）：注册即管理员，用于内测服全员管理员模式；生产严禁开启。
    let role = 'user';
    if (process.env.AUTO_ADMIN === '1') {
      role = 'admin';
    } else {
      const adminResult = await pool.query("SELECT 1 FROM users WHERE role = 'admin' LIMIT 1");
      role = (adminResult.rows.length === 0 && isAdminUsername(username)) ? 'admin' : 'user';
    }
    const hash = await hashPassword(password);
    const name = (displayName || username).trim();
    let result;
    try {
      result = await pool.query(
        'INSERT INTO users (username, password_hash, display_name, role) VALUES ($1, $2, $3, $4) RETURNING id, username, display_name, role, avatar_url, storage_points',
        [username, hash, name, role]
      );
    } catch (e) {
      if (e.code === '23505') throw new ApiError(409, '用户名已存在');
      throw e;
    }
    const user = result.rows[0];
    const token = signToken(user.id, user.role);
    // 注册奖励（发分失败不阻塞注册）
    pointsService.awardSignupBonus(pool, user.id).catch((e) => console.warn('[points] signup bonus failed:', e.message));
    res.json({ user: userToObj(user), token });
  }));

  // POST /api/v1/auth/login
  app.post('/api/v1/auth/login', validate({ body: loginSchema }), asyncHandler(async (req, res) => {
    const { username, password } = req.body;
    const result = await pool.query(
      'SELECT * FROM users WHERE username = $1', [username]);
    if (result.rows.length === 0) throw new ApiError(401, '用户名或密码错误');

    const user = result.rows[0];
    if (user.is_banned) throw new ApiError(403, '账号已被封禁');

    const ok = await comparePassword(password, user.password_hash);
    if (!ok) throw new ApiError(401, '用户名或密码错误');

    await pool.query('UPDATE users SET last_login_at = NOW() WHERE id = $1', [user.id]);
    // 每日登录奖励（同天幂等；失败不阻塞登录）
    pointsService.awardDailyLoginIfNewDay(pool, user.id).catch((e) => console.warn('[points] daily login bonus failed:', e.message));
    const token = signToken(user.id, user.role);
    res.json({ user: userToObj(user), token });
  }));

  // GET /api/v1/auth/me
  app.get('/api/v1/auth/me', requireAuth, asyncHandler(async (req, res) => {
    const result = await pool.query(
      'SELECT id, username, display_name, role, created_at, avatar_url, last_login_at, last_active_at, storage_points FROM users WHERE id = $1',
      [req.userId]
    );
    if (result.rows.length === 0) throw new ApiError(404, '用户不存在');
    const u = result.rows[0];
    res.json({
      id: u.id, username: u.username, displayName: u.display_name,
      role: u.role, createdAt: u.created_at,
      avatarUrl: u.avatar_url || null,
      lastLoginAt: u.last_login_at, lastActiveAt: u.last_active_at,
      storagePoints: parseInt(u.storage_points) || 0
    });
  }));
};