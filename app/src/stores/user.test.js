import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

// v3.36.1 账户隔离：账号切换必须触发整页重建（防止内存题库跨账号写入）

function makeLocalStorageStub(seed = {}) {
  const map = new Map(Object.entries(seed))
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)) },
    removeItem: (k) => { map.delete(k) },
    _map: map,
  }
}

describe('user store 账号切换重建 (v3.36.1)', () => {
  let storage
  let reloadSpy

  beforeEach(async () => {
    storage = makeLocalStorageStub({
      qbao_token: 'tokA',
      qbao_user: JSON.stringify({ id: 'u1', username: 'a' }),
      quizEngineState_cloud_u1: JSON.stringify({ subjects: {}, chapters: {}, history: [], lastScreen: 'start' }),
    })
    globalThis.localStorage = storage
    reloadSpy = vi.fn()
    vi.stubGlobal('window', { location: { reload: reloadSpy } })
    setActivePinia(createPinia())
    vi.resetModules()
  })
  afterEach(() => {
    delete globalThis.localStorage
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    setAccountSwitchingLocal(false)
  })

  // eslint-disable-next-line no-unused-vars
  function setAccountSwitchingLocal(v) {
    // 通过模块网关复位（模块级状态隔离由 resetModules 保证；此处仅兜底）
  }

  it('切换到不同账号 → 触发整页重建（location.reload）', async () => {
    // 先建立内存数据属主（模拟页面启动加载了 u1 的数据）
    const persistence = await import('../services/persistence')
    persistence.loadState()
    expect(persistence.getStateOwnerUid()).toBe('u1')

    const { useUserStore } = await import('./user')
    const user = useUserStore()
    user.applyAuth({ token: 'tokB', user: { id: 'u2', username: 'b' } })
    // 切换账号：必须 reload 重建数据上下文
    expect(reloadSpy).toHaveBeenCalledTimes(1)
  })

  it('同一账号重复登录（刷新令牌）→ 不重建', async () => {
    const persistence = await import('../services/persistence')
    persistence.loadState()
    const { useUserStore } = await import('./user')
    const user = useUserStore()
    user.applyAuth({ token: 'tokA2', user: { id: 'u1', username: 'a' } })
    expect(reloadSpy).not.toHaveBeenCalled()
    expect(user.isOnline).toBe(true)
  })

  it('门禁期（无属主）首次登录 → 也整页重建（加载该账号自己的数据上下文）', async () => {
    storage.removeItem('qbao_token')
    storage.removeItem('qbao_user')
    const { useUserStore } = await import('./user')
    const user = useUserStore()
    user.applyAuth({ token: 'tokC', user: { id: 'u3', username: 'c' } })
    // v3.36.1 登录门禁：未登录状态没有任何匿名数据参与业务，首次登录必须重建
    expect(reloadSpy).toHaveBeenCalledTimes(1)
    expect(user.isOnline).toBe(true)
  })

  it('登出后写盘仍限内存属主自己的键（v3.37.1 属主钉扎，不产生匿名脏标）', async () => {
    const persistence = await import('../services/persistence')
    persistence.loadState()
    expect(persistence.getStateOwnerUid()).toBe('u1')
    // 模拟登出（本页清档案登录态）后仍有写盘：属主钉扎 → 写回属主自己的键，绝不漂移，也不进匿名态
    storage.removeItem('qbao_token')
    storage.removeItem('qbao_user')
    persistence.saveState({ subjects: { sx: { id: 'sx', name: '登出后写盘' } }, chapters: {} })
    expect(persistence.hadAnonymousMutations()).toBe(false)
    expect(storage.getItem('quizEngineState_cloud_u1')).toContain('登出后写盘')
    expect(storage.getItem('quizEngineState_cloud_u2')).toBeNull()
    const { useUserStore } = await import('./user')
    const user = useUserStore()
    // 同一账号 u1 重新登录（属主不变且无脏标）→ 不重建（与旧版匿名脏标强制重建场景分离：
    // 真正的门禁期脏改动由「未登录 loadState（属主 null）→ saveState 拒绝打标」路径覆盖）
    user.applyAuth({ token: 'tokA2', user: { id: 'u1', username: 'a' } })
    expect(reloadSpy).not.toHaveBeenCalled()
  })
})

describe('v3.37.1 applyAuth 会话令牌钉扎 (user store)', () => {
  let storage
  let reloadSpy
  beforeEach(async () => {
    storage = makeLocalStorageStub({
      qbao_token: 'tokA',
      qbao_user: JSON.stringify({ id: 'u1', username: 'a' }),
      quizEngineState_cloud_u1: JSON.stringify({ subjects: {}, chapters: {}, history: [], lastScreen: 'start' }),
    })
    globalThis.localStorage = storage
    reloadSpy = vi.fn()
    vi.stubGlobal('window', { location: { reload: reloadSpy } })
    setActivePinia(createPinia())
    vi.resetModules()
  })
  afterEach(() => {
    delete globalThis.localStorage
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('applyAuth 钉扎会话令牌；logout 解除钉扎', async () => {
    const api = await import('../services/api')
    const { useUserStore } = await import('./user')
    const user = useUserStore()
    user.applyAuth({ token: 'tokA2', user: { id: 'u1', username: 'a' } })
    expect(api.getPinnedToken()).toBe('tokA2')
    expect(api.effectiveToken()).toBe('tokA2')
    user.logout()
    expect(api.getPinnedToken()).toBeNull()
  })
})
