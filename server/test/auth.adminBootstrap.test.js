'use strict';

const request = require('supertest');
const { installFakePool } = require('./helpers');
const { createApp } = require('../app');

describe('管理员引导注册（T3：ADMIN_USERNAMES 驱动）', () => {
  const app = createApp();

  beforeEach(() => {
    process.env.JWT_SECRET = 'test-secret-0123456789';
  });

  afterEach(() => {
    delete process.env.ADMIN_USERNAMES;
    delete process.env.AUTO_ADMIN;
  });

  it('AUTO_ADMIN=1（内测服全员管理员）：任意注册即 admin，且不再走 ADMIN_USERNAMES 判断', async () => {
    process.env.AUTO_ADMIN = '1';
    delete process.env.ADMIN_USERNAMES;
    let insertedRole = null;
    installFakePool([
      [/INSERT INTO users \(username, password_hash, display_name, role\)/, async (_sql, params) => {
        insertedRole = params[3];
        return { rows: [{ id: 7, username: params[0], display_name: params[2], role: params[3], avatar_url: null }] };
      }],
    ]);

    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({ username: 'anyone', password: '123456', displayName: 'Anyone' });

    expect(res.status).toBe(200);
    expect(res.body.user.role).toBe('admin');
    expect(insertedRole).toBe('admin');
  });

  it('库中无管理员且用户名在 ADMIN_USERNAMES 中 → admin', async () => {
    process.env.ADMIN_USERNAMES = 'boss,admin';
    let insertedRole = null;
    installFakePool([
      [/SELECT 1 FROM users WHERE role = 'admin'/, async () => ({ rows: [] })],
      [/INSERT INTO users \(username, password_hash, display_name, role\)/, async (_sql, params) => {
        insertedRole = params[3];
        return { rows: [{ id: 1, username: params[0], display_name: params[2], role: params[3], avatar_url: null }] };
      }],
    ]);

    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({ username: 'boss', password: '123456', displayName: 'Boss' });

    expect(res.status).toBe(200);
    expect(res.body.user.role).toBe('admin');
    expect(insertedRole).toBe('admin');
  });

  it('库中无管理员但用户名不在 ADMIN_USERNAMES → 普通 user（不再自动提权）', async () => {
    process.env.ADMIN_USERNAMES = 'boss';
    let insertedRole = null;
    installFakePool([
      [/SELECT 1 FROM users WHERE role = 'admin'/, async () => ({ rows: [] })],
      [/INSERT INTO users \(username, password_hash, display_name, role\)/, async (_sql, params) => {
        insertedRole = params[3];
        return { rows: [{ id: 1, username: params[0], display_name: params[2], role: params[3], avatar_url: null }] };
      }],
    ]);

    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({ username: 'stranger', password: '123456', displayName: 'Stranger' });

    expect(res.status).toBe(200);
    expect(res.body.user.role).toBe('user');
    expect(insertedRole).toBe('user');
  });

  it('已有管理员时，新注册用户为普通 user', async () => {
    process.env.ADMIN_USERNAMES = 'boss';
    installFakePool([
      [/SELECT 1 FROM users WHERE role = 'admin'/, async () => ({ rows: [{ '?column?': 1 }] })],
      [/INSERT INTO users \(username, password_hash, display_name, role\)/, async (_sql, params) => ({
        rows: [{ id: 2, username: params[0], display_name: params[2], role: params[3], avatar_url: null }],
      })],
    ]);

    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({ username: 'seconduser', password: '123456', displayName: 'Second' });

    expect(res.status).toBe(200);
    expect(res.body.user.role).toBe('user');
  });

  it('isAdminUsername 惰性读取：注册后改 env 不影响已注册判断（运行中热改生效）', async () => {
    // 未设置 ADMIN_USERNAMES 时，首个注册也是普通用户
    process.env.ADMIN_USERNAMES = '';
    let insertedRole = null;
    installFakePool([
      [/SELECT 1 FROM users WHERE role = 'admin'/, async () => ({ rows: [] })],
      [/INSERT INTO users \(username, password_hash, display_name, role\)/, async (_sql, params) => {
        insertedRole = params[3];
        return { rows: [{ id: 1, username: params[0], display_name: params[2], role: params[3], avatar_url: null }] };
      }],
    ]);

    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({ username: 'mystery', password: '123456', displayName: 'M' });

    expect(res.status).toBe(200);
    expect(res.body.user.role).toBe('user');
    expect(insertedRole).toBe('user');
  });
});
