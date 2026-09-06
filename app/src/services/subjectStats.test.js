import { describe, it, expect } from 'vitest'
import {
  buildChapterStats, buildSubjectOverview,
  recordTs, isSubjectRecord, recordObjRate,
  recentRounds, lastRoundDelta, lastRecord, lastNDays, weekDelta, studyStreak,
  weakTags, trendSlope, trendInsight, ACCURACY_TARGET
} from './subjectStats'
import { subjectQuestionTotal } from './chapterStats'

// —— 夹具 ——
function q(question, type, answer, opts) {
  return { question, type, answer, options: opts || null }
}
function set(questions, userAnswers) {
  return { questions, userAnswers: userAnswers || new Array(questions.length).fill(undefined), currentIdx: 0, createdAt: 0 }
}
const dayMs = 86400000
function rec(id, chapterId, questions, extra) {
  return Object.assign({ id: id.toString(36), chapterId, date: 'x', questions: questions || [] }, extra || {})
}
const qA = q('单选A', 'single', 0, ['A', 'B'])
const qB = q('判断B', 'judge', 1, ['正确', '错误'])
const qS = q('名解S', 'term', 1, null)
const qC = q('单选C', 'single', 1, ['A', 'B'])
const qD = q('单选D', 'single', 0, ['A', 'B'])
const withAnswer = (qq, ua, ic) => ({ question: qq.question, type: qq.type, userAnswer: ua, isCorrect: ic })
const rA1 = () => [withAnswer(qA, 0, true), withAnswer(qB, 1, true)]
const rA2 = () => [withAnswer(qA, 0, true), withAnswer(qB, 0, false)]
const rSubj = () => [withAnswer(qS, 'text', true)]
const subj = { chapterIds: ['c1', 'c2'] }

describe('subjectStats 章节统计口径', () => {
  it('轮次权威：逐轮逐题累计，题量与 chapterQuestionTotal 同源', () => {
    const ch = {
      name: '第一章',
      quizSets: [
        set([qA, qB, qS], [0, 0, '我的答案']),
        set([qA, qC], [-1, 1])
      ]
    }
    const st = buildChapterStats(ch)
    expect(st.totalQ).toBe(5)
    expect(st.objTotal).toBe(4)
    expect(st.subjTotal).toBe(1)
    expect(st.answered).toBe(4)
    expect(st.answeredObj).toBe(3)
    expect(st.correct).toBe(2)
    expect(st.wrong).toBe(1)
    expect(st.skipped).toBe(1)
    expect(st.unanswered).toBe(0)
    expect(st.subjAnswered).toBe(1)
    expect(st.rate).toBe(67)
    expect(st.started).toBe(true)
    expect(st.roundsTotal).toBe(2)
    expect(st.roundsDone).toBe(2)
    expect(st.roundsPending).toBe(0)
    expect(st.hasPendingRound).toBe(false)
  })

  it('-1 跳过：不进对/错与 rate 分母，计入 skipped 且轮次视为完成', () => {
    const ch = { name: '全跳过', quizSets: [set([qA, qB], [-1, -1])] }
    const st = buildChapterStats(ch)
    expect(st.answeredObj).toBe(0)
    expect(st.correct).toBe(0)
    expect(st.wrong).toBe(0)
    expect(st.skipped).toBe(2)
    expect(st.rate).toBe(null)
    expect(st.roundsDone).toBe(1)
    expect(st.started).toBe(true)
  })

  it('无实答客观题 → rate=null（绝不 0%/100% 假值）', () => {
    const ch = { name: '纯主观', quizSets: [set([qS], ['答了'])] }
    const st = buildChapterStats(ch)
    expect(st.rate).toBe(null)
    expect(st.subjAnswered).toBe(1)
    expect(st.started).toBe(true)
  })

  it('尚未开始：全未被答 → started=false', () => {
    const ch = { name: '未开始', quizSets: [set([qA], [undefined])] }
    const st = buildChapterStats(ch)
    expect(st.started).toBe(false)
    expect(st.answered).toBe(0)
    expect(st.rate).toBe(null)
    expect(st.roundsPending).toBe(1)
    expect(st.roundsDone).toBe(0)
    expect(st.hasPendingRound).toBe(true)
  })

  it('进行中判定 = 存在 undefined/null 未作答（与 hasUnfinishedQuizSet 同规则）', () => {
    const ch = { quizSets: [set([qA, qB], [0, undefined]), set([qA], [1])] }
    const st = buildChapterStats(ch)
    expect(st.roundsTotal).toBe(2)
    expect(st.roundsDone).toBe(1)
    expect(st.roundsPending).toBe(1)
    expect(st.hasPendingRound).toBe(true)
  })

  it('无轮次旧章节回退 ch.questions + ch.userAnswers，视为 1 轮', () => {
    const ch = { name: '旧章节', questions: [qD, qS], userAnswers: [1, undefined] }
    const st = buildChapterStats(ch)
    expect(st.totalQ).toBe(2)
    expect(st.correct).toBe(0)
    expect(st.wrong).toBe(1)
    expect(st.answered).toBe(1)
    expect(st.rate).toBe(0)
    expect(st.roundsTotal).toBe(1)
    expect(st.roundsDone).toBe(1)
    expect(st.started).toBe(true)
  })

  it('主观未答/跳过不污染客观口径（unanswered/skipped 仅含客观题）', () => {
    const ch = { name: '混排', quizSets: [
      set([qA, qS], [undefined, undefined]),
      set([qS], [-1])
    ] }
    const st = buildChapterStats(ch)
    expect(st.objTotal).toBe(1)
    expect(st.subjTotal).toBe(2)
    expect(st.unanswered).toBe(1)   // 仅 qA 未答
    expect(st.subjUnanswered).toBe(1)
    expect(st.skipped).toBe(0)
    expect(st.subjSkipped).toBe(1)
    expect(st.answered).toBe(0)
  })

  it('客观闭环恒等式：objTotal = answeredObj + skipped + unanswered', () => {
    const ch = { quizSets: [
      set([qA, qB, qS], [0, undefined, 'x']),
      set([qA, qC], [-1, 1])
    ] }
    const st = buildChapterStats(ch)
    expect(st.objTotal).toBe(4)
    expect(st.answeredObj + st.skipped + st.unanswered).toBe(st.objTotal)
    expect(st.answered).toBe(3) // qA 对 + qC 对 + qS 主观
  })

  it('userAnswers 缺失/短数组不崩溃，按未答处理', () => {
    const st1 = buildChapterStats({ quizSets: [{ questions: [qA] }] })
    expect(st1.answered).toBe(0)
    expect(st1.unanswered).toBe(1)
    expect(st1.roundsPending).toBe(1)
    const st2 = buildChapterStats({ quizSets: [{ questions: [qA, qA], userAnswers: [0] }] })
    expect(st2.answered).toBe(1)
    expect(st2.unanswered).toBe(1)
  })

  it('null/空章节 → 全 0 rate null', () => {
    const st = buildChapterStats(null)
    expect(st.totalQ).toBe(0)
    expect(st.rate).toBe(null)
    expect(st.started).toBe(false)
    expect(buildChapterStats({})).toMatchObject({ totalQ: 0, rate: null })
  })
})

describe('subjectStats 科目聚合恒等式', () => {
  function makeState() {
    return {
      chapters: {
        c1: { name: '第一章', quizSets: [set([qA, qB, qS], [0, 0, 'x']), set([qA, qC], [-1, 1])] },
        c2: { name: '第二章', questions: [qD], userAnswers: [1] },
        ghost: null
      }
    }
  }
  const s = { chapterIds: ['c1', 'c2', 'ghost'] }

  it('科目题量 = Σ章节 = subjectQuestionTotal（与题库/侧栏同源）', () => {
    const st = makeState()
    const ov = buildSubjectOverview(st, s)
    expect(ov.totalQ).toBe(subjectQuestionTotal(st, s))
    expect(ov.totalQ).toBe(6) // c1 轮次求和 5 + c2 旧章节 1
    expect(ov.chapterCount).toBe(2)
    expect(ov.chapters.map((c) => c.cid)).toEqual(['c1', 'c2'])
  })

  it('科目客观口径闭环：objTotal = Σ(对错跳未答) = Σ章节', () => {
    const ov = buildSubjectOverview(makeState(), s)
    expect(ov.objTotal).toBe(5)
    expect(ov.answeredObj + ov.skipped + ov.unanswered).toBe(ov.objTotal)
    expect(ov.subjTotal).toBe(1)
    expect(ov.subjAnswered + ov.subjSkipped + ov.subjUnanswered).toBe(ov.subjTotal)
  })

  it('科目对/错/跳/未答/主观 = Σ各章（闭环）', () => {
    const ov = buildSubjectOverview(makeState(), s)
    expect(ov.objTotal).toBe(5)
    expect(ov.subjTotal).toBe(1)
    expect(ov.answered).toBe(5)
    expect(ov.answeredObj).toBe(4)
    expect(ov.correct).toBe(2)
    expect(ov.wrong).toBe(2)
    expect(ov.skipped).toBe(1)
    expect(ov.unanswered).toBe(0)
    expect(ov.subjAnswered).toBe(1)
    expect(ov.rate).toBe(50)
    expect(ov.roundsTotal).toBe(3)
    expect(ov.roundsDone).toBe(3)
    expect(ov.roundsPending).toBe(0)
    expect(ov.startedChapters).toBe(2)
  })

  it('null 守护：state/subj/无 chapterIds 均安全', () => {
    expect(buildSubjectOverview(null, s).totalQ).toBe(0)
    expect(buildSubjectOverview(makeState(), null).totalQ).toBe(0)
    expect(buildSubjectOverview(makeState(), { chapterIds: undefined }).totalQ).toBe(0)
  })
})

describe('subjectStats 时间维度派生', () => {
  it('recordTs：base36 id 解析，非法 id 返回 NaN', () => {
    const ts = 1700000000000
    expect(recordTs(rec(ts, 'c1', []))).toBe(ts)
    expect(Number.isNaN(recordTs({ id: 'abc-def' }))).toBe(true)
    expect(Number.isNaN(recordTs({ id: '' }))).toBe(true)
    expect(Number.isNaN(recordTs(null))).toBe(true)
  })

  it('isSubjectRecord：只认本科目章节且有 questions 的记录（排除大考卷）', () => {
    expect(isSubjectRecord({ chapterId: 'c1', questions: [] }, ['c1'])).toBe(true)
    expect(isSubjectRecord({ chapterId: 'exam_id', questions: [] }, ['c1', 'c2'])).toBe(false)
    expect(isSubjectRecord({ chapterId: 'c1' }, ['c1'])).toBe(false)
  })

  it('recordObjRate：仅客观实答参与，跳过/未答/主观排除', () => {
    expect(recordObjRate({ questions: rA1() })).toBe(100)
    expect(recordObjRate({ questions: rA2() })).toBe(50)
    expect(recordObjRate({ questions: [withAnswer(qA, -1, false), withAnswer(qB, 0, false)] })).toBe(0)
    expect(recordObjRate({ questions: rSubj() })).toBe(null)
  })

  it('lastRoundDelta：最后两条客观记录之差；不足两条 → null', () => {
    const state = { history: [
      rec(1, 'c1', rA1()),
      rec(2, 'c1', rSubj()),
      rec(3, 'c1', rA2()),
      rec(4, 'c1', rA1())
    ] }
    expect(lastRoundDelta(state, subj)).toBe(50)
    expect(lastRoundDelta({ history: [rec(1, 'c1', rA1())] }, subj)).toBe(null)
    expect(lastRoundDelta({ history: [] }, subj)).toBe(null)
    expect(lastRoundDelta({ history: [rec(1, 'c1', rSubj()), rec(2, 'c1', rSubj())] }, subj)).toBe(null)
  })

  it('lastRecord：最后一条本科目记录', () => {
    const state = { history: [rec(1, 'c1', rA1(), { date: 'd1' }), rec(2, 'c1', rA1(), { date: 'd2' }), rec(3, 'other', rA1(), { date: 'd3' })] }
    const lr = lastRecord(state, subj)
    expect(lr.date).toBe('d2')
    expect(lastRecord({ history: [] }, subj)).toBe(null)
  })

  it('recentRounds：仅客观记录、≤8 条、时间正序、空→[]', () => {
    const recs = []
    for (let i = 1; i <= 10; i++) recs.push(rec(i, 'c1', i % 2 ? rA1() : rSubj(), { date: 'd' + i }))
    const rr = recentRounds({ history: recs }, subj)
    expect(rr.length).toBe(5)
    expect(rr[0].date).toBe('d1')
    expect(rr.map((p) => p.rate).every((v) => v === 100)).toBe(true)
    const many = { history: Array.from({ length: 20 }, () => rec(99, 'c1', rA1())) }
    expect(recentRounds(many, subj).length).toBe(8)
    expect(recentRounds({ history: [] }, subj)).toEqual([])
  })

  it('lastNDays/weekDelta/studyStreak：按天聚合与连续天数', () => {
    const t0 = new Date(); t0.setHours(0, 0, 0, 0)
    const tsToday = t0.getTime() + 3600000
    const tsY = tsToday - dayMs
    const ts2 = tsY - dayMs
    const ts4 = ts2 - 2 * dayMs
    const state = { history: [
      rec(ts4, 'c1', rA1()),
      rec(ts2, 'c1', rA1()),
      rec(tsY, 'c1', rA1()),
      rec(tsToday, 'c1', rA1()),
      rec(tsToday, 'c2', rA1())
    ] }
    const days = lastNDays(state, subj)
    expect(days[6]).toBe(2)
    expect(days[5]).toBe(1)
    expect(days[4]).toBe(1)
    expect(days[2]).toBe(1)
    expect(days[3]).toBe(0)
    expect(studyStreak(state, subj)).toBe(3)
    const noToday = { history: [rec(tsY, 'c1', rA1()), rec(ts2, 'c1', rA1())] }
    expect(studyStreak(noToday, subj)).toBe(2)
    const breakStreak = { history: [rec(ts2, 'c1', rA1())] }
    expect(studyStreak(breakStreak, subj)).toBe(0)
    expect(studyStreak({ history: [] }, subj)).toBe(0)
    const wd = { history: Array.from({ length: 3 }, () => rec(tsToday, 'c1', rA1())) }
    expect(weekDelta(wd, subj)).toBe(3)
  })
})

describe('subjectStats 薄弱标签 / 趋势洞察', () => {
  it('weakTags：totalQ≥3 才入选、按率升序、限 3 个、附章节名', () => {
    const state = { chapters: { c1: { name: '医学遗传学', strategy: { tagMeta: {
      '遗传': { totalQ: 5, correct: 1 },
      '免疫': { totalQ: 3, correct: 3 },
      '生化': { totalQ: 2, correct: 1 },
      '解剖': { totalQ: 10, correct: 4 }
    } } } } }
    const s1 = { chapterIds: ['c1'] }
    const wt = weakTags(state, s1)
    expect(wt.map((w) => w.tag)).toEqual(['遗传', '解剖', '免疫'])
    expect(wt[0].rate).toBe(20)
    expect(wt[0].chapterName).toBe('医学遗传学')
    expect(wt[0].total).toBe(5)
    const two = weakTags(state, s1, 2)
    expect(two.map((w) => w.tag)).toEqual(['遗传', '解剖'])
    expect(weakTags(state, s1, 3, 20)).toEqual([])
    expect(weakTags({ chapters: { c1: { name: 'x' } } }, s1)).toEqual([])
    const allRight = { chapters: { c1: { name: 'x', strategy: { tagMeta: { t: { totalQ: 9, correct: 9 } } } } } }
    expect(weakTags(allRight, s1).length).toBe(1)
    expect(weakTags({ chapters: {} }, s1)).toEqual([])
  })

  it('trendSlope / trendInsight', () => {
    expect(trendSlope([{ rate: 60 }, { rate: 70 }, { rate: 80 }])).toBe(10)
    expect(trendSlope([{ rate: 80 }, { rate: 70 }, { rate: 60 }])).toBe(-10)
    expect(trendSlope([{ rate: 60 }])).toBe(null)
    expect(trendSlope(null)).toBe(null)
    expect(trendInsight([{ rate: 60 }, { rate: 70 }, { rate: 80 }])).toContain('稳中有升')
    expect(trendInsight([{ rate: 80 }, { rate: 70 }])).toContain('下降')
    expect(trendInsight([{ rate: 60 }, { rate: 62 }])).toContain('稳定')
    expect(trendInsight([{ rate: 60 }])).toBe('')
  })

  it('ACCURACY_TARGET 供 UI 目标线使用', () => {
    expect(ACCURACY_TARGET).toBe(75)
  })
})
