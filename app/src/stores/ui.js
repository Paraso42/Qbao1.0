// UI 状态：侧栏/视图/弹窗/toast
import { defineStore } from 'pinia'

let toastSeq = 0

export const useUiStore = defineStore('ui', {
  state: () => ({
    sidebarOpen: false,
    activeScreen: 'start',
    settingsOpen: false,
    settingsTab: 'personalize',
    userCenterOpen: false,
    importOpen: false,
    toasts: [],
    confirm: { open: false, title: '', message: '', okText: '', resolve: null },
    prompt: { open: false, title: '', value: '', resolve: null },
    quizShare: { open: false, data: null }
  }),
  actions: {
    toggleSidebar() { this.sidebarOpen = !this.sidebarOpen },
    closeSidebar() { this.sidebarOpen = false },
    showScreen(name) { this.activeScreen = name; this.closeSidebar() },
    // v3.38：游戏门户（附属静态站）。桌面端子窗口（IPC）；网页端新标签同源打开。
    // 打开方式保证当前标签页存活 → AI 出题轮询不中断（服务端 worker 推进任务）。
    openGamesPortal() {
      const b = (typeof window !== 'undefined' && window.__qbaoDesktop && typeof window.__qbaoDesktop.openGames === 'function')
        ? window.__qbaoDesktop.openGames
        : null
      try {
        if (b) b()
        else if (typeof window !== 'undefined') window.open('./games/index.html', '_blank', 'noopener')
      } catch (e) { /* 弹窗被拦截时静默，入口按钮仍在 */ }
    },
    openSettings(tab) { this.settingsOpen = true; this.settingsTab = tab || 'personalize' },
    closeSettings() { this.settingsOpen = false },
    setSettingsTab(tab) { this.settingsTab = tab },
    openUserCenter() { this.userCenterOpen = true },
    closeUserCenter() { this.userCenterOpen = false },
    openImport() { this.importOpen = true },
    closeImport() { this.importOpen = false },
    toast(message, type = 'info', duration = 4000) {
      const id = ++toastSeq
      this.toasts.push({ id, message, type })
      // 队列治理：同屏最多 2 条，溢出时移除最早的非错误提示
      while (this.toasts.length > 2) {
        const dropIdx = this.toasts.findIndex((t) => t.type !== 'err' && t.type !== 'error')
        if (dropIdx < 0) this.toasts.shift()
        else this.toasts.splice(dropIdx, 1)
      }
      setTimeout(() => { this.dismissToast(id) }, duration)
    },
    dismissToast(id) {
      const idx = this.toasts.findIndex((t) => t.id === id)
      if (idx >= 0) this.toasts.splice(idx, 1)
    },
    // Promise 化的确认框（替代原生 confirm）
    openConfirm(title, message, okText, opts) {
      return new Promise((resolve) => {
        this.confirm = { open: true, title, message: message || '', okText: okText || '', danger: !!(opts && opts.danger), resolve }
      })
    },
    closeConfirm() { this.confirm.open = false },
    // Promise 化的输入框（替代原生 prompt / showInlinePrompt）
    openPrompt(title, value) {
      return new Promise((resolve) => {
        this.prompt = { open: true, title, value: value || '', resolve }
      })
    },
    closePrompt() { this.prompt.open = false },
    openQuizShare(data) { this.quizShare = { open: true, data } },
    closeQuizShare() { this.quizShare = { open: false, data: null } }
  }
})
