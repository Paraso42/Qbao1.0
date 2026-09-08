// ============================================================
// gamesManifest.js — 游戏空间清单（v3.40）
// 与 server/src/schemas/games.schema.js 的 GAME_IDS 保持一致；
// CI 冒烟用它断言 app/dist/games 产物齐全。
// ============================================================

export const GAMES = [
  {
    id: '2048',
    name: '2048',
    tag: '休闲',
    desc: '经典数字合成：滑动合并方块，冲向 2048 与更高分。',
    src: 'games/2048/index.html',
    kb: 320,
    license: 'MIT',
    upstream: 'gabrielecirulli/2048',
    commit: '478b6ec',
  },
  {
    id: 'froggy',
    name: 'Flexbox Froggy',
    tag: '教学',
    desc: 'CSS Flexbox 闯关：用 flex 属性送小青蛙回荷叶，24 关。',
    src: 'games/froggy/index.html',
    kb: 860,
    license: 'MIT',
    upstream: 'thomaspark/flexboxfroggy',
    commit: '9a6feab',
  },
  {
    id: 'gridgarden',
    name: 'Grid Garden',
    tag: '教学',
    desc: 'CSS Grid 闯关：为菜园浇水除草，28 关实战演练。',
    src: 'games/gridgarden/index.html',
    kb: 960,
    license: 'MIT',
    upstream: 'thomaspark/gridgarden',
    commit: '0e262f7',
  },
  {
    id: 'tetris',
    name: '俄罗斯方块',
    tag: '休闲',
    desc: '经典消除下落方块，看你能消除多少行。',
    src: 'games/tetris/index.html',
    kb: 68,
    license: 'MIT',
    upstream: 'jakesgordon/javascript-tetris',
    commit: 'e5c0c42',
  },
  {
    id: 'werewolf',
    name: '狼人杀',
    tag: '派对',
    desc: '多人联机狼人杀：免卡牌、免主持人，扫码或房号加入同局。',
    src: 'games/werewolf/index.html',
    kb: 508,
    license: 'MIT',
    upstream: 'xiong35/werewolf',
    commit: '26a77c0',
  },
  {
    id: 'marble',
    name: '弹猪乐',
    tag: '休闲',
    desc: '单球高尔顿板弹珠机：投入弹珠、随机倍率亮灯，命中亮灯槽即得投入×倍率；登录后云端存档，积分可换弹珠（1:10），赢取钻石可换积分（1:2，日限 50 分）。',
    src: 'games/marble/index.html',
    kb: 439,
    license: '个人授权',
    upstream: 'anshang1766/marble-wx-game',
    commit: '71f43f9',
  },
]

// 门户相对路径（兼容网页同源与桌面 file://）
export function gameSrc(id) {
  const g = GAMES.find((x) => x.id === id)
  return g ? g.src : null
}

export const GAME_IDS = GAMES.map((g) => g.id)