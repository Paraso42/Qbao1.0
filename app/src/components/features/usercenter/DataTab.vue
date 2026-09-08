<!--
  DataTab.vue — 数据管理（自 legacy backup.js doManualBackup/restoreFromFile + users.js renderDataPage）
  本地 JSON 备份下载、回档上传、云同步状态、恢复记录列表。
-->
<template>
  <div class="data-tab">
    <div class="section">
      <h4><Icon name="save" :size="16" />本地备份</h4>
      <p class="hint">将答题数据导出为 JSON 文件保存到本地，需要时可上传恢复。备份文件可在正式环境与内测环境之间互导：先在目标环境注册并登录同一账号，再「上传恢复」即可（两环境数据各自独立、互不覆盖）。</p>
      <div class="actions">
        <button class="btn btn-primary btn-small" @click="onBackup"><Icon name="download" :size="13" /> 下载备份</button>
        <button class="btn btn-warning btn-small" @click="pickRestore"><Icon name="upload" :size="13" /> 上传恢复</button>
        <input ref="fileInputRef" type="file" accept=".json,application/json" hidden @change="onRestoreFile">
      </div>
      <p class="tip">提示：建议定期下载备份文件并妥善保管。备份仅包含学习数据，不含账号属性——管理员身份与封禁状态不会随备份迁移，账号状态只能由管理员在后台处理。</p>
    </div>

    <div class="section">
      <h4><Icon name="cloud" :size="16" />云同步</h4>
      <p class="sync-line">
        <template v-if="user.isOnline">
          云端同步状态：<span class="ok">已启用</span><span v-if="sync.syncing">（有未同步的更改）</span>
        </template>
        <template v-else>
          云端同步：<span class="off">未登录（登录后自动云端同步）</span>
        </template>
      </p>
    </div>

    <div class="section">
      <h4><Icon name="clock" :size="16" />恢复记录</h4>
      <div v-if="users.backupHistory.length === 0" class="empty">暂无备份 / 回档记录</div>
      <ul v-else class="history-list">
        <li v-for="(h, i) in users.backupHistory" :key="i">
          <span class="history-kind" :class="h.kind">{{ h.kind === 'backup' ? '备份' : '回档' }}</span>
          <span class="history-time">{{ formatTime(h.at) }}</span>
        </li>
      </ul>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { useUserStore } from '../../../stores/user'
import { useUsersStore } from '../../../stores/users'
import { useUiStore } from '../../../stores/ui'
import { useSyncStore } from '../../../stores/sync'
import Icon from '../../ui/Icon.vue'

const user = useUserStore()
const users = useUsersStore()
const ui = useUiStore()
const sync = useSyncStore()

const fileInputRef = ref(null)

function onBackup() {
  const res = users.downloadBackup()
  if (res && res.ok) ui.toast('备份已下载', 'ok')
}

function pickRestore() { if (fileInputRef.value) fileInputRef.value.click() }

async function onRestoreFile(e) {
  const file = e.target.files && e.target.files[0]
  e.target.value = ''
  if (!file) return
  const ok = await ui.openConfirm('回档确认', '回档后当前数据将被替换。建议先做一次备份。', '继续回档', { danger: true })
  if (!ok) return
  const reader = new FileReader()
  reader.onload = (ev) => {
    const res = users.restoreFromText(ev.target.result)
    if (res && res.ok) ui.toast('回档成功！', 'ok')
    else ui.toast('回档失败: ' + ((res && res.error) || '未知错误'), 'err')
  }
  reader.readAsText(file)
}

function formatTime(iso) {
  try { return new Date(iso).toLocaleString('zh-CN') } catch (e) { return '' }
}

onMounted(() => users.loadBackupHistory())
</script>

<style scoped>
.data-tab { display: flex; flex-direction: column; gap: var(--space-md); }
.section {
  background: var(--surface-bg);
  border: 1px solid var(--border-light);
  border-radius: var(--radius-md);
  padding: var(--space-lg);
}
.section h4 {
  margin: 0 0 var(--space-md);
  font-size: var(--fs-base);
  font-weight: 600;
  color: var(--text-primary);
  display: flex;
  align-items: center;
  gap: var(--space-sm);
}
.hint { font-size: var(--fs-sm); color: var(--text-secondary); margin: 0 0 var(--space-md); }
.actions { display: flex; gap: var(--space-sm); flex-wrap: wrap; }
.tip { font-size: var(--fs-xs); color: var(--text-muted); margin: var(--space-sm) 0 0; }
.sync-line { font-size: var(--fs-sm); color: var(--text-secondary); margin: 0; }
.ok { color: var(--color-success); font-weight: 500; }
.off { color: var(--color-danger); font-weight: 500; }
.empty { font-size: var(--fs-sm); color: var(--text-muted); }
.history-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: var(--space-xs); max-height: 200px; overflow-y: auto; }
.history-list li { display: flex; align-items: center; gap: var(--space-md); font-size: var(--fs-sm); }
.history-kind {
  padding: 1px 8px;
  border-radius: var(--radius-sm);
  font-size: var(--fs-xs);
  font-weight: 500;
}
.history-kind.backup { background: var(--color-primary-light); color: var(--color-primary); }
.history-kind.restore { background: var(--color-warning-light); color: var(--color-warning); }
.history-time { color: var(--text-secondary); }
</style>