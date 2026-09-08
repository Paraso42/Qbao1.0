<template>
  <div class="subsection">
    <div class="subsection-head">
      <h4><Icon name="users" :size="16" />用户管理</h4>
      <div class="head-actions">
        <button class="btn btn-secondary btn-small" @click="users.loadUsers()"><Icon name="refresh" :size="13" /> 刷新</button>
      </div>
    </div>

    <!-- 用户详情 -->
    <div v-if="users.viewedUser" class="user-detail">
      <button class="btn btn-text btn-small" @click="users.closeViewedUser()">← 返回列表</button>
      <div class="ud-header">
        <div class="ud-avatar-wrap">
          <div v-if="avatarUrlOf(users.viewedUser)" class="ud-avatar"><img :src="avatarUrlOf(users.viewedUser)" alt=""></div>
          <div v-else class="ud-avatar ud-avatar--initial">{{ initialOf(users.viewedUser) }}</div>
          <span class="ud-dot" :class="users.viewedUser.isOnline ? 'on' : 'off'"></span>
        </div>
        <div class="ud-name">
          <div class="ud-display">{{ users.viewedUser.displayName || users.viewedUser.username }}</div>
          <div class="ud-username">@{{ users.viewedUser.username }}</div>
        </div>
        <div class="ud-badges">
          <span class="pill" :class="users.viewedUser.role === 'admin' ? 'role-admin' : 'role-user'">{{ users.viewedUser.role === 'admin' ? '管理员' : '普通用户' }}</span>
          <span class="pill" :class="users.viewedUser.isBanned ? 'ban-badge' : 'ok-badge'">{{ users.viewedUser.isBanned ? '已封禁' : '正常' }}</span>
        </div>
      </div>

      <div class="stat-grid">
        <div class="stat-card"><div class="stat-num">{{ udStats.subjects }}</div><div class="stat-label">科目</div></div>
        <div class="stat-card"><div class="stat-num">{{ udStats.chapters }}</div><div class="stat-label">章节</div></div>
        <div class="stat-card"><div class="stat-num">{{ udStats.totalQuestions }}</div><div class="stat-label">题目</div></div>
        <div class="stat-card"><div class="stat-num small">{{ udStats.totalBackups }}</div><div class="stat-label">备份</div></div>
        <div class="stat-card"><div class="stat-num small">{{ udStats.totalShares }}</div><div class="stat-label">分享</div></div>
        <div class="stat-card"><div class="stat-num small">{{ udStats.totalAiRequests }}</div><div class="stat-label">AI出题</div></div>
        <div class="stat-card"><div class="stat-num small">{{ users.viewedUser.storagePoints ?? 0 }}</div><div class="stat-label">积分</div></div>
      </div>

      <div class="ud-meta">
        <div>创建时间: {{ fmtTime(users.viewedUser.createdAt) }}</div>
        <div v-if="users.viewedUser.lastLoginAt">最后登录: {{ fmtTime(users.viewedUser.lastLoginAt) }}</div>
      </div>

      <div class="ud-actions">
        <template v-if="users.viewedUser.role !== 'admin'">
          <div class="reset-pw">
            <input v-model="resetPw" class="input" type="text" placeholder="新密码 (至少6位)">
            <button class="btn btn-primary btn-small" @click="onResetPw">设置</button>
          </div>
          <button class="btn btn-small" :class="users.viewedUser.isBanned ? 'btn-success' : 'btn-danger'" @click="users.toggleBan(users.viewedUser)">
            {{ users.viewedUser.isBanned ? '解封' : '封禁' }}
          </button>
        </template>
        <p v-else class="protected-note" style="font-size:12px;color:var(--text-muted);margin:4px 0">管理员账号受保护：不可被其他管理员重置密码或封禁（防管理员互害）。</p>
      </div>
    </div>

    <template v-else>
      <div class="user-toolbar">
        <input
          v-model="users.userSearch"
          class="input search-input"
          type="text"
          placeholder="搜索用户名..."
          @keydown.enter="users.setSearch(users.userSearch)"
        >
        <button class="btn btn-primary btn-small" @click="users.setSearch(users.userSearch)">搜索</button>
        <select :value="users.roleFilter" class="select role-select" @change="onRoleFilterChange">
          <option value="">全部角色</option>
          <option value="admin">管理员</option>
          <option value="user">普通用户</option>
        </select>
      </div>

      <div class="stats-grid">
        <div v-for="c in statCards" :key="c.label" class="stat-card">
          <div class="stat-num">{{ c.value }}</div>
          <div class="stat-label">{{ c.label }}</div>
        </div>
      </div>

      <div v-if="users.usersLoading" class="loading">加载中...</div>
      <div v-else-if="users.users.length === 0" class="empty">暂无用户</div>
      <div v-else class="user-list">
        <div v-for="u in users.users" :key="u.id" class="user-row" @click="users.viewUser(u.id)">
          <div class="ur-avatar-wrap">
            <div v-if="avatarUrlOf(u)" class="ur-avatar"><img :src="avatarUrlOf(u)" alt=""></div>
            <div v-else class="ur-avatar ur-avatar--initial">{{ initialOf(u) }}</div>
            <span class="ur-dot" :class="u.isOnline ? 'on' : 'off'"></span>
          </div>
          <div class="ur-info">
            <div class="ur-name">{{ u.displayName || u.username }} <span class="ur-username">@{{ u.username }}</span></div>
            <div class="ur-badges">
              <span class="pill" :class="u.role === 'admin' ? 'role-admin' : 'role-user'">{{ u.role === 'admin' ? '管理员' : '普通' }}</span>
              <span v-if="u.isBanned" class="pill ban-badge">已封禁</span>
              <span class="pill points-pill"><Icon name="coins" :size="11" /> {{ u.storagePoints ?? 0 }}</span>
              <span class="ur-last">{{ u.lastLoginAt ? '最后登录: ' + fmtTime(u.lastLoginAt) : '从未登录' }}</span>
            </div>
          </div>
          <button v-if="u.role !== 'admin'" class="btn btn-small ban-btn" :class="u.isBanned ? 'btn-success' : 'btn-danger'" @click.stop="users.toggleBan(u)">
            {{ u.isBanned ? '解封' : '封禁' }}
          </button>
        </div>
      </div>

      <div class="pager">
        <button class="btn btn-secondary btn-small" :disabled="users.page <= 1" @click="users.setPage(users.page - 1)">上一页</button>
        <span class="pager-info">第 {{ users.page }} / {{ users.totalPages }} 页 · 共 {{ users.totalUsers }} 人</span>
        <button class="btn btn-secondary btn-small" :disabled="users.page >= users.totalPages" @click="users.setPage(users.page + 1)">下一页</button>
      </div>
    </template>
  </div>
</template>

<script setup>
// P2.2：管理员用户管理区块（自 AdminTab.vue 拆出）— 状态走 users store
import { computed, ref } from 'vue'
import { useUsersStore } from '../../../stores/users'
import { useUiStore } from '../../../stores/ui'
import { resolveMediaUrl } from '../../../services/utils'
import Icon from '../../ui/Icon.vue'

const users = useUsersStore()
const ui = useUiStore()

const resetPw = ref('')

function onRoleFilterChange(e) { users.setRoleFilter(e.target.value) }

const statCards = computed(() => {
  const s = users.stats || {}
  const userCount = s.userCount ?? ((s.totalUsers != null && s.adminCount != null) ? s.totalUsers - s.adminCount : 0)
  return [
    { label: '总用户', value: s.totalUsers ?? 0 },
    { label: '管理员', value: s.adminCount ?? 0 },
    { label: '普通用户', value: userCount },
    { label: '封禁', value: s.bannedCount ?? 0 },
    { label: '在线', value: s.onlineNow ?? 0 },
    { label: '今日登录', value: s.todayLogins ?? 0 }
  ]
})

const udStats = computed(() => {
  const u = users.viewedUser
  const s = (u && u.stats) || {}
  return {
    subjects: s.subjects ?? 0,
    chapters: s.chapters ?? 0,
    totalQuestions: s.totalQuestions ?? 0,
    totalBackups: s.totalBackups ?? 0,
    totalShares: s.totalShares ?? 0,
    totalAiRequests: s.totalAiRequests ?? 0
  }
})

function avatarUrlOf(u) { return resolveMediaUrl((u && (u.avatarUrl || u.avatar)) || '') }
function initialOf(u) { return ((u && (u.displayName || u.username)) || '?').charAt(0).toUpperCase() }
function fmtTime(ts) { try { return new Date(ts).toLocaleString('zh-CN') } catch (e) { return '' } }

async function onResetPw() {
  if (users.viewedUser.role === 'admin') { ui.toast('管理员账号受保护，不可被重置密码', 'err'); return }
  const pw = resetPw.value
  if (!pw || pw.length < 6) { ui.toast('密码至少6位', 'err'); return }
  const ok = await ui.openConfirm('重置密码', '确定要为用户 #' + users.viewedUser.id + ' 重置密码吗？', '重置')
  if (!ok) return
  const done = await users.resetPassword(users.viewedUser.id, pw)
  if (done) resetPw.value = ''
}
</script>

<style scoped>
.subsection { display: flex; flex-direction: column; gap: var(--space-md); }
.subsection-head { display: flex; align-items: center; justify-content: space-between; gap: var(--space-sm); }
.subsection-head h4 { margin: 0; font-size: var(--fs-md); font-weight: 600; display: flex; align-items: center; gap: var(--space-sm); }
.head-actions { display: flex; gap: var(--space-sm); }
.loading { text-align: center; color: var(--text-muted); padding: var(--space-lg); font-size: var(--fs-sm); }
.empty { text-align: center; color: var(--text-muted); padding: var(--space-lg); font-size: var(--fs-sm); }
.user-toolbar { display: flex; gap: var(--space-sm); align-items: center; }
.search-input { flex: 1; }
.role-select { width: 120px; flex-shrink: 0; }
.stats-grid { display: grid; grid-template-columns: repeat(6, 1fr); gap: var(--space-sm); }
.stat-grid { display: grid; grid-template-columns: repeat(7, 1fr); gap: var(--space-sm); }
.stat-card { background: var(--surface-bg); border: 1px solid var(--border-light); border-radius: var(--radius-md); padding: var(--space-md) var(--space-sm); text-align: center; }
.stat-num { font-size: var(--fs-xl); font-weight: 700; color: var(--color-primary); }
.stat-num.small { font-size: var(--fs-md); }
.stat-label { font-size: var(--fs-xs); color: var(--text-muted); margin-top: 2px; }
.user-list { display: flex; flex-direction: column; gap: var(--space-sm); }
.user-row { display: flex; align-items: center; gap: var(--space-sm); padding: var(--space-sm) var(--space-md); border: 1px solid var(--border-light); border-radius: var(--radius-md); cursor: pointer; transition: border-color var(--transition-fast), background var(--transition-fast); }
.user-row:hover { border-color: var(--color-primary); background: var(--surface-hover); }
.ur-avatar-wrap, .ud-avatar-wrap { position: relative; flex-shrink: 0; }
.ur-avatar, .ud-avatar { width: 40px; height: 40px; border-radius: 50%; overflow: hidden; background: var(--color-primary); display: flex; align-items: center; justify-content: center; color: #fff; font-weight: 600; }
.ur-avatar img, .ud-avatar img { width: 100%; height: 100%; object-fit: cover; }
.ud-avatar { width: 64px; height: 64px; font-size: var(--fs-xl); }
.ur-dot, .ud-dot { position: absolute; right: 0; bottom: 0; width: 10px; height: 10px; border-radius: 50%; border: 2px solid var(--surface-card); background: var(--text-muted); }
.ur-dot.on, .ud-dot.on { background: var(--color-success); }
.ur-dot.off, .ud-dot.off { background: var(--text-muted); }
.ur-info { flex: 1; min-width: 0; }
.ur-name { font-weight: 600; display: flex; align-items: baseline; gap: 6px; }
.ur-username { color: var(--text-muted); font-size: var(--fs-xs); }
.ur-badges { display: flex; align-items: center; gap: var(--space-xs); margin-top: 4px; }
.ur-last { font-size: var(--fs-xs); color: var(--text-muted); }
.pill { font-size: var(--fs-xs); padding: 1px 8px; border-radius: 999px; border: 1px solid var(--border-default); color: var(--text-secondary); }
.role-admin { color: var(--color-warning); border-color: var(--color-warning); }
.role-user { color: var(--color-primary); border-color: var(--color-primary); }
.ban-badge { color: var(--color-danger); border-color: var(--color-danger); }
.ok-badge { color: var(--color-success); border-color: var(--color-success); }
.points-pill { color: var(--color-warning); border-color: var(--color-warning); }
.ban-btn { flex-shrink: 0; }
.pager { display: flex; align-items: center; justify-content: center; gap: var(--space-md); padding-top: var(--space-sm); }
.pager-info { font-size: var(--fs-xs); color: var(--text-muted); }
.user-detail { display: flex; flex-direction: column; gap: var(--space-md); }
.ud-header { display: flex; align-items: center; gap: var(--space-md); }
.ud-name .ud-display { font-size: var(--fs-md); font-weight: 700; }
.ud-name .ud-username { color: var(--text-muted); font-size: var(--fs-xs); }
.ud-badges { display: flex; gap: var(--space-xs); }
.ud-meta { font-size: var(--fs-xs); color: var(--text-muted); }
.ud-actions { display: flex; align-items: center; gap: var(--space-md); }
.reset-pw { display: flex; gap: var(--space-sm); }
</style>
