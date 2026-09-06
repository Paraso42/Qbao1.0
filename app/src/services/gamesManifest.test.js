import { describe, it, expect } from 'vitest'
import { GAMES, GAME_IDS, gameSrc } from './gamesManifest'

describe('gamesManifest 清单完整性', () => {
  it('包含全部五款游戏且 id 唯一', () => {
    expect(GAME_IDS).toEqual(['2048', 'froggy', 'gridgarden', 'tetris', 'roulette'])
    expect(new Set(GAME_IDS).size).toBe(GAME_IDS.length)
  })

  it('每项字段齐全（src/license/upstream/commit/描述）', () => {
    for (const g of GAMES) {
      expect(g.id).toMatch(/^[a-z0-9]+$/)
      expect(g.src).toMatch(/^games\/[a-z0-9]+\/index\.html$/)
      expect(g.license).toBeTruthy()
      expect(g.upstream).toContain('/')
      // 自研游戏（upstream=本仓库）无上游 commit，允许 self-built 标记
      expect(g.commit).toMatch(/^([0-9a-f]{7}|self-built)$/)
      expect(g.desc.length).toBeGreaterThan(4)
      expect(g.kb).toBeGreaterThan(0)
    }
  })

  it('gameSrc 返回对应相对路径，未知 id 返回 null', () => {
    expect(gameSrc('2048')).toBe('games/2048/index.html')
    expect(gameSrc('nope')).toBeNull()
  })

  it('清单 id 与后端 schema 白名单一致（防两端漂移）', async () => {
    // 读服务端 schema 源码做字符串断言（两端为同一仓库，保持单向依赖：前端清单为准）
    const fs = await import('node:fs')
    const path = await import('node:path')
    const { fileURLToPath } = await import('node:url')
    const here = path.dirname(fileURLToPath(import.meta.url))
    const schemaPath = path.resolve(here, '../../..', 'server/src/schemas/games.schema.js')
    const schema = fs.existsSync(schemaPath) ? fs.readFileSync(schemaPath, 'utf8') : ''
    if (schema) {
      for (const id of GAME_IDS) expect(schema).toContain("'" + id + "'")
    }
  })
})
