import { describe, it, expect } from 'vitest'
import { submitGameEvent } from './pointsBridge'

describe('pointsBridge v0 预留对接口', () => {
  it('合法事件 → 明确拒绝（v0 未生效）', async () => {
    const r = await submitGameEvent('game.completed', { gameId: '2048', score: 4096 })
    expect(r.accepted).toBe(false)
    expect(r.reason).toBe('v0-reserved')
  })

  it('未知游戏 → 校验拒绝', async () => {
    const r = await submitGameEvent('game.completed', { gameId: 'bad' })
    expect(r.accepted).toBe(false)
    expect(r.reason).toContain('未知游戏')
  })

  it('未定义事件 → 校验拒绝', async () => {
    const r = await submitGameEvent('game.hack', { gameId: '2048' })
    expect(r.accepted).toBe(false)
    expect(r.reason).toContain('未定义事件')
  })

  it('缺事件名 → 校验拒绝', async () => {
    const r = await submitGameEvent('', { gameId: '2048' })
    expect(r.accepted).toBe(false)
  })
})
