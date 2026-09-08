import { describe, it, expect } from 'vitest'
import { qaAllowedByHost } from './qa-gate.js'

describe('qaAllowedByHost 宿主门禁', () => {
  it('放行本机调试主机名', () => {
    expect(qaAllowedByHost('localhost')).toBe(true)
    expect(qaAllowedByHost('127.0.0.1')).toBe(true)
    expect(qaAllowedByHost('::1')).toBe(true)
  })
  it('放行 beta. 前缀的内测域名（大小写不敏感）', () => {
    expect(qaAllowedByHost('beta.example.com')).toBe(true)
    expect(qaAllowedByHost('beta.local')).toBe(true)
    expect(qaAllowedByHost('BETA.EXAMPLE.COM')).toBe(true)
  })
  it('拒绝生产、源站 IP、第三方与近似主机名', () => {
    expect(qaAllowedByHost('example.com')).toBe(false)
    expect(qaAllowedByHost('www.example.com')).toBe(false)
    expect(qaAllowedByHost('114.55.1.2')).toBe(false)
    expect(qaAllowedByHost('192.168.1.2')).toBe(false)
    expect(qaAllowedByHost('xbeta.example.com')).toBe(false) // 必须前缀，不是子串
    expect(qaAllowedByHost('my-beta.example.com')).toBe(false)
    expect(qaAllowedByHost('')).toBe(false)
    expect(qaAllowedByHost(null)).toBe(false)
    expect(qaAllowedByHost(undefined)).toBe(false)
  })
})
