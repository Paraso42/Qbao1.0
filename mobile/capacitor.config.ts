import type { CapacitorConfig } from '@capacitor/cli';

// Qbao 全量应用手机壳（加载现网主站，登录/学习/游戏全功能）
// 发版：改 android/app/build.gradle versionCode/versionName（iOS 在 Xcode 工程）
const config: CapacitorConfig = {
  appId: 'com.qbao.app',
  appName: 'Qbao',
  webDir: 'www',
  server: {
    url: 'http://114.55.210.82',
    cleartext: true
  },
  android: {
    allowMixedContent: true
  }
};

export default config;
