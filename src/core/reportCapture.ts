/** 문제 보고의 화면 캡처 첨부: 클립보드를 누가 쓰는지 정하는 순수 규칙. */

/** 캡처는 WebView2(Windows)에서만 된다 */
export function screenCaptureSupported(desktop: boolean, userAgent: string, platform: string): boolean {
  return desktop && /win/i.test(`${platform} ${userAgent}`) && !/darwin|mac/i.test(platform)
}

export type IssueClipboardPlan =
  /** 클립보드를 건드리지 않는다(사진이 있으면 그대로 남는다) */
  | 'leave'
  /** 긴 본문을 클립보드에 복사한다 */
  | 'copy-text'
  /** 본문을 복사하되, 사진은 덮어쓰이므로 「클립보드에 복사」로 다시 올리라고 알린다 */
  | 'copy-text-then-recopy-image'

/**
 * 「GitHub 이슈로 열기」 때 클립보드 처리. 이슈 주소에는 사진도 긴 본문도 실을 수 없어 둘 다 클립보드가 필요할 수 있는데
 * 클립보드는 하나뿐이다. 본문이 없으면 이슈가 비므로 본문을 먼저 올리고, 사진은 말없이 지우지 않고 다시 복사하라고 알린다.
 */
export function issueClipboardPlan(needsPaste: boolean, hasCapture: boolean): IssueClipboardPlan {
  if (!needsPaste) return 'leave'
  return hasCapture ? 'copy-text-then-recopy-image' : 'copy-text'
}
