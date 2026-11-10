import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type JSX } from 'react'
import { sharedPagesAvailable } from '../bridge/sharedPage'
import { cachedBitmap, loadSharedBitmap, type SharedBitmapRequest } from './sharedBitmaps'
import { pageImageUrl, pageTileUrl } from '../bridge/pdf'
import { MAX_RENDER_PIXELS, MAX_RENDER_WIDTH } from './renderWidth'
import { t } from '../i18n'

/**
 * 쪽 그림 한 장. 빠르게 뜨면서 화질은 기기 픽셀 그대로가 되도록 세 겹으로 그린다.
 *
 * 1. **미리보기** — 작은 폭(수 ms)으로 먼저 깐다. Rust 가 미리보기를 먼저 그리므로 빈 쪽이
 *    거의 보이지 않는다.
 * 2. **본 그림** — 쪽 전체를 기기 픽셀 폭(CSS 폭 × devicePixelRatio)으로. 브라우저가 늘리거나
 *    줄이지 않으므로 글자가 가장 또렷하다. 폭이 바뀌어도(확대·패널 폭) 새 그림이 다
 *    풀릴 때까지 예전 그림을 그대로 둔다 — 깜박임·빈칸이 없다.
 * 3. **타일** — 쪽 전체 비트맵이 너무 커지는 확대에서는 보이는 부분만 1024px 타일로 받는다.
 *    그 밑에는 적당한 해상도의 쪽 전체가 깔려 있어 타일이 오기 전에도 비지 않는다.
 */

/** 미리보기 폭(px). 고정값이라 확대를 바꿔도 캐시에서 바로 나온다 */
const PREVIEW_WIDTH = 480
/** 이 픽셀 수를 넘으면 쪽 전체 대신 타일로 받는다(2560×3300 쯤). 타일은 스크롤 중 경계가 늦게 차 흐려 보이기 쉬워 되도록 쪽 전체로 받는다 */
const FULL_PAGE_MAX_PIXELS = 8_500_000
/** 타일 한 변(기기 px) */
const TILE = 1024
/** 한 쪽에 붙여 두는 타일 수 상한(1024² × 4B ≈ 4MB 씩) */
const KEEP_TILES = 24
/** 타일 모드에서 밑에 깔 쪽 전체 그림의 폭. 이 간격으로 맞춰 캐시를 맞힌다 */
const UNDERLAY_STEP = 400
const UNDERLAY_MAX = 2000
/** 폭이 이만큼 머문 뒤에야 새 해상도를 요청한다(패널 끌기·확대 연타 중 요청 폭주 방지) */
const SETTLE_MS = 140
/** 새로 나타난 쪽의 본 그림을 이만큼(ms) 머문 뒤에야 요청한다 */
const BITMAP_START_DELAY_MS = 45

/** 한 번 풀어 본 주소. 다시 마운트돼도(스크롤로 나갔다 들어옴) 바로 보인다 */
const decoded = new Set<string>()

/** 미리 받아 둔 미리보기 그림(Image 를 잡아 두어 브라우저가 풀어 둔 채로 둔다) */
const prefetched = new Map<string, HTMLImageElement>()
const PREFETCH_KEEP = 160

/**
 * 곧 보일 쪽들의 미리보기를 미리 받아 둔다. 빠르게 넘길 때 새 쪽이 흰 종이로 번쩍였다가
 * 흐린 그림 → 또렷한 그림으로 바뀌던 것을, 적어도 미리보기는 바로 보이게 한다.
 */
export function prefetchPreviews(docId: string, pages: readonly number[]): void {
  if (typeof Image === 'undefined') return
  for (const page of pages) {
    const src = pageImageUrl(docId, page, PREVIEW_WIDTH)
    if (prefetched.has(src)) {
      // 최근에 쓴 것을 뒤로 보낸다(오래된 것부터 버린다)
      const image = prefetched.get(src)!
      prefetched.delete(src)
      prefetched.set(src, image)
      continue
    }
    const image = new Image()
    image.decoding = 'async'
    image.src = src
    image.decode?.().then(() => decoded.add(src), () => {})
    prefetched.set(src, image)
  }
  while (prefetched.size > PREFETCH_KEEP) {
    const oldest = prefetched.keys().next().value
    if (oldest === undefined) break
    prefetched.delete(oldest)
  }
}

function useSettled<T>(value: T, delay: number): T {
  const [settled, setSettled] = useState(value)
  useEffect(() => {
    if (Object.is(value, settled)) return
    const timer = window.setTimeout(() => setSettled(value), delay)
    return () => window.clearTimeout(timer)
  }, [delay, settled, value])
  return settled
}

/** `src` 가 다 풀리면 그것을, 그 전까지는 마지막으로 풀린 주소를 돌려준다 */
function useDecodedSrc(src: string | null): string | null {
  const [shown, setShown] = useState<string | null>(() => (src !== null && decoded.has(src) ? src : null))
  useEffect(() => {
    if (src === null || src === shown) return
    if (decoded.has(src) || typeof Image === 'undefined' || typeof Image.prototype.decode !== 'function') {
      setShown(src)
      return
    }
    let alive = true
    const image = new Image()
    image.decoding = 'async'
    image.src = src
    const done = () => {
      if (!alive) return
      decoded.add(src)
      setShown(src)
    }
    // decode() 는 그림을 그릴 준비까지 끝낸다 — 바꿔 끼우는 프레임에 버벅이지 않는다
    image.decode().then(done, () => {
      if (alive && image.complete && image.naturalWidth > 0) done()
    })
    return () => {
      alive = false
    }
  }, [shown, src])
  return shown
}

/** 본 그림·타일이 공유 메모리로 받아 둔(또는 PNG 로 풀어 둔) 그림인가 */
function isReady(src: string): boolean {
  return cachedBitmap(src) !== undefined || decoded.has(src)
}

/** 공유 메모리로 받은 본 그림. bitmap 이 null 이면 그 길을 못 써서 PNG `<img>` 로 그린다 */
interface SharedShown {
  readonly key: string
  readonly bitmap: ImageBitmap | null
}

/** useDecodedSrc 와 같다 — 새 그림이 다 올 때까지 마지막 그림을 계속 돌려준다 */
function useSharedBitmap(request: SharedBitmapRequest | null): SharedShown | null {
  const [shown, setShown] = useState<SharedShown | null>(() => {
    if (request === null) return null
    const hit = cachedBitmap(request.key)
    return hit === undefined ? null : { key: request.key, bitmap: hit }
  })
  const key = request?.key ?? null
  const requestRef = useRef(request)
  requestRef.current = request
  useEffect(() => {
    const current = requestRef.current
    if (current === null || key === null || shown?.key === key) return
    const hit = cachedBitmap(key)
    if (hit !== undefined) {
      setShown({ key, bitmap: hit })
      return
    }
    let alive = true
    // 스크롤바를 끌어 쪽이 스치듯 지나갈 때는 쪽 그리기를 요청하지 않는다(미리보기만 뜬다). 잠깐이라도 머문 쪽만 그린다.
    // 이미 요청이 나간 그림은 그대로 이어 받는다.
    const timer = window.setTimeout(() => void startLoad(), BITMAP_START_DELAY_MS)
    const startLoad = () => loadSharedBitmap(current).then((bitmap) => {
      if (!alive) return
      if (bitmap === null) {
        // 공유 메모리를 못 쓰면 PNG 로 — 다 풀린 뒤 바꾼다
        const image = new Image()
        image.src = key
        const done = () => {
          decoded.add(key)
          if (alive) setShown({ key, bitmap: null })
        }
        void (typeof image.decode === 'function' ? image.decode() : Promise.resolve()).then(done, done)
        return
      }
      setShown({ key, bitmap })
    })
    return () => {
      alive = false
      window.clearTimeout(timer)
    }
  }, [key, shown?.key])
  return shown
}

/** 받은 비트맵을 그대로 그리는 캔버스(기기 픽셀 그대로, 다시 풀기 없음) */
function BitmapLayer({ bitmap, className, style, onAnimationEnd }: {
  readonly bitmap: ImageBitmap
  readonly className: string
  readonly style?: CSSProperties
  readonly onAnimationEnd?: () => void
}): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  useLayoutEffect(() => {
    const canvas = canvasRef.current
    if (canvas === null) return
    if (canvas.width !== bitmap.width) canvas.width = bitmap.width
    if (canvas.height !== bitmap.height) canvas.height = bitmap.height
    try {
      canvas.getContext('2d', { alpha: false })?.drawImage(bitmap, 0, 0)
    } catch {
      // 캐시에서 이미 닫힌 그림이면 그리지 않는다(곧 새 그림이 온다)
    }
  }, [bitmap])
  return <canvas ref={canvasRef} className={className} style={style} aria-hidden="true" onAnimationEnd={onAnimationEnd} />
}

export interface PageImageProps {
  readonly docId: string
  readonly page: number
  /** 쪽 상자의 CSS 크기(돌리기 전) */
  readonly cssWidth: number
  readonly cssHeight: number
  /** 쪽 크기(points). 비율로 Rust 와 같은 높이를 낸다 */
  readonly pageSize: readonly [number, number] | undefined
  readonly devicePixelRatio: number
  /** 이 쪽에서 화면에 보이는 부분(쪽 왼쪽 위 기준 CSS px). null 이면 안 보인다(미리 그리기만) */
  readonly visible: { readonly left: number; readonly top: number; readonly right: number; readonly bottom: number } | null
  /** 돌린 쪽은 보이는 사각형 계산이 어긋나 타일을 쓰지 않는다 */
  readonly allowTiles: boolean
}

export function PageImage({ docId, page, cssWidth, cssHeight, pageSize, devicePixelRatio, visible, allowTiles }: PageImageProps): JSX.Element {
  const ratio = Number.isFinite(devicePixelRatio) && devicePixelRatio > 0 ? devicePixelRatio : 1
  const aspect = pageSize !== undefined && pageSize[0] > 0 ? pageSize[1] / pageSize[0] : cssWidth > 0 ? cssHeight / cssWidth : 1.3
  const liveWidth = Math.max(32, Math.round(cssWidth * ratio))
  const deviceWidth = useSettled(liveWidth, SETTLE_MS)
  const deviceHeight = Math.max(1, Math.round(deviceWidth * aspect))
  const tiled = allowTiles && deviceWidth * deviceHeight > FULL_PAGE_MAX_PIXELS

  // 쪽 전체 한 장. 타일 모드에서는 밑그림(적당한 해상도), 아니면 본 그림(기기 픽셀 그대로)
  const fullWidth = (() => {
    if (tiled) return Math.min(UNDERLAY_MAX, Math.ceil(deviceWidth / 2 / UNDERLAY_STEP) * UNDERLAY_STEP)
    const pixelCap = Math.floor(Math.sqrt(MAX_RENDER_PIXELS / aspect))
    return Math.min(deviceWidth, MAX_RENDER_WIDTH, pixelCap)
  })()
  const preview = pageImageUrl(docId, page, PREVIEW_WIDTH)
  const fullSrc = pageImageUrl(docId, page, fullWidth)
  // Windows 앱에서는 PNG 대신 공유 메모리로 압축 없이 받는다(Chrome PDF 뷰어처럼). 안 되면 PNG
  const [shared] = useState(sharedPagesAvailable)
  const decodedFull = useDecodedSrc(shared ? null : fullSrc)
  const sharedFull = useSharedBitmap(shared ? { key: fullSrc, docId, page, width: fullWidth } : null)
  const shownFull = shared ? sharedFull?.key ?? null : decodedFull
  // 본 그림(예전 해상도라도)이 한 번 떴으면 미리보기는 그 밑에 가려지므로 그리지 않는다
  const showPreview = shownFull === null && fullWidth > PREVIEW_WIDTH
  // 미리보기를 한 번이라도 보였으면 본 그림은 짧게 겹쳐 들어온다(툭 바뀌는 번쩍임 대신)
  const previewShownRef = useRef(false)
  if (showPreview) previewShownRef.current = true
  // 겹쳐 바꾸기가 끝나면 밑의 미리보기는 치운다
  const [fadeDone, setFadeDone] = useState(false)
  const keepPreviewUnder = previewShownRef.current && shownFull !== null && !fadeDone

  // 확대·축소 직후(새 폭이 정해지기 전)에는 지금 그림을 상자에 맞춰 늘려 둔다 — 예전 크기로 남으면
  // 커진 상자 안에 흰 틈이 보였다가 채워지며 깜박인다. 폭이 정해지면 기기 픽셀 1:1 로 놓는다.
  const settled = deviceWidth === liveWidth
  const fullStyle = tiled || shownFull !== fullSrc || !settled
    ? { width: '100%', height: '100%' }
    : { width: `${deviceWidth / ratio}px`, height: `${deviceHeight / ratio}px` }

  const tileSpecs: TileSpec[] = []
  if (tiled && visible !== null) {
    const scale = deviceWidth / Math.max(cssWidth, 1)
    // 스크롤 방향(위아래)으로는 타일 한 줄을 넉넉히 미리 받아, 새 줄이 흐린 밑그림으로 드러나지 않게 한다
    const marginX = TILE / 4
    const marginY = TILE
    const x0 = Math.max(0, Math.floor((visible.left * scale - marginX) / TILE))
    const x1 = Math.min(Math.ceil(deviceWidth / TILE) - 1, Math.floor((visible.right * scale + marginX) / TILE))
    const y0 = Math.max(0, Math.floor((visible.top * scale - marginY) / TILE))
    const y1 = Math.min(Math.ceil(deviceHeight / TILE) - 1, Math.floor((visible.bottom * scale + marginY) / TILE))
    for (let ty = y0; ty <= y1; ty++) {
      for (let tx = x0; tx <= x1; tx++) {
        const x = tx * TILE
        const y = ty * TILE
        const width = Math.min(TILE, deviceWidth - x)
        const height = Math.min(TILE, deviceHeight - y)
        if (width <= 0 || height <= 0) continue
        tileSpecs.push({ src: pageTileUrl(docId, page, deviceWidth, { x, y, width, height }), x, y, width, height, pageWidth: deviceWidth, pageHeight: deviceHeight })
      }
    }
  }

  // 같은 배율에서 한 번 받은 타일은 보이는 띠를 벗어나도 얼마간 붙여 둔다 — 스크롤을 되돌리거나
  // 띠 경계를 오갈 때 타일이 빠졌다 다시 생기며 흐린 밑그림이 번쩍이지 않게 한다
  const keptTilesRef = useRef<TileSpec[]>([])
  if (tiled) {
    const wanted = new Set(tileSpecs.map((spec) => spec.src))
    const kept = keptTilesRef.current.filter((spec) => spec.pageWidth === deviceWidth && !wanted.has(spec.src) && isReady(spec.src))
    keptTilesRef.current = [...kept, ...tileSpecs].slice(-KEEP_TILES)
  } else {
    keptTilesRef.current = []
  }
  const extraTiles = keptTilesRef.current.filter((spec) => !tileSpecs.some((current) => current.src === spec.src))

  // 새 배율의 타일이 다 올 때까지 예전 배율의 타일을 그 밑에 둔다(흐린 밑그림이 잠깐 드러나지 않게)
  const [, setLoadedCount] = useState(0)
  const previousTilesRef = useRef<readonly TileSpec[]>([])
  const currentTilesRef = useRef<readonly TileSpec[]>([])
  const currentReady = tileSpecs.every((spec) => isReady(spec.src))
  if (currentTilesRef.current.length > 0 && tileSpecs.length > 0
    && currentTilesRef.current[0]?.pageWidth !== deviceWidth) {
    previousTilesRef.current = currentTilesRef.current.filter((spec) => isReady(spec.src))
  }
  currentTilesRef.current = tileSpecs
  if (currentReady || !tiled) previousTilesRef.current = []
  const onTileLoad = () => setLoadedCount((count) => count + 1)

  // 폭이 정해져 있으면 px(기기 픽셀 1:1), 바뀌는 중이면 쪽 상자 비율(%)로 놓아 상자와 함께 커진다
  const place = (spec: TileSpec, exact: boolean): CSSProperties => exact
    ? { left: `${spec.x / ratio}px`, top: `${spec.y / ratio}px`, width: `${spec.width / ratio}px`, height: `${spec.height / ratio}px` }
    : {
        left: `${(spec.x / spec.pageWidth) * 100}%`,
        top: `${(spec.y / spec.pageHeight) * 100}%`,
        width: `${(spec.width / spec.pageWidth) * 100}%`,
        height: `${(spec.height / spec.pageHeight) * 100}%`,
      }

  return (
    <div className="pdf-page" role="img" aria-label={t('{page} 페이지', { page: page + 1 })}>
      {/* decoding="sync": 이미 받아 둔 그림을 다시 붙일 때(스크롤로 나갔다 들어옴) 한 프레임 비는 것을 막는다 */}
      {showPreview || keepPreviewUnder ? <img className="pdf-page-layer pdf-page-preview" src={preview} alt="" decoding="sync" draggable={false} /> : null}
      {shownFull !== null && sharedFull?.bitmap != null ? (
        <BitmapLayer
          bitmap={sharedFull.bitmap}
          className={`pdf-page-layer pdf-page-full${previewShownRef.current ? ' pdf-page-full-fade' : ''}`}
          style={fullStyle}
          onAnimationEnd={() => setFadeDone(true)}
        />
      ) : shownFull !== null ? (
        <img className={`pdf-page-layer pdf-page-full${previewShownRef.current ? ' pdf-page-full-fade' : ''}`} src={shownFull} alt="" decoding="sync" draggable={false} style={fullStyle} onAnimationEnd={() => setFadeDone(true)} />
      ) : null}
      {previousTilesRef.current.map((spec) => (
        <Tile key={spec.src} spec={spec} docId={docId} page={page} shared={shared} style={place(spec, false)} onReady={onTileLoad} />
      ))}
      {extraTiles.map((spec) => (
        <Tile key={spec.src} spec={spec} docId={docId} page={page} shared={shared} style={place(spec, settled)} onReady={onTileLoad} />
      ))}
      {tileSpecs.map((spec) => (
        <Tile key={spec.src} spec={spec} docId={docId} page={page} shared={shared} style={place(spec, settled)} onReady={onTileLoad} />
      ))}
    </div>
  )
}

interface TileSpec {
  readonly src: string
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
  /** 이 타일을 낼 때의 쪽 크기(기기 px) */
  readonly pageWidth: number
  readonly pageHeight: number
}

function Tile({ spec, docId, page, shared, style, onReady }: {
  readonly spec: TileSpec
  readonly docId: string
  readonly page: number
  readonly shared: boolean
  readonly style: CSSProperties
  readonly onReady: () => void
}): JSX.Element {
  const { src } = spec
  const [bitmap, setBitmap] = useState<ImageBitmap | null>(() => cachedBitmap(src) ?? null)
  // 공유 메모리를 못 쓰면(또는 실패하면) PNG 타일로
  const [usePng, setUsePng] = useState(!shared)
  const [ready, setReady] = useState(() => isReady(src))
  const onReadyRef = useRef(onReady)
  onReadyRef.current = onReady
  useEffect(() => {
    if (usePng || bitmap !== null) return
    let alive = true
    void loadSharedBitmap({
      key: src,
      docId,
      page,
      width: spec.pageWidth,
      tile: { x: spec.x, y: spec.y, width: spec.width, height: spec.height },
    }).then((loaded) => {
      if (!alive) return
      if (loaded === null) {
        setUsePng(true)
        return
      }
      setBitmap(loaded)
      setReady(true)
      onReadyRef.current()
    })
    return () => {
      alive = false
    }
  }, [bitmap, docId, page, spec, src, usePng])
  if (!usePng) {
    return bitmap === null
      ? <span className="pdf-page-tile" style={style} />
      : <BitmapLayer bitmap={bitmap} className="pdf-page-tile pdf-page-tile-ready" style={style} />
  }
  return (
    <img
      className={`pdf-page-tile${ready ? ' pdf-page-tile-ready' : ''}`}
      src={src}
      alt=""
      draggable={false}
      decoding="async"
      style={style}
      onLoad={() => {
        decoded.add(src)
        setReady(true)
        onReady()
      }}
    />
  )
}
