import { currentWindowMode, type DocZoom } from '../core/windowMode'

/**
 * 창 사이에서 문서를 옮길 때 따라가는 배율. 떼어 낸 창은 주소 매개변수로, 메인으로 돌아오는 탭은 알림으로 받는다.
 * 문서를 처음 그릴 때(DocumentView 가 그 문서의 칸을 새로 만들 때) 한 번 꺼내 쓰고, 오래된 값은 쓰지 않는다.
 */
const queued = new Map<string, { readonly zoom: DocZoom; readonly at: number }>()
/** 이 시간이 지나면 잊는다(Vault 가 큰 창은 문서가 늦게 뜨므로 넉넉히) */
const TTL_MS = 60_000

export function queueInitialZoom(docId: string, zoom: DocZoom): void {
  queued.set(docId, { zoom, at: Date.now() })
}

export function peekInitialZoom(docId: string | null): DocZoom | null {
  if (docId === null) return null
  const entry = queued.get(docId)
  if (entry === undefined) return null
  if (Date.now() - entry.at > TTL_MS) {
    queued.delete(docId)
    return null
  }
  return entry.zoom
}

// 떼어 낸 창이 열릴 때 받은 배율
const mode = currentWindowMode()
if (mode.role === 'detached' && mode.docId !== null && mode.zoom !== null) queueInitialZoom(mode.docId, mode.zoom)
