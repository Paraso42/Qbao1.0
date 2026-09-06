'use strict';

// roulette 路由测试：鉴权 + zod 校验（422）+ 余额不足（400）+ 每日押注上限（400）
// + 各类注位结算（红/黑/奇/偶/组合/绿，0 特殊判定）+ 幂等重放不双扣 + 回滚 + 用户隔离。

const request = require('supertest');
const crypto = require('crypto');
const { installFakePool } = require('./helpers');
const { createApp } = require('../app');
const { signToken } = require('../src/auth');

function authPool() {
  installFakePool([[ /SELECT is_banned FROM users/, async () => ({ rows: [] }) ]]);
}

// 固定开奖号（randomInt 被 mocked；号码 0-36 见 config NUMBER_COLORS）
function mockNumber(n) {
  return vi.spyOn(crypto, 'randomInt').mockReturnValue(n);
}

// 通用 happy-path matchers：余额 100，赌注 10
function happyMatchers({ dailyUsed = 0 } = {}) {
  return [
    [/SELECT is_banned FROM users/, async () => ({ rows: [] })],
    [/INSERT INTO roulette_bets/, async () => ({ rowCount: 1 })],
    [/SUM\(-delta\)/, async () => ({ rows: [{ total: dailyUsed }] })],
    // spendPoints 扣注（条件更新成功）
    [/UPDATE users SET storage_points = storage_points - \$2/, async (_s, params) => ({
      rows: [{ storage_points: 100 - parseInt(params[1]) }],
    })],
    // 台账插入（扣注 + 派彩共用）
    [/INSERT INTO points_ledger/, async () => ({ rowCount: 1 })],
    // awardPoints 派彩
    [/UPDATE users SET storage_points = storage_points \+ \$2/, async (_s, params) => ({
      rows: [{ storage_points: parseInt(params[1]) }],
    })],
    [/UPDATE roulette_bets SET number/, async () => ({ rowCount: 1 })],
    // 结算后查余额
    [/SELECT storage_points FROM users WHERE id/, async () => ({ rows: [{ storage_points: 999 }] })],
  ];
}

describe('roulette 路由校验', () => {
  let token;
  beforeEach(() => {
    process.env.JWT_SECRET = 'test-secret-0123456789';
    token = signToken(1, 'user');
    authPool();
  });
  afterEach(() => { vi.restoreAllMocks(); });

  const okBody = {
    roundId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
    bets: [{ type: 'color', value: 'red', amount: 10 }],
  };

  it('未登录押注 → 401', async () => {
    const app = createApp();
    const res = await request(app).post('/api/v1/roulette/spin').send(okBody);
    expect(res.status).toBe(401);
  });

  it('非法 roundId → 422', async () => {
    const app = createApp();
    const res = await request(app)
      .post('/api/v1/roulette/spin')
      .set('Authorization', 'Bearer ' + token)
      .send({ roundId: 'not-a-uuid', bets: okBody.bets });
    expect(res.status).toBe(422);
  });

  it('无注位 → 422', async () => {
    const app = createApp();
    const res = await request(app)
      .post('/api/v1/roulette/spin')
      .set('Authorization', 'Bearer ' + token)
      .send({ roundId: okBody.roundId, bets: [] });
    expect(res.status).toBe(422);
  });

  it('超过 3 个注位 → 422', async () => {
    const app = createApp();
    const res = await request(app)
      .post('/api/v1/roulette/spin')
      .set('Authorization', 'Bearer ' + token)
      .send({
        roundId: okBody.roundId,
        bets: [
          { type: 'color', value: 'red', amount: 1 },
          { type: 'color', value: 'black', amount: 1 },
          { type: 'parity', value: 'odd', amount: 1 },
          { type: 'green', value: 'green', amount: 1 },
        ],
      });
    expect(res.status).toBe(422);
  });

  it('金额 0 / 超硬顶 → 422', async () => {
    const app = createApp();
    const res = await request(app)
      .post('/api/v1/roulette/spin')
      .set('Authorization', 'Bearer ' + token)
      .send({ roundId: okBody.roundId, bets: [{ type: 'green', value: 'green', amount: 0 }] });
    expect(res.status).toBe(422);
    const res2 = await request(app)
      .post('/api/v1/roulette/spin')
      .set('Authorization', 'Bearer ' + token)
      .send({ roundId: okBody.roundId, bets: [{ type: 'green', value: 'green', amount: 100001 }] });
    expect(res2.status).toBe(422);
  });

  it('一局总注超硬顶 → 422', async () => {
    const app = createApp();
    const res = await request(app)
      .post('/api/v1/roulette/spin')
      .set('Authorization', 'Bearer ' + token)
      .send({
        roundId: okBody.roundId,
        bets: [
          { type: 'color', value: 'red', amount: 60000 },
          { type: 'color', value: 'black', amount: 60000 },
        ],
      });
    expect(res.status).toBe(422);
  });

  it('注位类型与值不匹配 → 422', async () => {
    const app = createApp();
    const res = await request(app)
      .post('/api/v1/roulette/spin')
      .set('Authorization', 'Bearer ' + token)
      .send({ roundId: okBody.roundId, bets: [{ type: 'color', value: 'odd', amount: 10 }] });
    expect(res.status).toBe(422);
  });

  it('未开放组合（如 red+odd）→ 422', async () => {
    const app = createApp();
    const res = await request(app)
      .post('/api/v1/roulette/spin')
      .set('Authorization', 'Bearer ' + token)
      .send({ roundId: okBody.roundId, bets: [{ type: 'combo', value: 'red+odd', amount: 10 }] });
    expect(res.status).toBe(422);
  });
});

describe('roulette 业务结算', () => {
  let token;
  beforeEach(() => {
    process.env.JWT_SECRET = 'test-secret-0123456789';
    token = signToken(7, 'user');
  });
  afterEach(() => { vi.restoreAllMocks(); });

  const rid = () => crypto.randomUUID();

  function post(app, body, t) {
    return request(app).post('/api/v1/roulette/spin').set('Authorization', 'Bearer ' + (t || token)).send(body);
  }

  it('押红 10 → 开 1（红）命中 2×：payout 20', async () => {
    mockNumber(1);
    installFakePool(happyMatchers());
    const app = createApp();
    const res = await post(app, { roundId: rid(), bets: [{ type: 'color', value: 'red', amount: 10 }] });
    expect(res.status).toBe(200);
    expect(res.body.number).toBe(1);
    expect(res.body.color).toBe('red');
    expect(res.body.bets[0].hit).toBe(true);
    expect(res.body.bets[0].mult).toBe(2);
    expect(res.body.bets[0].payout).toBe(20);
    expect(res.body.totalStake).toBe(10);
    expect(res.body.payout).toBe(20);
    expect(res.body.replayed).toBeUndefined();
  });

  it('押红 10 → 开 2（黑）未中：payout 0', async () => {
    mockNumber(2);
    installFakePool(happyMatchers());
    const app = createApp();
    const res = await post(app, { roundId: rid(), bets: [{ type: 'color', value: 'red', amount: 10 }] });
    expect(res.status).toBe(200);
    expect(res.body.color).toBe('black');
    expect(res.body.bets[0].hit).toBe(false);
    expect(res.body.payout).toBe(0);
  });

  it('押偶：开 12（红偶）命中 2×；开 21（红奇）未中', async () => {
    mockNumber(12);
    installFakePool(happyMatchers());
    const app = createApp();
    const r1 = await post(app, { roundId: rid(), bets: [{ type: 'parity', value: 'even', amount: 10 }] });
    expect(r1.body.bets[0].hit).toBe(true);
    expect(r1.body.payout).toBe(20);

    mockNumber(21);
    installFakePool(happyMatchers());
    const app2 = createApp();
    const r2 = await post(app2, { roundId: rid(), bets: [{ type: 'parity', value: 'even', amount: 10 }] });
    expect(r2.body.bets[0].hit).toBe(false);
    expect(r2.body.payout).toBe(0);
  });

  it('开 0（绿）：颜色与奇偶均不中', async () => {
    mockNumber(0);
    installFakePool(happyMatchers());
    const app = createApp();
    const res = await post(app, {
      roundId: rid(),
      bets: [
        { type: 'color', value: 'red', amount: 5 },
        { type: 'parity', value: 'even', amount: 5 },
      ],
    });
    expect(res.body.number).toBe(0);
    expect(res.body.color).toBe('green');
    expect(res.body.bets[0].hit).toBe(false);
    expect(res.body.bets[1].hit).toBe(false);
    expect(res.body.payout).toBe(0);
  });

  it('组合 红+偶：开 12 命中 4×；开 21（红奇）未中', async () => {
    mockNumber(12);
    installFakePool(happyMatchers());
    const app = createApp();
    const r1 = await post(app, { roundId: rid(), bets: [{ type: 'combo', value: 'red+even', amount: 10 }] });
    expect(r1.body.bets[0].hit).toBe(true);
    expect(r1.body.bets[0].mult).toBe(4);
    expect(r1.body.payout).toBe(40);

    mockNumber(21);
    installFakePool(happyMatchers());
    const app2 = createApp();
    const r2 = await post(app2, { roundId: rid(), bets: [{ type: 'combo', value: 'red+even', amount: 10 }] });
    expect(r2.body.bets[0].hit).toBe(false);
    expect(r2.body.payout).toBe(0);
  });

  it('组合 黑+奇：开 11 命中 4×', async () => {
    mockNumber(11);
    installFakePool(happyMatchers());
    const app = createApp();
    const res = await post(app, { roundId: rid(), bets: [{ type: 'combo', value: 'black+odd', amount: 10 }] });
    expect(res.body.bets[0].hit).toBe(true);
    expect(res.body.payout).toBe(40);
  });

  it('组合命中判 0 排除：开 0 → 组合不中', async () => {
    mockNumber(0);
    installFakePool(happyMatchers());
    const app = createApp();
    const res = await post(app, { roundId: rid(), bets: [{ type: 'combo', value: 'black+odd', amount: 10 }] });
    expect(res.body.bets[0].hit).toBe(false);
  });

  it('押绿：开 0 命中 35×（10 → 350）；开 5 未中', async () => {
    mockNumber(0);
    installFakePool(happyMatchers());
    const app = createApp();
    const r1 = await post(app, { roundId: rid(), bets: [{ type: 'green', value: 'green', amount: 10 }] });
    expect(r1.body.bets[0].hit).toBe(true);
    expect(r1.body.bets[0].mult).toBe(35);
    expect(r1.body.payout).toBe(350);

    mockNumber(5);
    installFakePool(happyMatchers());
    const app2 = createApp();
    const r2 = await post(app2, { roundId: rid(), bets: [{ type: 'green', value: 'green', amount: 10 }] });
    expect(r2.body.bets[0].hit).toBe(false);
    expect(r2.body.payout).toBe(0);
  });

  it('多注位同局：红+偶 双注各自独立结算', async () => {
    mockNumber(12); // 红+偶
    installFakePool(happyMatchers());
    const app = createApp();
    const res = await post(app, {
      roundId: rid(),
      bets: [
        { type: 'color', value: 'red', amount: 10 },
        { type: 'parity', value: 'even', amount: 10 },
      ],
    });
    expect(res.body.bets[0].hit).toBe(true);
    expect(res.body.bets[1].hit).toBe(true);
    expect(res.body.payout).toBe(40);
  });

  it('余额不足 → 400 积分不足', async () => {
    mockNumber(1);
    installFakePool([
      [/SELECT is_banned/, async () => ({ rows: [] })],
      [/INSERT INTO roulette_bets/, async () => ({ rowCount: 1 })],
      [/SUM\(-delta\)/, async () => ({ rows: [{ total: 0 }] })],
      // spendPoints 条件更新失败（余额不足）
      [/UPDATE users SET storage_points = storage_points - \$2/, async () => ({ rows: [] })],
      [/SELECT storage_points FROM users WHERE id/, async () => ({ rows: [{ storage_points: 5 }] })],
    ]);
    const app = createApp();
    const res = await post(app, { roundId: rid(), bets: [{ type: 'color', value: 'red', amount: 10 }] });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('积分不足');
  });

  it('每日押注总额超上限 → 400', async () => {
    mockNumber(1);
    installFakePool(happyMatchers({ dailyUsed: 495 }));
    const app = createApp();
    const res = await post(app, { roundId: rid(), bets: [{ type: 'color', value: 'red', amount: 10 }] });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('已达上限');
  });

  it('幂等重放：同 roundId 第二次不扣分、返回原结果', async () => {
    mockNumber(1);
    let spendCalls = 0;
    installFakePool([
      [/SELECT is_banned/, async () => ({ rows: [] })],
      [/INSERT INTO roulette_bets/, async () => ({ rowCount: 1 })],
      [/SUM\(-delta\)/, async () => ({ rows: [{ total: 0 }] })],
      [/UPDATE users SET storage_points = storage_points - \$2/, async () => { spendCalls++; return { rows: [{ storage_points: 90 }] }; }],
      [/INSERT INTO points_ledger/, async () => ({ rowCount: 1 })],
      [/UPDATE users SET storage_points = storage_points \+ \$2/, async () => ({ rows: [{ storage_points: 110 }] })],
      [/UPDATE roulette_bets SET number/, async () => ({ rowCount: 1 })],
      [/SELECT storage_points FROM users WHERE id/, async () => ({ rows: [{ storage_points: 110 }] })],
    ]);
    const app = createApp();
    const roundId = rid();
    const first = await post(app, { roundId, bets: [{ type: 'color', value: 'red', amount: 10 }] });
    expect(first.status).toBe(200);
    expect(first.body.payout).toBe(20);
    expect(spendCalls).toBe(1);

    // 同 roundId 重放：INSERT 冲突 → 返回已存结果
    installFakePool([
      [/SELECT is_banned/, async () => ({ rows: [] })],
      [/INSERT INTO roulette_bets/, async () => ({ rowCount: 0 })],
      [/SELECT id, user_id, total_stake, number/, async () => ({
        rows: [{ id: roundId, user_id: '7', total_stake: 10, number: 1, color: 'red', bets: [{ type: 'color', value: 'red', amount: 10, hit: true, mult: 2, payout: 20 }], payout: 20 }],
      })],
      [/SELECT storage_points FROM users WHERE id/, async () => ({ rows: [{ storage_points: 110 }] })],
    ]);
    const app2 = createApp();
    const again = await post(app2, { roundId, bets: [{ type: 'color', value: 'red', amount: 10 }] });
    expect(again.status).toBe(200);
    expect(again.body.replayed).toBe(true);
    expect(again.body.number).toBe(1);
    expect(again.body.payout).toBe(20);
    expect(spendCalls).toBe(1); // 未再扣分
  });

  it('roundId 被他账号占用 → 409', async () => {
    installFakePool([
      [/SELECT is_banned/, async () => ({ rows: [] })],
      [/INSERT INTO roulette_bets/, async () => ({ rowCount: 0 })],
      [/SELECT id, user_id, total_stake, number/, async () => ({
        rows: [{ id: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee', user_id: '999', total_stake: 10, number: 1, color: 'red', bets: [], payout: 0 }],
      })],
    ]);
    const app = createApp();
    const res = await request(app)
      .post('/api/v1/roulette/spin')
      .set('Authorization', 'Bearer ' + signToken(1, 'user'))
      .send({ roundId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee', bets: [{ type: 'color', value: 'red', amount: 10 }] });
    expect(res.status).toBe(409);
  });

  it('结算异常 → 事务回滚（含 ROLLBACK，无 COMMIT）', async () => {
    mockNumber(1);
    const calls = [];
    const fakeClient = {
      query: async (sql) => {
        const s = String(sql).trim();
        calls.push(s);
        if (/^(BEGIN|COMMIT|ROLLBACK)$/.test(s)) return { rows: [] };
        if (/INSERT INTO roulette_bets/.test(s)) return { rowCount: 1 };
        if (/SUM\(-delta\)/.test(s)) return { rows: [{ total: 0 }] };
        if (/UPDATE users SET storage_points = storage_points -/.test(s)) return { rows: [{ storage_points: 90 }] };
        if (/INSERT INTO points_ledger/.test(s)) return { rowCount: 1 };
        // awardPoints 用户不存在 → 抛 404
        if (/UPDATE users SET storage_points = storage_points \+/.test(s)) return { rows: [] };
        return { rows: [], rowCount: 0 };
      },
      release: () => {},
    };
    const { pool } = require('../src/db');
    installFakePool([[ /SELECT is_banned FROM users/, async () => ({ rows: [] }) ]]);
    pool.query = async () => ({ rows: [], rowCount: 0 });
    pool.connect = async () => fakeClient;
    const app = createApp();
    const res = await post(app, { roundId: rid(), bets: [{ type: 'color', value: 'red', amount: 10 }] });
    expect(res.status).toBe(404);
    expect(calls.filter((c) => /^ROLLBACK$/.test(c)).length).toBe(1);
    expect(calls.filter((c) => /^COMMIT$/.test(c)).length).toBe(0);
  });

  it('用户隔离：A 押注不影响 B 的余额', async () => {
    mockNumber(1);
    installFakePool(happyMatchers());
    const app = createApp();
    const resA = await post(app, { roundId: rid(), bets: [{ type: 'color', value: 'red', amount: 10 }] }, signToken(7, 'user'));
    expect(resA.status).toBe(200);
    installFakePool([
      [/SELECT is_banned/, async () => ({ rows: [] })],
      [/INSERT INTO roulette_bets/, async () => ({ rowCount: 1 })],
      [/SUM\(-delta\)/, async () => ({ rows: [{ total: 0 }] })],
      [/UPDATE users SET storage_points = storage_points - \$2/, async () => ({ rows: [{ storage_points: 50 }] })],
      [/INSERT INTO points_ledger/, async () => ({ rowCount: 1 })],
      [/UPDATE roulette_bets SET number/, async () => ({ rowCount: 1 })],
      [/SELECT storage_points FROM users WHERE id/, async () => ({ rows: [{ storage_points: 50 }] })],
    ]);
    const app2 = createApp();
    const resB = await post(app2, { roundId: rid(), bets: [{ type: 'green', value: 'green', amount: 1 }] }, signToken(8, 'user'));
    expect(resB.status).toBe(200);
    expect(resB.body.balance).toBe(50);
  });
});
