import { t } from '../i18n'
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { ArrowArcLeft, ArrowArcRight, ArrowLeft, CaretLeft, CaretRight, FilePlus, Trash } from '@phosphor-icons/react'
import { openPdf, pageImageUrl, pickPdfFile } from '../bridge/pdf'
import {
  initialPageItems,
  isUnchanged,
  moveItems,
  rotateItem,
  type PageEditItem,
} from '../core/pdfPageEdit'
import { errorText } from '../core/errorText'
import {
  draggedPageOf,
  drainPages,
  forgetPageEditDraft,
  getPageDragHover,
  keepPageEditDraft,
  startPageDrag,
  subscribePageDragHover,
  subscribePages,
  takePageEditDraft,
} from './pageDrag'
import '../ui/page-edit.css'

/** 화면의 쪽 하나. 끼워 넣은 쪽은 그 PDF 의 docId 로 그림을 그린다 */
type DialogItem = PageEditItem & { readonly thumbDocId: string; /** 다른 PDF 에서 끌어 온 저장 전 쪽 */ readonly pending?: boolean }

interface PageEditDraft {
  readonly pageCount: number
  readonly items: DialogItem[]
}

const THUMB_WIDTH = 132
const DRAG_THRESHOLD_PX = 6

interface PageEditDialogProps {
  docId: string
  title: string
  pageCount: number
  /** 이 PDF 파일의 경로. 있어야 쪽을 다른 PDF 로 끌어 갈 수 있다 */
  sourcePath?: string
  onCancel: () => void
  /** 저장. 끝나면 대화상자를 닫는다. 실패하면 이유를 보여 주고 열어 둔다 */
  onSave: (items: readonly PageEditItem[]) => Promise<void>
}

/**
 * 쪽 편집: 순서 바꾸기(끌기·앞뒤 단추), 돌리기, 다른 PDF 의 쪽 끼워 넣기, 빼기.
 * 저장하면 원본 PDF 를 덮어쓰고(원본은 .iwae/history/pdf-edits 에 남는다) 형광펜·책갈피·
 * 노트 출처를 새 쪽으로 옮긴다.
 */
export function PageEditDialog({ docId, title, pageCount, sourcePath, onCancel, onSave }: PageEditDialogProps) {
  const [items, setItems] = useState<DialogItem[]>(() => {
    // 다른 PDF 로 끌어 가려고 잠깐 이 화면을 떠났다 돌아오면 하던 편집을 되살린다
    const draft = takePageEditDraft<PageEditDraft>(docId)
    if (draft !== undefined && draft.pageCount === pageCount) return draft.items
    return initialPageItems(pageCount).map((item) => ({ ...item, thumbDocId: docId }))
  })
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set())
  const [anchorKey, setAnchorKey] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const hover = useSyncExternalStore(subscribePageDragHover, getPageDragHover)
  const dropIndex = hover !== null && hover.docId === docId ? hover.index : null
  const itemsRef = useRef(items)
  itemsRef.current = items
  const closedRef = useRef(false)
  const gridRef = useRef<HTMLDivElement>(null)
  const ratio = typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1

  const selectedIndexes = useMemo(
    () => items.flatMap((item, index) => selected.has(item.key) ? [index] : []),
    [items, selected],
  )
  const removedCount = useMemo(() => {
    const kept = new Set(items.filter((item) => item.source === undefined).map((item) => item.page))
    return pageCount - kept.size
  }, [items, pageCount])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) {
        closedRef.current = true
        onCancel()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [busy, onCancel])

  // 끌려 온 쪽(다른 PDF 에서)을 저장 전 상태로 받는다. 이 화면이 열려 있지 않았으면 열릴 때 한꺼번에 받는다
  useEffect(() => {
    const take = () => {
      const batches = drainPages(docId)
      if (batches.length === 0) return
      const stamp = Date.now()
      let ordinal = 0
      const parts = batches.map((batch) => ({
        at: batch.index,
        part: batch.pages.map((page): DialogItem => {
          ordinal += 1
          return { key: `insert:${stamp}:${ordinal}`, source: page.source, page: page.page, rotate: page.rotate, sourceTitle: page.sourceTitle, thumbDocId: page.thumbDocId, pending: true }
        }),
      }))
      const inserted = parts[parts.length - 1]?.part ?? []
      const from = batches[batches.length - 1]?.pages[0]?.sourceTitle ?? ''
      const count = batches.reduce((sum, batch) => sum + batch.pages.length, 0)
      setItems((current) => {
        let next = current
        for (const { at: wanted, part } of parts) {
          const at = wanted === null ? next.length : Math.min(Math.max(wanted, 0), next.length)
          next = [...next.slice(0, at), ...part, ...next.slice(at)]
        }
        return next
      })
      // setItems 의 계산은 렌더 때 돈다 — 그 뒤에 고름·안내를 건다
      queueMicrotask(() => {
        setSelected(new Set(inserted.map((item) => item.key)))
        setMessage(t('{name} 에서 {count}쪽을 끌어 넣었습니다. 저장을 눌러야 이 PDF 에 들어가고, 취소하면 사라집니다.', { name: from, count }))
        const first = inserted[0]
        if (first !== undefined) requestAnimationFrame(() => gridRef.current?.querySelector<HTMLElement>(`[data-item-key="${first.key}"]`)?.scrollIntoView({ block: 'nearest' }))
      })
    }
    take()
    return subscribePages(docId, take)
  }, [docId])

  // 화면을 떠날 때(저장·취소가 아니면) 편집을 초안으로 남긴다
  useEffect(() => () => {
    if (closedRef.current || isUnchanged(itemsRef.current, pageCount)) forgetPageEditDraft(docId)
    else keepPageEditDraft(docId, { pageCount, items: itemsRef.current } satisfies PageEditDraft)
  }, [docId, pageCount])

  const close = () => {
    closedRef.current = true
    onCancel()
  }

  const select = (event: React.MouseEvent, item: DialogItem, index: number) => {
    if (event.shiftKey && anchorKey !== null) {
      const from = items.findIndex((candidate) => candidate.key === anchorKey)
      const [start, end] = from < index ? [from, index] : [index, from]
      setSelected(new Set(items.slice(start, end + 1).map((candidate) => candidate.key)))
      return
    }
    if (event.ctrlKey || event.metaKey) {
      setSelected((current) => {
        const next = new Set(current)
        if (next.has(item.key)) next.delete(item.key)
        else next.add(item.key)
        return next
      })
      setAnchorKey(item.key)
      return
    }
    setSelected(new Set([item.key]))
    setAnchorKey(item.key)
  }

  const targets = () => selectedIndexes.length > 0 ? selectedIndexes : []
  const rotate = (by: 90 | -90) => setItems((current) => current.map((item) => selected.has(item.key) ? rotateItem(item, by) as DialogItem : item))
  const shift = (step: -1 | 1) => {
    const indexes = targets()
    if (indexes.length === 0) return
    const to = step < 0 ? Math.max(0, indexes[0]! - 1) : Math.min(items.length, indexes[indexes.length - 1]! + 2)
    setItems((current) => moveItems(current, indexes, to))
  }
  const remove = () => {
    if (selected.size === 0) return
    if (selected.size >= items.length) {
      setMessage(t('쪽을 모두 뺄 수는 없습니다'))
      return
    }
    setItems((current) => current.filter((item) => !selected.has(item.key)))
    setSelected(new Set())
  }

  const insertFromPdf = async () => {
    try {
      const path = await pickPdfFile()
      if (path === null) return
      const meta = await openPdf(path)
      const name = path.split(/[\\/]/u).at(-1) ?? path
      const after = selectedIndexes.length > 0 ? selectedIndexes[selectedIndexes.length - 1]! + 1 : items.length
      const stamp = Date.now()
      const inserted: DialogItem[] = Array.from({ length: meta.pageCount }, (_, page) => ({
        key: `insert:${stamp}:${page}`,
        source: path,
        page,
        rotate: 0,
        sourceTitle: name,
        thumbDocId: meta.docId,
      }))
      setItems((current) => [...current.slice(0, after), ...inserted, ...current.slice(after)])
      setSelected(new Set(inserted.map((item) => item.key)))
      setMessage(t('{name} 의 {count}쪽을 끼워 넣었습니다. 필요 없는 쪽은 골라서 빼세요.', { name, count: meta.pageCount }))
    } catch (cause) {
      setMessage(t('PDF 를 열지 못했습니다: {error}', { error: errorText(cause) }))
    }
  }

  /** 카드를 끌어 다른 자리에 놓거나, 다른 PDF 의 탭·쪽 편집 화면에 놓는다. 고른 쪽이 여럿이면 함께 옮긴다 */
  const startDrag = (event: React.PointerEvent<HTMLElement>, item: DialogItem, index: number) => {
    if (event.button !== 0) return
    const moving = selected.has(item.key) ? selectedIndexes : [index]
    const own = sourcePath === undefined ? null : { path: sourcePath, title, docId }
    startPageDrag(event, event.currentTarget, {
      docId,
      pages: own === null ? null : moving.map((at) => draggedPageOf(items[at]!, own)),
      onReorder: (to) => setItems((current) => moveItems(current, moving, to)),
    })
  }

  const save = async () => {
    if (isUnchanged(items, pageCount)) {
      close()
      return
    }
    setBusy(true)
    setMessage(t('저장하는 중…'))
    try {
      closedRef.current = true
      await onSave(items)
    } catch (cause) {
      closedRef.current = false
      setMessage(t('저장하지 못했습니다: {error}', { error: errorText(cause) }))
      setBusy(false)
    }
  }

  const footerText = message ?? (removedCount > 0
    ? t('원본 {count}쪽을 뺍니다 — 그 쪽의 형광펜·책갈피도 함께 사라집니다.', { count: removedCount })
    : t('쪽을 끌어 옮기거나, 골라서(Ctrl·Shift 로 여럿) 돌리고 뺄 수 있습니다. 저장하면 원본 PDF 를 덮어씁니다(원본은 .iwae/history/pdf-edits 에 남습니다).'))

  return (
    <div className="page-edit-backdrop" role="presentation">
      <div className="page-edit" role="region" aria-label={t('{title} 쪽 편집', { title })}>
        <header className="page-edit-head">
          <button type="button" className="page-edit-back" onClick={close} disabled={busy}><ArrowLeft size={15} aria-hidden="true" />{t('PDF 로 돌아가기')}</button>
          <div className="page-edit-title">
            <strong>{t('쪽 편집')}</strong>
            <span>{title}</span>
          </div>
        </header>
        <div className="page-edit-tools" role="toolbar" aria-label={t('쪽 편집 도구')}>
          <button type="button" disabled={selected.size === 0} onClick={() => rotate(-90)} title={t('왼쪽으로 돌리기')}><ArrowArcLeft size={16} aria-hidden="true" /> {t('왼쪽으로')}</button>
          <button type="button" disabled={selected.size === 0} onClick={() => rotate(90)} title={t('오른쪽으로 돌리기')}><ArrowArcRight size={16} aria-hidden="true" /> {t('오른쪽으로')}</button>
          <span className="page-edit-sep" />
          <button type="button" disabled={selected.size === 0} onClick={() => shift(-1)} title={t('앞으로 한 칸')}><CaretLeft size={16} aria-hidden="true" /> {t('앞으로')}</button>
          <button type="button" disabled={selected.size === 0} onClick={() => shift(1)} title={t('뒤로 한 칸')}>{t('뒤로')} <CaretRight size={16} aria-hidden="true" /></button>
          <span className="page-edit-sep" />
          <button type="button" onClick={() => void insertFromPdf()} title={t('고른 쪽 뒤에 다른 PDF 쪽 끼워 넣기')}><FilePlus size={16} aria-hidden="true" /> {t('다른 PDF 쪽 넣기')}</button>
          <button type="button" disabled={selected.size === 0} onClick={remove} title={t('고른 쪽 빼기')}><Trash size={16} aria-hidden="true" /> {t('빼기')}</button>
          <span className="page-edit-count">{t('{count}쪽', { count: items.length })}{selected.size > 0 ? ` · ${t('{count}쪽 고름', { count: selected.size })}` : ''}</span>
        </div>
        <div className="page-edit-grid" ref={gridRef} data-doc-id={docId}>
          {items.map((item, index) => {
            const isSelected = selected.has(item.key)
            return (
              <div
                key={item.key}
                data-page-index={index}
                data-item-key={item.key}
                className={[
                  'page-edit-card',
                  isSelected ? 'page-edit-card-selected' : '',
                  item.pending === true ? 'page-edit-card-pending' : '',
                  dropIndex === index ? 'page-edit-drop-before' : '',
                  dropIndex === index + 1 && index === items.length - 1 ? 'page-edit-drop-after' : '',
                ].filter(Boolean).join(' ')}
                onClick={(event) => select(event, item, index)}
                onPointerDown={(event) => startDrag(event, item, index)}
              >
                {/* 옆으로 돌린 쪽(90°·270°)은 돌린 뒤에도 칸 안에 다 들어오게 작게 */}
                {item.pending === true ? <span className="page-edit-pending-chip">{t('새로 끼움')}</span> : null}
                <div className={`page-edit-thumb${Math.abs(item.rotate) % 180 === 90 ? ' page-edit-thumb-quarter' : ''}`}>
                  <img
                    src={pageImageUrl(item.thumbDocId, item.page, Math.round(THUMB_WIDTH * ratio))}
                    alt=""
                    loading="lazy"
                    draggable={false}
                    style={{ transform: `rotate(${item.rotate}deg)` }}
                  />
                </div>
                <span className="page-edit-label">
                  <b>{index + 1}</b>
                  {item.source === undefined
                    ? (item.page === index ? '' : <small>{t('원래 {page}쪽', { page: item.page + 1 })}</small>)
                    : <small title={item.sourceTitle}>{t('끼움 · {page}쪽', { page: item.page + 1 })}</small>}
                  {item.rotate !== 0 ? <small>↻{item.rotate}°</small> : null}
                </span>
              </div>
            )
          })}
        </div>
        <footer className="page-edit-foot">
          <span className="page-edit-message" role="status" title={footerText}>{footerText}</span>
          <button type="button" className="page-edit-cancel" onClick={close} disabled={busy}>{t('취소')}</button>
          <button type="button" className="page-edit-save" onClick={() => void save()} disabled={busy}>{busy ? t('저장 중…') : t('저장')}</button>
        </footer>
      </div>
    </div>
  )
}
