<#
.SYNOPSIS
  构建 Qbao「内测版」Android 壳 APK（com.qbao.beta · 指向 https://beta.questionbox.cn）。
.DESCRIPTION
  1) 临时改写 android assets 的 capacitor.config.json（server.url/appId/appName → 内测），构建后自动还原为正式版；
  2) gradle -PqbaoBeta（applicationId/应用名/版本号切换，见 android/app/build.gradle）；
  3) 产物：.tmp/beta-apk/Qbao-Android-<version>-beta.N.apk，并打印 sha256 与入库命令。
  纪律：内测包用 publish-mobile.js add --channel beta 入库（下载页/下载中心单列「内测版」）；不进 stable。
.PARAMETER BetaNum
  内测序号（默认 1 → 版本 1.0.1-beta.N）
.EXAMPLE
  ./scripts/build-beta-apk.ps1 -BetaNum 1
#>
param([int]$BetaNum = 1)
$ErrorActionPreference = 'Stop'
$Repo = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$asset = Join-Path $Repo 'mobile/android/app/src/main/assets/capacitor.config.json'
$bak = Join-Path $Repo '.tmp/capacitor.config.beta.bak.json'
$outDir = Join-Path $Repo '.tmp/beta-apk'
$androidDir = Join-Path $Repo 'mobile/android'
if (-not (Test-Path $asset)) { Write-Host ('缺少原生配置资产: ' + $asset) -ForegroundColor Red; exit 1 }
New-Item -ItemType Directory -Force -Path $outDir, (Split-Path $bak) | Out-Null
Copy-Item $asset $bak -Force
try {
  $j = Get-Content -Raw -Path $asset | ConvertFrom-Json
  $j.server.url = 'https://beta.questionbox.cn'
  $j.appId = 'com.qbao.beta'
  $j.appName = 'Qbao 内测'
  ($j | ConvertTo-Json -Depth 6) | Set-Content -Encoding utf8 -Path $asset
  Write-Host 'capacitor.config.json → 内测指向（构建后自动还原）' -ForegroundColor DarkGray
  # cmd/bat 子进程继承的是 pwsh 进程工作目录而非 PS 会话位置 → 用 Start-Process -WorkingDirectory
  $proc = Start-Process -FilePath (Join-Path $androidDir 'gradlew.bat') -ArgumentList @('assembleRelease', '-PqbaoBeta', ('-PbetaNum=' + $BetaNum), '--console=plain') -WorkingDirectory $androidDir -NoNewWindow -Wait -PassThru
  $code = $proc.ExitCode
  if ($code -ne 0) { throw ('gradle 构建失败 exit=' + $code) }
  $apk = Join-Path $androidDir 'app/build/outputs/apk/release/app-release.apk'
  if (-not (Test-Path $apk)) { throw ('未找到产物: ' + $apk) }
  $target = Join-Path $outDir ('Qbao-Android-1.0.1-beta.' + $BetaNum + '.apk')
  Copy-Item $apk $target -Force
  $sha = (Get-FileHash -Path $target -Algorithm SHA256).Hash.ToLower()
  $size = (Get-Item $target).Length
  Write-Host ('内测版 APK 完成: ' + $target) -ForegroundColor Green
  Write-Host ('  版本 1.0.1-beta.' + $BetaNum + ' · ' + [math]::Round($size / 1MB, 2) + ' MB')
  Write-Host ('  sha256: ' + $sha)
  Write-Host '入库命令（按环境指定 --root）：' -ForegroundColor DarkGray
  Write-Host '  node scripts/publish-mobile.js add --platform android --dir .tmp/beta-apk --channel beta --notes "内测版" [--root ./downloads | --root <目标 downloads>]'
} finally {
  if (Test-Path $bak) { Copy-Item $bak $asset -Force; Write-Host 'capacitor.config.json 已还原为正式版指向' -ForegroundColor DarkGray }
}