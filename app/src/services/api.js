// ============================================================
// api.js — 认证与请求封装（自 legacy api.js 迁移）
// token 存放（v3.31 P1.3 加固）：桌面端走主进程 safeStorage（renderer 无明文持久化），
// 网页端最小混淆；旧明文键自动兼容并迁移。登录态由 user store 维护。
// ============================================================
import { API_BASE, IS_DESKTOP, desktopBridge } from '../core/env'
import { obfuscate, deobfuscate, secretNameFor } from './secureStore'

// 桌面端 token 内存镜像（IPC 为异步，同步读取走内存；boot 时 initSecureAuth 预热）
let _memToken = null

export async function initSecureAuth() {
  if (!IS_DESKTOP) return
  const b = desktopBridge()
  if (!b) return
  try {
    const r = await b.secretLoad(secretNameFor('token', ''))
    if (r && r.ok && r.value) {
      _memToken = r.value
      try { localStorage.removeItem('qbao_token') } catch (e) {}
      return
    }
  } catch (e) {}
  // 升级迁移：旧 localStorage 明文/混淆 → 安全存储，然后清明文
  try {
    const legacy = localStorage.getItem('qbao_token')
    if (legacy) {
      const plain = deobfuscate(legacy)
      if (plain !== null && plain !== undefined && plain.length) {
        _memToken = plain
        b.secretSave(secretNameFor('token', ''), plain).catch(() => {})
        try { localStorage.removeItem('qbao_token') } catch (e) {}
      }
    }
  } catch (e) {}
}

export function getToken() {
  if (IS_DESKTOP) {
    if (_memToken !== null) return _memToken
    try {
      const raw = localStorage.getItem('qbao_token')
      if (!raw) return null
      const plain = deobfuscate(raw)
      return plain !== null && plain !== undefined && plain.length ? plain : null
    } catch (e) { return null }
  }
  try {
    const raw = localStorage.getItem('qbao_token')
    if (!raw) return null
    const plain = deobfuscate(raw)
    return plain !== null && plain !== undefined && plain.length ? plain : null
  } catch (e) { return null }
}

export function setToken(t) {
  if (IS_DESKTOP) {
    _memToken = t || null
    const b = desktopBridge()
    if (!b) return
    if (t) {
      b.secretSave(secretNameFor('token', ''), t)
        .then((r) => { if (!r || !r.ok) legacyTokenFallback(t) })
        .catch(() => legacyTokenFallback(t))
    } else {
      b.secretRemove(secretNameFor('token', '')).catch(() => {})
      try { localStorage.removeItem('qbao_token') } catch (e) {}
    }
    return
  }
  try {
    if (t) localStorage.setItem('qbao_token', obfuscate(t))
    else localStorage.removeItem('qbao_token')
  } catch (e) {}
}

// 桌面 safeStorage 不可用时的降级（混淆写 localStorage，功能不中断）
function legacyTokenFallback(t) {
  try {
    if (t) localStorage.setItem('qbao_token', obfuscate(t))
    else localStorage.removeItem('qbao_token')
  } catch (e) {}
}
export function getStoredUser() {
  try { return JSON.parse(localStorage.getItem('qbao_user') || 'null') } catch { return null }
}
export function setStoredUser(u) { if (u) localStorage.setItem('qbao_user', JSON.stringify(u)); else localStorage.removeItem('qbao_user') }

export function clearStoredAuth() { setToken(null); setStoredUser(null) }

// —— 会话令牌钉扎（v3.37.1 多标签页账号守卫核心）——
// localStorage qbao_token/qbao_user 属「整个浏览器档案」的最近登录账号；本标签页的
// 内存数据/业务请求必须始终使用「本标签页启动/登录时」钉扎的令牌，否则其他标签页
// 切换账号后，本页会把旧账号的内存数据发到新账号上（跨标签串号，见 persistence/sync）。
let _pinToken = null
let _authStaleHook = null
export function pinToken(t) { _pinToken = t || null }
export function unpinToken() { _pinToken = null }
export function getPinnedToken() { return _pinToken }
// 请求令牌真源：钉扎 > 活读（钉扎缺失（如未初始化）才回退活读）
export function effectiveToken() { return _pinToken !== null ? _pinToken : getToken() }
// 钉扎令牌已失效（其他标签页重登/失效）→ 由 boot 注册整页重建（冻结同步上下文）
export function setAuthStaleHook(fn) { _authStaleHook = fn }
export function fireAuthStale() { try { if (typeof _authStaleHook === 'function') _authStaleHook() } catch (e) { /* 忽略 */ } }

export async function fetchWithAuth(path, options = {}) {
  const isFormData = options.body instanceof FormData
  const headers = isFormData ? {} : { 'Content-Type': 'application/json' }
  if (options.headers) Object.assign(headers, options.headers)
  const tok = effectiveToken()
  if (tok) headers['Authorization'] = 'Bearer ' + tok
  const fetchOpts = { method: options.method, headers }
  if (options.body) fetchOpts.body = options.body
  if (options.signal) fetchOpts.signal = options.signal
  if (options.keepalive) fetchOpts.keepalive = true // T10: 页面关闭前尽力推送
  const res = await fetch(API_BASE + path, fetchOpts)
  if (res.status === 401) {
    // 401 清登出只允许发生在「本页钉扎令牌 == 档案活读令牌」时（本页即登录上下文）；
    // 若档案已被其他标签页换到别的账号，绝不清理（会把别人登出），而是触发整页重建
    if (!tok || tok === getToken()) {
      clearStoredAuth()
    } else {
      fireAuthStale()
    }
    return null
  }
  return res
}

export function netErrorMessage() {
  return (IS_DESKTOP)
    ? '无法连接服务器 (' + API_BASE + ') — 请检查网络连接或 VPN'
    : '无法连接服务器 (' + API_BASE + ') — 请检查网络'
}

// 登录/注册：仅网络请求，返回 { token, user }；登录态由调用方写入。
export async function apiLogin(username, password) {
  let res
  try {
    res = await fetch(API_BASE + '/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    })
  } catch (e) { throw new Error(netErrorMessage()) }
  if (!res.ok) {
    const e = await res.json().catch(() => ({}))
    throw new Error(e.error || '登录失败')
  }
  return res.json()
}

export async function apiRegister(username, displayName, password) {
  let res
  try {
    res = await fetch(API_BASE + '/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, displayName: displayName || username, password })
    })
  } catch (e) { throw new Error(netErrorMessage()) }
  if (!res.ok) {
    const e = await res.json().catch(() => ({}))
    throw new Error(e.error || '注册失败')
  }
  return res.json()
}

// 统一读取接口错误信息（zod 422 / ApiError 均返回 { error }）
// P2.3：readApiErrorSafe 为统一实现（兼容 res=null/网络异常），readApiError 保留为别名。
export async function readApiErrorSafe(res, fallback) {
  if (!res || typeof res.json !== 'function') return fallback
  try {
    const data = await res.json()
    return (data && data.error) || fallback
  } catch (e) { return fallback }
}
export const readApiError = readApiErrorSafe

// —— 统一请求封装（P2.3）：所有 *Api 模块的唯一网络出口 ——
// opts: { method, headers, auth=true, body(对象→自动 JSON / FormData 原样), rawBody=已序列化字符串,
//         signal, keepalive }
// 行为：自动 Bearer 鉴权；401 清登录态并返回 null（与 fetchWithAuth 一致）；
//       网络异常抛 netErrorMessage()。
export async function apiFetch(path, opts = {}) {
  const method = opts.method || 'GET'
  const headers = {}
  const isForm = opts.body instanceof FormData
  // rawBody = 调用方已序列化的请求体（不再重复 JSON.stringify），此时 opts.body 应省略
  const payload = opts.rawBody !== undefined ? opts.rawBody : opts.body
  if (payload !== undefined && !isForm) headers['Content-Type'] = 'application/json'
  if (opts.headers) Object.assign(headers, opts.headers)
  if (opts.auth !== false) {
    const t = getToken()
    if (t) headers['Authorization'] = 'Bearer ' + t
  }
  let body = payload
  if (body !== undefined && !isForm && opts.rawBody === undefined) body = JSON.stringify(body)
  let res
  try {
    res = await fetch(API_BASE + path, {
      method, headers, body,
      signal: opts.signal,
      keepalive: opts.keepalive ? true : undefined,
    })
  } catch (e) {
    throw new Error(netErrorMessage())
  }
  if (res.status === 401 && opts.auth !== false) { clearStoredAuth(); return null }
  return res
}

// —— 统一响应处理（P2.3）：替代各处重复的私有 _handle ——
// 401/网络（res=null）→ 抛 fallback 或「请先登录」；非 2xx → 抛后端 { error }；
// 成功 → 解析 json（空响应容错为 {}）。
export async function apiHandle(res, fallback) {
  if (!res) throw new Error('请先登录')
  if (!res.ok) throw new Error(await readApiErrorSafe(res, fallback || '请求失败，请检查网络'))
  return res.json().catch(() => ({}))
}