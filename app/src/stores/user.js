// 用户登录态（token/user 持久化在 localStorage，键与 legacy 一致）
import { defineStore } from 'pinia'
import {
  getToken, getStoredUser, setToken, setStoredUser, clearStoredAuth,
  pinToken, unpinToken,
  apiLogin, apiRegister
} from '../services/api'
import { getStateOwnerUid, hadAnonymousMutations } from '../services/persistence'
import { setAccountSwitching } from '../services/sync'

export const useUserStore = defineStore('user', {
  state: () => ({
    token: getToken() || null,
    user: getStoredUser(),
    isOnline: !!(getToken() && getStoredUser())
  }),
  getters: {
    userId: (s) => (s.user && s.user.id) || null,
    shortName: (s) => {
      if (!s.user) return ''
      return (s.user.displayName || s.user.username || '?').substring(0, 1).toUpperCase()
    }
  },
  actions: {
    applyAuth({ token, user }) {
      const nextId = (user && user.id) ? String(user.id) : null
      const ownerId = getStateOwnerUid()
      // v3.36.1 登录门禁 + 账户隔离：内存数据属主与登录账号不一致（含首次登录：
      // 门禁期内存为匿名空态）→ 先冻结同步引擎再整页重建，按新账号加载自己的
      // 骨架键/IDB 分区/云端；同一账号重复登录（刷新令牌）不重建。
      const switching = !!nextId && (!ownerId || ownerId !== nextId)
      // 匿名期发生过被拒写入（内存被改动）→ 即使同账号登录也必须重建，杜绝匿名改动混入账号
      const dirty = hadAnonymousMutations()
      setAccountSwitching(true)
      this.token = token
      this.user = user
      this.isOnline = true
      setToken(token)
      setStoredUser(user)
      // v3.37.1 会话令牌钉扎：本标签页从此只以该令牌请求（防多标签页活读漂移串号）
      pinToken(token)
      if (switching || dirty) {
        try {
          if (typeof window !== 'undefined' && window.location && typeof window.location.reload === 'function') {
            window.location.reload()
          }
        } catch (e) { /* 单测环境无 window：状态已应用，由测试自行断言 */ }
      } else {
        setAccountSwitching(false)
      }
    },
    async login(username, password) {
      const data = await apiLogin(username, password)
      this.applyAuth(data)
      return data
    },
    async register(username, displayName, password) {
      const data = await apiRegister(username, displayName, password)
      this.applyAuth(data)
      return data
    },
    logout() {
      this.token = null
      this.user = null
      this.isOnline = false
      unpinToken()
      clearStoredAuth()
    },
    isAdmin() {
      return !!(this.user && this.user.role === 'admin')
    }
  }
})
