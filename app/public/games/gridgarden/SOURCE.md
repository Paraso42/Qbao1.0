# Grid Garden — 来源与本地改动

- 上游：https://github.com/thomaspark/gridgarden
- commit：0e262f7272d4992340eb556bdb9b2d502cc59932（master，2026-01-04）
- 许可：MIT（本目录 LICENSE 为上游原文）

## 引入范围

index.html、css/style.css、js/levels|docs|messages|game.js、images/（carrots*、dirt、froggy、poison、water、weeds*）。
未引入：images/screenshot.png、images/games/（站外推荐图）、node_modules 其余文件。
jquery 与 animate.css 由 common/ 共享（取自本上游提交的 node_modules）。

## 本地改动清单（相对上游）

1. index.html：删除官网 og:/twitter: URL 类 meta、google-adsense-account。
2. index.html：删除 Google Fonts 外链。
3. index.html：animate.css 路径 → `../common/animate.min.css`。
4. index.html：jquery 路径 → `../common/jquery.min.js`。
5. index.html：删除站外推荐区块（#share 内 4 个 codepip 游戏链接与图片）。
6. index.html：删除 Google Analytics 引导脚本（UA-23019901-18）。
7. index.html：末尾挂载成绩钩子（`__QBAO_GAME_ID__='gridgarden'` + 引入 common/qbao-hook.js）。
8. js/game.js（#next 的 setTimeout 内）：通过一关上报 `window.__qbaoGame.report({ level: game.level + 1 })`。

> 上游未含广告脚本。
