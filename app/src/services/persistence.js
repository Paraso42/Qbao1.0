// ============================================================
// persistence.js — 本地状态持久化（自 legacy state.js 迁移，语义不变）
// localStorage 键与数据结构保持兼容：老用户数据无缝升级。
// ============================================================
import { migrateLegacyAiKeysFromState, stripAiSecretsFromState, hasAnyAiApiKey } from './aiKeys'
import * as stateDb from './stateDb'

export const DEFAULT_STATE = {
  subjects: {},
  currentSubjectId: null,
  chapters: {},
  currentChapterId: null,
  history: [],
  lastScreen: 'start'
}

export const STORAGE_KEY = 'quizEngineState_v7'
export const CLOUD_STORAGE_PREFIX = 'quizEngineState_cloud_'

function getUserStored() {
  try {
    const raw = localStorage.getItem('qbao_user')
    if (raw) {
      const u = JSON.parse(raw)
      if (u && u.id) return u
    }
  } catch (e) {}
  return null
}

// —— v3.36.1 账户隔离加固：内存 state 的数据属主追踪 ——
// 页面启动时由 loadState 记录“当前内存题库属于哪个账号”；切换账号（applyAuth）
// 时据此判定是否需要整页重建（防止把上一账号的题库写进新账号的云端/本地键）。
let _stateOwnerUid = null
export function getStateOwnerUid() { return _stateOwnerUid }
// v3.36.1 登录门禁：匿名期（未登录）内存被改动过（saveState 被拒）→ 登录时必须整页重建，
// 防止匿名改动在“同账号重新登录不重建”路径下被带入账号（防御纵深）
let _anonymousMutated = false
export function hadAnonymousMutations() { return _anonymousMutated }

export function loadState() {
  let state
  try {
    const user = getUserStored()
    if (user && user.id) {
      // 已登录：只读该账号专属键，绝不回退公共键（修复多账号串号：
      // 此前 fallback STORAGE_KEY 会把上一个账号的数据当成新账号的数据）
      _stateOwnerUid = String(user.id)
      stateDb.setStateDbUid(user.id) // IndexedDB 大字段按账号分区
      const saved = localStorage.getItem(CLOUD_STORAGE_PREFIX + user.id)
      if (saved) {
        state = JSON.parse(saved)
        state = migrateState(state)
        return state
      }
      return JSON.parse(JSON.stringify(DEFAULT_STATE))
    }
    // v3.36.1 登录门禁：未登录一律空态启动 —— 不读公共键（拒绝匿名数据参与业务），
    // 不产生任何本地归属；登录后按账号加载（整页重建，见 user store applyAuth）
    _stateOwnerUid = null
    stateDb.setStateDbUid(null)
  } catch (e) { console.warn('[persist] load err', e) }
  return JSON.parse(JSON.stringify(DEFAULT_STATE))
}

// ============================================================
// 骨架化（v3.30 性能整改）：localStorage 只存轻量骨架，
// 题目/答案/大考卷/SRS/历史这些 MB 级大字段进 IndexedDB（stateDb）。
// 内存 state 始终完整，仅持久化层分流 — 2000+ 题题库不再超 5MB、不再全量序列化卡顿。
// ============================================================

export const CHAPTER_BIG_FIELDS = ['questions', 'userAnswers', 'quizSets']
export const STATE_BIG_FIELDS = ['generatedExams', 'history']

// 浅拷贝剥离大字段 → 骨架（JSON.stringify 时引用会展开，体积 = 骨架大小）
export function buildSkeleton(state) {
  const sk = {}
  for (const k of Object.keys(state || {})) {
    if (STATE_BIG_FIELDS.includes(k)) continue
    if (k === 'chapters') {
      sk.chapters = {}
      const chs = state.chapters || {}
      for (const cid of Object.keys(chs)) {
        const ch = chs[cid]
        if (!ch || typeof ch !== 'object') { sk.chapters[cid] = ch; continue }
        const chSk = {}
        for (const f of Object.keys(ch)) {
          if (!CHAPTER_BIG_FIELDS.includes(f)) chSk[f] = ch[f]
        }
        sk.chapters[cid] = chSk
      }
    } else {
      sk[k] = state[k]
    }
  }
  return sk
}

// 判断 state 是否含大字段（旧版完整存储/合并结果）
export function hasBigFields(state) {
  if (!state) return false
  if (state.generatedExams || state.history) return true
  const chs = state.chapters || {}
  for (const cid of Object.keys(chs)) {
    const ch = chs[cid]
    if (ch && (Array.isArray(ch.questions) || Array.isArray(ch.quizSets))) return true
  }
  return false
}

let _idbWritePending = false
function writeBigFieldsToIdb(state) {
  try {
    const chList = []
    const chs = state.chapters || {}
    for (const cid of Object.keys(chs)) {
      const ch = chs[cid]
      if (ch && (ch.questions || ch.quizSets)) {
        // JSON round-trip：解除 Vue reactive proxy（IDB 结构化克隆不接受 Proxy）
        chList.push({ cid, data: JSON.parse(JSON.stringify({
          questions: ch.questions || [],
          userAnswers: ch.userAnswers || [],
          quizSets: ch.quizSets || [],
        })) })
      }
    }
    const globalData = JSON.parse(JSON.stringify({
      generatedExams: state.generatedExams || {},
      history: state.history || [],
    }))
    stateDb.saveChapters(chList)
    stateDb.saveGlobal(globalData)
  } catch (e) { console.warn('[persist] idb write err', e) }
}

let _stateSource = null
// 注册完整内存 state 的来源（boot 时由 data store 提供）；pagehide 强刷用
export function setStateSource(fn) { _stateSource = fn }

// 页面销毁前强制写一次大字段（requestIdleCallback 在卸载时可能被丢弃；
// IDB 事务在 pagehide 阶段启动仍会提交，保证最近答题/出题进度不丢）
export function flushBigFieldsNow() {
  const state = typeof _stateSource === 'function' ? _stateSource() : null
  if (!state || typeof state !== 'object') return
  if (!hasBigFields(state)) return
  writeBigFieldsToIdb(state)
  // 活动会话/考卷镜像一并强写（关闭/刷新前最后一份快照的 IDB 通道）
  saveActiveSession(state)
  saveActiveExam(state)
}

// 空闲时全量写大字段到 IndexedDB（requestIdleCallback 不阻塞交互；节流合并高频保存）
export function scheduleFullIdbWrite(state) {
  if (_idbWritePending || typeof state !== 'object' || !state) return
  _idbWritePending = true
  const run = () => {
    _idbWritePending = false
    writeBigFieldsToIdb(state)
  }
  if (typeof requestIdleCallback === 'function') requestIdleCallback(run, { timeout: 3000 })
  else setTimeout(run, 600)
}

// —— 活动会话快速恢复（修复刷新后答题入口消失/进度丢失）——
// 答题中的会话（当前章节的当前 quizSet 的答案/进度）每次 saveState 同步写 localStorage
// 小键（几 KB ~ 几十 KB），不依赖 IndexedDB 空闲写入，刷新/关闭必达。
export const ACTIVE_SESSION_KEY = 'qbao_active_session'
// 大考卷（generatedExams）进度同步键：考卷题目/答案/进度走同一条“刷新必达”通道
export const ACTIVE_EXAM_KEY = 'qbao_active_exam'
// IndexedDB 镜像键（qbao_state_db global store 内独立 key；无需 DB 版本迁移）
export const ACTIVE_SESSION_IDB_KEY = 'activeSession'
export const ACTIVE_EXAM_IDB_KEY = 'activeExam'
// v3.36 存储配额治理：活动会话镜像仍保留 localStorage 影子键（刷新/关闭必达），
// 但超过预算的大会话（2000+ 题一轮可达数 MB）只写 IndexedDB —— 防止撑爆 iOS
// Safari localStorage 约 5MB 总量，导致骨架键写不进、每次答题弹“存储空间已满”。
export const ACTIVE_SESSION_LS_BUDGET = 1024 * 1024 // 1MB

// 会话镜像落盘后端选择（纯函数，可测）：预算内 → localStorage 影子；超大 → 仅 IndexedDB
export function pickSessionBackend(bytes) {
  if (typeof bytes !== 'number' || !(bytes >= 0)) return 'idb'
  return bytes > ACTIVE_SESSION_LS_BUDGET ? 'idb' : 'ls'
}

// v3.36.1 账户隔离：localStorage 活动会话/考卷镜像键按账号后缀隔离（旧版全局键仅用于升级回退）
// v3.37.1 加固：账号后缀取「内存数据属主」而非活读 localStorage —— 多标签页下活读会
// 把本页（旧账号内存）的镜像写进其他标签页刚登录的新账号键里，是串号的另一入口。
function activeMirrorKey(base) {
  const uid = getStateOwnerUid()
  if (uid) return base + '_u_' + uid
  return base
}
function removeLegacyMirror(base) {
  try { if (activeMirrorKey(base) !== base) localStorage.removeItem(base) } catch (e) { /* 忽略 */ }
}

function extractActiveSession(state) {
  try {
    const cid = state && state.currentChapterId
    const ch = cid && state.chapters && state.chapters[cid]
    if (!ch || !Array.isArray(ch.quizSets) || ch.quizSets.length === 0) return null
    const idx = (typeof ch.currentQuizSetIdx === 'number' && ch.currentQuizSetIdx >= 0)
      ? ch.currentQuizSetIdx : ch.quizSets.length - 1
    const set = ch.quizSets[idx]
    if (!set || !Array.isArray(set.questions)) return null
    return {
      cid,
      qsIdx: idx,
      questions: set.questions,
      userAnswers: set.userAnswers || [],
      currentIdx: typeof set.currentIdx === 'number' ? set.currentIdx : 0,
    }
  } catch (e) { return null }
}

function saveActiveSession(state) {
  const session = extractActiveSession(state)
  if (!session) return
  let serialized = null
  try { serialized = JSON.stringify(session) } catch (e) { return }
  // IndexedDB 常备完整镜像（体积无上限，按账号分区）；localStorage 仅保留预算内的小会话影子
  try { stateDb.saveMisc(ACTIVE_SESSION_IDB_KEY, JSON.parse(serialized)) } catch (e) { /* IDB 失败则依赖云端 */ }
  try {
    const k = activeMirrorKey(ACTIVE_SESSION_KEY)
    if (pickSessionBackend(serialized.length) === 'ls') {
      localStorage.setItem(k, serialized)
    } else {
      localStorage.removeItem(k) // 清理可能残留的历史大镜像键
    }
    removeLegacyMirror(ACTIVE_SESSION_KEY) // 写入账号键后清旧全局键，防跨账号残留
  } catch (e) { /* 影子键尽力；失败则依赖 IDB/云端 */ }
}

function extractActiveExam(state) {
  try {
    const exId = state && state.currentExamId
    const ex = exId && state.generatedExams && state.generatedExams[exId]
    if (!ex || !Array.isArray(ex.questions) || ex.questions.length === 0) return null
    return {
      examId: exId,
      name: ex.name || '',
      subjectId: ex.subjectId || null,
      questions: ex.questions,
      userAnswers: ex.userAnswers || [],
      currentIdx: typeof ex.currentIdx === 'number' ? ex.currentIdx : 0,
    }
  } catch (e) { return null }
}

function saveActiveExam(state) {
  const exam = extractActiveExam(state)
  if (!exam) return
  let serialized = null
  try { serialized = JSON.stringify(exam) } catch (e) { return }
  try { stateDb.saveMisc(ACTIVE_EXAM_IDB_KEY, JSON.parse(serialized)) } catch (e) { /* IDB 失败则依赖云端 */ }
  try {
    const k = activeMirrorKey(ACTIVE_EXAM_KEY)
    if (pickSessionBackend(serialized.length) === 'ls') {
      localStorage.setItem(k, serialized)
    } else {
      localStorage.removeItem(k) // 清理可能残留的历史大镜像键
    }
    removeLegacyMirror(ACTIVE_EXAM_KEY) // 写入账号键后清旧全局键，防跨账号残留
  } catch (e) { /* 失败则依赖 IDB/云端 */ }
}

async function restoreActiveSession(state) {
  let raw = null
  let readKey = null
  const uidKey = activeMirrorKey(ACTIVE_SESSION_KEY)
  try { raw = localStorage.getItem(uidKey); readKey = uidKey } catch (e) {}
  if (raw == null && uidKey !== ACTIVE_SESSION_KEY) {
    // 升级回退：无账号专属键时读旧全局键（cid 归属由下方骨架引用守卫过滤）
    try { raw = localStorage.getItem(ACTIVE_SESSION_KEY); readKey = ACTIVE_SESSION_KEY } catch (e) {}
  }
  if (raw == null) {
    // 影子键缺失（大会话本就不写 / 已被清理）→ IndexedDB 完整镜像回退
    try {
      const d = await stateDb.loadMisc(ACTIVE_SESSION_IDB_KEY)
      if (d != null) raw = JSON.stringify(d)
    } catch (e) { /* 回退不可用则跳过恢复 */ }
  } else {
    // 历史遗留超预算大镜像键：读取后一次性清理（数据已常驻 IDB）；
    // 预算内小影子键保留（下一次保存前刷新仍可恢复，不丢语义）
    if (raw.length > ACTIVE_SESSION_LS_BUDGET) {
      try { localStorage.removeItem(readKey) } catch (e) {}
    }
  }
  if (!raw) return
  try {
    const s = JSON.parse(raw)
    const ch = state.chapters && state.chapters[s.cid]
    if (!ch) return
    if (!Array.isArray(ch.quizSets)) ch.quizSets = []
    // 只回填"骨架/IDB 中缺失"的会话（避免覆盖已完整恢复的数据）
    const existing = ch.quizSets[s.qsIdx]
    if (existing && Array.isArray(existing.questions) && existing.questions.length > 0) {
      // 会话已存在（IDB/云端恢复）：活动会话键每次保存必最新 → 覆盖答案/进度
      const answers = toUndef(s.userAnswers)
      if (answers.length === existing.questions.length) existing.userAnswers = answers
      if (typeof s.currentIdx === 'number') existing.currentIdx = s.currentIdx
    } else {
      // null → undefined：JSON 序列化丢失 undefined，未答题目不能算已答
      const answers = toUndef(s.userAnswers)
      ch.quizSets[s.qsIdx] = {
        questions: s.questions || [],
        userAnswers: answers,
        currentIdx: s.currentIdx || 0,
        createdAt: Date.now(),
      }
      if (s.qsIdx >= ch.quizSets.length) ch.quizSets.length = s.qsIdx + 1
      ch.currentQuizSetIdx = s.qsIdx
    }
  } catch (e) { console.warn('[persist] restoreActiveSession err', e) }
}

async function restoreActiveExam(state) {
  let raw = null
  let readKey = null
  const uidKey = activeMirrorKey(ACTIVE_EXAM_KEY)
  try { raw = localStorage.getItem(uidKey); readKey = uidKey } catch (e) {}
  if (raw == null && uidKey !== ACTIVE_EXAM_KEY) {
    // 升级回退：无账号专属键时读旧全局键（归属由骨架引用守卫过滤）
    try { raw = localStorage.getItem(ACTIVE_EXAM_KEY); readKey = ACTIVE_EXAM_KEY } catch (e) {}
  }
  if (raw == null) {
    try {
      const d = await stateDb.loadMisc(ACTIVE_EXAM_IDB_KEY)
      if (d != null) raw = JSON.stringify(d)
    } catch (e) { /* 回退不可用则跳过恢复 */ }
  } else {
    // 历史遗留超预算大镜像键：读取后一次性清理（数据已常驻 IDB）；
    // 预算内小影子键保留（下一次保存前刷新仍可恢复）
    if (raw.length > ACTIVE_SESSION_LS_BUDGET) {
      try { localStorage.removeItem(readKey) } catch (e) {}
    }
  }
  if (!raw) return
  try {
    const s = JSON.parse(raw)
    if (!Array.isArray(s.questions) || s.questions.length === 0) return
    if (!state.generatedExams) state.generatedExams = {}
    const ex = state.generatedExams[s.examId]
    if (!ex || !Array.isArray(ex.questions) || ex.questions.length === 0) {
      // 骨架/IDB 中缺失考卷 → 用活动键完整回填（刷新必达）
      state.generatedExams[s.examId] = {
        id: s.examId,
        name: s.name || '大考卷',
        subjectId: s.subjectId || null,
        questions: s.questions,
        userAnswers: toUndef(s.userAnswers),
        currentIdx: s.currentIdx || 0,
      }
    } else {
      // 考卷已恢复：活动键每次保存必最新 → 按题回填答案/进度（覆盖 IDB/云端旧值）
      const answers = toUndef(s.userAnswers)
      if (!Array.isArray(ex.userAnswers)) ex.userAnswers = []
      for (let j = 0; j < Math.min(answers.length, ex.questions.length); j++) {
        ex.userAnswers[j] = answers[j]
      }
      if (typeof s.currentIdx === 'number') ex.currentIdx = s.currentIdx
    }
  } catch (e) { console.warn('[persist] restoreActiveExam err', e) }
}

// 启动时从 IndexedDB 回填大字段到骨架 state（题目常驻内存，结构不变）
const toUndef = (arr) => (Array.isArray(arr) ? arr.map((a) => (a === null ? undefined : a)) : [])

export async function hydrateState(state) {
  try {
    // 数据属主与 IDB 分区保持一致（骨架由 loadState 按账号读取）
    stateDb.setStateDbUid(_stateOwnerUid)
    const [chapters, global] = await Promise.all([stateDb.loadAllChapters(), stateDb.loadGlobal()])
    const chs = state.chapters || {}
    for (const cid of Object.keys(chapters)) {
      const ch = chs[cid]
      const d = chapters[cid]
      if (ch && d && (!ch.questions || ch.questions.length === 0)) {
        ch.questions = d.questions || []
        ch.userAnswers = toUndef(d.userAnswers)
        ch.quizSets = (d.quizSets || []).map((set) => ({
          ...set,
          userAnswers: toUndef(set.userAnswers),
        }))
      }
    }
    if (global) {
      if (global.generatedExams && (!state.generatedExams || Object.keys(state.generatedExams).length === 0)) state.generatedExams = global.generatedExams
      if (global.history && (!state.history || state.history.length === 0)) state.history = global.history
    }
    // 恢复活动会话（答题入口/进度）：localStorage 影子优先 → IDB 镜像回退
    await restoreActiveSession(state)
    await restoreActiveExam(state)
  } catch (e) { console.warn('[persist] hydrate err', e) }
}

// 跨标签页账号守卫判定（v3.37.1）：其他标签页登录/登出/切换账号（qbao_user 变化）时，
// 本页内存数据属主已过期 → 应冻结同步并整页重建，防止旧账号内存写入新账号键。
// 纯函数便于单测：返回 true 表示本页需要重建。
export function isAccountStorageCrossChange(e, ownerUid) {
  if (!e || e.key !== 'qbao_user') return false
  let curId = null
  try {
    const u = e.newValue ? JSON.parse(e.newValue) : null
    if (u && u.id) curId = String(u.id)
  } catch (err) { return true }
  return curId !== (ownerUid ? String(ownerUid) : null)
}

export function getChStrategy(state, cid) {
  const ch = state.chapters[cid]
  if (!ch) return null
  if (!ch.strategy) ch.strategy = {}
  const s = ch.strategy
  if (!s.typeCounts || typeof s.typeCounts !== 'object') s.typeCounts = { single: 5, judge: 5, term: 3, short: 2 }
  ;['single', 'judge', 'term', 'short'].forEach(function (k) {
    if (typeof s.typeCounts[k] !== 'number') s.typeCounts[k] = 5
  })
  if (typeof s.errPct !== 'number') s.errPct = 20
  if (typeof s.reviewPct !== 'number') s.reviewPct = 50
  if (typeof s.newPct !== 'number') s.newPct = 30
  if (!s.errorTags) s.errorTags = []
  if (!s.reviewTags) s.reviewTags = []
  if (!s.newTopicTags) s.newTopicTags = []
  if (!s.tagMeta) s.tagMeta = {}
  return s
}

// 持久化序列化：剥离瞬态引用与密钥字段后写入 localStorage（双键）。
// 同步调度由调用方（data store / sync service）负责。
// T12/P1-2: 写失败不再静默 — 体积接近上限预警、QuotaExceeded 可见化（toast）。

let _persistWarn = null
export function setPersistWarningHook(fn) { _persistWarn = fn }
// v3.36：致命告警 30s 冷却 —— 每次答题保存失败都弹会形成“连续报错”刷屏；
// 冷却期内仅 console.warn 留痕，不再重复打扰（数据安全语义不变）
let _lastFatalWarnTs = 0
const FATAL_WARN_COOLDOWN_MS = 30 * 1000
function persistWarn(msg, fatal) {
  console.warn('[persist] ' + msg)
  if (_persistWarn) {
    if (fatal) {
      const now = Date.now()
      if (now - _lastFatalWarnTs < FATAL_WARN_COOLDOWN_MS) return
      _lastFatalWarnTs = now
    }
    try { _persistWarn(msg, !!fatal) } catch (e) {}
  }
}

// QuotaExceeded 自愈：优先清理可由 IndexedDB 完整恢复的临时镜像键（活动会话/考卷），
// 释放空间后由调用方重试一次写盘；返回是否释放了空间
function tryQuotaRecovery() {
  let freed = false
  const keys = [ACTIVE_SESSION_KEY, ACTIVE_EXAM_KEY]
  for (const base of keys) {
    // 同时清理账号专属键与旧版全局键（镜像数据已常驻 IDB，可安全释放）
    const variants = [base, activeMirrorKey(base)]
    for (const k of new Set(variants)) {
      try {
        const raw = localStorage.getItem(k)
        if (raw != null && raw.length > 0) { localStorage.removeItem(k); freed = true }
      } catch (e) { /* ignore */ }
    }
  }
  return freed
}

export const LOCALSTORAGE_WARN_BYTES = 4 * 1024 * 1024 // 4MB 预警（localStorage 约 5MB 上限）
export const LOCALSTORAGE_HARD_BYTES = 5 * 1024 * 1024 // 5MB 硬上限

export function saveState(state) {
  let serialized = null
  let qs = null
  let origCm = null
  try {
    stripAiSecretsFromState(state)

    qs = state.quizSession
    state.quizSession = null

    if (state.aiTaskQueue) state.aiTaskQueue.forEach(function (t) { t._ssr = t.streamSetRef; delete t.streamSetRef })

    origCm = state.chapterMaterials
    if (origCm) {
      const cleanCm = {}
      Object.keys(origCm).forEach(function (cid) {
        cleanCm[cid] = origCm[cid].map(function (m) {
          const copy = {}
          for (const k in m) { if (k !== 'data') copy[k] = m[k] }
          return copy
        })
      })
      state.chapterMaterials = cleanCm
    }

    // v3.30：序列化轻量骨架（不含题目/历史等大字段，MB → KB 级）
    serialized = JSON.stringify(buildSkeleton(state))
  } catch (e) {
    persistWarn('状态序列化失败，本次数据未保存: ' + e.message, true)
    return { ok: false }
  } finally {
    // 恢复瞬态字段：无论序列化成功/失败都恢复，避免内存状态被污染
    if (state.aiTaskQueue) state.aiTaskQueue.forEach(function (t) { t.streamSetRef = t._ssr; delete t._ssr })
    state.quizSession = qs
    state.chapterMaterials = origCm
  }

  const bytes = serialized.length
  if (bytes > LOCALSTORAGE_HARD_BYTES) {
    persistWarn('本地存储已满（超过 5MB），本次数据未保存！请删除部分题库或资料后再试', true)
    return { ok: false }
  }
  if (bytes > LOCALSTORAGE_WARN_BYTES) {
    persistWarn('本地存储接近上限（约 ' + (bytes / 1048576).toFixed(1) + 'MB/5MB），建议删除部分大题库或资料，防止数据丢失', false)
  }

  try {
    // v3.36.1 登录门禁：只允许登录账号落盘（账号专属键；绝不写公共键）。
    // 未登录不产生任何持久化副作用（含 IDB 大字段与活动镜像），数据只在内存，
    // 登录后按账号整页重建 —— 从机制上杜绝匿名数据与多账号互相串扰。
    // v3.37.1 加固：写入键取「内存数据属主」而非活读 localStorage —— 多标签页下
    // 本页内存永远只属于启动时加载的账号，写盘绝不漂移到其他标签页刚登录的账号键。
    const uid = getStateOwnerUid()
    if (!uid) {
      // 登录门禁：拒绝匿名落盘；内存可能已含匿名期改动，标记后强制下次登录重建
      _anonymousMutated = true
      return { ok: false }
    }
    localStorage.setItem(CLOUD_STORAGE_PREFIX + uid, serialized)
    // v3.30：大字段（题目/答案/历史）空闲时写 IndexedDB，不再占 localStorage
    scheduleFullIdbWrite(state)
    // 活动会话同步写（答题进度刷新不丢）：当前轮次 + 进行中的大考卷
    saveActiveSession(state)
    saveActiveExam(state)
    return { ok: true, bytes }
  } catch (e) {
    if (e && e.name === 'QuotaExceededError' && tryQuotaRecovery()) {
      // 自动清理可恢复的临时镜像键后重试一次（大会话镜像已迁 IDB，这里清的是历史遗留）
      try {
        const uid = getStateOwnerUid()
        if (!uid) return { ok: false }
        localStorage.setItem(CLOUD_STORAGE_PREFIX + uid, serialized)
        scheduleFullIdbWrite(state)
        saveActiveSession(state)
        saveActiveExam(state)
        persistWarn('本地存储已满，已自动清理临时缓存并保存成功', false)
        return { ok: true, bytes }
      } catch (e2) { /* 重试仍失败 → 走致命告警 */ }
    }
    const fatalMsg = e && e.name === 'QuotaExceededError'
      ? '本地保存失败：存储空间已满。数据暂存内存，请清理空间或登录同步后退出'
      : '本地保存失败：' + (e && e.message ? e.message : e)
    persistWarn(fatalMsg, true)
    return { ok: false }
  }
}

export function migrateState(s) {
  if (!s.history) s.history = []
  // 阻止页面加载后自动打开聊天/答题弹窗
  if (s.lastScreen === 'chat') s.lastScreen = 'start'
  if (s.lastScreen === 'quiz') s.lastScreen = 'start'
  if (!s.subjects) s.subjects = {}
  if (!s.chapters) s.chapters = {}

  for (const cid in s.chapters) {
    const ch = s.chapters[cid]
    if (!ch.strategy) ch.strategy = {
      errPct: 20, reviewPct: 50, newPct: 30,
      typeCounts: { single: 5, judge: 5, term: 3, short: 2 },
      errorTags: [], reviewTags: [], newTopicTags: [], tagMeta: {}
    }
    if (!ch.quizSets && ch.questions && ch.questions.length > 0) {
      ch.quizSets = [{ questions: ch.questions.slice(), userAnswers: (ch.userAnswers || []).slice(), currentIdx: 0, createdAt: Date.now() }]
    }
    if (!ch.strategy.errorTags) ch.strategy.errorTags = []
    if (!ch.strategy.reviewTags) ch.strategy.reviewTags = []
    if (!ch.strategy.newTopicTags) ch.strategy.newTopicTags = []
    if (!ch.strategy.tagMeta) ch.strategy.tagMeta = {}
    // 旧 weakTags → errorTags
    if (ch.strategy.weakTags && Array.isArray(ch.strategy.weakTags) && ch.strategy.errorTags.length === 0) {
      ch.strategy.weakTags.forEach(function (t) {
        const tName = typeof t === 'string' ? t : t.name
        if (tName && ch.strategy.errorTags.indexOf(tName) < 0) ch.strategy.errorTags.push(tName)
      })
      delete ch.strategy.weakTags
    }
    if (ch.weakTags && Array.isArray(ch.weakTags)) {
      if (typeof ch.weakTags[0] === 'string') ch.strategy.weakTags = ch.weakTags.map((t) => ({ name: t, active: true }))
      else ch.strategy.weakTags = ch.weakTags
      delete ch.weakTags
    }
  }
  if (s.weakTags) delete s.weakTags

  // 只有章节没有科目时兜底创建默认科目
  if (Object.keys(s.subjects).length === 0 && Object.keys(s.chapters).length > 0) {
    const sid = 'subj_' + Date.now().toString(36)
    s.subjects[sid] = { id: sid, name: '默认科目', chapterIds: Object.keys(s.chapters) }
    s.currentSubjectId = sid
  }

  for (const sid in s.subjects) {
    if (typeof s.subjects[sid].collapsed !== 'boolean') s.subjects[sid].collapsed = false
  }

  if (!s.achievements) s.achievements = { unlocked: [], history: [] }
  if (!s.ignoredQuestions) s.ignoredQuestions = []

  if (!s.subjectOrder || !Array.isArray(s.subjectOrder)) s.subjectOrder = Object.keys(s.subjects)
  Object.keys(s.subjects).forEach(function (sid) { if (!s.subjectOrder.includes(sid)) s.subjectOrder.push(sid) })
  s.subjectOrder = s.subjectOrder.filter(function (sid) { return !!s.subjects[sid] })

  if (!s.settings) s.settings = { quizFontSize: 17, sidebarFontSize: 13, topbarFontSize: 14, mainFontSize: 17, darkMode: false, showNoticeBar: true }
  if (!s.settings.sidebarFontSize) s.settings.sidebarFontSize = 13
  if (!s.settings.topbarFontSize) s.settings.topbarFontSize = 14
  if (!s.settings.mainFontSize) s.settings.mainFontSize = 17
  if (typeof s.settings.darkMode !== 'boolean') s.settings.darkMode = false
  if (typeof s.settings.showNoticeBar !== 'boolean') s.settings.showNoticeBar = true

  if (!s.generatedExams) s.generatedExams = {}
  if (!s.aiConfig) s.aiConfig = {}
  if (typeof s.aiConfig.systemPrompt !== 'string') s.aiConfig.systemPrompt = ''
  if (!s.aiConfig.provider) s.aiConfig.provider = 'ecnu'
  if (!s.aiConfig.model) s.aiConfig.model = 'ecnu-plus'
  if (!s.aiConfig.providerKeys) {
    s.aiConfig.providerKeys = {}
    if (s.aiConfig.apiKey) s.aiConfig.providerKeys.ecnu = s.aiConfig.apiKey
  }
  if (s.aiConfig.providerKeys && Object.keys(s.aiConfig.providerKeys).length > 0) {
    s.aiConfig.apiKeySet = true
  }

  // v3.27: AI Key 与同步状态分离
  migrateLegacyAiKeysFromState(s)
  stripAiSecretsFromState(s)
  s.aiConfig.apiKeySet = hasAnyAiApiKey()

  if (!s.chapterMaterials) s.chapterMaterials = {}
  if (typeof s.aiEnabled !== 'boolean') s.aiEnabled = false
  if (!s.aiTaskQueue) s.aiTaskQueue = []
  if (!s.importedServerTaskIds || !Array.isArray(s.importedServerTaskIds)) s.importedServerTaskIds = []
  // 页面刷新后重置 running 任务为 pending，清掉不可序列化的流引用；
  // _wasRunning 标记供 ai store 恢复逻辑区分“未开始”与“请求已在途”（避免刷新后重复调用 AI）
  s.aiTaskQueue.forEach((t) => { if (t.status === 'running') { t.status = 'pending'; t._wasRunning = true } delete t.streamSetRef })
  // quizSession 为瞬态，不持久化
  s.quizSession = null
  return s
}