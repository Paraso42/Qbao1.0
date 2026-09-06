# Flexbox Froggy — 来源与本地改动

- 上游：https://github.com/thomaspark/flexboxfroggy
- commit：9a6feab850a56cbe9ad90f3afcc95e88335bbec8（main，2026-01-04）
- 许可：MIT（本目录 LICENSE 为上游原文）

## 引入范围

index.html、css/style.css、js/levels|docs|messages|game.js、images/（frog-*、lilypad-* 共 12 个 svg）。
未引入：images/screenshot.png、images/games/（站外推荐图）、package.json 等工程文件。
jquery 与 animate.css 由 common/ 共享（取自 gridgarden 上游提交的 node_modules，jquery 3.x、animate.css 3.x）。

## 本地改动清单（相对上游）

1. index.html：删除官网 og:/twitter: URL 类 meta（og:url/og:image/twitter:url/twitter:image）、fb:app_id、google-adsense-account。
2. index.html：删除 Google Fonts 外链（`fonts.googleapis.com`）。
3. index.html：animate.css 路径 `node_modules/animate.css/animate.min.css` → `../common/animate.min.css`。
4. index.html：jquery 路径 `node_modules/jquery/dist/jquery.min.js` → `../common/jquery.min.js`。
5. index.html：删除站外推荐区块（#share 内 4 个 codepip 游戏链接与图片）。
6. index.html：删除第二行云端推广 credits（Grid Garden / Anchoreum 外链）。
7. index.html：删除 Adsbygoogle 广告三条（script / ins / push）。
8. index.html：删除 Google Analytics 引导脚本（UA-23019901-13）。
9. index.html：末尾挂载成绩钩子（`__QBAO_GAME_ID__='froggy'` + 引入 common/qbao-hook.js）。
10. js/game.js（#next 的 setTimeout 内）：通过一关上报 `window.__qbaoGame.report({ level: game.level + 1 })`。
