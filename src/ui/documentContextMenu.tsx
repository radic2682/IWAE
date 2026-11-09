import { ClipboardText, Copy, MagnifyingGlass, Files, TerminalWindow } from '@phosphor-icons/react'
import { t } from '../i18n'
import type { ContextMenuEntry } from './ContextMenu'

/** 앱 명령을 실행해 달라고 App 에 알린다(문서 칸은 App 의 함수를 직접 모른다) */
export const APP_COMMAND_EVENT = 'iwae:app-command'
export type AppCommandName = 'search' | 'documentSearch' | 'commandPalette'

export function runAppCommand(name: AppCommandName): void {
  window.dispatchEvent(new CustomEvent(APP_COMMAND_EVENT, { detail: { name } }))
}

/**
 * PDF·Markdown 본문을 그냥 우클릭했을 때(끌지 않음)의 메뉴: 고른 글이 있으면 복사·출처와 함께 복사·문서에서 찾기,
 * 늘 이 문서에서 찾기·모든 문서에서 찾기·명령 팔레트, 그리고 마우스 제스처 안내.
 */
export function documentContextEntries(options: {
  readonly selectedText?: string
  readonly onCopyWithSource?: () => void
  readonly onSearchSelection?: () => void
}): ContextMenuEntry[] {
  const text = options.selectedText?.trim() ?? ''
  const selection: ContextMenuEntry[] = text === '' ? [] : [
    { key: 'copy', icon: <Copy size={15} />, label: t('복사'), shortcut: 'Ctrl+C', onSelect: () => { void navigator.clipboard?.writeText(text) } },
    ...(options.onCopyWithSource === undefined ? [] : [{ key: 'copy-source', icon: <ClipboardText size={15} />, label: t('출처와 함께 복사'), onSelect: options.onCopyWithSource }]),
    ...(options.onSearchSelection === undefined ? [] : [{ key: 'search-selection', icon: <Files size={15} />, label: t('이 글을 모든 문서에서 찾기'), onSelect: options.onSearchSelection }]),
    { key: 'sep-selection', separator: true as const },
  ]
  return [
    ...selection,
    { key: 'find', icon: <MagnifyingGlass size={15} />, label: t('이 문서에서 찾기'), shortcut: 'Ctrl+F', onSelect: () => runAppCommand('search') },
    { key: 'doc-search', icon: <Files size={15} />, label: t('모든 문서에서 찾기'), shortcut: 'Ctrl+Shift+F', onSelect: () => runAppCommand('documentSearch') },
    { key: 'palette', icon: <TerminalWindow size={15} />, label: t('명령 팔레트'), shortcut: 'Ctrl+Shift+P', onSelect: () => runAppCommand('commandPalette') },
    { key: 'sep-hint', separator: true as const },
    { key: 'hint', note: t('오른쪽 버튼을 누른 채 그리면: ↑↓ 맨 위·아래, ←→ 뒤로·앞으로, ㄴ 탭 닫기, ㄱ 닫은 탭 다시 열기') },
  ]
}
