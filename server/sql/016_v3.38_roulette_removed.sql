-- 016 — 下线 v3.38 轮盘（自研 3D 轮盘整体移除）：删除 roulette_bets 表
-- 历史 points_ledger（roulette_bet/roulette_win）行保留，余额不受影响
DROP TABLE IF EXISTS roulette_bets;
