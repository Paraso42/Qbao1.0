import type { CapacitorConfig } from '@capacitor/cli';

// Qbao 全量应用手机壳（默认加载现网主站 https://questionbox.cn：Cloudflare 边缘 → 香港 Caddy → 大陆源站）
// 内测版：scripts/build-beta-apk.ps1（QBAO_SHELL_URL/QBAO_APP_ID/QBAO_APP_NAME 环境变量仅用于 cap sync 生成原生资产；
//        applicationId/应用名/版本由 android build.gradle 的 -PqbaoBeta 属性切换，见 scripts/build-beta-apk.ps1）
// 发版：改 android/app/build.gradle versionCode/versionName（iOS 在 Xcode 工程）
const shellUrl = process.env.QBAO_SHELL_URL || 'https://questionbox.cn';
const shellAppId = process.env.QBAO_APP_ID || 'com.qbao.app';
const shellAppName = process.env.QBAO_APP_NAME || 'Qbao';
const config: CapacitorConfig = {
  appId: shellAppId,
  appName: shellAppName,
  webDir: 'www',
  server: {
    url: shellUrl
  }
};

export default config;