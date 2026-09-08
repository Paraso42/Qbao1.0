'use strict';

// Qbao 手机端安装包发布工具（v1 · 零第三方依赖，与 publish-installer.js 共用 installer-lib）
// 用法：
//   node scripts/publish-mobile.js add --platform android|ios --dir <暂存目录> [--channel stable|beta] [--notes "一行"] [--force] [--root ./downloads]
//   渠道纪律：默认 stable（禁 prerelease 版本号）；--channel beta 允许 X.Y.Z-beta.N 并写入 channel=beta（下载页/下载中心单列「内测版」，用户自选）
//   node scripts/publish-mobile.js retract --platform android|ios --version X.Y.Z --reason "原因"
//   node scripts/publish-mobile.js ls [--platform android|ios]
//   node scripts/publish-mobile.js verify --file <apk> [--sha256 <期望值>]
// 说明：
//   - 文件名约定 Qbao-Android-<v>.apk / Qbao-iOS-<v>.ipa（版本号不带 -beta 等 prerelease，stable 纪律）；
//   - manifest.json 将被升级为 schemaVersion 2（channels 保留给桌面端，platforms 新增手机端）；
//   - 每次写入前滚动备份 manifest.json.bak；--root 需与服务器 QBAO_DESKTOP_DIR 一致。
const fs = require('fs');
const path = require('path');
const lib = require('./installer-lib');

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('--')) {
        out[key] = next;
        i += 1;
      } else {
        out[key] = true;
      }
    } else {
      out._.push(a);
    }
  }
  return out;
}

function fail(msg) {
  console.error('[publish-mobile] 错误: ' + msg);
  process.exit(1);
}

function resolveRoot(root) {
  return path.resolve(root || path.join(process.cwd(), 'downloads'));
}

function platformOf(opts) {
  const pf = String(opts.platform || '').toLowerCase();
  if (!lib.PLATFORMS.includes(pf)) fail('未知平台: ' + opts.platform + '（可选 android|ios）');
  return pf;
}

function breakdown(list) {
  return list.map((r) => {
    const marks = [];
    if (r.retracted) marks.push('已撤回');
    if (r.channel === 'beta') marks.push('内测');
    marks.push(r.version);
    return '  ' + marks.join(' ') + '  ' + r.fileName;
  }).join('\n');
}

function ensureManifestV2(m) {
  if (m.schemaVersion === 1) m.schemaVersion = 2;
  if (!m.platforms) m.platforms = { android: { releases: [] }, ios: { releases: [] } };
  for (const pf of lib.PLATFORMS) {
    if (!m.platforms[pf]) m.platforms[pf] = { releases: [] };
    if (!Array.isArray(m.platforms[pf].releases)) m.platforms[pf].releases = [];
  }
  return m;
}

// ================= add =================
async function cmdAdd(opts) {
  const root = resolveRoot(opts.root);
  const platform = platformOf(opts);
  const channel = String(opts.channel || 'stable').toLowerCase();
  if (!['stable', 'beta'].includes(channel)) fail('未知渠道: ' + opts.channel + '（可选 stable|beta）');
  const dir = path.resolve(String(opts.dir || ''));
  if (!dir || !fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) fail('--dir 暂存目录不存在: ' + dir);
  const ext = platform === 'ios' ? '.ipa' : '.apk';
  const wantPrefix = 'Qbao-' + (platform === 'ios' ? 'iOS' : 'Android') + '-';

  let fileAbs = null;
  let fileName = null;
  for (const n of fs.readdirSync(dir)) {
    const abs = path.join(dir, n);
    if (!fs.statSync(abs).isFile()) continue;
    if (n.startsWith(wantPrefix) && n.toLowerCase().endsWith(ext)) {
      if (fileAbs) fail('暂存目录存在多个 ' + ext + '，请仅放置一个');
      fileAbs = abs;
      fileName = n;
    }
  }
  if (!fileAbs) fail('暂存目录缺少 ' + wantPrefix + '<版本>' + ext + ' 文件');
  const m = lib.MOBILE_FILE_RE.exec(fileName);
  const version = m[2];
  if (!lib.VERSION_RE.test(version)) fail('非法版本号: ' + version);
  if (lib.isPrerelease(version) && channel !== 'beta') fail('手机端 stable 暂不支持 prerelease 版本: ' + version + '（内测请用 --channel beta）');

  const manifest = lib.loadManifest(root);
  ensureManifestV2(manifest);
  const entry = lib.platformOf(manifest, platform);
  const existing = entry.releases.find((r) => r.version === version);
  if (existing && !opts.force) fail('平台 ' + platform + ' 已存在版本 ' + version + '（如需覆盖请加 --force）');
  const highest = entry.releases.length ? entry.releases.reduce((a, b) => (lib.compareVersions(b.version, a.version) > 0 ? b : a)).version : null;
  // 内测（beta）版本与稳定版各自独立命名空间，不与 stable 最高版本比较；stable 仍须高于现有最高版本
  if (channel !== 'beta' && highest && !existing && lib.compareVersions(version, highest) <= 0 && !opts.force) {
    fail('版本 ' + version + ' 不高于平台现有最高版本 ' + highest + '（如需降级/重发请加 --force）');
  }

  const sha256 = await lib.sha256File(fileAbs);
  const sizeBytes = fs.statSync(fileAbs).size;
  fs.mkdirSync(path.join(root, platform), { recursive: true });
  fs.copyFileSync(fileAbs, path.join(root, platform, fileName));

  const rec = {
    version,
    fileName,
    sizeBytes,
    sha256,
    releaseDate: new Date().toISOString(),
    releaseNotes: opts.notes ? [String(opts.notes)] : [],
    retracted: null,
    channel: channel === 'beta' ? 'beta' : undefined,
  };
  if (existing) {
    const idx = entry.releases.indexOf(existing);
    entry.releases[idx] = rec;
  } else {
    entry.releases.push(rec);
  }
  entry.releases = lib.sortReleasesDesc(entry.releases);
  lib.saveManifestAtomic(root, manifest);
  console.log('[publish-mobile] 已发布 ' + platform + ' (' + channel + ') v' + version + ' → ' + fileName);
  console.log('  sha256: ' + sha256);
  console.log('  size: ' + sizeBytes + ' B');
}

// ================= retract =================
function cmdRetract(opts) {
  const root = resolveRoot(opts.root);
  const platform = platformOf(opts);
  const version = String(opts.version || '');
  if (!lib.VERSION_RE.test(version)) fail('非法版本号: ' + version);
  const reason = String(opts.reason || '').trim();
  if (!reason) fail('--reason 撤回原因不能为空');
  const manifest = lib.loadManifest(root);
  ensureManifestV2(manifest);
  const hit = lib.findPlatformRelease(manifest, platform, version);
  if (!hit) fail('平台 ' + platform + ' 不存在版本 ' + version);
  if (hit.retracted) fail('版本 ' + version + ' 已是撤回状态');
  hit.retracted = { reason, at: new Date().toISOString() };
  const entry = lib.platformOf(manifest, platform);
  entry.releases = lib.sortReleasesDesc(entry.releases);
  lib.saveManifestAtomic(root, manifest);
  console.log('[publish-mobile] 已撤回 ' + platform + ' v' + version + '：' + reason);
}

// ================= ls =================
function cmdLs(opts) {
  const root = resolveRoot(opts.root);
  const pf = String(opts.platform || '').toLowerCase();
  if (pf && !lib.PLATFORMS.includes(pf)) fail('未知平台: ' + pf);
  const manifest = lib.loadManifest(root);
  const platforms = pf ? [pf] : lib.PLATFORMS;
  for (const p of platforms) {
    const entry = manifest.platforms && manifest.platforms[p];
    const list = (entry && entry.releases) || [];
    console.log('[' + p + '] 共 ' + list.length + ' 个版本');
    if (list.length) console.log(breakdown(lib.sortReleasesDesc(list)));
  }
}

// ================= verify =================
async function cmdVerify(opts) {
  const file = path.resolve(String(opts.file || ''));
  if (!file || !fs.existsSync(file)) fail('--file 不存在: ' + file);
  const sha256 = await lib.sha256File(file);
  console.log('sha256: ' + sha256);
  if (opts.sha256) {
    const want = String(opts.sha256).toLowerCase();
    if (want !== sha256) fail('哈希不匹配（期望 ' + want + '）');
    console.log('匹配期望值 ✓');
  }
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const cmd = opts._[0];
  if (cmd === 'add') await cmdAdd(opts);
  else if (cmd === 'retract') cmdRetract(opts);
  else if (cmd === 'ls') cmdLs(opts);
  else if (cmd === 'verify') await cmdVerify(opts);
  else {
    console.log('用法: node scripts/publish-mobile.js add|retract|ls|verify ...（详见文件头注释）');
    process.exit(1);
  }
}

main().catch((e) => {
  console.error('[publish-mobile] 未预期错误: ' + (e && e.message));
  process.exit(1);
});
