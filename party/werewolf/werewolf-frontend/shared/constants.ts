// ===== Qbao 部署适配修改 =====
// 本游戏部署在站点子路径 /games/werewolf 下（与作者原站根路径部署不同）：
//  - 前端静态、HTTP API(/games/werewolf/api/*) 与 WebSocket(/games/werewolf/werewolf-ws) 共用此前缀，
//    由 nginx（生产）/ vite proxy（本地开发）剥离前缀后转发给后端 3011 端口。
//  - 后端 socket.io 监听路径保持 WS_PATH_CLIPED(/werewolf-ws) 不变。
export const GAME_BASE = "/games/werewolf";

// 二维码里的加入链接必须是绝对地址（手机扫码）；改为运行时同源：部署在任何 https 域名下自动正确，
// 本地 vite dev 也为 localhost；用 globalThis 守卫以兼容 Node 侧 tsc 编译（无 DOM lib）
export const CLIENT_BASE_URL = ((globalThis as { location?: { origin?: string } }).location?.origin || "") + GAME_BASE;
// ===== end Qbao 适配 =====

export const SERVER_DOMAIN = "";

export const SERVER_BASE_URL = GAME_BASE + "/api";

export const WS_PATH_CLIPED = "/werewolf-ws";
export const WS_PATH = GAME_BASE + WS_PATH_CLIPED;

export const IDHeaderName = "player-id";
export const RoomNumberHeaderName = "room-number";
