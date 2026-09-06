// ============================================================
// sync.js — 双形态同步层（v3.25 语义不变，模块化版）
// 职责：带 rev 乐观锁的全量同步、409 冲突合并、失败可见化与自动重试。
// 引擎与 UI/store 解耦：createSyncEngine(ctx) 注入上下文。
// ============================================================
import { fetchWithAuth, getToken, effectiveToken, getStoredUser } from './api'
import { stripAiSecretsFromState } from './aiKeys'
import { migrateState, CLOUD_STORAGE_PREFIX, buildSkeleton, scheduleFullIdbWrite, getStateOwnerUid } from './persistence'
import { rebuildChapterAnswersFromSets } from './questions'

export const SYNC_PENDING_KEY = 'qbao_sync_pending'
export const LAST_SYNC_KEY = 'qbao_lastSync'

// v3.36.1 账户隔离加固：账号切换（applyAuth）瞬间冻结同步引擎——
// 防止切换窗口期把上一账号的内存题库推送到新账号的云端（串账根因）。
let _accountSwitching = false
export function setAccountSwitching(v) { _accountSwitching = !!v }
export function isAccountSwitching() { return _accountSwitching }

// v3.31 (P1.2)：同步标记按账号隔离（与 localStorage 状态键 / aiKeys 同策略），
// 防止 A 账号遗留的 pending 在 B 登录后被当成 B 的未同步数据补推（多账号串状态）。
function userScopedKey(base) {
  try {
    const u = getStoredUser()
    if (u && u.id) return base + '_u_' + u.id
  } catch (e) {}
  return base
}

export function getSyncPending() {
  try {
    const k = userScopedKey(SYNC_PENDING_KEY)
    const v = localStorage.getItem(k)
    if (v !== null) return v === '1'
    // 兼容旧版全局键（升级前遗留的 pending 标记）
    return localStorage.getItem(SYNC_PENDING_KEY) === '1'
  } catch (e) { return false }
}
export function setSyncPending(v) {
  try {
    const k = userScopedKey(SYNC_PENDING_KEY)
    if (v) localStorage.setItem(k, '1')
    else localStorage.removeItem(k)
    // 写入账号键后清掉旧全局键，防幽灵 pending
    if (k !== SYNC_PENDING_KEY) localStorage.removeItem(SYNC_PENDING_KEY)
  } catch (e) {}
}
function setLastSyncNow() {
  try {
    const k = userScopedKey(LAST_SYNC_KEY)
    localStorage.setItem(k, new Date().toISOString())
    if (k !== LAST_SYNC_KEY) localStorage.removeItem(LAST_SYNC_KEY)
  } catch (e) {}
}
export function getLastSyncAt() {
  try {
    const k = userScopedKey(LAST_SYNC_KEY)
    const v = localStorage.getItem(k) !== null ? localStorage.getItem(k) : localStorage.getItem(LAST_SYNC_KEY)
    return v ? new Date(v).getTime() : null
  } catch (e) { return null }
}

// 合并策略（v1）：实体级并集，同 id 本地优先，云端独有实体保留——任何一侧数据都不丢。
// v3.28 增强：chapters 从"整章覆盖"升级为"章节级并集"，防止多端并发出题时先写端题目被覆盖丢失。
function questionKey(q) {
  if (!q || typeof q !== 'object') return null
  try {
    return JSON.stringify([q.question, q.type, q.answer, Array.isArray(q.options) ? q.options.join('|') : ''])
  } catch (e) { return null }
}

// quizSets 并集：按题目签名去重（云端在前、本地新增在后）。
// 同轮次（签名相同）多端各自作答时，重复方不整轮丢弃，而是把已答答案补进
// 保留副本的空位（未答/-1/undefined 视为空位；双方都答同一题时保留先入方，
// 与题库并集“云端优先、本地补漏”的语义一致）——多端并发答题任何一侧进度不丢。
// round5.1：轮次删除墓碑——多端合并会把“云端删除的轮次”从本地补回来（本地并集语义），
// 墓碑（cid+sig 列表）随状态传播，云端/本地任何一侧命中墓碑的轮次都直接丢弃，删除不可复活。
function mergeQuizSets(localSets, cloudSets, tombstoneSigs) {
  const out = []
  const seen = new Map()
  const tomb = new Set(tombstoneSigs || [])
  const pushSet = (set) => {
    if (!set || !Array.isArray(set.questions)) return
    const sig = set.questions.map(questionKey).filter(Boolean).join('\u0001')
    if (!sig) return
    if (tomb.has(sig)) return
    if (seen.has(sig)) {
      const target = out[seen.get(sig)]
      if (!target || !Array.isArray(target.userAnswers)) return
      const src = Array.isArray(set.userAnswers) ? set.userAnswers : []
      for (let j = 0; j < src.length && j < target.userAnswers.length; j++) {
        const sa = src[j]
        if (sa === undefined || sa === null || sa === -1) continue
        const ta = target.userAnswers[j]
        if (ta === undefined || ta === null || ta === -1) target.userAnswers[j] = sa
      }
      return
    }
    seen.set(sig, out.length)
    out.push(JSON.parse(JSON.stringify(set)))
  }
  ;(cloudSets || []).forEach(pushSet)
  ;(localSets || []).forEach(pushSet)
  return out
}

// 章节资料并集：云端在前、本地补漏，按材料 id 按章节内去重。
// 注意：同一池文件可分配到多个章节（id=pool_xxx 会出现在多个章节），
// 因此去重必须限定在章节内，不能全局去重（T9）。
function mergeChapterMaterials(localCm, cloudCm) {
  const cids = new Set([...Object.keys(cloudCm || {}), ...Object.keys(localCm || {})])
  const out = {}
  cids.forEach((cid) => {
    const seen = new Set()
    const arr = []
    const push = (list) => {
      ;(list || []).forEach((m) => {
        if (!m || typeof m !== 'object') return
        const mid = m.id != null ? String(m.id) : null
        const key = mid != null ? mid : JSON.stringify(m)
        if (seen.has(key)) return
        seen.add(key)
        arr.push(JSON.parse(JSON.stringify(m)))
      })
    }
    push((cloudCm || {})[cid])
    push((localCm || {})[cid])
    if (arr.length) out[cid] = arr
  })
  return out
}

// 章节题库并集：按题干文本去重，答案以本地为准（本地没答的用云端值）。
function mergeChapterQuestions(localCh, cloudCh) {
  const cloudQs = Array.isArray(cloudCh.questions) ? cloudCh.questions : []
  const localQs = Array.isArray(localCh.questions) ? localCh.questions : []
  const cloudAns = Array.isArray(cloudCh.userAnswers) ? cloudCh.userAnswers : []
  const localAns = Array.isArray(localCh.userAnswers) ? localCh.userAnswers : []
  const byText = new Map()
  const order = []
  const addQ = (q, answer) => {
    if (!q || !q.question) return
    if (byText.has(q.question)) return
    byText.set(q.question, { q, answer })
    order.push(q.question)
  }
  cloudQs.forEach((q, i) => addQ(q, cloudAns[i]))
  localQs.forEach((q, i) => addQ(q, localAns[i]))
  return {
    questions: order.map((t) => byText.get(t).q),
    userAnswers: order.map((t) => byText.get(t).answer),
  }
}

// 章节级并集合并（v3.28）
function mergeChapter(localCh, cloudCh, tombSigs) {
  const out = JSON.parse(JSON.stringify(cloudCh || {}))
  const L = localCh || {}

  // 1) 题库并集（本地答案优先）
  const qm = mergeChapterQuestions(L, out)
  out.questions = qm.questions
  out.userAnswers = qm.userAnswers

  // 2) quizSets 并集（云端在前、本地在后，按签名去重；墓碑命中即丢弃）
  out.quizSets = mergeQuizSets(L.quizSets, out.quizSets, tombSigs)
  // 有轮次的章节：题库答案以轮次为准按题干重新对齐（去重合并可能使
  // ch.questions 与各轮顺序错位，逐位置覆盖会串题），保证统计与报告不错位
  if (Array.isArray(out.quizSets) && out.quizSets.length > 0) {
    rebuildChapterAnswersFromSets(out)
  }

  // 3) 操作性字段本地优先（正在作答的进度、策略、最近生成状态）
  ;['currentQuizSetIdx', 'currentIdx', 'strategy', '_hasNewFilesSinceLastGen', '_lastGenTime'].forEach((k) => {
    if (typeof L[k] !== 'undefined' && L[k] !== null) out[k] = L[k]
  })
  // 越界归正：quizSets 去重合并后数量可能减少，本地 currentQuizSetIdx 指向不存在的 set
  if (Array.isArray(out.quizSets) && out.quizSets.length > 0) {
    if (typeof out.currentQuizSetIdx !== 'number' || out.currentQuizSetIdx < 0 || out.currentQuizSetIdx >= out.quizSets.length) {
      out.currentQuizSetIdx = out.quizSets.length - 1
    }
  } else {
    out.currentQuizSetIdx = 0
  }
  return out
}

export function mergeStates(localState, cloudState) {
  const m = JSON.parse(JSON.stringify(cloudState || {}))
  const L = localState || {}
  ;['currentSubjectId', 'currentChapterId', 'currentExamId', 'lastScreen', 'darkMode',
    'aiConfig', 'settings', 'userSettings', 'notices'].forEach(function (k) {
    if (typeof L[k] !== 'undefined' && L[k] !== null) m[k] = L[k]
  })
  let conflictAddedCount = 0
  // generatedExams：本地优先按 id 覆盖（实体对象整体取本地，云端独有保留）
  {
    const c = m.generatedExams || {}
    const l = L.generatedExams || {}
    Object.keys(l).forEach(function (id) { c[id] = l[id] })
    m.generatedExams = c
  }
  // subjects：按 id 合并，本地优先（名称/折叠状态），但 chapterIds 取并集——
  // 本地旧骨架（另一台设备上新建的章节尚未同步到本端）整体覆盖云端会把新章节
  // 从科目里刷掉，再随全量推送把云端的科目结构也回退（round5 实测事故）
  {
    const c = m.subjects || {}
    const l = L.subjects || {}
    Object.keys(l).forEach(function (id) {
      const cloudSubj = c[id]
      const localSubj = l[id]
      if (cloudSubj && localSubj && typeof cloudSubj === 'object' && typeof localSubj === 'object') {
        const merged = { ...cloudSubj, ...localSubj }
        merged.chapterIds = Array.from(new Set([
          ...(Array.isArray(cloudSubj.chapterIds) ? cloudSubj.chapterIds : []),
          ...(Array.isArray(localSubj.chapterIds) ? localSubj.chapterIds : []),
        ]))
        c[id] = merged
      } else {
        c[id] = localSubj
      }
    })
    m.subjects = c
  }
  // chapterMaterials：资料元数据并集（云端在前、本地补漏，按章节内 id 去重）（T9）
  if (L.chapterMaterials || m.chapterMaterials) {
    m.chapterMaterials = mergeChapterMaterials(L.chapterMaterials, m.chapterMaterials)
  }
  // chapters：章节级并集合并；记录本次合并新增的题目数（供提示）
  {
    const c = m.chapters || {}
    const l = L.chapters || {}
    Object.keys(l).forEach(function (id) {
      const cloudCh = c[id]
      const localCh = l[id]
      if (cloudCh && typeof cloudCh === 'object' && localCh && typeof localCh === 'object') {
        const before = (Array.isArray(cloudCh.questions) ? cloudCh.questions.length : 0)
          + (Array.isArray(cloudCh.quizSets) ? cloudCh.quizSets.length : 0)
        const allTomb = [
          ...(Array.isArray(m.aiTombstones) ? m.aiTombstones : []),
          ...(Array.isArray(L.aiTombstones) ? L.aiTombstones : []),
        ]
        const tombSigs = allTomb.filter((tb) => tb && tb.cid === id).map((tb) => tb.sig)
        const merged = mergeChapter(localCh, cloudCh, tombSigs)
        const after = (Array.isArray(merged.questions) ? merged.questions.length : 0)
          + (Array.isArray(merged.quizSets) ? merged.quizSets.length : 0)
        if (after > before) conflictAddedCount += after - before
        c[id] = merged
      } else {
        c[id] = localCh
      }
    })
    m.chapters = c
  }
  if (Array.isArray(L.history) && Array.isArray(m.history)) {
    const have = {}
    m.history.forEach(function (h) { if (h && h.id) have[h.id] = true })
    L.history.forEach(function (h) { if (h && h.id && !have[h.id]) m.history.push(h) })
  } else if (Array.isArray(L.history)) {
    m.history = L.history
  }
  // aiTaskQueue：按任务 id 并集，同 id 本地优先——出题任务由本地 runner 裁决
  // （刷新后的恢复/失败标记、执行进度不受云端旧状态回滚），云端独有任务并入
  if (Array.isArray(L.aiTaskQueue) || Array.isArray(m.aiTaskQueue)) {
    const cloudQ = Array.isArray(m.aiTaskQueue) ? m.aiTaskQueue : []
    const localQ = Array.isArray(L.aiTaskQueue) ? L.aiTaskQueue : []
    const outQ = []
    const byId = new Map()
    const push = (t) => { if (!t || !t.id) return; if (byId.has(t.id)) return; byId.set(t.id, outQ.length); outQ.push(t) }
    cloudQ.forEach(push)
    localQ.forEach((t) => {
      if (!t || !t.id) return
      if (byId.has(t.id)) { const i = byId.get(t.id); outQ[i] = t; return } // 本地同 id 覆盖云端副本
      push(t)
    })
    m.aiTaskQueue = outQ
  }
  // aiTombstones：轮次删除墓碑并集（cid+sig），上限 100 条（只增于数据修复操作）
  {
    const c = Array.isArray(m.aiTombstones) ? m.aiTombstones : []
    const l = Array.isArray(L.aiTombstones) ? L.aiTombstones : []
    const seen = new Map()
    ;[...c, ...l].forEach((tb) => {
      if (!tb || !tb.cid || !tb.sig) return
      const k = tb.cid + '\u0001' + tb.sig
      if (seen.has(k)) return
      seen.set(k, tb)
    })
    const merged = Array.from(seen.values()).slice(-100)
    if (merged.length > 0) m.aiTombstones = merged
    else delete m.aiTombstones
  }
  return { state: m, conflictAddedCount }
}

export function persistMergedState(merged) {
  // 账号隔离（与 persistence.saveState 一致）：登录态只写账号键；
  // v3.36.1 登录门禁：未登录一律不落盘（公共键永久停用）
  // v3.37.1 加固：写入键取内存数据属主而非活读 localStorage（多标签页串号根治）
  const uid = getStateOwnerUid()
  if (!uid) return
  const target = CLOUD_STORAGE_PREFIX + uid
  try {
    localStorage.setItem(target, JSON.stringify(buildSkeleton(merged)))
    scheduleFullIdbWrite(merged)
  } catch (e) { console.warn('[sync] persistMergedState err', e) }
}

// ctx: {
//   getState() -> 当前 state（data store 的 reactive state）
//   replaceState(merged) -> 合并后替换 store 状态（保持响应性）
//   isOnline() -> 是否在线登录
//   onStatus({ pending, syncing, lastSyncAt }) -> 更新同步指示
//   notify(msg) -> toast
// }
export function createSyncEngine(ctx) {
  let _syncRev = null
  let _syncInFlight = false
  // 启动门闩：本地 IDB 回填 + 云端恢复完成前禁止推送（防止骨架态覆盖云端题目数据）
  let _syncingReady = false
  // 引擎武装时的数据属主（= 页面启动时 loadState 记录的账号）；账号变更/切换冻结期
  // 内一律停摆，等待整页重建后新引擎在新账号下重新武装
  let _armedAccount = (typeof ctx.accountId === 'function') ? ctx.accountId() : null

  function canSync() {
    if (_accountSwitching) return false
    if (_armedAccount === null) return true
    let cur = null
    try {
      if (typeof ctx.accountId === 'function') cur = ctx.accountId()
    } catch (e) { /* 忽略 */ }
    return cur === null || cur === _armedAccount
  }
  let _syncTimer = null
  let _syncRetryTimer = null
  let _pollTimer = null
  let _visBound = false
  let _lastPullAt = 0
  let _pollTick = null
  // v3.31 (P1.2) 写收敛：上次成功推送的内容（脱敏序列化串）与其时 rev。
  // flushSync/keepalive 前先比对：内容未变且 rev 基线未变 → 空推跳过（无空 PUT）。
  let _lastPushedJson = null
  let _lastPushedRev = null

  function updateStatus() {
    if (ctx.onStatus) {
      ctx.onStatus({
        pending: getSyncPending(),
        syncing: _syncInFlight,
        lastSyncAt: getLastSyncAt()
      })
    }
  }

  function markSynced() {
    setSyncPending(false)
    setLastSyncNow()
    updateStatus()
  }

  // —— 拉取云端并合并到本地（pull）——
  // 幂等：本地优先 + 实体级并集，任何一侧数据都不丢。
  // 返回 { changed, addedCount }；changed 表示本地状态被合并更新。
  async function pullAndMerge() {
    if (!canSync()) return { changed: false, addedCount: 0 }
    if (!ctx.isOnline() || !effectiveToken()) return { changed: false, addedCount: 0 }
    try {
      const res = await fetchWithAuth('/data')
      if (!res || !res.ok) return { changed: false, addedCount: 0 }
      const cloud = await res.json().catch(() => null)
      if (!cloud || !cloud.state_json) return { changed: false, addedCount: 0 }
      const cloudState = migrateState(cloud.state_json)
      const mergedRes = mergeStates(ctx.getState(), cloudState)
      const merged = mergedRes.state
      if (typeof cloud.rev === 'number' && cloud.rev > 0) _syncRev = cloud.rev
      let changed = false
      try {
        changed = JSON.stringify(merged) !== JSON.stringify(ctx.getState())
      } catch (e) { changed = true }
      if (changed) {
        ctx.replaceState(merged)
        persistMergedState(merged)
        _lastPullAt = Date.now()
        if (mergedRes.conflictAddedCount > 0 && ctx.notify) {
          ctx.notify('已从云端同步其他设备新增的 ' + mergedRes.conflictAddedCount + ' 道题目')
        }
        if (typeof ctx.onMerged === 'function') { try { ctx.onMerged() } catch (e) {} }
        return { changed: true, addedCount: mergedRes.conflictAddedCount }
      }
      return { changed: false, addedCount: 0 }
    } catch (e) {
      console.warn('[sync] pullAndMerge failed:', e && e.message)
      return { changed: false, addedCount: 0 }
    }
  }

  // —— 推送体准备：脱敏 + 序列化一次；与上次成功推送相同且 rev 基线未变 → noop（空推跳过） ——
  function preparePush() {
    let pushJson = null
    try {
      stripAiSecretsFromState(ctx.getState())
      pushJson = JSON.stringify(ctx.getState())
    } catch (e) { pushJson = null }
    return {
      pushJson,
      noop: pushJson !== null && pushJson === _lastPushedJson && _syncRev === _lastPushedRev
    }
  }

  // 全量 PUT（rev 乐观锁）。成功 → 记录推送指纹供空推跳过。
  // 返回 { ok } / { unauthorized }（401 登出）/ { conflict }（409）/ { failed, status }
  async function doPut(pushJson) {
    try {
      const payload = (typeof _syncRev === 'number' && _syncRev > 0)
        ? '{"state_json":' + pushJson + ',"rev":' + _syncRev + '}'
        : '{"state_json":' + pushJson + '}'
      const res = await fetchWithAuth('/data', { method: 'PUT', body: payload })
      if (!res) return { unauthorized: true } // 401 → 已登出
      if (res.ok) {
        const data = await res.json().catch(() => ({}))
        if (typeof data.rev === 'number') { _syncRev = data.rev; _lastPushedRev = data.rev }
        _lastPushedJson = pushJson
        markSynced()
        return { ok: true }
      }
      if (res.status === 409) return { conflict: true }
      return { failed: true, status: res.status }
    } catch (e) {
      return { failed: true, status: -1 }
    }
  }

  async function flushSync() {
    if (!canSync()) return
    if (!_syncingReady) { setSyncPending(true); updateStatus(); return }
    if (_syncInFlight || !ctx.isOnline() || !effectiveToken()) return
    _syncInFlight = true
    updateStatus()
    try {
      // 推送前先校验云端版本（轻量 /data/rev）：云端有其他端新写入才拉全量合并，
      // 杜绝"旧状态带最新 rev 直接覆盖云端"导致的数据丢失，同时避免每次全量传输。
      let cloudRev = null
      try {
        const revRes = await fetchWithAuth('/data/rev')
        if (revRes && revRes.ok) {
          const r = await revRes.json().catch(() => null)
          if (r && typeof r.rev === 'number' && r.rev > 0) cloudRev = r.rev
        }
      } catch (e) { /* 忽略：rev 接口不可用则按旧行为直接推送 */ }
      if (cloudRev !== null && cloudRev !== _syncRev) {
        await pullAndMerge()
      }
      const pp = preparePush()
      if (pp.pushJson === null) {
        // 状态不可序列化（异常）：保留 pending 走重试，避免静默丢数据
        console.error('[sync] state serialization failed, push deferred')
        setSyncPending(true)
        scheduleSyncRetry()
        return
      }
      if (pp.noop) {
        // P1.2 写收敛：无变化的 flush（轮询/可见性/重复调度）不产生空 PUT
        markSynced()
        return
      }
      const out = await doPut(pp.pushJson)
      if (out.ok) return
      if (out.unauthorized) { updateStatus(); return } // 已登出，pending 由登出流程清理
      if (out.conflict) {
        console.warn('[sync] 409 conflict, merging with cloud')
        const cur = await fetchWithAuth('/data')
        if (cur && cur.ok) {
          const cloud = await cur.json().catch(() => null)
          if (cloud && cloud.state_json) {
            const mergedRes = mergeStates(ctx.getState(), migrateState(cloud.state_json))
            const merged = mergedRes.state
            ctx.replaceState(merged)
            persistMergedState(merged)
            if (typeof cloud.rev === 'number') _syncRev = cloud.rev
            if (typeof ctx.onMerged === 'function') { try { ctx.onMerged() } catch (e) {} }
            if (ctx.notify) {
              if (mergedRes.conflictAddedCount > 0) {
                ctx.notify('检测到其他设备同时出题，已合并双方题目（新增 ' + mergedRes.conflictAddedCount + ' 题）')
              } else {
                ctx.notify('检测到其他设备的数据，已自动合并')
              }
            }
          }
          // 合并后以最新 rev 重推（内容已并入云端数据）
          const pp2 = preparePush()
          if (pp2.pushJson !== null) {
            const out2 = await doPut(pp2.pushJson)
            if (out2.ok || out2.unauthorized) return
          }
        }
        setSyncPending(true)
        scheduleSyncRetry()
        return
      }
      console.error('[sync] PUT /data failed:', out.status)
      setSyncPending(true)
      scheduleSyncRetry()
    } catch (e) {
      console.error('[sync] error:', e && e.message, e)
      setSyncPending(true)
      scheduleSyncRetry()
    } finally {
      _syncInFlight = false
      updateStatus()
    }
  }

  function scheduleSyncRetry() {
    if (_syncRetryTimer) clearTimeout(_syncRetryTimer)
    _syncRetryTimer = setTimeout(() => { flushSync() }, 30000)
    updateStatus()
  }

  // 由 saveState() 调用：防抖 2s 后推送全量状态
  function scheduleSync() {
    if (!canSync()) return
    if (!ctx.isOnline() || !effectiveToken()) return
    setSyncPending(true)
    updateStatus()
    if (!_syncingReady) return // 启动未就绪：保留 pending，就绪后 resumePendingSync 补推
    if (_syncTimer) clearTimeout(_syncTimer)
    _syncTimer = setTimeout(() => { flushSync() }, 2000)
  }

  // 登录/恢复后回放未同步数据（返回 flushSync 的 promise，便于调用方串行化等待）
  function resumePendingSync() {
    if (!canSync()) return Promise.resolve()
    if (getSyncPending() && ctx.isOnline() && effectiveToken()) return flushSync()
    return Promise.resolve()
  }

  // —— 轮询：检测其他端写入（轻量 rev 检查，变化才拉全量合并） ——
  async function pollTick() {
    if (!canSync()) return
    if (_syncInFlight || !ctx.isOnline() || !effectiveToken()) return
    try {
      const res = await fetchWithAuth('/data/rev')
      if (!res || !res.ok) {
        // 旧服务器无 /data/rev 接口 → 退化为全量拉取合并
        if (res && res.status === 404) await pullAndMerge()
        return
      }
      const r = await res.json().catch(() => null)
      if (!r) return
      const cloudRev = (typeof r.rev === 'number' && r.rev > 0) ? r.rev : null
      // 云端有新写入（rev 变化）→ 拉取合并；本地有未推送内容 → 立即推送
      if (cloudRev !== null && cloudRev !== _syncRev) {
        await pullAndMerge()
      }
      if (getSyncPending()) flushSync()
    } catch (e) {
      console.warn('[sync] poll tick failed:', e && e.message)
    }
  }

  function startPolling(intervalMs) {
    if (_pollTimer) return
    _pollTimer = setInterval(() => { _pollTick = pollTick().catch(() => {}) }, intervalMs || 20000)
  }

  // 焦点/可见性：切回页面立即同步（快速发现其他端变化 + 补推未同步内容）
  function bindVisibilityLifecycle() {
    if (_visBound) return
    _visBound = true
    const onVisible = () => { pollTick().catch(() => {}) }
    window.addEventListener('focus', onVisible)
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') onVisible()
      else if (getSyncPending() && ctx.isOnline()) flushSync()
    })
  }

  function setRev(rev) { if (typeof rev === 'number' && rev > 0) _syncRev = rev }

  // T10: 页面关闭/隐藏前尽力推送未同步状态（fetch keepalive，短请求不受页面销毁影响）。
  // 未完成的全量推送会由本地 pending 标记 + localStorage 云端副本在下次启动时补推。
  let _unloadBound = false
  function bindUnloadKeepalive() {
    if (_unloadBound || typeof window === 'undefined') return
    _unloadBound = true
    const flushOnUnload = () => {
      if (!canSync() || !_syncingReady || _syncInFlight || !getSyncPending() || !ctx.isOnline() || !effectiveToken()) return
      // P1.2：与 flushSync 相同的空推检测 —— 内容未变化（如 in-flight 刚完成）不发重复 PUT
      const pp = preparePush()
      if (pp.noop || pp.pushJson === null) return
      try {
        const payload = (typeof _syncRev === 'number' && _syncRev > 0)
          ? '{"state_json":' + pp.pushJson + ',"rev":' + _syncRev + '}'
          : '{"state_json":' + pp.pushJson + '}'
        fetchWithAuth('/data', { method: 'PUT', body: payload, keepalive: true }).catch(() => {})
      } catch (e) { /* best-effort */ }
    }
    window.addEventListener('beforeunload', flushOnUnload)
    window.addEventListener('pagehide', flushOnUnload)
  }

  function setSyncingReady(v) { _syncingReady = !!v }

  return {
    scheduleSync, flushSync, resumePendingSync, updateStatus, setRev,
    pullAndMerge, startPolling, bindVisibilityLifecycle, bindUnloadKeepalive, setSyncingReady,
    getRev: () => _syncRev
  }
}