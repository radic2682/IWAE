/**
 * 돌아가는 OS. 화면에서 맥만 다르게 할 것(창 단추 자리, 단축키 표시, Windows 전용 기능)을 고를 때 쓴다.
 * 부를 때마다 읽는다 — 테스트가 userAgent 를 바꿔 가며 확인한다.
 */
export function isMacPlatform(): boolean {
  if (typeof navigator === 'undefined') return false
  const platform = (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform ?? navigator.platform ?? ''
  return /mac/iu.test(platform) || /Macintosh|Mac OS X/u.test(navigator.userAgent)
}

/**
 * 글 안의 단축키 표기를 이 OS 의 모양으로. 맥에서는 `Ctrl+Shift+F` → `⇧⌘F`, `Ctrl+P` → `⌘P`, `Alt+←` → `⌥←`.
 * Windows 에서는 그대로 둔다.
 */
export function platformShortcut(text: string, mac = isMacPlatform()): string {
  if (!mac || !/(Ctrl|Alt|Shift)\+/u.test(text)) return text
  return text.replace(/\b((?:(?:Ctrl|Alt|Shift)\+)+)/gu, (combo: string) => {
    const keys = combo.split('+').filter((key) => key !== '')
    // 맥의 표준 순서: ⌃ ⌥ ⇧ ⌘
    const order: readonly [string, string][] = [['Alt', '⌥'], ['Shift', '⇧'], ['Ctrl', '⌘']]
    return order.filter(([name]) => keys.includes(name)).map(([, symbol]) => symbol).join('')
  })
}
