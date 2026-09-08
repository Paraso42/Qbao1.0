'use strict';

const fs = require('fs');
const path = require('path');
const { pool } = require('../db');
const { hashPassword, comparePassword, signToken } = require('../auth');
const {
  requireAuth,
  requireAdmin,
  invalidateBannedCache,
} = require('../middleware');
const { asyncHandler, ApiError } = require('../lib/errorHandler');
const { validate } = require('../lib/validate');
const {
  userIdParamsSchema,
  updateMeSchema,
  avatarBodySchema,
  adminListUsersQuerySchema,
  adminUpdateUserSchema,
  banUserSchema,
} = require('../schemas/users.schema');

const AVATAR_DIR = path.join(__dirname, '../../../uploads/avatars');
if (!fs.existsSync(AVATAR_DIR)) fs.mkdirSync(AVATAR_DIR, { recursive: true });

function userRow(row) {
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    role: row.role,
    avatarUrl: row.avatar_url || null,
    createdAt: row.created_at,
    lastLoginAt: row.last_login_at,
    lastActiveAt: row.last_active_at,
    isOnline: !!(row.is_online),
    isBanned: row.is_banned,
    storagePoints: parseInt(row.storage_points) || 0,
  };
}

function parseStats(stateJson) {
  if (!stateJson) return { subjects: 0, chapters: 0, totalQuestions: 0 };
  try {
    const subjects = stateJson.subjects || {};
    const chapters = stateJson.chapters || {};
    let totalQuestions = 0;
    Object.values(chapters).forEach((chapter) => {
      if (chapter.questions && Array.isArray(chapter.questions)) {
        totalQuestions += chapter.questions.length;
      }
    });
    return { subjects: Object.keys(subjects).length, chapters: Object.keys(chapters).length, totalQuestions };
  } catch (_) {
    return { subjects: 0, chapters: 0, totalQuestions: 0 };
  }
}

module.exports = function (app) {
  app.get('/api/v1/users/me', requireAuth, asyncHandler(async (req, res) => {
    const r = await pool.query(
      `SELECT id, username, display_name, role, created_at, avatar_url,
              last_login_at, last_active_at, is_banned, storage_points
       FROM users WHERE id = $1`,
      [req.userId]
    );
    if (r.rows.length === 0) throw new ApiError(404, '用户不存在');

    const u = r.rows[0];
    res.json({
      id: u.id,
      username: u.username,
      displayName: u.display_name,
      role: u.role,
      createdAt: u.created_at,
      avatarUrl: u.avatar_url || null,
      lastLoginAt: u.last_login_at,
      lastActiveAt: u.last_active_at,
      isBanned: u.is_banned,
      storagePoints: parseInt(u.storage_points) || 0,
    });
  }));

  app.put('/api/v1/users/me', validate({ body: updateMeSchema }), requireAuth, asyncHandler(async (req, res) => {
    const { displayName, password, newPassword } = req.body;
    const updates = [];
    const params = [];
    let i = 0;

    if (displayName !== undefined) {
      i++;
      updates.push('display_name = $' + i);
      params.push(displayName.trim());
    }

    if (newPassword) {
      if (!password) throw new ApiError(422, '请提供当前密码');
      const rp = await pool.query('SELECT password_hash FROM users WHERE id = $1', [req.userId]);
      if (rp.rows.length === 0) throw new ApiError(404, '用户不存在');
      const ok = await comparePassword(password, rp.rows[0].password_hash);
      if (!ok) throw new ApiError(401, '当前密码错误');
      i++;
      updates.push('password_hash = $' + i);
      params.push(await hashPassword(newPassword));
    }

    if (updates.length === 0) throw new ApiError(422, '没有需要更新的字段');
    params.push(req.userId);

    const result = await pool.query(
      'UPDATE users SET ' + updates.join(', ') + ' WHERE id = $' + params.length + ' RETURNING id, username, display_name, role, avatar_url',
      params
    );
    if (result.rows.length === 0) throw new ApiError(404, '用户不存在');

    const u = result.rows[0];
    const token = signToken(u.id, u.role);
    res.json({
      user: { id: u.id, username: u.username, displayName: u.display_name, role: u.role, avatarUrl: u.avatar_url || null },
      token,
    });
  }));

  app.put('/api/v1/users/me/avatar', validate({ body: avatarBodySchema }), requireAuth, asyncHandler(async (req, res) => {
    const { avatar } = req.body;
    let avatarPath = null;

    if (typeof avatar === 'string' && avatar.startsWith('data:')) {
      const matches = avatar.match(/^data:image\/(jpeg|png|gif|webp);base64,(.+)$/);
      if (!matches) throw new ApiError(422, '头像必须是 jpeg/png/gif/webp 的 base64 data URL');

      const ext = matches[1] === 'jpeg' ? 'jpg' : matches[1];
      const buf = Buffer.from(matches[2], 'base64');
      if (buf.length > 5 * 1024 * 1024) throw new ApiError(422, '头像文件不能超过 5MB');

      const fileName = req.userId + '.' + ext;
      const filePath = path.join(AVATAR_DIR, fileName);

      const oldFiles = fs.readdirSync(AVATAR_DIR);
      oldFiles.forEach((f) => {
        if (f.startsWith(String(req.userId) + '.')) {
          try { fs.unlinkSync(path.join(AVATAR_DIR, f)); } catch (_) {}
        }
      });
      fs.writeFileSync(filePath, buf);
      avatarPath = 'avatars/' + fileName;
    }

    const storedUrl = avatarPath || avatar;
    const result = await pool.query(
      'UPDATE users SET avatar_url = $1 WHERE id = $2 RETURNING id, avatar_url',
      [storedUrl, req.userId]
    );
    if (result.rows.length === 0) throw new ApiError(404, '用户不存在');
    res.json({ user: { id: result.rows[0].id, avatarUrl: storedUrl } });
  }));

  app.patch('/api/v1/users/me/active', requireAuth, asyncHandler(async (req, res) => {
    await pool.query('UPDATE users SET last_active_at = NOW() WHERE id = $1', [req.userId]);
    res.json({ ok: true });
  }));

  app.get('/api/v1/users', validate({ query: adminListUsersQuerySchema }), requireAdmin, asyncHandler(async (req, res) => {
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20));
    const offset = (page - 1) * limit;

    const where = [];
    const params = [];
    let pi = 0;

    if (req.query.role) { pi++; where.push('role = $' + pi); params.push(req.query.role); }
    if (req.query.banned !== undefined) { pi++; where.push('is_banned = $' + pi); params.push(req.query.banned === 'true'); }
    if (req.query.search) { pi++; where.push('(username ILIKE $' + pi + ' OR display_name ILIKE $' + pi + ')'); params.push('%' + req.query.search + '%'); }

    const whereSql = where.length ? ' WHERE ' + where.join(' AND ') : '';
    const countR = await pool.query('SELECT COUNT(*) FROM users' + whereSql, params);
    const total = parseInt(countR.rows[0].count);

    const dataR = await pool.query(
      `SELECT id, username, display_name, role, created_at, avatar_url, last_login_at,
              last_active_at, is_banned, storage_points,
              (last_active_at > NOW() - INTERVAL '5 minutes') AS is_online
       FROM users${whereSql}
       ORDER BY created_at DESC
       LIMIT $${pi + 1} OFFSET $${pi + 2}`,
      params.concat([limit, offset])
    );

    res.json({ total, page, limit, users: dataR.rows.map(userRow) });
  }));

  app.get('/api/v1/users/stats', requireAdmin, asyncHandler(async (req, res) => {
    const r = await pool.query(
      `SELECT COUNT(*) AS total,
              COALESCE(SUM(CASE WHEN role='admin' THEN 1 ELSE 0 END),0) AS adminCount,
              COALESCE(SUM(CASE WHEN role='user' THEN 1 ELSE 0 END),0) AS userCount,
              COALESCE(SUM(CASE WHEN is_banned THEN 1 ELSE 0 END),0) AS bannedCount,
              COALESCE(SUM(CASE WHEN last_active_at > NOW()-INTERVAL '5 minutes' THEN 1 ELSE 0 END),0) AS onlineNow,
              COALESCE(SUM(CASE WHEN last_login_at::date=CURRENT_DATE THEN 1 ELSE 0 END),0) AS todayLogins
       FROM users`
    );
    const row = r.rows[0];
    res.json({
      totalUsers: Number(row.total || 0),
      adminCount: Number(row.admincount || 0),
      userCount: Number(row.usercount || 0),
      bannedCount: Number(row.bannedcount || 0),
      onlineNow: Number(row.onlinenow || 0),
      todayLogins: Number(row.todaylogins || 0),
    });
  }));

  app.get('/api/v1/users/:id', validate({ params: userIdParamsSchema }), requireAdmin, asyncHandler(async (req, res) => {
    const uid = req.params.id;
    const ur = await pool.query(
      `SELECT id, username, display_name, role, created_at, avatar_url, last_login_at,
              last_active_at, is_banned, storage_points,
              (last_active_at > NOW()-INTERVAL '5 minutes') AS is_online
       FROM users WHERE id = $1`,
      [uid]
    );
    if (ur.rows.length === 0) throw new ApiError(404, '用户不存在');

    const [sr, shar, air, dr] = await Promise.all([
      pool.query('SELECT COUNT(*) AS c FROM backups WHERE user_id = $1', [uid]),
      pool.query('SELECT COUNT(*) AS c FROM shared_banks WHERE owner_id = $1', [uid]),
      pool.query('SELECT COUNT(*) AS c FROM ai_request_log WHERE user_id = $1', [uid]),
      pool.query('SELECT state_json FROM user_data WHERE user_id = $1', [uid]),
    ]);

    const stateStats = parseStats(dr.rows.length > 0 ? dr.rows[0].state_json : null);
    res.json({
      ...userRow(ur.rows[0]),
      stats: {
        ...stateStats,
        totalBackups: parseInt(sr.rows[0].c),
        totalShares: parseInt(shar.rows[0].c),
        totalAiRequests: parseInt(air.rows[0].c),
      },
    });
  }));

  app.put('/api/v1/users/:id', validate({ params: userIdParamsSchema, body: adminUpdateUserSchema }), requireAdmin, asyncHandler(async (req, res) => {
    const uid = req.params.id;
    const { displayName, role, password } = req.body;
    // 防提权 / 防管理员互害（2026-09）：角色仅能由后台脚本调整（正式服管理员只能后台改写授予）；
    // 管理员密码不可被其他管理员重置（含内测服全员管理员场景）。
    const isSelf = Number(uid) === req.userId;
    const tr = await pool.query('SELECT id, username, role FROM users WHERE id = $1', [uid]);
    if (tr.rows.length === 0) throw new ApiError(404, '用户不存在');
    const target = tr.rows[0];
    if (role !== undefined) {
      if (!isSelf) throw new ApiError(403, '用户角色仅能通过后台脚本调整（防管理台提权）');
      if (role !== 'user') throw new ApiError(403, '仅支持自行放弃管理员身份（role=user）');
    }
    if (password && target.role === 'admin' && !isSelf) {
      throw new ApiError(403, '不能重置管理员账号的密码（防管理员互害）');
    }
    const updates = [];
    const params = [];
    let i = 0;

    if (displayName !== undefined) { i++; updates.push('display_name = $' + i); params.push(displayName.trim()); }
    if (role) { i++; updates.push('role = $' + i); params.push(role); }
    if (password) { i++; updates.push('password_hash = $' + i); params.push(await hashPassword(password)); }
    if (updates.length === 0) throw new ApiError(422, '没有需要更新的字段');

    params.push(uid);
    const result = await pool.query(
      'UPDATE users SET ' + updates.join(', ') + ' WHERE id = $' + params.length + ' RETURNING id, username, display_name, role, avatar_url',
      params
    );
    if (result.rows.length === 0) throw new ApiError(404, '用户不存在');

    const u = result.rows[0];
    invalidateBannedCache(uid);
    res.json({ user: { id: u.id, username: u.username, displayName: u.display_name, role: u.role, avatarUrl: u.avatar_url || null } });
  }));

  app.patch('/api/v1/users/:id/ban', validate({ params: userIdParamsSchema, body: banUserSchema }), requireAdmin, asyncHandler(async (req, res) => {
    const uid = req.params.id;
    const ur = await pool.query('SELECT id, username, role, is_banned FROM users WHERE id = $1', [uid]);
    if (ur.rows.length === 0) throw new ApiError(404, '用户不存在');

    const u = ur.rows[0];
    if (u.role === 'admin') throw new ApiError(403, '管理员账号不受封禁管理（防管理员互害，仅后台可处理）');
    await pool.query('UPDATE users SET is_banned = $1 WHERE id = $2', [req.body.banned, uid]);
    invalidateBannedCache(uid);

    res.json({
      user: { id: u.id, username: u.username, isBanned: req.body.banned },
      message: (req.body.banned ? '已封禁' : '已解封') + '用户 ' + u.username,
    });
  }));
};