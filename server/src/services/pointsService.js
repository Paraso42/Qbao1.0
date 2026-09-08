'use strict';

// ============================================================
// pointsService.js — 积分系统服务（v3.29）
// 余额缓存 users.storage_points + 台账 points_ledger（balance_after 快照）。
// 规则：所有函数接收 db（pool 或事务 client），保证可嵌入调用方事务；
//       自带事务的方法（adjustPoints/runExpiryCheck）直接使用 pool。
// 幂等：一次性事件（refType+refId 同时存在）依赖 UNIQUE(user_id, ref_type, ref_id)，
//       冲突时补偿回滚余额；多次事件（续期/扣费/答题增量）ref_id 留空。
// ============================================================

const { pool } = require('../db');
const { ApiError } = require('../lib/errorHandler');
const P = require('../config/points');

// ---------- 基础 ----------

function localDateKey(now = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return now.getFullYear() + '-' + p(now.getMonth() + 1) + '-' + p(now.getDate());
}

// 服务器本地时区当日 00:00（日历日口径与部署时区一致）
function localStartOfDay(now = new Date()) {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

// 发分：余额 +delta + 台账；一次性事件幂等（冲突补偿回滚）
async function awardPoints(db, userId, delta, { reason, refType = null, refId = null, note = '' } = {}) {
  if (!reason) throw new Error('points: reason required');
  const upd = await db.query(
    'UPDATE users SET storage_points = storage_points + $2 WHERE id = $1 RETURNING storage_points',
    [userId, delta]
  );
  if (upd.rows.length === 0) throw new ApiError(404, '用户不存在');
  const balance = parseInt(upd.rows[0].storage_points) || 0;
  const useKey = !!(refType && refId);
  try {
    await db.query(
      `INSERT INTO points_ledger (user_id, delta, balance_after, reason, ref_type, ref_id, note)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [userId, delta, balance, reason, refType, refId, note || '']
    );
    return { awarded: true, balance, delta };
  } catch (e) {
    if (useKey && e.code === '23505') {
      // 唯一约束冲突 → 本次未生效，补偿回滚余额
      await db.query('UPDATE users SET storage_points = storage_points - $2 WHERE id = $1', [userId, delta]);
      const rb = await db.query('SELECT storage_points FROM users WHERE id = $1', [userId]);
      return { awarded: false, balance: parseInt(rb.rows.length ? rb.rows[0].storage_points : 0) || 0 };
    }
    throw e;
  }
}

// 扣分：条件更新保证余额不为负；不足 → 400
async function spendPoints(db, userId, cost, { reason, note = '' } = {}) {
  if (!(cost > 0)) throw new Error('points: cost must be positive');
  const upd = await db.query(
    'UPDATE users SET storage_points = storage_points - $2 WHERE id = $1 AND storage_points >= $2 RETURNING storage_points',
    [userId, cost]
  );
  if (upd.rows.length === 0) {
    const ex = await db.query('SELECT storage_points FROM users WHERE id = $1', [userId]);
    if (ex.rows.length === 0) throw new ApiError(404, '用户不存在');
    throw new ApiError(400, '积分不足，无法完成此操作');
  }
  const balance = parseInt(upd.rows[0].storage_points) || 0;
  await db.query(
    `INSERT INTO points_ledger (user_id, delta, balance_after, reason, ref_type, ref_id, note)
     VALUES ($1, $2, $3, $4, NULL, NULL, $5)`,
    [userId, -cost, balance, reason, note || '']
  );
  return { balance, spent: cost };
}

// 管理员调整（自带事务；结果余额 <0 → 422）
async function adjustPoints(userId, delta, note) {
  if (!Number.isInteger(delta)) throw new ApiError(422, 'delta 必须为整数');
  if (delta === 0) throw new ApiError(422, 'delta 不能为 0');
  const noteStr = String(note || '').trim();
  if (!noteStr) throw new ApiError(422, '请填写调整原因');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const upd = await client.query(
      'UPDATE users SET storage_points = storage_points + $2 WHERE id = $1 RETURNING storage_points',
      [userId, delta]
    );
    if (upd.rows.length === 0) throw new ApiError(404, '用户不存在');
    const balance = parseInt(upd.rows[0].storage_points) || 0;
    if (balance < 0) throw new ApiError(422, '调整后余额不能为负');
    await client.query(
      `INSERT INTO points_ledger (user_id, delta, balance_after, reason, note)
       VALUES ($1, $2, $3, 'admin_adjust', $4)`,
      [userId, delta, balance, noteStr]
    );
    await client.query('COMMIT');
    return { balance };
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

// 台账分页查询
async function getLedger(db, userId, { page = 1, limit = 20, reason } = {}) {
  const safePage = Math.max(1, parseInt(page) || 1);
  const safeLimit = Math.min(100, Math.max(1, parseInt(limit) || 20));
  const where = ['user_id = $1'];
  const params = [userId];
  let pi = 1;
  if (reason) {
    pi += 1;
    where.push('reason = $' + pi);
    params.push(reason);
  }
  const whereSql = ' WHERE ' + where.join(' AND ');
  const cnt = await db.query('SELECT COUNT(*)::int AS c FROM points_ledger' + whereSql, params);
  const total = parseInt((cnt.rows[0] && cnt.rows[0].c) || 0);
  const off = (safePage - 1) * safeLimit;
  const res = await db.query(
    'SELECT id, delta, balance_after, reason, ref_type, ref_id, note, created_at FROM points_ledger' +
    whereSql +
    ' ORDER BY created_at DESC, id DESC LIMIT $' + (params.length + 1) + ' OFFSET $' + (params.length + 2),
    params.concat([safeLimit, off])
  );
  return {
    total,
    page: safePage,
    limit: safeLimit,
    items: res.rows.map((row) => ({
      id: row.id,
      delta: parseInt(row.delta),
      balanceAfter: parseInt(row.balance_after),
      reason: row.reason,
      refType: row.ref_type,
      refId: row.ref_id,
      note: row.note || '',
      createdAt: row.created_at,
    })),
  };
}

async function getBalance(db, userId) {
  const r = await db.query('SELECT storage_points FROM users WHERE id = $1', [userId]);
  if (r.rows.length === 0) throw new ApiError(404, '用户不存在');
  return parseInt(r.rows[0].storage_points) || 0;
}

// 某原因自 since 起的累计 delta（每日上限/封顶计数）
async function sumSince(db, userId, reason, since) {
  const r = await db.query(
    'SELECT COALESCE(SUM(delta), 0)::int AS s FROM points_ledger WHERE user_id = $1 AND reason = $2 AND created_at >= $3',
    [userId, reason, since]
  );
  return parseInt((r.rows[0] && r.rows[0].s) || 0);
}

// ---------- 赚取事件 ----------

async function awardSignupBonus(db, userId) {
  return awardPoints(db, userId, P.SIGNUP_BONUS, {
    reason: 'signup', refType: 'signup', refId: 'user:' + userId, note: '注册奖励',
  });
}

async function awardDailyLoginIfNewDay(db, userId) {
  const key = localDateKey();
  return awardPoints(db, userId, P.DAILY_LOGIN_BONUS, {
    reason: 'daily_login', refType: 'daily_login', refId: key, note: '每日登录奖励',
  });
}

// 答题结算（在 status=completed 写入会话后调用）：
// 按 answer_sessions.points_awarded_stats 的 correct 增量发分；每日上限截断；
// 快照始终推进到当前 correct（当日超限部分不再补发）。
// T5 整改：真实 pool（带 connect）→ 启用行级锁事务，杜绝并发 completed 请求
// 读到同一旧快照重复发分；fake db（测试）无 connect → 走直连原逻辑，保持单元可测。
async function awardQuizCompletion(db, userId, chapterId, stats) {
  if (!stats || typeof stats !== 'object') return { awarded: false, points: 0 };
  const correct = Math.max(0, parseInt(stats.objCorrect != null ? stats.objCorrect : stats.correct) || 0);
  if (correct <= 0) return { awarded: false, points: 0 };
  const client = typeof db.connect === 'function' ? await db.connect() : null;
  const q = client || db;
  try {
    if (client) await q.query('BEGIN');
    const snapQ = await q.query(
      'SELECT points_awarded_stats FROM answer_sessions WHERE user_id = $1 AND chapter_id = $2 FOR UPDATE',
      [userId, chapterId]
    );
    if (snapQ.rows.length === 0) {
      if (client) await q.query('COMMIT');
      return { awarded: false, points: 0 };
    }
    const prev = snapQ.rows[0].points_awarded_stats;
    const prevCorrect = parseInt((prev && prev.correct) || 0);
    const delta = correct - prevCorrect;
    if (delta <= 0) {
      if (client) await q.query('COMMIT');
      return { awarded: false, points: 0 };
    }
    const used = await sumSince(q, userId, 'quiz_answer', localStartOfDay());
    const quota = Math.max(0, P.QUIZ_DAILY_CAP - used);
    const pts = Math.min(delta * P.QUIZ_CORRECT_POINTS, quota);
    const result = pts > 0
      ? await awardPoints(q, userId, pts, { reason: 'quiz_answer', note: '答题奖励（客观题正确）' })
      : { awarded: false };
    await q.query(
      'UPDATE answer_sessions SET points_awarded_stats = $3::jsonb WHERE user_id = $1 AND chapter_id = $2',
      [userId, chapterId, JSON.stringify({ correct, awardedPoints: pts, awardedAt: new Date().toISOString() })]
    );
    if (client) await q.query('COMMIT');
    return { awarded: result.awarded, points: pts, balance: result.balance };
  } catch (e) {
    if (client) await q.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    if (client) client.release();
  }
}

// 分享下载奖励：每次 +2，单库封顶；幂等键 = 第 N 次下载（去重回放）
async function awardShareDownload(db, ownerId, bankId, newCount) {
  const earnedR = await db.query(
    `SELECT COALESCE(SUM(delta), 0)::int AS s FROM points_ledger
     WHERE user_id = $1 AND reason = 'share_download' AND ref_id LIKE $2`,
    [ownerId, 'bank:' + bankId + ':%']
  );
  const earned = parseInt((earnedR.rows[0] && earnedR.rows[0].s) || 0);
  if (earned >= P.SHARE_BANK_CAP) return { awarded: false, reason: 'capped' };
  const pts = Math.min(P.SHARE_DOWNLOAD_POINTS, P.SHARE_BANK_CAP - earned);
  return awardPoints(db, ownerId, pts, {
    reason: 'share_download',
    refType: 'share_download',
    refId: 'bank:' + bankId + ':' + newCount,
    note: '分享题库被下载',
  });
}

// ---------- 消耗与配额 ----------

// AI 配额：kind = 'generate'（出题尝试+任务创建共享每日免费次数）| 'upload'（文件解析）
// P0.7 整改：配额「计数 → 扣费」原子化 —— 真实 pool（带 connect）时包一层事务 +
// 同用户 advisory xact lock（hashtextextended），并发请求串行裁决，杜绝两个并发请求
// 同时读到免费额度内而双双免扣（TOCTOU）；fake db（无 connect）走直连保持单元可测。
const AI_QUOTA_LOCK_PREFIX = 'qbao:aiq:';
async function checkAndChargeAiQuota(db, userId, kind) {
  const since = localStartOfDay();
  const client = typeof db.connect === 'function' ? await db.connect() : null;
  const q = client || db;
  try {
    if (client) {
      await q.query('BEGIN');
      await q.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [AI_QUOTA_LOCK_PREFIX + userId]);
    }
    let used = 0;
    if (kind === 'generate') {
      const [logs, tasks] = await Promise.all([
        q.query(
          "SELECT COUNT(*)::int AS c FROM ai_request_log WHERE user_id = $1 AND created_at >= $2 AND status = 'started'",
          [userId, since]
        ),
        q.query(
          'SELECT COUNT(*)::int AS c FROM ai_tasks WHERE user_id = $1 AND created_at >= $2',
          [userId, since]
        ),
      ]);
      used = ((logs.rows[0] && logs.rows[0].c) || 0) + ((tasks.rows[0] && tasks.rows[0].c) || 0);
      if (used < P.AI_FREE_DAILY) {
        if (client) await q.query('COMMIT');
        return { charged: false, used };
      }
      const res = await spendPoints(q, userId, P.AI_OVER_COST, {
        reason: 'ai_generate', note: 'AI 出题超额（每日免费 ' + P.AI_FREE_DAILY + ' 次）',
      });
      if (client) await q.query('COMMIT');
      return { charged: true, used, balance: res.balance };
    }
    if (kind === 'upload') {
      const logs = await q.query(
        "SELECT COUNT(*)::int AS c FROM ai_request_log WHERE user_id = $1 AND created_at >= $2 AND model = 'upload'",
        [userId, since]
      );
      used = (logs.rows[0] && logs.rows[0].c) || 0;
      if (used < P.AI_UPLOAD_FREE_DAILY) {
        if (client) await q.query('COMMIT');
        return { charged: false, used };
      }
      const res = await spendPoints(q, userId, P.AI_UPLOAD_OVER_COST, {
        reason: 'ai_upload', note: 'AI 文件解析超额（每日免费 ' + P.AI_UPLOAD_FREE_DAILY + ' 次）',
      });
      if (client) await q.query('COMMIT');
      return { charged: true, used, balance: res.balance };
    }
    throw new Error('points: unknown ai quota kind ' + kind);
  } catch (e) {
    if (client) await q.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    if (client) client.release();
  }
}

// 今日 AI 配额使用情况（前端提示用）
async function getQuotaStatus(db, userId) {
  const since = localStartOfDay();
  const [logs, tasks, uploads] = await Promise.all([
    db.query("SELECT COUNT(*)::int AS c FROM ai_request_log WHERE user_id = $1 AND created_at >= $2 AND status = 'started'", [userId, since]),
    db.query('SELECT COUNT(*)::int AS c FROM ai_tasks WHERE user_id = $1 AND created_at >= $2', [userId, since]),
    db.query("SELECT COUNT(*)::int AS c FROM ai_request_log WHERE user_id = $1 AND created_at >= $2 AND model = 'upload'", [userId, since]),
  ]);
  const generateUsed = ((logs.rows[0] && logs.rows[0].c) || 0) + ((tasks.rows[0] && tasks.rows[0].c) || 0);
  const uploadUsed = (uploads.rows[0] && uploads.rows[0].c) || 0;
  return {
    aiGenerateUsed: generateUsed,
    aiGenerateFree: P.AI_FREE_DAILY,
    aiGenerateOverCost: P.AI_OVER_COST,
    aiUploadUsed: uploadUsed,
    aiUploadFree: P.AI_UPLOAD_FREE_DAILY,
    aiUploadOverCost: P.AI_UPLOAD_OVER_COST,
  };
}

// ---------- 规则与学期清零 ----------

// 下一个清零日（今天恰为清零日 → 已视为过去，取下一个）
function computeNextExpiry(now = new Date()) {
  for (const { month, day, label } of P.EXPIRY_DATES) {
    const cand = new Date(now.getFullYear(), month - 1, day);
    if (cand.getTime() > now.getTime()) {
      return { date: localDateKey(cand), label, daysLeft: Math.ceil((cand.getTime() - now.getTime()) / 86400000) };
    }
  }
  const first = P.EXPIRY_DATES[0];
  const cand = new Date(now.getFullYear() + 1, first.month - 1, first.day);
  return { date: localDateKey(cand), label: first.label, daysLeft: Math.ceil((cand.getTime() - now.getTime()) / 86400000) };
}

function getRules() {
  return {
    earn: [
      { reason: 'signup', label: P.REASON_LABELS.signup, points: P.SIGNUP_BONUS, desc: '新注册用户自动到账', once: true },
      { reason: 'daily_login', label: P.REASON_LABELS.daily_login, points: P.DAILY_LOGIN_BONUS, desc: '每天首次登录自动到账', once: false },
      { reason: 'quiz_answer', label: P.REASON_LABELS.quiz_answer, points: P.QUIZ_CORRECT_POINTS + '/题', desc: '每答对 1 道客观题 +' + P.QUIZ_CORRECT_POINTS + ' 分，每日上限 ' + P.QUIZ_DAILY_CAP + ' 分（轮次完成时结算）', once: false },
      { reason: 'achievement', label: P.REASON_LABELS.achievement, points: '10~200', desc: '解锁成就自动领取，每个成就一次', once: true },
      { reason: 'share_download', label: P.REASON_LABELS.share_download, points: P.SHARE_DOWNLOAD_POINTS, desc: '分享的题库每被他人下载一次 +' + P.SHARE_DOWNLOAD_POINTS + '，单库封顶 +' + P.SHARE_BANK_CAP, once: false },
      { reason: 'marble_out', label: P.REASON_LABELS.marble_out, points: '1 积分/' + P.MARBLE_EXCHANGE_RATE + ' 弹珠', desc: '弹珠游戏（弹猪乐）：弹珠兑换积分（' + P.MARBLE_EXCHANGE_RATE + ' 弹珠 = 1 积分），每日上限 ' + P.MARBLE_OUT_DAILY_CAP_POINTS + ' 分', once: false },
    ],
    spend: [
      { reason: 'file_extend', label: P.REASON_LABELS.file_extend, points: P.FILE_EXTEND_COST, desc: '延长文件池保存 ' + P.FILE_EXTEND_DAYS + ' 天（' + P.FILE_EXTEND_COST + ' 积分/' + P.FILE_EXTEND_DAYS + '天）' },
      { reason: 'ai_generate', label: P.REASON_LABELS.ai_generate, points: P.AI_OVER_COST, desc: 'AI 出题每日免费 ' + P.AI_FREE_DAILY + ' 次，超出后每次 ' + P.AI_OVER_COST + ' 积分' },
      { reason: 'ai_upload', label: P.REASON_LABELS.ai_upload, points: P.AI_UPLOAD_OVER_COST, desc: 'AI 文件解析每日免费 ' + P.AI_UPLOAD_FREE_DAILY + ' 次，超出后每次 ' + P.AI_UPLOAD_OVER_COST + ' 积分' },
      { reason: 'marble_in', label: P.REASON_LABELS.marble_in, points: '1 积分/' + P.MARBLE_EXCHANGE_RATE + ' 弹珠', desc: '弹珠游戏（弹猪乐）：积分兑换弹珠（1 积分 = ' + P.MARBLE_EXCHANGE_RATE + ' 弹珠）' },
    ],
    expiry: {
      dates: P.EXPIRY_DATES,
      notifyDays: P.EXPIRY_NOTIFY_DAYS,
    },
    nextExpiry: computeNextExpiry(),
    reasonLabels: P.REASON_LABELS,
  };
}

// ---------- 学期清零定时任务 ----------

function isExpiryDay(now = new Date()) {
  const m = now.getMonth() + 1;
  const d = now.getDate();
  return P.EXPIRY_DATES.some(({ month, day }) => month === m && day === d);
}

// 幂等清零：storage_points<>0 的用户清零并记 expiry_reset 台账；
// ref_id=清零日 → 唯一约束保证同一天只记一次（多实例/重复运行安全）。
async function runExpiryCheck(now = new Date()) {
  if (!isExpiryDay(now)) return { reset: false };
  const dateKey = localDateKey(now);
  const label = (P.EXPIRY_DATES.find(({ month, day }) => month === now.getMonth() + 1 && day === now.getDate()) || {}).label || '学期积分清零';
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // 跨实例单跑
    await client.query('SELECT pg_advisory_xact_lock($1)', [P.EXPIRY_LOCK_KEY]);
    const res = await client.query(
      `WITH reset AS (
         UPDATE users SET storage_points = 0
         WHERE storage_points <> 0
         RETURNING id, storage_points AS old_balance
       )
       INSERT INTO points_ledger (user_id, delta, balance_after, reason, ref_type, ref_id, note)
       SELECT id, -old_balance, 0, 'expiry_reset', 'expiry', $1, $2
       FROM reset
       ON CONFLICT (user_id, ref_type, ref_id) DO NOTHING
       RETURNING user_id`,
      [dateKey, label]
    );
    await client.query('COMMIT');
    return { reset: true, users: res.rows.length };
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

// 每日低峰对账：storage_points = SUM(ledger.delta)（台账为准，修正余额漂移）
// T5 整改：keyset 游标分页循环，修复只扫前 500 用户的问题（大用户量下全量对账）。
async function reconcileAll(batchSize = 500) {
  const safeBatch = Math.max(1, Math.min(5000, parseInt(batchSize) || 500));
  let lastId = 0;
  let scanned = 0;
  let fixed = 0;
  for (;;) {
    const users = await pool.query(
      'SELECT id, storage_points FROM users WHERE id > $1 AND (storage_points <> 0 OR id IN (SELECT DISTINCT user_id FROM points_ledger)) ORDER BY id LIMIT $2',
      [lastId, safeBatch]
    );
    if (users.rows.length === 0) break;
    for (const u of users.rows) {
      const r = await pool.query(
        'SELECT COALESCE(SUM(delta), 0)::int AS s FROM points_ledger WHERE user_id = $1',
        [u.id]
      );
      const sum = parseInt(r.rows[0].s) || 0;
      const cur = parseInt(u.storage_points) || 0;
      if (sum !== cur) {
        await pool.query('UPDATE users SET storage_points = $1 WHERE id = $2', [sum, u.id]);
        fixed++;
        console.log('[points] reconcile user=' + u.id + ' ' + cur + ' -> ' + sum);
      }
    }
    scanned += users.rows.length;
    lastId = users.rows[users.rows.length - 1].id;
    if (users.rows.length < safeBatch) break;
  }
  return { scanned, fixed };
}

const EXPIRY_TICK_MS = 60 * 60 * 1000;
let expiryTimer = null;

// 进程内定时器：每小时检查清零日；每日 03:00 附近执行对账。
// T8: unref — 不阻止进程退出/优雅停机（HTTP server 本身维持事件循环）。
function startExpiryJob() {
  if (expiryTimer) return expiryTimer;
  expiryTimer = setInterval(() => {
    const now = new Date();
    runExpiryCheck(now).catch((e) => console.error('[points] expiry check failed:', e.message));
    if (now.getHours() === 3) {
      reconcileAll().catch((e) => console.error('[points] reconcile failed:', e.message));
    }
  }, EXPIRY_TICK_MS);
  if (typeof expiryTimer.unref === 'function') expiryTimer.unref();
  runExpiryCheck().catch((e) => console.error('[points] expiry check failed:', e.message));
  return expiryTimer;
}

// T8: 显式停止（测试/优雅停机用）
function stopExpiryJob() {
  if (expiryTimer) clearInterval(expiryTimer);
  expiryTimer = null;
}

module.exports = {
  // 基础
  awardPoints, spendPoints, adjustPoints, getLedger, getBalance, sumSince,
  localDateKey, localStartOfDay, computeNextExpiry, getRules,
  // 赚取
  awardSignupBonus, awardDailyLoginIfNewDay, awardQuizCompletion, awardShareDownload,
  // 消耗/配额
  checkAndChargeAiQuota, getQuotaStatus,
  // 生命周期
  runExpiryCheck, reconcileAll, startExpiryJob, stopExpiryJob,
};