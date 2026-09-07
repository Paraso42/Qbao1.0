// Qbao 适配: vue3 插件 + 子路径 base + 本地开发代理(与生产 nginx 规则一致)
import vue from "@vitejs/plugin-vue";

export default {
  plugins: [vue()],
  base: "/games/werewolf/",
  server: {
    port: 3000,
    strictPort: true,
    proxy: {
      // HTTP API: 剥离 /games/werewolf/api 前缀 -> 后端根路由
      "/games/werewolf/api": {
        target: "http://127.0.0.1:3011",
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/games\/werewolf\/api/, ""),
      },
      // WebSocket: 路径原样透传(后端监听完整路径)
      "/games/werewolf/werewolf-ws": {
        target: "http://127.0.0.1:3011",
        ws: true,
      },
    },
  },
};
