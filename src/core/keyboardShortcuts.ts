export type AppShortcut =
  | 'save'
  | 'undo'
  | 'redo'
  | 'selectAll'
  | 'copy'
  | 'cut'
  | 'paste'
  | 'duplicate'
  | 'bold'
  | 'italic'
  | 'underline'
  | 'heading1'
  | 'heading2'
  | 'heading3'
  | 'heading4'
  | 'heading5'
  | 'heading6'
  | 'search'
  | 'zoomIn'
  | 'zoomOut'
  | 'zoomReset'
  | 'delete'
  | 'escape'
  | 'toggleLibrary'
  | 'navBack'
  | 'navForward'
  | 'documentSearch'
  | 'nextTab'
  | 'prevTab'
  | 'closeTab'
  | 'focusLeftPane'
  | 'focusRightPane'
  | 'goTo'
  | 'print'
  | 'toggleSinglePane'
  | 'openSettings'
  | 'commandPalette'

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return target.isContentEditable
    || target instanceof HTMLInputElement
    || target instanceof HTMLTextAreaElement
    || target instanceof HTMLSelectElement
}

export function resolveAppShortcut(event: KeyboardEvent): AppShortcut | null {
  const key = event.key.toLowerCase()
  const modified = event.ctrlKey || event.metaKey
  const editable = isEditableTarget(event.target)

  if (key === 'escape') return 'escape'
  // 라이브러리 토글은 검색 칸에 커서가 있어도 동작해야 한다 — 라이브러리의
  // 필터 칸에서 바로 접을 수 있어야 하기 때문이다.
  if (modified && event.shiftKey && !event.altKey && key === 'l') return 'toggleLibrary'
  // 명령 팔레트(Ctrl+Shift+P). 글 쓰는 칸에서도 연다
  if (modified && event.shiftKey && !event.altKey && key === 'p') return 'commandPalette'
  // 문서 검색 화면(모든 PDF 본문). 그냥 Ctrl+F(문서 안 검색)보다 먼저 본다.
  if (modified && event.shiftKey && !event.altKey && key === 'f') return 'documentSearch'
  // 설정(Ctrl+,). 글 쓰는 칸에서도 연다(다른 데스크톱 앱과 같다)
  if (modified && !event.shiftKey && !event.altKey && key === ',') return 'openSettings'
  // 탭·패널 이동은 글 쓰는 칸에서도 된다(브라우저와 같다).
  if (event.ctrlKey && !event.altKey && key === 'tab') return event.shiftKey ? 'prevTab' : 'nextTab'
  if (modified && !event.shiftKey && !event.altKey && key === 'w') return 'closeTab'
  if (modified && !event.shiftKey && !event.altKey && key === '1') return 'focusLeftPane'
  if (modified && !event.shiftKey && !event.altKey && key === '2') return 'focusRightPane'
  if (modified && !event.shiftKey && !event.altKey && key === '\\') return 'toggleSinglePane'
  // Ctrl+F 는 글 칸 안에서도 앱의 PDF 검색으로. 놓치면 WebView 의 기본 찾기창(검은 창)이 뜬다
  if (modified && !event.shiftKey && !event.altKey && key === 'f') return 'search'
  // Alt+←/→ 는 문서 점프 기록. 글을 쓰는 칸에서는 커서 이동과 겹치므로 쓰지 않는다.
  if (event.altKey && !modified && !editable && key === 'arrowleft') return 'navBack'
  if (event.altKey && !modified && !editable && key === 'arrowright') return 'navForward'
  if (modified && key === 's') return 'save'
  if (modified && !event.altKey && key === 'b') return 'bold'
  if (modified && !event.altKey && key === 'i') return 'italic'
  if (modified && !event.altKey && key === 'u') return 'underline'
  if (modified && event.altKey && /^[1-6]$/.test(key)) return `heading${key}` as AppShortcut
  if (editable) return null
  if (!modified && (key === 'delete' || key === 'backspace')) return 'delete'
  if (!modified || event.altKey) return null

  if (key === 'z') return event.shiftKey ? 'redo' : 'undo'
  if (key === 'y') return 'redo'
  if (key === 'a') return 'selectAll'
  if (key === 'c') return 'copy'
  if (key === 'x') return 'cut'
  if (key === 'v') return 'paste'
  if (key === 'd') return 'duplicate'
  if (key === 'f') return 'search'
  if (key === 'g') return 'goTo'
  if (key === 'p') return 'print'
  if (key === '=' || key === '+') return 'zoomIn'
  if (key === '-') return 'zoomOut'
  if (key === '0') return 'zoomReset'
  return null
}
