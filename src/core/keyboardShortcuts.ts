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
  | 'openSettings'
  | 'commandPalette'
  | 'newWindow'
  | 'showShortcuts'

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return target.isContentEditable
    || target instanceof HTMLInputElement
    || target instanceof HTMLTextAreaElement
    || target instanceof HTMLSelectElement
}

/**
 * 키 입력 → 앱 명령. 어떤 키가 어떤 명령인지는 shortcutRegistry(사용자가 바꾼 키 포함)가 정한다.
 * Esc 만 등록부 밖에서 고정으로 본다(대화상자·메뉴 닫기에 쓰이므로 바꿀 수 없다).
 */
export function resolveAppShortcut(event: KeyboardEvent): AppShortcut | null {
  if (event.key.toLowerCase() === 'escape') return 'escape'
  return resolveShortcut(event, isEditableTarget(event.target)) as AppShortcut | null
}
