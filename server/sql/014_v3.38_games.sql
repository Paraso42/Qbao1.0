-- v3.38：游戏空间成绩（每用户单行 JSONB）
-- best/level 只升不降、plays 累加由服务端 CAS 合并保证（见 games.routes.js）
CREATE TABLE IF NOT EXISTS user_games_stats (
  user_id    BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  data       JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
