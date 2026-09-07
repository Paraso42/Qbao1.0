import type { CapacitorConfig } from '@capacitor/cli';

// Qbao 全量应用手机壳（加载现网主站 https://questionbox.cn：Cloudflare 边缘 → 香港 Caddy → 大陆源站）
// 发版：改 android/app/build.gradle versionCode/versionName（iOS 在 Xcode 工程）
const config: CapacitorConfig = {
  appId: 'com.qbao.app',
  appName: 'Qbao',
  webDir: 'www',
  server: {
    url: 'https://questionbox.cn'
  }
};

export default config;
