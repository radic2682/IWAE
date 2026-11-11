/** 마지막으로 알아본 userAgent·platform 과 그 결과. navigator.userAgentData 를 읽는 것이 느려서(카드마다 t() 가 불린다) 같은 값이면 다시 읽지 않는다 */
let macKey: string | null = null
let macResult = false

/**
 * 돌아가는 OS. 화면에서 맥만 다르게 할 것(창 단추 자리, 단축키 표시, Windows 전용 기능)을 고를 때 쓴다.
 * userAgent·platform 이 바뀌면(테스트가 바꿔 가며 확인한다) 다시 알아본다.
 */
export function isMacPlatform(): boolean {
  if (typeof navigator === 'undefined') return false
  const key = `${navigator.userAgent}|${navigator.platform ?? ''}`
  if (key === macKey) return macResult
  const platform = (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform ?? navigator.platform ?? ''
  macResult = /mac/iu.test(platform) || /Macintosh|Mac OS X/u.test(navigator.userAgent)
  macKey = key
  return macResult
}

/**
 * 글 안의 단축키 표기를 이 OS 의 모양으로. 맥에서는 `Ctrl+Shift+F` → `⇧⌘F`, `Ctrl+P` → `⌘P`, `Alt+←` → `⌥←`.
 * Windows 에서는 그대로 둔다.
 */
export function platformShortcut(text: string, mac?: boolean): string {
  // 단축키가 없는 글(거의 모두)은 OS 를 알아보지 않고 바로 돌려준다
  if (!/(Ctrl|Alt|Shift)\+/u.test(text) || !(mac ?? isMacPlatform())) return text
  return text.replace(/\b((?:(?:Ctrl|Alt|Shift)\+)+)/gu, (combo: string) => {
    const keys = combo.split('+').filter((key) => key !== '')
    // 맥의 표준 순서: ⌃ ⌥ ⇧ ⌘
    const order: readonly [string, string][] = [['Alt', '⌥'], ['Shift', '⇧'], ['Ctrl', '⌘']]
    return order.filter(([name]) => keys.includes(name)).map(([, symbol]) => symbol).join('')
  })
}
