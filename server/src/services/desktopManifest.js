'use strict';

// 桌面端分发清单（manifest-first，v3.35）
// downloads/manifest.json 是全部分发行为的事实源，由 scripts/publish-installer.js 生成，
// 服务器只读。结构：
//   {
//     schemaVersion: 1,
//     updatedAt: "<ISO>",
//     channels: {
//       "stable": { releases: [ <Release>, ... ] },   // 最新在前
//       "beta":   { releases: [ <Release>, ... ] }
//     }
//   }
// Release:
//   {
//     version: "3.35.0" | "3.35.0-beta.1",      // semver（beta 渠道允许 prerelease）
//     fileName: "Qbao-Setup-3.35.0.exe",
//     sizeBytes: 85382880,
//     sha256: "<hex64>",
//     sha512: "<base64(64B)>",                   // 必须与渠道目录内 latest.yml 一致（由发布工具交叉校验）
//     releaseDate: "<ISO>",
//     releaseNotes: ["..."],
//     required: null | "Y.Y.Y",                  // 强制升级门槛（仅 stable 可设置）
//     retracted: null | { reason, at }           // 维护者事后撤回（stable 专用；beta 禁止）
//   }
//
// 纪律（工具与服务端双重强制）：
//   - beta 渠道 release 不得携带 required / retracted（此处加载即拒绝）；
//   - 非空渠道必须存在 latest.yml（桌面端 generic feed 依赖）；
//   - 所有 release 引用的 exe 必须实际存在，否则视为清单损坏。

const fs = require('fs');
const path = require('path');

const CHANNELS = ['stable', 'beta'];

// 手机端平台与文件名（Qbao-Android-<v>.apk / Qbao-iOS-<v>.ipa；暂只支持 stable 纪律）
const PLATFORMS = ['android', 'ios'];
const MOBILE_FILE_RE = /^Qbao-(Android|iOS)-(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)\.(apk|ipa)$/i;

// 安装包文件名白名单（含 prerelease 后缀，如 3.35.0-beta.1）
const NAME_RE = /^Qbao-Setup-\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?\.exe$/i;
// semver（含可选的 prerelease）
const VERSION_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const SHA256_RE = /^[0-9a-f]{64}$/i;
// base64 编码的 64 字节 = 88 字符（可能带 = 填充）
const SHA512_RE = /^[A-Za-z0-9+/]{86}==?$/;

function downloadsDir() {
  // 默认 <repo根>/downloads（server/src/services 上溯三级）；位于 server/ 之外，
  // 部署清理脚本不会触碰——服务器即安装包储藏室。
  return process.env.QBAO_DESKTOP_DIR || path.join(__dirname, '..', '..', '..', 'downloads');
}

// —— semver 比较（含 prerelease：无 prerelease > 有 prerelease）——
function compareVersions(a, b) {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  for (let i = 0; i < 3; i++) {
    if (pa.nums[i] !== pb.nums[i]) return pa.nums[i] - pb.nums[i];
  }
  // 主版本号相同：比较 prerelease
  if (pa.pre === null && pb.pre === null) return 0;
  if (pa.pre === null) return 1; // release > prerelease
  if (pb.pre === null) return -1;
  const ta = pa.pre.split('.');
  const tb = pb.pre.split('.');
  const n = Math.max(ta.length, tb.length);
  for (let i = 0; i < n; i++) {
    if (i >= ta.length) return -1; // 较短的 prerelease 更小（1.0.0-alpha < 1.0.0-alpha.1）
    if (i >= tb.length) return 1;
    const x = ta[i];
    const y = tb[i];
    const xNum = /^\d+$/.test(x);
    const yNum = /^\d+$/.test(y);
    if (xNum && yNum) {
      const dx = Number(x);
      const dy = Number(y);
      if (dx !== dy) return dx - dy;
    } else if (xNum !== yNum) {
      return xNum ? -1 : 1; // 数字标识符 < 字母标识符（semver 规则）
    } else if (x !== y) {
      return x < y ? -1 : 1;
    }
  }
  return 0;
}

function parseVersion(v) {
  const m = String(v).match(/^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/);
  if (!m) throw new Error('非法版本号: ' + v);
  return { nums: [Number(m[1]), Number(m[2]), Number(m[3])], pre: m[4] === undefined ? null : m[4] };
}

function isPrerelease(v) {
  return /-/.test(String(v));
}

function sortReleasesDesc(list) {
  return list.slice().sort((a, b) => compareVersions(b.version, a.version));
}

// —— 清单读取（带 mtime 缓存 + .bak 兜底）——
let cache = null; // { mtimeMs, data }

function readManifestFile() {
  const file = path.join(downloadsDir(), 'manifest.json');
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch (e) {
    return { manifest: null, error: e };
  }
  try {
    return { manifest: JSON.parse(raw), error: null };
  } catch (e) {
    // 主清单损坏：尝试滚动备份（发布工具每次更新前写 .bak），并告警
    try {
      const bak = JSON.parse(fs.readFileSync(path.join(downloadsDir(), 'manifest.json.bak'), 'utf8'));
      console.error('[desktopManifest] manifest.json 损坏，已回退 manifest.json.bak:', e.message);
      return { manifest: bak, error: null };
    } catch (e2) {
      return { manifest: null, error: new Error('manifest.json 解析失败且无可用备份') };
    }
  }
}

function validateManifest(m) {
  if (!m || typeof m !== 'object') throw new Error('manifest 不是对象');
  if (m.schemaVersion !== 1 && m.schemaVersion !== 2) throw new Error('不支持的 manifest schemaVersion: ' + m.schemaVersion);
  if (m.schemaVersion === 2 && (!m.platforms || typeof m.platforms !== 'object')) throw new Error('manifest v2 缺少 platforms 段');
  if (!m.channels || typeof m.channels !== 'object') throw new Error('manifest 缺少 channels');
  for (const ch of CHANNELS) {
    const entry = m.channels[ch];
    if (entry === undefined || entry === null) continue; // 渠道可缺失（尚未发布过）
    if (!Array.isArray(entry.releases)) throw new Error('渠道 ' + ch + ' 缺少 releases 数组');
    const seen = new Set();
    const seenFiles = new Set();
    for (const r of entry.releases) {
      if (!r || typeof r !== 'object') throw new Error('渠道 ' + ch + ' 存在非法 release 条目');
      if (!VERSION_RE.test(r.version || '')) throw new Error('渠道 ' + ch + ' 非法版本号: ' + r.version);
      if (!NAME_RE.test(r.fileName || '')) throw new Error('渠道 ' + ch + ' 非法文件名: ' + r.fileName);
      if (seen.has(r.version)) throw new Error('渠道 ' + ch + ' 重复版本: ' + r.version);
      if (seenFiles.has(r.fileName)) throw new Error('渠道 ' + ch + ' 重复文件: ' + r.fileName);
      seen.add(r.version);
      seenFiles.add(r.fileName);
      if (ch === 'stable' && isPrerelease(r.version)) {
        throw new Error('stable 渠道禁止 prerelease 版本: ' + r.version);
      }
      if (typeof r.sizeBytes !== 'number' || r.sizeBytes <= 0) throw new Error('渠道 ' + ch + ' ' + r.version + ' 非法 sizeBytes');
      if (!SHA256_RE.test(r.sha256 || '')) throw new Error('渠道 ' + ch + ' ' + r.version + ' 非法 sha256');
      if (!SHA512_RE.test(r.sha512 || '')) throw new Error('渠道 ' + ch + ' ' + r.version + ' 非法 sha512');
      if (typeof r.releaseDate !== 'string' || !r.releaseDate) throw new Error('渠道 ' + ch + ' ' + r.version + ' 缺少 releaseDate');
      if (r.releaseNotes !== undefined && !(Array.isArray(r.releaseNotes) && r.releaseNotes.every((t) => typeof t === 'string'))) {
        throw new Error('渠道 ' + ch + ' ' + r.version + ' 非法 releaseNotes');
      }
      if (r.required !== undefined && r.required !== null && !VERSION_RE.test(r.required)) throw new Error('渠道 ' + ch + ' ' + r.version + ' 非法 required');
      if (ch === 'beta' && r.required) throw new Error('beta 渠道禁止 required: ' + r.version);
      if (r.retracted !== undefined && r.retracted !== null) {
        if (ch === 'beta') throw new Error('beta 渠道禁止 retracted: ' + r.version);
        if (typeof r.retracted !== 'object' || typeof r.retracted.reason !== 'string') {
          throw new Error('渠道 ' + ch + ' ' + r.version + ' 非法 retracted');
        }
      }
      // 清单引用的安装包必须真实存在
      const abs = path.join(downloadsDir(), ch, r.fileName);
      if (!fs.existsSync(abs)) throw new Error('渠道 ' + ch + ' 清单文件缺失: ' + r.fileName);
    }
    // 非空渠道必须带 latest.yml（桌面端 generic feed 的入口）
    if (entry.releases.length > 0) {
      const lf = path.join(downloadsDir(), ch, 'latest.yml');
      if (!fs.existsSync(lf)) throw new Error('渠道 ' + ch + ' 非空但缺少 latest.yml');
    }
    // 统一最新在前（防手写清单乱序）
    entry.releases = sortReleasesDesc(entry.releases);
  }

  // —— 手机端平台（android / ios）：stable 纪律（禁 prerelease / required），清单引用的文件必须真实存在 ——
  if (m.schemaVersion >= 2) {
    for (const pf of PLATFORMS) {
      const entry = m.platforms[pf];
      if (entry === undefined || entry === null) continue;
      if (!Array.isArray(entry.releases)) throw new Error('平台 ' + pf + ' 缺少 releases 数组');
      const seen = new Set();
      const seenFiles = new Set();
      for (const r of entry.releases) {
        if (!r || typeof r !== 'object') throw new Error('平台 ' + pf + ' 存在非法 release 条目');
        if (!VERSION_RE.test(r.version || '')) throw new Error('平台 ' + pf + ' 非法版本号: ' + r.version);
        if (r.channel !== undefined && r.channel !== 'beta') throw new Error('平台 ' + pf + ' 非法 channel: ' + r.channel);
        if (isPrerelease(r.version) && r.channel !== 'beta') throw new Error('平台 ' + pf + ' 暂不支持 prerelease 版本（内测记录需 channel=beta）: ' + r.version);
        const nameMatch = String(r.fileName || '').match(MOBILE_FILE_RE);
        if (!nameMatch) throw new Error('平台 ' + pf + ' 非法文件名: ' + r.fileName);
        if (String(nameMatch[1]).toLowerCase() !== pf) throw new Error('平台 ' + pf + ' 文件名平台不匹配: ' + r.fileName);
        if (seen.has(r.version)) throw new Error('平台 ' + pf + ' 重复版本: ' + r.version);
        if (seenFiles.has(r.fileName)) throw new Error('平台 ' + pf + ' 重复文件: ' + r.fileName);
        seen.add(r.version);
        seenFiles.add(r.fileName);
        if (typeof r.sizeBytes !== 'number' || r.sizeBytes <= 0) throw new Error('平台 ' + pf + ' ' + r.version + ' 非法 sizeBytes');
        if (!SHA256_RE.test(r.sha256 || '')) throw new Error('平台 ' + pf + ' ' + r.version + ' 非法 sha256');
        if (typeof r.releaseDate !== 'string' || !r.releaseDate) throw new Error('平台 ' + pf + ' ' + r.version + ' 缺少 releaseDate');
        if (r.releaseNotes !== undefined && !(Array.isArray(r.releaseNotes) && r.releaseNotes.every((t) => typeof t === 'string'))) {
          throw new Error('平台 ' + pf + ' ' + r.version + ' 非法 releaseNotes');
        }
        if (r.required !== undefined && r.required !== null) throw new Error('平台 ' + pf + ' 禁止 required: ' + r.version);
        if (r.retracted !== undefined && r.retracted !== null) {
          if (typeof r.retracted !== 'object' || typeof r.retracted.reason !== 'string') {
            throw new Error('平台 ' + pf + ' ' + r.version + ' 非法 retracted');
          }
        }
        const abs = path.join(downloadsDir(), pf, r.fileName);
        if (!fs.existsSync(abs)) throw new Error('平台 ' + pf + ' 清单文件缺失: ' + r.fileName);
      }
      // 统一最新在前
      entry.releases = sortReleasesDesc(entry.releases);
    }
  }
}

function getManifest() {
  const mf = path.join(downloadsDir(), 'manifest.json');
  let st;
  try {
    st = fs.statSync(mf);
  } catch (e) {
    cache = null;
    const err = new Error('manifest.json 不存在（安装包尚未发布）');
    err.code = 'ENOENT';
    throw err;
  }
  if (cache && cache.mtimeMs === st.mtimeMs) return cache.data;
  const { manifest, error } = readManifestFile();
  if (error) {
    cache = null;
    throw error;
  }
  validateManifest(manifest);
  cache = { mtimeMs: st.mtimeMs, data: manifest };
  return manifest;
}

// manifest 缺失/损坏时区分：ENOENT → 未发布；其他 → 内部错误
function tryGetManifest() {
  try {
    return { manifest: getManifest(), error: null };
  } catch (e) {
    return { manifest: null, error: e };
  }
}

function releasesOf(channel) {
  const m = getManifest();
  const entry = m.channels && m.channels[channel];
  return entry && Array.isArray(entry.releases) ? entry.releases : null;
}

// 渠道内最新未撤回版本
function topOf(channel) {
  const list = releasesOf(channel);
  if (!list) return null;
  return list.find((r) => !r.retracted) || null;
}

// 强制升级门槛：渠道最新未撤回版本的 required（promote 只允许作用于最新版）
function latestRequired(channel) {
  const top = topOf(channel);
  return top && top.required ? top.required : null;
}

// 旧版本是否已停止服务（低于最新版的强制门槛）
function isStopped(channel, release) {
  const req = latestRequired(channel);
  if (!req) return false;
  return compareVersions(release.version, req) < 0;
}

// 按文件名全局查找（stable 优先）
function findReleaseByFile(fileName) {
  for (const ch of CHANNELS) {
    const list = releasesOf(ch);
    if (!list) continue;
    const hit = list.find((r) => r.fileName === fileName);
    if (hit) return { channel: ch, release: hit };
  }
  return null;
}

function findReleaseByVersion(channel, version) {
  const list = releasesOf(channel);
  if (!list) return null;
  return list.find((r) => r.version === version) || null;
}

// 文件绝对路径（调用方必须先做 NAME_RE 白名单校验）
function filePathOf(channel, fileName) {
  return path.join(downloadsDir(), channel, fileName);
}

// —— 手机端平台辅助 ——
function mobileReleasesOf(platform) {
  const m = getManifest();
  const entry = m.platforms && m.platforms[platform];
  return entry && Array.isArray(entry.releases) ? entry.releases : null;
}

// 平台内最新未撤回版本
function topOfPlatform(platform) {
  const list = mobileReleasesOf(platform);
  if (!list) return null;
  return list.find((r) => !r.retracted) || null;
}

function findMobileReleaseByFile(platform, fileName) {
  const list = mobileReleasesOf(platform);
  if (!list) return null;
  return list.find((r) => r.fileName === fileName) || null;
}

function mobileFilePathOf(platform, fileName) {
  return path.join(downloadsDir(), platform, fileName);
}

module.exports = {
  CHANNELS,
  PLATFORMS,
  NAME_RE,
  MOBILE_FILE_RE,
  VERSION_RE,
  downloadsDir,
  compareVersions,
  parseVersion,
  isPrerelease,
  getManifest,
  tryGetManifest,
  releasesOf,
  topOf,
  latestRequired,
  isStopped,
  findReleaseByFile,
  findReleaseByVersion,
  filePathOf,
  mobileReleasesOf,
  topOfPlatform,
  findMobileReleaseByFile,
  mobileFilePathOf,
};