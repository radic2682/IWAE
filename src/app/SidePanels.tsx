import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { CaretDown, CaretRight } from '@phosphor-icons/react'
import type { PdfDocMeta, PdfOutlineEntry } from '../bridge/pdf'
import { pageImageUrl, pdfOutline } from '../bridge/pdf'
import type { PdfBookmark } from '../core/pdfBookmarks'
import { pick, t } from '../i18n'
import { usePdfViewport } from '../pdf/pdfViewportStore'
import type { VisibleRegion } from '../pdf/pageLayout'

/**
 * 상단바의 축소판·목차 버튼이 켜졌을 때 Sidebar 대신 뜨는 패널 두 개.
 * 둘 다 "지금 왼쪽 패널에서 활성 탭인 PDF"를 보여준다 — vault 전체가
 * 아니라 지금 읽고 있는 문서 하나의 부속물이기 때문이다.
 */

/** 축소판 그림 폭은 이 단위로 올려 잡는다(패널 폭이 조금 바뀔 때마다 다시 그리지 않게) */
const THUMBNAIL_WIDTH_STEP = 64
/** 보이는 곳 위아래로 이만큼(px) 미리 그린다 */
const THUMBNAIL_PRELOAD_PX = 800

interface PanelProps {
  activeDoc: PdfDocMeta | null
  /** 지금 보고 있는 쪽(0-기반). 목차·축소판에서 그 자리를 칠한다 */
  currentPage?: number
  onSelectPage?: (page: number) => void
  /** 보고 있는 곳을 알려 주는 문서 창(id). 주면 축소판 위에 그 창에 보이는 부분을 사각형으로 그린다 */
  viewportPane?: string | null
  bookmarks?: readonly PdfBookmark[]
  onRemoveBookmark?: (bookmark: PdfBookmark) => void
}

/**
 * 쪽 수가 많아도(1,299쪽짜리 교재) 화면 근처의 축소판만 그림을 요청한다.
 * 그림 폭은 실제 표시 폭 × 화면 배율이라 흐리지 않다.
 */
/**
 * 축소판 지연 로딩: 스크롤 칸(`root`) 안의 `.thumb-item[data-page]` 중 화면 근처의 쪽 번호와,
 * 표시 폭 × 화면 배율에 맞춘 그림 폭을 돌려준다. `layoutKey` 가 바뀌면(항목이 다시 그려지면) 다시 잰다.
 */
function useLazyThumbnails(
  scrollRef: { readonly current: HTMLDivElement | null },
  activeDoc: PdfDocMeta | null,
  layoutKey: unknown,
): { visible: ReadonlySet<number>; renderWidth: number } {
  const [visible, setVisible] = useState<ReadonlySet<number>>(() => new Set())
  const [renderWidth, setRenderWidth] = useState(0)

  useEffect(() => {
    setVisible(new Set())
  }, [activeDoc?.docId])

  useEffect(() => {
    const root = scrollRef.current
    if (root === null || activeDoc === null) return
    const measure = () => {
      const item = root.querySelector<HTMLElement>('.thumb-frame')
      const css = item?.clientWidth ?? root.clientWidth
      const dpr = window.devicePixelRatio || 1
      setRenderWidth(Math.max(THUMBNAIL_WIDTH_STEP, Math.ceil((css * dpr) / THUMBNAIL_WIDTH_STEP) * THUMBNAIL_WIDTH_STEP))
    }
    measure()
    const resize = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : null
    resize?.observe(root)
    if (typeof IntersectionObserver !== 'function') {
      setVisible(new Set(Array.from({ length: activeDoc.pageCount }, (_, page) => page)))
      return () => resize?.disconnect()
    }
    const intersect = new IntersectionObserver((entries) => {
      setVisible((current) => {
        const next = new Set(current)
        for (const entry of entries) {
          const page = Number((entry.target as HTMLElement).dataset.page)
          if (entry.isIntersecting) next.add(page)
          else next.delete(page)
        }
        return next
      })
    }, { root, rootMargin: `${THUMBNAIL_PRELOAD_PX}px 0px` })
    root.querySelectorAll('.thumb-item').forEach((item) => intersect.observe(item))
    return () => {
      intersect.disconnect()
      resize?.disconnect()
    }
  }, [activeDoc, layoutKey, scrollRef])

  return { visible, renderWidth }
}

/** 축소판 하나(지연 로딩 그림 + 쪽 번호) */
function ThumbnailItem({ activeDoc, page, current, visible, renderWidth, onSelectPage, region }: {
  readonly activeDoc: PdfDocMeta
  readonly page: number
  readonly current: boolean
  readonly visible: boolean
  readonly renderWidth: number
  readonly onSelectPage?: (page: number) => void
  /** PDF 창이 지금 이 쪽에서 보여 주는 부분 */
  readonly region?: VisibleRegion
}) {
  const [width, height] = activeDoc.pageSizes[page] ?? activeDoc.pageSizes[0] ?? [612, 792]
  return (
    <button
      type="button"
      data-page={page}
      className={current ? 'thumb-item thumb-item-current' : 'thumb-item'}
      aria-current={current ? 'page' : undefined}
      aria-label={t('{page}쪽으로 이동', { page: page + 1 })}
      onClick={() => onSelectPage?.(page)}
    >
      <span className="thumb-frame" style={{ aspectRatio: `${width} / ${height}` }}>
        {visible && renderWidth > 0 ? (
          <img
            className="thumb-img"
            src={pageImageUrl(activeDoc.docId, page, renderWidth)}
            alt={t('{page} 페이지', { page: page + 1 })}
            decoding="async"
            draggable={false}
          />
        ) : null}
        {region === undefined ? null : (
          // 보고 있는 곳: 쪽 크기에 대한 비율로 놓는다
          <span
            className="thumb-viewport"
            aria-hidden="true"
            style={{ left: `${region.x * 100}%`, top: `${region.y * 100}%`, width: `${region.w * 100}%`, height: `${region.h * 100}%` }}
          />
        )}
      </span>
      <span className="thumb-num">{page + 1}</span>
    </button>
  )
}

/** 미리보기 축소판 줄 수(1단·2단). 미리보기와 목차·미리보기가 함께 쓰고, 이 PC 에 기억한다 */
const PREVIEW_COLUMNS_KEY = 'iwae.outlinePreview.columns'

function readPreviewColumns(): 1 | 2 {
  try {
    return window.localStorage.getItem(PREVIEW_COLUMNS_KEY) === '1' ? 1 : 2
  } catch {
    return 2
  }
}

export function usePreviewColumns(): [1 | 2, (next: 1 | 2) => void] {
  const [columns, setColumns] = useState<1 | 2>(readPreviewColumns)
  const changeColumns = (next: 1 | 2) => {
    setColumns(next)
    try {
      window.localStorage.setItem(PREVIEW_COLUMNS_KEY, String(next))
    } catch {
      // 기억 못 해도 이번에는 그대로 쓴다
    }
  }
  return [columns, changeColumns]
}

export function PreviewColumnsSwitch({ columns, onChange }: { readonly columns: 1 | 2; readonly onChange: (next: 1 | 2) => void }) {
  return (
    <div className="outline-preview-columns" role="radiogroup" aria-label={t('미리보기 줄 수')}>
      {([1, 2] as const).map((count) => (
        <button
          key={count}
          type="button"
          role="radio"
          aria-checked={columns === count}
          className={columns === count ? 'outline-preview-column-on' : undefined}
          onClick={() => onChange(count)}
        >
          {t('{count}단', { count })}
        </button>
      ))}
    </div>
  )
}

/** 문서 창 viewportPane 이 지금 보여 주는 부분을 쪽 번호별로(그 창이 activeDoc 을 보고 있을 때만) */
function useViewportRegions(viewportPane: string | null | undefined, activeDoc: PdfDocMeta | null): ReadonlyMap<number, VisibleRegion> {
  const view = usePdfViewport(viewportPane ?? null)
  return useMemo(() => {
    const regions = new Map<number, VisibleRegion>()
    if (view === null || activeDoc === null || view.docId !== activeDoc.docId) return regions
    for (const region of view.regions) regions.set(region.page, region)
    return regions
  }, [activeDoc, view])
}

export function ThumbnailPanel({ activeDoc, currentPage, onSelectPage, viewportPane }: PanelProps) {
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const viewRegions = useViewportRegions(viewportPane, activeDoc)
  const [columns, changeColumns] = usePreviewColumns()
  const { visible, renderWidth } = useLazyThumbnails(scrollRef, activeDoc, columns)

  // 지금 쪽의 축소판이 보이게 한다
  useEffect(() => {
    if (currentPage === undefined) return
    const item = scrollRef.current?.querySelector<HTMLElement>(`.thumb-item[data-page="${currentPage}"]`)
    item?.scrollIntoView?.({ block: 'nearest' })
  }, [currentPage, activeDoc?.docId, columns])

  if (activeDoc === null) {
    return <div className="side-panel-empty">{t('열린 PDF 가 없습니다')}</div>
  }

  // .sidebar 자체가 overflow:hidden 이다(Sidebar.tsx 의 vault 바닥 줄이
  // 스크롤 밖에 있어야 하기 때문). 그 안에 들어가는 이 패널도 스스로
  // 스크롤 컨테이너를 가져야 한다 — Library 모드가 side-scroll 로 하는
  // 것과 같은 이유, 같은 클래스다.
  return (
    <div className="side-scroll thumb-panel" ref={scrollRef} style={{ '--preview-columns': columns } as CSSProperties}>
      <div className="outline-preview-bar thumb-panel-bar">
        <span className="thumb-panel-count">{pick({ ko: `${activeDoc.pageCount}쪽`, en: `${activeDoc.pageCount} pages` })}</span>
        <PreviewColumnsSwitch columns={columns} onChange={changeColumns} />
      </div>
      <div className="thumb-grid">
        {Array.from({ length: activeDoc.pageCount }, (_, page) => (
          <ThumbnailItem
            key={page}
            activeDoc={activeDoc}
            page={page}
            current={page === currentPage}
            visible={visible.has(page)}
            renderWidth={renderWidth}
            onSelectPage={onSelectPage}
            region={viewRegions.get(page)}
          />
        ))}
      </div>
    </div>
  )
}

/** 목차는 세 단계(1 → 1.1 → 1.1.1)까지만 보인다. 더 깊은 항목은 쪽 수만 많고 찾아가기에 도움이 적다 */
export const OUTLINE_MAX_DEPTH = 2

export function limitOutlineDepth(entries: readonly PdfOutlineEntry[]): PdfOutlineEntry[] {
  return entries.filter((entry) => entry.depth <= OUTLINE_MAX_DEPTH)
}

/** PDF 목차를 읽는다(깊이 제한 적용). null = 읽는 중, 'failed' = 실패 */
function useLimitedOutline(activeDoc: PdfDocMeta | null): readonly PdfOutlineEntry[] | null | 'failed' {
  const [outline, setOutline] = useState<readonly PdfOutlineEntry[] | null | 'failed'>(null)
  useEffect(() => {
    let alive = true
    setOutline(null)
    if (activeDoc === null) return () => { alive = false }
    void pdfOutline(activeDoc.docId)
      .then((entries) => {
        if (alive) setOutline(limitOutlineDepth(entries))
      })
      .catch(() => {
        if (alive) setOutline('failed')
      })
    return () => { alive = false }
  }, [activeDoc])
  return outline
}

interface OutlineGroup {
  /** 이 묶음이 시작하는 쪽에서 시작하는 목차 항목들(원래 목차 순서). 첫 묶음은 비어 있을 수 있다 */
  readonly headings: readonly { readonly entry: PdfOutlineEntry; readonly index: number }[]
  readonly startPage: number
  readonly endPage: number
}

/** 목차 항목의 시작 쪽으로 쪽들을 묶는다. 같은 쪽에서 시작하는 항목은 한 묶음의 제목들이 된다 */
export function outlinePageGroups(entries: readonly PdfOutlineEntry[], pageCount: number): OutlineGroup[] {
  const starts = new Map<number, { entry: PdfOutlineEntry; index: number }[]>()
  entries.forEach((entry, index) => {
    if (entry.page === null || entry.page < 0 || entry.page >= pageCount) return
    const list = starts.get(entry.page) ?? []
    list.push({ entry, index })
    starts.set(entry.page, list)
  })
  const startPages = [...starts.keys()].sort((left, right) => left - right)
  const groups: OutlineGroup[] = []
  if (pageCount > 0 && (startPages[0] ?? pageCount) > 0) {
    groups.push({ headings: [], startPage: 0, endPage: (startPages[0] ?? pageCount) - 1 })
  }
  startPages.forEach((page, position) => {
    const next = startPages[position + 1] ?? pageCount
    groups.push({ headings: starts.get(page) ?? [], startPage: page, endPage: next - 1 })
  })
  return groups
}

/**
 * 목차 + 미리보기. 목차 제목(세 단계까지)을 접힌 나무로 보이고, 펼친 제목 아래에 그 구간의 쪽 축소판을 늘어놓는다.
 * 맨 위에는 지금 쪽이 속한 장·절을 붙여 두어, 축소판을 훑어도 어디쯤인지 놓치지 않는다.
 */
export function OutlinePreviewPanel({ activeDoc, currentPage, onSelectPage, viewportPane }: PanelProps) {
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const viewRegions = useViewportRegions(viewportPane, activeDoc)
  const [columns, changeColumns] = usePreviewColumns()
  // 펼친 목차 항목(색인). -1 은 첫 목차 앞의 쪽들. 문서를 열면 모두 접힌 채로 시작한다
  const [expanded, setExpanded] = useState<ReadonlySet<number>>(() => new Set())
  useEffect(() => {
    setExpanded(new Set())
  }, [activeDoc?.docId])
  const outline = useLimitedOutline(activeDoc)
  const entries = Array.isArray(outline) ? outline : []
  const groups = useMemo(
    () => (activeDoc === null ? [] : outlinePageGroups(entries, activeDoc.pageCount)),
    // entries 는 outline 이 바뀔 때만 바뀐다
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [activeDoc, outline],
  )
  // 고정 위 줄의 높이(위치 줄이 두 줄로 넘어가면 커진다). 제목 줄이 그 아래에 붙는다
  const barRef = useRef<HTMLDivElement | null>(null)
  const [barHeight, setBarHeight] = useState(0)
  useEffect(() => {
    const bar = barRef.current
    if (bar === null || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => setBarHeight(bar.offsetHeight))
    observer.observe(bar)
    setBarHeight(bar.offsetHeight)
    return () => observer.disconnect()
  }, [activeDoc])
  const expandedKey = [...expanded].sort((left, right) => left - right).join(',')
  const { visible, renderWidth } = useLazyThumbnails(scrollRef, activeDoc, `${columns}:${groups.length}:${expandedKey}`)
  const structure = useMemo(() => outlineStructure(entries), [entries])
  const current = useMemo(() => currentOutlineIndex(entries, currentPage), [currentPage, entries])
  const ancestorsOf = (index: number): number[] => {
    const chain: number[] = []
    for (let up = structure.parent[index] ?? -1; up >= 0; up = structure.parent[up] ?? -1) chain.push(up)
    return chain
  }
  const isVisible = (index: number) => ancestorsOf(index).every((up) => expanded.has(up))
  // 지금 자리가 접힌 가지 안이면 보이는 가장 가까운 조상을 칠한다
  const highlighted = (() => {
    if (current < 0) return -1
    if (isVisible(current)) return current
    return ancestorsOf(current).reverse().find((up) => !expanded.has(up)) ?? -1
  })()
  const toggle = (key: number) => setExpanded((previous) => {
    const next = new Set(previous)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    return next
  })
  const openAt = (key: number) => setExpanded((previous) => (previous.has(key) ? previous : new Set([...previous, key])))
  const allKeys = groups.flatMap((group) => (group.headings.length === 0 ? [-1] : group.headings.map(({ index }) => index)))
  const allExpanded = allKeys.length > 0 && allKeys.every((key) => expanded.has(key))
  const trail = (() => {
    if (current < 0) return []
    const chain = [current]
    for (let up = structure.parent[current] ?? -1; up >= 0; up = structure.parent[up] ?? -1) chain.unshift(up)
    return chain
  })()

  // 지금 쪽의 축소판이 보이게 한다
  useEffect(() => {
    if (currentPage === undefined) return
    const item = scrollRef.current?.querySelector<HTMLElement>(`.thumb-item[data-page="${currentPage}"]`)
    item?.scrollIntoView?.({ block: 'nearest' })
  }, [currentPage, activeDoc?.docId, groups, columns, expandedKey])

  if (activeDoc === null) {
    return <div className="side-panel-empty">{t('열린 PDF 가 없습니다')}</div>
  }

  return (
    <div className="side-scroll outline-preview" ref={scrollRef} style={{ '--preview-columns': columns, '--preview-bar-h': `${barHeight}px` } as CSSProperties}>
      <div className="outline-preview-bar" ref={barRef}>
      <div className="outline-preview-trail" aria-label={t('지금 위치')}>
        {trail.length === 0
          ? <span className="outline-preview-trail-empty">{outline === null ? t('목차를 읽는 중…') : outline === 'failed' ? t('목차를 읽지 못했습니다') : entries.length === 0 ? t('목차 없음') : t('앞부분')}</span>
          : trail.map((index, position) => {
              const entry = entries[index]
              if (entry === undefined) return null
              return (
                <button
                  key={index}
                  type="button"
                  className="outline-preview-crumb"
                  onClick={() => entry.page !== null && onSelectPage?.(entry.page)}
                >
                  {position > 0 ? <span className="outline-preview-crumb-sep" aria-hidden="true">›</span> : null}
                  <span className="outline-preview-crumb-title">{entry.title}</span>
                </button>
              )
            })}
      </div>
      {allKeys.length > 1 ? (
        <button
          type="button"
          className="outline-preview-expand-all"
          onClick={() => setExpanded(allExpanded ? new Set() : new Set(allKeys))}
        >
          {allExpanded ? t('모두 접기') : t('모두 펼치기')}
        </button>
      ) : null}
      <PreviewColumnsSwitch columns={columns} onChange={changeColumns} />
      </div>
      {groups.map((group) => {
        // 묶음의 마지막 제목(같은 쪽에서 시작하는 가장 안쪽 항목)이 펼쳐져 있어야 축소판이 보인다
        const ownerKey = group.headings.length === 0 ? -1 : group.headings[group.headings.length - 1]?.index ?? -1
        const ownerVisible = ownerKey < 0 || isVisible(ownerKey)
        const showPages = ownerVisible && expanded.has(ownerKey)
        const headings = group.headings.filter(({ index }) => isVisible(index))
        if (headings.length === 0 && group.headings.length > 0) return null
        const pageCount = group.endPage - group.startPage + 1
        return (
        <section key={group.startPage} className="outline-preview-group">
          {/* 제목 줄은 그 구간의 축소판을 훑는 동안 위 줄 바로 아래에 붙어 있다 */}
          <div className="outline-preview-group-head">
          {group.headings.length === 0 ? (
            <div className="outline-preview-heading-row">
              <button
                type="button"
                className="outline-preview-toggle"
                aria-label={expanded.has(-1) ? t('앞부분 접기') : t('앞부분 펼치기')}
                aria-expanded={expanded.has(-1)}
                onClick={() => toggle(-1)}
              >
                {expanded.has(-1) ? <CaretDown size={11} weight="bold" aria-hidden="true" /> : <CaretRight size={11} weight="bold" aria-hidden="true" />}
              </button>
              <button type="button" className="outline-preview-heading outline-preview-depth-0 outline-preview-heading-front" onClick={() => toggle(-1)}>
                <span className="outline-title">{t('앞부분')}</span>
                <span className="outline-page">{t('{count}쪽', { count: pageCount })}</span>
              </button>
            </div>
          ) : headings.map(({ entry, index }) => {
            const open = expanded.has(index)
            return (
              <div key={index} className="outline-preview-heading-row" style={{ '--outline-depth': entry.depth } as CSSProperties}>
                <button
                  type="button"
                  className="outline-preview-toggle"
                  aria-label={open ? t('{title} 접기', { title: entry.title }) : t('{title} 펼치기', { title: entry.title })}
                  aria-expanded={open}
                  onClick={() => toggle(index)}
                >
                  {open ? <CaretDown size={11} weight="bold" aria-hidden="true" /> : <CaretRight size={11} weight="bold" aria-hidden="true" />}
                </button>
                <button
                  type="button"
                  className={[
                    'outline-preview-heading',
                    `outline-preview-depth-${entry.depth}`,
                    index === highlighted ? 'outline-preview-heading-current' : '',
                  ].filter(Boolean).join(' ')}
                  aria-current={index === highlighted ? 'location' : undefined}
                  onClick={() => {
                    openAt(index)
                    if (entry.page !== null) onSelectPage?.(entry.page)
                  }}
                >
                  <span className="outline-title">{entry.title}</span>
                  <span className="outline-page">{t('{count}쪽', { count: (entry.page ?? 0) + 1 })}</span>
                </button>
              </div>
            )
          })}
          </div>
          {showPages ? <div className="outline-preview-grid">
            {Array.from({ length: group.endPage - group.startPage + 1 }, (_, offset) => {
              const page = group.startPage + offset
              return (
                <ThumbnailItem
                  key={page}
                  activeDoc={activeDoc}
                  page={page}
                  current={page === currentPage}
                  visible={visible.has(page)}
                  renderWidth={renderWidth}
                  onSelectPage={onSelectPage}
                  region={viewRegions.get(page)}
                />
              )
            })}
          </div> : null}
        </section>
        )
      })}
    </div>
  )
}

/**
 * 평평한 목차(깊이만 있음)를 나무로 읽는다. 항목마다 부모 색인과 자식 유무를 낸다.
 */
export function outlineStructure(entries: readonly PdfOutlineEntry[]): { parent: number[]; hasChildren: boolean[] } {
  const parent: number[] = []
  const hasChildren = entries.map(() => false)
  const stack: number[] = []
  entries.forEach((entry, index) => {
    while (stack.length > 0 && (entries[stack[stack.length - 1] ?? 0]?.depth ?? 0) >= entry.depth) stack.pop()
    const up = stack.length === 0 ? -1 : stack[stack.length - 1] ?? -1
    parent.push(up)
    if (up >= 0) hasChildren[up] = true
    stack.push(index)
  })
  return { parent, hasChildren }
}

/** 지금 쪽이 속한 목차 항목: 시작 쪽이 지금 쪽 이하인 것 중 가장 뒤의 것 */
export function currentOutlineIndex(entries: readonly PdfOutlineEntry[], page: number | undefined): number {
  if (page === undefined) return -1
  let best = -1
  let bestPage = -1
  entries.forEach((entry, index) => {
    if (entry.page === null || entry.page > page) return
    if (entry.page >= bestPage) {
      best = index
      bestPage = entry.page
    }
  })
  return best
}

export function OutlinePanel({ activeDoc, currentPage, onSelectPage, bookmarks = [], onRemoveBookmark }: PanelProps) {
  const [outline, setOutline] = useState<readonly PdfOutlineEntry[] | null>(null)
  const [failed, setFailed] = useState(false)
  // 펼친 항목(색인). 문서를 열면 모두 접힌 채로 시작한다
  const [expanded, setExpanded] = useState<ReadonlySet<number>>(() => new Set())
  const listRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    let alive = true
    setOutline(null)
    setFailed(false)
    setExpanded(new Set())
    if (activeDoc === null) return () => { alive = false }

    void pdfOutline(activeDoc.docId)
      .then((entries) => {
        if (alive) setOutline(limitOutlineDepth(entries))
      })
      .catch(() => {
        if (alive) setFailed(true)
      })

    return () => { alive = false }
  }, [activeDoc])

  const structure = useMemo(() => outlineStructure(outline ?? []), [outline])
  const current = useMemo(() => currentOutlineIndex(outline ?? [], currentPage), [currentPage, outline])
  const ancestorsOf = (index: number): number[] => {
    const chain: number[] = []
    for (let up = structure.parent[index] ?? -1; up >= 0; up = structure.parent[up] ?? -1) chain.push(up)
    return chain
  }
  const isVisible = (index: number) => ancestorsOf(index).every((up) => expanded.has(up))
  // 지금 자리가 접힌 가지 안이면 보이는 가장 가까운 조상을 칠한다
  const highlighted = (() => {
    if (current < 0) return -1
    if (isVisible(current)) return current
    return ancestorsOf(current).reverse().find((up) => !expanded.has(up)) ?? -1
  })()
  const currentPath = new Set(current < 0 ? [] : ancestorsOf(current))

  useEffect(() => {
    if (highlighted < 0) return
    const row = listRef.current?.querySelector<HTMLElement>(`[data-outline-index="${highlighted}"]`)
    if (row !== null && row !== undefined && typeof row.scrollIntoView === 'function') row.scrollIntoView({ block: 'nearest' })
  }, [highlighted])

  if (activeDoc === null) {
    return <div className="side-panel-empty">{t('열린 PDF 가 없습니다')}</div>
  }

  const expandable = structure.hasChildren.some(Boolean)
  const allExpanded = expandable && structure.hasChildren.every((has, index) => !has || expanded.has(index))

  const documentBookmarks = bookmarks.filter((bookmark) => bookmark.docId === activeDoc.docId)
  const outlineState = failed
    ? <div className="side-panel-empty side-panel-empty-inline">{t('목차를 읽지 못했습니다')}</div>
    : outline === null
      ? <div className="side-panel-empty side-panel-empty-inline">{t('목차를 읽는 중입니다')}</div>
      : outline.length === 0
        ? <div className="side-panel-empty side-panel-empty-inline">{t('이 PDF에는 목차가 없습니다')}</div>
        : null

  return (
    <div className="side-scroll">
      <section className="outline-section" aria-labelledby="outline-section-title">
        <div className="outline-section-head">
          <h2 id="outline-section-title" className="side-panel-section-title">{t('목차')}</h2>
          {outlineState === null && expandable ? (
            <button
              type="button"
              className="outline-expand-all"
              onClick={() => setExpanded(allExpanded
                ? new Set()
                : new Set(structure.hasChildren.flatMap((has, index) => (has ? [index] : []))))}
            >
              {allExpanded ? t('모두 접기') : t('모두 펼치기')}
            </button>
          ) : null}
        </div>
        {outlineState ?? <div className="outline-list" ref={listRef}>
        {(outline ?? []).map((entry, index) => {
          if (!isVisible(index)) return null
          const pageLabel = entry.page === null ? '' : t('{count}쪽', { count: entry.page + 1 })
          const open = expanded.has(index)
          const hasChildren = structure.hasChildren[index] === true
          const toggle = () => setExpanded((previous) => {
            const next = new Set(previous)
            if (next.has(index)) next.delete(index)
            else next.add(index)
            return next
          })
          return (
            <div
              key={`${entry.depth}:${entry.title}:${index}`}
              data-outline-index={index}
              className={[
                'outline-row',
                index === highlighted ? 'outline-row-current' : '',
                currentPath.has(index) && index !== highlighted ? 'outline-row-in-path' : '',
              ].filter(Boolean).join(' ')}
              style={{ '--outline-depth': entry.depth } as CSSProperties}
            >
              {hasChildren ? (
                <button
                  type="button"
                  className="outline-toggle"
                  aria-label={open ? t('{title} 접기', { title: entry.title }) : t('{title} 펼치기', { title: entry.title })}
                  aria-expanded={open}
                  onClick={toggle}
                >
                  {open ? <CaretDown size={11} weight="bold" aria-hidden="true" /> : <CaretRight size={11} weight="bold" aria-hidden="true" />}
                </button>
              ) : <span className="outline-toggle-space" aria-hidden="true" />}
              <button
                type="button"
                className="outline-item"
                aria-label={pageLabel === '' ? entry.title : `${entry.title} ${pageLabel}`}
                aria-current={index === highlighted ? 'location' : undefined}
                disabled={entry.page === null}
                onClick={() => entry.page !== null && onSelectPage?.(entry.page)}
              >
                <span className="outline-title">{entry.title}</span>
                {pageLabel === '' ? null : <span className="outline-page">{pageLabel}</span>}
              </button>
            </div>
          )
        })}
        </div>}
      </section>
      <section className="outline-section bookmark-section" aria-labelledby="bookmark-section-title">
        <h2 id="bookmark-section-title" className="side-panel-section-title">{t('책갈피')}</h2>
        {documentBookmarks.length === 0 ? (
          <div className="side-panel-empty side-panel-empty-inline">{t('꽂은 책갈피가 없습니다')}</div>
        ) : (
          <div className="outline-list bookmark-list">
            {documentBookmarks.map((bookmark) => {
              const validPage = bookmark.page >= 0 && bookmark.page < activeDoc.pageCount
              return (
                <div key={bookmark.id} className="bookmark-row">
                  <button
                    type="button"
                    className="outline-item bookmark-item"
                    aria-label={validPage ? t('{title} {page}쪽', { title: bookmark.title, page: bookmark.page + 1 }) : t('{title} 열기', { title: bookmark.title })}
                    disabled={!validPage}
                    onClick={() => validPage && onSelectPage?.(bookmark.page)}
                  >
                    <span className="outline-title">{bookmark.emoji === undefined ? null : <span className="bookmark-emoji" aria-hidden="true">{bookmark.emoji} </span>}{bookmark.title}</span>
                    <span className="outline-page">{validPage ? t('{count}쪽', { count: bookmark.page + 1 }) : t('범위 밖')}</span>
                  </button>
                  {onRemoveBookmark === undefined ? null : (
                    <button
                      type="button"
                      className="bookmark-remove"
                      aria-label={t('{title} 책갈피 삭제', { title: bookmark.title })}
                      onClick={() => onRemoveBookmark(bookmark)}
                    >
                      {t('삭제')}
                    </button>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </section>
    </div>
  )
}
