'use strict';

const fs = require('fs');
const path = require('path');
const request = require('supertest');
const { installFakePool } = require('./helpers');
const { createApp } = require('../app');
const { signToken } = require('../src/auth');

const AVATAR_DIR = path.join(__dirname, '../..', 'uploads', 'avatars');

describe('users 路由参数校验', () => {
  const app = createApp();
  let token;

  beforeEach(() => {
    process.env.JWT_SECRET = 'test-secret-0123456789';
    token = signToken(1, 'user');
    installFakePool([[/SELECT is_banned FROM users/, async () => ({ rows: [] })]]);
  });

  it('修改昵称过长 → 422', async () => {
    const res = await request(app)
      .put('/api/v1/users/me')
      .set('Authorization', 'Bearer ' + token)
      .send({ displayName: 'x'.repeat(200) });

    expect(res.status).toBe(422);
  });

  it('封禁请求缺少 banned → 422', async () => {
    const res = await request(app)
      .patch('/api/v1/users/1/ban')
      .set('Authorization', 'Bearer ' + token)
      .send({});

    expect(res.status).toBe(422);
  });

  it('管理员修改用户角色非法 → 422', async () => {
    const res = await request(app)
      .put('/api/v1/users/1')
      .set('Authorization', 'Bearer ' + token)
      .send({ role: 'superadmin' });

    expect(res.status).toBe(422);
  });

  it('头像上传缺少 avatar 字段 → 422', async () => {
    const res = await request(app)
      .put('/api/v1/users/me/avatar')
      .set('Authorization', 'Bearer ' + token)
      .send({});

    expect(res.status).toBe(422);
  });

  it('头像上传非法 data URL（不支持格式）→ 422', async () => {
    const res = await request(app)
      .put('/api/v1/users/me/avatar')
      .set('Authorization', 'Bearer ' + token)
      .send({ avatar: 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=' });

    expect(res.status).toBe(422);
  });

  it('头像上传合法 data URL → 200 并返回 avatars/<id>.jpg，写盘文件随后清理', async () => {
    // 1x1 红色像素 JPEG
    const base64 =
      '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0a' +
      'HBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAA' +
      'AAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AVN//2Q==';
    const dataUrl = 'data:image/jpeg;base64,' + base64;
    const uid = 987654321; // 专用测试用户 id，避免覆盖真实用户头像
    const avatarFile = path.join(AVATAR_DIR, uid + '.jpg');
    const testToken = signToken(uid, 'user');

    installFakePool([
      [/SELECT is_banned FROM users/, async () => ({ rows: [] })],
      [/UPDATE users SET avatar_url/, async () => ({ rows: [{ id: uid, avatar_url: 'avatars/' + uid + '.jpg' }] })],
    ]);

    const res = await request(app)
      .put('/api/v1/users/me/avatar')
      .set('Authorization', 'Bearer ' + testToken)
      .send({ avatar: dataUrl });

    expect(res.status).toBe(200);
    expect(res.body.user.avatarUrl).toBe('avatars/' + uid + '.jpg');
    expect(fs.existsSync(avatarFile)).toBe(true);
    // 测试头像文件清理（uploads/ 为运行时数据，不入库）
    try { fs.unlinkSync(avatarFile); } catch (_) {}
  });
});

describe('管理员保护（防互害 / 防提权，2026-09）', () => {
  const app = createApp();
  let adminToken;

  beforeEach(() => {
    process.env.JWT_SECRET = 'test-secret-0123456789';
    adminToken = signToken(9, 'admin');
  });

  it('封禁管理员账号 → 403（管理员不受封禁管理）', async () => {
    installFakePool([
      [/SELECT id, username, role, is_banned FROM users/, async () => ({ rows: [{ id: 3, username: 'boss', role: 'admin', is_banned: false }] })],
    ]);
    const res = await request(app)
      .patch('/api/v1/users/3/ban')
      .set('Authorization', 'Bearer ' + adminToken)
      .send({ banned: true });
    expect(res.status).toBe(403);
    expect(res.body.error).toContain('管理员');
  });

  it('重置管理员密码 → 403（防管理员互害）', async () => {
    installFakePool([
      [/SELECT id, username, role FROM users/, async () => ({ rows: [{ id: 3, username: 'boss', role: 'admin' }] })],
    ]);
    const res = await request(app)
      .put('/api/v1/users/3')
      .set('Authorization', 'Bearer ' + adminToken)
      .send({ password: 'x123456' });
    expect(res.status).toBe(403);
    expect(res.body.error).toContain('管理员');
  });

  it('向普通用户授予 admin → 403（角色仅能后台脚本调整）', async () => {
    installFakePool([
      [/SELECT id, username, role FROM users/, async () => ({ rows: [{ id: 5, username: 'carl', role: 'user' }] })],
    ]);
    const res = await request(app)
      .put('/api/v1/users/5')
      .set('Authorization', 'Bearer ' + adminToken)
      .send({ role: 'admin' });
    expect(res.status).toBe(403);
    expect(res.body.error).toContain('后台');
  });

  it('管理员封禁普通用户仍可用', async () => {
    installFakePool([
      [/SELECT id, username, role, is_banned FROM users/, async () => ({ rows: [{ id: 5, username: 'carl', role: 'user', is_banned: false }] })],
      [/UPDATE users SET is_banned/, async () => ({ rows: [], rowCount: 1 })],
    ]);
    const res = await request(app)
      .patch('/api/v1/users/5/ban')
      .set('Authorization', 'Bearer ' + adminToken)
      .send({ banned: true });
    expect(res.status).toBe(200);
    expect(res.body.user.isBanned).toBe(true);
  });
});
