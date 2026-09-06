# 俄罗斯方块 — 来源与本地改动

- 上游：https://github.com/jakesgordon/javascript-tetris
- commit：e5c0c42f7dac0f3514a55eff656c6e22e95d68ed（master，2025-06-01）
- 许可：MIT（本目录 LICENSE 为上游原文）

## 引入范围

index.html（单文件游戏，全部 CSS/JS 内联）、stats.js（来自 mrdoob，MIT）、texture.jpg。

## 本地改动清单（相对上游）

1. index.html：`lose()` 内上报成绩 `window.__qbaoGame.report({ score })`（ESC 退出与自然结束均经 lose）。
2. index.html：挂载成绩钩子（`__QBAO_GAME_ID__='tetris'` + 引入 common/qbao-hook.js）。

> 上游无广告/统计脚本，未做剔除；stats.js 未修改。
