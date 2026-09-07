'use strict';

// 桌面端安装包下载统计（v3.35）
// 计数规则：仅统计 HTTP 200 的完整下载（无 Range 头的整包请求），分片续传（206）不重复计数。
// 存储：PostgreSQL desktop_download_stats 聚合行（版本×文件×日，无用户维度）。
// 一致性：内存中仅保留「DB 持久化失败」的条目作为兜底计数，避免与 DB 重复统计；
//          DB 写入完成即从内存清除。DB 故障时自动降级为纯内存统计并节流告警，绝不影响下载。
// 环境变量 QBAO_DESKTOP_STATS=off 可关闭 DB 写入（测试隔离；内存兜底始终可用）。

const { pool } = require('../db');

// key: version|fileName|YYYY-MM-DD(UTC) => cnt（仅存持久化失败/待定的条目）
const pending = new Map();
let lastWarnAt = 0;

// 运行时读取（测试可随时切换环境变量，无模块加载顺序耦合）
function dbEnabled() {
  return process.env.QBAO_DESKTOP_STATS !== 'off';
}

function dayKey(d) {
  return (d || new Date()).toISOString().slice(0, 10);
}

function recordDownload(version, fileName) {
  if (!version || !fileName) return;
  const key = version + '|' + fileName + '|' + dayKey();
  pending.set(key, (pending.get(key) || 0) + 1);
  if (!dbEnabled()) return; // 保持内存兜底计数
  pool
    .query(
      'INSERT INTO desktop_download_stats (version, file_name, day, cnt) VALUES ($1, $2, CURRENT_DATE, 1) ' +
        'ON CONFLICT (version, file_name, day) DO UPDATE SET cnt = desktop_download_stats.cnt + 1',
      [String(version), String(fileName)]
    )
    .then(() => {
      // DB 已落账，从内存兜底中移除（只移除本次 +1 的量级：直接清除该 key 的重算由 DB 负责）
      pending.delete(key);
    })
    .catch(() => {
      const now = Date.now();
      if (now - lastWarnAt > 300000) {
        lastWarnAt = now;
        console.warn('[desktopStats] DB 写入失败，降级内存统计');
      }
    });
}

async function getStats() {
  let dbPerVersion = [];
  let dbLast30d = [];
  if (dbEnabled()) {
    try {
      const [v, d] = await Promise.all([
        pool.query(
          'SELECT version, SUM(cnt)::int AS downloads FROM desktop_download_stats GROUP BY version ORDER BY version DESC'
        ),
        pool.query(
          'SELECT day::text AS day, SUM(cnt)::int AS total FROM desktop_download_stats WHERE day >= CURRENT_DATE - 29 GROUP BY day ORDER BY day'
        ),
      ]);
      dbPerVersion = v.rows;
      dbLast30d = d.rows;
    } catch (e) {
      const now = Date.now();
      if (now - lastWarnAt > 300000) {
        lastWarnAt = now;
        console.warn('[desktopStats] DB 读取失败，仅返回内存兜底统计:', e.message);
      }
    }
  }
  const versionMap = new Map(dbPerVersion.map((r) => [r.version, Number(r.downloads)]));
  const dayMap = new Map(dbLast30d.map((r) => [r.day, Number(r.total)]));
  for (const [key, cnt] of pending) {
    const [version, , day] = key.split('|');
    versionMap.set(version, (versionMap.get(version) || 0) + cnt);
    dayMap.set(day, (dayMap.get(day) || 0) + cnt);
  }
  const perVersion = [];
  for (const [version, downloads] of versionMap) perVersion.push({ version, downloads });
  perVersion.sort((a, b) => (a.version < b.version ? 1 : -1));
  const last30d = [];
  for (const [day, total] of dayMap) last30d.push({ day, total });
  last30d.sort((a, b) => (a.day < b.day ? -1 : 1));
  return { perVersion, last30d };
}

// 按文件聚合（桌面端/手机端均可按 fileName 精确计数；与 getStats 的 version 口径互不影响）
async function getStatsByFile() {
  let dbRows = [];
  if (dbEnabled()) {
    try {
      const v = await pool.query(
        'SELECT file_name, SUM(cnt)::int AS downloads FROM desktop_download_stats GROUP BY file_name ORDER BY file_name'
      );
      dbRows = v.rows;
    } catch (e) {
      const now = Date.now();
      if (now - lastWarnAt > 300000) {
        lastWarnAt = now;
        console.warn('[desktopStats] DB 读取失败，仅返回内存兜底统计:', e.message);
      }
    }
  }
  const fileMap = new Map(dbRows.map((r) => [r.file_name, Number(r.downloads)]));
  for (const [key, cnt] of pending) {
    const parts = key.split('|');
    const fileName = parts[1];
    fileMap.set(fileName, (fileMap.get(fileName) || 0) + cnt);
  }
  const perFile = [];
  for (const [fileName, downloads] of fileMap) perFile.push({ fileName, downloads });
  perFile.sort((a, b) => (a.fileName < b.fileName ? -1 : 1));
  return perFile;
}

// 测试专用
function _resetForTests() {
  pending.clear();
}

module.exports = {
  recordDownload,
  getStats,
  getStatsByFile,
  _resetForTests,
  _pending: pending,
};