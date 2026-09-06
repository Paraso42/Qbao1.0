# 2048 — 来源与本地改动

- 上游：https://github.com/gabrielecirulli/2048
- commit：478b6ec346e3787f589e4af751378d06ded4cbbc（master，2024-10-24）
- 许可：MIT（本目录 LICENSE.txt 为上游原文）

## 引入范围

仅拷贝运行所需文件：index.html、style/main.css、style/fonts/、js/、favicon.ico。
未引入：meta/（苹果启动图）、Rakefile、scss 源、README/CONTRIBUTING。

## 本地改动清单（相对上游）

1. index.html：删除 apple-touch-icon 与两张 apple-touch-startup-image 引用（对应 meta/ 未引入）。
2. index.html：删除「Note: official version…derivatives or fakes」声明段（与 Qbao 托管场景无关）。
3. index.html：末尾挂载成绩钩子：
   `<script>window.__QBAO_GAME_ID__ = '2048';</script>`
   `<script src="../common/qbao-hook.js"></script>`
4. js/game_manager.js（actuate 尾）：游戏结束时上报
   `window.__qbaoGame.report({ score, best })`。

> 上游无广告/统计脚本，未做剔除。
