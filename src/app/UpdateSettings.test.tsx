// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { UseUpdaterResult } from './useUpdater'
import { UpdateSettings } from './UpdateSettings'
import { setLocale } from '../i18n'

function state(): UseUpdaterResult {
  return {
    status: 'idle', update: null,
    preferences: {
      version: 1, autoCheck: true, autoDownload: false,
      suppressedVersion: '0.1.3', lastCheckedAt: '2026-10-01T00:00:00.000Z',
    },
    progress: { downloaded: 0, total: null }, error: null,
    checkNow: vi.fn(), download: vi.fn(), install: vi.fn(), dismiss: vi.fn(),
    suppressCurrentVersion: vi.fn(), updatePreferences: vi.fn(), clearSuppressedVersion: vi.fn(),
  }
}

describe('UpdateSettings', () => {
  it('현재 버전과 자동 정책 및 숨긴 버전 초기화를 제공한다', () => {
    const updater = state()
    render(<UpdateSettings currentVersion="0.1.2" state={updater} />)

    expect(screen.getByText('0.1.2')).not.toBeNull()
    fireEvent.click(screen.getByRole('checkbox', { name: '업데이트 자동 다운로드' }))
    fireEvent.click(screen.getByRole('button', { name: '숨긴 버전 초기화' }))
    fireEvent.click(screen.getByRole('button', { name: '지금 확인' }))
    expect(updater.updatePreferences).toHaveBeenCalledWith({ autoDownload: true })
    expect(updater.clearSuppressedVersion).toHaveBeenCalledOnce()
    expect(updater.checkNow).toHaveBeenCalledOnce()
  })

  it('영어 화면에서는 영어 글을 보인다', () => {
    setLocale('en')
    render(<UpdateSettings currentVersion="0.1.2" state={state()} />)
    expect(screen.getByRole('checkbox', { name: 'Download updates automatically' })).not.toBeNull()
    expect(screen.getByRole('button', { name: 'Check now' })).not.toBeNull()
    expect(screen.getByText(/are hidden/u)).not.toBeNull()
  })
})
