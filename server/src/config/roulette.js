'use strict';

// ============================================================
// roulette.js — 俄罗斯轮盘（赌场转盘）常量配置（v3.38）
// 积分试点第一站：结算全部服务端裁决，规则数值集中于此可调。
// 与前端 app/public/games/roulette/roulette.js 的常量保持同步
// （前端用于渲染，裁决一律以本文件为准）。
// ============================================================

// 欧版轮盘 0-36 标准配色（索引=数字；0 为绿色，不属红/黑）
const RED_NUMBERS = [1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36];
const NUMBER_COLORS = (function () {
  const colors = ['green'];
  for (let n = 1; n <= 36; n++) colors.push(RED_NUMBERS.indexOf(n) >= 0 ? 'red' : 'black');
  return colors;
})();

module.exports = {
  MIN_BET: 1,                 // 单注最小金额
  MAX_BET: 100000,            // 单注/单局总注硬顶（INT 安全，防溢出）
  MAX_SPOTS: 3,               // 一局最多注位数
  DAILY_STAKE_CAP: 500,       // 每日押注总额上限（0 表示关闭）
  WIN_MULT: { color: 2, parity: 2, combo: 4, green: 35 }, // 命中返回倍数（含本金）

  // 组合注（颜色∩奇偶）合法配对：默认仅开放数学对称的「红+偶」「黑+奇」
  // （各 8/37 数字，4× 下庄家稳定微利，盘面无漏洞）。
  // 如需放开全组合，改为 [['red','odd'],['red','even'],['black','odd'],['black','even']]——
  // 注意「红+奇」实为 10/37，统一 4× 将带来约 8% 玩家长期微利，须搭配每日上限。
  COMBO_PAIRS: [['red', 'even'], ['black', 'odd']],

  NUMBER_COLORS,

  // —— 命中判定（0 不属任何颜色/奇偶）——
  colorWins(color, number) { return number !== 0 && NUMBER_COLORS[number] === color; },
  parityWins(parity, number) {
    if (number === 0) return false;
    return parity === 'odd' ? number % 2 === 1 : number % 2 === 0;
  },
  comboWins(pair, number) {
    return this.colorWins(pair[0], number) && this.parityWins(pair[1], number);
  },
};
