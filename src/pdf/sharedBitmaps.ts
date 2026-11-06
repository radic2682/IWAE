import { renderSharedPage, type SharedTile } from '../bridge/sharedPage'

/**
 * 공유 메모리로 받은 쪽 그림(ImageBitmap) 캐시. 키는 같은 그림의 `iwae://page` 주소다.
 *
 * 화면의 캔버스는 그림을 그릴 때 자기 사본을 가지므로, 여기서 오래된 것을 닫아도 이미 그려진
 * 쪽은 그대로다. 이 캐시는 스크롤로 나갔다 들어온 쪽을 다시 그리지 않고 바로 붙이기 위한 것이다.
 */

/** 캐시 상한(바이트). 1780×2300 쪽 하나가 16MB 쯤이라 스무 장 남짓이다 */
const BUDGET_BYTES = 384 * 1024 * 1024

const cache = new Map<string, ImageBitmap>()
const inflight = new Map<string, Promise<ImageBitmap | null>>()
let usedBytes = 0

const bytesOf = (bitmap: ImageBitmap) => bitmap.width * bitmap.height * 4

export function cachedBitmap(key: string): ImageBitmap | undefined {
  const bitmap = cache.get(key)
  if (bitmap === undefined) return undefined
  // 최근에 쓴 것을 뒤로(오래된 것부터 버린다)
  cache.delete(key)
  cache.set(key, bitmap)
  return bitmap
}

function remember(key: string, bitmap: ImageBitmap): void {
  const previous = cache.get(key)
  if (previous !== undefined) {
    usedBytes -= bytesOf(previous)
    cache.delete(key)
  }
  cache.set(key, bitmap)
  usedBytes += bytesOf(bitmap)
  while (usedBytes > BUDGET_BYTES && cache.size > 1) {
    const [oldestKey, oldest] = cache.entries().next().value as [string, ImageBitmap]
    cache.delete(oldestKey)
    usedBytes -= bytesOf(oldest)
    oldest.close()
  }
}

export interface SharedBitmapRequest {
  readonly key: string
  readonly docId: string
  readonly page: number
  readonly width: number
  readonly tile?: SharedTile
}

/**
 * 그림을 받는다(같은 키를 동시에 여러 번 부르면 한 번만 그린다). 공유 메모리를 쓸 수 없거나
 * 그리기에 실패하면 null — 부르는 쪽은 PNG `<img>` 로 돌아간다.
 */
export function loadSharedBitmap(request: SharedBitmapRequest): Promise<ImageBitmap | null> {
  const hit = cachedBitmap(request.key)
  if (hit !== undefined) return Promise.resolve(hit)
  const running = inflight.get(request.key)
  if (running !== undefined) return running
  const loading = renderSharedPage(request.docId, request.page, request.width, request.tile)
    .then((bitmap) => {
      if (bitmap !== null) remember(request.key, bitmap)
      return bitmap
    })
    .catch(() => null)
    .finally(() => inflight.delete(request.key))
  inflight.set(request.key, loading)
  return loading
}
