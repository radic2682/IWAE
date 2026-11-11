// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeAll, describe, expect, it, vi } from 'vitest'

const support = vi.hoisted(() => ({
  captureWindowPng: vi.fn(async () => new Uint8Array([1, 2, 3])),
  copyCaptureToClipboard: vi.fn(async () => undefined),
  saveCapturePng: vi.fn(async () => 'C:/x.png'),
  copyText: vi.fn(async () => undefined),
  readAppLogTail: vi.fn(async () => []),
  saveReportFile: vi.fn(async () => null),
}))
vi.mock('../bridge/support', () => support)
vi.mock('../bridge/window', () => ({ isDesktop: () => true }))

import { ReportProblemDialog } from './ReportProblemDialog'

beforeAll(() => {
  Object.defineProperty(navigator, 'platform', { value: 'Win32', configurable: true })
  URL.createObjectURL = vi.fn(() => 'blob:x')
  URL.revokeObjectURL = vi.fn()
})

describe('ReportProblemDialog 화면 캡처', () => {
  it('캡처하면 대화상자를 숨겼다 되살리고, 클립보드에 복사한 뒤 미리 보기와 저장 단추를 보인다', async () => {
    render(<ReportProblemDialog version="0.1.10" vaultRoot={null} onClose={vi.fn()} />)
    const backdrop = document.querySelector('.side-dialog-backdrop') as HTMLElement
    support.captureWindowPng.mockImplementationOnce(async () => {
      expect(backdrop.classList.contains('report-capturing')).toBe(true) // 찍는 순간 숨겨져 있다
      return new Uint8Array([1, 2, 3])
    })
    fireEvent.click(screen.getByRole('button', { name: '화면 캡처' }))
    await waitFor(() => expect(screen.getByAltText('캡처한 화면 미리 보기')).toBeTruthy())
    expect(backdrop.classList.contains('report-capturing')).toBe(false)
    expect(support.copyCaptureToClipboard).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('status').textContent).toContain('클립보드에 복사했습니다')

    fireEvent.click(screen.getByRole('button', { name: 'PNG로 저장' }))
    await waitFor(() => expect(support.saveCapturePng).toHaveBeenCalled())
  })

  it('이슈가 짧으면 클립보드를 건드리지 않아 사진이 남는다', async () => {
    support.copyText.mockClear()
    render(<ReportProblemDialog version="0.1.10" vaultRoot={null} onClose={vi.fn()} />)
    fireEvent.click(screen.getAllByRole('button', { name: '화면 캡처' }).at(-1)!)
    await waitFor(() => expect(screen.getAllByAltText('캡처한 화면 미리 보기').length).toBeGreaterThan(0))
    fireEvent.click(screen.getAllByRole('button', { name: 'GitHub 이슈로 열기' }).at(-1)!)
    expect(support.copyText).not.toHaveBeenCalled()
  })
})
