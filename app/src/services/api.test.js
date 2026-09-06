// P1.3 api token 存取加固单测（web 混淆 / desktop safeStorage）
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

function makeLocalStorageStub(seed = {}) {
  const map = new Map(Object.entries(seed))
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)) },
    removeItem: (k) => { map.delete(k) },
    _map: map,
  }
}

function makeSecretBridge() {
  const secrets = new Map()
  return {
    secretSave: vi.fn(async (name, value) => { secrets.set(name, value); return { ok: true } }),
    secretLoad: vi.fn(async (name) => (secrets.has(name) ? { ok: true, value: secrets.get(name) } : { ok: false, code: 'not_found' })),
    secretRemove: vi.fn(async (name) => { secrets.delete(name); return { ok: true } }),
    _secrets: secrets,
  }
}

describe('api token web 形态', () => {
  let storage
  let mod
  beforeEach(async () => {
    storage = makeLocalStorageStub()
    globalThis.localStorage = storage
    vi.resetModules()
    mod = await import('./api')
  })
  afterEach(() => { delete globalThis.localStorage })

  it('setToken 混淆落盘，getToken 还原', () => {
    mod.setToken('jwt-token-abc')
    const raw = storage.getItem('qbao_token')
    expect(raw.indexOf('jwt-token-abc')).toBe(-1)
    expect(raw).toContain('qb1:')
    expect(mod.getToken()).toBe('jwt-token-abc')
  })

  it('旧明文兼容：读旧 token 不破坏登录态', () => {
    storage.setItem('qbao_token', 'legacy-jwt-plain')
    expect(mod.getToken()).toBe('legacy-jwt-plain')
  })

  it('clearStoredAuth 清除 token 与用户', () => {
    mod.setToken('x')
    storage.setItem('qbao_user', JSON.stringify({ id: 'u1' }))
    mod.clearStoredAuth()
    expect(mod.getToken()).toBeNull()
    expect(storage.getItem('qbao_user')).toBeNull()
  })
})

describe('api token desktop 形态（safeStorage）', () => {
  let storage
  let bridge
  beforeEach(async () => {
    storage = makeLocalStorageStub()
    globalThis.localStorage = storage
    bridge = makeSecretBridge()
    globalThis.window = {
      __QBAO_RUNTIME__: { apiBase: 'https://x.example/api/v1', isDesktop: true },
      __qbaoDesktop: bridge,
    }
    vi.resetModules()
  })
  afterEach(() => { delete globalThis.localStorage; delete globalThis.window })

  it('登录写入：setToken 走 IPC 加密，renderer 无明文', async () => {
    const mod = await import('./api')
    mod.setToken('jwt-desktop-secret')
    expect(mod.getToken()).toBe('jwt-desktop-secret') // 内存读
    await new Promise((r) => setTimeout(r, 0))
    expect(bridge.secretSave).toHaveBeenCalledWith('token', 'jwt-desktop-secret')
    expect(storage.getItem('qbao_token')).toBeNull()
  })

  it('启动预热：initSecureAuth 从安全存储恢复 token（模拟新进程）', async () => {
    const mod = await import('./api')
    mod.setToken('jwt-persisted')
    await new Promise((r) => setTimeout(r, 0))
    // 模拟重启：内存清空
    vi.resetModules()
    const mod2 = await import('./api')
    expect(mod2.getToken()).toBeNull()
    await mod2.initSecureAuth()
    expect(mod2.getToken()).toBe('jwt-persisted')
    // localStorage 无明文
    expect(storage.getItem('qbao_token')).toBeNull()
  })

  it('升级迁移：旧明文 token 预热时转入安全存储并清明文', async () => {
    storage.setItem('qbao_token', 'old-plain-jwt')
    const mod = await import('./api')
    await mod.initSecureAuth()
    expect(mod.getToken()).toBe('old-plain-jwt')
    await new Promise((r) => setTimeout(r, 0))
    expect(bridge.secretSave).toHaveBeenCalledWith('token', 'old-plain-jwt')
    expect(storage.getItem('qbao_token')).toBeNull()
  })

  it('登出：setToken(null) 清理安全存储', async () => {
    const mod = await import('./api')
    mod.setToken('jwt')
    await new Promise((r) => setTimeout(r, 0))
    mod.setToken(null)
    await new Promise((r) => setTimeout(r, 0))
    expect(mod.getToken()).toBeNull()
    expect(bridge.secretRemove).toHaveBeenCalledWith('token')
  })
})

// —— P2.3 统一请求/响应封装 ——
describe('apiFetch / apiHandle / readApiErrorSafe (P2.3)', () => {
  let storage
  let calls
  let mod
  beforeEach(async () => {
    storage = makeLocalStorageStub({ qbao_token: 'tok', qbao_user: JSON.stringify({ id: 'u1' }) })
    globalThis.localStorage = storage
    calls = []
    globalThis.fetch = async (url, opts = {}) => {
      calls.push({ url, opts })
      if (url.indexOf('ok-json') !== -1) return { ok: true, status: 200, json: async () => ({ hello: 1 }) }
      if (url.indexOf('empty') !== -1) return { ok: true, status: 204, json: async () => { throw new Error('no body') } }
      if (url.indexOf('biz-err') !== -1) return { ok: false, status: 422, json: async () => ({ error: '业务错误消息' }) }
      if (url.indexOf('unauth') !== -1) return { ok: false, status: 401, json: async () => ({ error: '未登录' }) }
      if (url.indexOf('no-json') !== -1) return { ok: false, status: 500, json: async () => { throw new Error('parse fail') } }
      return { ok: false, status: 404, json: async () => ({}) }
    }
    vi.resetModules()
    mod = await import('./api')
  })
  afterEach(() => { delete globalThis.localStorage; delete globalThis.fetch })

  it('apiFetch：对象 body 自动 JSON 序列化并带 Bearer；返回 res', async () => {
    const res = await mod.apiFetch('/ok-json', { method: 'POST', body: { a: 1 } })
    expect(res.ok).toBe(true)
    const c = calls[0]
    expect(c.url).toBe('/api/v1/ok-json')
    expect(c.opts.headers['Content-Type']).toBe('application/json')
    expect(c.opts.headers['Authorization']).toBe('Bearer tok')
    expect(c.opts.body).toBe(JSON.stringify({ a: 1 }))
  })

  it('apiFetch：自定义头覆盖 + auth:false 不带 Bearer + 网络异常抛统一消息', async () => {
    await mod.apiFetch('/ok-json', { headers: { 'x-ai-key': 'k1' }, auth: false })
    const c = calls[0]
    expect(c.opts.headers['x-ai-key']).toBe('k1')
    expect(c.opts.headers['Authorization']).toBeUndefined()
    globalThis.fetch = async () => { throw new Error('net down') }
    await expect(mod.apiFetch('/x')).rejects.toThrow(/无法连接服务器/)
  })

  it('apiFetch：401 清除登录态并返回 null（与 fetchWithAuth 一致）', async () => {
    const res = await mod.apiFetch('/unauth')
    expect(res).toBeNull()
    expect(mod.getToken()).toBeNull()
    expect(storage.getItem('qbao_user')).toBeNull()
  })

  it('apiHandle：非 2xx 抛后端 error；成功解析 json；空响应容错 {}', async () => {
    await expect(mod.apiHandle({ ok: false, status: 422, json: async () => ({ error: '业务错误消息' }) }, '兜底')).rejects.toThrow('业务错误消息')
    const ok = await mod.apiHandle(await mod.apiFetch('/ok-json'), '兜底')
    expect(ok).toEqual({ hello: 1 })
    const empty = await mod.apiHandle({ ok: true, status: 204, json: async () => { throw new Error('x') } }, '兜底')
    expect(empty).toEqual({})
    await expect(mod.apiHandle(null, '兜底')).rejects.toThrow('请先登录')
  })

  it('readApiErrorSafe：无 error 字段/无响应体时回退；readApiError 别名一致', async () => {
    expect(await mod.readApiErrorSafe({ ok: false, status: 500, json: async () => { throw new Error('x') } }, '兜底消息')).toBe('兜底消息')
    expect(await mod.readApiErrorSafe(null, '网络失败兜底')).toBe('网络失败兜底')
    expect(await mod.readApiErrorSafe({ ok: false, json: async () => ({ foo: 1 }) }, '无error兜底')).toBe('无error兜底')
    expect(await mod.readApiError({ ok: false, json: async () => ({ error: 'E' }) }, 'x')).toBe('E')
  })

  it('apiFetch：rawBody 不重复序列化（SSE/生成类调用）', async () => {
    await mod.apiFetch('/ok-json', { method: 'POST', rawBody: '{"x":1}' })
    const c = calls[0]
    expect(c.opts.body).toBe('{"x":1}')
    expect(c.opts.headers['Content-Type']).toBe('application/json')
  })
})

describe('v3.37.1 会话令牌钉扎与 401 语境守卫', () => {
  let storage
  let mod
  beforeEach(async () => {
    storage = makeLocalStorageStub({ qbao_token: 'LIVE_TOK', qbao_user: JSON.stringify({ id: 'u1', username: 'a' }) })
    globalThis.localStorage = storage
    vi.resetModules()
    mod = await import('./api')
  })
  afterEach(() => { delete globalThis.localStorage })

  it('effectiveToken 优先钉扎令牌；未钉扎回退活读', () => {
    expect(mod.effectiveToken()).toBe('LIVE_TOK')
    mod.pinToken('PIN_TOK')
    storage.setItem('qbao_token', 'OTHER_LIVE')
    expect(mod.effectiveToken()).toBe('PIN_TOK')
    mod.unpinToken()
    expect(mod.effectiveToken()).toBe('OTHER_LIVE')
  })

  it('fetchWithAuth 携带钉扎令牌（活读令牌被其他标签页替换也不漂移）', async () => {
    let seen = null
    globalThis.fetch = async (url, options = {}) => { seen = (options.headers && options.headers.Authorization) || null; return { ok: true, status: 200, json: async () => ({}) } }
    mod.pinToken('PIN_TOK')
    storage.setItem('qbao_token', 'OTHER_LIVE')
    await mod.fetchWithAuth('/data')
    expect(seen).toBe('Bearer PIN_TOK')
    delete globalThis.fetch
  })

  it('401 且钉扎 != 活读（其他标签页换账号）→ 不清理登出态，触发整页重建钩子', async () => {
    let staleFired = 0
    let cleared = 0
    mod.setAuthStaleHook(() => { staleFired++ })
    globalThis.fetch = async () => ({ ok: false, status: 401, json: async () => ({}) })
    mod.pinToken('PIN_TOK')
    storage.setItem('qbao_token', 'OTHER_LIVE')
    const res = await mod.fetchWithAuth('/data')
    expect(res).toBeNull()
    expect(staleFired).toBe(1)
    expect(storage.getItem('qbao_user')).not.toBeNull() // 不清别人账号
    expect(storage.getItem('qbao_token')).toBe('OTHER_LIVE')
    delete globalThis.fetch
  })

  it('401 且钉扎 == 活读（本页即登录上下文）→ 正常清理登出', async () => {
    globalThis.fetch = async () => ({ ok: false, status: 401, json: async () => ({}) })
    mod.pinToken('LIVE_TOK')
    const res = await mod.fetchWithAuth('/data')
    expect(res).toBeNull()
    expect(storage.getItem('qbao_user')).toBeNull()
    expect(storage.getItem('qbao_token')).toBeNull()
    delete globalThis.fetch
  })
})
