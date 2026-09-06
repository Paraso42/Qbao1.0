<!-- 科目总览（总览/题库/大考卷，自 legacy dashboard.js + exam.js 迁移，DeepSeek 风格） -->
<template>
  <section>
    <div class="sd-head">
      <h1>{{ subj ? subj.name : '科目总览' }}</h1>
      <button class="btn btn-secondary btn-small" @click="ui.showScreen('start')">← 返回主页</button>
    </div>

    <div class="tabs sd-tabs">
      <div v-for="t in tabs" :key="t.key" class="tab" :class="{ active: tab === t.key }" @click="tab = t.key">{{ t.label }}</div>
    </div>

    <!-- 总览（v3.37 重构：专业看板；点击章节行 drill-down 到题库 tab） -->
    <SubjectOverviewPanel v-if="tab === 'overview'" @open-bank="onOpenBank" />
    <!-- 题库 -->
    <div v-else-if="tab === 'questionbank'" class="sd-content">
      <div class="qbank-toolbar">
        <label class="qb-check"><input type="checkbox" v-model="qbOnlyWrong"> 仅显示错题</label>
        <div class="qb-search"><Icon name="search" :size="14" /><input v-model="qbKeyword" class="qb-input" type="text" placeholder="搜索题目/标签..."></div>
        <template v-if="qbSelectMode">
          <span class="qb-sel-count">已选 {{ qbSelected.size }} 题</span>
          <select v-model="qbMoveTarget" class="select" style="max-width: 180px">
            <option value="">移动到章节…</option>
            <option v-for="m in qbMoveChapters" :key="m.cid" :value="m.cid">{{ m.name }}</option>
          </select>
          <button class="btn btn-secondary btn-small" @click="qbBulkTag"><Icon name="tag" :size="12" /> 设标签</button>
          <button class="btn btn-danger btn-small" @click="qbBulkDelete"><Icon name="trash" :size="12" /> 删除</button>
          <button class="btn btn-ghost btn-small" @click="qbExitSelect">退出</button>
        </template>
        <button v-else class="btn btn-ghost btn-small" @click="qbEnterSelect"><Icon name="check" :size="13" /> 批量</button>
        <div class="qb-tool-actions">
          <button class="btn btn-secondary btn-small" @click="ui.openImport()"><Icon name="upload" :size="13" /> 导入</button>
          <button class="btn btn-secondary btn-small" @click="exportChapter"><Icon name="download" :size="13" /> 导出</button>
        </div>
      </div>
      <div v-for="group in qbankGroups" :key="group.cid" class="card qb-group">
        <h4 class="qb-header" role="button" @click="toggleQbGroup(group.cid)">
          <span class="qb-caret"><Icon name="chevron-down" :size="13" :class="{ rotated: !openQbGroups.has(group.cid) }" /></span>
          {{ group.chName }}
          <span class="qb-meta">{{ group.total }} 题 · {{ group.rounds.length }} 轮出题</span>
        </h4>
        <template v-if="openQbGroups.has(group.cid)">
          <div v-if="group.rounds.length === 0" class="qb-empty">无匹配题目</div>
          <div v-for="r in group.rounds" :key="r.key" class="qb-round">
            <div class="qb-round-head" role="button" @click="toggleQbRound(r.key)">
              <span class="qb-caret"><Icon name="chevron-down" :size="12" :class="{ rotated: !openQbRounds.has(r.key) }" /></span>
              <span class="qb-round-title">{{ r.title }}</span>
              <span class="qb-meta">{{ r.items.length }} 题</span>
            </div>
            <template v-if="openQbRounds.has(r.key)">
              <div v-for="item in shownQbItems(r)" :key="item.key" class="qb-item" :class="item.ci === true ? 'correct' : (item.ci === false ? 'wrong' : '')" @click="openDetail(item)">
                <div v-if="qbSelectMode" class="qb-sel-box" :class="{ on: qbSelected.has(item.key) }" @click.stop="qbToggleSelect(item.key)"><Icon :name="qbSelected.has(item.key) ? 'check' : 'square'" :size="13" /></div>
                <span class="qb-icon" :class="qbIconClass(item.ci)"></span>
                <div class="qb-text">
                  <p class="qb-q">[{{ typeShort[item.q.type] || item.q.type }}] {{ item.q.tag || '' }}：{{ shortText(item.q.question, 60) }}</p>
                  <p v-if="item.q.explanation" class="qb-detail">{{ shortText(item.q.explanation, 80) }}</p>
                </div>
              </div>
              <button v-if="r.items.length > (qbLimits[r.key] || 50)" class="qb-more" @click="qbLimits[r.key] = (qbLimits[r.key] || 50) + 50">
                显示更多（已显示 {{ qbLimits[r.key] || 50 }} / {{ r.items.length }}）
              </button>
            </template>
          </div>
        </template>
      </div>
    </div>

    <!-- 大考卷 -->
    <div v-else-if="tab === 'compose-exam'" class="sd-content">
      <div class="card">
        <h3>大考卷 — {{ subj ? subj.name : '' }}</h3>
        <p class="ce-hint">从本科目各章节中抽取题目，组成综合试卷。</p>
        <h4>1. 选择章节</h4>
        <div class="ce-chapters">
          <template v-for="cid in (subj ? subj.chapterIds : [])" :key="cid">
            <label v-if="data.state.chapters[cid]" class="ce-ch">
              <input type="checkbox" :value="cid" v-model="checkedCids" @change="resetWeights">
              <span class="ce-ch-name">{{ data.state.chapters[cid].name }}</span>
              <span class="ce-ch-count tabular-nums">{{ chapterQuestionTotal(data.state.chapters[cid]) }} 题</span>
            </label>
          </template>
        </div>

        <h4>2. 各题型数量</h4>
        <div class="type-counts">
          <div v-for="t in examTypes" :key="t.key" class="type-count-item">
            <label>{{ t.label }}</label>
            <div class="num-picker">
              <button class="num-btn" @click="examTc[t.key] = Math.max(0, examTc[t.key] - 5)">−</button>
              <input v-model.number="examTc[t.key]" class="num-input" type="number" min="0" max="50">
              <button class="num-btn" @click="examTc[t.key] = Math.min(50, examTc[t.key] + 5)">+</button>
            </div>
          </div>
        </div>
        <p class="ce-total">总题数：{{ examTotal }} 题</p>

        <h4>3. 章节占比（总和100%）</h4>
        <p v-if="checkedCids.length === 0" class="ce-empty">请先勾选章节</p>
        <p v-else-if="checkedCids.length === 1" class="ce-empty">仅一个章节占比固定 100%</p>
        <div v-else>
          <div class="cum-track">
            <div v-for="(w, i) in weights" :key="i" class="cum-seg" :style="segStyle(i)"></div>
            <input v-for="(s, i) in cumSliders" :key="'s' + i" type="range" min="0" max="100" step="1" :value="s" @input="onCumSlider(i, $event)">
          </div>
          <div class="cum-labels">
            <div v-for="(cid, i) in checkedCids" :key="cid" class="cum-row">
              <span class="cum-dot" :style="{ background: examColors[i % 10] }"></span>
              <span class="cum-name">{{ data.state.chapters[cid] ? data.state.chapters[cid].name : '未知' }}</span>
              <input v-model.number="weights[i]" class="cum-input" type="number" min="1" max="99" @change="onWeightInput(i)">
            </div>
          </div>
        </div>

        <h4>4. 出题策略（不含新题）</h4>
        <div class="strategy-labels">
          <span><i class="pct-dot err"></i>针对错题 <input v-model.number="examErrPct" class="pct-input" type="number" min="0" max="100">%</span>
          <span><i class="pct-dot review"></i>滚动复习 {{ 100 - examErrPct }}%</span>
        </div>
        <div class="dual-range-wrap">
          <div class="dual-track-bg"></div>
          <div class="dual-track-fill err" :style="{ width: examErrPct + '%' }"></div>
          <div class="dual-track-fill review" :style="{ width: (100 - examErrPct) + '%', left: examErrPct + '%' }"></div>
          <input type="range" min="0" max="100" step="1" :value="examErrPct" @input="examErrPct = parseInt($event.target.value) || 0">
        </div>

        <div class="ce-actions">
          <button class="btn btn-success" @click="compose">生成大考卷</button>
        </div>
      </div>

      <div class="card">
        <h4>历史试卷</h4>
        <div v-if="examList.length === 0" class="qb-empty">暂无历史试卷</div>
        <div v-for="ex in examList" :key="ex.id" class="exam-item" @click="openExam(ex)">
          <span class="exam-icon"><Icon name="file" :size="15" /></span>
          <div class="exam-main">
            <div class="exam-name">{{ ex.name }}</div>
            <div class="exam-meta">{{ ex.questions.length }} 题 · {{ new Date(ex.createdAt).toLocaleString('zh-CN') }}</div>
            <div v-if="examFinished(ex)" class="exam-meta exam-done">已完成 · 正确率 {{ examRate(ex) }}%</div>
          </div>
          <button class="btn btn-primary btn-small" @click.stop="openExam(ex)">{{ examFinished(ex) ? '查看报告' : '开始答题' }}</button>
        </div>
      </div>
    </div>

    <!-- 题目详情 -->
    <Modal :open="!!detail" @close="detail = null">
      <div v-if="detail" class="qdetail">
        <h3 class="qd-title">题目详情{{ detail.roundIdx >= 0 ? ' (第' + (detail.roundIdx + 1) + '轮)' : '' }}</h3>
        <p class="qd-q"><strong>[{{ typeNames[detail.q.type] || detail.q.type }}]</strong> <span v-html="renderMarkdown(detail.q.question)"></span></p>
        <div v-if="isObjType(detail.q.type)" class="qd-options">
          <div v-for="(opt, i) in (detail.q.options || [])" :key="i" class="qd-opt" :class="{ ok: i === detail.q.answer }">
            {{ letter(i) }}. <span v-html="renderMarkdown(opt)"></span>
          </div>
        </div>
        <div v-if="detail.userAnswer !== undefined" class="qd-ans" :class="detail.ci === true ? 'ok' : (detail.ci === false ? 'bad' : '')">
          你的答案：{{ detail.userAnswer }}
        </div>
        <div v-if="detail.q.explanation" class="qd-exp"><h4>解析</h4><p v-html="renderMarkdown(detail.q.explanation)"></p></div>
      </div>
      <div class="dialog-actions"><button class="btn btn-secondary btn-small" @click="detail = null">关闭</button></div>
    </Modal>
  </section>
</template>

<script setup>
import { computed, reactive, ref, watch } from 'vue'
import { useDataStore } from '../stores/data'
import { useSubjectStore } from '../stores/subjects'
import { useUiStore } from '../stores/ui'
import { downloadTextFile, exportQuestionsJson } from '../services/importExport'
import { useQuizStore } from '../stores/quiz'
import { isObjType, getCi } from '../services/utils'
import { composeSubjExam, getExamSettings } from '../services/exam'
import { renderMarkdown } from '../services/utils'
import { chapterQuestionTotal } from '../services/chapterStats'
import Icon from '../components/ui/Icon.vue'
import Modal from '../components/ui/Modal.vue'
import SubjectOverviewPanel from './SubjectOverviewPanel.vue'

const data = useDataStore()
const subjects = useSubjectStore()
const ui = useUiStore()
const quiz = useQuizStore()

function exportChapter() {
  const ch = data.getCh()
  if (!ch || !ch.questions || ch.questions.length === 0) { ui.toast('当前章节没有可导出的题目', 'err'); return }
  const json = exportQuestionsJson(ch.questions, { chapterName: ch.name, chapterId: ch.id, exportedAt: new Date().toISOString() })
  const pad = (n) => String(n).padStart(2, '0')
  const d = new Date()
  downloadTextFile('Qbao_' + (ch.name || '章节') + '_' + d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + '.json', json)
  ui.toast('已导出 ' + ch.questions.length + ' 道题目', 'ok')
}

const tabs = [
  { key: 'overview', label: '总览' },
  { key: 'questionbank', label: '题库' },
  { key: 'compose-exam', label: '大考卷' }
]
const tab = ref('overview')
const detail = ref(null)
function openDetail(item) {
  detail.value = {
    q: item.q,
    roundIdx: item.roundIdx,
    qIdx: item.qIdx,
    ci: item.ci,
    userAnswer: item.userAnswer
  }
}
function letter(i) { return String.fromCharCode(65 + i) }
const subj = computed(() => data.getSubj())
const typeNames = { single: '单选', judge: '判断', term: '名词解释', short: '简答' }
const typeShort = { single: '单选', judge: '判断', term: '名解', short: '简答' }
const examColors = ['#EF4444', '#F59E0B', '#10B981', '#4D6BFE', '#8B5CF6', '#EC4899', '#14B8A6', '#F97316', '#6366F1', '#84CC16']

function rateColor(rate) {
  if (rate >= 70) return '#10B981'
  if (rate >= 40) return '#F59E0B'
  return '#EF4444'
}
// v3.33.1 修复：P2.2 重构误删（shortText 函数体被并入 rateColor），模板 3 处调用导致
// 题库/间隔复习 tab 渲染即 TypeError 白屏 —— 恢复截断助手
function shortText(t, n) {
  const s = String(t || '')
  return s.length > n ? s.substring(0, n) + '...' : s
}
function qbIconClass(ci) {
  if (ci === true) return 'ok'
  if (ci === false) return 'bad'
  return 'pending'
}

// —— 题库（v3.34：章节 → 轮次出题 → 题目，两级折叠） ——
const qbOnlyWrong = ref(false)
const qbKeyword = ref('')
// 章节级折叠：默认只展开第一个分组；单轮内最多先渲染 50 条
const openQbGroups = reactive(new Set())
const openQbRounds = reactive(new Set())
const qbLimits = reactive({})
function toggleQbGroup(cid) {
  if (openQbGroups.has(cid)) openQbGroups.delete(cid)
  else openQbGroups.add(cid)
}
// v3.37：总览看板章节行 drill-down → 题库 tab 并展开该章节分组
function onOpenBank(cid) {
  tab.value = 'questionbank'
  openQbGroups.add(cid)
}
function toggleQbRound(key) {
  if (openQbRounds.has(key)) openQbRounds.delete(key)
  else openQbRounds.add(key)
}
function shownQbItems(round) {
  return round.items.slice(0, qbLimits[round.key] || 50)
}
function qbMatch(q, kw) {
  return !!((q.question && q.question.toLowerCase().includes(kw)) ||
    (q.tag && q.tag.toLowerCase().includes(kw)) ||
    (q.explanation && q.explanation.toLowerCase().includes(kw)))
}
// 题目最近一次作答结果（按题干+类型+答案签名在章节 history 中倒序匹配）
function latestResult(cid, q, key) {
  const h = data.state.history || []
  for (let i = h.length - 1; i >= 0; i--) {
    const r = h[i]
    if (!r || r.chapterId !== cid || !r.questions) continue
    for (let j = r.questions.length - 1; j >= 0; j--) {
      const x = r.questions[j]
      if (x && x.question === q.question && x.type === q.type && x.answer === q.answer) {
        return key === 'userAnswer' ? x.userAnswer : x.isCorrect
      }
    }
  }
  return undefined
}
function fmtRoundTime(t) {
  if (!t) return ''
  try { return new Date(t).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) } catch (e) { return '' }
}
const qbankGroups = computed(() => {
  const s = subj.value
  if (!s) return []
  const kw = qbKeyword.value.trim().toLowerCase()
  return s.chapterIds.map((cid) => {
    const ch = data.state.chapters[cid]
    if (!ch) return null
    const rounds = []
    const sets = Array.isArray(ch.quizSets) && ch.quizSets.length > 0 ? ch.quizSets : null
    if (sets) {
      sets.slice().reverse().forEach((set, rev) => {
        if (!set || !Array.isArray(set.questions) || set.questions.length === 0) return
        const items = []
        set.questions.forEach((q, qi) => {
          const ci = latestResult(cid, q, 'ci')
          if (qbOnlyWrong.value && ci !== false) return
          if (kw && !qbMatch(q, kw)) return
          items.push({ key: cid + ':r' + (sets.length - 1 - rev) + ':' + qi, q, ci, cid, roundIdx: sets.length - 1 - rev, qIdx: qi, userAnswer: latestResult(cid, q, 'userAnswer') })
        })
        if (items.length === 0) return
        const si = sets.length - 1 - rev
        rounds.push({ key: cid + ':r' + si, title: '第 ' + (si + 1) + ' 轮出题 · ' + fmtRoundTime(set.createdAt), items, createdAt: set.createdAt || 0 })
      })
    } else if (Array.isArray(ch.questions)) {
      const items = []
      ch.questions.forEach((q, qi) => {
        const ci = latestResult(cid, q, 'ci')
        if (qbOnlyWrong.value && ci !== false) return
        if (kw && !qbMatch(q, kw)) return
        items.push({ key: cid + ':legacy:' + qi, q, ci, cid, roundIdx: -1, qIdx: qi, userAnswer: latestResult(cid, q, 'userAnswer') })
      })
      if (items.length > 0) rounds.push({ key: cid + ':legacy', title: '导入题', items, createdAt: 0 })
    }
    const total = sets
      ? sets.reduce((a, set) => a + (set && Array.isArray(set.questions) ? set.questions.length : 0), 0)
      : (Array.isArray(ch.questions) ? ch.questions.length : 0)
    return { cid, chName: ch.name, ch, rounds, total }
  }).filter(Boolean)
})

// 题库折叠默认：首帧展开第一个分组；每个展开分组内自动展开最新一轮；之后尊重用户状态。
// v3.33.1 修复延续：immediate 使首帧就展开第一组（此前首次渲染全折叠）。
watch(qbankGroups, (groups) => {
  if (!groups.length) return
  if (!groups.some((g) => openQbGroups.has(g.cid))) {
    groups.forEach((g) => openQbGroups.delete(g.cid))
    openQbGroups.add(groups[0].cid)
  }
  groups.forEach((g) => {
    if (!openQbGroups.has(g.cid) || !g.rounds.length) return
    if (!g.rounds.some((r) => openQbRounds.has(r.key))) openQbRounds.add(g.rounds[0].key)
  })
}, { immediate: true })

// —— P3.3 批量编辑（选择模式：移动/删除/设标签） ——
const qbSelectMode = ref(false)
const qbSelected = reactive(new Set())
const qbMoveTarget = ref('')

function qbEnterSelect() { qbSelectMode.value = true; qbSelected.clear() }
function qbExitSelect() { qbSelectMode.value = false; qbSelected.clear(); qbMoveTarget.value = '' }
function qbToggleSelect(key) { if (qbSelected.has(key)) qbSelected.delete(key); else qbSelected.add(key) }

// 选中项还原为 qbankGroups 中的条目（含 q/章节引用）
const qbSelectedItems = computed(() => {
  const byKey = {}
  qbankGroups.value.forEach((g) => g.items.forEach((it) => { byKey[it.key] = it }))
  return Array.from(qbSelected).map((k) => byKey[k]).filter(Boolean)
})

// 按签名在题库（ch.questions）中定位（history 副本 → 题库本体）
function findInChapter(ch, q) {
  return (ch && ch.questions && ch.questions.findIndex((x) => x.question === q.question && x.type === q.type && x.answer === q.answer)) ?? -1
}
function qbBulkDelete() {
  const items = qbSelectedItems.value
  if (!items.length) { ui.toast('请先勾选题目', 'err'); return }
  ui.openConfirm('批量删除', '确定删除选中的 ' + items.length + ' 道题目？将从题库中移除（历史记录保留）。', '删除', { danger: true }).then((ok) => {
    if (!ok) return
    let removed = 0
    const removal = new Set(items.map((it) => JSON.stringify([it.cid, it.q.question, it.q.type, it.q.answer])))
    Object.keys(data.state.chapters).forEach((cid) => {
      const ch = data.state.chapters[cid]
      if (!ch || !Array.isArray(ch.questions)) return
      const keep = []
      const keepAns = []
      ch.questions.forEach((q, i) => {
        const sig = JSON.stringify([cid, q.question, q.type, q.answer])
        if (removal.has(sig)) {
          removed++
        } else {
          keep.push(q)
          if (ch.userAnswers) keepAns.push(ch.userAnswers[i])
        }
      })
      ch.questions = keep
      if (ch.userAnswers) ch.userAnswers = keepAns
      // quizSets 中相同签名一并移除（轮次不残留孤儿题）
      if (Array.isArray(ch.quizSets)) {
        ch.quizSets.forEach((set) => {
          if (!Array.isArray(set.questions)) return
          const kq = [], ka = []
          set.questions.forEach((q, i) => {
            const sig = JSON.stringify([cid, q.question, q.type, q.answer])
            if (removal.has(sig)) return
            kq.push(q); if (set.userAnswers) ka.push(set.userAnswers[i])
          })
          set.questions = kq
          if (set.userAnswers) set.userAnswers = ka
        })
        ch.quizSets = ch.quizSets.filter((set) => !set.questions || set.questions.length > 0)
      }
    })
    data.saveState()
    qbExitSelect()
    ui.toast('已删除 ' + removed + ' 道题目', 'ok')
  }).catch(() => {})
}

const qbMoveChapters = computed(() => {
  const s = subj.value
  if (!s) return []
  return s.chapterIds.map((cid) => ({ cid, name: (data.state.chapters[cid] || {}).name || cid }))
})
function qbBulkMove() {
  const targetCid = qbMoveTarget.value
  const items = qbSelectedItems.value
  if (!targetCid) { ui.toast('请先选择目标章节', 'err'); return }
  if (!items.length) return
  const target = data.state.chapters[targetCid]
  if (!target) return
  if (!target.questions) target.questions = []
  if (!target.userAnswers) target.userAnswers = []
  let moved = 0
  const sigs = new Set(items.map((it) => JSON.stringify([it.q.question, it.q.type, it.q.answer])))
  const movedQs = []
  Object.keys(data.state.chapters).forEach((cid) => {
    if (cid === targetCid) return
    const ch = data.state.chapters[cid]
    if (!ch || !Array.isArray(ch.questions)) return
    const keep = [], keepAns = []
    ch.questions.forEach((q, i) => {
      const sig = JSON.stringify([q.question, q.type, q.answer])
      if (sigs.has(sig) && !target.questions.some((x) => x.question === q.question && x.type === q.type)) {
        target.questions.push(q)
        target.userAnswers.push(ch.userAnswers ? ch.userAnswers[i] : undefined)
        movedQs.push(q)
        moved++
      } else {
        keep.push(q)
        if (ch.userAnswers) keepAns.push(ch.userAnswers[i])
      }
    })
    ch.questions = keep
    if (ch.userAnswers) ch.userAnswers = keepAns
    // 源章节轮次级一并移除（与批量删除一致），避免轮次残留孤儿题
    if (Array.isArray(ch.quizSets)) {
      ch.quizSets.forEach((set) => {
        if (!Array.isArray(set.questions)) return
        const kq = [], ka = []
        set.questions.forEach((q, i) => {
          const sig = JSON.stringify([q.question, q.type, q.answer])
          if (sigs.has(sig)) return
          kq.push(q); if (set.userAnswers) ka.push(set.userAnswers[i])
        })
        set.questions = kq
        if (set.userAnswers) set.userAnswers = ka
      })
      ch.quizSets = ch.quizSets.filter((set) => !set.questions || set.questions.length > 0)
    }
  })
  // 目标侧并入最新轮次（无轮次则新建一组），保证两级题库可见
  if (movedQs.length > 0) {
    if (!target.quizSets) target.quizSets = []
    const last = target.quizSets[target.quizSets.length - 1]
    if (last && Array.isArray(last.questions)) {
      movedQs.forEach((q) => { last.questions.push(q); if (last.userAnswers) last.userAnswers.push(undefined) })
      if (target.currentQuizSetIdx === undefined || target.currentQuizSetIdx < 0) target.currentQuizSetIdx = target.quizSets.length - 1
    } else {
      target.quizSets.push({ questions: movedQs.slice(), userAnswers: new Array(movedQs.length).fill(undefined), currentIdx: 0, createdAt: Date.now() })
      target.currentQuizSetIdx = target.quizSets.length - 1
    }
  }
  data.saveState()
  qbExitSelect()
  ui.toast('已移动 ' + moved + ' 道到 ' + (target.name || '目标章节'), 'ok')
}
function qbBulkTag() {
  const items = qbSelectedItems.value
  if (!items.length) { ui.toast('请先勾选题目', 'err'); return }
  ui.openPrompt('设置标签', '').then((tag) => {
    if (tag == null) return
    const t = String(tag).trim()
    if (!t) { ui.toast('标签不能为空', 'err'); return }
    let tagged = 0
    items.forEach((it) => {
      const ch = data.state.chapters[it.cid]
      const idx = ch && findInChapter(ch, it.q)
      if (ch && idx >= 0) { ch.questions[idx].tag = t; tagged++ }
    })
    data.saveState()
    qbExitSelect()
    ui.toast('已为 ' + tagged + ' 道题目设置标签「' + t + '」', 'ok')
  }).catch(() => {})
}
// 移动目标变化即执行（select 下拉触发）
watch(qbMoveTarget, (v) => { if (v) { qbBulkMove() } })

// —— 大考卷 ——
const examTypes = [
  { key: 'single', label: '单选' },
  { key: 'judge', label: '判断' },

  { key: 'term', label: '名词解释' },
  { key: 'short', label: '简答' }
]
const es = computed(() => (subj.value ? getExamSettings(data.state, subj.value.id) : null))
const checkedCids = ref([])
const examTc = ref({ single: 20, judge: 10, term: 5, short: 1 })
const examErrPct = ref(30)
const cumSliders = ref([])
const weights = ref([])

function initExamForm() {
  const s = subj.value
  if (!s || !es.value) return
  examTc.value = { ...es.value.typeCounts }
  examErrPct.value = es.value.errPct
  checkedCids.value = (es.value._checkedCids || []).filter((cid) => s.chapterIds.includes(cid))
  resetWeights(false)
}
function resetWeights() {
  const n = checkedCids.value.length
  if (n <= 1) { cumSliders.value = []; weights.value = n === 1 ? [100] : []; return }
  const arr = []
  for (let i = 0; i < n - 1; i++) arr.push(Math.round((i + 1) * 100 / n))
  cumSliders.value = arr
  recomputeWeights()
}
function recomputeWeights() {
  const n = checkedCids.value.length
  if (n === 0) { weights.value = []; return }
  if (n === 1) { weights.value = [100]; return }
  const pcts = []
  let prev = 0
  for (let i = 0; i < n; i++) {
    const cur = i < n - 1 ? cumSliders.value[i] : 100
    pcts.push(cur - prev)
    prev = cur
  }
  weights.value = pcts
}
function segStyle(i) {
  const left = weights.value.slice(0, i).reduce((a, b) => a + b, 0)
  return { width: weights.value[i] + '%', left: left + '%', background: examColors[i % 10] }
}
function onCumSlider(i, e) {
  const n = checkedCids.value.length
  const val = parseInt(e.target.value) || 0
  const leftBound = i > 0 ? cumSliders.value[i - 1] : 0
  const rightBound = i < n - 2 ? cumSliders.value[i + 1] : 100
  cumSliders.value[i] = Math.max(leftBound, Math.min(rightBound, val))
  recomputeWeights()
}
function onWeightInput(idx) {
  const n = checkedCids.value.length
  if (n < 2) return
  const newVal = Math.max(1, Math.min(99, parseInt(weights.value[idx]) || 0))
  const pcts = [...weights.value]
  const delta = newVal - pcts[idx]
  if (delta === 0) return
  if (idx === n - 1) pcts[idx - 1] -= delta
  else pcts[idx + 1] -= delta
  pcts[idx] += delta
  for (let i = 0; i < n; i++) {
    if (pcts[i] < 1) {
      if (i < n - 1) { pcts[i + 1] -= (1 - pcts[i]); pcts[i] = 1 }
      else if (i > 0) { pcts[i - 1] -= (1 - pcts[i]); pcts[i] = 1 }
    }
    if (pcts[i] > 99) pcts[i] = 99
  }
  const newSliders = []
  let cum = 0
  for (let i = 0; i < n - 1; i++) { cum += pcts[i]; newSliders.push(cum) }
  cumSliders.value = newSliders
  weights.value = pcts
}
const examTotal = computed(() => examTc.value.single + examTc.value.judge + examTc.value.term + examTc.value.short)
// 考卷完成判定：全部题目都有作答（含 -1 跳过视为已处理）
function examAnsweredCount(ex) {
  if (!ex || !ex.userAnswers) return 0
  return ex.userAnswers.filter((a) => a !== undefined && a !== null && a !== -1).length
}
function examFinished(ex) {
  return !!(ex && ex.questions && ex.questions.length > 0 && examAnsweredCount(ex) >= ex.questions.length)
}
function examRate(ex) {
  if (!ex || !ex.questions || !ex.questions.length) return 0
  let obj = 0, correct = 0
  ex.questions.forEach((qq, i) => {
    if (!qq || !ex.userAnswers || ex.userAnswers[i] === undefined || ex.userAnswers[i] === null || ex.userAnswers[i] === -1) return
    obj++
    if (getCi(qq, ex.userAnswers[i]) === true) correct++
  })
  return obj > 0 ? Math.round(correct / obj * 100) : 0
}
// 打开考卷：已完成 → 报告；未完成 → 继续答题
function openExam(ex) {
  if (examFinished(ex)) quiz.openExamReport(ex.id)
  else quiz.startExam(ex.id)
}
const examList = computed(() => {
  const s = subj.value
  if (!s) return []
  return Object.values(data.state.generatedExams || {}).filter((e) => e.subjectId === s.id && e.type === 'exam').sort((a, b) => b.createdAt - a.createdAt)
})

function compose() {
  const s = subj.value
  if (!s || !es.value) return
  if (checkedCids.value.length === 0) { ui.toast('请至少选择一个章节', 'err'); return }
  const w = weights.value.length === checkedCids.value.length ? weights.value : checkedCids.value.map(() => Math.floor(100 / checkedCids.value.length))
  const result = composeSubjExam(data.state, s.id, checkedCids.value.slice(), { ...examTc.value }, w)
  if (result.error) { ui.toast(result.error, 'err'); return }
  // 记忆设置
  es.value.typeCounts = { ...examTc.value }
  es.value.errPct = examErrPct.value
  es.value.reviewPct = 100 - examErrPct.value
  es.value.newPct = 0
  es.value._checkedCids = checkedCids.value.slice()
  es.value._examCumSliders = cumSliders.value.slice()
  data.saveState()
  ui.toast('大考卷已生成：共 ' + result.exam.questions.length + ' 题', 'ok')
  quiz.startExam(result.exam.id)
}

// 切到该视图时初始化
watch(() => ui.activeScreen, (screen) => {
  if (screen === 'subject-dash') {
    tab.value = 'overview'
    initExamForm()
  }
}, { immediate: true })
</script>

<style scoped>
.sd-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: var(--space-md); flex-wrap: wrap; gap: var(--space-sm); }
.sd-head h1 { margin: 0; }
.sd-tabs { margin-bottom: var(--space-lg); }
.sd-content { animation: screenFadeIn 0.25s ease; }
@keyframes screenFadeIn { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }
.qbank-toolbar { display: flex; align-items: center; gap: var(--space-md); margin-bottom: var(--space-md); flex-wrap: wrap; }
.qb-check { display: flex; align-items: center; gap: 6px; font-size: var(--fs-sm); color: var(--text-secondary); cursor: pointer; }
.qb-check input { accent-color: var(--color-primary); }
.qb-search { display: flex; align-items: center; gap: 6px; color: var(--text-muted); flex: 1; max-width: 320px; }
.qb-input { border: none; background: transparent; flex: 1; padding: 6px 8px; border-radius: var(--radius-sm); background: var(--surface-hover); font-size: var(--fs-sm); }
.qb-input:focus { outline: 2px solid var(--color-primary); outline-offset: -2px; }
.qb-header { display: flex; align-items: center; gap: 6px; cursor: pointer; user-select: none; }
.qb-header:hover { color: var(--color-primary); }
.qb-caret { display: flex; color: var(--text-muted); transition: transform var(--transition-fast); }
.qb-caret .icon.rotated { transform: rotate(-90deg); }
.qb-meta { margin-left: auto; font-weight: 400; font-size: var(--fs-xs); color: var(--text-muted); }
.qb-more {
  width: 100%;
  padding: 8px;
  font-size: var(--fs-xs);
  color: var(--color-primary);
  border-radius: var(--radius-sm);
  margin-top: 2px;
}
.qb-more:hover { background: var(--color-primary-light); }
.qb-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px;
  border-radius: var(--radius-sm);
  cursor: pointer;
  margin-bottom: 3px;
  border: 1px solid transparent;
  transition: border-color var(--transition-fast), background var(--transition-fast);
  min-height: 28px;
}
.qb-item:hover { border-color: var(--color-primary); background: var(--surface-hover); }
.qb-item.correct { background: var(--color-success-light); border-color: var(--color-success-light); }
.qb-item.wrong { background: var(--color-danger-light); border-color: var(--color-danger-light); }
.qb-text { flex: 1; min-width: 0; }
.qb-q { font-size: var(--fs-sm); line-height: 1.45; display: flex; align-items: center; gap: 6px; }
.qb-icon { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; background: var(--text-faint); display: inline-block; }
.qb-icon.ok { background: var(--color-success); }
.qb-icon.bad { background: var(--color-danger); }
.qb-icon.pending { background: var(--text-faint); }
.qb-detail { font-size: var(--fs-xs); color: var(--text-muted); margin-top: 1px; }
.qb-empty { color: var(--text-muted); font-size: var(--fs-sm); padding: var(--space-md); text-align: center; }

.ce-hint { color: var(--text-secondary); font-size: var(--fs-sm); margin-bottom: var(--space-sm); }
.ce-chapters { display: flex; flex-wrap: wrap; gap: var(--space-sm); margin-bottom: var(--space-sm); }
.ce-ch { display: flex; align-items: center; gap: 6px; padding: 8px 12px; background: var(--surface-hover); border-radius: var(--radius-md); cursor: pointer; font-size: var(--fs-sm); }
.ce-ch input { accent-color: var(--color-primary); }
.ce-ch-count { color: var(--text-muted); font-size: var(--fs-xs); }
.ce-total { font-size: var(--fs-xs); color: var(--text-muted); margin-top: 4px; }
.ce-empty { color: var(--text-muted); font-size: var(--fs-sm); text-align: center; padding: var(--space-sm); }
.cum-track { position: relative; height: 44px; margin: 8px 0; }
.cum-seg { position: absolute; top: 19px; height: 6px; }
.cum-track input[type="range"] { position: absolute; left: 0; top: 0; width: 100%; height: 44px; -webkit-appearance: none; background: transparent; pointer-events: none; }
.cum-track input[type="range"]::-webkit-slider-thumb { -webkit-appearance: none; width: 18px; height: 18px; border-radius: 50%; background: #fff; border: 2px solid var(--color-primary); pointer-events: auto; box-shadow: var(--shadow-sm); }
.cum-labels { display: flex; flex-direction: column; gap: 6px; margin-top: var(--space-sm); }
.cum-row { display: flex; align-items: center; gap: 8px; font-size: var(--fs-sm); }
.cum-dot { width: 10px; height: 10px; border-radius: 3px; flex-shrink: 0; }
.cum-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cum-input { width: 52px; padding: 4px 6px; border: 1px solid var(--border-light); border-radius: var(--radius-sm); text-align: center; }
.pct-input { width: 48px; padding: 3px 6px; border: 1px solid var(--border-light); border-radius: var(--radius-sm); text-align: center; font-size: var(--fs-sm); }
.strategy-labels { display: flex; justify-content: space-between; flex-wrap: wrap; gap: 6px; margin-bottom: 6px; font-size: var(--fs-sm); color: var(--text-secondary); }
.strategy-labels span { display: inline-flex; align-items: center; gap: 4px; }
.pct-dot { width: 8px; height: 8px; border-radius: 50%; display: inline-block; flex-shrink: 0; }
.pct-dot.err { background: #EF4444; }
.pct-dot.review { background: #F59E0B; }
.dual-range-wrap { position: relative; height: 44px; margin: 4px 0; touch-action: none; }
.dual-track-bg { position: absolute; left: 0; right: 0; top: 19px; height: 6px; border-radius: 3px; background: var(--border-light); }
.dual-track-fill { position: absolute; top: 19px; height: 6px; }
.dual-track-fill.err { background: #EF4444; border-radius: 3px 0 0 3px; }
.dual-track-fill.review { background: #F59E0B; border-radius: 0 3px 3px 0; }
.dual-range-wrap input[type="range"] { position: absolute; left: 0; top: 0; width: 100%; height: 44px; -webkit-appearance: none; background: transparent; pointer-events: none; }
.dual-range-wrap input[type="range"]::-webkit-slider-thumb { -webkit-appearance: none; width: 18px; height: 18px; border-radius: 50%; background: #fff; border: 2px solid var(--color-primary); pointer-events: auto; }
.ce-actions { margin-top: var(--space-lg); }
.exam-item { display: flex; align-items: center; gap: var(--space-sm); padding: var(--space-sm) var(--space-md); border: 1px solid var(--border-light); border-radius: var(--radius-md); margin-bottom: 6px; cursor: pointer; transition: border-color var(--transition-fast); }
.exam-item:hover { border-color: var(--color-primary); }
.exam-icon { flex-shrink: 0; color: var(--text-muted); display: flex; align-items: center; }
.exam-main { flex: 1; min-width: 0; }
.exam-name { font-size: var(--fs-sm); font-weight: 500; }
.exam-meta { font-size: var(--fs-xs); color: var(--text-muted); }
.qb-round { border-bottom: 1px solid var(--border-light); padding: 2px 0; }
.qb-round:last-child { border-bottom: none; }
.qb-round-head { display: flex; align-items: center; gap: 6px; padding: 8px 10px; cursor: pointer; user-select: none; border-radius: var(--radius-sm); }
.qb-round-head:hover { background: var(--surface-hover); }
.qb-round-title { font-size: var(--fs-sm); font-weight: 500; color: var(--text-secondary); }
.type-counts { display: flex; flex-wrap: wrap; gap: var(--space-sm); margin-bottom: var(--space-sm); }
.type-count-item { display: flex; flex-direction: column; gap: 4px; padding: 8px 12px; background: var(--surface-hover); border-radius: var(--radius-md); }
.type-count-item label { font-size: var(--fs-sm); color: var(--text-secondary); }
.num-picker { display: flex; align-items: center; gap: 2px; }
.num-btn { width: 30px; height: 32px; border-radius: var(--radius-sm); background: var(--surface-card); border: 1px solid var(--border-light); color: var(--text-secondary); font-size: var(--fs-md); display: flex; align-items: center; justify-content: center; }
.num-btn:hover { border-color: var(--color-primary); color: var(--color-primary); }
.num-input { width: 52px; height: 32px; text-align: center; border: 1px solid var(--border-light); border-radius: var(--radius-sm); background: var(--surface-card); font-size: var(--fs-base); }
.num-input:focus { border-color: var(--color-primary); box-shadow: var(--shadow-glow); outline: none; }
.qdetail { margin-bottom: var(--space-md); }
.qd-title { margin-bottom: var(--space-sm); }
.qd-q { line-height: 1.7; margin-bottom: var(--space-sm); }
.qd-options { display: flex; flex-direction: column; gap: 4px; margin-bottom: var(--space-sm); }
.qd-opt { padding: 8px 12px; background: var(--surface-hover); border-radius: var(--radius-md); font-size: var(--fs-sm); }
.qd-opt.ok { background: var(--color-success-light); color: var(--color-success); }
.qd-ans { font-size: var(--fs-sm); margin-bottom: var(--space-sm); }
.qd-ans.ok { color: var(--color-success); }
.qd-ans.bad { color: var(--color-danger); }
.qd-exp { background: var(--color-warning-light); border-radius: var(--radius-md); padding: var(--space-sm) var(--space-md); font-size: var(--fs-sm); line-height: 1.7; }
.qd-exp h4 { margin: 0 0 4px; }
@media (max-width: 768px) {
  .sd-grid { grid-template-columns: repeat(2, 1fr); }
  /* v3.36：双滑杆与章节占比滑块拇指加大（28px 触控，对齐出题策略卡） */
  .dual-range-wrap input[type="range"]::-webkit-slider-thumb,
  .cum-track input[type="range"]::-webkit-slider-thumb { width: 28px; height: 28px; }
  .cum-track input[type="range"] { touch-action: none; }
  /* 题库工具栏：搜索独占一行 */
  .qbank-toolbar { align-items: stretch; }
  .qb-search { flex: 1 1 100%; max-width: none; order: -1; }
  .qb-tool-actions { margin-left: 0; }
  /* 科目总览标签页横滑 */
  .sd-tabs { overflow-x: auto; }
  .sd-tabs .tab { flex-shrink: 0; }
}
.qb-tool-actions { display: flex; gap: var(--space-sm); margin-left: auto; }
.markdown-body { word-break: break-word; }
.qb-sel-count { font-size: var(--fs-xs); color: var(--color-primary); }
.qb-sel-box { display: inline-flex; align-items: center; justify-content: center; width: 20px; height: 20px; border: 1px solid var(--border-default); border-radius: 4px; color: var(--text-muted); flex-shrink: 0; }
.qb-sel-box.on { background: var(--color-primary); border-color: var(--color-primary); color: #fff; }
</style>