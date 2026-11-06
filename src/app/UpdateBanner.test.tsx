// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { UseUpdaterResult } from './useUpdater'
import { UpdateBanner } from './UpdateBanner'

function updater(overrides: Partial<UseUpdaterResult> = {}): UseUpdaterResult {
  return {
    status: 'available',
    update: {
      currentVersion: '0.1.2', version: '0.1.3', body: 'Faster search', date: null,
      download: vi.fn(), installAndRelaunch: vi.fn(), close: vi.fn(),
    },
    preferences: { version: 1, autoCheck: true, autoDownload: false, suppressedVersion: null, lastCheckedAt: null },
    progress: { downloaded: 0, total: null },
    error: null,
    checkNow: vi.fn(), download: vi.fn(), install: vi.fn(), dismiss: vi.fn(),
    suppressCurrentVersion: vi.fn(), updatePreferences: vi.fn(), clearSuppressedVersion: vi.fn(),
    ...overrides,
  }
}

describe('UpdateBanner', () => {
  it('업데이트, 나중에, 이 버전 숨기기를 제공한다', () => {
    const state = updater()
    render(<UpdateBanner state={state} />)

    expect(screen.getByText('IWAE 0.1.3 업데이트')).not.toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '업데이트 다운로드' }))
    fireEvent.click(screen.getByRole('button', { name: '나중에' }))
    fireEvent.click(screen.getByRole('button', { name: '이 버전 다시 표시 안 함' }))
    expect(state.download).toHaveBeenCalledOnce()
    expect(state.dismiss).toHaveBeenCalledOnce()
    expect(state.suppressCurrentVersion).toHaveBeenCalledOnce()
  })

  it('다운로드 완료 후 재시작 설치 버튼을 표시한다', () => {
    const state = updater({ status: 'ready', progress: { downloaded: 100, total: 100 } })
    render(<UpdateBanner state={state} />)
    fireEvent.click(screen.getByRole('button', { name: '재시작하여 설치' }))
    expect(state.install).toHaveBeenCalledOnce()
  })
})
