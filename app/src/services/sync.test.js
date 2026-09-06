import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mergeStates, createSyncEngine, getSyncPending, setSyncPending, setAccountSwitching, persistMergedState } from './sync'
import * as persistenceMod from './persistence'
import { pinToken, unpinToken } from './api'

// —— P1.2 引擎级测试基建：内存 localStorage + fetch mock ——
function makeLocalStorageStub(seed = {}) {
  const map = new Map(Object.entries(seed))
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)) },
    removeItem: (k) => { map.delete(k) },
    _map: map,
  }
}

// opts: { cloudState, cloudRev, conflictPutCount(前 N 次 PUT 返回 409) }
function installFetchMock(opts = {}) {
  const st = {
    cloudState: opts.cloudState || null,
    cloudRev: opts.cloudRev || 0,
    putCount: 0,
    getCount: 0,
    revCount: 0,
    putBodies: [],
    authHeaders: [],
    conflictLeft: opts.conflictPutCount || 0,
  }
  st.authHeaders = []
  globalThis.fetch = async (url, options = {}) => {
    const p = String(url)
    const method = options.method || 'GET'
    const authH = (options.headers && options.headers.Authorization) || null
    if (authH) st.authHeaders.push(authH)
    if (p.endsWith('/data/rev')) {
      st.revCount++
      return { ok: true, status: 200, json: async () => ({ rev: st.cloudRev }) }
    }
    if (p.endsWith('/data') && method === 'PUT') {
      st.putCount++
      st.putBodies.push(options.body)
      if (st.conflictLeft > 0) {
        st.conflictLeft--
        return { ok: false, status: 409, json: async () => ({ error: '数据版本冲突' }) }
      }
      st.cloudRev++
      return { ok: true, status: 200, json: async () => ({ rev: st.cloudRev }) }
    }
    if (p.endsWith('/data')) {
      st.getCount++
      return { ok: true, status: 200, json: async () => ({ state_json: st.cloudState, rev: st.cloudRev }) }
    }
    return { ok: false, status: 404, json: async () => ({}) }
  }
  return st
}

function baseState() {
  return {
    subjects: { s1: { id: 's1', name: '科目一', chapterIds: ['c1'] } },
    chapters: { c1: { id: 'c1', name: '章一', questions: [] } },
    history: [],
    lastScreen: 'start',
    aiConfig: {},
  }
}

async function makeEngine(storage) {
  // v3.37.1 属主钉扎：模拟真实启动顺序（loadState 记录内存属主 = 播种的 qbao_user）
  if (globalThis.localStorage) { try { persistenceMod.loadState() } catch (e) { /* 忽略 */ } }
  const holder = { state: baseState() }
  let notified = []
  const engine = createSyncEngine({
    getState: () => holder.state,
    replaceState: (m) => { holder.state = m },
    isOnline: () => true,
    onStatus: () => {},
    notify: (msg) => notified.push(msg),
  })
  return { engine, holder, notified }
}

describe('sync keys 账号隔离 (P1.2)', () => {
  let storage
  beforeEach(() => {
    storage = makeLocalStorageStub({ qbao_token: 'tok', qbao_user: JSON.stringify({ id: 'u1', username: 'a' }) })
    globalThis.localStorage = storage
  })
  afterEach(() => { delete globalThis.localStorage })

  it('pending 标记按账号写入专属键，互不串扰', () => {
    setSyncPending(true)
    expect(storage.getItem('qbao_sync_pending_u_u1')).toBe('1')
    expect(storage.getItem('qbao_sync_pending')).toBeNull()
    // 切到 u2：看不到 u1 的 pending
    storage.setItem('qbao_user', JSON.stringify({ id: 'u2', username: 'b' }))
    expect(getSyncPending()).toBe(false)
    setSyncPending(true)
    expect(storage.getItem('qbao_sync_pending_u_u2')).toBe('1')
    // u1 遗留标记不被误清
    storage.setItem('qbao_user', JSON.stringify({ id: 'u1', username: 'a' }))
    expect(getSyncPending()).toBe(true)
    setSyncPending(false)
    expect(storage.getItem('qbao_sync_pending_u_u1')).toBeNull()
    expect(storage.getItem('qbao_sync_pending_u_u2')).toBe('1')
  })

  it('兼容旧版全局 pending 键（升级首启仍能补推）', () => {
    storage.removeItem('qbao_token')
    storage.removeItem('qbao_user')
    storage.setItem('qbao_sync_pending', '1')
    expect(getSyncPending()).toBe(true)
    // 登录后写新键 → 旧全局键被清除，防幽灵 pending
    storage.setItem('qbao_user', JSON.stringify({ id: 'u1' }))
    storage.setItem('qbao_token', 'tok')
    setSyncPending(true)
    expect(storage.getItem('qbao_sync_pending_u_u1')).toBe('1')
    expect(storage.getItem('qbao_sync_pending')).toBeNull()
  })
})

describe('createSyncEngine 写收敛 (P1.2)', () => {
  let storage
  beforeEach(() => {
    storage = makeLocalStorageStub({ qbao_token: 'tok', qbao_user: JSON.stringify({ id: 'u1', username: 'a' }) })
    globalThis.localStorage = storage
  })
  afterEach(() => { delete globalThis.localStorage; delete globalThis.fetch })

  it('空推跳过：内容未变的重复 flushSync 只产生一次 PUT', async () => {
    const fm = installFetchMock()
    const { engine } = await makeEngine(storage)
    engine.setSyncingReady(true)
    await engine.flushSync()
    expect(fm.putCount).toBe(1)
    // 无任何变化再 flush（轮询/可见性触发场景）→ 不再产生 PUT
    await engine.flushSync()
    await engine.flushSync()
    expect(fm.putCount).toBe(1)
    expect(getSyncPending()).toBe(false)
  })

  it('内容真实变化才触发下一次 PUT', async () => {
    const fm = installFetchMock()
    const { engine, holder } = await makeEngine(storage)
    engine.setSyncingReady(true)
    await engine.flushSync()
    expect(fm.putCount).toBe(1)
    // 本地作答变化（模拟答题保存）→ 推送
    holder.state.history.push({ id: 'h1', correct: 1 })
    await engine.flushSync()
    expect(fm.putCount).toBe(2)
    const pushed = JSON.parse(fm.putBodies[1])
    expect(pushed.state_json.history[0].id).toBe('h1')
    // 服务器 rev 前进后本地未变化 → 仍空推（轮询不产生写放大）
    await engine.flushSync()
    expect(fm.putCount).toBe(2)
  })

  it('启动门闩：就绪前不 PUT 且 pending 保留，就绪后补推一次', async () => {
    const fm = installFetchMock()
    const { engine, holder } = await makeEngine(storage)
    engine.setSyncingReady(false) // 模拟 boot：IDB 回填/云端恢复未完成
    holder.state.subjects.s1.name = '离线期间的修改'
    await engine.flushSync()
    expect(fm.putCount).toBe(0)
    expect(getSyncPending()).toBe(true)
    engine.setSyncingReady(true)
    await engine.resumePendingSync()
    expect(fm.putCount).toBe(1)
    const pushed = JSON.parse(fm.putBodies[0])
    expect(pushed.state_json.subjects.s1.name).toBe('离线期间的修改')
    expect(getSyncPending()).toBe(false)
  })

  it('rev 预检：云端有新写入 → 先拉全量合并（本地数据不丢）再带最新 rev 推送', async () => {
    const fm = installFetchMock({
      cloudRev: 7,
      cloudState: {
        subjects: {
          s1: { id: 's1', name: '科目一', chapterIds: ['c1'] },
          s9: { id: 's9', name: '另一台设备新增科目', chapterIds: [] },
        },
        chapters: { c1: { id: 'c1', name: '章一', questions: [] } },
        history: [],
        lastScreen: 'start',
        aiConfig: {},
      },
    })
    const { engine, holder } = await makeEngine(storage)
    engine.setRev(3) // 本地落后
    holder.state.subjects.s2 = { id: 's2', name: '本地新科目', chapterIds: [] }
    engine.setSyncingReady(true)
    await engine.flushSync()
    // 拉了一次云端，PUT 一次，payload 带云端最新 rev 且本地 s2 不丢
    expect(fm.getCount).toBe(1)
    expect(fm.putCount).toBe(1)
    const pushed = JSON.parse(fm.putBodies[0])
    expect(pushed.rev).toBe(7)
    expect(pushed.state_json.subjects.s2).toBeTruthy()
    expect(pushed.state_json.subjects.s9).toBeTruthy()
  })

  it('409 冲突：拉取 → 合并 → 以最新 rev 自动重推成功（toast 通知合并）', async () => {
    const fm = installFetchMock({
      cloudRev: 2,
      conflictPutCount: 1,
      cloudState: {
        subjects: { s1: { id: 's1', name: '科目一', chapterIds: ['c1'] } },
        chapters: {
          c1: {
            id: 'c1', name: '章一',
            questions: [{ id: 99, question: '云端并发出的题', type: 'single', options: ['a', 'b', 'c', 'd'], answer: 0, tag: 'x', strategy: 'new' }],
            userAnswers: [0],
            quizSets: [],
          },
        },
        history: [],
        lastScreen: 'start',
        aiConfig: {},
      },
    })
    const { engine, holder, notified } = await makeEngine(storage)
    engine.setRev(2)
    holder.state.chapters.c1.questions = [{ id: 1, question: '本地刚答的题', type: 'single', options: ['a', 'b', 'c', 'd'], answer: 1, tag: 'x', strategy: 'new' }]
    holder.state.chapters.c1.userAnswers = [1]
    engine.setSyncingReady(true)
    await engine.flushSync()
    // 第一次 PUT 409 → GET /data → 合并重推
    expect(fm.putCount).toBe(2)
    expect(fm.getCount).toBe(1)
    const pushed = JSON.parse(fm.putBodies[1])
    expect(pushed.rev).toBe(2)
    const qs = pushed.state_json.chapters.c1.questions.map((q) => q.question)
    expect(qs).toContain('本地刚答的题')
    expect(qs).toContain('云端并发出的题')
    expect(getSyncPending()).toBe(false)
    expect(notified.length).toBeGreaterThan(0)
    expect(notified.join('')).toContain('合并')
  })
})

describe('mergeStates', () => {
  it('本地优先标量、实体并集、历史按 id 去重', () => {
    const local = {
      currentSubjectId: 's2',
      lastScreen: 'start',
      subjects: { s2: { id: 's2', name: '本地', chapterIds: ['c1'] } },
      chapters: { c1: { id: 'c1', name: '章节1', questions: [] } },
      history: [{ id: 'h1' }, { id: 'h2' }]
    }
    const cloud = {
      currentSubjectId: 's1',
      lastScreen: 'history',
      subjects: { s1: { id: 's1', name: '云端', chapterIds: [] }, s2: { id: 's2', name: '旧', chapterIds: [] } },
      chapters: { c9: { id: 'c9', name: '云端独有', questions: [] } },
      history: [{ id: 'h1' }, { id: 'h9' }]
    }
    const m = mergeStates(local, cloud).state
    expect(m.currentSubjectId).toBe('s2')
    expect(m.subjects.s1).toBeTruthy()
    expect(m.subjects.s2.name).toBe('本地')
    expect(m.chapters.c1).toBeTruthy()
    expect(m.chapters.c9).toBeTruthy()
    expect(m.history.map((h) => h.id)).toEqual(['h1', 'h9', 'h2'])
  })

  it('章节级并集：多端并发出题不丢失任何一端题目', () => {
    const qA = { id: 1, question: 'A题目', type: 'single', options: ['a', 'b', 'c', 'd'], answer: 0, tag: 'x', strategy: 'new', explanation: '' }
    const qB = { id: 1, question: 'B题目', type: 'single', options: ['a', 'b', 'c', 'd'], answer: 1, tag: 'x', strategy: 'new', explanation: '' }
    const local = {
      chapters: {
        c1: {
          id: 'c1', name: '章节1',
          questions: [qA],
          userAnswers: [0],
          quizSets: [{ questions: [qA], userAnswers: [0], currentIdx: 0, createdAt: 1 }],
          currentQuizSetIdx: 0
        }
      }
    }
    const cloud = {
      chapters: {
        c1: {
          id: 'c1', name: '章节1',
          questions: [qB],
          userAnswers: [1],
          quizSets: [{ questions: [qB], userAnswers: [1], currentIdx: 0, createdAt: 2 }],
          currentQuizSetIdx: 0
        }
      }
    }
    const result = mergeStates(local, cloud)
    const m = result.state
    const ch = m.chapters.c1
    // 题库并集：两端题目都在，本地答案保留
    expect(ch.questions.map((q) => q.question).sort()).toEqual(['A题目', 'B题目'])
    expect(ch.quizSets.length).toBe(2)
    // 本地答案保留
    expect(ch.userAnswers[ch.questions.findIndex((q) => q.question === 'A题目')]).toBe(0)
    // 冲突新增数 = 合并后 - 云端原数量（云端 1 + quizSets 1 → 题库 2 + sets 2 = 4；before=2）
    expect(result.conflictAddedCount).toBe(2)
  })

  it('网页端旧缓存 + 云端桌面端新题：合并后能看到新章节（启动拉取场景）', () => {
    const q1 = { question: '桌面端生成的题', type: 'single', options: ['a', 'b', 'c', 'd'], answer: 1, tag: '网络', strategy: 'new' }
    const q2 = { question: '网页端本地旧题', type: 'single', options: ['a', 'b', 'c', 'd'], answer: 0, tag: '基础', strategy: 'new' }
    const local = {
      subjects: { s1: { id: 's1', name: '旧科目', chapterIds: ['c1'] } },
      chapters: { c1: { id: 'c1', name: '旧章节', questions: [q2], userAnswers: [0], quizSets: [] } },
      history: []
    }
    const cloud = {
      subjects: {
        s1: { id: 's1', name: '旧科目', chapterIds: ['c1'] },
        s2: { id: 's2', name: '桌面新科目', chapterIds: ['c2'] }
      },
      chapters: {
        c1: { id: 'c1', name: '旧章节', questions: [q1, q2], userAnswers: [0, 0], quizSets: [] },
        c2: { id: 'c2', name: '桌面新章节', questions: [q1], userAnswers: [0], quizSets: [] }
      },
      history: []
    }
    const m = mergeStates(local, cloud).state
    expect(m.subjects.s2).toBeTruthy()
    expect(m.chapters.c2).toBeTruthy()
    expect(m.chapters.c1.questions.length).toBe(2)
    expect(m.chapters.c1.questions.some((q) => q.question === '桌面端生成的题')).toBe(true)
    expect(m.chapters.c1.questions.some((q) => q.question === '网页端本地旧题')).toBe(true)
  })

  it('推送前合并：云端有桌面端新题时，本地旧状态推送不丢失云端题目（pull-before-push 场景）', () => {
    const cloudQ = { question: '桌面端新题', type: 'single', options: ['a', 'b', 'c', 'd'], answer: 0, tag: 'x', strategy: 'new' }
    const localQ = { question: '本地已修改旧题', type: 'single', options: ['a', 'b', 'c', 'd'], answer: 0, tag: 'x', strategy: 'new' }
    // 本地状态 = 网页端旧缓存（不含桌面端新题）
    const local = {
      chapters: { c1: { id: 'c1', name: '章节1', questions: [localQ], userAnswers: [0], quizSets: [] } }
    }
    // 云端 = 桌面端推送后的最新状态
    const cloud = {
      chapters: { c1: { id: 'c1', name: '章节1', questions: [localQ, cloudQ], userAnswers: [0, 1], quizSets: [] } }
    }
    const m = mergeStates(local, cloud).state
    // 合并后推送的必然是包含云端题目的并集 → 云端题不被覆盖丢
    expect(m.chapters.c1.questions.map((q) => q.question).sort()).toEqual(['本地已修改旧题', '桌面端新题'])
    expect(m.chapters.c1.userAnswers).toHaveLength(2)
  })

  it('T9 chapterMaterials 章节级并集：多端资料元数据不丢、按 id 去重', () => {
    const local = {
      chapterMaterials: {
        c1: [
          { id: 'pool_1', name: '本地池文件A.pdf', size: 10, addedAt: 1, _poolFile: true },
          { id: 'upload_2', name: '本地上传B.docx', size: 20, addedAt: 2 },
        ],
      },
    }
    const cloud = {
      chapterMaterials: {
        c1: [
          { id: 'pool_1', name: '云端池文件A.pdf', size: 10, addedAt: 1, _poolFile: true },
          { id: 'pool_9', name: '云端池文件C.pptx', size: 30, addedAt: 3, _poolFile: true },
        ],
        c2: [{ id: 'pool_1', name: '同一池文件分配到另一章节', size: 10, addedAt: 1, _poolFile: true }],
      },
    }
    const m = mergeStates(local, cloud).state
    // c1：云端在前、本地补漏，pool_1 去重保留云端条目
    expect(m.chapterMaterials.c1.map((x) => x.id)).toEqual(['pool_1', 'pool_9', 'upload_2'])
    // c2 只有云端
    expect(m.chapterMaterials.c2.map((x) => x.id)).toEqual(['pool_1'])
    // 同一 id 出现在不同章节 → 两章都保留（章节内去重，非全局）
    expect(m.chapterMaterials.c1[0].id).toBe('pool_1')
    expect(m.chapterMaterials.c2[0].id).toBe('pool_1')
  })

  it('T9 本地独有的章节资料在合并后保留（云端无 chapterMaterials 时）', () => {
    const local = {
      chapterMaterials: { c1: [{ id: 'upload_7', name: '本地独有.txt', size: 5, addedAt: 4 }] },
    }
    const cloud = { chapters: {} }
    const m = mergeStates(local, cloud).state
    expect(m.chapterMaterials.c1).toHaveLength(1)
    expect(m.chapterMaterials.c1[0].id).toBe('upload_7')
  })
})

describe('多端并发出题/答题合并 (round4)', () => {
  const q = (text, ans) => ({ question: text, type: 'single', options: ['a','b','c','d'], answer: ans })

  it('同轮次多端各自作答：mergeQuizSets 按题并集，任何一侧已答都不丢', () => {
    const local = {
      subjects: {}, chapters: {
        c1: {
          id: 'c1', name: '章一', questions: [q('Q1',0), q('Q2',1), q('Q3',2), q('Q4',3)],
          userAnswers: [0, undefined, 2, undefined], currentIdx: 0,
          quizSets: [{ questions: [q('Q1',0), q('Q2',1), q('Q3',2), q('Q4',3)], userAnswers: [0, undefined, 2, undefined], currentIdx: 1, createdAt: 1 }],
        },
      }, history: [], lastScreen: 'start', aiConfig: {},
    }
    const cloud = {
      subjects: {}, chapters: {
        c1: {
          id: 'c1', name: '章一', questions: [q('Q1',0), q('Q2',1), q('Q3',2), q('Q4',3)],
          userAnswers: [undefined, 1, undefined, 3], currentIdx: 0,
          quizSets: [{ questions: [q('Q1',0), q('Q2',1), q('Q3',2), q('Q4',3)], userAnswers: [undefined, 1, undefined, 3], currentIdx: 2, createdAt: 1 }],
        },
      }, history: [], lastScreen: 'start', aiConfig: {},
    }
    const m = mergeStates(local, cloud).state
    const set = m.chapters.c1.quizSets[0]
    // 并集：本地答的 Q1/Q3 + 云端答的 Q2/Q4 全部保留
    expect(set.userAnswers).toEqual([0, 1, 2, 3])
    // 题库答案同步对齐
    expect(m.chapters.c1.userAnswers).toEqual([0, 1, 2, 3])
  })

  it('同轮次去重合并后题库答案按题干对齐（池去重 ≠ 轮次和的场景）', () => {
    // 云端池去重后 [A,B,C]；云端两轮：{A,B} 已答 B、{C} 已答 C；
    // 本地同轮 {A,B} 已答 A → 合并后：池 3 题，答案按题干对齐为 [A:0, B:1, C:2]
    const local = {
      subjects: {}, chapters: {
        c1: {
          id: 'c1', name: '章一',
          questions: [q('A',0), q('B',1), q('A',0), q('C',2)],
          userAnswers: [0, undefined, undefined, undefined], currentIdx: 0,
          quizSets: [{ questions: [q('A',0), q('B',1)], userAnswers: [0, undefined], currentIdx: 0, createdAt: 1 }],
        },
      }, history: [], lastScreen: 'start', aiConfig: {},
    }
    const cloud = {
      subjects: {}, chapters: {
        c1: {
          id: 'c1', name: '章一',
          questions: [q('A',0), q('B',1), q('C',2)],
          userAnswers: [undefined, 1, 2], currentIdx: 0,
          quizSets: [
            { questions: [q('A',0), q('B',1)], userAnswers: [undefined, 1], currentIdx: 1, createdAt: 1 },
            { questions: [q('C',2)], userAnswers: [2], currentIdx: 0, createdAt: 2 },
          ],
        },
      }, history: [], lastScreen: 'start', aiConfig: {},
    }
    const m = mergeStates(local, cloud).state
    const ch = m.chapters.c1
    expect(ch.questions.map((x) => x.question)).toEqual(['A', 'B', 'C'])
    // 池按文本对齐：A←本地轮 0（云端该题未答）；B←云端 1；C←云端第二轮 2
    expect(ch.userAnswers).toEqual([0, 1, 2])
    // {A,B} 轮合并为 1 轮（答案并集 [0,1]），{C} 轮独立保留
    expect(ch.quizSets).toHaveLength(2)
    expect(ch.quizSets[0].userAnswers).toEqual([0, 1])
    expect(ch.quizSets[1].questions.map((x) => x.question)).toEqual(['C'])
  })

  it('本地未答、云端已答 → 合并后仍显示云端答案（进度不倒退）', () => {
    const local = {
      subjects: {}, chapters: {
        c1: {
          id: 'c1', name: '章一', questions: [q('A',0), q('B',1)],
          userAnswers: [undefined, undefined], currentIdx: 0,
          quizSets: [{ questions: [q('A',0), q('B',1)], userAnswers: [undefined, undefined], currentIdx: 0, createdAt: 1 }],
        },
      }, history: [], lastScreen: 'start', aiConfig: {},
    }
    const cloud = {
      subjects: {}, chapters: {
        c1: {
          id: 'c1', name: '章一', questions: [q('A',0), q('B',1)],
          userAnswers: [0, 1], currentIdx: 0,
          quizSets: [{ questions: [q('A',0), q('B',1)], userAnswers: [0, 1], currentIdx: 0, createdAt: 1 }],
        },
      }, history: [], lastScreen: 'start', aiConfig: {},
    }
    const m = mergeStates(local, cloud).state
    expect(m.chapters.c1.quizSets[0].userAnswers).toEqual([0, 1])
    expect(m.chapters.c1.userAnswers).toEqual([0, 1])
  })
})

describe('aiTaskQueue 合并 (round4.1)', () => {
  it('同 id 本地优先（恢复/失败决策不被云端旧状态回滚），云端独有任务并入', () => {
    const mk = (id, status, extra = {}) => ({ id, chapterId: 'c1', chapterName: '章一', status, promptText: 'p', materialNames: [], strategySnapshot: null, createdAt: 1, completedAt: null, questionCount: 0, error: '', streamQuestionCount: 0, ...extra })
    const local = {
      subjects: {}, chapters: {}, history: [], lastScreen: 'start', aiConfig: {},
      aiTaskQueue: [
        mk('t1', 'failed', { error: '出题过程中页面被刷新，本轮已取消，请重新点击「开始出题」' }), // 本地已裁决失败
        mk('t3', 'pending'), // 本地新建未推送
      ],
    }
    const cloud = {
      subjects: {}, chapters: {}, history: [], lastScreen: 'start', aiConfig: {},
      aiTaskQueue: [
        mk('t1', 'running'),  // 云端旧状态：仍 running
        mk('t2', 'completed'), // 云端独有（其他设备）
      ],
    }
    const m = mergeStates(local, cloud).state
    const byId = Object.fromEntries(m.aiTaskQueue.map((t) => [t.id, t]))
    // t1 本地失败状态保留，不被云端 running 回滚
    expect(byId.t1.status).toBe('failed')
    expect(byId.t1.error).toContain('页面被刷新')
    // t2/t3 各自并入
    expect(byId.t2.status).toBe('completed')
    expect(byId.t3.status).toBe('pending')
    expect(m.aiTaskQueue).toHaveLength(3)
    // 云端在前、本地补入的次序（t1 原位保留、t3 追加）
    expect(m.aiTaskQueue.map((t) => t.id)).toEqual(['t1', 't2', 't3'])
  })
})


describe('subjects 合并 chapterIds 并集 (round5)', () => {
  it('本地旧骨架缺新章节 → 并集保留云端章节，不整体回退', () => {
    const cloud = {
      subjects: { s1: { id: 's1', name: '科目一', collapsed: false, chapterIds: ['c1', 'c2'] } },
      chapters: { c1: { id: 'c1', questions: [] }, c2: { id: 'c2', questions: [] } },
      generatedExams: {},
    }
    const local = {
      subjects: { s1: { id: 's1', name: '科目一', collapsed: true, chapterIds: ['c1'] } },
      chapters: { c1: { id: 'c1', questions: [] } },
      generatedExams: {},
    }
    const m = mergeStates(local, cloud).state
    expect(m.subjects.s1.chapterIds).toEqual(['c1', 'c2'])
    // 本地操作字段（collapsed）仍本地优先
    expect(m.subjects.s1.collapsed).toBe(true)
    expect(m.subjects.s1.name).toBe('科目一')
  })

  it('本地新建章节（云端还没有）→ 并集保留本地章节', () => {
    const cloud = { subjects: { s1: { id: 's1', name: '科目一', chapterIds: ['c1'] } }, chapters: {}, generatedExams: {} }
    const local = { subjects: { s1: { id: 's1', name: '科目一', chapterIds: ['c1', 'c2'] } }, chapters: {}, generatedExams: {} }
    const m = mergeStates(local, cloud).state
    expect(m.subjects.s1.chapterIds).toEqual(['c1', 'c2'])
  })

  it('云端独有科目保留', () => {
    const cloud = { subjects: { s1: { id: 's1', chapterIds: ['c1'] }, s2: { id: 's2', chapterIds: ['c3'] } }, chapters: {}, generatedExams: {} }
    const local = { subjects: { s1: { id: 's1', chapterIds: ['c1'] } }, chapters: {}, generatedExams: {} }
    const m = mergeStates(local, cloud).state
    expect(Object.keys(m.subjects).sort()).toEqual(['s1', 's2'])
  })
})


describe('quizSets 轮次删除墓碑 aiTombstones (round5.1)', () => {
  function q(t, type = 'single', answer = 0, opts) {
    return { question: t, type, answer, options: ['A', 'B', 'C', 'D'], tag: 'x', ...(opts || {}) }
  }
  const setA = { questions: [q('A1'), q('A2'), q('A3')], userAnswers: [0, 1, 2], currentIdx: 0, createdAt: 1 }
  const setB = { questions: [q('B1'), q('B2'), q('B3')], userAnswers: [undefined, 1, 2], currentIdx: 0, createdAt: 2 }
  const setC = { questions: [q('C1'), q('C2'), q('C3')], userAnswers: [0, 1, 2], currentIdx: 0, createdAt: 3 }
  const sigB = setB.questions.map((x) => JSON.stringify([x.question, x.type, x.answer, (x.options || []).join('|')])).join('\u0001')
  const ctx = (caps, sets, tombstones) => ({
    subjects: { s1: { id: 's1', name: '科目', chapterIds: ['c1'] } },
    chapters: { c1: { id: 'c1', name: '章', quizSets: sets, questions: [], userAnswers: [] } },
    generatedExams: {},
    aiTombstones: tombstones || [],
    history: [],
  })

  it('墓碑命中：云端副本被丢弃（他端删除的轮次不再保留）', () => {
    const cloud = ctx({}, [setA, setB, setC], [{ cid: 'c1', sig: sigB, ts: 1 }])
    const local = ctx({}, [setA, setB, setC], [])
    const m = mergeStates(local, cloud).state
    expect(m.chapters.c1.quizSets.map((x) => x.questions[0].question)).toEqual(['A1', 'C1'])
  })

  it('墓碑命中：本地副本同样被丢弃（删除方在另一端，本端合并后不再复活并推送）', () => {
    const cloud = ctx({}, [setA, setC], [])
    const local = ctx({}, [setA, setB, setC], [{ cid: 'c1', sig: sigB, ts: 1 }])
    const m = mergeStates(local, cloud).state
    expect(m.chapters.c1.quizSets.map((x) => x.questions[0].question)).toEqual(['A1', 'C1'])
  })

  it('墓碑并集：云端/本地两侧墓碑合并保留（去重 + 上限 100）', () => {
    const cloud = ctx({}, [setA], [{ cid: 'c1', sig: sigB, ts: 1 }])
    const local = ctx({}, [setA], [{ cid: 'c1', sig: sigB, ts: 2 }, { cid: 'c1', sig: 'sig-' + sigB.slice(0, 20), ts: 3 }])
    const m = mergeStates(local, cloud).state
    expect(m.aiTombstones).toHaveLength(2)
    // 上限：101 条 → 只留 100
    const many = []
    for (let i = 0; i < 101; i++) many.push({ cid: 'c1', sig: 's' + i, ts: i })
    const m2 = mergeStates(ctx({}, [setA], many), ctx({}, [setA], [])).state
    expect(m2.aiTombstones.length).toBe(100)
  })

  it('无墓碑时行为不变（回归）', () => {
    const cloud = ctx({}, [setA, setC], [])
    const local = ctx({}, [setA, setB], [])
    const m = mergeStates(local, cloud).state
    expect(m.chapters.c1.quizSets.map((x) => x.questions[0].question)).toEqual(['A1', 'C1', 'B1'])
  })
})

describe('引擎账号守卫 (v3.36.1)', () => {
  let storage
  let fetchSt
  beforeEach(() => {
    storage = makeLocalStorageStub({ qbao_token: 'tok', qbao_user: JSON.stringify({ id: 'u1', username: 'a' }) })
    globalThis.localStorage = storage
    fetchSt = installFetchMock({ cloudState: { state_json: JSON.stringify(baseState()), rev: 0 } })
  })
  afterEach(() => { delete globalThis.localStorage; delete globalThis.fetch })

  it('切换冻结期（setAccountSwitching）→ 推送/拉取/轮询全部停摆，不发任何请求', async () => {
    const holder = { state: baseState() }
    const engine = createSyncEngine({
      getState: () => holder.state,
      replaceState: (m) => { holder.state = m },
      isOnline: () => true,
      onStatus: () => {},
      notify: () => {},
      accountId: () => 'u1', // 引擎武装账号 u1
    })
    engine.setSyncingReady(true)
    setSyncPending(true)
    setAccountSwitching(true)
    engine.scheduleSync()
    await engine.flushSync()
    await engine.resumePendingSync()
    expect(fetchSt.putCount).toBe(0)
    expect(fetchSt.getCount).toBe(0)
    expect(fetchSt.revCount).toBe(0)
    setAccountSwitching(false)
    await engine.flushSync()
    expect(fetchSt.putCount + fetchSt.getCount + fetchSt.revCount).toBeGreaterThan(0)
  })

  it('数据属主变化（无冻结标志）→ 引擎停摆（防御未触发 reload 的路径）', async () => {
    const holder = { state: baseState() }
    let owner = 'u1'
    const engine = createSyncEngine({
      getState: () => holder.state,
      replaceState: (m) => { holder.state = m },
      isOnline: () => true,
      onStatus: () => {},
      notify: () => {},
      accountId: () => owner,
    })
    engine.setSyncingReady(true)
    setSyncPending(true)
    owner = 'u2' // 属主漂移（理论上由 reload 重建，这里模拟任何遗漏路径）
    await engine.flushSync()
    expect(fetchSt.putCount).toBe(0)
    expect(fetchSt.getCount).toBe(0)
  })
})
describe('v3.37.1 多标签页账号钉扎', () => {
  let storage
  beforeEach(() => {
    storage = makeLocalStorageStub({ qbao_token: 'tok', qbao_user: JSON.stringify({ id: 'u1', username: 'a' }) })
    globalThis.localStorage = storage
    persistenceMod.loadState() // 属主 = u1
    pinToken('PIN_TOK_U1')
  })
  afterEach(() => { delete globalThis.localStorage; delete globalThis.fetch; unpinToken() })

  it('persistMergedState 落盘取内存属主（其他标签页已切账号也不写新键）', () => {
    storage.setItem('qbao_user', JSON.stringify({ id: 'u2', username: 'b' }))
    const merged = { subjects: { s9: { id: 's9', name: '合并数据' } }, chapters: {}, history: [] }
    persistMergedState(merged)
    expect(storage.getItem('quizEngineState_cloud_u1')).toContain('合并数据')
    expect(storage.getItem('quizEngineState_cloud_u2')).toBeNull()
  })

  it('引擎请求携带钉扎令牌（活读令牌被其他标签页替换也不漂移）', async () => {
    const fm = installFetchMock()
    const { engine } = await makeEngine(storage)
    storage.setItem('qbao_token', 'OTHER_TAB_TOKEN')
    engine.setSyncingReady(true)
    await engine.flushSync()
    expect(fm.putCount).toBe(1)
    expect(fm.authHeaders.length).toBeGreaterThan(0)
    expect(fm.authHeaders.every((h) => h === 'Bearer PIN_TOK_U1')).toBe(true)
  })

  it('拉取合并后本地骨架写属主键（跨标签页场景）', async () => {
    installFetchMock({ cloudState: { subjects: { s8: { id: 's8', name: '云端科目' } }, chapters: {}, history: [] }, cloudRev: 3 })
    const { engine } = await makeEngine(storage)
    storage.setItem('qbao_user', JSON.stringify({ id: 'u2', username: 'b' }))
    engine.setSyncingReady(true)
    await engine.pullAndMerge()
    expect(storage.getItem('quizEngineState_cloud_u1')).toBeTruthy()
    expect(storage.getItem('quizEngineState_cloud_u2')).toBeNull()
  })
})
