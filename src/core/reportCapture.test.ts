import { describe, expect, it } from 'vitest'
import { issueClipboardPlan, screenCaptureSupported } from './reportCapture'

describe('reportCapture', () => {
  it('Windows 데스크톱에서만 캡처를 지원한다', () => {
    expect(screenCaptureSupported(true, 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)', 'Win32')).toBe(true)
    expect(screenCaptureSupported(false, 'Mozilla/5.0 (Windows NT 10.0)', 'Win32')).toBe(false)
    expect(screenCaptureSupported(true, 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 'MacIntel')).toBe(false)
    expect(screenCaptureSupported(true, 'Mozilla/5.0 (X11; Linux x86_64)', 'Linux x86_64')).toBe(false)
  })

  it('본문이 짧으면 클립보드를 건드리지 않아 사진이 남는다', () => {
    expect(issueClipboardPlan(false, true)).toBe('leave')
    expect(issueClipboardPlan(false, false)).toBe('leave')
  })

  it('본문이 길면 복사하고, 사진이 있으면 다시 복사하라고 알린다', () => {
    expect(issueClipboardPlan(true, false)).toBe('copy-text')
    expect(issueClipboardPlan(true, true)).toBe('copy-text-then-recopy-image')
  })
})
