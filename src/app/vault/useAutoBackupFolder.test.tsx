// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_AUTO_BACKUP, readAutoBackup, writeAutoBackup } from '../../core/autoBackup'
import { setLocale } from '../../i18n'

vi.mock('../../bridge/window', () => ({ isDesktop: () => true }))
vi.mock('../../bridge/vaultBackup', () => ({ backupAuto: vi.fn(), formatBytes: (n: number) => `${n} B` }))
vi.mock('../actionFeedback', () => ({ announceAction: vi.fn() }))
vi.mock('@tauri-apps/api/path', () => ({
  documentDir: async () => 'C:/Users/me/Documents',
  join: async (...parts: string[]) => parts.join('/'),
}))

import { useAutoBackup } from './useAutoBackup'

describe('useAutoBackup default folder', () => {
  beforeEach(() => { localStorage.clear() })
  afterEach(() => { setLocale('ko') })

  it('uses the Korean folder name for a Korean UI', async () => {
    setLocale('ko')
    const { result } = renderHook(() => useAutoBackup('C:/V1'))
    await waitFor(() => expect(result.current.settings?.folder).toBe('C:/Users/me/Documents/IWAE 백업'))
  })

  it('uses IWAE Backups for an English UI', async () => {
    setLocale('en')
    const { result } = renderHook(() => useAutoBackup('C:/V2'))
    await waitFor(() => expect(result.current.settings?.folder).toBe('C:/Users/me/Documents/IWAE Backups'))
    expect(readAutoBackup('C:/V2').folder).toBe('C:/Users/me/Documents/IWAE Backups')
  })

  it('keeps an already configured folder unchanged', async () => {
    setLocale('en')
    writeAutoBackup('C:/V3', { ...DEFAULT_AUTO_BACKUP, folder: 'C:/Users/me/Documents/IWAE 백업' })
    const { result } = renderHook(() => useAutoBackup('C:/V3'))
    await act(async () => {})
    expect(result.current.settings?.folder).toBe('C:/Users/me/Documents/IWAE 백업')
  })
})
