-- v3.38: 俄罗斯轮盘（赌场转盘）押注记录表（积分系统试点第一站）。
-- 余额与台账沿用 v3.29 积分系统（users.storage_points + points_ledger）；
-- 本表仅记录每局开奖与注位结算，供 roundId 幂等重放、对账与审计。
CREATE TABLE IF NOT EXISTS roulette_bets (
  id UUID PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  total_stake INTEGER NOT NULL,
  number INTEGER NOT NULL,
  color TEXT NOT NULL,
  bets JSONB NOT NULL DEFAULT '[]',
  payout INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_roulette_bets_user_time
  ON roulette_bets(user_id, created_at DESC);

GRANT ALL PRIVILEGES ON TABLE roulette_bets TO qbao;
