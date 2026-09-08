#Requires -Version 5.1
<#
.SYNOPSIS
  双环境同步部署工具：L1 内测(beta) / L2 生产(prod)。
.DESCRIPTION
  从本机工作树同步 server 代码与 app 构建产物到远程目录，执行迁移与重启，
  输出后续检查清单。纪律：先 beta 验收、后 prod（docs/DEVELOPMENT_FLOW.md §7）；
  迁移文件先 beta 后 prod（脚本幂等，可安全重跑）。真实主机/密钥从
  local/stage.env.ps1 读取（模板 scripts/stage.env.example.ps1）。
.PARAMETER Env
  beta | prod；传 help 或留空打印用法。
.PARAMETER Mode
  all | server | app | migrate | restart（默认 all）
.PARAMETER SkipBuild
  app 模式默认先执行 npm run build；加此开关跳过（dist 已是最新时用）。
.PARAMETER KeepBaks
  远端保留的静态 .bak_* 数量（默认 5）。
.EXAMPLE
  ./scripts/stage.ps1 -Env beta -Mode all
  ./scripts/stage.ps1 -Env prod -Mode all -SkipBuild
#>
param(
  [string]$Env = '',
  [ValidateSet('server', 'app', 'all', 'migrate', 'restart')][string]$Mode = 'all',
  [switch]$SkipBuild,
  [int]$KeepBaks = 5
)
$ErrorActionPreference = 'Stop'
$Repo = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path

function Show-Usage {
  Write-Host @'
stage.ps1 双环境同步部署
用法:  ./scripts/stage.ps1 -Env beta|prod [-Mode all|server|app|migrate|restart] [-SkipBuild] [-KeepBaks N]
前置:  复制 scripts/stage.env.example.ps1 到 local/stage.env.ps1 并填真实值；
       先 beta 部署并验收通过后，才允许 prod 部署（docs/DEVELOPMENT_FLOW.md 红线）。
'@
  exit 0
}
if ($Env -eq '' -or $Env -eq 'help') { Show-Usage }
if ($Env -notin @('beta', 'prod')) { Write-Host ('未知环境: ' + $Env + '（可选 beta|prod）') -ForegroundColor Red; exit 1 }

$StageCfg = Join-Path $Repo 'local/stage.env.ps1'
if (-not (Test-Path $StageCfg)) {
  Write-Host ('缺少配置: ' + $StageCfg + '（请先复制 scripts/stage.env.example.ps1 并填写）') -ForegroundColor Red
  exit 1
}
. $StageCfg
if (-not $StageEnv.ContainsKey($Env)) { Write-Host ("配置中无环境 '" + $Env + "'") -ForegroundColor Red; exit 1 }
$C = $StageEnv[$Env]
if ([string]::IsNullOrEmpty($C.SshHost) -or [string]::IsNullOrEmpty($C.SshKey)) {
  Write-Host '配置不完整（SshHost/SshKey）' -ForegroundColor Red
  exit 1
}
if ($Env -eq 'prod') {
  Write-Host '注意：prod 部署仅允许在 L1(beta) 验收通过后执行；部署后只做只读巡检（金丝雀账号）。' -ForegroundColor Yellow
}

$sshBase = @('-o', 'BatchMode=yes', '-o', 'IdentitiesOnly=yes', '-o', 'StrictHostKeyChecking=accept-new', '-i', $C.SshKey)

function Invoke-Remote([string]$Cmd, [bool]$Fatal = $true) {
  Write-Host ("[ssh] " + $C.SshHost + ": " + $Cmd) -ForegroundColor Cyan
  & ssh @sshBase $C.SshHost $Cmd 2>&1 | ForEach-Object { Write-Host ("    " + $_) }
  if ($LASTEXITCODE -ne 0 -and $Fatal) { throw ("远端命令失败 (exit " + $LASTEXITCODE + "): " + $Cmd) }
}
function Copy-Up([string]$LocalPath, [string]$RemotePath) {
  Write-Host ("[scp] " + $LocalPath + " -> " + $C.SshHost + ":" + $RemotePath) -ForegroundColor Cyan
  & scp @sshBase $LocalPath ($C.SshHost + ":" + $RemotePath)
  if ($LASTEXITCODE -ne 0) { throw ('scp 失败: ' + $LocalPath) }
}
function Copy-Tree([string]$Src, [string]$Dst, [string[]]$ExcludeDirs, [string[]]$ExcludeFiles) {
  $args = @($Src, $Dst, '/MIR', '/NFL', '/NDL', '/NJH', '/NJS', '/NP')
  foreach ($d in $ExcludeDirs) { $args += '/XD'; $args += $d }
  foreach ($f in $ExcludeFiles) { $args += '/XF'; $args += $f }
  $null = & robocopy $args
  if ($LASTEXITCODE -ge 8) { throw ('robocopy 失败 (code ' + $LASTEXITCODE + '): ' + $Src) }
}
function Test-Health {
  Start-Sleep -Seconds 2
  try {
    $r = Invoke-WebRequest -UseBasicParsing -TimeoutSec 20 -Uri $C.Health
    Write-Host ('健康检查 OK: ' + $C.Health + ' -> ' + $r.StatusCode) -ForegroundColor Green
  } catch {
    throw ('健康检查失败: ' + $_.Exception.Message)
  }
}
function Invoke-StaticProbe {
  try {
    $r = Invoke-WebRequest -UseBasicParsing -TimeoutSec 20 -Uri $C.StaticProbe
    Write-Host ('静态探测 OK: ' + $C.StaticProbe + ' -> ' + $r.StatusCode) -ForegroundColor Green
  } catch {
    throw ('静态探测失败: ' + $_.Exception.Message)
  }
}

$tmp = Join-Path $Repo '.tmp/stage'
if (Test-Path $tmp) { Remove-Item $tmp -Recurse -Force }
New-Item -ItemType Directory -Force -Path $tmp | Out-Null

$doServer = ($Mode -eq 'server' -or $Mode -eq 'all')
$doApp = ($Mode -eq 'app' -or $Mode -eq 'all')

if ($doServer) {
  Write-Host ("== [" + $Env + "] 同步 server 代码 ==") -ForegroundColor Green
  $stageServer = Join-Path $tmp 'server'
  Copy-Tree (Join-Path $Repo 'server') $stageServer @('node_modules', 'uploads', 'coverage', '.git') @('.env')
  $tgz = Join-Path $tmp 'server.tgz'
  & tar -czf $tgz -C $stageServer .
  if ($LASTEXITCODE -ne 0) { throw 'tar server 失败' }
  Invoke-Remote 'mkdir -p /tmp/qbao-stage'
  Copy-Up $tgz '/tmp/qbao-stage/server.tgz'
}
if ($doServer) {
  Invoke-Remote ("tar -xzf /tmp/qbao-stage/server.tgz -C " + $C.CodeDir)
  Invoke-Remote ("cd " + $C.CodeDir + " && node scripts/run_migration.js")
  Invoke-Remote ("systemctl restart " + $C.ApiSvc)
  Test-Health
}
if ($doApp) {
  Write-Host ("== [" + $Env + "] 同步 app 构建产物 ==") -ForegroundColor Green
  if (-not $SkipBuild) {
    Write-Host '构建 app/dist …'
    Push-Location (Join-Path $Repo 'app')
    & npm run build
    $b = $LASTEXITCODE
    Pop-Location
    if ($b -ne 0) { throw 'npm run build 失败' }
  }
  $stageApp = Join-Path $tmp 'app'
  Copy-Tree (Join-Path $Repo 'app/dist') $stageApp @() @()
  $tgz = Join-Path $tmp 'app.tgz'
  & tar -czf $tgz -C $stageApp .
  if ($LASTEXITCODE -ne 0) { throw 'tar app 失败' }
  Invoke-Remote 'mkdir -p /tmp/qbao-stage'
  Copy-Up $tgz '/tmp/qbao-stage/app.tgz'
  $stamp = Get-Date -Format 'yyyyMMdd_HHmmss'
  $staticParent = $C.StaticDir.Substring(0, $C.StaticDir.LastIndexOf('/'))
  $staticBase = $C.StaticDir.Substring($C.StaticDir.LastIndexOf('/') + 1)
  $skipKeep = $KeepBaks + 1
  Invoke-Remote ("mv " + $C.StaticDir + " " + $C.StaticDir + ".bak_" + $stamp + " && mkdir -p " + $C.StaticDir + " && tar -xzf /tmp/qbao-stage/app.tgz -C " + $C.StaticDir)
  Invoke-Remote ("cd " + $staticParent + " && ls -dt " + $staticBase + ".bak_* 2>/dev/null | tail -n +" + $skipKeep + " | xargs -r rm -rf")
  Invoke-StaticProbe
}
if ($Mode -eq 'migrate') {
  Invoke-Remote ("cd " + $C.CodeDir + " && node scripts/run_migration.js")
  Test-Health
}
if ($Mode -eq 'restart') {
  Invoke-Remote ("systemctl restart " + $C.ApiSvc)
  Test-Health
}

Write-Host ''
Write-Host '== 部署完成，后续检查清单 ==' -ForegroundColor Green
Write-Host ('  1) 冒烟：scripts/qa/smoke-stage.ps1 -Env ' + $Env + '（beta 可写 / prod 只读）')
Write-Host '  2) 浏览器验收（beta）：打开内测网址强刷，按待测清单点验'
Write-Host '  3) 缓存提醒：生产静态 7 天缓存——若改动含 js/css，需确认页面引用 ?v= 版本参数已更新（必要时重新部署后强刷）'
Write-Host '  4) 顺序纪律：beta 先行；prod 必须等验收结论（docs/DEVELOPMENT_FLOW.md 红线）'
