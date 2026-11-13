// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ReportProblemDialog } from './ReportProblemDialog'
import { recordError, clearRecordedErrors } from '../../core/errorBuffer'

describe('ReportProblemDialog', () => {
  it('가려진 미리보기를 보이고, 기록을 끄면 기록이 빠진다. 이슈는 확인 창 요청으로 연다', () => {
    clearRecordedErrors()
    recordError('error', new Error('failed to open C:\\Users\\kim\\Vault\\논문.pdf')) // release-scan-allow
    const requested: string[] = []
    window.addEventListener('iwae:request-external-link', (event) => requested.push((event as CustomEvent<string>).detail))
    render(<ReportProblemDialog version="0.1.10" vaultRoot="C:\Users\kim\Vault" onClose={vi.fn()} />) // release-scan-allow

    fireEvent.change(screen.getByRole('textbox'), { target: { value: '열면 멈춥니다' } })
    const preview = screen.getByLabelText('보낼 내용 미리보기')
    expect(preview.textContent).toContain('열면 멈춥니다')
    expect(preview.textContent).not.toContain('kim')
    expect(preview.textContent).not.toContain('논문')

    fireEvent.click(screen.getByRole('checkbox', { name: '앱 기록(로그) 첨부' }))
    expect(preview.textContent).not.toContain('frontend errors')

    fireEvent.click(screen.getByRole('button', { name: 'GitHub 이슈로 열기' }))
    expect(requested).toHaveLength(1)
    expect(requested[0]).toContain('github.com/radic2682/IWAE/issues/new')
  })
})
