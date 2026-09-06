import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// T12: saveState 写失败可见化 + 体积预警 + 瞬态字段恢复
// （node 环境无 localStorage，用内存 stub 模拟）

function makeLocalStorageStub() {
  const map = new Map()
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)) },
    removeItem: (k) => { map.delete(k) },
    _map: map,
  }
}

describe('persistence.saveState (T12)', () => {
  let storage
  let hooks
  let mod

  beforeEach(() => {
    storage = makeLocalStorageStub()
    globalThis.localStorage = storage
    hooks = []
    // 每次重新加载模块（模块级 _persistWarn 状态隔离）
    vi.resetModules()
    // v3.36.1 登录门禁：持久化只在登录账号下生效（匿名拒绝），用例统一播种账号
    storage.setItem('qbao_user', JSON.stringify({ id: 7, username: 'a' }))
    return import('./persistence').then((m) => {
      mod = m
      m.setPersistWarningHook((msg, fatal) => hooks.push({ msg, fatal }))
      // v3.37.1 写盘键 = 内存数据属主：按真实启动顺序先 loadState 播种属主
      m.loadState()
    })
  })

  it('正常写入且恢复瞬态字段；v3.30 骨架化：落盘不含题目大字段', () => {
    const state = {
      quizSession: { questions: [] },
      chapterMaterials: { c1: [{ id: 'm1', name: 'a.pdf', data: 'BIGBLOB' }] },
      aiTaskQueue: [{ id: 't1', status: 'running', streamSetRef: { x: 1 } }],
      subjects: { s1: { id: 's1', name: '科目' } },
      chapters: {
        c1: { id: 'c1', name: '章节', strategy: { errPct: 20 }, questions: [{ id: 1, question: 'Q1' }], userAnswers: [0], quizSets: [] },
      },
      history: [{ id: 'h1', correct: 1 }],
    }
    const res = mod.saveState(state)
    expect(res.ok).toBe(true)
    // 瞬态字段恢复
    expect(state.quizSession).toEqual({ questions: [] })
    expect(state.aiTaskQueue[0].streamSetRef).toEqual({ x: 1 })
    expect(state.chapterMaterials.c1[0].data).toBe('BIGBLOB')
    // 落盘 = 骨架：不含题目/答案/quizSets/history/srsData，保留章节元数据
    const saved = JSON.parse(storage.getItem(mod.CLOUD_STORAGE_PREFIX + '7'))
    expect(saved.chapters.c1.questions).toBeUndefined()
    expect(saved.chapters.c1.userAnswers).toBeUndefined()
    expect(saved.chapters.c1.quizSets).toBeUndefined()
    expect(saved.chapters.c1.strategy.errPct).toBe(20)
    expect(saved.history).toBeUndefined()
    expect(saved.srsData).toBeUndefined()
    expect(saved.subjects.s1.name).toBe('科目')
    expect(saved.chapterMaterials.c1[0].data).toBeUndefined()
    expect(saved.quizSession).toBeNull()
    // 未登录时只写主键
    expect(storage.getItem(mod.CLOUD_STORAGE_PREFIX + '7')).toBeTruthy()
  })

  it('活动会话同步持久化：答题进度刷新/关闭不丢（修复答题入口消失）', async () => {
    const state = {
      currentChapterId: 'c1',
      chapters: {
        c1: {
          id: 'c1', name: '章1', strategy: { errPct: 20 },
          questions: [{ id: 1, question: 'Q1' }, { id: 2, question: 'Q2' }],
          userAnswers: [0, undefined],
          currentQuizSetIdx: 0,
          quizSets: [{
            questions: [{ id: 1, question: 'Q1' }, { id: 2, question: 'Q2' }],
            userAnswers: [0, undefined],
            currentIdx: 1,
            createdAt: 123,
          }],
        },
      },
      subjects: {},
    }
    mod.saveState(state)
    // 活动会话键已写入
    const raw = storage.getItem('qbao_active_session_u_7')
    expect(raw).toBeTruthy()
    const session = JSON.parse(raw)
    expect(session.cid).toBe('c1')
    expect(session.qsIdx).toBe(0)
    expect(session.userAnswers).toEqual([0, null]) // undefined → null（JSON 序列化）
    // 用骨架 state（无 quizSets）+ 活动会话键 → hydrate 回填答题入口
    const skeletonState = { currentChapterId: 'c1', chapters: { c1: { id: 'c1', name: '章1', strategy: { errPct: 20 } } }, subjects: {} }
    await mod.hydrateState(skeletonState)
    expect(skeletonState.chapters.c1.quizSets).toHaveLength(1)
    expect(skeletonState.chapters.c1.quizSets[0].questions).toHaveLength(2)
    // null → undefined：未答题目不能被统计为已答
    expect(skeletonState.chapters.c1.quizSets[0].userAnswers).toEqual([0, undefined])
    expect(skeletonState.chapters.c1.quizSets[0].currentIdx).toBe(1)
    expect(skeletonState.chapters.c1.currentQuizSetIdx).toBe(0)
    // 会话已存在时：活动会话覆盖答案/进度（IDB 数据可能旧）
    skeletonState.chapters.c1.quizSets[0].userAnswers = [undefined, undefined]
    storage.setItem('qbao_active_session_u_7', JSON.stringify({ cid: 'c1', qsIdx: 0, questions: [{ id: 1 }, { id: 2 }], userAnswers: [1, null], currentIdx: 1 }))
    await mod.hydrateState(skeletonState)
    expect(skeletonState.chapters.c1.quizSets[0].userAnswers).toEqual([1, undefined])
    expect(skeletonState.chapters.c1.quizSets[0].currentIdx).toBe(1)
  })

  it('hasBigFields 能识别含题目/历史的大状态（旧数据迁移判定）', () => {
    expect(mod.hasBigFields({ chapters: { c1: { questions: [1, 2] } } })).toBe(true)
    expect(mod.hasBigFields({ chapters: { c1: { name: 'x' } } })).toBe(false)
    expect(mod.hasBigFields({ history: [1] })).toBe(true)
    expect(mod.hasBigFields({ srsData: { a: 1 } })).toBe(false)
    expect(mod.hasBigFields({ chapters: {} })).toBe(false)
  })

  it('QuotaExceededError → 可见告警 + ok:false，内存状态仍完整', () => {
    const state = { subjects: { s1: { id: 's1' } }, quizSession: { q: 1 } }
    storage.setItem = () => { const e = new Error('quota'); e.name = 'QuotaExceededError'; throw e }
    const res = mod.saveState(state)
    expect(res.ok).toBe(false)
    expect(hooks.length).toBeGreaterThan(0)
    expect(hooks[0].fatal).toBe(true)
    expect(hooks[0].msg).toContain('存储空间已满')
    // 瞬态字段仍恢复
    expect(state.quizSession).toEqual({ q: 1 })
  })

  it('超过 5MB 硬上限 → 不写盘、告警 ok:false', () => {
    const state = { subjects: { s1: { id: 's1', big: 'x'.repeat(5 * 1024 * 1024) } } }
    const res = mod.saveState(state)
    expect(res.ok).toBe(false)
    expect(hooks.some((h) => h.fatal && h.msg.includes('存储已满'))).toBe(true)
    expect(storage.getItem(mod.CLOUD_STORAGE_PREFIX + '7')).toBeNull()
  })

  it('账号隔离：已登录时只读写账号键，绝不回退公共键（防串号）', () => {
    // 公共键里残留上一个账号的数据
    storage.setItem(mod.STORAGE_KEY, JSON.stringify({ subjects: { s1: { id: 's1', name: '主账号数据' } }, chapters: {} }))
    // 模拟已登录用户 A（id=7）
    storage.setItem('qbao_user', JSON.stringify({ id: 7, username: 'aaa' }))
    const st = mod.loadState()
    // 不读取公共键 → 空默认状态（而非主账号数据）
    expect(st.subjects.s1).toBeUndefined()
    expect(st.subjects).toEqual({})
    // 保存只写账号键，不写公共键
    const state = { subjects: { s2: { id: 's2', name: 'A 的数据' } }, chapterMaterials: {}, aiTaskQueue: [] }
    mod.saveState(state)
    expect(storage.getItem(mod.STORAGE_KEY)).toContain('主账号数据') // 公共键未被覆盖
    expect(JSON.parse(storage.getItem(mod.CLOUD_STORAGE_PREFIX + '7')).subjects.s2.name).toBe('A 的数据')
    // 再读：账号键优先
    expect(mod.loadState().subjects.s2.name).toBe('A 的数据')
  })

  it('超过 4MB 预警线 → 非致命告警，但仍正常写盘', () => {
    const state = { subjects: { s1: { id: 's1', big: 'x'.repeat(4.2 * 1024 * 1024) } } }
    const res = mod.saveState(state)
    expect(res.ok).toBe(true)
    expect(hooks.some((h) => !h.fatal && h.msg.includes('接近上限'))).toBe(true)
    expect(storage.getItem(mod.CLOUD_STORAGE_PREFIX + '7')).toBeTruthy()
  })
  it('v3.37.1 跨标签页串号根治：saveState 写盘目标 = 内存属主，活读账号变化不影响', () => {
    // 本页启动属主 u1(7)（beforeEach 已 loadState）
    const state = { subjects: { s1: { id: 's1', name: '本页旧账号数据' } }, chapterMaterials: {}, aiTaskQueue: [] }
    // 模拟其他标签页已把档案登录态切到别的账号（活读 getUserStored 会拿到它）
    storage.setItem('qbao_user', JSON.stringify({ id: 2, username: 'other' }))
    const res = mod.saveState(state)
    expect(res.ok).toBe(true)
    // 写入仍是本页属主 7 的键，绝不写其他账号键（旧 bug：写入 quizEngineState_cloud_2）
    expect(storage.getItem('quizEngineState_cloud_7')).toContain('本页旧账号数据')
    expect(storage.getItem('quizEngineState_cloud_2')).toBeNull()
  })

  it('v3.37.1 活动会话镜像键取内存属主（跨标签页不写新账号键）', () => {
    const state = {
      currentChapterId: 'c1',
      chapters: {
        c1: {
          id: 'c1', name: '章1', strategy: { errPct: 20 },
          questions: [{ id: 1, question: 'Q1' }], userAnswers: [0], currentQuizSetIdx: 0,
          quizSets: [{ questions: [{ id: 1, question: 'Q1' }], userAnswers: [0], currentIdx: 0, createdAt: 1 }],
        },
      },
      subjects: {},
    }
    storage.setItem('qbao_user', JSON.stringify({ id: 2, username: 'other' }))
    expect(mod.saveState(state).ok).toBe(true)
    expect(storage.getItem('qbao_active_session_u_7')).toBeTruthy()
    expect(storage.getItem('qbao_active_session_u_2')).toBeNull()
  })

  it('v3.37.1 isAccountStorageCrossChange：跨标签页账号变化判定（纯函数）', () => {
    expect(mod.isAccountStorageCrossChange({ key: 'qbao_user', newValue: JSON.stringify({ id: 'u2' }) }, 'u1')).toBe(true)
    expect(mod.isAccountStorageCrossChange({ key: 'qbao_user', newValue: JSON.stringify({ id: 'u1' }) }, 'u1')).toBe(false)
    expect(mod.isAccountStorageCrossChange({ key: 'qbao_user', newValue: null }, 'u1')).toBe(true)
    expect(mod.isAccountStorageCrossChange({ key: 'qbao_user', newValue: JSON.stringify({ id: 'u2' }) }, null)).toBe(true)
    expect(mod.isAccountStorageCrossChange({ key: 'qbao_user', newValue: null }, null)).toBe(false)
    expect(mod.isAccountStorageCrossChange({ key: 'other_key', newValue: 'x' }, 'u1')).toBe(false)
    expect(mod.isAccountStorageCrossChange({ key: 'qbao_user', newValue: '{bad json' }, 'u1')).toBe(true)
  })

})

describe('登录门禁：未登录拒绝读写 (v3.36.1)', () => {
  let storage
  let hooks
  let mod

  beforeEach(async () => {
    storage = makeLocalStorageStub()
    globalThis.localStorage = storage
    hooks = []
    vi.resetModules()
    mod = await import('./persistence')
    mod.setPersistWarningHook((msg, fatal) => hooks.push({ msg, fatal }))
  })
  afterEach(() => { delete globalThis.localStorage })

  it('未登录时 loadState 返回空态，绝不读取公共键（拒绝匿名数据参与业务）', () => {
    // 预置“历史匿名数据”（旧版公共键残留）——必须被无视
    storage.setItem(mod.STORAGE_KEY, JSON.stringify({ subjects: { s1: { id: 's1', name: '匿名数据' } }, chapters: {} }))
    const st = mod.loadState()
    expect(st.subjects.s1).toBeUndefined()
    expect(st.chapters).toEqual({})
    expect(mod.getStateOwnerUid()).toBeNull()
  })

  it('未登录时 saveState 拒绝落盘（公共键/账号键/镜像键一律不写）', () => {
    const state = { subjects: { s1: { id: 's1', name: 'X' } }, chapters: {}, quizSession: { q: 1 } }
    const res = mod.saveState(state)
    expect(res.ok).toBe(false)
    expect(storage.getItem(mod.STORAGE_KEY)).toBeNull()
    expect(storage.getItem(mod.CLOUD_STORAGE_PREFIX + '7')).toBeNull()
    expect(storage.getItem('qbao_active_session_u_7')).toBeNull()
    expect(storage._map.size).toBe(0) // 全程无任何写入副作用
    expect(state.quizSession).toEqual({ q: 1 }) // 瞬态字段仍恢复
  })

  it('v3.37.1 属主为 null（门禁态）时 saveState 拒绝，即使档案残留账号键', () => {
    // 异常档案：无属主但 qbao_user 存在 → 一律不写、打匿名改动标（防伪造账号键）
    storage.setItem('qbao_user', JSON.stringify({ id: 7, username: 'a' }))
    const state = { subjects: { s1: { id: 's1', name: 'X' } }, chapters: {} }
    expect(mod.saveState(state).ok).toBe(false)
    expect(mod.hadAnonymousMutations()).toBe(true)
    expect(storage.getItem(mod.CLOUD_STORAGE_PREFIX + '7')).toBeNull()
  })
})


describe('大考卷活动会话 (round4)', () => {
  let storage
  let mod
  beforeEach(async () => {
    storage = makeLocalStorageStub()
    globalThis.localStorage = storage
    // v3.36.1 登录门禁：持久化只在登录账号下生效（匿名拒绝），用例统一播种账号
    storage.setItem('qbao_user', JSON.stringify({ id: 7, username: 'a' }))
    vi.resetModules()
    mod = await import('./persistence')
    mod.loadState()
  })
  const AKEY = () => 'qbao_active_exam_u_7'
  afterEach(() => { delete globalThis.localStorage })
  it('大考卷活动会话同步持久化：答题中刷新考卷题目/答案/进度不丢', async () => {
    const state = {
      currentExamId: 'exam_x1',
      generatedExams: {
        exam_x1: {
          id: 'exam_x1', name: '大考卷', subjectId: 's1',
          questions: [{ id: 1, question: 'E1' }, { id: 2, question: 'E2' }, { id: 3, question: 'E3' }],
          userAnswers: [1, undefined, 0],
          currentIdx: 2,
        },
      },
      subjects: {}, chapters: {},
    }
    mod.saveState(state)
    const raw = storage.getItem(AKEY())
    expect(raw).toBeTruthy()
    const exam = JSON.parse(raw)
    expect(exam.examId).toBe('exam_x1')
    expect(exam.questions).toHaveLength(3)
    expect(exam.userAnswers).toEqual([1, null, 0])
    expect(exam.currentIdx).toBe(2)

    // 骨架态（无 generatedExams）+ 活动键 → hydrate 完整回填考卷
    const skeleton = { currentExamId: 'exam_x1', generatedExams: {}, subjects: {}, chapters: {} }
    await mod.hydrateState(skeleton)
    const restored = skeleton.generatedExams.exam_x1
    expect(restored.questions).toHaveLength(3)
    expect(restored.userAnswers).toEqual([1, undefined, 0])
    expect(restored.currentIdx).toBe(2)

    // 考卷已从 IDB/云端恢复时：活动键答案优先覆盖（活动键每次保存必最新）
    const withExam = {
      currentExamId: 'exam_x1',
      generatedExams: { exam_x1: { id: 'exam_x1', name: '大考卷', subjectId: 's1', questions: [{ id: 1, question: 'E1' }, { id: 2, question: 'E2' }], userAnswers: [9, 9], currentIdx: 0 } },
      subjects: {}, chapters: {},
    }
    await mod.hydrateState(withExam)
    expect(withExam.generatedExams.exam_x1.userAnswers).toEqual([1, undefined])
    expect(withExam.generatedExams.exam_x1.currentIdx).toBe(2)
  })
})

describe('存储配额治理 (v3.36)', () => {
  let storage
  let hooks
  let mod

  beforeEach(async () => {
    storage = makeLocalStorageStub()
    globalThis.localStorage = storage
    hooks = []
    // v3.36.1 登录门禁：持久化只在登录账号下生效（匿名拒绝），用例统一播种账号
    storage.setItem('qbao_user', JSON.stringify({ id: 7, username: 'a' }))
    vi.resetModules()
    mod = await import('./persistence')
    mod.setPersistWarningHook((msg, fatal) => hooks.push({ msg, fatal }))
    mod.loadState()
  })
  afterEach(() => { delete globalThis.localStorage })

  it('pickSessionBackend：预算内走 localStorage 影子，超预算走 IndexedDB', () => {
    expect(mod.pickSessionBackend(0)).toBe('ls')
    expect(mod.pickSessionBackend(mod.ACTIVE_SESSION_LS_BUDGET)).toBe('ls')
    expect(mod.pickSessionBackend(mod.ACTIVE_SESSION_LS_BUDGET + 1)).toBe('idb')
    expect(mod.pickSessionBackend(10 * 1024 * 1024)).toBe('idb')
    // 非数/负数/NaN 一律保守走 IDB（绝不冒险撑爆 localStorage）
    expect(mod.pickSessionBackend(Number.NaN)).toBe('idb')
    expect(mod.pickSessionBackend(-1)).toBe('idb')
    expect(mod.pickSessionBackend('big')).toBe('idb')
  })

  it('大会话（>1MB）镜像不落 localStorage（且清除历史残留键），骨架照常写盘', () => {
    const bigQs = []
    for (let i = 0; i < 40000; i++) bigQs.push({ id: i, question: '题目'.repeat(10) + i, options: ['A', 'B', 'C', 'D'], answer: 0 })
    const state = {
      currentChapterId: 'c1',
      chapters: {
        c1: {
          id: 'c1', name: '章1', strategy: { errPct: 20 },
          questions: bigQs, userAnswers: [], currentQuizSetIdx: 0,
          quizSets: [{ questions: bigQs, userAnswers: [], currentIdx: 0, createdAt: 1 }],
        },
      },
      subjects: {},
    }
    // 预置历史遗留大镜像键（旧版本遗留）
    storage.setItem(mod.ACTIVE_SESSION_KEY, 'LEGACY_BIG_DATA')
    const res = mod.saveState(state)
    expect(res.ok).toBe(true)
    // 大会话镜像不占用 localStorage，且历史残留被清理（数据走 IDB 通道）
    expect(storage.getItem(mod.ACTIVE_SESSION_KEY)).toBeNull()
    expect(storage.getItem(mod.CLOUD_STORAGE_PREFIX + '7')).toBeTruthy() // 骨架照常写
  })

  it('小会话（预算内）保留 localStorage 影子键（刷新/关闭必达语义不变）', () => {
    const state = {
      currentChapterId: 'c1',
      chapters: {
        c1: {
          id: 'c1', name: '章1', strategy: { errPct: 20 },
          questions: [{ id: 1, question: 'Q1' }], userAnswers: [0], currentQuizSetIdx: 0,
          quizSets: [{ questions: [{ id: 1, question: 'Q1' }], userAnswers: [0], currentIdx: 0, createdAt: 1 }],
        },
      },
      subjects: {},
    }
    const res = mod.saveState(state)
    expect(res.ok).toBe(true)
    const raw = storage.getItem('qbao_active_session_u_7')
    expect(raw).toBeTruthy()
    // 影子键保留（下一次保存前刷新仍可恢复）；hydrate 可正常回填答题会话
    const skeleton = { currentChapterId: 'c1', chapters: { c1: { id: 'c1', name: '章1', strategy: { errPct: 20 } } }, subjects: {} }
    return mod.hydrateState(skeleton).then(() => {
      expect(skeleton.chapters.c1.quizSets).toHaveLength(1)
      expect(storage.getItem('qbao_active_session_u_7')).toBeTruthy()
    })
  })

  it('hydrate 读取历史遗留超预算大镜像键后清理（数据已常驻 IDB，防占空间）', async () => {
    // 模拟旧版本遗留的 >1MB 镜像键
    storage.setItem(mod.ACTIVE_SESSION_KEY, 'X'.repeat(mod.ACTIVE_SESSION_LS_BUDGET + 64))
    const skeleton = { currentChapterId: null, chapters: {}, subjects: {} }
    await mod.hydrateState(skeleton)
    expect(storage.getItem(mod.ACTIVE_SESSION_KEY)).toBeNull()
  })

  it('QuotaExceeded 自愈：清理可恢复镜像键后重试成功，不再报致命', () => {
    // 预置可恢复的遗留镜像键
    storage.setItem(mod.ACTIVE_SESSION_KEY, 'legacy-huge-session')
    const origSet = storage.setItem.bind(storage)
    let calls = 0
    storage.setItem = (k, v) => {
      calls++
      if (calls === 1) {
        const e = new Error('quota')
        e.name = 'QuotaExceededError'
        throw e
      }
      origSet(k, v)
    }
    const state = { subjects: { s1: { id: 's1' } }, chapters: {}, quizSession: { q: 1 } }
    const res = mod.saveState(state)
    expect(res.ok).toBe(true)
    // 遗留镜像键已被清理，写盘成功
    expect(storage.getItem(mod.ACTIVE_SESSION_KEY)).toBeNull()
    expect(storage.getItem(mod.CLOUD_STORAGE_PREFIX + '7')).toBeTruthy()
    // 只有非致命 info 提示（不再弹“存储空间已满”）
    expect(hooks.some((h) => h.fatal)).toBe(false)
    expect(hooks.some((h) => !h.fatal && h.msg.includes('已自动清理'))).toBe(true)
    // 瞬态字段仍恢复
    expect(state.quizSession).toEqual({ q: 1 })
  })

  it('QuotaExceeded 无镜像键可清理 → 致命告警 30s 冷却（连续保存只弹一次）', () => {
    storage.setItem = () => { const e = new Error('quota'); e.name = 'QuotaExceededError'; throw e }
    const state = { subjects: { s1: { id: 's1' } } }
    mod.saveState(state)
    mod.saveState(state)
    mod.saveState(state)
    const fatalCount = hooks.filter((h) => h.fatal).length
    expect(fatalCount).toBe(1)
    expect(hooks[0].fatal).toBe(true)
    expect(hooks[0].msg).toContain('存储空间已满')
  })
})


describe('账户隔离加固 (v3.36.1)', () => {
  let storage
  beforeEach(async () => {
    storage = makeLocalStorageStub()
    globalThis.localStorage = storage
    vi.resetModules()
    globalThis.__qbaoTestMod = null
  })
  afterEach(() => { delete globalThis.localStorage; delete globalThis.__qbaoTestMod })

  async function load() {
    const m = await import('./persistence')
    globalThis.__qbaoTestMod = m
    return m
  }

  it('loadState 记录内存数据属主（绑定 IndexedDB 分区）', async () => {
    const m = await load()
    storage.setItem('qbao_user', JSON.stringify({ id: 7, username: 'a' }))
    m.loadState()
    expect(m.getStateOwnerUid()).toBe('7')
    expect(m.getStateOwnerUid()).not.toBe(7) // 字符串归一
  })

  it('切换账号后 loadState 属主变化（触发整页重建的判定依据）', async () => {
    const m = await load()
    storage.setItem('qbao_user', JSON.stringify({ id: 7, username: 'a' }))
    m.loadState()
    expect(m.getStateOwnerUid()).toBe('7')
    storage.setItem('qbao_user', JSON.stringify({ id: 42, username: 'b' }))
    m.loadState()
    expect(m.getStateOwnerUid()).toBe('42')
    storage.removeItem('qbao_user')
    m.loadState()
    expect(m.getStateOwnerUid()).toBeNull()
  })

  it('活动会话镜像键按账号分区（登录态写专属键并清除旧全局键）', async () => {
    const m = await load()
    storage.setItem('qbao_user', JSON.stringify({ id: 7, username: 'a' }))
    m.loadState() // v3.37.1 写盘键取内存属主：先播种属主
    // 预置旧版全局镜像键（跨账号残留模拟）
    storage.setItem(m.ACTIVE_SESSION_KEY, 'LEGACY')
    const state = {
      currentChapterId: 'c1',
      chapters: {
        c1: {
          id: 'c1', name: '章1', strategy: { errPct: 20 },
          questions: [{ id: 1, question: 'Q1' }], userAnswers: [0], currentQuizSetIdx: 0,
          quizSets: [{ questions: [{ id: 1, question: 'Q1' }], userAnswers: [0], currentIdx: 0, createdAt: 1 }],
        },
      },
      subjects: {},
    }
    const res = m.saveState(state)
    expect(res.ok).toBe(true)
    // 账号专属键写入；旧全局键被清除（防跨账号残留）
    expect(storage.getItem('qbao_active_session_u_7')).toBeTruthy()
    expect(storage.getItem(m.ACTIVE_SESSION_KEY)).toBeNull()
  })

  it('hydrate 恢复优先读账号专属镜像键，旧全局键仅作升级回退', async () => {
    const m = await load()
    storage.setItem('qbao_user', JSON.stringify({ id: 7, username: 'a' }))
    m.loadState() // v3.37.1 镜像键取内存属主：先播种属主
    // 旧全局键（模拟升级前遗留）：其 cid 存在于骨架 → 升级后首次恢复仍可回填
    storage.setItem(m.ACTIVE_SESSION_KEY, JSON.stringify({ cid: 'c1', qsIdx: 0, questions: [{ id: 1, question: 'Q1' }], userAnswers: [0], currentIdx: 0 }))
    const skeleton = { currentChapterId: 'c1', chapters: { c1: { id: 'c1', name: '章1', strategy: { errPct: 20 } } }, subjects: {} }
    await m.hydrateState(skeleton)
    expect(skeleton.chapters.c1.quizSets).toHaveLength(1)
    // 账号专属键优先：存在 u_7 键时不再读全局键
    storage.removeItem(m.ACTIVE_SESSION_KEY)
    storage.setItem('qbao_active_session_u_7', JSON.stringify({ cid: 'c1', qsIdx: 0, questions: [{ id: 1, question: 'Q2' }], userAnswers: [1], currentIdx: 0 }))
    const skeleton2 = { currentChapterId: 'c1', chapters: { c1: { id: 'c1', name: '章1', strategy: { errPct: 20 } } }, subjects: {} }
    await m.hydrateState(skeleton2)
    expect(skeleton2.chapters.c1.quizSets[0].questions[0].question).toBe('Q2')
  })
})