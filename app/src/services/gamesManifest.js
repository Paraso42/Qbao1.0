// ============================================================
// gamesManifest.js — 游戏空间清单（v3.38）
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
    id: 'roulette',
    name: '俄罗斯轮盘',
    tag: '积分',
    desc: '赌场转盘：押注红黑/奇偶/组合/绿色，小球落定翻倍结算（虚拟积分，服务端裁决）。',
    src: 'games/roulette/index.html',
    kb: 40,
    license: 'MIT',
    upstream: 'Paraso42/Qbao',
    commit: 'self-built',
  },
]

// 门户相对路径（兼容网页同源与桌面 file://）
export function gameSrc(id) {
  const g = GAMES.find((x) => x.id === id)
  return g ? g.src : null
}

export const GAME_IDS = GAMES.map((g) => g.id)