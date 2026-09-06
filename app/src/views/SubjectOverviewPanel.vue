<!-- 科目总览看板（v3.37 重构：专业信息架构 + 统计口径统一）
   权威源 = 章节轮次（quizSets），科目级数字 = Σ章节，与题库/侧栏同数；
   history 仅用于时间维度派生（趋势/近7天/连续/较上轮）-->
<template>
  <div class="sd-content">
    <!-- Z0 小节头 -->
    <div class="ov-head">
      <div>
        <h2 class="ov-title">科目总览</h2>
        <p class="ov-meta">统计基于当前章节轮次，与题库/侧栏同口径 · 最近作答 {{ lastDateText }}</p>
      </div>
      <button class="btn btn-secondary btn-small" @click="ui.showScreen('history')"><Icon name="clock" :size="13" /> 答题历史</button>
    </div>

    <!-- Z1 核心指标 4 卡（指标 + 对比/趋势 + 行动） -->
    <div class="ov-kpis">
      <div v-for="k in kpis" :key="k.key" class="kpi" :class="'tone-' + k.tone" :style="{ '--stagger': k.idx }">
        <span class="kpi-hair"></span>
        <div class="kpi-top">
          <span class="kpi-icon"><Icon :name="k.icon" :size="16" /></span>
          <span v-if="k.delta" class="kpi-delta" :class="k.deltaClass">{{ k.delta }}</span>
        </div>
        <div class="kpi-num">{{ k.value }}<span v-if="k.unit" class="kpi-unit">{{ k.unit }}</span></div>
        <div class="kpi-label">{{ k.label }}</div>
        <div class="kpi-sub">{{ k.sub }}</div>
        <div v-if="k.badge" class="kpi-badge"><i class="pl-dot"></i>{{ k.badge }}</div>
        <div v-if="k.bars" class="kpi-bars" :class="{ empty: !k.barsActive }"><i v-for="(b, bi) in k.bars" :key="bi" :style="{ height: b + '%' }" :title="'近 7 天第 ' + (bi + 1) + ' 天'"></i></div>
        <button v-if="k.action" class="kpi-action" @click="k.action.handler"><Icon :name="k.action.icon" :size="12" /> {{ k.action.label }}</button>
      </div>
    </div>

    <!-- Z2 掌握度环形图 -->
    <section class="ov-card ov-mastery">
      <div class="ov-card-head">
        <h3>当前掌握度</h3>
        <span class="ov-bubble" title="同一题在多个轮次出现按多次计，与题库题量同口径">按轮次累计</span>
        <span class="ov-head-meta">共 {{ ov.totalQ }} 题 · {{ ov.roundsTotal }} 轮</span>
      </div>
      <div class="ov-mastery-body">
        <DonutChart :segments="ringSegments" :size="ringSize">
          <template #default>
            <span class="ring-rate" :class="{ na: ov.rate === null }">{{ rateNum }}<span v-if="ov.rate !== null" class="ring-pct">%</span></span>
            <span class="ring-cap">客观题准确率</span>
            <span class="ring-sub">已答 {{ ov.answeredObj }} / {{ ov.objTotal }}</span>
          </template>
        </DonutChart>
        <div class="ov-legend">
          <div v-for="lg in legend" :key="lg.key" class="lg-row">
            <span class="lg-dot" :style="{ background: lg.color }"></span>
            <span class="lg-name">{{ lg.name }}</span>
            <span class="lg-count tabular-nums">{{ lg.count }}</span>
          </div>
          <div v-if="ov.answeredObj > 0 && ov.answeredObj < ov.objTotal" class="lg-subj">
            <span>客观题进度 已答 {{ ov.answeredObj }} / {{ ov.objTotal }}（未答/跳过不计准确率）</span>
            <span class="lg-subj-bar lg-cover"><i :style="{ width: objCoverPct + '%' }"></i></span>
          </div>
          <div v-if="ov.answeredObj === 0 && ov.objTotal > 0" class="lg-subj">
            <span>客观题 {{ ov.objTotal }} 道，尚未作答</span>
            <span class="lg-subj-bar lg-cover"><i :style="{ width: '0%' }"></i></span>
          </div>
          <div v-if="ov.subjTotal > 0" class="lg-subj">
            <span>主观题 已答 {{ ov.subjAnswered }} / 共 {{ ov.subjTotal }}</span>
            <span class="lg-subj-bar"><i :style="{ width: subjPct + '%' }"></i></span>
          </div>
        </div>
      </div>
      <div v-if="best" class="ov-insight">
        <span class="ov-insight-chip best"><Icon name="trophy" :size="12" /> 最佳章节 {{ best.name }} {{ best.rate }}%</span>
        <span v-if="worst" class="ov-insight-chip warn"><Icon name="arrow-up" :size="12" /> 待提升 {{ worst.name }} {{ worst.rate }}%</span>
      </div>
      <p v-else-if="ov.chapterCount === 0" class="ov-guide">该科目还没有章节，请先回到主页创建章节</p>
      <p v-else-if="ov.answeredObj === 0" class="ov-guide">尚未作答，完成一轮答题后展示掌握度分析</p>
      <p v-if="masteryNote" class="ov-foot">{{ masteryNote }}</p>
    </section>

    <!-- Z3 章节掌握度明细（drill-down → 题库 tab） -->
    <section class="ov-card ov-chapters">
      <div class="ov-card-head">
        <h3>章节掌握度</h3>
        <div class="ov-mlg" title="分段条图例">
          <span><i class="mlg-dot ok"></i>对</span>
          <span><i class="mlg-dot bad"></i>错</span>
          <span><i class="mlg-dot skip"></i>跳过</span>
        </div>
        <span class="ov-head-meta">共 {{ ov.chapterCount }} 章 · 已开始 {{ ov.startedChapters }}</span>
      </div>
      <p v-if="ov.chapters.length === 0" class="ov-guide">暂无章节数据</p>
      <div v-else>
        <div
          v-for="(ch, i) in ov.chapters"
          :key="ch.cid"
          class="ov-ch-row"
          :class="{ idle: !ch.started && !ch.hasPendingRound }"
          :style="{ animationDelay: Math.min(i, 12) * 40 + 'ms' }"
          @click="$emit('open-bank', ch.cid)"
        >
          <span class="ch-avatar" :style="{ background: avatarGrad(i) }">{{ (ch.name || '?').charAt(0) }}</span>
          <div class="ch-main">
            <div class="ch-name">
              {{ ch.name }}
              <span v-if="ch.hasPendingRound" class="pill pending"><i class="pl-dot"></i>进行中</span>
              <span v-if="best && ch.cid === best.cid" class="pill best"><Icon name="trophy" :size="10" /> 最佳</span>
              <span v-if="worst && ch.cid === worst.cid" class="pill warn"><Icon name="arrow-up" :size="10" /> 待提升</span>
            </div>
            <div class="ch-meta">{{ ch.totalQ }} 题 · {{ ch.roundsTotal }} 轮</div>
          </div>
          <div class="ch-bar" :class="{ noobj: ch.objTotal === 0 }" :title="barTitle(ch)">
            <i class="seg ok" :style="{ width: pct(ch.correct, ch.objTotal) }"></i>
            <i class="seg bad" :style="{ width: pct(ch.wrong, ch.objTotal) }"></i>
            <i class="seg skip" :style="{ width: pct(ch.skipped, ch.objTotal) }"></i>
          </div>
          <div class="ch-right">
            <template v-if="ch.started || ch.hasPendingRound">
              <span class="ch-rate" :class="rateClass(ch.rate)">{{ ch.rate === null ? '—' : ch.rate + '%' }}</span>
              <span class="ch-cw">对 {{ ch.correct }} · 错 {{ ch.wrong }}</span>
            </template>
            <span v-else class="ch-idle-text">未开始</span>
          </div>
          <Icon name="chevron-right" :size="14" class="ch-go" />
        </div>
      </div>
      <p class="ov-foot">题量含多轮重复出现的题目，按轮次累计；正确率为客观题实答准确率</p>
    </section>

    <!-- Z4 薄弱标签 + 趋势 -->
    <div class="ov-cols">
      <section class="ov-card ov-weak">
        <div class="ov-card-head">
          <h3>薄弱标签</h3>
          <span class="ov-head-meta">按作答次数 ≥ 3 统计</span>
        </div>
        <div v-if="weak.length" class="ov-weak-list">
          <div v-for="w in weak" :key="w.tag" class="weak-row">
            <span class="weak-dot" :class="rateClass(w.rate)"></span>
            <span class="weak-tag">{{ w.tag }}</span>
            <span class="weak-ch">{{ w.chapterName }}</span>
            <span class="weak-meta">{{ w.rate }}%<span class="weak-count">对 {{ w.correct }}/{{ w.total }}</span></span>
          </div>
        </div>
        <p v-else class="ov-guide">AI 出题会自动打标签，完成几轮后这里会生成薄弱标签分析</p>
        <button class="btn btn-ghost btn-small ov-go" @click="ui.showScreen('start')"><Icon name="books" :size="12" /> 去复习</button>
      </section>

      <section v-if="trend.length >= 2" class="ov-card ov-trend">
        <div class="ov-card-head">
          <h3>各轮准确率</h3>
          <span class="ov-head-meta">最近 {{ trend.length }} 轮作答记录</span>
        </div>
        <div class="ov-trend-body">
          <TrendChart :points="trendPoints" :target="target" :height="116" />
        </div>
        <p class="ov-insight-line">{{ trendText }}</p>
      </section>
    </div>
  </div>
</template>

<script setup>
import { computed, ref } from 'vue'
import { useDataStore } from '../stores/data'
import { useUiStore } from '../stores/ui'
import {
  buildSubjectOverview, recentRounds, lastRoundDelta, lastRecord,
  lastNDays, weekDelta, studyStreak, weakTags, trendInsight, ACCURACY_TARGET
} from '../services/subjectStats'
import DonutChart from '../components/charts/DonutChart.vue'
import TrendChart from '../components/charts/TrendChart.vue'
import Icon from '../components/ui/Icon.vue'

const data = useDataStore()
const ui = useUiStore()
defineEmits(['open-bank'])

const subj = computed(() => data.getSubj())
const ov = computed(() => buildSubjectOverview(data.state, subj.value))
const trend = computed(() => recentRounds(data.state, subj.value, 8))
const delta = computed(() => lastRoundDelta(data.state, subj.value))
const weekD = computed(() => weekDelta(data.state, subj.value))
const days7 = computed(() => lastNDays(data.state, subj.value, 7))
const streak = computed(() => studyStreak(data.state, subj.value))
const lr = computed(() => lastRecord(data.state, subj.value))
const weak = computed(() => weakTags(data.state, subj.value, 3, 3))
const target = ACCURACY_TARGET

function shortDate(d) { return String(d || '').split(' ')[0] || '—' }
const lastDateText = computed(() => (lr.value && lr.value.date ? shortDate(lr.value.date) : '暂无'))
const trendPoints = computed(() => trend.value.map((p) => ({ label: shortDate(p.date), rate: p.rate })))
const trendText = computed(() => trendInsight(trend.value))

function rateClass(rate) {
  if (rate === null || rate === undefined) return 'na'
  if (rate >= 70) return 'ok'
  if (rate >= 40) return 'warn'
  return 'bad'
}
const pct = (v, t) => (t > 0 ? Math.round((v / t) * 100) + '%' : '0%')

const rateNum = computed(() => (ov.value.rate === null ? '—' : String(ov.value.rate)))
const subjPct = computed(() => (ov.value.subjTotal > 0 ? Math.round((ov.value.subjAnswered / ov.value.subjTotal) * 100) : 0))

const ringSize = ref((typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(max-width: 480px)').matches) ? 150 : 184)
// 环形图 = 已答客观题构成：绿弧 = 答对份额，视觉上与中心准确率恒等
const ringSegments = computed(() => [
  { value: ov.value.correct, color: '#22C55E', gradient: ['#22C55E', '#4ADE80'], label: '答对 ' + ov.value.correct },
  { value: ov.value.wrong, color: '#EF4444', gradient: ['#EF4444', '#F87171'], label: '答错 ' + ov.value.wrong }
])

const legend = computed(() => {
  const mk = (key, name, color, count) => ({ key, name, color, count })
  return [
    mk('ok', '答对', '#22C55E', ov.value.correct),
    mk('bad', '答错', '#EF4444', ov.value.wrong),
    mk('skip', '跳过', '#ADB2B8', ov.value.skipped),
    mk('none', '未答', 'var(--ov-track)', ov.value.unanswered)
  ]
})
// 口径脚注：环形图按已答客观题构成；未答/跳过不计准确率
const masteryNote = computed(() => {
  if (ov.value.objTotal === 0 || ov.value.answeredObj === 0 || ov.value.answeredObj >= ov.value.objTotal) return ''
  return '准确率 = 答对 ÷ 已答客观题；环形图仅统计已答客观题，未答/跳过、主观题不计入。未答/跳过见图例与进度条'
})
const objCoverPct = computed(() => (ov.value.objTotal > 0 ? Math.round((ov.value.answeredObj / ov.value.objTotal) * 100) : 0))

const startedChs = computed(() => ov.value.chapters.filter((c) => c.started && c.rate !== null))
const best = computed(() => {
  const s = [...startedChs.value].sort((a, b) => b.rate - a.rate)
  return s[0] || null
})
const worst = computed(() => {
  const s = [...startedChs.value].sort((a, b) => b.rate - a.rate)
  return s.length >= 2 ? s[s.length - 1] : null
})

const AVATAR_GRADS = [
  'linear-gradient(135deg,#EF4444,#F87171)', 'linear-gradient(135deg,#F59E0B,#FBBF24)',
  'linear-gradient(135deg,#22C55E,#4ADE80)', 'linear-gradient(135deg,#4176E6,#679EFE)',
  'linear-gradient(135deg,#8B5CF6,#A78BFA)', 'linear-gradient(135deg,#EC4899,#F472B6)',
  'linear-gradient(135deg,#14B8A6,#2DD4BF)', 'linear-gradient(135deg,#F97316,#FB923C)',
  'linear-gradient(135deg,#6366F1,#818CF8)', 'linear-gradient(135deg,#84CC16,#A3E635)'
]
const avatarGrad = (i) => AVATAR_GRADS[i % AVATAR_GRADS.length]

function barTitle(ch) {
  const obj = '客观 ' + ch.answeredObj + '/' + ch.objTotal + '（对 ' + ch.correct + ' · 错 ' + ch.wrong + ' · 跳 ' + ch.skipped + ' · 未答 ' + ch.unanswered + '）'
  const sub = ch.subjTotal > 0 ? '｜主观 已答 ' + ch.subjAnswered + '/' + ch.subjTotal : ''
  return obj + sub + '（题量含多轮重复，共 ' + ch.totalQ + ' 题）'
}

const todayCount = computed(() => days7.value[days7.value.length - 1] || 0)

const kpis = computed(() => {
  const pend = ov.value.hasPendingRound
  const rate = ov.value.rate
  const goalGap = rate === null ? null : (rate >= target ? '已达目标 ' + target + '%' : '距目标 ' + target + '% 还差 ' + (target - rate) + 'pp')
  const deltaText = delta.value === null ? null : (delta.value > 0 ? '较上轮 +' + delta.value + 'pp' : (delta.value < 0 ? '较上轮 ' + delta.value + 'pp' : '较上轮持平'))
  const deltaClass = delta.value === null ? 'flat' : (delta.value > 0 ? 'up' : (delta.value < 0 ? 'down' : 'flat'))
  const sum7 = days7.value.reduce((a, b) => a + b, 0)
  const maxBar = Math.max(...days7.value, 1)
  const bars = days7.value.map((v) => (sum7 === 0 ? 0 : Math.max(6, Math.round((v / maxBar) * 100))))
  const wk = weekD.value
  return [
    { idx: 0, key: 'rate', tone: 'blue', icon: 'ach-target', label: '客观准确率',
      value: rateNum.value, unit: rate === null ? '' : '%',
      delta: deltaText, deltaClass,
      sub: '已答 ' + ov.value.answeredObj + ' / ' + ov.value.objTotal + ' 客观题' + (goalGap ? ' · ' + goalGap : ''),
      action: { label: '答题历史', icon: 'clock', handler: () => ui.showScreen('history') } },
    { idx: 1, key: 'answered', tone: 'purple', icon: 'books', label: '累计作答',
      value: ov.value.answered, unit: '',
      delta: wk > 0 ? '本周 +' + wk : (wk < 0 ? '本周 ' + wk : '本周持平'),
      deltaClass: wk > 0 ? 'up' : (wk < 0 ? 'down' : 'flat'),
      sub: '客观 ' + ov.value.answeredObj + ' · 主观 ' + ov.value.subjAnswered + (sum7 === 0 ? ' · 近 7 天无作答' : ''),
      bars, barsActive: sum7 > 0 },
    { idx: 2, key: 'rounds', tone: 'teal', icon: 'refresh', label: '已完成轮次',
      value: ov.value.roundsDone, unit: ' / ' + ov.value.roundsTotal,
      delta: null, deltaClass: 'flat',
      sub: pend ? '还有 ' + ov.value.roundsPending + ' 轮未完成' : '全部轮次已完成',
      badge: pend ? '进行中 ' + ov.value.roundsPending : '',
      action: pend ? { label: '继续答题', icon: 'check', handler: () => ui.showScreen('start') } : null },
    { idx: 3, key: 'streak', tone: 'green', icon: 'ach-flame', label: '连续学习',
      value: streak.value, unit: ' 天',
      delta: null, deltaClass: 'flat',
      badge: todayCount.value > 0 ? '今日已完成' : (streak.value > 0 ? '今日未作答' : '今日未开始'),
      sub: '最近作答 ' + lastDateText.value }
  ]
})
</script>

<style scoped>
.sd-content { animation: screenFadeIn 0.25s ease; --ov-track: #E7EAF0; --ov-grid: #E5E7EB; }
html.dark-mode .sd-content { --ov-track: #3A3A3C; --ov-grid: #333335; }
@keyframes screenFadeIn { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }
@keyframes kpiIn { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
@keyframes cardIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
@keyframes rowIn { from { opacity: 0; transform: translateX(-6px); } to { opacity: 1; transform: none; } }

/* Z0 */
.ov-head { display: flex; align-items: center; justify-content: space-between; gap: var(--space-sm); margin-bottom: var(--space-md); flex-wrap: wrap; }
.ov-title { margin: 0; font-size: 16px; font-weight: 700; }
.ov-meta { font-size: 11px; color: var(--text-muted); margin: 2px 0 0; }

/* Z1 KPI */
.ov-kpis { display: grid; grid-template-columns: repeat(4, 1fr); gap: var(--space-md); margin-bottom: var(--space-lg); }
.kpi {
  position: relative;
  background: var(--surface-card);
  border: 1px solid var(--border-light);
  border-radius: var(--radius-xl);
  padding: var(--space-lg) var(--space-lg) var(--space-md);
  box-shadow: var(--shadow-sm);
  overflow: hidden;
  display: flex;
  flex-direction: column;
  gap: 5px;
  transition: transform 0.2s ease, box-shadow 0.2s ease;
  animation: kpiIn 0.25s ease both;
  animation-delay: calc(var(--stagger) * 60ms);
}
.kpi:hover { transform: translateY(-2px); box-shadow: var(--shadow-md); }
.kpi-hair { position: absolute; top: 0; left: 0; right: 0; height: 3px; }
.tone-blue .kpi-hair { background: linear-gradient(90deg, #4176E6, #679EFE); }
.tone-purple .kpi-hair { background: linear-gradient(90deg, #8B5CF6, #A78BFA); }
.tone-teal .kpi-hair { background: linear-gradient(90deg, #14B8A6, #2DD4BF); }
.tone-green .kpi-hair { background: linear-gradient(90deg, #22C55E, #4ADE80); }
.kpi-top { display: flex; align-items: center; gap: var(--space-sm); }
.kpi-icon { display: inline-flex; align-items: center; justify-content: center; width: 34px; height: 34px; border-radius: 10px; color: #fff; flex-shrink: 0; }
.tone-blue .kpi-icon { background: linear-gradient(135deg, #4176E6, #679EFE); }
.tone-purple .kpi-icon { background: linear-gradient(135deg, #8B5CF6, #A78BFA); }
.tone-teal .kpi-icon { background: linear-gradient(135deg, #14B8A6, #2DD4BF); }
.tone-green .kpi-icon { background: linear-gradient(135deg, #22C55E, #4ADE80); }
.kpi-delta { margin-left: auto; font-size: 11px; font-weight: 600; padding: 2px 8px; border-radius: var(--radius-full); white-space: nowrap; }
.kpi-delta.up { color: var(--color-success); background: var(--color-success-light); }
.kpi-delta.down { color: var(--color-danger); background: var(--color-danger-light); }
.kpi-delta.flat { color: var(--text-muted); background: var(--surface-hover); }
.kpi-num { font-size: 26px; font-weight: 700; line-height: 1.15; font-variant-numeric: tabular-nums; }
.kpi-unit { font-size: 13px; font-weight: 500; color: var(--text-muted); margin-left: 2px; }
.kpi-label { font-size: 13px; font-weight: 600; color: var(--text-secondary); }
.kpi-sub { font-size: 11px; color: var(--text-muted); }
.kpi-badge { display: inline-flex; align-items: center; gap: 5px; font-size: 11px; font-weight: 600; padding: 2px 8px; border-radius: var(--radius-full); color: var(--color-warning); background: var(--color-warning-light); width: fit-content; }
.pl-dot { width: 5px; height: 5px; border-radius: 50%; background: currentColor; }
.kpi-bars { display: flex; align-items: flex-end; gap: 3px; height: 30px; margin-top: 2px; }
.kpi-bars i { flex: 1; min-height: 2px; max-height: 100%; border-radius: 2px 2px 0 0; background: linear-gradient(180deg, #A78BFA, #8B5CF6); opacity: 0.85; transition: height 0.3s ease; }
.kpi-bars.empty i { background: var(--border-default); opacity: 0.5; min-height: 2px; }
.kpi-action {
  align-self: flex-start;
  margin-top: 4px;
  font-size: 12px;
  font-weight: 600;
  color: var(--color-primary);
  background: var(--color-primary-light);
  border-radius: var(--radius-md);
  padding: 4px 10px;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  cursor: pointer;
  border: none;
  transition: filter 0.15s ease;
}
.kpi-action:hover { filter: brightness(0.96); }

/* 通用卡 */
.ov-card {
  background: var(--surface-card);
  border: 1px solid var(--border-light);
  border-radius: var(--radius-xl);
  padding: var(--space-xl);
  margin-bottom: var(--space-lg);
  box-shadow: var(--shadow-sm);
  animation: cardIn 0.25s ease both;
  animation-delay: 0.08s;
}
.ov-card-head { display: flex; align-items: center; gap: var(--space-sm); flex-wrap: wrap; margin-bottom: var(--space-md); }
.ov-card-head h3 { margin: 0; font-size: 15px; font-weight: 700; }
.ov-bubble { font-size: 10px; color: var(--text-muted); border: 1px solid var(--border-light); padding: 1px 8px; border-radius: var(--radius-full); background: var(--surface-panel); cursor: help; }
.ov-head-meta { margin-left: auto; font-size: 12px; color: var(--text-muted); }
.ov-mlg { display: inline-flex; gap: 10px; font-size: 11px; color: var(--text-muted); margin-left: var(--space-sm); cursor: help; }
.mlg-dot { width: 8px; height: 8px; border-radius: 50%; display: inline-block; margin-right: 4px; vertical-align: -1px; }
.mlg-dot.ok { background: #22C55E; }
.mlg-dot.bad { background: #EF4444; }
.mlg-dot.skip { background: #ADB2B8; }
.ov-guide { font-size: 12px; color: var(--text-muted); margin: var(--space-sm) 0 0; }
.ov-foot { font-size: 11px; color: var(--text-muted); margin: var(--space-sm) 0 0; }

/* Z2 环形图 */
.ov-mastery-body { display: flex; align-items: center; gap: var(--space-2xl); flex-wrap: wrap; }
.ring-rate { font-size: 30px; font-weight: 800; line-height: 1; font-variant-numeric: tabular-nums; }
.ring-rate.na { color: var(--text-faint); }
.ring-pct { font-size: 15px; font-weight: 600; color: var(--text-secondary); margin-left: 1px; }
.ring-cap { font-size: 10px; color: var(--text-muted); margin-top: 7px; }
.ring-sub { font-size: 11px; color: var(--text-secondary); margin-top: 2px; font-variant-numeric: tabular-nums; }
.ov-legend { flex: 1; min-width: 190px; display: flex; flex-direction: column; gap: 8px; }
.lg-row { display: flex; align-items: center; gap: 8px; font-size: 13px; }
.lg-dot { width: 10px; height: 10px; border-radius: 50%; flex-shrink: 0; }
.lg-name { color: var(--text-secondary); }
.lg-count { margin-left: auto; font-weight: 600; font-variant-numeric: tabular-nums; }
.lg-pct { width: 46px; text-align: right; color: var(--text-muted); font-size: 12px; font-variant-numeric: tabular-nums; }
.lg-subj { margin-top: 6px; display: flex; flex-direction: column; gap: 4px; font-size: 12px; color: var(--text-secondary); }
.lg-subj-bar { height: 6px; border-radius: var(--radius-full); background: var(--surface-hover); overflow: hidden; }
.lg-subj-bar i { display: block; height: 100%; border-radius: var(--radius-full); background: linear-gradient(90deg, #4176E6, #679EFE); }
.lg-subj-bar.lg-cover i { background: linear-gradient(90deg, #ADB2B8, #D1D5DB); }
.ov-insight { display: flex; gap: var(--space-sm); flex-wrap: wrap; margin-top: var(--space-md); }
.ov-insight-chip { display: inline-flex; align-items: center; gap: 5px; font-size: 12px; font-weight: 600; padding: 4px 10px; border-radius: var(--radius-full); }
.ov-insight-chip.best { color: var(--color-success); background: var(--color-success-light); }
.ov-insight-chip.warn { color: var(--color-warning); background: var(--color-warning-light); }

/* Z3 章节行 */
.ov-ch-row {
  display: flex;
  align-items: center;
  gap: var(--space-md);
  padding: 10px var(--space-md);
  border-radius: var(--radius-lg);
  background: var(--surface-panel);
  margin-bottom: 8px;
  cursor: pointer;
  transition: box-shadow 0.15s ease, transform 0.15s ease;
  animation: rowIn 0.25s ease both;
}
.ov-ch-row:hover { box-shadow: var(--shadow-sm); transform: translateY(-1px); }
.ov-ch-row.idle { opacity: 0.62; }
.ch-avatar {
  width: 34px; height: 34px; border-radius: 50%;
  color: #fff; font-size: 14px; font-weight: 700;
  display: inline-flex; align-items: center; justify-content: center;
  flex-shrink: 0;
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.25);
}
.ch-main { flex: 1; min-width: 110px; }
.ch-name { font-size: 13px; font-weight: 600; display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.ch-meta { font-size: 11px; color: var(--text-muted); margin-top: 2px; font-variant-numeric: tabular-nums; }
.pill { display: inline-flex; align-items: center; gap: 3px; font-size: 10px; font-weight: 600; padding: 1px 7px; border-radius: var(--radius-full); }
.pill.pending { color: var(--color-warning); background: var(--color-warning-light); }
.pill.best { color: var(--color-success); background: var(--color-success-light); }
.pill.warn { color: var(--color-warning); background: var(--color-warning-light); }
.ch-bar {
  flex: 0 1 170px;
  min-width: 84px;
  height: 10px;
  border-radius: var(--radius-full);
  background: var(--ov-track, #E7EAF0);
  display: flex;
  overflow: hidden;
  gap: 1px;
}
.seg { height: 100%; transition: width 0.4s cubic-bezier(0.22, 1, 0.36, 1); }
.ch-bar.noobj { background: var(--border-light); }
.seg.ok { background: linear-gradient(90deg, #22C55E, #4ADE80); }
.seg.bad { background: linear-gradient(90deg, #EF4444, #F87171); }
.seg.skip { background: linear-gradient(90deg, #ADB2B8, #D1D5DB); }
.ch-right { display: flex; flex-direction: column; align-items: flex-end; gap: 1px; flex-shrink: 0; }
.ch-rate { font-size: 15px; font-weight: 700; font-variant-numeric: tabular-nums; }
.ch-rate.ok { color: var(--color-success); }
.ch-rate.warn { color: var(--color-warning); }
.ch-rate.bad { color: var(--color-danger); }
.ch-rate.na { color: var(--text-muted); }
.ch-cw { font-size: 11px; color: var(--text-muted); font-variant-numeric: tabular-nums; }
.ch-idle-text { font-size: 12px; color: var(--text-muted); }
.ch-go { color: var(--text-faint); flex-shrink: 0; }

/* Z4 */
.ov-cols { display: grid; grid-template-columns: 1fr 1fr; gap: var(--space-lg); align-items: start; }
.ov-cols .ov-card { margin-bottom: 0; }
.ov-weak { display: flex; flex-direction: column; }
.ov-weak-list { display: flex; flex-direction: column; gap: 8px; }
.weak-row { display: flex; align-items: center; gap: 8px; font-size: 13px; padding: 8px var(--space-md); background: var(--surface-panel); border-radius: var(--radius-lg); }
.weak-dot { width: 9px; height: 9px; border-radius: 50%; flex-shrink: 0; }
.weak-dot.ok { background: var(--color-success); }
.weak-dot.warn { background: var(--color-warning); }
.weak-dot.bad { background: var(--color-danger); }
.weak-dot.na { background: var(--text-faint); }
.weak-tag { font-weight: 600; }
.weak-ch { font-size: 11px; color: var(--text-muted); flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.weak-meta { font-variant-numeric: tabular-nums; font-weight: 700; text-align: right; line-height: 1.3; }
.weak-count { display: block; font-size: 10px; font-weight: 400; color: var(--text-muted); }
.ov-go { align-self: flex-start; margin-top: var(--space-sm); }
.ov-trend-body { padding-bottom: 20px; }
.ov-insight-line { font-size: 12px; color: var(--text-secondary); margin-top: var(--space-sm); }

@media (max-width: 768px) {
  .ov-kpis { grid-template-columns: repeat(2, 1fr); }
  .ov-cols { grid-template-columns: 1fr; }
  .ov-head-meta { margin-left: 0; }
}
@media (max-width: 480px) {
  .ov-mastery-body { justify-content: center; }
  .ov-legend { min-width: 0; width: 100%; }
  .ch-avatar { width: 30px; height: 30px; font-size: 12px; }
  .ch-cw { display: none; }
  .ch-bar { flex-basis: 120px; }
  .kpi-num { font-size: 22px; }
}
@media (prefers-reduced-motion: reduce) {
  .kpi, .ov-card, .ov-ch-row { animation: none; }
  .seg { transition: none; }
}
</style>
