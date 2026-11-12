import { rangeFillStyle } from '../ui/rangeFill'
import { t } from '../i18n'
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { clampZoom, ZOOM_MAX, ZOOM_MIN } from '../core/pdfZoom'
import { ArrowLeft, ArrowRight, ArrowsHorizontal, ArrowsVertical, CaretDoubleLeft, CaretDoubleRight, CaretLeft, CaretRight, CornersOut, DotsThree, Minus, Plus } from '@phosphor-icons/react'
import '../ui/pdf-followup.css'
import { scrollHorizontalStrip } from './horizontalScroll'
import { useUsageMeterEnabled } from '../core/usageMeterPref'
import { UsageMeter } from '../pdf/UsageMeter'
import { isDesktop } from '../bridge/window'

/**
 * 폭이 모자라면 접는 묶음. 앞에 있는 것부터 막대에서 빠져 오른쪽 끝 「…」 메뉴로 들어간다(크롬 도구줄처럼).
 * 미리 정한 폭이 아니라 실제로 넘치는지를 재서 정하므로 단추가 늘거나 화면 크기가 바뀌어도 잘리지 않는다.
 */
type CollapseGroup = 'zoomRange' | 'fitExtra' | 'edge' | 'history' | 'fit' | 'usage' | 'zoomInput' | 'zoomStep' | 'pageStep'
const COLLAPSE_ORDER: readonly CollapseGroup[] = ['zoomRange', 'fitExtra', 'edge', 'history', 'fit', 'usage', 'zoomInput', 'zoomStep', 'pageStep']
/** 다시 꺼낼 때 남겨 둘 여유(px). 넣었다 뺐다 떨리지 않게 */
const RESTORE_SLACK = 8

interface PdfBottomBarProps {
  zoomPercent: number
  page: number
  pageCount: number
  onZoomIn: () => void
  onZoomOut: () => void
  onZoomChange: (value: number) => void
  onPageChange: (value: number) => void
  onFitWidth: () => void
  onFitPage: () => void
  /** 쪽 높이를 창 높이에 맞춘다(가로로 긴 쪽은 옆으로 넘친다) */
  onFitHeight?: () => void
  /** 실제 크기(100% = 종이 크기) */
  onActualSize?: () => void
  /** 점프 기록. 갈 곳이 없으면 버튼이 꺼진다 */
  canGoBack?: boolean
  canGoForward?: boolean
  onBack?: () => void
  onForward?: () => void
  /** 막대 오른쪽 끝에 붙는 추가 조작(보기 옵션) */
  extraControls?: ReactNode
  /** 쪽 칸에 숫자가 아닌 것(5.1.9.3, Table 52)을 쳤을 때. 찾았으면 true */
  onGoto?: (text: string) => Promise<boolean>
}

export function PdfBottomBar({ zoomPercent, page, pageCount, onZoomIn, onZoomOut, onZoomChange, onPageChange, onFitWidth, onFitPage, onFitHeight, onActualSize, canGoBack = false, canGoForward = false, onBack, onForward, extraControls, onGoto }: PdfBottomBarProps) {
  const [pageInput, setPageInput] = useState(String(page))
  const [zoomInput, setZoomInput] = useState(String(zoomPercent))
  // 오른쪽 끝의 CPU·메모리(설정에서 끌 수 있다). 잴 수 있는 데스크톱 앱에서만 자리를 둔다
  const usageMeter = useUsageMeterEnabled() && isDesktop()

  // ---------- 넘치면 접기 ----------
  const present = COLLAPSE_ORDER.filter((group) => {
    if (group === 'history') return onBack !== undefined || onForward !== undefined
    if (group === 'fitExtra') return onFitHeight !== undefined || onActualSize !== undefined
    if (group === 'usage') return usageMeter
    return true
  })
  const [collapsedCount, setCollapsedCount] = useState(0)
  const collapsed = new Set(present.slice(0, Math.min(collapsedCount, present.length)))
  const shown = (group: CollapseGroup) => !collapsed.has(group)
  const surfaceRef = useRef<HTMLDivElement | null>(null)
  /** 묶음마다 막대에 있을 때 잰 폭(빼낸 뒤 다시 넣을 수 있는지 볼 때 쓴다) */
  const widthsRef = useRef(new Map<CollapseGroup, number>())
  /**
   * 접은 개수마다, 그보다 하나 덜 접으면 넘쳤던 바깥 폭. 그 폭 이하에서는 다시 펴지 않는다
   * (폈다가 넘쳐서 접고, 다시 펴는 것을 매 프레임 되풀이하며 화면이 떨리지 않게)
   */
  const overflowAtRef = useRef(new Map<number, number>())
  // 막대 폭이 바뀌면 다시 그려서(아래 useLayoutEffect) 다시 잰다
  const [, setMeasureTick] = useState(0)
  useEffect(() => {
    const surface = surfaceRef.current
    const host = surface?.parentElement
    if (surface === null || host === null || host === undefined || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => setMeasureTick((tick) => tick + 1))
    observer.observe(host)
    observer.observe(surface)
    return () => observer.disconnect()
  }, [])
  // 묶음이 늘거나 줄면(예: CPU·메모리 표시를 켬) 처음부터 다시 잰다
  const presentKey = present.join(',')
  const presentKeyRef = useRef(presentKey)
  useLayoutEffect(() => {
    if (presentKeyRef.current !== presentKey) {
      presentKeyRef.current = presentKey
      overflowAtRef.current.clear()
      if (collapsedCount !== 0) {
        setCollapsedCount(0)
        return
      }
    }
    const surface = surfaceRef.current
    if (surface === null || surface.clientWidth <= 0) return
    for (const group of present) {
      if (collapsed.has(group)) continue
      const parts = [...surface.querySelectorAll<HTMLElement>(`[data-collapse="${group}"]`)]
      const width = parts.reduce((sum, part) => sum + part.offsetWidth + 4, 0)
      // 넘칠 때는 단추가 눌려 좁게 재일 수 있으니, 잰 것 중 가장 넓은 폭을 쓴다
      if (width > 0) widthsRef.current.set(group, Math.max(width, widthsRef.current.get(group) ?? 0))
    }
    // 막대(surface)는 내용만큼만 넓어지기도 해서, 쓸 수 있는 폭은 바깥 칸(PDF 칸 폭)으로 잰다
    const host = surface.parentElement
    const capacity = host === null ? surface.clientWidth : host.clientWidth
    if (surface.scrollWidth > surface.clientWidth + 1) {
      if (collapsedCount < present.length) {
        overflowAtRef.current.set(collapsedCount + 1, capacity)
        setCollapsedCount(collapsedCount + 1)
      }
      return
    }
    if (collapsedCount === 0) return
    // 이 폭에서 이미 한 번 폈다가 넘쳤으면 더 넓어질 때까지 기다린다
    const overflowedAt = overflowAtRef.current.get(collapsedCount)
    if (overflowedAt !== undefined && capacity <= overflowedAt + RESTORE_SLACK) return
    const style = getComputedStyle(surface)
    const gap = Number.parseFloat(style.columnGap) || 0
    const children = [...surface.children].filter((child): child is HTMLElement => child instanceof HTMLElement && child.offsetWidth > 0)
    const used = children.reduce((sum, child) => sum + child.offsetWidth, 0) + gap * Math.max(children.length - 1, 0)
      + (Number.parseFloat(style.paddingLeft) || 0) + (Number.parseFloat(style.paddingRight) || 0)
    const next = present[Math.min(collapsedCount, present.length) - 1]
    const need = next === undefined ? Infinity : widthsRef.current.get(next) ?? Infinity
    if (capacity - used >= need + gap + RESTORE_SLACK) setCollapsedCount(collapsedCount - 1)
  })

  // ---------- 「…」 메뉴 ----------
  const [moreOpen, setMoreOpen] = useState<{ right: number; bottom: number } | null>(null)
  useEffect(() => {
    if (moreOpen === null) return
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape') setMoreOpen(null) }
    window.addEventListener('keydown', close)
    return () => window.removeEventListener('keydown', close)
  }, [moreOpen])
  const runMore = (action: () => void) => () => {
    setMoreOpen(null)
    action()
  }

  useEffect(() => setPageInput(String(page)), [page])
  useEffect(() => setZoomInput(String(zoomPercent)), [zoomPercent])

  const commitPage = () => {
    const text = pageInput.trim()
    const value = Number(text)
    if (text !== '' && Number.isFinite(value) && pageCount > 0) {
      onPageChange(Math.min(Math.max(Math.round(value), 1), pageCount))
      return
    }
    // 숫자가 아니면 절·표·그림 번호로 찾아 간다. 못 찾으면 원래 쪽 번호로 돌린다.
    if (text !== '' && text !== String(page) && onGoto !== undefined) {
      void onGoto(text).then(() => setPageInput(String(page)))
      return
    }
    setPageInput(String(page))
  }

  const commitZoom = () => {
    const value = Number(zoomInput)
    if (Number.isFinite(value)) onZoomChange(clampZoom(value))
    else setZoomInput(String(zoomPercent))
  }

  return (
    <div className="pdf-bottom-bar-surface" ref={surfaceRef} onWheel={scrollHorizontalStrip}>
      <div className="pdf-bottom-page">
        {onBack !== undefined && shown('history') ? (
          <button type="button" data-collapse="history" className="bottombar-btn pdf-bottom-history" aria-label={t('뒤로')} title={t('뒤로 (Alt+←)')} disabled={!canGoBack} onClick={onBack}>
            <ArrowLeft size={16} aria-hidden="true" />
          </button>
        ) : null}
        {onForward !== undefined && shown('history') ? (
          <button type="button" data-collapse="history" className="bottombar-btn pdf-bottom-history" aria-label={t('앞으로')} title={t('앞으로 (Alt+→)')} disabled={!canGoForward} onClick={onForward}>
            <ArrowRight size={16} aria-hidden="true" />
          </button>
        ) : null}
        {/* 묶음 사이 선: 읽던 자리 오가기 | 쪽 넘기기 | (배경) | 맞춤 | 배율 */}
        {(onBack !== undefined || onForward !== undefined) && shown('history') ? <span className="bottombar-divider" /> : null}
        {shown('edge') ? (
          <button type="button" data-collapse="edge" className="bottombar-btn pdf-bottom-edge" aria-label={t('첫 페이지')} title={t('첫 페이지 (Home)')} disabled={page <= 1} onClick={() => onPageChange(1)}>
            <CaretDoubleLeft size={16} aria-hidden="true" />
          </button>
        ) : null}
        {shown('pageStep') ? (
          <button type="button" data-collapse="pageStep" className="bottombar-btn" aria-label={t('이전 페이지')} title={t('이전 페이지')} disabled={page <= 1} onClick={() => onPageChange(Math.max(page - 1, 1))}>
            <CaretLeft size={16} aria-hidden="true" />
          </button>
        ) : null}
        <input
          aria-label={t('페이지')}
          className="bottombar-goto"
          type="text"
          inputMode="text"
          title={t('쪽·절·표 번호로 이동 (Ctrl+G)')}
          placeholder={t('쪽·5.1.3·Table 52')}
          value={pageInput}
          onFocus={(event) => event.currentTarget.select()}
          onChange={(event) => setPageInput(event.target.value)}
          onBlur={commitPage}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              commitPage()
              event.currentTarget.blur()
            } else if (event.key === 'Escape') {
              setPageInput(String(page))
              event.currentTarget.blur()
            }
          }}
        />
        <span>/ {pageCount}</span>
        {shown('pageStep') ? (
          <button type="button" data-collapse="pageStep" className="bottombar-btn" aria-label={t('다음 페이지')} title={t('다음 페이지')} disabled={pageCount === 0 || page >= pageCount} onClick={() => onPageChange(Math.min(page + 1, pageCount))}>
            <CaretRight size={16} aria-hidden="true" />
          </button>
        ) : null}
        {shown('edge') ? (
          <button type="button" data-collapse="edge" className="bottombar-btn pdf-bottom-edge" aria-label={t('마지막 페이지')} title={t('마지막 페이지 (End)')} disabled={pageCount === 0 || page >= pageCount} onClick={() => onPageChange(pageCount)}>
            <CaretDoubleRight size={16} aria-hidden="true" />
          </button>
        ) : null}
      </div>


      <div className="pdf-bottom-view">
        <span className="bottombar-divider" />
        {extraControls !== undefined ? <>{extraControls}<span className="bottombar-divider" /></> : null}
        {shown('fit') ? (
          <>
            <button type="button" data-collapse="fit" className="bottombar-btn bottombar-fit" aria-label={t('폭 맞춤')} title={t('폭 맞춤')} onClick={onFitWidth}><ArrowsHorizontal size={16} aria-hidden="true" /></button>
            <button type="button" data-collapse="fit" className="bottombar-btn bottombar-fit" aria-label={t('페이지 맞춤')} title={t('페이지 맞춤')} onClick={onFitPage}><CornersOut size={16} aria-hidden="true" /></button>
          </>
        ) : null}
        {onFitHeight !== undefined && shown('fitExtra') ? <button type="button" data-collapse="fitExtra" className="bottombar-btn bottombar-fit bottombar-fit-extra" aria-label={t('높이 맞춤')} title={t('높이 맞춤')} onClick={onFitHeight}><ArrowsVertical size={16} aria-hidden="true" /></button> : null}
        {onActualSize !== undefined && shown('fitExtra') ? <button type="button" data-collapse="fitExtra" className="bottombar-btn bottombar-fit bottombar-fit-extra bottombar-actual" aria-label={t('실제 크기')} title={t('실제 크기 (100%)')} onClick={onActualSize}>1:1</button> : null}
        {shown('fit') || (shown('fitExtra') && (onFitHeight !== undefined || onActualSize !== undefined)) ? <span className="bottombar-divider" /> : null}
        {shown('zoomStep') ? <button type="button" data-collapse="zoomStep" className="bottombar-btn" aria-label={t('축소')} title={t('축소 (Ctrl+-)')} onClick={onZoomOut}><Minus size={16} aria-hidden="true" /></button> : null}
        {shown('zoomRange') ? <input aria-label={t('배율')} data-collapse="zoomRange" className="pdf-bottom-zoom-range" type="range" min={ZOOM_MIN} max={ZOOM_MAX} step="5" value={zoomPercent} style={rangeFillStyle(zoomPercent, ZOOM_MIN, ZOOM_MAX)} onChange={(event) => onZoomChange(Number(event.target.value))} /> : null}
        {shown('zoomStep') ? <button type="button" data-collapse="zoomStep" className="bottombar-btn" aria-label={t('확대')} title={t('확대 (Ctrl+=)')} onClick={onZoomIn}><Plus size={16} aria-hidden="true" /></button> : null}
        {shown('zoomInput') ? <label className="pdf-bottom-zoom" data-collapse="zoomInput">
          <input aria-label={t('배율 직접 입력')} type="number" min={ZOOM_MIN} max={ZOOM_MAX} value={zoomInput} onChange={(event) => setZoomInput(event.target.value)} onBlur={commitZoom} onKeyDown={(event) => { if (event.key === 'Enter') commitZoom() }} />
          <span>%</span>
        </label> : null}
      </div>
      {usageMeter && shown('usage') ? <div className="pdf-usage-slot" data-collapse="usage"><UsageMeter /></div> : null}
      {collapsed.size > 0 ? (
        <button
          type="button"
          className="bottombar-btn pdf-bottom-more"
          aria-label={t('더 보기')}
          title={t('더 보기')}
          aria-haspopup="menu"
          aria-expanded={moreOpen !== null}
          onClick={(event) => {
            if (moreOpen !== null) {
              setMoreOpen(null)
              return
            }
            const rect = event.currentTarget.getBoundingClientRect()
            setMoreOpen({ right: Math.max(window.innerWidth - rect.right, 8), bottom: window.innerHeight - rect.top + 6 })
          }}
        >
          <DotsThree size={18} weight="bold" aria-hidden="true" />
        </button>
      ) : null}
      {moreOpen !== null && collapsed.size > 0 ? createPortal(
        <>
          <div className="pdf-bottom-more-backdrop" onPointerDown={() => setMoreOpen(null)} />
          <div className="pdf-bottom-more-menu" role="menu" aria-label={t('접어 둔 단추')} style={{ right: moreOpen.right, bottom: moreOpen.bottom }}>
            {collapsed.has('history') ? (
              <>
                {onBack !== undefined ? <button type="button" role="menuitem" disabled={!canGoBack} onClick={runMore(onBack)}><ArrowLeft size={16} aria-hidden="true" />{t('뒤로')} <kbd>Alt+←</kbd></button> : null}
                {onForward !== undefined ? <button type="button" role="menuitem" disabled={!canGoForward} onClick={runMore(onForward)}><ArrowRight size={16} aria-hidden="true" />{t('앞으로')} <kbd>Alt+→</kbd></button> : null}
              </>
            ) : null}
            {collapsed.has('edge') ? (
              <>
                <button type="button" role="menuitem" disabled={page <= 1} onClick={runMore(() => onPageChange(1))}><CaretDoubleLeft size={16} aria-hidden="true" />{t('첫 페이지')} <kbd>Home</kbd></button>
                <button type="button" role="menuitem" disabled={pageCount === 0 || page >= pageCount} onClick={runMore(() => onPageChange(pageCount))}><CaretDoubleRight size={16} aria-hidden="true" />{t('마지막 페이지')} <kbd>End</kbd></button>
              </>
            ) : null}
            {collapsed.has('fit') || collapsed.has('fitExtra') ? <hr /> : null}
            {collapsed.has('fit') ? (
              <>
                <button type="button" role="menuitem" onClick={runMore(onFitWidth)}><ArrowsHorizontal size={16} aria-hidden="true" />{t('폭 맞춤')}</button>
                <button type="button" role="menuitem" onClick={runMore(onFitPage)}><CornersOut size={16} aria-hidden="true" />{t('페이지 맞춤')}</button>
              </>
            ) : null}
            {collapsed.has('fitExtra') ? (
              <>
                {onFitHeight !== undefined ? <button type="button" role="menuitem" onClick={runMore(onFitHeight)}><ArrowsVertical size={16} aria-hidden="true" />{t('높이 맞춤')}</button> : null}
                {onActualSize !== undefined ? <button type="button" role="menuitem" onClick={runMore(onActualSize)}><span className="pdf-bottom-more-glyph" aria-hidden="true">1:1</span>{t('실제 크기 (100%)')}</button> : null}
              </>
            ) : null}
            {collapsed.has('pageStep') ? (
              <>
                <button type="button" role="menuitem" disabled={page <= 1} onClick={runMore(() => onPageChange(Math.max(page - 1, 1)))}><CaretLeft size={16} aria-hidden="true" />{t('이전 페이지')}</button>
                <button type="button" role="menuitem" disabled={pageCount === 0 || page >= pageCount} onClick={runMore(() => onPageChange(Math.min(page + 1, pageCount)))}><CaretRight size={16} aria-hidden="true" />{t('다음 페이지')}</button>
              </>
            ) : null}
            {collapsed.has('zoomStep') ? (
              <>
                <button type="button" role="menuitem" onClick={runMore(onZoomOut)}><Minus size={16} aria-hidden="true" />{t('축소')} <kbd>Ctrl+-</kbd></button>
                <button type="button" role="menuitem" onClick={runMore(onZoomIn)}><Plus size={16} aria-hidden="true" />{t('확대')} <kbd>Ctrl+=</kbd></button>
              </>
            ) : null}
            {collapsed.has('zoomRange') ? (
              <label className="pdf-bottom-more-range">
                <span>{t('배율 {percent}%', { percent: zoomPercent })}</span>
                <input aria-label={t('배율')} type="range" min={ZOOM_MIN} max={ZOOM_MAX} step="5" value={zoomPercent} style={rangeFillStyle(zoomPercent, ZOOM_MIN, ZOOM_MAX)} onChange={(event) => onZoomChange(Number(event.target.value))} />
              </label>
            ) : null}
            {collapsed.has('usage') ? (
              <>
                <hr />
                <div className="pdf-bottom-more-usage"><UsageMeter /></div>
              </>
            ) : null}
          </div>
        </>,
        document.body,
      ) : null}
    </div>
  )
}
