/**
 * 한글 · 일본어 · 중국어 입력기로 글자를 조합하는 중의 키인가. 조합 중에 누른 Enter · 방향키 · Esc 는 입력기의 것이라 앱이 동작으로 받으면 안 된다.
 * `isComposing` 만으로는 모자란다: WebKit(맥 · Tauri)은 조합을 끝내는 Enter 를 `compositionend` 뒤에 `isComposing=false` 로 보내므로 `keyCode === 229`(입력기가 처리한 키)도 본다.
 */
export function imeKey(event: { readonly keyCode: number; readonly nativeEvent: { readonly isComposing: boolean } } | { readonly keyCode: number; readonly isComposing: boolean }): boolean {
  const composing = 'nativeEvent' in event ? event.nativeEvent.isComposing : event.isComposing
  return composing || event.keyCode === 229
}
