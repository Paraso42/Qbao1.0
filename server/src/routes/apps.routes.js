'use strict';

// Qbao 手机端（Android / iOS）统一分发 API（v1 · manifest-first，与桌面端同一份 downloads/manifest.json）
// 数据源：manifest.json 的 platforms 段（scripts/publish-mobile.js 生成，服务器只读）。
// 端点（公开、无鉴权；GET 路由自动支持 HEAD）：
//   GET /api/v1/apps/manifest?platform=android|ios   版本清单（最新在前，含 retracted）
//   GET /api/v1/apps/download?platform=&file=         按文件下载（缺省 400；Range/断点续传）
//   GET /api/v1/apps/stats?platform=                  该平台各安装包下载次数（perFile，无 PII）
// 纪律：与桌面端一致——清单文件必须存在、retracted 下载 → 410；计数仅记 200 完整请求。

const fs = require('fs');
const {
  PLATFORMS,
  MOBILE_FILE_RE,
  tryGetManifest,
  mobileReleasesOf,
  findMobileReleaseByFile,
  mobileFilePathOf,
} = require('../services/desktopManifest');
const statsService = require('../services/desktopStats');

function serializeRelease(r) {
  return {
    version: r.version,
    fileName: r.fileName,
    sizeBytes: r.sizeBytes,
    sha256: r.sha256,
    releaseDate: r.releaseDate,
    releaseNotes: r.releaseNotes || [],
    retracted: r.retracted ? { reason: r.retracted.reason, at: r.retracted.at || null } : null,
  };
}

function platformOfQuery(q) {
  return String(q || '').trim().toLowerCase();
}

function filePrefixOf(platform) {
  return platform === 'ios' ? 'Qbao-iOS-' : 'Qbao-Android-';
}

module.exports = function appsRoutes(app) {
  // —— 版本清单 ——
  app.get('/api/v1/apps/manifest', (req, res) => {
    const platform = platformOfQuery(req.query.platform);
    if (!PLATFORMS.includes(platform)) {
      return res.status(400).json({ ok: false, error: '未知平台（可选 android|ios）' });
    }
    const { manifest } = tryGetManifest();
    if (!manifest || !manifest.platforms) {
      return res.status(404).json({ ok: false, error: '手机端安装包暂未发布，请稍后再试' });
    }
    const list = mobileReleasesOf(platform) || [];
    if (!list.length) {
      return res.status(404).json({ ok: false, error: '该平台安装包暂未发布，请稍后再试' });
    }
    res.json({ ok: true, platform, releases: list.map(serializeRelease) });
  });

  // —— 下载（Range/断点续传；计数仅完整请求）——
  app.get('/api/v1/apps/download', (req, res) => {
    const platform = platformOfQuery(req.query.platform);
    if (!PLATFORMS.includes(platform)) {
      return res.status(400).json({ ok: false, error: '未知平台' });
    }
    const fileParam = String(req.query.file || '').trim();
    if (!MOBILE_FILE_RE.test(fileParam)) {
      return res.status(404).json({ ok: false, error: '安装包不存在' });
    }
    const { manifest } = tryGetManifest();
    if (!manifest) {
      return res.status(404).json({ ok: false, error: '安装包暂未发布，请稍后再试' });
    }
    const hit = findMobileReleaseByFile(platform, fileParam);
    if (!hit) {
      return res.status(404).json({ ok: false, error: '安装包不存在' });
    }
    if (hit.retracted) {
      return res.status(410).json({ ok: false, error: '该版本安装包已被撤回，请下载其他版本' });
    }
    const abs = mobileFilePathOf(platform, hit.fileName);
    if (!fs.existsSync(abs)) {
      return res.status(404).json({ ok: false, error: '安装包文件缺失' });
    }
    res.on('finish', () => {
      if (req.method === 'GET' && res.statusCode === 200 && !req.headers.range) {
        statsService.recordDownload(hit.version, hit.fileName);
      }
    });
    res.sendFile(abs, {
      headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Disposition': 'attachment; filename="' + hit.fileName + '"',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    }, (err) => {
      if (!err) return;
      if (!res.headersSent) {
        res.status(err.code === 'ENOENT' ? 404 : 500).json({ ok: false, error: '安装包读取失败' });
      } else {
        res.end();
      }
    });
  });

  // —— 该平台下载统计（perFile，无 PII）——
  app.get('/api/v1/apps/stats', async (req, res) => {
    const platform = platformOfQuery(req.query.platform);
    if (!PLATFORMS.includes(platform)) {
      return res.status(400).json({ ok: false, error: '未知平台' });
    }
    try {
      const all = await statsService.getStatsByFile();
      const prefix = filePrefixOf(platform);
      const perFile = all.filter((r) => String(r.fileName).startsWith(prefix));
      res.json({ ok: true, platform, perFile });
    } catch (e) {
      res.status(500).json({ ok: false, error: '统计服务暂不可用' });
    }
  });
};
