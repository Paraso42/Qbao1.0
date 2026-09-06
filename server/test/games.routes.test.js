'use strict';

// games 路由测试：鉴权 + zod 校验（422）+ 单调合并（best/level 只升不降、plays 累加）
// + 新用户首写 + data CAS 并发重试（409 兜底已在实现中循环覆盖）。

const request = require('supertest');
const { installFakePool } = require('./helpers');
const { createApp } = require('../app');
const { signToken } = require('../src/auth');

function authPool() {
  installFakePool([[ /SELECT is_banned FROM users/, async () => ({ rows: [] }) ]]);
}

describe('games 路由校验', () => {
  const app = createApp();
  let token;

  beforeEach(() => {
    process.env.JWT_SECRET = 'test-secret-0123456789';
    token = signToken(1, 'user');
    authPool();
  });

  it('未登录访问 → 401', async () => {
    const res = await request(app).get('/api/v1/games');
    expect(res.status).toBe(401);
  });

  it('未登录上报 → 401', async () => {
    const res = await request(app).post('/api/v1/games').send({ gameId: '2048', score: 10 });
    expect(res.status).toBe(401);
  });

  it('非法 gameId → 422', async () => {
    const res = await request(app)
      .post('/api/v1/games')
      .set('Authorization', 'Bearer ' + token)
      .send({ gameId: 'bad', score: 10 });
    expect(res.status).toBe(422);
  });

  it('空上报 → 422', async () => {
    const res = await request(app)
      .post('/api/v1/games')
      .set('Authorization', 'Bearer ' + token)
      .send({ gameId: '2048' });
    expect(res.status).toBe(422);
  });

  it('score 为负 → 422', async () => {
    const res = await request(app)
      .post('/api/v1/games')
      .set('Authorization', 'Bearer ' + token)
      .send({ gameId: '2048', score: -5 });
    expect(res.status).toBe(422);
  });

  it('plays 超上限（201）→ 422', async () => {
    const res = await request(app)
      .post('/api/v1/games')
      .set('Authorization', 'Bearer ' + token)
      .send({ gameId: '2048', plays: 201 });
    expect(res.status).toBe(422);
  });
});

describe('games 业务路径', () => {
  let token;

  beforeEach(() => {
    process.env.JWT_SECRET = 'test-secret-0123456789';
    token = signToken(7, 'user');
  });

  it('GET 无数据 → {}', async () => {
    installFakePool([
      [/SELECT is_banned/, async () => ({ rows: [] })],
      [/SELECT data FROM user_games_stats/, async () => ({ rows: [] })],
    ]);
    const app = createApp();
    const res = await request(app).get('/api/v1/games').set('Authorization', 'Bearer ' + token);
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({});
  });

  it('POST 新用户首写 → 200 且回显合并结果', async () => {
    installFakePool([
      [/SELECT is_banned/, async () => ({ rows: [] })],
      [/SELECT data FROM user_games_stats/, async () => ({ rows: [] })],
      [/INSERT INTO user_games_stats/, async () => ({ rowCount: 1 })],
    ]);
    const app = createApp();
    const res = await request(app)
      .post('/api/v1/games')
      .set('Authorization', 'Bearer ' + token)
      .send({ gameId: '2048', score: 4096, plays: 2 });
    expect(res.status).toBe(200);
    expect(res.body.data['2048'].best).toBe(4096);
    expect(res.body.data['2048'].plays).toBe(2);
  });

  it('best 只升不降：已有 100，上报 30 → 仍 100；plays 累加', async () => {
    installFakePool([
      [/SELECT is_banned/, async () => ({ rows: [] })],
      [/SELECT data FROM user_games_stats/, async () => ({
        rows: [{ data: { '2048': { best: 100, level: 0, plays: 3 } } }],
      })],
      [/UPDATE user_games_stats/, async () => ({ rowCount: 1 })],
    ]);
    const app = createApp();
    const res = await request(app)
      .post('/api/v1/games')
      .set('Authorization', 'Bearer ' + token)
      .send({ gameId: '2048', score: 30 });
    expect(res.status).toBe(200);
    expect(res.body.data['2048'].best).toBe(100);
    expect(res.body.data['2048'].plays).toBe(4);
  });

  it('level 只升不降：已有 12，上报 5 → 仍 12', async () => {
    installFakePool([
      [/SELECT is_banned/, async () => ({ rows: [] })],
      [/SELECT data FROM user_games_stats/, async () => ({
        rows: [{ data: { froggy: { best: 0, level: 12, plays: 9 } } }],
      })],
      [/UPDATE user_games_stats/, async () => ({ rowCount: 1 })],
    ]);
    const app = createApp();
    const res = await request(app)
      .post('/api/v1/games')
      .set('Authorization', 'Bearer ' + token)
      .send({ gameId: 'froggy', level: 5 });
    expect(res.status).toBe(200);
    expect(res.body.data.froggy.level).toBe(12);
  });

  it('CAS 首次冲突后重试成功，并与最新值合并', async () => {
    let selectN = 0;
    installFakePool([
      [/SELECT is_banned/, async () => ({ rows: [] })],
      [/SELECT data FROM user_games_stats/, async () => {
        selectN++;
        if (selectN === 1) return { rows: [{ data: { '2048': { best: 100, plays: 1 } } }] };
        // 并发写入者已提交（best 500）
        return { rows: [{ data: { '2048': { best: 500, plays: 2 } } }] };
      }],
      [/UPDATE user_games_stats/, async () => (selectN === 1 ? { rowCount: 0 } : { rowCount: 1 })],
    ]);
    const app = createApp();
    const res = await request(app)
      .post('/api/v1/games')
      .set('Authorization', 'Bearer ' + token)
      .send({ gameId: '2048', score: 100, plays: 1 });
    expect(res.status).toBe(200);
    // 与并发提交的 500 合并，plays 2+1
    expect(res.body.data['2048'].best).toBe(500);
    expect(res.body.data['2048'].plays).toBe(3);
  });

  it('不同用户数据互不干扰（数据按 user_id 隔离）', async () => {
    const rowsByUser = {
      7: { data: { tetris: { best: 200, level: 0, plays: 5 } } },
      8: { data: { tetris: { best: 999, level: 0, plays: 1 } } },
    };
    installFakePool([
      [/SELECT is_banned/, async () => ({ rows: [] })],
      [/SELECT data FROM user_games_stats/, async (_sql, params) => ({
        rows: [rowsByUser[params[0]]].filter(Boolean),
      })],
      [/UPDATE user_games_stats/, async (_s, params) => ({ rowCount: 1 })],
    ]);
    const app = createApp();
    const res = await request(app)
      .get('/api/v1/games')
      .set('Authorization', 'Bearer ' + signToken(8, 'user'));
    expect(res.status).toBe(200);
    expect(res.body.data.tetris.best).toBe(999);
  });
});
