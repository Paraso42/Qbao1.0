# ============================================================
# 双环境部署/冒烟配置模板（无敏感信息版本）
# 用法：复制为 local/stage.env.ps1（local/ 已被 gitignore，勿提交）并填真实值。
# 真实环境对照表见 local/ENV.md；流程纪律见 docs/DEVELOPMENT_FLOW.md。
# 字段说明：
#   SshHost / SshKey     SSH 目标与私钥路径（Key 永不提交）
#   CodeDir              远端 server 代码目录（内含 .env 与 node_modules，解包不覆盖）
#   StaticDir            远端静态根（app/dist 内容 + public/games 拷贝）
#   ApiSvc               systemd 单元名
#   Health / ApiBase     健康检查与 API 基址（URL 从 local/ENV.md 取真实值）
#   StaticProbe          静态入口探测 URL
#   User / Pass          巡检账号：prod=金丝雀只读账号；beta=内测账号
# ============================================================
$StageEnv = @{
  prod = @{
    SshHost    = 'root@prod-host'
    SshKey     = 'C:\path\to\prod_key.pem'
    CodeDir    = '/srv/qbao/server'
    StaticDir  = '/srv/qbao/app'
    ApiSvc     = 'qbao-api'
    Health     = 'https://{DOMAIN}/api/v1/health'
    ApiBase    = 'https://{DOMAIN}/api/v1'
    StaticProbe= 'https://{DOMAIN}/games/'
    User       = 'canary-account'
    Pass       = 'change-me'
  }
  beta = @{
    SshHost    = 'root@beta-host'
    SshKey     = 'C:\path\to\beta_key.pem'
    CodeDir    = '/srv/qbao-beta/server'
    StaticDir  = '/srv/qbao-beta/app'
    ApiSvc     = 'qbao-api-beta'
    Health     = 'https://{BETA_HOST}/api/v1/health'
    ApiBase    = 'https://{BETA_HOST}/api/v1'
    StaticProbe= 'https://{BETA_HOST}/games/'
    User       = 'beta-account'
    Pass       = 'change-me'
  }
}
