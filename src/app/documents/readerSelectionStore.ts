import { useSyncExternalStore } from 'react'

/**
 * 문서(PDF·Markdown)에서 지금 고른 글. 번역기의 「선택한 글 넣기」가 읽는다.
 * 고른 글의 작업 줄(SelectionActions·MarkdownPane)이 알려 주고, 선택이 풀리면 비운다.
 */
let current = ''
let owner: string | null = null
const listeners = new Set<() => void>()

export function publishReaderSelection(ownerId: string, text: string): void {
  if (text.trim() === '') {
    // 다른 칸이 새로 고른 글을 이 칸의 해제가 지우지 않게
    if (owner !== ownerId) return
    owner = null
    current = ''
  } else {
    owner = ownerId
    current = text
  }
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

export function useReaderSelection(): string {
  return useSyncExternalStore(subscribe, () => current, () => current)
}
