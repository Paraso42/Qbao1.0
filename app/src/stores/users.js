// ============================================================
// users.js — 用户中心 store（自 legacy users.js / backup.js / notices.js 迁移）
// 维护用户中心 tab、账号资料、文件池、备份回档、管理员（用户/公告）状态。
// ============================================================
import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { useUserStore } from './user'
import { useDataStore } from './data'
import { useUiStore } from './ui'
import { setStoredUser } from '../services/api'
import * as usersApi from '../services/usersApi'
import * as filesApi from '../services/filesApi'
import * as persistence from '../services/persistence'

export const useUsersStore = defineStore('users', () => {
  const user = useUserStore()
  const data = useDataStore()
  const ui = useUiStore()

  // —— 用户中心 tab ——
  const activeTab = ref('account')

  // —— 账号 ——
  const accountBusy = ref(false)

  // —— 文件池 ——
  const poolFiles = ref([])
  const chapterFiles = ref([])
  const filesLoading = ref(false)

  // —— 管理员：用户 ——
  const users = ref([])
  const usersLoading = ref(false)
  const userSearch = ref('')
  const roleFilter = ref('')
  const page = ref(1)
  const pageSize = ref(20)
  const totalUsers = ref(0)
  const totalPages = ref(1)
  const stats = ref(null)
  const adminSection = ref('')
  const viewedUser = ref(null)
  const viewedUserLoading = ref(false)

  // —— 管理员：公告 ——
  const notices = ref([])
  const noticesLoading = ref(false)

  // —— 备份/回档历史（本地记录，作为"恢复列表"） ——
  const backupHistory = ref([])

  const isAdmin = computed(() => user.isAdmin())
  const currentChapter = computed(() => data.getCh())
  const storagePoints = computed(() => (user.user && user.user.storagePoints) || 0)

  function setTab(tab) {
    activeTab.value = tab
    if (tab === 'files') loadFiles()
    else if (tab === 'admin') adminSection.value = ''
    else if (tab === 'achievements') { /* 渲染时校验解锁 */ }
  }
  function resetTabs() { activeTab.value = 'account' }

  // —— 账号资料 ——
  // 与 legacy saveAccountChanges 语义一致：先上传头像（若为 dataURL），再 PUT /users/me。
  async function saveAccount({ displayName, oldPassword, newPassword, avatarDataUrl }) {
    accountBusy.value = true
    try {
      let savedAvatarUrl = (user.user && user.user.avatarUrl) || null
      if (avatarDataUrl && avatarDataUrl.indexOf('data:') === 0) {
        try {
          const av = await usersApi.uploadAvatar(avatarDataUrl)
          if (av && av.user && av.user.avatarUrl) savedAvatarUrl = av.user.avatarUrl
        } catch (e) {
          ui.toast('头像上传失败: ' + e.message, 'err')
        }
      }
      const body = { displayName }
      if (oldPassword) body.password = oldPassword
      if (newPassword) body.newPassword = newPassword
      const json = await usersApi.updateMe(body)
      if (json && json.user) {
        const next = { ...(user.user || {}), ...json.user }
        if (savedAvatarUrl) next.avatarUrl = savedAvatarUrl
        if (avatarDataUrl && avatarDataUrl.indexOf('data:') === 0 && !next.avatarUrl) next.avatar = avatarDataUrl
        user.user = next
        setStoredUser(next)
      }
      return { ok: true }
    } catch (e) {
      ui.toast(e.message || '保存失败', 'err')
      return { ok: false, error: e.message }
    } finally {
      accountBusy.value = false
    }
  }

  // 裁剪后直接 PUT 头像并刷新本地用户资料（任务指定流程：裁剪→base64→PUT→刷新）
  async function uploadAvatarData(dataUrl) {
    try {
      const av = await usersApi.uploadAvatar(dataUrl)
      if (av && av.user) {
        const next = { ...(user.user || {}), ...av.user }
        // 同用户换头像时 URL 路径不变，追加时间戳防止浏览器缓存旧图
        if (next.avatarUrl && next.avatarUrl.indexOf('data:') !== 0 && next.avatarUrl.indexOf('http') !== 0) {
          const sep = next.avatarUrl.indexOf('?') === -1 ? '?' : '&'
          next.avatarUrl = next.avatarUrl + sep + 't=' + Date.now()
        }
        user.user = next
        setStoredUser(next)
      }
      ui.toast('头像已更新，各界面已同步显示', 'ok')
      return { ok: true, avatarUrl: av && av.user && av.user.avatarUrl }
    } catch (e) {
      ui.toast('头像上传失败: ' + (e.message || '请重试'), 'err')
      return { ok: false, error: e.message }
    }
  }

  // —— 文件池 ——
  async function loadFiles() {
    filesLoading.value = true
    try {
      const ch = data.getCh()
      const [poolRes, chRes] = await Promise.all([
        filesApi.listFiles({ pool: true }).catch(() => null),
        ch ? filesApi.listFiles({ chapterId: ch.id }).catch(() => null) : Promise.resolve(null)
      ])
      poolFiles.value = (poolRes && poolRes.files) || []
      chapterFiles.value = (chRes && chRes.files) || []
    } finally {
      filesLoading.value = false
    }
  }

  // 批量上传（单文件 ≤20MB；仅允许后端支持的类型，其余直接跳过提示）
  const POOL_ALLOWED_EXTS = ['pdf', 'doc', 'docx', 'pptx', 'txt', 'md']
  async function uploadFiles(fileList) {
    let success = 0
    let fail = 0
    for (const file of fileList) {
      const ext = (file.name || '').split('.').pop().toLowerCase()
      if (POOL_ALLOWED_EXTS.indexOf(ext) === -1) {
        ui.toast(file.name + ' 类型不支持（仅支持 pdf/doc/docx/pptx/txt/md），已跳过', 'err')
        fail++
        continue
      }
      if (file.size > 20 * 1024 * 1024) {
        ui.toast(file.name + ' 超过 20MB，已跳过', 'err')
        fail++
        continue
      }
      try {
        await filesApi.uploadFile(file, null)
        success++
      } catch (e) {
        fail++
        ui.toast((e && e.message) || file.name + ' 上传失败', 'err')
      }
    }
    await loadFiles()
    if (fail > 0) ui.toast('上传完成：' + success + ' 个成功，' + fail + ' 个失败', 'info')
    else if (success > 0) ui.toast('上传完成：' + success + ' 个成功', 'ok')
    return { success, fail }
  }

  // 分配到当前章节 + 同步 chapterMaterials（供 AI 出题使用）
  async function assignFile(fileId) {
    const ch = data.getCh()
    if (!ch) { ui.toast('请先选择章节', 'info'); return false }
    try {
      const res = await filesApi.assignFile(fileId, ch.id)
      const f = res && res.file
      if (f) {
        if (!data.state.chapterMaterials) data.state.chapterMaterials = {}
        const materials = data.state.chapterMaterials[ch.id] || (data.state.chapterMaterials[ch.id] = [])
        if (!materials.some((m) => m._poolFile && m.id === ('pool_' + fileId))) {
          materials.push({ name: f.originalName, size: f.fileSize, addedAt: Date.now(), id: 'pool_' + fileId, _poolFile: true })
        }
        ch._hasNewFilesSinceLastGen = true
        data.saveState()
      }
      await loadFiles()
      return true
    } catch (e) {
      ui.toast('分配失败: ' + e.message, 'err')
      return false
    }
  }

  async function unassignFile(fileId) {
    try { await filesApi.unassignFile(fileId); await loadFiles(); return true }
    catch (e) { ui.toast('移除失败: ' + e.message, 'err'); return false }
  }

  async function deleteFile(fileId) {
    try { await filesApi.deleteFile(fileId); await loadFiles(); return true }
    catch (e) { ui.toast('删除失败: ' + e.message, 'err'); return false }
  }

  async function extendFile(fileId) {
    try { await filesApi.extendFile(fileId); await loadFiles(); return true }
    catch (e) { ui.toast('续期失败: ' + e.message, 'err'); return false }
  }

  // —— 数据备份/回档 ——
  function loadBackupHistory() {
    try { backupHistory.value = JSON.parse(localStorage.getItem('qbao_backup_history') || '[]') }
    catch (e) { backupHistory.value = [] }
  }
  function _pushBackupHistory(entry) {
    backupHistory.value.unshift({ ...entry, at: new Date().toISOString() })
    backupHistory.value = backupHistory.value.slice(0, 20)
    try { localStorage.setItem('qbao_backup_history', JSON.stringify(backupHistory.value)) } catch (e) {}
  }

  // 本地 JSON 下载（backupVersion:8 + state）
  function downloadBackup() {
    try {
      const payload = JSON.stringify({ backupVersion: 8, createdAt: new Date().toISOString(), state: data.state }, null, 2)
      const blob = new Blob([payload], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      const ts = new Date()
      const pad = (n) => String(n).padStart(2, '0')
      a.download = 'Qbao_backup_' + ts.getFullYear() + '-' + pad(ts.getMonth() + 1) + '-' + pad(ts.getDate()) + '_' + pad(ts.getHours()) + '-' + pad(ts.getMinutes()) + '.json'
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      setTimeout(() => URL.revokeObjectURL(url), 1000)
      _pushBackupHistory({ kind: 'backup' })
      return { ok: true }
    } catch (e) {
      ui.toast('备份失败: ' + e.message, 'err')
      return { ok: false, error: e.message }
    }
  }

  // 回档：migrateState 后 replaceState + saveState（同 legacy restoreFromFile）
  function restoreFromText(text) {
    try {
      const parsed = JSON.parse(text)
      if (!parsed || !parsed.state) throw new Error('无效的备份文件')
      const migrated = persistence.migrateState(parsed.state)
      // 科目/章节指针修正必须发生在 saveState 之前，否则落盘的骨架仍是 null 指针（P1.4 修复）
      const sids = Object.keys(migrated.subjects || {})
      if (sids.length > 0) {
        if (!migrated.currentSubjectId || !migrated.subjects[migrated.currentSubjectId]) migrated.currentSubjectId = sids[0]
        const s = migrated.subjects[migrated.currentSubjectId]
        if (s && (!migrated.currentChapterId || !migrated.chapters[migrated.currentChapterId])) migrated.currentChapterId = (s.chapterIds && s.chapterIds[0]) || null
      }
      data.replaceState(migrated)
      data.saveState()
      _pushBackupHistory({ kind: 'restore' })
      return { ok: true }
    } catch (e) {
      return { ok: false, error: e.message }
    }
  }

  // —— 管理员：用户 ——
  async function loadUsers() {
    usersLoading.value = true
    try {
      const [listRes, statsRes] = await Promise.all([
        usersApi.getUsers({ search: userSearch.value, role: roleFilter.value, page: page.value, limit: pageSize.value }),
        usersApi.getUsersStats().catch(() => null)
      ])
      users.value = (listRes && listRes.users) || []
      totalUsers.value = (listRes && (listRes.total ?? listRes.totalUsers)) ?? users.value.length
      totalPages.value = (listRes && listRes.totalPages) || Math.max(1, Math.ceil(totalUsers.value / pageSize.value))
      if (statsRes) stats.value = statsRes
    } catch (e) {
      ui.toast('加载失败: ' + e.message, 'err')
    } finally {
      usersLoading.value = false
    }
  }

  function setSearch(q) { userSearch.value = q; page.value = 1; loadUsers() }
  function setRoleFilter(r) { roleFilter.value = r; page.value = 1; loadUsers() }
  function setPage(p) { page.value = p; loadUsers() }

  async function toggleBan(u) {
    if (u.role === 'admin') { ui.toast('管理员账号受保护，不可被封禁（防管理员互害）', 'err'); return false }
    const action = u.isBanned ? '解封' : '封禁'
    const ok = await ui.openConfirm('确认' + action, '确定要' + action + '用户 ' + (u.displayName || u.username) + ' 吗？', action)
    if (!ok) return false
    try {
      const res = await usersApi.setUserBan(u.id, !u.isBanned)
      await loadUsers()
      ui.toast((res && res.message) || ('已' + action), 'ok')
      return true
    } catch (e) {
      ui.toast('操作失败: ' + e.message, 'err')
      return false
    }
  }

  async function resetPassword(uid, password) {
    try {
      await usersApi.updateUser(uid, { password })
      ui.toast('密码已重置', 'ok')
      return true
    } catch (e) {
      ui.toast('操作失败: ' + e.message, 'err')
      return false
    }
  }

  async function viewUser(uid) {
    viewedUserLoading.value = true
    viewedUser.value = null
    try { viewedUser.value = await usersApi.getUser(uid) }
    catch (e) { ui.toast('加载失败: ' + e.message, 'err') }
    finally { viewedUserLoading.value = false }
  }
  function closeViewedUser() { viewedUser.value = null }

  // —— 管理员：公告 ——
  async function loadNotices() {
    noticesLoading.value = true
    try { notices.value = (await usersApi.getAllNotices()) || [] }
    catch (e) { ui.toast('加载失败: ' + e.message, 'err') }
    finally { noticesLoading.value = false }
  }

  // 保存（新增/编辑）：durationSeconds → 毫秒
  async function saveNotice(payload) {
    const body = {
      content: payload.content,
      type: payload.type,
      duration: Math.max(2000, Math.round((payload.durationSeconds || 4) * 1000))
    }
    if (payload.link) body.link = payload.link
    if (payload.expire_at) body.expire_at = payload.expire_at
    try {
      if (payload.id) await usersApi.updateNotice(payload.id, body)
      else await usersApi.createNotice(body)
      await loadNotices()
      return true
    } catch (e) {
      ui.toast('保存失败: ' + e.message, 'err')
      return false
    }
  }

  async function toggleNoticeRow(id) {
    try { await usersApi.toggleNotice(id); await loadNotices(); return true }
    catch (e) { ui.toast('操作失败: ' + e.message, 'err'); return false }
  }

  async function removeNotice(id) {
    const ok = await ui.openConfirm('删除消息', '确定删除此消息？删除后无法恢复。', '删除', { danger: true })
    if (!ok) return false
    try { await usersApi.deleteNotice(id); await loadNotices(); return true }
    catch (e) { ui.toast('删除失败: ' + e.message, 'err'); return false }
  }

  return {
    activeTab, isAdmin,
    accountBusy,
    poolFiles, chapterFiles, filesLoading, currentChapter, storagePoints,
    users, usersLoading, userSearch, roleFilter, page, pageSize, totalUsers, totalPages, stats, adminSection, viewedUser, viewedUserLoading,
    notices, noticesLoading,
    backupHistory,
    setTab, resetTabs,
    saveAccount, uploadAvatarData,
    loadFiles, uploadFiles, assignFile, unassignFile, deleteFile, extendFile,
    loadBackupHistory, downloadBackup, restoreFromText,
    loadUsers, setSearch, setRoleFilter, setPage, toggleBan, resetPassword, viewUser, closeViewedUser,
    loadNotices, saveNotice, toggleNoticeRow, removeNotice
  }
})