'use strict';

// 桌面端安装包发布工具库（v3.35 · 零第三方依赖，Node >= 18）
// 职责：semver/哈希/latest.yml 解析与交叉校验、manifest 原子读写、渠道剪枝。
// 纪律（与 server/src/services/desktopManifest.js 保持一致）：
//   - stable 渠道禁止 prerelease 版本；beta 渠道不得携带 required/retracted；
//   - latest.yml 内的 sha512 必须与安装包逐字节一致（篡改/错包直接拒绝）；
//   - 任何清单写入都先备份 manifest.json.bak，再原子替换。

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const FILE_RE = /^Qbao-Setup-(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)\.exe$/i;
const VERSION_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const CHANNELS = ['stable', 'beta'];

// 手机端平台与文件名（Qbao-Android-<v>.apk / Qbao-iOS-<v>.ipa）
const PLATFORMS = ['android', 'ios'];
const MOBILE_FILE_RE = /^Qbao-(Android|iOS)-(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)\.(apk|ipa)$/i;

// —— semver ——
function parseVersion(v) {
  const m = String(v).match(/^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/);
  if (!m) throw new Error('非法版本号: ' + v);
  return { nums: [Number(m[1]), Number(m[2]), Number(m[3])], pre: m[4] === undefined ? null : m[4] };
}

function compareVersions(a, b) {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  for (let i = 0; i < 3; i++) if (pa.nums[i] !== pb.nums[i]) return pa.nums[i] - pb.nums[i];
  if (pa.pre === null && pb.pre === null) return 0;
  if (pa.pre === null) return 1;
  if (pb.pre === null) return -1;
  const ta = pa.pre.split('.');
  const tb = pb.pre.split('.');
  for (let i = 0; i < Math.max(ta.length, tb.length); i++) {
    if (i >= ta.length) return -1;
    if (i >= tb.length) return 1;
    const x = ta[i];
    const y = tb[i];
    const xNum = /^\d+$/.test(x);
    const yNum = /^\d+$/.test(y);
    if (xNum && yNum) {
      if (Number(x) !== Number(y)) return Number(x) - Number(y);
    } else if (xNum !== yNum) {
      return xNum ? -1 : 1;
    } else if (x !== y) {
      return x < y ? -1 : 1;
    }
  }
  return 0;
}

function isPrerelease(v) {
  return /-/.test(String(v));
}

// —— 哈希 ——
function sha256File(abs) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const s = fs.createReadStream(abs);
    s.on('error', reject);
    s.on('data', (c) => hash.update(c));
    s.on('end', () => resolve(hash.digest('hex')));
  });
}

function sha512FileBase64(abs) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha512');
    const s = fs.createReadStream(abs);
    s.on('error', reject);
    s.on('data', (c) => hash.update(c));
    s.on('end', () => resolve(hash.digest('base64')));
  });
}

function stripQuotes(s) {
  const t = String(s || '').trim();
  if (t.length >= 2 && ((t[0] === '"' && t[t.length - 1] === '"') || (t[0] === "'" && t[t.length - 1] === "'"))) {
    return t.slice(1, -1);
  }
  return t;
}

// —— latest.yml 解析（electron-builder 出品的最小解析器）——
function parseLatestYaml(text) {
  const out = { version: null, files: [], topSha512: null, releaseDate: null };
  let current = null;
  for (const raw of String(text).split(/\r?\n/)) {
    const trim = raw.trim();
    if (!trim || trim.startsWith('#')) continue;
    const isListItem = /^-\s/.test(trim);
    const kvMatch = trim.replace(/^-\s*/, '').match(/^([A-Za-z0-9_.-]+):\s*(.*)$/);
    if (!kvMatch) continue;
    const key = kvMatch[1];
    const value = stripQuotes(kvMatch[2]);
    if (isListItem) {
      current = {};
      out.files.push(current);
    } else if (!raw.startsWith(' ')) {
      current = null; // 回到顶层
    }
    if (key === 'version' && !raw.startsWith(' ') && !isListItem) out.version = value;
    else if (key === 'sha512') {
      if (isListItem || current) { if (!current) current = out.files[out.files.length - 1] || null; if (current) current.sha512 = value; }
      else out.topSha512 = value;
    } else if (key === 'releaseDate' && !raw.startsWith(' ') && !isListItem) out.releaseDate = value;
    else if (current) {
      if (key === 'url') current.url = value;
      else if (key === 'size') current.size = value;
    }
  }
  return out;
}

// latest.yml 与安装包交叉校验：sha512/size/version 全部一致才算通过
async function verifyLatestYaml(latestYmlText, exeAbs, exeVersion) {
  const y = parseLatestYaml(latestYmlText);
  const errors = [];
  if (!y.version) errors.push('latest.yml 缺少 version');
  if (y.version !== exeVersion) errors.push('latest.yml version ' + y.version + ' != 安装包版本 ' + exeVersion);
  if (!y.files || y.files.length === 0) errors.push('latest.yml 缺少 files 清单');
  const f = y.files && y.files[0];
  if (!errors.length) {
    if (!f || !f.url) errors.push('latest.yml files[0] 缺少 url');
    else if (path.basename(f.url) !== path.basename(exeAbs)) errors.push('latest.yml url ' + f.url + ' 与安装包文件名不一致');
    if (!f || !f.sha512) errors.push('latest.yml files[0] 缺少 sha512');
    if (!y.topSha512) errors.push('latest.yml 缺少顶层 sha512');
    if (f && f.sha512 && y.topSha512 && f.sha512 !== y.topSha512) errors.push('latest.yml 内 sha512 不一致（files 与顶层）');
  }
  const realSha512 = await sha512FileBase64(exeAbs);
  const realSize = fs.statSync(exeAbs).size;
  if (!errors.length && f.sha512 !== realSha512) errors.push('latest.yml sha512 与安装包实际哈希不一致（错包或损坏）');
  if (!errors.length && f.size !== undefined && String(f.size) !== String(realSize)) {
    errors.push('latest.yml size ' + f.size + ' != 实际大小 ' + realSize);
  }
  return { ok: errors.length === 0, errors, sha512: realSha512, size: realSize, yaml: y };
}

// —— manifest 读写 ——
function loadManifest(dir) {
  const file = path.join(dir, 'manifest.json');
  if (!fs.existsSync(file)) {
    return { schemaVersion: 1, updatedAt: null, channels: { stable: { releases: [] }, beta: { releases: [] } } };
  }
  let m;
  try {
    m = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    throw new Error('manifest.json 解析失败: ' + e.message);
  }
  return m;
}

function validateManifestStructure(m) {
  if (!m || typeof m !== 'object') throw new Error('manifest 不是对象');
  if (m.schemaVersion !== 1 && m.schemaVersion !== 2) throw new Error('不支持的 schemaVersion: ' + m.schemaVersion);
  if (m.schemaVersion === 2 && (!m.platforms || typeof m.platforms !== 'object')) throw new Error('schemaVersion 2 缺少 platforms');
  if (!m.channels || typeof m.channels !== 'object') throw new Error('缺少 channels');
  for (const ch of CHANNELS) {
    const entry = m.channels[ch];
    if (entry === undefined) continue;
    if (!Array.isArray(entry.releases)) throw new Error(ch + ' 缺少 releases');
    for (const r of entry.releases) {
      if (!VERSION_RE.test(r.version || '')) throw new Error(ch + ' 非法版本: ' + r.version);
      if (!FILE_RE.test(r.fileName || '')) throw new Error(ch + ' 非法文件名: ' + r.fileName);
      if (ch === 'stable' && isPrerelease(r.version)) throw new Error('stable 渠道禁止 prerelease: ' + r.version);
      if (ch === 'beta' && r.required) throw new Error('beta 渠道禁止 required');
      if (ch === 'beta' && r.retracted) throw new Error('beta 渠道禁止 retracted');
    }
  }
  // 手机端平台（android/ios）：stable 纪律（禁 prerelease / required）；文件存在性由发布工具负责
  if (m.schemaVersion >= 2) {
    for (const pf of PLATFORMS) {
      const entry = m.platforms[pf];
      if (entry === undefined) continue;
      if (!Array.isArray(entry.releases)) throw new Error('平台 ' + pf + ' 缺少 releases');
      const seen = new Set();
      const seenFiles = new Set();
      for (const r of entry.releases) {
        if (!VERSION_RE.test(r.version || '')) throw new Error('平台 ' + pf + ' 非法版本: ' + r.version);
        const nameMatch = String(r.fileName || '').match(MOBILE_FILE_RE);
        if (!nameMatch) throw new Error('平台 ' + pf + ' 非法文件名: ' + r.fileName);
        if (String(nameMatch[1]).toLowerCase() !== pf) throw new Error('平台 ' + pf + ' 文件名平台不匹配: ' + r.fileName);
        if (isPrerelease(r.version)) throw new Error('平台 ' + pf + ' 暂不支持 prerelease: ' + r.version);
        if (r.required) throw new Error('平台 ' + pf + ' 禁止 required');
        if (seen.has(r.version)) throw new Error('平台 ' + pf + ' 重复版本: ' + r.version);
        if (seenFiles.has(r.fileName)) throw new Error('平台 ' + pf + ' 重复文件: ' + r.fileName);
        seen.add(r.version);
        seenFiles.add(r.fileName);
      }
    }
  }
}

function saveManifestAtomic(dir, manifest) {
  validateManifestStructure(manifest);
  manifest.updatedAt = new Date().toISOString();
  const file = path.join(dir, 'manifest.json');
  const tmp = file + '.tmp';
  const bak = file + '.bak';
  fs.writeFileSync(tmp, JSON.stringify(manifest, null, 2) + '\n');
  if (fs.existsSync(file)) fs.copyFileSync(file, bak); // 滚动备份（回滚依据）
  fs.renameSync(tmp, file);
}

function sortReleasesDesc(list) {
  return list.slice().sort((a, b) => compareVersions(b.version, a.version));
}

function channelOf(m, channel) {
  if (!m.channels[channel]) m.channels[channel] = { releases: [] };
  return m.channels[channel];
}

function findRelease(m, channel, version) {
  const entry = m.channels[channel];
  if (!entry) return null;
  return entry.releases.find((r) => r.version === version) || null;
}

function platformOf(m, platform) {
  if (!m.platforms) m.platforms = {};
  if (!m.platforms[platform]) m.platforms[platform] = { releases: [] };
  return m.platforms[platform];
}

function findPlatformRelease(m, platform, version) {
  const entry = m.platforms && m.platforms[platform];
  if (!entry) return null;
  return entry.releases.find((r) => r.version === version) || null;
}

// 剪枝：保留最新的 keep 个；若其中可用（未撤回）版本不足 minUsable，则延伸保留。
// 返回被删除的文件名列表（exe / blockmap）。
function pruneChannel(m, channel, keep, minUsable) {
  const entry = channelOf(m, channel);
  if (!entry.releases.length) return [];
  const sorted = sortReleasesDesc(entry.releases);
  let target = Math.max(1, parseInt(keep, 10) || 3);
  let usable = sorted.slice(0, target).filter((r) => !r.retracted).length;
  while (usable < minUsable && target < sorted.length) {
    target += 1;
    usable = sorted.slice(0, target).filter((r) => !r.retracted).length;
  }
  const removed = sorted.slice(target);
  entry.releases = sorted.slice(0, target);
  const files = [];
  for (const r of removed) {
    files.push(r.fileName);
    files.push(r.fileName + '.blockmap');
  }
  return files;
}

module.exports = {
  FILE_RE,
  VERSION_RE,
  CHANNELS,
  MOBILE_FILE_RE,
  PLATFORMS,
  parseVersion,
  compareVersions,
  isPrerelease,
  sha256File,
  sha512FileBase64,
  stripQuotes,
  parseLatestYaml,
  verifyLatestYaml,
  loadManifest,
  validateManifestStructure,
  saveManifestAtomic,
  sortReleasesDesc,
  channelOf,
  findRelease,
  pruneChannel,
  platformOf,
  findPlatformRelease,
};
