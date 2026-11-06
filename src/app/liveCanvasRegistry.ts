import type { CanvasDocumentV2 } from '../core/canvasDocument'

/**
 * 지금 화면에 열린 캔버스. 바깥 AI(MCP)가 캔버스를 고칠 때, 열린 것은 파일이 아니라 화면 상태를
 * 바꿔야 저장이 서로 덮어쓰지 않는다. 캔버스 화면이 열릴 때 등록하고 닫힐 때 뺀다.
 */
export interface LiveCanvas {
  /** 화면에 있는 최신 문서 */
  get(): CanvasDocumentV2
  /** 문서를 바꿔 끼우고(저장 예약) 화면을 새 문서로 다시 그린다 */
  replace(document: CanvasDocumentV2): void
}

const live = new Map<string, LiveCanvas>()

export function registerLiveCanvas(noteId: string, handle: LiveCanvas): () => void {
  live.set(noteId, handle)
  return () => {
    if (live.get(noteId) === handle) live.delete(noteId)
  }
}

export function liveCanvas(noteId: string): LiveCanvas | undefined {
  return live.get(noteId)
}
