// ============================================================
// pointsBridge.js — 积分✗游戏对接口（事件通道 v0 预留；俄罗斯轮盘已直连 /api/v1/roulette/spin 真实结算）
//
// 契约文档：docs/GAMES.md §积分对接（v0）
// 注意：games/roulette 的押注结算不经过本桥；本桥仍为「游戏事件奖励」v0 stub（未来：POST /api/v1/points/events）
// （接入现有 pointsService 账本；防刷：同游戏频率限制 + 日上限 + 服务端校验）。
// 当前实现：校验入参 + 拒绝执行 + 留痕，绝不产生任何积分变动。
// ============================================================

const VALID_GAME_IDS = ['2048', 'froggy', 'gridgarden', 'tetris']

/**
 * 提交游戏事件（v0：仅校验与留痕，不产生积分）。
 * @param {string} event - 事件名（'game.completed' / 'game.score'，契约预定义）
 * @param {object} payload - { gameId, score?, level?, meta? }
 * @returns {Promise<{accepted: boolean, reason: string}>}
 */
export async function submitGameEvent(event, payload) {
  const data = payload || {}
  const reason =
    !event || typeof event !== 'string'
      ? 'v0-reserved: 缺少事件名'
      : !VALID_GAME_IDS.includes(data.gameId)
        ? 'v0-reserved: 未知游戏'
        : event !== 'game.completed' && event !== 'game.score'
          ? 'v0-reserved: 未定义事件'
          : null

  if (reason) return { accepted: false, reason }

  // 契约 v0：仅记录，不产生任何积分变动（防误发被当作已实现）
  console.info('[pointsBridge] 游戏事件已接收（积分未生效，v0 预留）:', event, data)
  return { accepted: false, reason: 'v0-reserved' }
}