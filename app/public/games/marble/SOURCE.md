# 弹猪乐 — 来源与本地改动

- 上游：https://github.com/anshang1766/marble-wx-game（微信小游戏「高尔顿灯阵 · 弹一弹」，Matter.js 单球高尔顿板弹珠机）
- commit：71f43f9（2026-09-07）
- 授权：上游仓库暂无 LICENSE 文件；由作者 anshang1766 授权 Qbao 集成使用（同学自研项目，非开源许可，仅限本项目托管）。
- 上游只读镜像与移植手册：仓库 `party/marble-wx-game/`（含 web-port/ 补丁脚本，可复现）。

## 本目录构成

| 文件 | 说明 |
| ---- | ---- |
| `index.html` | 页面骨架（全屏 canvas + 积分 chip + QA 钩子） |
| `matter.js` | 上游自带 matter-js 0.20.0（webpack UMD，浏览器直接可用） |
| `game.js` | 上游 game.js 的 Web 移植版（外科补丁见下，物理/数值原样） |
| `webwx.js` | wx.* 适配层 + Qbao 云存档桥（档案/对局/兑换/购买/免费领取）+ DOM toast/modal/chip |
| `SOURCE.md` | 本文档 |

## 本地改动清单（相对上游 game.js）

1. `require('./matter.js')` → 浏览器全局 `window.Matter`（UMD）。
2. 全部 `wx.*` → `webwx.js` 适配层（canvas/触摸/存储/toast/modal；Pointer Events 兼容鼠标与触屏）。
3. 云存档模式（登录）：开局倍率/亮灯由服务端随机并扣押珠（`round/start`），落槽上报（`round/result`）服务端判定；
   商城购买/装备、每日免费领取、钻石换弹珠、积分双向兑换全部走后端 `/api/v1/games/marble/*`；余额以服务端返回为准。
4. 游客模式：保留上游本地存档玩法（localStorage `qb:galtonGame`），成绩仍按账号上报 `/api/v1/games`（best/plays）。
5. 商城新增 Qbao 兑换区：积分 → 弹珠 1:10（不设上限）、钻石 → 积分 1:2（每日 50 分上限展示）；顶部积分 chip 点击可刷新。
6. 全文件包入 IIFE，规避 `window.top` 等浏览器全局命名冲突。
7. 物理参数、钉阵/轨道布局、皮肤价格与效果数值与上游一致，未做平衡性改动。

## 验证

- `node --check game.js webwx.js` 通过；服务端 228 例 vitest（含 marble 25 例）通过。
- 浏览器冒烟：`/games/marble/index.html?qa=1` 自动完成「投珠×5 → 确认倍率 → 蓄力发射 → 结算弹窗」全流程（游客模式）。

> 更新上游：把新版本 game.js/matter.js 复制进来后按 `party/marble-wx-game/web-port/PORT.md` 重打补丁，并更新本文件 commit 与改动清单；禁止直接覆盖。