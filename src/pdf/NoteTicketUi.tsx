import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { MagnifyingGlass, TextAlignLeft, Ticket, WarningCircle } from '@phosphor-icons/react'
import { t } from '../i18n'
import { memoNoteTitleOf } from '../core/memoNote'
import { ticketChoices, type TicketChoice, type TicketGroup, type TicketIndex, type TicketPlace } from '../core/memoTickets'
import type { PersistentPdfHighlight } from './persistentHighlight'
import '../ui/note-ticket-pick.css'

/** 위치 기준 상자(화면 좌표). 팝오버가 이 단추 아래(자리가 모자라면 위)에 뜬다 */
export interface AnchorBox {
  readonly left: number
  readonly top: number
  readonly right: number
  readonly bottom: number
}

export function anchorOf(element: Element): AnchorBox {
  const rect = element.getBoundingClientRect()
  return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom }
}

/** 단추 아래에 두고, 화면 밖으로 나가면 안으로 당기거나 위로 뒤집는다(마운트 직후 한 번) */
function placeNear(element: HTMLElement | null, anchor: AnchorBox, align: 'start' | 'center' = 'start'): void {
  if (element === null) return
  const rect = element.getBoundingClientRect()
  const margin = 8
  const wanted = align === 'center' ? (anchor.left + anchor.right) / 2 - rect.width / 2 : anchor.left
  const left = Math.max(margin, Math.min(wanted, window.innerWidth - rect.width - margin))
  const below = anchor.bottom + 6
  const top = below + rect.height > window.innerHeight - margin ? Math.max(margin, anchor.top - 6 - rect.height) : below
  element.style.left = `${left}px`
  element.style.top = `${top}px`
}

function menuLabel(icon: ReactNode, label: string) {
  return (
    <>
      <span className="note-menu-icon" aria-hidden="true">{icon}</span>
      <span className="note-menu-label">{label}</span>
    </>
  )
}

/** 블록 사이 +: 글 넣기 / 티켓 넣기 */
export function GapMenu({ anchor, onText, onTicket, onClose }: {
  readonly anchor: AnchorBox
  readonly onText: () => void
  readonly onTicket: () => void
  readonly onClose: () => void
}) {
  const keys = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      onClose()
      return
    }
    const items = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role=menuitem]'))
    const at = items.indexOf(document.activeElement as HTMLButtonElement)
    const next = event.key === 'ArrowDown' ? (at + 1) % items.length
      : event.key === 'ArrowUp' ? (at <= 0 ? items.length - 1 : at - 1)
        : event.key === 'Home' ? 0
          : event.key === 'End' ? items.length - 1
            : null
    if (next === null || items.length === 0) return
    event.preventDefault()
    items[next]?.focus()
  }
  return createPortal(
    <>
      <div className="note-menu-backdrop" onPointerDown={onClose} onContextMenu={(event) => { event.preventDefault(); onClose() }} />
      <div
        className="note-menu note-gap-menu"
        role="menu"
        tabIndex={-1}
        aria-label={t('블록 사이에 넣기')}
        ref={(element) => {
          if (element === null) return
          placeNear(element, anchor, 'center')
          if (!element.contains(document.activeElement)) element.focus({ preventScroll: true })
        }}
        onKeyDown={keys}
      >
        <button type="button" role="menuitem" onClick={onText}>{menuLabel(<TextAlignLeft size={15} />, t('글 넣기'))}</button>
        <button type="button" role="menuitem" onClick={onTicket}>{menuLabel(<Ticket size={15} />, t('티켓 넣기'))}</button>
      </div>
    </>,
    document.body,
  )
}

function quoteOf(highlight: PersistentPdfHighlight | undefined): string {
  if (highlight === undefined) return ''
  if (highlight.kind === 'region') return t('표·그림')
  return highlight.anchor.quote.replace(/\s+/gu, ' ').trim()
}

/** 고르기 목록의 한 줄 */
interface PickRow {
  readonly choice: TicketChoice
  readonly quote: string
  readonly noteText: string
  readonly inThisNote: boolean
  readonly haystack: string
}

/**
 * 티켓 고르기: Vault 의 모든 노트에 있는 티켓(ID 가 붙은 메모)을 ID·제목·노트 이름·원문 글로 찾아 고른다.
 * 고른 티켓은 같은 형광펜을 가리키는 메모 블록으로 그 자리에 들어간다(같은 ID = 같은 메모).
 * 이 노트에 이미 있는 메모는 두 번 넣지 못한다.
 */
export function TicketPicker({ anchor, tickets, highlightOf, openPath, existing, onPick, onClose }: {
  readonly anchor: AnchorBox
  readonly tickets: TicketIndex
  readonly highlightOf: (highlightId: string) => PersistentPdfHighlight | undefined
  /** 지금 열린 노트(Vault 상대 경로) */
  readonly openPath: string | null
  /** 지금 노트가 이미 가리키는 형광펜 id 들 */
  readonly existing: ReadonlySet<string>
  readonly onPick: (choice: TicketChoice) => void
  readonly onClose: () => void
}) {
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const listRef = useRef<HTMLUListElement | null>(null)
  const rows = useMemo<PickRow[]>(() => ticketChoices(tickets).flatMap((choice) => {
    const highlight = highlightOf(choice.highlightId)
    // 원문이 지워진 티켓은 블록으로 그릴 수 없으니 고를 수 없다
    if (highlight === undefined) return []
    const titles = [...new Set(choice.places.map((place) => memoNoteTitleOf(place.path)))]
    const first = titles[0] ?? ''
    const noteText = titles.length > 1 ? t('{note} 외 {count}곳', { note: first, count: titles.length - 1 }) : first
    const quote = quoteOf(highlight)
    return [{
      choice,
      quote,
      noteText,
      inThisNote: existing.has(choice.highlightId) || choice.places.some((place) => place.path === openPath),
      haystack: `${choice.id} ${choice.title ?? ''} ${titles.join(' ')} ${quote}`.toLocaleLowerCase(),
    }]
  }), [existing, highlightOf, openPath, tickets])
  const shown = useMemo(() => {
    const words = query.trim().toLocaleLowerCase().split(/\s+/u).filter((word) => word !== '')
    return rows.filter((row) => words.every((word) => row.haystack.includes(word)))
  }, [query, rows])
  // 이 노트에 이미 있는 줄은 고를 수 없다: 처음 칠해지는 줄과 ↑↓ 는 고를 수 있는 줄만 거친다
  const firstFree = shown.findIndex((row) => !row.inThisNote)
  const step = (from: number, direction: 1 | -1): number => {
    for (let at = from + direction; at >= 0 && at < shown.length; at += direction) if (!shown[at]?.inThisNote) return at
    return from
  }
  useEffect(() => setActive(Math.max(firstFree, 0)), [query, firstFree])
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.scrollIntoView?.({ block: 'nearest' })
  }, [active])
  const pick = (row: PickRow | undefined) => {
    if (row === undefined || row.inThisNote) return
    onPick(row.choice)
  }
  return createPortal(
    <>
      <div className="note-menu-backdrop" onPointerDown={onClose} onContextMenu={(event) => { event.preventDefault(); onClose() }} />
      <div className="note-ticket-picker" role="dialog" aria-label={t('티켓 넣기')} ref={(element) => placeNear(element, anchor, 'center')}>
        <div className="note-ticket-picker-field">
          <MagnifyingGlass size={15} aria-hidden="true" />
          <input
            autoFocus
            aria-label={t('티켓 찾기')}
            placeholder={t('ID나 제목, 노트, 원문으로 찾기')}
            value={query}
            spellCheck={false}
            role="combobox"
            aria-expanded="true"
            aria-controls="note-ticket-picker-list"
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose() }
              else if (event.key === 'ArrowDown') { event.preventDefault(); setActive((index) => step(index, 1)) }
              else if (event.key === 'ArrowUp') { event.preventDefault(); setActive((index) => step(index, -1)) }
              else if (event.key === 'Enter') { event.preventDefault(); pick(shown[active]) }
            }}
          />
        </div>
        {shown.length === 0 ? (
          <p className="note-ticket-picker-empty">{rows.length === 0 ? t('아직 티켓이 없습니다. 메모에 ID를 붙이면 여기서 고를 수 있습니다.') : t('맞는 티켓이 없습니다')}</p>
        ) : (
          <ul ref={listRef} id="note-ticket-picker-list" className="note-ticket-picker-list" role="listbox" aria-label={t('티켓 목록')}>
            {shown.map((row, index) => (
              <li
                key={`${row.choice.id}:${row.choice.highlightId}`}
                role="option"
                aria-selected={index === active && !row.inThisNote}
                aria-disabled={row.inThisNote}
                className={`note-ticket-pick${index === active && !row.inThisNote ? ' note-ticket-pick-active' : ''}${row.inThisNote ? ' note-ticket-pick-here' : ''}`}
                onPointerMove={() => { if (!row.inThisNote) setActive(index) }}
                onClick={() => pick(row)}
              >
                <span className="note-ticket-pick-head">
                  <span className="note-ticket-id note-ticket-pick-id">{row.choice.id}</span>
                  {row.choice.title === undefined ? null : <span className="note-ticket-pick-title">{row.choice.title}</span>}
                  {row.choice.conflict ? <span className="note-ticket-pick-warn"><WarningCircle size={12} weight="fill" aria-hidden="true" />{t('ID 겹침')}</span> : null}
                </span>
                {row.quote === '' ? null : <span className="note-ticket-pick-quote">{row.quote}</span>}
                <span className="note-ticket-pick-note">
                  <span>{row.noteText}</span>
                  {row.inThisNote ? <span className="note-ticket-pick-here-label">{t('이 노트에 있음')}</span> : null}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>,
    document.body,
  )
}

/** 노트 블록의 위치 설명: 「소제목 · 3번째 블록」 */
function placeText(place: TicketPlace): string {
  const nth = t('{n}번째 블록', { n: place.index + 1 })
  return place.section === null ? nth : `${place.section} · ${nth}`
}

/**
 * 같은 ID 가 여러 곳에 있을 때 메모 블록 머리에 붙는 작은 배지(「3곳」). 누르면 그 곳들을 나열하고,
 * 하나를 누르면 그 노트의 그 블록으로 간다. 같은 ID 를 서로 다른 메모가 쓰고 있으면(충돌) 경고 색으로 보인다.
 */
export function TicketBadge({ group, current, highlightOf, onReveal }: {
  readonly group: TicketGroup
  /** 이 배지가 붙은 블록 */
  readonly current: { readonly path: string | null; readonly blockId: string }
  readonly highlightOf: (highlightId: string) => PersistentPdfHighlight | undefined
  readonly onReveal: (place: TicketPlace) => void
}) {
  const [anchor, setAnchor] = useState<AnchorBox | null>(null)
  const count = group.places.length
  useEffect(() => {
    if (anchor === null) return undefined
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.stopPropagation(); setAnchor(null) } }
    window.addEventListener('keydown', close, true)
    return () => window.removeEventListener('keydown', close, true)
  }, [anchor])
  const isCurrent = (place: TicketPlace) => place.blockId === current.blockId && place.path === current.path
  const entry = (place: TicketPlace) => (
    <li key={`${place.path}:${place.blockId}`}>
      <button type="button" className="note-ticket-place" aria-current={isCurrent(place) ? 'true' : undefined} onClick={() => { setAnchor(null); onReveal(place) }}>
        <span className="note-ticket-place-title">{memoNoteTitleOf(place.path)}</span>
        {isCurrent(place) ? <span className="note-ticket-place-here">{t('여기')}</span> : null}
        <span className="note-ticket-place-at">{placeText(place)}</span>
      </button>
    </li>
  )
  return (
    <>
      <button
        type="button"
        className={`note-ticket-badge${group.conflict ? ' note-ticket-badge-warn' : ''}`}
        aria-haspopup="dialog"
        aria-expanded={anchor !== null}
        title={group.conflict ? t('같은 ID를 서로 다른 메모가 쓰고 있습니다') : t('이 ID가 있는 곳 보기')}
        onClick={(event) => setAnchor(anchor === null ? anchorOf(event.currentTarget) : null)}
      >
        {group.conflict ? <WarningCircle size={12} weight="fill" aria-hidden="true" /> : null}
        {t('{count}곳', { count })}
      </button>
      {anchor === null ? null : createPortal(
        <>
          <div className="note-menu-backdrop" onPointerDown={() => setAnchor(null)} onContextMenu={(event) => { event.preventDefault(); setAnchor(null) }} />
          <div className="note-ticket-places" role="dialog" aria-label={t('{id} 위치', { id: group.id })} ref={(element) => placeNear(element, anchor)}>
            <div className="note-ticket-places-head">
              <span className="note-ticket-id">{group.id}</span>
              <span>{t('{count}곳', { count })}</span>
            </div>
            {group.conflict ? (
              <p className="note-ticket-places-warn" role="status">
                <WarningCircle size={14} weight="fill" aria-hidden="true" />
                {t('서로 다른 메모 {count}개가 같은 ID를 쓰고 있습니다. 한쪽 ID를 바꾸세요.', { count: group.highlightIds.length })}
              </p>
            ) : null}
            {group.conflict ? (
              group.highlightIds.map((highlightId) => (
                <section key={highlightId} className="note-ticket-places-group">
                  <p className="note-ticket-places-quote">{quoteOf(highlightOf(highlightId)) || t('(원문 없음)')}</p>
                  <ul>{group.places.filter((place) => place.highlightId === highlightId).map(entry)}</ul>
                </section>
              ))
            ) : (
              <ul>{group.places.map(entry)}</ul>
            )}
          </div>
        </>,
        document.body,
      )}
    </>
  )
}
