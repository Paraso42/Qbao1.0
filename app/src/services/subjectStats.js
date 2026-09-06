// ============================================================
// subjectStats.js — 科目总览统计（v3.37 口径统一工程化）
// 权威源：科目当前章节轮次（ch.quizSets）+ 轮次内逐题答案，与题库 tab
// 题量（chapterQuestionTotal）/ 侧栏 X/Y 同源同数；科目级数字全部 = Σ章节。
// history 仅用于时间维度派生（趋势/近7天/连续学习/较上轮 delta/薄弱标签 除外），
// 绝不参与任何合计数字 —— 消除旧看板“多源对不上账”的自相矛盾。
// ============================================================
import { isObjType, getCi } from './utils'
import { chapterQuestionTotal } from './chapterStats'

export const ACCURACY_TARGET = 75 // 客观准确率目标线（趋势参考线 / KPI 洞察）

// —— 单章统计：轮次权威；无轮次旧章节回退题库数组 ——
export function buildChapterStats(ch) {
  const out = {
    totalQ: 0, objTotal: 0, subjTotal: 0,
    answered: 0, answeredObj: 0, correct: 0, wrong: 0,
    skipped: 0, unanswered: 0, subjAnswered: 0, subjSkipped: 0, subjUnanswered: 0,
    rate: null, started: false,
    roundsTotal: 0, roundsDone: 0, roundsPending: 0, hasPendingRound: false
  }
  if (!ch) return out
  out.totalQ = chapterQuestionTotal(ch)
  const sets = Array.isArray(ch.quizSets) && ch.quizSets.length > 0 ? ch.quizSets : null
  if (sets) {
    sets.forEach((set) => {
      if (!set || !Array.isArray(set.questions) || set.questions.length === 0) return
      out.roundsTotal++
      let anyUnanswered = false
      set.questions.forEach((q, i) => {
        const ans = set.userAnswers && set.userAnswers[i]
        countOne(out, q, ans)
        if (ans === undefined || ans === null) anyUnanswered = true
      })
      if (anyUnanswered) out.roundsPending++
      else out.roundsDone++
    })
    out.hasPendingRound = out.roundsPending > 0
  } else if (Array.isArray(ch.questions)) {
    ch.questions.forEach((q, i) => {
      countOne(out, q, ch.userAnswers && ch.userAnswers[i])
    })
    // 与题库 tab「导入题」轮次展示一致：无轮次旧章节视为单独一轮
    if (out.totalQ > 0) out.roundsTotal = out.roundsDone = 1
  }
  finalizeRate(out)
  out.started = out.answered > 0 || out.roundsDone > 0
  return out
}

function countOne(out, q, ans) {
  const real = ans !== undefined && ans !== null && ans !== -1
  if (isObjType(q && q.type)) {
    out.objTotal++
    if (real) {
      out.answered++
      out.answeredObj++
      if (getCi(q, ans) === true) out.correct++
      else out.wrong++
    } else if (ans === -1) out.skipped++
    else out.unanswered++
  } else {
    out.subjTotal++
    if (real) { out.answered++; out.subjAnswered++ }
    else if (ans === -1) out.subjSkipped++
    else out.subjUnanswered++
  }
}

function finalizeRate(out) {
  out.rate = out.answeredObj > 0 ? Math.round((out.correct / out.answeredObj) * 100) : null
}

// —— 科目聚合：科目级数字 = Σ章节（恒等式由测试锁定） ——
export function buildSubjectOverview(state, subj) {
  const out = {
    chapterCount: 0, chapters: [],
    totalQ: 0, objTotal: 0, subjTotal: 0,
    answered: 0, answeredObj: 0, correct: 0, wrong: 0,
    skipped: 0, unanswered: 0, subjAnswered: 0, subjSkipped: 0, subjUnanswered: 0,
    rate: null,
    roundsTotal: 0, roundsDone: 0, roundsPending: 0, hasPendingRound: false,
    startedChapters: 0
  }
  if (!state || !subj || !Array.isArray(subj.chapterIds)) return out
  ;(subj.chapterIds || []).forEach((cid) => {
    const ch = state.chapters && state.chapters[cid]
    if (!ch) return // 合并/删除残留：计 0 且不展示
    const st = buildChapterStats(ch)
    out.chapters.push({ cid, name: ch.name || cid, ...st })
    out.chapterCount++
    out.totalQ += st.totalQ
    out.objTotal += st.objTotal
    out.subjTotal += st.subjTotal
    out.answered += st.answered
    out.answeredObj += st.answeredObj
    out.correct += st.correct
    out.wrong += st.wrong
    out.skipped += st.skipped
    out.unanswered += st.unanswered
    out.subjAnswered += st.subjAnswered
    out.subjSkipped += st.subjSkipped
    out.subjUnanswered += st.subjUnanswered
    out.roundsTotal += st.roundsTotal
    out.roundsDone += st.roundsDone
    out.roundsPending += st.roundsPending
    if (st.started) out.startedChapters++
  })
  out.hasPendingRound = out.roundsPending > 0
  finalizeRate(out)
  return out
}

// —— history 记录时间戳：记录 id = 创建时 Date.now().toString(36) ——
export function recordTs(rec) {
  if (!rec || !rec.id) return NaN
  const id = String(rec.id)
  if (!/^[0-9a-z]+$/i.test(id)) return NaN
  const n = parseInt(id, 36)
  return Number.isFinite(n) && n > 0 ? n : NaN
}

export function isSubjectRecord(rec, chapterIds) {
  if (!rec || !rec.questions || !Array.isArray(rec.questions)) return false
  return Array.isArray(chapterIds) && chapterIds.indexOf(rec.chapterId) >= 0
}

// 客观题实答准确率（排除 -1 跳过；跳过/未答不参与）
export function recordObjRate(rec) {
  const qs = (rec && rec.questions) || []
  let correct = 0, tot = 0
  qs.forEach((q) => {
    if (!q || !isObjType(q.type)) return
    const ua = q.userAnswer
    if (ua === undefined || ua === null || ua === -1) return
    tot++
    if (q.isCorrect === true) correct++
  })
  return tot > 0 ? Math.round((correct / tot) * 100) : null
}

export function hasObjQuestion(rec) {
  return !!((rec && rec.questions) || []).some((q) => q && isObjType(q.type))
}

// 最近 N 轮客观作答记录（时间正序；无客观题记录不参与，修旧看板 rate||0 拖点）
export function recentRounds(state, subj, max = 8) {
  if (!state || !subj) return []
  const recs = (state.history || []).filter((r) => isSubjectRecord(r, subj.chapterIds) && hasObjQuestion(r)).slice(-max)
  return recs.map((r) => ({ date: r.date, ts: recordTs(r), rate: recordObjRate(r) }))
}

// 较上一轮客观准确率差（pp）；不足两条客观记录 → null
export function lastRoundDelta(state, subj) {
  if (!state || !subj) return null
  const recs = (state.history || []).filter((r) => isSubjectRecord(r, subj.chapterIds) && hasObjQuestion(r))
  if (recs.length < 2) return null
  const a = recordObjRate(recs[recs.length - 1])
  const b = recordObjRate(recs[recs.length - 2])
  if (a === null || b === null) return null
  return a - b
}

// 最后一条本科目作答记录（Z1 连续学习副行）
export function lastRecord(state, subj) {
  if (!state || !subj) return null
  const recs = (state.history || []).filter((r) => isSubjectRecord(r, subj.chapterIds))
  if (recs.length === 0) return null
  const r = recs[recs.length - 1]
  return { date: r.date, ts: recordTs(r), rate: recordObjRate(r) }
}

function dayStartOf(ts) {
  const d = new Date(ts)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

const DAY_MS = 86400000
function todayStart() { return dayStartOf(Date.now()) }

// 近 N 天每日作答轮次数（今天在末尾）
export function lastNDays(state, subj, days = 7) {
  const out = new Array(days).fill(0)
  if (!state || !subj) return out
  const ts0 = todayStart()
  ;(state.history || []).forEach((r) => {
    if (!isSubjectRecord(r, subj.chapterIds)) return
    const ts = recordTs(r)
    if (!Number.isFinite(ts)) return
    const diff = Math.floor((ts0 - dayStartOf(ts)) / DAY_MS)
    if (diff >= 0 && diff < days) out[days - 1 - diff]++
  })
  return out
}

// 近 7 天 vs 前 7 天作答轮次数差（本周趋势 delta）
export function weekDelta(state, subj) {
  const bucket = lastNDays(state, subj, 14)
  const last = bucket.slice(7).reduce((a, b) => a + b, 0)
  const prev = bucket.slice(0, 7).reduce((a, b) => a + b, 0)
  return last - prev
}

// 连续学习天数：从今天或昨天起向过去数连续有作答的天
export function studyStreak(state, subj) {
  if (!state || !subj) return 0
  const days = new Set()
  ;(state.history || []).forEach((r) => {
    if (!isSubjectRecord(r, subj.chapterIds)) return
    const ts = recordTs(r)
    if (!Number.isFinite(ts)) return
    days.add(dayStartOf(ts))
  })
  if (days.size === 0) return 0
  const t0 = todayStart()
  let cursor = days.has(t0) ? t0 : (days.has(t0 - DAY_MS) ? t0 - DAY_MS : null)
  if (cursor === null) return 0
  let n = 0
  while (days.has(cursor)) { n++; cursor -= DAY_MS }
  return n
}

// 薄弱标签：跨本科目各章 strategy.tagMeta 聚合，按准确率升序取 limit 个
// （tagMeta.totalQ 为该标签作答次数、correct 为答对数；仅 totalQ>=minTotal 入选）
export function weakTags(state, subj, limit = 3, minTotal = 3) {
  const out = []
  if (!state || !subj) return out
  ;(subj.chapterIds || []).forEach((cid) => {
    const ch = state.chapters && state.chapters[cid]
    if (!ch || !ch.strategy) return
    const meta = ch.strategy.tagMeta || {}
    Object.keys(meta).forEach((tag) => {
      const m = meta[tag]
      if (!m || typeof m.totalQ !== 'number' || m.totalQ < minTotal) return
      const total = m.totalQ
      const correct = Math.max(0, Math.min(total, typeof m.correct === 'number' ? m.correct : 0))
      out.push({ tag, chapterId: cid, chapterName: ch.name || cid, total, correct, rate: Math.round((correct / total) * 100) })
    })
  })
  out.sort((a, b) => a.rate - b.rate || b.total - a.total)
  return out.slice(0, limit)
}

// 趋势斜率（每轮平均变化 pp；linear regression over index）；<2 点 → null
export function trendSlope(points) {
  if (!points || points.length < 2) return null
  const n = points.length
  const rates = points.map((p) => (p && typeof p.rate === 'number' ? p.rate : 0))
  let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0
  for (let i = 0; i < n; i++) { sumX += i; sumY += rates[i]; sumXY += i * rates[i]; sumXX += i * i }
  const slope = (n * sumXY - sumX * sumY) / ((n * sumXX - sumX * sumX) || 1)
  return Math.round(slope * 10) / 10
}

// 趋势一句话洞察
export function trendInsight(points) {
  const slope = trendSlope(points)
  if (slope === null) return ''
  if (slope > 2) return '近 ' + points.length + ' 轮稳中有升（每轮平均 +' + slope.toFixed(1) + 'pp）'
  if (slope < -2) return '近 ' + points.length + ' 轮有所下降（每轮平均 ' + slope.toFixed(1) + 'pp）'
  return '近 ' + points.length + ' 轮保持稳定（每轮变化 ' + (slope >= 0 ? '+' : '') + slope.toFixed(1) + 'pp）'
}

export default {
  buildChapterStats, buildSubjectOverview,
  recordTs, isSubjectRecord, recordObjRate, hasObjQuestion,
  recentRounds, lastRoundDelta, lastRecord, lastNDays, weekDelta, studyStreak,
  weakTags, trendSlope, trendInsight, ACCURACY_TARGET
}
