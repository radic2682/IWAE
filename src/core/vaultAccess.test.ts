import { describe, expect, it } from 'vitest'
import { isFolderAccessDenied } from './vaultAccess'

describe('isFolderAccessDenied', () => {
  it('recognises the plugin and the app scope errors in both languages', () => {
    expect(isFolderAccessDenied(new Error('forbidden path: C:\\Vault'))).toBe(true)
    expect(isFolderAccessDenied('This location is not allowed: C:\\Vault')).toBe(true)
    expect(isFolderAccessDenied('허용되지 않은 위치입니다: C:\\Vault')).toBe(true)
  })
  it('ignores other failures', () => {
    expect(isFolderAccessDenied(new Error('disk full'))).toBe(false)
  })
})
