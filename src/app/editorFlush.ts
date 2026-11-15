/**
 * 쓰고 있는 글쓰기 칸(메모 · 캔버스 글 상자)이 창을 닫기 · Vault 를 바꾸기 · 앱을 끝내기 전에
 * 지금까지 쓴 글을 먼저 내려 보내게 하는 자리. 칸이 포커스를 잃지 않고 사라지는 길(화면 전환, 칸 닫기)은 칸이 사라질 때 스스로 저장하고,
 * 창 전체가 닫히는 길은 flushCanvasSaves 가 이 자리를 먼저 부른다.
 */
const flushers = new Set<() => void>()

/** 쓰는 칸이 마운트되어 있는 동안 등록한다. 돌려주는 함수로 뺀다 */
export function registerEditorFlusher(flush: () => void): () => void {
  flushers.add(flush)
  return () => {
    flushers.delete(flush)
  }
}

/** 쓰고 있는 칸들의 글을 내려 보낸다. 그 글이 저장 대기열에 오르도록 한 틱 기다린다. 쓰던 칸이 없으면 바로 돌아온다 */
export async function flushEditors(): Promise<void> {
  if (flushers.size === 0) return
  for (const flush of [...flushers]) {
    try {
      flush()
    } catch { /* 한 칸이 실패해도 나머지는 내려 보낸다 */ }
  }
  await new Promise<void>((resolve) => { window.setTimeout(resolve, 0) })
}
