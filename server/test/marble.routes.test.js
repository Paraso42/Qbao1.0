'use strict';

// marble 路由测试：弹珠云存档 API（profile/round/exchange/purchase/free-claim）
// 用可控假池模拟 user_marble_profiles 与 user_marble_rounds 状态机，不触真实数据库。

const request = require('supertest');
const { installFakePool } = require('./helpers');
const { createApp } = require('../app');
const { signToken } = require('../src/auth');

function freshSim() {
  return {
    marbles: 1000,
    diamonds: 0,
    data: { owned: { skins: [0], bgs: [0], trails: [0], halos: [0] }, equipped: { skin: 0, bg: 0, trail: 0, halo: 0 } },
    freeClaims: 0,
    winM: 0,
    winD: 0,
    points: 100,
    outUsed: 0,
    open: null,
  };
}

// 按 SQL 特征构造假池处理器（顺序敏感：先专后泛）
function makeMatchers(sim) {
  const add = (re, fn) => matchers.push([re, fn]);
  const matchers = [];

  add(/SELECT is_banned FROM users/, async () => ({ rows: [] }));
  add(/INSERT INTO points_ledger/, async (sql, prm) => {
    if (prm[3] === 'marble_out') sim.outUsed += prm[1]; // 台账即弹珠→积分日上限依据
    return { rowCount: 1 };
  });
  add(/SELECT win_marbles, win_diamonds FROM/, async () => ({ rows: [{ win_marbles: sim.winM, win_diamonds: sim.winD }] }));
  add(/COALESCE\(SUM\(delta\)/, async () => ({ rows: [{ s: sim.outUsed }] }));
  add(/SELECT storage_points FROM users WHERE id/, async () => ({ rows: [{ storage_points: sim.points }] }));
  add(/UPDATE users SET storage_points = storage_points - /, async (sql, p) => {
    if (sim.points < p[1]) return { rows: [] };
    sim.points -= p[1];
    return { rows: [{ storage_points: sim.points }] };
  });
  add(/UPDATE users SET storage_points = storage_points \+ /, async (sql, p) => {
    sim.points += p[1];
    return { rows: [{ storage_points: sim.points }] };
  });
  add(/INSERT INTO user_marble_profiles/, async () => ({ rowCount: 0 }));
  add(/UPDATE user_marble_profiles SET free_date/, async () => ({ rowCount: 0 }));
  add(/UPDATE user_marble_profiles SET win_date/, async () => ({ rowCount: 0 }));
  // 过期对局清理：测试中默认无过期对局
  add(/created_at < NOW/, async () => ({ rows: [] }));
  // 结算：按 id 删除未结算对局
  add(/DELETE FROM user_marble_rounds WHERE id/, async (sql, p) => {
    if (!sim.open || sim.open.id !== p[0]) return { rows: [] };
    const r = sim.open;
    sim.open = null;
    return { rows: [{ wager: r.wager, multiplier: r.multiplier, lit: r.lit }] };
  });
  add(/SELECT id, wager, multiplier, lit FROM user_marble_rounds/, async () => ({
    rows: sim.open ? [{ id: sim.open.id, wager: sim.open.wager, multiplier: sim.open.multiplier, lit: sim.open.lit }] : [],
  }));
  add(/INSERT INTO user_marble_rounds/, async (sql, p) => {
    sim.open = { id: '11111111-1111-4111-8111-111111111111', wager: p[1], multiplier: p[2], lit: p[3] };
    return { rows: [{ id: sim.open.id }] };
  });
  // 档案读取（先 6 列后 3 列后单列）
  add(/SELECT marbles, diamonds, data, free_claims, win_marbles, win_diamonds/, async () => ({
    rows: [{ marbles: sim.marbles, diamonds: sim.diamonds, data: sim.data, free_claims: sim.freeClaims, win_marbles: sim.winM, win_diamonds: sim.winD }],
  }));
  add(/SELECT marbles, diamonds, data FROM user_marble_profiles/, async () => ({
    rows: [{ marbles: sim.marbles, diamonds: sim.diamonds, data: sim.data }],
  }));
  add(/SELECT marbles FROM user_marble_profiles/, async () => ({ rows: [{ marbles: sim.marbles }] }));
  add(/SELECT marbles, diamonds FROM user_marble_profiles/, async () => ({
    rows: [{ marbles: sim.marbles, diamonds: sim.diamonds }],
  }));
  // 余额变动
  add(/marbles = marbles - \$2/, async (sql, p) => {
    if (sim.marbles < p[1]) return { rows: [] };
    sim.marbles -= p[1];
    return { rows: [{ marbles: sim.marbles }] };
  });
  add(/diamonds = diamonds - \$2, marbles = marbles \+ \$3/, async (sql, p) => {
    if (sim.diamonds < p[1]) return { rows: [] };
    sim.diamonds -= p[1];
    sim.marbles += p[2];
    return { rows: [{ marbles: sim.marbles, diamonds: sim.diamonds }] };
  });
  add(/diamonds = diamonds - \$2, updated_at/, async (sql, p) => {
    if (sim.diamonds < p[1]) return { rows: [] };
    sim.diamonds -= p[1];
    return { rows: [{ diamonds: sim.diamonds }] };
  });
  add(/free_claims = free_claims \+ 1/, async (sql, p) => {
    if (sim.freeClaims >= p[2]) return { rows: [] };
    sim.freeClaims += 1;
    sim.marbles += p[1];
    return { rows: [{ marbles: sim.marbles, free_claims: sim.freeClaims }] };
  });
  add(/win_marbles = win_marbles/, async (sql, p) => {
    sim.marbles += p[1];
    sim.winM += p[1];
    sim.diamonds += p[2];
    sim.winD += p[2];
    return { rowCount: 1 };
  });
  add(/marbles = marbles \+ \$2/, async (sql, p) => {
    sim.marbles += p[1];
    return { rows: [{ marbles: sim.marbles }] };
  });
  add(/UPDATE user_marble_profiles SET data =/, async (sql, p) => {
    sim.data = typeof p[1] === 'string' ? JSON.parse(p[1]) : p[1];
    return { rowCount: 1 };
  });
  return matchers;
}

const ROUND_ID = '11111111-1111-4111-8111-111111111111';
const LIT_COUNT = { 2: 5, 3: 4, 5: 2, 10: 1 };

function boot(sim) {
  installFakePool(makeMatchers(sim));
  return createApp();
}

describe('marble 鉴权', () => {
  beforeEach(() => { process.env.JWT_SECRET = 'test-secret-0123456789'; });
  it.each([
    ['GET', '/api/v1/games/marble/profile'],
    ['POST', '/api/v1/games/marble/round/start'],
    ['POST', '/api/v1/games/marble/round/result'],
    ['POST', '/api/v1/games/marble/exchange'],
    ['POST', '/api/v1/games/marble/purchase'],
    ['POST', '/api/v1/games/marble/free-claim'],
  ])('%s %s 未登录 → 401', async (method, url) => {
    const app = boot(freshSim());
    const res = await request(app)[method.toLowerCase()](url)
      .send(method === 'GET' ? {} : { wager: 10, roundId: ROUND_ID, slot: 0, dir: 'in', marbles: 100, cat: 'skins', idx: 1 });
    expect(res.status).toBe(401);
  });
});

describe('marble 档案与对局', () => {
  let token;
  beforeEach(() => {
    process.env.JWT_SECRET = 'test-secret-0123456789';
    token = signToken(7, 'user');
  });
  const auth = (r) => r.set('Authorization', 'Bearer ' + token);

  it('GET profile 新用户 → 默认 1000 弹珠 + 兑换规则字段', async () => {
    const app = boot(freshSim());
    const res = await auth(request(app).get('/api/v1/games/marble/profile'));
    expect(res.status).toBe(200);
    expect(res.body.marbles).toBe(1000);
    expect(res.body.diamonds).toBe(0);
    expect(res.body.exchangeRate).toBe(10);
    expect(res.body.dailyOutCap).toBe(20);
    expect(res.body.dailyOutLeft).toBe(20);
    expect(res.body.freeLeft).toBe(2);
    expect(res.body.pointsBalance).toBe(100);
    expect(res.body.owned.skins).toEqual([0]);
  });

  it('round/start 扣押珠并返回服务端摇出的倍率/亮灯槽', async () => {
    const app = boot(freshSim());
    const res = await auth(request(app).post('/api/v1/games/marble/round/start')).send({ wager: 10 });
    expect(res.status).toBe(200);
    expect(res.body.roundId).toBe(ROUND_ID);
    expect(res.body.marbles).toBe(990);
    expect([2, 3, 5, 10]).toContain(res.body.multiplier);
    expect(res.body.lit.length).toBe(LIT_COUNT[res.body.multiplier]);
  });

  it('round/start 同押珠重放幂等（不重复扣珠）；改押珠 → 409', async () => {
    const app = boot(freshSim());
    const r1 = await auth(request(app).post('/api/v1/games/marble/round/start')).send({ wager: 10 });
    const r2 = await auth(request(app).post('/api/v1/games/marble/round/start')).send({ wager: 10 });
    expect(r2.status).toBe(200);
    expect(r2.body.roundId).toBe(r1.body.roundId);
    expect(r2.body.marbles).toBe(990);
    const r3 = await auth(request(app).post('/api/v1/games/marble/round/start')).send({ wager: 20 });
    expect(r3.status).toBe(409);
  });

  it('round/start 弹珠不足 → 400', async () => {
    const sim = freshSim();
    sim.marbles = 3;
    const app = boot(sim);
    const res = await auth(request(app).post('/api/v1/games/marble/round/start')).send({ wager: 10 });
    expect(res.status).toBe(400);
  });

  it('round/result 命中亮灯槽 → 按 wager×multiplier 入账', async () => {
    const app = boot(freshSim());
    const start = await auth(request(app).post('/api/v1/games/marble/round/start')).send({ wager: 10 });
    const slot = start.body.lit[0];
    const res = await auth(request(app).post('/api/v1/games/marble/round/result')).send({ roundId: start.body.roundId, slot });
    expect(res.status).toBe(200);
    expect(res.body.won).toBe(true);
    expect(res.body.reward).toBe(10 * start.body.multiplier);
    expect(res.body.marbles).toBe(990 + res.body.reward);
    expect(res.body.diamonds).toBe(Math.floor(res.body.reward / 50));
  });

  it('round/result 未命中 → 输掉押珠', async () => {
    const app = boot(freshSim());
    const start = await auth(request(app).post('/api/v1/games/marble/round/start')).send({ wager: 10 });
    const lit = start.body.lit;
    const miss = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].find((s) => lit.indexOf(s) < 0);
    const res = await auth(request(app).post('/api/v1/games/marble/round/result')).send({ roundId: start.body.roundId, slot: miss });
    expect(res.status).toBe(200);
    expect(res.body.won).toBe(false);
    expect(res.body.marbles).toBe(990);
  });

  it('round/result 未知/已结束对局 → 400（不可二次结算）', async () => {
    const app = boot(freshSim());
    const res = await auth(request(app).post('/api/v1/games/marble/round/result')).send({ roundId: ROUND_ID, slot: 0 });
    expect(res.status).toBe(400);
    const start = await auth(request(app).post('/api/v1/games/marble/round/start')).send({ wager: 10 });
    await auth(request(app).post('/api/v1/games/marble/round/result')).send({ roundId: start.body.roundId, slot: 0 });
    const again = await auth(request(app).post('/api/v1/games/marble/round/result')).send({ roundId: start.body.roundId, slot: 0 });
    expect(again.status).toBe(400);
  });

  it('赢取单日上限生效：已达 2000 → 命中不再入账（capped）', async () => {
    const sim = freshSim();
    sim.winM = 2000;
    const app = boot(sim);
    const start = await auth(request(app).post('/api/v1/games/marble/round/start')).send({ wager: 10 });
    const res = await auth(request(app).post('/api/v1/games/marble/round/result')).send({ roundId: start.body.roundId, slot: start.body.lit[0] });
    expect(res.status).toBe(200);
    expect(res.body.won).toBe(true);
    expect(res.body.capped).toBe(true);
    expect(res.body.reward).toBe(0);
    expect(res.body.marbles).toBe(990);
  });
});

describe('marble 兑换/商城/免费领取', () => {
  let token;
  beforeEach(() => {
    process.env.JWT_SECRET = 'test-secret-0123456789';
    token = signToken(7, 'user');
  });
  const auth = (r) => r.set('Authorization', 'Bearer ' + token);

  it('exchange in：10 积分 → 100 弹珠（1:10）', async () => {
    const app = boot(freshSim());
    const res = await auth(request(app).post('/api/v1/games/marble/exchange')).send({ dir: 'in', marbles: 100 });
    expect(res.status).toBe(200);
    expect(res.body.marbles).toBe(1100);
    expect(res.body.pointsBalance).toBe(90);
  });

  it('exchange in 积分不足 → 400', async () => {
    const sim = freshSim();
    sim.points = 5;
    const app = boot(sim);
    const res = await auth(request(app).post('/api/v1/games/marble/exchange')).send({ dir: 'in', marbles: 100 });
    expect(res.status).toBe(400);
  });

  it('exchange out：100 弹珠 → 10 积分；再次兑换超出日上限 → 400', async () => {
    const app = boot(freshSim());
    const ok = await auth(request(app).post('/api/v1/games/marble/exchange')).send({ dir: 'out', marbles: 100 });
    expect(ok.status).toBe(200);
    expect(ok.body.marbles).toBe(900);
    expect(ok.body.pointsBalance).toBe(110);
    const cap = await auth(request(app).post('/api/v1/games/marble/exchange')).send({ dir: 'out', marbles: 200 });
    expect(cap.status).toBe(400);
  });

  it('exchange 数量非 10 的倍数 → 422', async () => {
    const app = boot(freshSim());
    const res = await auth(request(app).post('/api/v1/games/marble/exchange')).send({ dir: 'in', marbles: 15 });
    expect(res.status).toBe(422);
  });

  it('purchase 皮肤：扣弹珠并入库/装备；再次购买同款不再扣费', async () => {
    const sim = freshSim();
    sim.marbles = 2000;
    const app = boot(sim);
    const buy = await auth(request(app).post('/api/v1/games/marble/purchase')).send({ cat: 'skins', idx: 2 });
    expect(buy.status).toBe(200);
    expect(buy.body.owned.skins).toContain(2);
    expect(buy.body.equipped.skins).toBe(2);
    expect(buy.body.marbles).toBe(500);
    const equip = await auth(request(app).post('/api/v1/games/marble/purchase')).send({ cat: 'skins', idx: 2 });
    expect(equip.status).toBe(200);
    expect(equip.body.marbles).toBe(500); // 已拥有 → 仅装备不扣费
  });

  it('purchase 弹珠不足 → 400', async () => {
    const app = boot(freshSim());
    const res = await auth(request(app).post('/api/v1/games/marble/purchase')).send({ cat: 'skins', idx: 1 });
    expect(res.status).toBe(400);
  });

  it('purchase 钻石道具与钻石换弹珠', async () => {
    const sim = freshSim();
    sim.diamonds = 100;
    const app = boot(sim);
    const halo = await auth(request(app).post('/api/v1/games/marble/purchase')).send({ cat: 'halos', idx: 1 });
    expect(halo.status).toBe(200);
    expect(halo.body.owned.halos).toContain(1);
    expect(halo.body.diamonds).toBe(50);
    const conv = await auth(request(app).post('/api/v1/games/marble/purchase')).send({ cat: 'diamond2marble', idx: 0 });
    expect(conv.status).toBe(200);
    expect(conv.body.diamonds).toBe(0);
    expect(conv.body.marbles).toBe(2000);
  });

  it('free-claim：每日 2 次，第 3 次 → 400', async () => {
    const app = boot(freshSim());
    const a = await auth(request(app).post('/api/v1/games/marble/free-claim'));
    const b = await auth(request(app).post('/api/v1/games/marble/free-claim'));
    const c = await auth(request(app).post('/api/v1/games/marble/free-claim'));
    expect(a.status).toBe(200);
    expect(a.body.marbles).toBe(1050);
    expect(a.body.freeLeft).toBe(1);
    expect(b.body.marbles).toBe(1100);
    expect(c.status).toBe(400);
  });
});