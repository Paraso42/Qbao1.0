'use strict';

// 桌面端统一分发 API（v2 · manifest-first，v3.35）
// 数据源：downloads/manifest.json（scripts/publish-installer.js 生成，服务器只读）。
// 端点（公开、无鉴权；GET 路由自动支持 HEAD）：
//   GET /api/v1/desktop/manifest?channel=stable|beta  版本清单（latest 在前，含 required/retracted/stopped）
//   GET /api/v1/desktop/latest                         旧版兼容：最新稳定版元信息（字段不变）
//   GET /api/v1/desktop/download?file=<fileName>       按文件下载（缺省=最新稳定版；Range/断点续传）
//   GET /api/v1/desktop/update/:channel/latest.yml     桌面端 generic feed（electron-updater）
//   GET /api/v1/desktop/update/:channel/:file          exe / *.exe.blockmap（差分更新）
//   GET /api/v1/desktop/stats                          下载统计（版本×日 聚合，无 PII）
//   GET /dl                                            公开下载落地页（中国大陆镜像站点）
//   GET /download                                      短链 → /api/v1/desktop/download
// 纪律：retracted 版本下载 → 410；stable 禁止 prerelease、beta 禁止 required/retracted（服务层强校验）；
//       下载计数仅记 HTTP 200 完整请求（206 分片续传不重复计）。

const fs = require('fs');
const path = require('path');
const {
  CHANNELS,
  NAME_RE,
  downloadsDir,
  tryGetManifest,
  releasesOf,
  topOf,
  latestRequired,
  isStopped,
  findReleaseByFile,
  filePathOf,
} = require('../services/desktopManifest');
const statsService = require('../services/desktopStats');

function esc(s) {
  return String(s === null || s === undefined ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatBytes(n) {
  const num = Number(n);
  if (!Number.isFinite(num) || num <= 0) return '—';
  if (num >= 1073741824) return (num / 1073741824).toFixed(2) + ' GB';
  if (num >= 1048576) return (num / 1048576).toFixed(1) + ' MB';
  if (num >= 1024) return Math.round(num / 1024) + ' KB';
  return num + ' B';
}

function formatDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const p = (x) => String(x).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}

function serializeRelease(channel, r) {
  return {
    version: r.version,
    fileName: r.fileName,
    sizeBytes: r.sizeBytes,
    sha256: r.sha256,
    releaseDate: r.releaseDate,
    releaseNotes: r.releaseNotes || [],
    required: r.required || null,
    retracted: r.retracted ? { reason: r.retracted.reason, at: r.retracted.at || null } : null,
    stopped: isStopped(channel, r),
  };
}

module.exports = function desktopRoutes(app) {
  // —— 版本清单 ——
  app.get('/api/v1/desktop/manifest', (req, res) => {
    const channel = String(req.query.channel || 'stable');
    if (!CHANNELS.includes(channel)) {
      return res.status(400).json({ ok: false, error: '未知渠道' });
    }
    const { manifest } = tryGetManifest();
    if (!manifest) {
      return res.status(404).json({ ok: false, error: '桌面端安装包暂未发布，请稍后再试' });
    }
    const list = releasesOf(channel) || [];
    res.json({
      ok: true,
      channel,
      required: latestRequired(channel),
      releases: list.map((r) => serializeRelease(channel, r)),
    });
  });

  // —— 旧版兼容：最新稳定版元信息 ——
  app.get('/api/v1/desktop/latest', (req, res) => {
    const { manifest } = tryGetManifest();
    if (!manifest) {
      return res.status(404).json({ ok: false, error: '桌面端安装包暂未发布，请稍后再试' });
    }
    const top = topOf('stable');
    if (!top) {
      return res.status(404).json({ ok: false, error: '桌面端安装包暂未发布，请稍后再试' });
    }
    res.json({
      ok: true,
      version: top.version,
      fileName: top.fileName,
      sizeBytes: top.sizeBytes,
      sha256: top.sha256,
      publishedAt: top.releaseDate,
      downloadUrl: '/api/v1/desktop/download',
    });
  });

  // —— 下载：缺省最新稳定版；file= 精确下载（Range/断点续传）——
  app.get('/api/v1/desktop/download', (req, res) => {
    const { manifest } = tryGetManifest();
    if (!manifest) {
      return res.status(404).json({ ok: false, error: '桌面端安装包暂未发布，请稍后再试' });
    }
    const fileParam = String(req.query.file || '').trim();
    let hit = null;
    if (fileParam) {
      if (!NAME_RE.test(fileParam)) {
        return res.status(404).json({ ok: false, error: '安装包不存在' });
      }
      hit = findReleaseByFile(fileParam);
      if (!hit) {
        return res.status(404).json({ ok: false, error: '安装包不存在' });
      }
    } else {
      const top = topOf('stable');
      if (!top) {
        return res.status(404).json({ ok: false, error: '桌面端安装包暂未发布，请稍后再试' });
      }
      hit = { channel: 'stable', release: top };
    }
    const { channel, release } = hit;
    if (release.retracted) {
      return res.status(410).json({ ok: false, error: '该版本安装包已被撤回，请下载其他版本' });
    }
    const abs = filePathOf(channel, release.fileName);
    if (!fs.existsSync(abs)) {
      return res.status(404).json({ ok: false, error: '安装包文件缺失' });
    }
    res.on('finish', () => {
      if (req.method === 'GET' && res.statusCode === 200 && !req.headers.range) {
        statsService.recordDownload(release.version, release.fileName);
      }
    });
    res.sendFile(abs, {
      headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Disposition': 'attachment; filename="' + release.fileName + '"',
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

  // —— 桌面端 generic feed：latest.yml ——
  app.get('/api/v1/desktop/update/:channel/latest.yml', (req, res) => {
    if (!CHANNELS.includes(req.params.channel)) {
      return res.status(404).json({ ok: false, error: '未知渠道' });
    }
    const abs = path.join(downloadsDir(), req.params.channel, 'latest.yml');
    if (!fs.existsSync(abs)) {
      return res.status(404).json({ ok: false, error: '更新源尚未就绪' });
    }
    res.type('text/yaml');
    res.set('Cache-Control', 'no-cache');
    res.sendFile(abs, (err) => {
      if (err && !res.headersSent) res.status(404).end();
    });
  });

  // —— 桌面端 generic feed：exe / blockmap（差分更新）——
  app.get('/api/v1/desktop/update/:channel/:file', (req, res) => {
    const channel = req.params.channel;
    if (!CHANNELS.includes(channel)) {
      return res.status(404).json({ ok: false, error: '未知渠道' });
    }
    const name = String(req.params.file || '');
    if (!/^[A-Za-z0-9._-]+$/.test(name)) {
      return res.status(404).json({ ok: false, error: '文件不存在' });
    }
    const isExe = name.endsWith('.exe');
    const isBlockmap = name.endsWith('.exe.blockmap');
    if (!isExe && !isBlockmap) {
      return res.status(404).json({ ok: false, error: '文件不存在' });
    }
    const target = isExe ? name : name.slice(0, -'.blockmap'.length);
    const list = releasesOf(channel) || [];
    if (!list.some((r) => r.fileName === target)) {
      return res.status(404).json({ ok: false, error: '文件不存在' });
    }
    const abs = path.join(downloadsDir(), channel, name);
    if (!fs.existsSync(abs)) {
      return res.status(404).json({ ok: false, error: '文件缺失' });
    }
    res.set('Content-Type', 'application/octet-stream');
    res.set('Cache-Control', 'public, max-age=300');
    res.sendFile(abs, (err) => {
      if (err && !res.headersSent) res.status(404).end();
    });
  });

  // —— 下载统计（公开聚合，无 PII）——
  app.get('/api/v1/desktop/stats', async (req, res) => {
    try {
      const s = await statsService.getStats();
      res.json({ ok: true, perVersion: s.perVersion, last30d: s.last30d });
    } catch (e) {
      res.status(500).json({ ok: false, error: '统计服务暂不可用' });
    }
  });

  // —— 公开下载落地页（多端：Windows / Android / iOS；UA 自动推荐设备；无框架、无用户数据）——
  app.get('/dl', (req, res) => {
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('Referrer-Policy', 'no-referrer');
    res.set('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'");
    const wantPlat = String(req.query.platform || '').toLowerCase();
    const ua = String(req.headers['user-agent'] || '');
    let platform = 'windows';
    if (['windows', 'android', 'ios'].includes(wantPlat)) platform = wantPlat;
    else if (/android/i.test(ua)) platform = 'android';
    else if (/iphone|ipad|ipod/i.test(ua)) platform = 'ios';
    const { manifest } = tryGetManifest();
    if (platform === 'windows') {
      const want = String(req.query.channel || 'stable');
      const channel = CHANNELS.includes(want) ? want : 'stable';
      const hasBeta = !!(manifest && manifest.channels && manifest.channels.beta && manifest.channels.beta.releases.length > 0);
      const list = manifest ? releasesOf(channel) : null;
      return res.type('html').send(dlPageWindows(channel, list || [], manifest ? latestRequired(channel) : null, hasBeta));
    }
    const pdata = (manifest && manifest.platforms && manifest.platforms[platform]) ? manifest.platforms[platform].releases : [];
    return res.type('html').send(mobileDlPage(platform, pdata || []));
  });

  // —— 短链：/download → 最新桌面安装包 ——
  app.get('/download', (req, res) => {
    res.redirect(302, '/api/v1/desktop/download');
  });
};

// ================= 落地页渲染（纯拼接，不经模板引擎） =================

function dlTabsHtml(current) {
  const defs = [
    { id: 'windows', label: 'Windows 桌面版', href: '/dl' },
    { id: 'android', label: 'Android', href: '/dl?platform=android' },
    { id: 'ios', label: 'iOS', href: '/dl?platform=ios' },
  ];
  return '<div class="plat-tabs">' + defs.map(function (d) {
    const act = d.id === current ? ' active' : '';
    return '<a class="plat-tab' + act + '" href="' + d.href + '">' + d.label + '</a>';
  }).join('') + '</div>';
}

// —— Windows 桌面版页（原结构保留；顶部加多端页签；beta 由 query 切换） ——
function dlPageWindows(channel, releases, required, hasBeta) {
  const isBeta = channel === 'beta';
  const top = releases.find(function (r) { return !r.retracted; }) || releases[0] || null;
  const rows = releases.map(function (r, i) { return winReleaseRow(r, i === 0 && !r.retracted); }).join('\n');
  const betaBanner = isBeta
    ? '<div class="warn">测试版（beta）仅用于提前验证新功能，可能存在缺陷，不提供强制更新保障。正式使用请安装稳定版。</div>'
    : '';
  const reqNote = required
    ? '<div class="note">提示：低于 <b>' + esc(required) + '</b> 的旧版本已与当前服务器不兼容（标记「已停止服务」），请升级后使用。</div>'
    : '';
  const hero = top
    ? '<div class="hero"><div class="hero-ver">Qbao 桌面版 <b>' + esc(top.version) + '</b>'
        + (isBeta ? ' <span class="badge badge-beta">测试版</span>' : ' <span class="badge badge-stable">稳定版</span>')
        + '</div><div class="hero-meta">' + formatBytes(top.sizeBytes) + ' · 更新于 ' + formatDate(top.releaseDate) + ' · Windows 10/11 x64</div>'
        + '<a class="btn-download" href="/api/v1/desktop/download?file=' + encodeURIComponent(top.fileName) + '">立即下载</a>'
        + '<div class="hero-sha">SHA256：<code class="sha">' + esc(top.sha256) + '</code>'
        + ' <button class="btn-copy" data-copy="' + esc(top.sha256) + '" onclick="copySha(this)">复制</button></div></div>'
    : '<div class="hero"><div class="hero-ver">桌面版安装包暂未发布</div></div>';
  const chLine = hasBeta
    ? (isBeta
        ? '<p class="channel-line">当前展示测试版（beta）渠道。<a href="/dl">返回稳定版下载</a></p>'
        : '<p class="channel-line">如需体验最新测试功能，可查看 <a href="/dl?channel=beta">测试版渠道</a>（仅供测试，使用风险自负）</p>')
    : '';
  const body = betaBanner + reqNote
    + '<div class="card">' + hero + chLine + '</div>'
    + '<div class="card"><h2>历史版本（均支持覆盖安装，旧数据保留）</h2>'
    + '<table><tr><th>版本</th><th>状态</th><th>大小</th><th>更新日期</th><th>操作</th></tr>' + rows + '</table>'
    + '<p class="sub" style="margin-top:10px">覆盖安装（降级/重装）不会影响您的数据：账号数据云端同步，本地配置保留。</p>' + '</div>'
    + '<div class="card"><h2>校验安装包完整性</h2>'
    + '<ol>'
    + '<li>下载完成后，在安装包所在目录打开 PowerShell，执行：<br><code>Get-FileHash .\\Qbao-Setup-*.exe -Algorithm SHA256</code></li>'
    + '<li>将输出值与上方对应版本的 SHA256 逐一对比，一致即完整可信（本站 HTTPS 传输 + 双重校验）。</li>'
    + '</ol></div>'
    + '<div class="card"><h2>安装与更新说明</h2><ol>'
    + '<li>已安装桌面端的用户将通过「设置 → 桌面端 → 检查更新」自动升级，无需重复下载；</li>'
    + '<li>新版本发布后，自动更新通道只提示「新版本可用」，是否更新由你决定（强制更新仅发生在服务器不再兼容旧版等必要场景并会明确提示）；</li>'
    + '<li>如某个版本出现问题，可随时回到本页下载任意旧版覆盖安装；发现问题也欢迎通过 Qbao 内的反馈入口告知管理员。</li>'
    + '</ol></div>'
    + '<div class="card"><h2>其他平台</h2><ol>'
    + '<li><a href="/dl?platform=android">Android 版下载</a>（APK，本机直装，Android 5.1+）</li>'
    + '<li><a href="/dl?platform=ios">iOS 版下载</a>（.ipa 待 macOS 签名发布；iPhone/iPad 可先用 Safari「添加到主屏幕」）</li>'
    + '</ol></div>';
  return dlChrome('Qbao 桌面版下载', '由本站服务器直接分发（中国大陆镜像），不依赖 GitHub。与网页版账号数据云端同步。', 'windows', body);
}

function winReleaseRow(r, isTop) {
  const downloadParam = 'file=' + encodeURIComponent(r.fileName);
  const statusBadge = r.retracted
    ? '<span class="badge badge-gone">已撤回</span>'
    : isTop
      ? (r.version.indexOf('-') !== -1 ? '<span class="badge badge-beta">最新测试版</span>' : '<span class="badge badge-stable">当前最新</span>')
      : r.stopped
        ? '<span class="badge badge-stop">已停止服务</span>'
        : '<span class="badge badge-old">旧版</span>';
  const action = r.retracted
    ? '<span style="color:#8c959f;font-size:12px">已下架</span>'
    : '<a class="dl-btn' + (r.stopped ? ' disabled' : '') + '" href="/api/v1/desktop/download?' + downloadParam + '">下载</a>';
  const retractNote = r.retracted ? '<div class="row-sha">撤回原因：' + esc(r.retracted.reason || '') + '</div>' : '';
  const notes = (r.releaseNotes && r.releaseNotes.length) ? '<div class="row-sha">' + r.releaseNotes.map(esc).join('；') + '</div>' : '';
  return '<tr>'
    + '<td data-label="版本"><b>' + esc(r.version) + '</b>' + statusBadge + retractNote + '</td>'
    + '<td data-label="状态">' + (r.stopped ? '与当前服务器不兼容' : '可用') + '</td>'
    + '<td data-label="大小">' + formatBytes(r.sizeBytes) + '</td>'
    + '<td data-label="更新日期">' + formatDate(r.releaseDate) + '</td>'
    + '<td data-label="操作">' + action
    + '<div class="row-sha">SHA256<br><code class="sha">' + esc(r.sha256) + '</code>'
    + ' <button class="btn-copy" data-copy="' + esc(r.sha256) + '" onclick="copySha(this)">复制</button></div>'
    + notes + '</td>'
    + '</tr>';
}
const DL_CSS = [
  'body{margin:0;font-family:"Microsoft YaHei",system-ui,sans-serif;background:#f5f7fb;color:#24292f}',
  '.wrap{max-width:860px;margin:0 auto;padding:28px 20px 48px}',
  'h1{font-size:22px;margin:0 0 4px}',
  '.sub{color:#57606a;margin:0 0 22px;font-size:13px}',
  '.card{background:#fff;border:1px solid #e3e7ee;border-radius:10px;padding:20px;margin-bottom:18px}',
  '.hero{text-align:center;padding:26px 12px}',
  '.hero-ver{font-size:18px;margin-bottom:8px}',
  '.hero-meta{color:#57606a;font-size:13px;margin-bottom:16px}',
  '.btn-download{display:inline-block;background:#1f6feb;color:#fff;font-size:16px;padding:11px 34px;border-radius:8px;text-decoration:none;font-weight:600}',
  '.btn-download:hover{background:#1960d3}',
  '.hero-sha{margin-top:14px;font-size:12px;color:#57606a;word-break:break-all}',
  '.sha{background:#f0f2f5;padding:2px 6px;border-radius:4px;font-size:11px}',
  '.btn-copy{margin-left:6px;border:1px solid #c9cfd8;background:#fff;border-radius:5px;font-size:12px;padding:3px 10px;cursor:pointer}',
  'table{width:100%;border-collapse:collapse;font-size:13px}',
  'th{text-align:left;color:#57606a;font-weight:600;border-bottom:2px solid #e3e7ee;padding:8px 6px}',
  'td{border-bottom:1px solid #edf0f4;padding:9px 6px;vertical-align:top}',
  '.badge{display:inline-block;font-size:11px;padding:1px 8px;border-radius:20px;margin-left:6px}',
  '.badge-stable{background:#dafbe1;color:#1a7f37}',
  '.badge-beta{background:#fff8c5;color:#9a6700}',
  '.badge-gone{background:#f6f8fa;color:#57606a}',
  '.badge-old{background:#ddf4ff;color:#0969da}',
  '.badge-stop{background:#ffebe9;color:#cf222e}',
  '.dl-btn{display:inline-block;background:#1f6feb;color:#fff;font-size:12px;padding:4px 14px;border-radius:5px;text-decoration:none}',
  '.dl-btn.disabled{background:#c9cfd8;cursor:not-allowed;pointer-events:none}',
  '.row-sha{font-size:11px;color:#57606a;word-break:break-all;margin-top:4px}',
  '.warn{background:#fff8c5;border:1px solid #eac54f;color:#7d4e00;border-radius:8px;padding:10px 14px;font-size:13px;margin-bottom:18px}',
  '.note{background:#ddf4ff;border:1px solid #54aeff66;color:#0a4c7e;border-radius:8px;padding:10px 14px;font-size:13px;margin-bottom:18px}',
  '.empty-note{background:#ddf4ff;border:1px solid #54aeff66;color:#0a4c7e;border-radius:8px;padding:12px 14px;font-size:13px;line-height:1.9;margin-bottom:18px}',
  '.channel-line{font-size:13px;color:#57606a;margin:0 0 14px}',
  'h2{font-size:16px;margin:0 0 12px}',
  'ol{font-size:13px;color:#24292f;line-height:1.9;margin:0;padding-left:22px}',
  'code{background:#f0f2f5;padding:1px 5px;border-radius:4px;font-size:12px}',
  '.foot{color:#8c959f;font-size:12px;text-align:center;margin-top:26px}',
  'a{color:#1f6feb}',
  '.plat-tabs{display:flex;gap:8px;flex-wrap:wrap;margin:0 0 18px}',
  '.plat-tab{display:inline-block;padding:8px 18px;border-radius:20px;border:1px solid #c9cfd8;background:#fff;color:#24292f;font-size:14px;text-decoration:none}',
  '.plat-tab.active{background:#1f6feb;border-color:#1f6feb;color:#fff;font-weight:600}',
  '@media (max-width:640px){',
  '.wrap{padding:20px 14px 40px}',
  '.card{padding:16px}',
  '.hero{padding:20px 8px}',
  '.btn-download{display:block;width:100%;box-sizing:border-box;padding:14px 0;text-align:center;font-size:16px}',
  'table,thead,tbody,tr,th,td{display:block}',
  'thead{position:absolute;left:-9999px;top:auto}',
  'tr{background:#fff;border:1px solid #e3e7ee;border-radius:10px;margin-bottom:12px;padding:10px 12px;box-sizing:border-box}',
  'td{border:none;padding:6px 0}',
  'td::before{content:attr(data-label);display:inline-block;min-width:64px;color:#57606a;font-weight:600;font-size:12px;vertical-align:top}',
  '.dl-btn{display:inline-flex;align-items:center;justify-content:center;min-height:44px;padding:8px 16px;box-sizing:border-box}',
  '.btn-copy{padding:8px 14px;min-height:38px}',
  '}',
  '.btn-download,.dl-btn,.btn-copy,.plat-tab{touch-action:manipulation;-webkit-tap-highlight-color:transparent}'
].join('\n');

function dlChrome(title, sub, current, body) {
  return '<!DOCTYPE html>'
    + '<html lang="zh-CN"><head><meta charset="utf-8">'
    + '<meta name="viewport" content="width=device-width, initial-scale=1">'
    + '<title>' + esc(title) + '</title>'
    + '<style>' + DL_CSS + '</style></head><body><div class="wrap">'
    + dlTabsHtml(current)
    + '<h1>' + esc(title) + '</h1>'
    + '<p class="sub">' + sub + '</p>'
    + body
    + '<p class="foot">Qbao · 华东师范大学 · 本页由服务器动态渲染，与网页端「设置 → 下载中心」信息同源</p>'
    + '<script>'
    + 'function copySha(btn){'
    + '  var v=btn.getAttribute("data-copy")||"";'
    + '  var done=function(){btn.textContent="已复制";setTimeout(function(){btn.textContent="复制"},1200);};'
    + '  if(navigator.clipboard&&navigator.clipboard.writeText){'
    + '    navigator.clipboard.writeText(v).then(done,function(){fallbackCopy(v,done);});'
    + '  }else{fallbackCopy(v,done);}'
    + '}'
    + 'function fallbackCopy(v,done){'
    + '  var ta=document.createElement("textarea");ta.value=v;document.body.appendChild(ta);ta.select();'
    + '  try{document.execCommand("copy");done();}catch(e){}'
    + '  document.body.removeChild(ta);'
    + '}'
    + '</script>'
    + '</div></body></html>';
}

// —— 手机端页（android / ios，与桌面端同源 manifest 的 platforms 段） ——
function mobileDlPage(platform, releases) {
  const isIos = platform === 'ios';
  const label = isIos ? 'iOS' : 'Android';
  const stable = releases.filter(function (r) { return r.channel !== 'beta'; });
  const betas = releases.filter(function (r) { return r.channel === 'beta'; });
  const top = stable.find(function (r) { return !r.retracted; }) || stable[0] || null;
  const dlPath = '/api/v1/apps/download?platform=' + platform + '&file=';
  const rows = stable.map(function (r, i) { return mobileReleaseRow(dlPath, r, i === 0 && !r.retracted); }).join('\n');
  const betaCard = betas.length
    ? '<div class="card"><h2>Qbao 内测版（' + label + '）<span class="badge badge-beta">Beta</span></h2>'
      + '<p class="sub">内测版连接独立的内测环境（与正式版数据互不相通），用于提前体验新功能与反馈问题；应用标识与正式版不同，可与正式版共存安装。日常使用请选择正式版。</p>'
      + '<table><tr><th>版本</th><th>状态</th><th>大小</th><th>更新日期</th><th>操作</th></tr>'
      + betas.map(function (r, i) { return mobileBetaRow(dlPath, r, i === 0); }).join('\n')
      + '</table></div>'
    : '';
  const emptyNote = top ? '' : isIos
    ? '<div class="empty-note"><b>iOS 安装包尚未发布。</b>iOS 包需在 macOS 上使用 Xcode + Apple Developer 账号签名后分发（TestFlight / 企业签名）。发布就绪后本页会直接提供下载与 SHA256。当前 iPhone / iPad 用户可先用 Safari 打开本站，通过「分享 → 添加到主屏幕」获得全屏 App 入口；账号数据与网页版 / 桌面版 / Android 版云端同步。</div>'
    : '<div class="empty-note">Android 安装包尚未发布，请稍后再来。发布后本页将直接提供 APK 下载与 SHA256 校验值。</div>';
  const hero = top
    ? '<div class="hero"><div class="hero-ver">Qbao ' + label + ' 版 <b>' + esc(top.version) + '</b> <span class="badge badge-stable">稳定版</span></div>'
        + '<div class="hero-meta">' + formatBytes(top.sizeBytes) + ' · 更新于 ' + formatDate(top.releaseDate) + (isIos ? '' : ' · Android 5.1+') + '</div>'
        + '<a class="btn-download" href="' + dlPath + encodeURIComponent(top.fileName) + '">立即下载</a>'
        + '<div class="hero-sha">SHA256：<code class="sha">' + esc(top.sha256) + '</code>'
        + ' <button class="btn-copy" data-copy="' + esc(top.sha256) + '" onclick="copySha(this)">复制</button></div></div>'
    : '<div class="hero"><div class="hero-ver">' + label + ' 版安装包暂未发布</div></div>';
  const history = stable.length
    ? '<div class="card"><h2>历史版本（覆盖安装保留数据）</h2>'
        + '<table><tr><th>版本</th><th>状态</th><th>大小</th><th>更新日期</th><th>操作</th></tr>' + rows + '</table></div>'
    : '';
  const guide = isIos
    ? '<div class="card"><h2>iOS 安装说明（发布后）</h2><ol>'
        + '<li>点击「立即下载」获取 .ipa（需已在 Apple 侧完成签名）；</li>'
        + '<li>未上架 App Store 前，需通过 TestFlight 或企业证书信任安装；</li>'
        + '<li>账号数据与网页版 / 桌面版 / Android 版云端同步。</li></ol></div>'
    : '<div class="card"><h2>Android 安装说明</h2><ol>'
        + '<li>手机浏览器打开本页点击「立即下载」，下载 .apk（Android 5.1 及以上）；</li>'
        + '<li>安装时如提示「未知来源」，请允许本次安装；</li>'
        + '<li>覆盖安装不影响数据；账号数据与网页版 / 桌面版 / iOS 版云端同步。</li></ol></div>';
  const body = emptyNote + hero + betaCard + history + guide
    + '<div class="card"><h2>其他平台</h2><ol>'
    + '<li><a href="/dl">Windows 桌面版下载</a>（独立窗口 + 自动更新）</li>'
    + (isIos ? '<li><a href="/dl?platform=android">Android 版下载</a>（APK，本机直装）</li>' : '<li><a href="/dl?platform=ios">iOS 版下载</a>（.ipa 待 macOS 签名发布；iPhone/iPad 可先用 Safari「添加到主屏幕」）</li>')
    + '</ol></div>';
  return dlChrome('Qbao ' + label + ' 版下载', '由本站服务器直接分发（中国大陆镜像）。与网页版账号数据云端同步，多端一致。', platform, body);
}

function mobileBetaRow(dlPath, r, isNewest) {
  const badge = isNewest ? '<span class="badge badge-beta">内测最新</span>' : '<span class="badge badge-beta">内测版</span>';
  const notes = (r.releaseNotes && r.releaseNotes.length) ? '<div class="row-sha">' + r.releaseNotes.map(esc).join('；') + '</div>' : '';
  return '<tr>'
    + '<td data-label="版本"><b>' + esc(r.version) + '</b>' + badge + '</td>'
    + '<td data-label="状态">可用（内测）</td>'
    + '<td data-label="大小">' + formatBytes(r.sizeBytes) + '</td>'
    + '<td data-label="更新日期">' + formatDate(r.releaseDate) + '</td>'
    + '<td data-label="操作"><a class="dl-btn" href="' + dlPath + encodeURIComponent(r.fileName) + '">下载</a>'
    + '<div class="row-sha">SHA256<br><code class="sha">' + esc(r.sha256) + '</code>'
    + ' <button class="btn-copy" data-copy="' + esc(r.sha256) + '" onclick="copySha(this)">复制</button></div>'
    + notes + '</td></tr>';
}

function mobileReleaseRow(dlPath, r, isTop) {
  const statusBadge = r.retracted
    ? '<span class="badge badge-gone">已撤回</span>'
    : isTop ? '<span class="badge badge-stable">当前最新</span>'
    : r.channel === 'beta' ? '<span class="badge badge-beta">内测版</span>'
    : '<span class="badge badge-old">旧版</span>';
  const action = r.retracted
    ? '<span style="color:#8c959f;font-size:12px">已下架</span>'
    : '<a class="dl-btn" href="' + dlPath + encodeURIComponent(r.fileName) + '">下载</a>';
  const retractNote = r.retracted ? '<div class="row-sha">撤回原因：' + esc(r.retracted.reason || '') + '</div>' : '';
  const notes = (r.releaseNotes && r.releaseNotes.length) ? '<div class="row-sha">' + r.releaseNotes.map(esc).join('；') + '</div>' : '';
  return '<tr>'
    + '<td data-label="版本"><b>' + esc(r.version) + '</b>' + statusBadge + retractNote + '</td>'
    + '<td data-label="状态">' + (r.retracted ? '已下架' : '可用') + '</td>'
    + '<td data-label="大小">' + formatBytes(r.sizeBytes) + '</td>'
    + '<td data-label="更新日期">' + formatDate(r.releaseDate) + '</td>'
    + '<td data-label="操作">' + action
    + '<div class="row-sha">SHA256<br><code class="sha">' + esc(r.sha256) + '</code>'
    + ' <button class="btn-copy" data-copy="' + esc(r.sha256) + '" onclick="copySha(this)">复制</button></div>'
    + notes + '</td>'
    + '</tr>';
}
