// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { UseUpdaterResult } from './useUpdater'
import { UpdateSettings } from './UpdateSettings'
import { setLocale } from '../i18n'
import * as releaseNotesModule from '../core/releaseNotes'

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

  it('확인 결과를 설정 안에서 보이고 설치 단추를 제공한다', () => {
    setLocale('ko')
    const pkg = { currentVersion: '0.1.11', version: '0.1.12', body: '고친 점', date: null, download: vi.fn(), installAndRelaunch: vi.fn(), close: vi.fn() }
    const base = state()
    const { rerender } = render(<UpdateSettings currentVersion="0.1.11" state={{ ...base, status: 'current' }} />)
    expect(screen.getByText('최신 버전을 사용 중입니다.')).not.toBeNull()

    const available = { ...base, status: 'available' as const, update: pkg }
    rerender(<UpdateSettings currentVersion="0.1.11" state={available} />)
    expect(screen.getByText('IWAE 0.1.12 업데이트')).not.toBeNull()
    expect(screen.getByText('고친 점')).not.toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '업데이트 다운로드' }))
    expect(base.download).toHaveBeenCalledOnce()

    rerender(<UpdateSettings currentVersion="0.1.11" state={{ ...available, status: 'ready' }} />)
    fireEvent.click(screen.getByRole('button', { name: '다시 시작해 설치' }))
    expect(base.install).toHaveBeenCalledOnce()

    rerender(<UpdateSettings currentVersion="0.1.11" state={{ ...base, status: 'error', error: 'net' }} />)
    expect(screen.getByRole('alert').textContent).toContain('확인하지 못했습니다')
  })

  it('업데이트 기록: 묶인 버전을 새 버전 먼저 보이고 지금 버전을 표시하며, 열 때 지정한 버전을 펼친다', () => {
    const { BUNDLED_RELEASE_NOTES } = releaseNotesModule
    const newest = BUNDLED_RELEASE_NOTES[0]!.version
    const { rerender } = render(<UpdateSettings currentVersion={newest} state={state()} />)
    const history = screen.getByRole('region', { name: '업데이트 기록' })
    const rows = history.querySelectorAll('.release-history-row')
    expect(rows.length).toBe(BUNDLED_RELEASE_NOTES.length)
    expect(rows[0]?.textContent).toContain(`v${newest}`)
    expect(rows[0]?.textContent).toContain('지금 버전')
    expect(history.querySelector('[aria-expanded="true"]')).toBeNull()

    rerender(<UpdateSettings currentVersion={newest} state={state()} historyFocusVersion={newest} />)
    expect(document.querySelector('.release-history-row[data-expanded="true"]')?.textContent).toContain(`v${newest}`)
  })
})
