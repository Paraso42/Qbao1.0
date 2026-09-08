#Requires -Version 5.1
<#
.SYNOPSIS
  环境冒烟巡检：beta = 只读 + 可写 E2E（成绩上报写内测库）；prod = 金丝雀只读，零写操作。
.DESCRIPTION
  账号与 URL 从 local/stage.env.ps1 读取（模板 scripts/stage.env.example.ps1）。
  断言逐项 PASS/FAIL，任一 FAIL 退出码非 0。
.PARAMETER Env
  beta | prod
.PARAMETER Marble
  追加弹猪乐 profile 只读探测（beta 常用）。
.PARAMETER DryRun
  只打印配置摘要与执行计划，不发起请求（脚本自检用）。
.EXAMPLE
  ./scripts/qa/smoke-stage.ps1 -Env beta -Marble
#>
param(
  [ValidateSet('beta', 'prod')][string]$Env = 'beta',
  [switch]$Marble,
  [switch]$DryRun
)
$ErrorActionPreference = 'Stop'
$Repo = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$StageCfg = Join-Path $Repo 'local/stage.env.ps1'
if (-not (Test-Path $StageCfg)) { Write-Host ('缺少配置: ' + $StageCfg) -ForegroundColor Red; exit 1 }
. $StageCfg
if (-not $StageEnv.ContainsKey($Env)) { Write-Host ("配置中无环境 '" + $Env + "'") -ForegroundColor Red; exit 1 }
$C = $StageEnv[$Env]
if ([string]::IsNullOrEmpty($C.ApiBase)) { Write-Host '配置不完整' -ForegroundColor Red; exit 1 }

Write-Host ('== 冒烟巡检: ' + $Env + ' ==') -ForegroundColor Green
Write-Host ('   API:   ' + $C.ApiBase)
Write-Host ('   账号:  ' + $C.User + '（prod=只读金丝雀 / beta=内测账号）')
if ($DryRun) {
  $plan = '仅打印计划：health → login → /users/me → /games'
  if ($Marble) { $plan += ' → marble/profile' }
  if ($Env -eq 'beta') { $plan += ' → 成绩上报(写内测库)' } else { $plan += '（无写操作）' }
  Write-Host ('[DryRun] ' + $plan)
  exit 0
}

$fail = 0
function Check([string]$Name, [bool]$Ok, [string]$Detail = '') {
  if ($Ok) { Write-Host ('PASS  ' + $Name) -ForegroundColor Green }
  else { Write-Host ('FAIL  ' + $Name + '  ' + $Detail) -ForegroundColor Red; $script:fail++ }
}

try {
  $h = Invoke-RestMethod -TimeoutSec 25 -Uri $C.Health
  Check 'health' ($null -ne $h)
} catch { Check 'health' $false $_.Exception.Message }

$token = $null
try {
  $body = @{ username = $C.User; password = $C.Pass } | ConvertTo-Json
  $lg = Invoke-RestMethod -Method Post -TimeoutSec 25 -Uri ($C.ApiBase + '/auth/login') -ContentType 'application/json' -Body $body
  $token = $lg.token
  Check 'login' (-not [string]::IsNullOrEmpty($token))
} catch { Check 'login' $false $_.Exception.Message }

if (-not [string]::IsNullOrEmpty($token)) {
  $auth = @{ Authorization = 'Bearer ' + $token }
  try { $me = Invoke-RestMethod -TimeoutSec 25 -Uri ($C.ApiBase + '/users/me') -Headers $auth; Check '/users/me' ($null -ne $me) }
  catch { Check '/users/me' $false $_.Exception.Message }
  try { $gs = Invoke-RestMethod -TimeoutSec 25 -Uri ($C.ApiBase + '/games') -Headers $auth; Check '/games' ($null -ne $gs) }
  catch { Check '/games' $false $_.Exception.Message }
  if ($Env -eq 'beta') {
    try {
      $rep = @{ gameId = '2048'; score = 1; plays = 1 } | ConvertTo-Json
      $null = Invoke-RestMethod -Method Post -TimeoutSec 25 -Uri ($C.ApiBase + '/games') -Headers $auth -ContentType 'application/json' -Body $rep
      Check '成绩上报(写内测库)' $true
    } catch { Check '成绩上报(写内测库)' $false $_.Exception.Message }
    if ($Marble) {
      try { $p = Invoke-RestMethod -TimeoutSec 25 -Uri ($C.ApiBase + '/games/marble/profile') -Headers $auth; Check 'marble profile(读)' ($null -ne $p.data) }
      catch { Check 'marble profile(读)' $false $_.Exception.Message }
    }
  } else {
    Write-Host 'note: prod 仅只读巡检，跳过一切写操作' -ForegroundColor DarkGray
  }
}

Write-Host ''
if ($fail -gt 0) { Write-Host ('冒烟未通过，失败项: ' + $fail) -ForegroundColor Red; exit 1 }
Write-Host '冒烟全部通过' -ForegroundColor Green
