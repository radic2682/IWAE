import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react'
import { CaretDown, CaretRight } from '@phosphor-icons/react'
import type { NoteFlowItem } from './NoteFlow'
import type { PersistentPdfHighlight } from './persistentHighlight'
import { t } from '../i18n'
import '../ui/note-wide.css'

/** 메모만 보기의 글 칸 폭(Markdown 글 칸과 같다). 목차는 그 왼쪽 빈 곳에 놓는다 */
export const NOTE_WIDE_COLUMN = 708
/** 목차 칸 폭 = 노트 바 폭의 18%, 160~240px (note-wide.css 의 --nw-out 과 같은 식) */
export const OUTLINE_MIN = 160
export const OUTLINE_MAX = 240
export const OUTLINE_GAP = 28
const OUTLINE_SIDE_PAD = 16
export function outlineWidthFor(paneWidth: number): number {
  return Math.min(OUTLINE_MAX, Math.max(OUTLINE_MIN, Math.round(paneWidth * 0.18)))
}
/** 글 칸 + 목차 + 사이 + 양쪽 여백이 들어가는 폭인가(아니면 목차를 감추고 글 칸만 가운데) */
export function outlineFits(paneWidth: number): boolean {
  return paneWidth >= NOTE_WIDE_COLUMN + outlineWidthFor(paneWidth) + OUTLINE_GAP + 2 * OUTLINE_SIDE_PAD
}

export type OutlineEntry = {
  readonly key: string
  readonly kind: 'section' | 'memo' | 'text'
  readonly text: string
  readonly id?: string
  readonly color?: PersistentPdfHighlight['color']
  readonly collapsed?: boolean
  readonly count?: number
  /** 소제목 아래에 들어 있는가 */
  readonly nested: boolean
}

const blockElement = (scroller: HTMLElement, key: string): HTMLElement | undefined =>
  Array.from(scroller.querySelectorAll<HTMLElement>('[data-note-block]')).find((element) => element.dataset.noteBlock === key)

/** 노트 검색어에 맞는가(NoteFlow 가 블록을 흐리게 하는 기준과 같다). 소제목은 늘 맞는다 */
function matchesQuery(item: NoteFlowItem, needle: string): boolean {
  if (needle === '' || item.kind === 'section') return true
  if (item.kind === 'text') return item.text.toLowerCase().includes(needle)
  return (item.highlight.note ?? '').toLowerCase().includes(needle)
    || [item.highlight, ...(item.extraHighlights ?? [])].some((source) => source.anchor.quote.toLowerCase().includes(needle))
    || `${item.ticket?.id ?? ''} ${item.ticket?.title ?? ''}`.toLowerCase().includes(needle)
}

const clip = (text: string): string => (text.length > 80 ? `${text.slice(0, 80)}…` : text)
/** 목차 글: 첫 줄에서 **굵게**·`코드` 같은 표시 기호만 걷어 낸다 */
export const plainLine = (line: string): string => line.replace(/(\*\*|__|~~|`)/gu, '')
const firstLine = (text: string | undefined): string => clip(plainLine((text ?? '').split('\n').map((line) => line.trim()).find((line) => line !== '') ?? ''))

/** 목차 줄: 소제목은 제목, 메모는 ID·제목 → 메모 첫 줄 → 원문 앞부분, 글 블록은 첫 줄 */
export function outlineEntries(items: readonly NoteFlowItem[], query = ''): readonly OutlineEntry[] {
  let inSection = false
  const entries: OutlineEntry[] = []
  const needle = query.trim().toLowerCase()
  for (const item of items) {
    if (!matchesQuery(item, needle)) continue
    if (item.kind === 'section') {
      inSection = true
      entries.push({ key: item.key, kind: 'section', text: item.title, collapsed: item.collapsed, count: item.count, nested: false })
    } else if (item.kind === 'text') {
      entries.push({ key: item.key, kind: 'text', text: firstLine(item.text) || t('글'), nested: inSection })
    } else if (item.draft !== true) {
      const { highlight } = item
      const quote = highlight.kind === 'region' ? t('표·그림') : clip(highlight.anchor.quote.replace(/\s+/gu, ' ').trim())
      const text = (item.ticket?.title?.trim() ?? '') || firstLine(highlight.note) || quote
      entries.push({ key: item.key, kind: 'memo', text, ...(item.ticket?.id === undefined ? {} : { id: item.ticket.id }), color: highlight.color, nested: inSection })
    }
  }
  return entries
}

/**
 * 메모만 보기의 목차: 글 칸 왼쪽에 소제목과 메모 블록을 차례로 늘어놓는다.
 * 누르면 그 블록으로 스크롤하고, 지금 보이는 블록의 줄은 앱의 고른 줄 모양으로 칠한다. 칸이 좁으면 감춘다.
 */
export function NoteOutline({
  items,
  query = '',
  scrollerRef,
  onToggleSection,
}: {
  readonly items: readonly NoteFlowItem[]
  /** 노트 검색어: 맞지 않는 블록은 목차에서도 뺀다 */
  readonly query?: string
  /** 노트 블록을 담은 스크롤 칸 */
  readonly scrollerRef: RefObject<HTMLElement | null>
  readonly onToggleSection?: (key: string, collapsed: boolean) => void
}) {
  const entries = outlineEntries(items, query)
  const [fits, setFits] = useState(false)
  const [top, setTop] = useState(0)
  const [activeKey, setActiveKey] = useState<string | null>(null)
  const listRef = useRef<HTMLElement | null>(null)
  const keysRef = useRef<readonly string[]>([])
  // 목차 줄을 눌러 옮겨 간 뒤에는 사용자가 직접 스크롤할 때까지 그 줄을 지금 보는 줄로 둔다(끝까지 가도 맨 위에 못 오는 블록도 있다)
  const pinnedRef = useRef<string | null>(null)
  keysRef.current = entries.map((entry) => entry.key)

  // 칸 폭과 위치(서식 도구 줄 아래)
  useLayoutEffect(() => {
    const scroller = scrollerRef.current
    if (scroller === null) return
    const measure = () => {
      setFits(outlineFits(scroller.offsetWidth))
      setTop(scroller.offsetTop)
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(scroller)
    return () => observer.disconnect()
  }, [scrollerRef])

  // 스크롤 따라가기: 칸 위쪽 줄을 지난 마지막 블록이 지금 보는 블록
  useEffect(() => {
    const scroller = scrollerRef.current
    if (scroller === null) return
    let frame = 0
    const update = () => {
      frame = 0
      if (pinnedRef.current !== null) return
      const line = scroller.getBoundingClientRect().top + 48
      let current: string | null = null
      for (const key of keysRef.current) {
        const element = blockElement(scroller, key)
        if (element === undefined) continue
        if (current === null || element.getBoundingClientRect().top <= line) current = key
        else break
      }
      const last = keysRef.current[keysRef.current.length - 1]
      if (last !== undefined && scroller.scrollTop > 0 && scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 2) current = last
      setActiveKey(current)
    }
    const schedule = () => { if (frame === 0) frame = window.requestAnimationFrame(update) }
    const unpin = () => { pinnedRef.current = null }
    scroller.addEventListener('scroll', schedule, { passive: true })
    for (const type of ['wheel', 'pointerdown', 'keydown'] as const) scroller.addEventListener(type, unpin, { passive: true })
    window.addEventListener('resize', schedule)
    schedule()
    return () => {
      scroller.removeEventListener('scroll', schedule)
      for (const type of ['wheel', 'pointerdown', 'keydown'] as const) scroller.removeEventListener(type, unpin)
      window.removeEventListener('resize', schedule)
      if (frame !== 0) window.cancelAnimationFrame(frame)
    }
  }, [scrollerRef, items])

  // 지금 보는 줄이 목차 밖으로 나가면 목차도 따라 스크롤
  useEffect(() => {
    if (activeKey === null) return
    const list = listRef.current
    const row = list?.querySelector<HTMLElement>('[aria-current="true"]')
    if (list === null || list === undefined || row === null || row === undefined) return
    const listBox = list.getBoundingClientRect()
    const rowBox = row.getBoundingClientRect()
    if (rowBox.top < listBox.top + 8) list.scrollTop -= listBox.top + 8 - rowBox.top
    else if (rowBox.bottom > listBox.bottom - 24) list.scrollTop += rowBox.bottom - listBox.bottom + 24
  }, [activeKey])

  const shown = fits && entries.length > 0
  // 글 칸을 목차 몫만큼 옆으로 옮기는 CSS 가 켜지게 바깥 칸에 표시한다
  useLayoutEffect(() => {
    const host = scrollerRef.current?.parentElement
    if (host === null || host === undefined) return
    if (shown) host.setAttribute('data-note-outline', '')
    else host.removeAttribute('data-note-outline')
    return () => host.removeAttribute('data-note-outline')
  }, [scrollerRef, shown])

  if (!shown) return null

  const go = (key: string) => {
    const scroller = scrollerRef.current
    const element = scroller === null ? undefined : blockElement(scroller, key)
    if (scroller === null || element === undefined) return
    const offset = element.getBoundingClientRect().top - scroller.getBoundingClientRect().top
    scroller.scrollTo({ top: Math.max(0, scroller.scrollTop + offset - 28), behavior: 'smooth' })
    pinnedRef.current = key
    setActiveKey(key)
  }

  return (
    <nav
      ref={listRef}
      className="note-outline"
      aria-label={t('노트 목차')}
      style={{ top }}
    >
      {entries.map((entry) => (
        <div key={entry.key} className={`note-outline-row${entry.nested ? ' note-outline-nested' : ''}${entry.kind === 'section' ? ' note-outline-section' : ''}`}>
          {entry.kind === 'section' ? (
            <button
              type="button"
              className="note-outline-toggle"
              aria-label={entry.collapsed === true ? t('{title} 펼치기', { title: entry.text }) : t('{title} 접기', { title: entry.text })}
              aria-expanded={entry.collapsed !== true}
              onClick={() => onToggleSection?.(entry.key, entry.collapsed !== true)}
            >
              {entry.collapsed === true ? <CaretRight size={11} weight="bold" aria-hidden="true" /> : <CaretDown size={11} weight="bold" aria-hidden="true" />}
            </button>
          ) : null}
          <button
            type="button"
            className="note-outline-item"
            aria-current={activeKey === entry.key ? 'true' : undefined}
            title={entry.text}
            onClick={() => go(entry.key)}
          >
            {entry.color === undefined ? null : <span className="pdf-memo-dot" data-hl={entry.color} aria-hidden="true" />}
            {entry.id === undefined ? null : <span className="note-outline-id">{entry.id}</span>}
            <span className="note-outline-text">{entry.text}</span>
            {entry.kind === 'section' ? <span className="note-section-count">{entry.count}</span> : null}
          </button>
        </div>
      ))}
    </nav>
  )
}
