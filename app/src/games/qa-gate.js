// QA 钩子宿主门禁（纯函数，配套单测 qa-gate.test.js）。
//
// 规则：自动测试钩子（如游戏页 ?qa=1&token=…）只允许在两类主机名生效：
//   1) 本机调试：localhost / 127.0.0.1 / ::1
//   2) 内测域名：以 "beta." 前缀（约定：内测环境一律挂在 beta. 子域下）
// 其余主机名（生产域名、源站 IP 直连、任意第三方域名）一律返回 false，
// 确保"测试入口"永远不会在生产主机名上被拼参数激活。
//
// 同步约定：游戏静态适配层（如 app/public/games/marble/webwx.js 的 qaGate()）
// 内联同一逻辑；两端改动必须一起提交（与 secureStore / qbao-hook 同步模式一致）。
export function qaAllowedByHost(hostname) {
  const h = String(hostname ?? '').toLowerCase()
  if (h === 'localhost' || h === '127.0.0.1' || h === '::1') return true
  return h.startsWith('beta.')
}
