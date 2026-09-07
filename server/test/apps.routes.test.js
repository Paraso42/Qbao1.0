'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const request = require('supertest');
const { createApp } = require('../app');
const statsService = require('../src/services/desktopStats');

function mobileRelease(platform, version, extra) {
  const pfx = platform === 'ios' ? 'Qbao-iOS-' : 'Qbao-Android-';
  const ext = platform === 'ios' ? '.ipa' : '.apk';
  return Object.assign({
    version,
    fileName: pfx + version + ext,
    sizeBytes: 2048,
    sha256: crypto.createHash('sha256').update('m-' + platform + '-' + version).digest('hex'),
    releaseDate: '2026-09-06T00:00:00.000Z',
    releaseNotes: ['手机端发布'],
    retracted: null,
  }, extra || {});
}

const androidFixture = [
  mobileRelease('android', '1.0.0'),
  mobileRelease('android', '0.9.1', { retracted: { reason: '签名问题' } }),
  mobileRelease('android', '0.9.0'),
];
const iosFixture = [mobileRelease('ios', '0.1.0')];

// 写入 v2 fixture：channels 恒为空渠道（桌面端不参与），platforms 按实参
function writeV2Fixture(dir, platforms) {
  const manifest = {
    schemaVersion: 2,
    updatedAt: '2026-09-06T00:00:00.000Z',
    channels: { stable: { releases: [] }, beta: { releases: [] } },
    platforms: {},
  };
  for (const [pf, list] of Object.entries(platforms)) {
    const pfDir = path.join(dir, pf);
    fs.mkdirSync(pfDir, { recursive: true });
    for (const r of list) {
      fs.writeFileSync(path.join(pfDir, r.fileName), Buffer.alloc(r.sizeBytes, 7));
    }
    manifest.platforms[pf] = { releases: list };
  }
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2));
}

describe('手机端统一分发 API（apps v1 · manifest-first）', () => {
  let app;
  let dir;

  process.env.QBAO_DESKTOP_STATS = 'off';
  app = createApp();
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qbao-apps-'));
    process.env.QBAO_DESKTOP_DIR = dir;
    statsService._resetForTests();
  });
  afterEach(() => {
    delete process.env.QBAO_DESKTOP_DIR;
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* ignore */ }
  });

  it('空储藏室 / 未知平台 / 未发布平台：404 与 400', async () => {
    fs.mkdirSync(dir, { recursive: true });
    expect((await request(app).get('/api/v1/apps/manifest?platform=android')).status).toBe(404);
    expect((await request(app).get('/api/v1/apps/manifest?platform=ios')).status).toBe(404);
    expect((await request(app).get('/api/v1/apps/manifest?platform=windows')).status).toBe(400);
    expect((await request(app).get('/api/v1/apps/manifest')).status).toBe(400);
    // v1 纯桌面清单（无 platforms）→ 手机端 404，桌面端不受影响
    fs.mkdirSync(path.join(dir, 'stable'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'stable', 'Qbao-Setup-3.36.0.exe'), Buffer.alloc(8));
    fs.writeFileSync(path.join(dir, 'stable', 'latest.yml'), 'version: 3.36.0\n');
    fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({
      schemaVersion: 1, updatedAt: 'x',
      channels: { stable: { releases: [{
        version: '3.36.0', fileName: 'Qbao-Setup-3.36.0.exe', sizeBytes: 8,
        sha256: crypto.createHash('sha256').update('w').digest('hex'),
        sha512: Buffer.alloc(64, 7).toString('base64'), releaseDate: '2026-09-04T00:00:00.000Z',
        releaseNotes: [], required: null, retracted: null,
      }] } },
    }));
    expect((await request(app).get('/api/v1/apps/manifest?platform=android')).status).toBe(404);
    expect((await request(app).get('/api/v1/desktop/manifest')).status).toBe(200);
  });

  it('manifest：字段完整、最新在前、retracted 标记、平台隔离', async () => {
    writeV2Fixture(dir, { android: androidFixture, ios: iosFixture });
    const a = await request(app).get('/api/v1/apps/manifest?platform=android');
    expect(a.status).toBe(200);
    expect(a.body.ok).toBe(true);
    expect(a.body.platform).toBe('android');
    expect(a.body.releases.map((x) => x.version)).toEqual(['1.0.0', '0.9.1', '0.9.0']);
    const top = a.body.releases[0];
    expect(top.fileName).toBe('Qbao-Android-1.0.0.apk');
    expect(top.sizeBytes).toBe(2048);
    expect(top.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(top.releaseNotes).toEqual(['手机端发布']);
    expect(top.retracted).toBeNull();
    expect(top.stopped).toBeUndefined(); // 手机端无 stopped/required 语义
    const retr = a.body.releases.find((x) => x.version === '0.9.1');
    expect(retr.retracted.reason).toBe('签名问题');
    // ios 与 android 互相隔离
    const i = await request(app).get('/api/v1/apps/manifest?platform=ios');
    expect(i.body.releases.map((x) => x.fileName)).toEqual(['Qbao-iOS-0.1.0.ipa']);
    // 平台为空数组（未发布 ios）→ 404
    writeV2Fixture(dir, { android: androidFixture, ios: [] });
    const now = new Date();
    fs.utimesSync(path.join(dir, 'manifest.json'), now, new Date(now.getTime() + 2000)); // 越过 mtime 缓存
    expect((await request(app).get('/api/v1/apps/manifest?platform=ios')).status).toBe(404);
  });

  it('download：精确文件 200 + attachment；未知/穿越/跨平台 404；retracted 410', async () => {
    writeV2Fixture(dir, { android: androidFixture, ios: iosFixture });
    const d = await request(app).get('/api/v1/apps/download?platform=android&file=Qbao-Android-1.0.0.apk');
    expect(d.status).toBe(200);
    expect(d.headers['content-disposition']).toContain('Qbao-Android-1.0.0.apk');
    expect(d.headers['content-type']).toContain('octet-stream');
    expect(d.body.length).toBe(2048);
    const old = await request(app).get('/api/v1/apps/download?platform=android&file=Qbao-Android-0.9.0.apk');
    expect(old.status).toBe(200);
    expect((await request(app).get('/api/v1/apps/download?platform=android&file=Qbao-Android-9.9.9.apk')).status).toBe(404);
    expect((await request(app).get('/api/v1/apps/download?platform=android&file=..%2F..%2Fetc%2Fpasswd')).status).toBe(404);
    expect((await request(app).get('/api/v1/apps/download?platform=android&file=evil.apk')).status).toBe(404);
    // 跨平台文件不互通
    expect((await request(app).get('/api/v1/apps/download?platform=android&file=Qbao-iOS-0.1.0.ipa')).status).toBe(404);
    // 缺 platform 参数
    expect((await request(app).get('/api/v1/apps/download?file=Qbao-Android-1.0.0.apk')).status).toBe(400);
    // retracted
    const g = await request(app).get('/api/v1/apps/download?platform=android&file=Qbao-Android-0.9.1.apk');
    expect(g.status).toBe(410);
    expect(g.body.error).toContain('撤回');
  });

  it('stats：完整 GET 记 1 次，Range/HEAD 不计数；perFile 按平台前缀过滤', async () => {
    writeV2Fixture(dir, { android: androidFixture, ios: iosFixture });
    await request(app).get('/api/v1/apps/download?platform=android&file=Qbao-Android-1.0.0.apk');
    await request(app).get('/api/v1/apps/download?platform=android&file=Qbao-Android-1.0.0.apk').set('Range', 'bytes=0-15');
    await request(app).head('/api/v1/apps/download?platform=android&file=Qbao-Android-1.0.0.apk');
    await request(app).get('/api/v1/apps/download?platform=ios&file=Qbao-iOS-0.1.0.ipa');
    const a = await request(app).get('/api/v1/apps/stats?platform=android');
    expect(a.status).toBe(200);
    const row = a.body.perFile.find((x) => x.fileName === 'Qbao-Android-1.0.0.apk');
    expect(row.downloads).toBe(1);
    expect(a.body.perFile.some((x) => x.fileName === 'Qbao-iOS-0.1.0.ipa')).toBe(false);
    const i = await request(app).get('/api/v1/apps/stats?platform=ios');
    const irow = i.body.perFile.find((x) => x.fileName === 'Qbao-iOS-0.1.0.ipa');
    expect(irow.downloads).toBe(1);
    expect((await request(app).get('/api/v1/apps/stats?platform=foo')).status).toBe(400);
  });

  it('/dl 落地页：多端页签 + Android/iOS 内容 + UA 自动识别', async () => {
    writeV2Fixture(dir, { android: androidFixture, ios: [] });
    // 无 platform 参数：默认 Windows 桌面版页（含页签与既有断言文本）
    const w = await request(app).get('/dl');
    expect(w.status).toBe(200);
    expect(w.text).toContain('Qbao 桌面版下载');
    expect(w.text).toContain('plat-tab');
    expect(w.text).toContain('其他平台');
    // Android 页：hero + 版本历史 + 安装说明 + 直链下载地址
    const a = await request(app).get('/dl?platform=android');
    expect(a.status).toBe(200);
    expect(a.text).toContain('Qbao Android 版下载');
    expect(a.text).toContain('Qbao-Android-1.0.0.apk');
    expect(a.text).toContain('Android 安装说明');
    expect(a.text).toContain('/api/v1/apps/download?platform=android&file=Qbao-Android-1.0.0.apk');
    // iOS 未发布：说明卡片 + Safari 添加到主屏幕提示
    const i = await request(app).get('/dl?platform=ios');
    expect(i.status).toBe(200);
    expect(i.text).toContain('尚未发布');
    expect(i.text).toContain('添加到主屏幕');
    expect(i.text).toContain('/dl?platform=android');
    // UA 自动识别：无 platform 参数 + Android UA → Android 版
    const ua = await request(app).get('/dl').set('User-Agent', 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36');
    expect(ua.text).toContain('Qbao Android 版下载');
    // iOS UA → iOS 版
    const iosUa = await request(app).get('/dl').set('User-Agent', 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15');
    expect(iosUa.text).toContain('Qbao iOS 版下载');
    expect(iosUa.text).toContain('尚未发布');
  });
});