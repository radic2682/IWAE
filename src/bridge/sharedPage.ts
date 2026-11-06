/**
 * 쪽 그림을 압축 없이 받는 길(Windows WebView2 공유 메모리). Rust `pdf::shared` 참고.
 *
 * `iwae://page` 의 PNG 는 Rust 가 압축하고 웹뷰가 다시 풀어야 한다. 여기서는 PDFium 이 그린
 * RGBA 를 공유 메모리로 받아 그대로 ImageBitmap 으로 만든다 — Chrome PDF 뷰어가 그린 비트맵을
 * 바로 쓰는 것과 같은 길이다. 쓸 수 없는 환경(브라우저·테스트·옛 WebView2)이면 null 을 돌려주고,
 * 화면은 PNG 길을 그대로 쓴다.
 */

interface SharedBufferEvent extends Event {
  readonly additionalData?: { kind?: string; requestId?: number; width?: number; height?: number }
  getBuffer(): ArrayBuffer
}

interface WebViewBridge {
  addEventListener(type: 'sharedbufferreceived', listener: (event: SharedBufferEvent) => void): void
  releaseBuffer(buffer: ArrayBuffer): void
}

interface Pending {
  resolve: (image: { buffer: ArrayBuffer; width: number; height: number }) => void
  reject: (error: unknown) => void
}

const pending = new Map<number, Pending>()
let nextRequestId = 1
let listening = false
/** 한 번이라도 실패하면(옛 WebView2 등) 다시 시도하지 않는다 */
let unavailable = false

function bridge(): WebViewBridge | null {
  if (typeof window === 'undefined') return null
  const candidate = (window as unknown as { chrome?: { webview?: Partial<WebViewBridge> } }).chrome?.webview
  if (typeof candidate?.addEventListener !== 'function' || typeof candidate.releaseBuffer !== 'function') return null
  if (!('__TAURI_INTERNALS__' in window)) return null
  return candidate as WebViewBridge
}

export function sharedPagesAvailable(): boolean {
  return !unavailable && !switchedOff() && bridge() !== null && typeof createImageBitmap === 'function'
}

/** 문제가 생기면 끌 수 있게: localStorage 'iwae.pdf.sharedPages' = 'off' 면 PNG 길만 쓴다 */
function switchedOff(): boolean {
  try {
    return window.localStorage.getItem('iwae.pdf.sharedPages') === 'off'
  } catch {
    return false
  }
}

function listen(webview: WebViewBridge): void {
  if (listening) return
  listening = true
  webview.addEventListener('sharedbufferreceived', (event) => {
    const meta = event.additionalData
    if (meta?.kind !== 'iwae-page' || typeof meta.requestId !== 'number') return
    const buffer = event.getBuffer()
    const waiting = pending.get(meta.requestId)
    if (waiting === undefined) {
      webview.releaseBuffer(buffer)
      return
    }
    pending.delete(meta.requestId)
    waiting.resolve({ buffer, width: meta.width ?? 0, height: meta.height ?? 0 })
  })
}

export interface SharedTile {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

/**
 * 쪽(또는 타일)을 그려 ImageBitmap 으로 받는다. 이 길을 쓸 수 없으면 null.
 * 그리기 자체가 실패하면(쪽 범위 밖 등) 오류를 던진다.
 */
export async function renderSharedPage(
  docId: string,
  page: number,
  width: number,
  tile?: SharedTile,
): Promise<ImageBitmap | null> {
  const webview = bridge()
  if (webview === null || unavailable) return null
  listen(webview)
  const requestId = nextRequestId++
  const arrived = new Promise<{ buffer: ArrayBuffer; width: number; height: number }>((resolve, reject) => {
    pending.set(requestId, { resolve, reject })
  })
  const { invoke } = await import('@tauri-apps/api/core')
  try {
    await invoke('pdf_render_shared', {
      requestId,
      docId,
      page,
      width,
      tile: tile === undefined ? null : [tile.x, tile.y, tile.width, tile.height],
    })
  } catch (err) {
    pending.delete(requestId)
    const message = String(err)
    // 공유 메모리 자체를 못 쓰는 환경이면 PNG 길로 영영 돌린다
    if (/공유 메모리|WebView2|웹뷰/u.test(message)) {
      unavailable = true
      return null
    }
    throw err
  }
  const image = await arrived
  try {
    const data = new ImageData(new Uint8ClampedArray(image.buffer), image.width, image.height)
    return await createImageBitmap(data)
  } finally {
    webview.releaseBuffer(image.buffer)
  }
}
