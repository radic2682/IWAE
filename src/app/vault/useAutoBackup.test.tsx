// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_AUTO_BACKUP, readAutoBackup, writeAutoBackup } from '../../core/autoBackup'

let resolveBackup: ((value: unknown) => void) | null = null
vi.mock('../../bridge/vaultBackup', () => ({
  backupAuto: vi.fn(() => new Promise((resolve) => { resolveBackup = resolve })),
  formatBytes: (n: number) => `${n} B`,
}))
vi.mock('../actionFeedback', () => ({ announceAction: vi.fn() }))

import { useAutoBackup } from './useAutoBackup'

describe('useAutoBackup', () => {
  beforeEach(() => { localStorage.clear() })

  it('백업 중 Vault 를 바꿔도 끝난 쪽의 설정이 새 Vault 에 보이지 않는다', async () => {
    writeAutoBackup('C:/VaultA', { ...DEFAULT_AUTO_BACKUP, folder: 'D:/backupA', keep: 20, everyDays: 1 })
    writeAutoBackup('C:/VaultB', { ...DEFAULT_AUTO_BACKUP, folder: 'D:/backupB', keep: 3, everyDays: 30, enabled: false })
    const { result, rerender } = renderHook(({ root }) => useAutoBackup(root), { initialProps: { root: 'C:/VaultA' as string | null } })
    await act(async () => { void result.current.runNow() })
    rerender({ root: 'C:/VaultB' })
    await act(async () => { resolveBackup?.({ backup: { archiveBytes: 10 }, removed: [] }) })
    expect(result.current.settings?.folder).toBe('D:/backupB')
    act(() => { result.current.update({ includeIndex: true }) })
    expect(readAutoBackup('C:/VaultB')).toMatchObject({ folder: 'D:/backupB', enabled: false, includeIndex: true })
    // A 의 기록은 A 에 남는다
    expect(readAutoBackup('C:/VaultA').lastAt).not.toBeNull()
    expect(readAutoBackup('C:/VaultB').lastAt).toBeNull()
  })
})
