-- v3.40：弹猪乐（弹珠游戏 · 账号云存档）钱包与对局
-- 弹珠/钻石为游戏内虚拟道具，余额服务端权威（防篡改/防重置刷）。
-- 与 Qbao 积分双向兑换（1 积分 = MARBLE_EXCHANGE_RATE 弹珠，config/points.js），
-- 弹珠→积分每日上限截断；对局倍率/亮灯槽位由服务端随机（user_marble_rounds），
-- 客户端只做物理表现与落槽上报。合规边界同 roulette 整改：随机输赢只作用于弹珠余额。

CREATE TABLE IF NOT EXISTS user_marble_profiles (
  user_id      BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  marbles      INTEGER NOT NULL DEFAULT 1000 CHECK (marbles >= 0),
  diamonds     INTEGER NOT NULL DEFAULT 0 CHECK (diamonds >= 0),
  data         JSONB NOT NULL DEFAULT '{"owned":{"skins":[0],"bgs":[0],"trails":[0],"halos":[0]},"equipped":{"skin":0,"bg":0,"trail":0,"halo":0}}'::jsonb,
  free_date    DATE,
  free_claims  SMALLINT NOT NULL DEFAULT 0,
  win_date     DATE,
  win_marbles  INTEGER NOT NULL DEFAULT 0,
  win_diamonds INTEGER NOT NULL DEFAULT 0,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS user_marble_rounds (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  wager      INTEGER NOT NULL CHECK (wager BETWEEN 1 AND 100),
  multiplier INTEGER NOT NULL CHECK (multiplier IN (2, 3, 5, 10)),
  lit        INTEGER[] NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  settled_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_marble_rounds_open
  ON user_marble_rounds (user_id, created_at)
  WHERE settled_at IS NULL;
