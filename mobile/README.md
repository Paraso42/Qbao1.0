# Qbao 手机端壳工程（Capacitor 6）

把现网 Qbao 主站（http://114.55.210.82）打包为原生壳应用，包名 `com.qbao.app`、应用名 **Qbao**：
- **Android**：本机（或任意平台）可直接产出正式签名 APK，经 `scripts/publish-mobile.js` 发布到
  `downloads/android/`，由网页端「设置 → 下载中心」与落地页 /dl 自动分发（多版本 + SHA256 + 下载统计）。
- **iOS**：`ios/` 为完整 Xcode 工程；.ipa 需 macOS + Apple Developer 账号签名后发布（见 docs/PUBLISHING.md §8.3）。

## 目录
```
mobile/
├── capacitor.config.ts        # appId/appName/加载地址（唯一配置入口；server.url=主站）
├── package.json
├── icon/                      # 品牌图标 SVG 母版（favicon 同源：渐变 + 白色 Q）
├── scripts/make-icons.mjs     # 母版 → Android mipmap / adaptive / iOS AppIcon（sharp）
├── qbao-release.keystore      # release 签名（别名 qbao / 口令见 android/app/build.gradle，升级必须沿用）
├── android/                   # Android 工程（Gradle，compileSdk 34 / minSdk 22）
└── ios/                       # iOS Xcode 工程（Mac 上 pod install 后构建）
```

## Android 构建
```bash
cd android && gradlew.bat assembleRelease   # 产物 app/build/outputs/apk/release/app-release.apk
```
- 首次构建需 JDK 17 + Android SDK（platform-34 / build-tools 34.0.0，见 `android/local.properties`）。
- Gradle 发行版在 `gradle-wrapper.properties` 已指向腾讯镜像（官方源经 307 跳到 GitHub，本网络不可达；
  环境有代理时可改回官方并去掉 networkTimeout 备注）。
- 版本号：`android/app/build.gradle` versionCode/versionName；发布命令见 docs/PUBLISHING.md §8。

## 发布（入库 downloads/ + 公网自动呈现）
```bash
node scripts/publish-mobile.js add --platform android --dir <暂存目录> --notes "说明"
node scripts/publish-mobile.js ls
```

## iOS（Mac 侧）
1. 拷贝 `mobile/ios` 与 `capacitor.config.ts` 到 Mac；`cd ios/App && pod install`；
2. Xcode 打开 `App.xcworkspace` → 选 Team（Apple Developer）→ 真机/Archive；
3. 出包 `Qbao-iOS-X.Y.Z.ipa` → 按 PUBLISHING.md §8.3 入库。

## 换域名 / 上 HTTPS
1. 只改 `capacitor.config.ts` 的 `server.url`；
2. 删除 AndroidManifest 的 `usesCleartextTraffic` 与 Info.plist 的 `NSAllowsArbitraryLoads`；
3. `npx cap sync`（会覆盖原生工程改动用例：Android 需重加签名/明文配置时直接重打）后重新打包。

## 图标
改 `icon/*.svg` 后运行 `node mobile/scripts/make-icons.mjs`（依赖 sharp，仓库根 node_modules）。
