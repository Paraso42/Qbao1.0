<!-- 侧栏：科目树 + 导航区 + 账号区（DeepSeek 官方侧栏体系） -->
<template>
  <aside id="sidebar" :class="{ 'mobile-open': ui.sidebarOpen }">
    <div id="sidebar-header">
      <h2>科目</h2>
      <button class="btn btn-ghost btn-small" @click="addSubject"><Icon name="plus" :size="13" /> 科目</button>
    </div>

    <div id="sidebar-body">
      <EmptyState v-if="subjects.list.length === 0" icon="book" title="暂无科目" hint="点击「+ 科目」开始" />
      <div v-else class="subject-list">
        <div v-for="(s, sidx) in subjects.list" :key="s.id" class="subject-group" :class="{ collapsed: s.collapsed }">
          <div class="subject-header" :class="{ active: s.id === data.state.currentSubjectId }" @click="toggleExpand(s.id)">
            <span class="subj-arrow" aria-hidden="true">
              <Icon name="chevron-down" :size="13" :class="{ rotated: s.collapsed }" />
            </span>
            <span class="subj-name">{{ s.name }}</span>
            <span class="subj-count tabular-nums" title="查看科目总览" @click.stop="openDash(s.id)">{{ s.chapterIds.length }}</span>
            <span class="subj-actions" @click.stop>
              <button class="subj-btn" title="科目总览" @click="openDash(s.id)"><Icon name="chart" :size="13" /></button>
              <button class="subj-btn" :disabled="sidx === 0" title="置顶" @click="subjects.moveToTop(s.id)"><Icon name="arrow-up" :size="13" /></button>
              <button class="subj-btn" title="重命名" @click="renameSubject(s)"><Icon name="edit" :size="13" /></button>
              <button class="subj-btn del" title="删除" @click="deleteSubject(s)"><Icon name="trash" :size="13" /></button>
            </span>
          </div>

          <div v-if="!s.collapsed" class="chapter-list">
            <div v-for="(cid, cidx) in s.chapterIds" :key="cid">
              <div v-if="data.state.chapters[cid]" class="chapter-item" :class="{ active: cid === data.state.currentChapterId }" @click="selectChapter(cid)" @dblclick="renameChapter(cid)">
                <div class="chapter-info">
                  <span class="chapter-name">{{ data.state.chapters[cid].name }}</span>
                  <span class="chapter-count tabular-nums">{{ chapterAnswered(cid) }}/{{ chapterTotal(cid) }} 题</span>
                  <span class="chapter-bar"><span class="chapter-bar-fill" :style="{ width: chapterPct(cid) + '%' }"></span></span>
                </div>
                <span class="ch-actions" @click.stop>
                  <button class="ch-btn" :disabled="cidx === 0" title="置顶" @click="subjects.moveChapterToTop(s.id, cid)"><Icon name="arrow-up" :size="12" /></button>
                  <button class="ch-btn" title="重命名" @click="renameChapter(cid)"><Icon name="edit" :size="12" /></button>
                  <button class="ch-btn del" title="删除" @click="deleteChapter(cid)"><Icon name="trash" :size="12" /></button>
                </span>
              </div>
            </div>
            <button class="btn-add-chapter" @click="addChapter(s.id)"><Icon name="plus" :size="11" /> 新建章节</button>
          </div>
        </div>
      </div>

    </div>

    <div id="sidebar-footer">
      <div class="ai-row" :class="{ 'ai-row-open': data.state.aiEnabled }" :title="data.state.aiEnabled ? '点击查看 AI 任务' : ''" @click="onAiRowClick">
        <span class="ai-label"><Icon name="sparkle" :size="14" /> AI 出题</span>
        <span v-if="aiRunning > 0" class="ai-row-badge run">{{ aiRunning }}</span>
        <span class="ai-row-switch" @click.stop><Toggle :model-value="data.state.aiEnabled" @change="toggleAi" /></span>
      </div>
      <div class="user-row" @click="ui.openUserCenter">
        <span class="user-avatar">
          <img v-if="avatarUrl" :src="avatarUrl" :alt="user.shortName" @error="avatarUrl = ''" />
          <span v-else>{{ user.shortName }}</span>
        </span>
        <span class="user-name">{{ user.user.displayName || user.user.username }}</span>
        <!-- v3.38：同步状态顶栏已有（tb-pill），此处右侧改为游戏门户入口；AI 出题等待时高亮引导 -->
        <button
          class="user-game"
          :class="{ hint: gameHint }"
          :title="gameHint ? 'AI 生成中，去游戏空间放松一下？' : '游戏空间'"
          @click.stop="ui.openGamesPortal()"
        >
          <Icon name="gamepad" :size="15" />
          <span v-if="gameHint" class="game-badge" aria-hidden="true"></span>
        </button>
      </div>
    </div>
  </aside>
  <div class="sidebar-overlay" :class="{ active: ui.sidebarOpen }" @click="ui.toggleSidebar"></div>
</template>

<script setup>
import { computed, ref, watch } from 'vue'
import { useUiStore } from '../../stores/ui'
import { useDataStore } from '../../stores/data'
import { useSubjectStore } from '../../stores/subjects'
import { useUserStore } from '../../stores/user'
import { useQuizStore } from '../../stores/quiz'
import { useAiStore } from '../../stores/ai'
import Icon from '../ui/Icon.vue'
import EmptyState from '../ui/EmptyState.vue'
import Toggle from '../ui/Toggle.vue'
import { resolveMediaUrl } from '../../services/utils'
import { chapterQuestionTotal } from '../../services/chapterStats'

const ui = useUiStore()
const data = useDataStore()
const subjects = useSubjectStore()
const user = useUserStore()
const quiz = useQuizStore()
const ai = useAiStore()

const avatarUrl = ref(resolveMediaUrl((user.user && (user.user.avatarUrl || user.user.avatar)) || ''))
watch(() => (user.user && (user.user.avatarUrl || user.user.avatar)) || '', (v) => { avatarUrl.value = resolveMediaUrl(v) })

const aiRunning = computed(() => {
  const queue = data.state.aiTaskQueue || []
  return queue.filter((t) => t.status === 'pending' || t.status === 'running').length
})

// v3.38：等待场景 → 游戏入口高亮引导（纯样式、不抢焦点、无弹窗）
const gameHint = computed(() => aiRunning.value > 0)

function chapterTotal(cid) {
  // 题量口径与题库一致：轮次题数之和，旧章节回退题库数组
  return chapterQuestionTotal(data.state.chapters[cid])
}
function chapterAnswered(cid) {
  const ch = data.state.chapters[cid]
  if (!ch) return 0
  let answered = 0
  // 未作答位经 JSON 往返会成为 null，必须与 -1/undefined 同等视为未作答，
  // 否则“本轮未答完”也会显示成全部答完（如 15 题出两轮显示 30/30）
  ;(ch.quizSets || []).forEach((set) => {
    if (set.userAnswers) answered += set.userAnswers.filter((a) => a !== undefined && a !== null && a !== -1).length
  })
  return answered
}
function chapterPct(cid) {
  const total = chapterTotal(cid)
  if (!total) return 0
  return Math.min(100, Math.round(chapterAnswered(cid) / total * 100))
}

async function addSubject() {
  const name = await ui.openPrompt('新建科目', '科目 ' + (Object.keys(data.state.subjects).length + 1))
  if (name) subjects.create(name)
}
async function renameSubject(s) {
  const name = await ui.openPrompt('重命名科目', s.name)
  if (name) subjects.rename(s.id, name)
}
async function deleteSubject(s) {
  const ok = await ui.openConfirm('删除科目', '删除科目「' + s.name + '」？其下所有章节、题目与学习记录将一并移除，且无法恢复。', '删除', { danger: true })
  if (ok) subjects.remove(s.id)
}
async function addChapter(subjId) {
  const s = data.state.subjects[subjId]
  if (!s) return
  const name = await ui.openPrompt('新建章节', '章节 ' + (s.chapterIds.length + 1))
  if (name) subjects.createChapter(subjId, name)
}
async function renameChapter(cid) {
  const ch = data.state.chapters[cid]
  if (!ch) return
  const name = await ui.openPrompt('重命名章节', ch.name)
  if (name) subjects.renameChapter(cid, name)
}
async function deleteChapter(cid) {
  const ch = data.state.chapters[cid]
  if (!ch) return
  const ok = await ui.openConfirm('删除章节', '删除章节「' + ch.name + '」？该章节下的题目与学习记录将一并移除，且无法恢复。', '删除', { danger: true })
  if (ok) subjects.deleteChapter(cid)
}

function openDash(id) {
  subjects.select(id)
  ui.showScreen('subject-dash')
}
function toggleExpand(id) {
  subjects.toggleCollapse(id)
}
function selectChapter(cid) {
  subjects.switchChapter(cid)
  ui.showScreen('start')
  quiz.restoreQuizFromServer(false)
}

function onAiRowClick() {
  if (!data.state.aiEnabled) return
  ai.openQueueDialog()
}

function toggleAi(v) {
  data.state.aiEnabled = v
  data.saveState()
  ui.toast(v ? 'AI 出题已开启' : 'AI 出题已关闭', 'info')
}
</script>

<style scoped>
#sidebar {
  width: var(--sidebar-width);
  background: var(--sidebar-bg);
  border-right: 1px solid var(--border-light);
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
  overflow: hidden;
  font-size: var(--sidebar-font-size, 13px);
}
#sidebar-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--space-md) var(--space-lg);
  border-bottom: 1px solid var(--border-light);
}
#sidebar-header h2 { font-size: var(--fs-md); font-weight: 600; }
#sidebar-body { flex: 1; overflow-y: auto; padding: var(--space-sm) var(--space-sm) var(--space-lg); }
.subject-list { display: flex; flex-direction: column; gap: 2px; }
.subject-group { border-radius: var(--radius-md); }
.subject-header {
  position: relative;
  display: flex;
  align-items: center;
  gap: 6px;
  min-height: 40px;
  padding: 8px 10px;
  border-radius: var(--radius-md);
  cursor: pointer;
  color: var(--text-secondary);
  transition: background var(--transition-fast), color var(--transition-fast);
}
.subject-header:hover { background: var(--surface-hover); color: var(--text-primary); }
.subject-header.active { background: var(--sidebar-active); color: var(--text-primary); }
.subj-arrow { display: flex; color: var(--text-muted); transition: transform var(--transition-fast); }
.subj-arrow .icon.rotated { transform: rotate(-90deg); }
.subj-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 500; }
.subj-count {
  font-size: var(--fs-xs); color: var(--text-muted);
  background: var(--surface-hover); border-radius: var(--radius-full);
  padding: 0 7px; line-height: 17px; cursor: pointer; flex-shrink: 0;
}
.subj-count:hover { color: var(--color-primary); background: var(--color-primary-light); }
/* 悬停操作按钮绝对定位覆盖右侧，不产生任何布局位移 */
.subj-actions {
  position: absolute;
  right: 8px;
  top: 50%;
  transform: translateY(-50%);
  display: none;
  gap: 2px;
  background: inherit;
  padding-left: 10px;
  border-radius: 0 var(--radius-md) var(--radius-md) 0;
}
.subject-header:hover .subj-actions { display: inline-flex; }
.subj-btn, .ch-btn {
  width: 26px; height: 26px;
  display: flex; align-items: center; justify-content: center;
  border-radius: var(--radius-sm);
  color: var(--text-muted);
}
.subj-btn:hover, .ch-btn:hover { background: var(--surface-hover); color: var(--text-primary); }
.subj-btn.del:hover, .ch-btn.del:hover { color: var(--color-danger); background: var(--color-danger-light); }
.subj-btn:disabled, .ch-btn:disabled { opacity: 0.3; cursor: default; }
.chapter-list { padding-left: var(--space-lg); display: flex; flex-direction: column; gap: 2px; }
.chapter-item {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  min-height: 40px;
  padding: 8px 10px;
  border-radius: var(--radius-md);
  cursor: pointer;
  color: var(--text-secondary);
  transition: background var(--transition-fast), color var(--transition-fast);
}
.chapter-item:hover { background: var(--surface-hover); color: var(--text-primary); }
.chapter-item.active { background: var(--sidebar-active); color: var(--text-primary); }
.chapter-item.active .chapter-name { color: var(--color-primary); font-weight: 500; }
.chapter-info { display: flex; flex-direction: column; min-width: 0; flex: 1; gap: 3px; }
.chapter-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.chapter-count { font-size: 11px; color: var(--text-muted); }
.chapter-bar { height: 2px; background: var(--surface-hover); border-radius: var(--radius-full); overflow: hidden; }
.chapter-bar-fill { display: block; height: 100%; background: var(--color-primary); opacity: 0.55; border-radius: var(--radius-full); transition: width 0.4s ease; }
.ch-actions {
  position: absolute;
  right: 8px;
  top: 50%;
  transform: translateY(-50%);
  display: none;
  gap: 2px;
  flex-shrink: 0;
  background: inherit;
  padding-left: 10px;
  border-radius: 0 var(--radius-md) var(--radius-md) 0;
}
.chapter-item:hover .ch-actions { display: inline-flex; }
.btn-add-chapter {
  width: 100%;
  padding: 8px 10px;
  border-radius: var(--radius-md);
  color: var(--text-secondary);
  font-size: var(--fs-xs);
  text-align: left;
  display: flex;
  align-items: center;
  gap: 5px;
}
.btn-add-chapter:hover { background: var(--surface-hover); color: var(--color-primary); }

#sidebar-footer { border-top: 1px solid var(--border-light); padding: var(--space-md) var(--space-sm) calc(var(--space-md) + env(safe-area-inset-bottom)); }
.ai-row {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: var(--space-sm);
  padding: 8px 10px;
  border-radius: var(--radius-md);
  cursor: default;
  transition: background var(--transition-fast), color var(--transition-fast);
}
.ai-row.ai-row-open { cursor: pointer; }
.ai-row.ai-row-open:hover { background: var(--surface-hover); }
.ai-label { display: flex; align-items: center; gap: 6px; font-size: var(--fs-sm); color: var(--text-secondary); flex: 1; }
.ai-row-badge {
  min-width: 18px;
  height: 18px;
  padding: 0 5px;
  border-radius: var(--radius-full);
  background: var(--color-primary);
  color: #fff;
  font-size: 11px;
  font-weight: 600;
  line-height: 18px;
  text-align: center;
}
.ai-row-switch { display: flex; align-items: center; }
.user-row {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 8px 10px;
  border-radius: var(--radius-md);
  cursor: pointer;
  text-align: left;
}
.user-row:hover { background: var(--surface-hover); }
.user-row.login-cta { color: var(--color-primary); }
.user-row.login-cta:hover { background: var(--color-primary-light); }
.user-avatar {
  width: 28px; height: 28px;
  border-radius: 50%;
  background: var(--gradient-primary);
  color: #fff;
  display: flex; align-items: center; justify-content: center;
  font-size: var(--fs-sm); font-weight: 600;
  flex-shrink: 0;
  overflow: hidden;
}
.user-avatar img { width: 100%; height: 100%; border-radius: 50%; object-fit: cover; }
.user-avatar.ghost { background: var(--surface-hover); color: var(--text-muted); }
.user-name { font-size: var(--fs-sm); color: var(--text-primary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; }
.user-game {
  position: relative;
  width: 28px; height: 28px;
  display: flex; align-items: center; justify-content: center;
  border-radius: var(--radius-sm);
  color: var(--text-muted);
  background: transparent;
  border: none;
  cursor: pointer;
  flex-shrink: 0;
  transition: background var(--transition-fast), color var(--transition-fast);
}
.user-game:hover { background: var(--surface-hover); color: var(--color-primary); }
.user-game.hint { color: var(--color-primary); animation: game-pulse 1.1s ease-in-out infinite; }
.user-game .game-badge {
  position: absolute;
  top: 3px; right: 3px;
  width: 7px; height: 7px;
  border-radius: 50%;
  background: var(--color-primary);
  border: 1.5px solid var(--sidebar-bg);
}
@keyframes game-pulse {
  0%, 100% { box-shadow: 0 0 0 0 rgba(67, 97, 238, 0); }
  50% { box-shadow: 0 0 0 5px rgba(67, 97, 238, 0.22); }
}
@keyframes pulse { 50% { opacity: 0.4; } }

.sidebar-overlay { display: none; }
@media (max-width: 900px) {
  #sidebar {
    position: fixed;
    left: 0;
    top: var(--topbar-height);
    height: calc(100dvh - var(--topbar-height));
    z-index: var(--z-sidebar);
    transform: translateX(-100%);
    transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1);
    box-shadow: var(--shadow-lg);
  }
  #sidebar.mobile-open { transform: translateX(0); }
  .sidebar-overlay {
    display: block;
    position: fixed;
    inset: var(--topbar-height) 0 0 0;
    background: rgba(0, 0, 0, 0.3);
    z-index: var(--z-sidebar-overlay);
    opacity: 0;
    pointer-events: none;
    transition: opacity 0.3s ease;
  }
  .sidebar-overlay.active { opacity: 1; pointer-events: auto; }
  .subj-actions, .ch-actions { position: static; transform: none; display: inline-flex; padding-left: 0; }
  .subj-count { display: none; }
  .subj-btn, .ch-btn { width: 30px; height: 30px; }
}
</style>
