import { resolveShortcut } from './shortcutRegistry'

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
  | 'toggleNoteBeside'
  | 'openSettings'
  | 'commandPalette'
  | 'newWindow'
  | 'showShortcuts'

/** 글을 쓰지 않는 입력칸(색 고르기·체크박스 등). 여기 커서가 있어도 앱 단축키(되돌리기 등)를 쓴다 */
const NON_TEXT_INPUT_TYPES = new Set(['button', 'checkbox', 'color', 'file', 'image', 'radio', 'range', 'reset', 'submit'])

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return target.isContentEditable
    || (target instanceof HTMLInputElement && !NON_TEXT_INPUT_TYPES.has(target.type))
    || target instanceof HTMLTextAreaElement
    || target instanceof HTMLSelectElement
}

/**
 * 키 입력 → 앱 명령. 어떤 키가 어떤 명령인지는 shortcutRegistry(사용자가 바꾼 키 포함)가 정한다.
 * Esc 만 등록부 밖에서 고정으로 본다(대화상자·메뉴 닫기에 쓰이므로 바꿀 수 없다).
 */
export function resolveAppShortcut(event: KeyboardEvent): AppShortcut | null {
  if (event.key.toLowerCase() === 'escape') return 'escape'
  // 아직 고치지 않은 숫자 칸(data-undo-passthrough)에서는 Ctrl+Z 가 칸 글자가 아니라 앱의 되돌리기다
  const passthrough = event.target instanceof HTMLElement && event.target.dataset.undoPassthrough === 'true' && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z'
  return resolveShortcut(event, !passthrough && isEditableTarget(event.target)) as AppShortcut | null
}
