import { useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { FilePdf, FileText, NotePencil, SquaresFour, X } from '@phosphor-icons/react'
import { t } from '../i18n'
import '../ui/empty-pane.css'

/** 빈 칸에 보일 「최근」 한 줄(문서) */
export interface EmptyPaneRecent {
  readonly key: string
  readonly title: string
  readonly kind: 'pdf' | 'markdown'
  readonly onOpen: () => void
}

export interface EmptyPaneProps {
  /** 지금 접두키 표기(`Ctrl+B` · `⌃B`). 키 힌트 앞에 붙는다 */
  readonly prefixText: string
  /** 없으면 그 줄을 그리지 않는다(Vault 가 없을 때 노트, 떼어 낸 창 등) */
  readonly onPdf?: () => void
  readonly onMarkdown?: () => void
  readonly onNote?: () => void
  /** 칸이 둘 이상일 때만 준다 */
  readonly onClose?: () => void
  /** 최근 문서(많아야 4 개). 비어 있으면 「최근」 구역이 없다 */
  readonly recents?: readonly EmptyPaneRecent[]
}

interface Row {
  readonly id: string
  readonly icon: ReactNode
  readonly label: string
  readonly hint?: string
  readonly run: () => void
}

const ICON = 15
const MAX_RECENTS = 4

/** 칸이 낮을 때 줄이는 정도: 「최근」 줄 수(먼저 줄인다) → 그래도 넘치면 안내 줄도 감춘다 */
export interface EmptyPaneTrim {
  readonly recents: number
  readonly hint: boolean
}

/**
 * 내용 높이(natural)가 쓸 수 있는 높이(avail)를 넘으면 「최근」 줄을 하나씩 덜고(맨 아래 줄부터), 다 덜어도 넘치면 「최근」 제목 줄 · 안내 줄을 덜어 낸다.
 * 세로 스크롤 막대가 생기지 않도록 실제로 잰 높이로 정한다(전엔 400px 기준을 따로 두었다). 순수 계산이라 따로 시험한다.
 */
export function fitEmptyPane(natural: number, avail: number, recents: number, pitch: number, sectionH: number): EmptyPaneTrim {
  let need = natural
  let n = recents
  while (need > avail && n > 0) {
    n -= 1
    need -= pitch
    if (n === 0) need -= sectionH
  }
  const hint = need <= avail
  return { recents: n, hint }
}

/**
 * 빈 칸(설계 3): 가운데 한 줄 기둥 — 흐린 아이콘 · 「빈 칸」 · 한 줄 안내 · 조용한 명령 목록(PDF · Markdown · 노트 · 이 칸 닫기: 왼쪽 아이콘 · 이름 · 오른쪽 키 힌트) · 「최근」.
 * 번역기 · 캔버스 줄은 없다(번역기는 창 전체에 떠 있는 창이고, 캔버스는 꺼 두었다). 칸 테두리는 실선이 아니라 점선이다(empty-pane.css · screens.css).
 * 줄은 모두 단추라서 Tab 으로 들어와 ↑ ↓ (Home · End)로 오가고 Enter 로 연다. 키 힌트는 지금 접두키를 따른다.
 * 움직임 없음, 색은 토큰만. 좁은 칸(260px)에서도 읽히고, 칸이 낮으면 「최근」 은 접는다(empty-pane.css).
 */
export function EmptyPane({ prefixText, onPdf, onMarkdown, onNote, onClose, recents = [] }: EmptyPaneProps) {
  const listRef = useRef<HTMLDivElement>(null)
  const [trim, setTrim] = useState<EmptyPaneTrim>({ recents: MAX_RECENTS, hint: true })
  // 높이를 재는 값: 줄 하나 · 「최근」 제목 · 안내 줄이 차지하는 높이(화면에 있을 때 잰다)
  const sizes = useRef({ pitch: 31, sectionH: 33, hintH: 36 })
  const [tick, setTick] = useState(0)
  useLayoutEffect(() => {
    const host = listRef.current?.parentElement
    if (host === null || host === undefined || typeof ResizeObserver === 'undefined') return undefined
    const observer = new ResizeObserver(() => setTick((value) => value + 1))
    observer.observe(host)
    return () => observer.disconnect()
  }, [])
  const rows: Row[] = []
  if (onPdf !== undefined) rows.push({ id: 'pdf', icon: <FilePdf size={ICON} aria-hidden="true" />, label: t('PDF 열기'), run: onPdf })
  if (onMarkdown !== undefined) rows.push({ id: 'markdown', icon: <FileText size={ICON} aria-hidden="true" />, label: t('Markdown 열기'), run: onMarkdown })
  if (onNote !== undefined) rows.push({ id: 'note', icon: <NotePencil size={ICON} aria-hidden="true" />, label: t('노트 열기'), run: onNote })
  if (onClose !== undefined) rows.push({ id: 'close', icon: <X size={ICON} aria-hidden="true" />, label: t('이 칸 닫기'), hint: `${prefixText} x`, run: onClose })

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key) || event.altKey || event.ctrlKey || event.metaKey) return
    const buttons = [...(listRef.current?.querySelectorAll<HTMLButtonElement>('button[data-empty-row]') ?? [])]
    const here = buttons.indexOf(event.target as HTMLButtonElement)
    if (here < 0 || buttons.length === 0) return
    event.preventDefault()
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (here + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length
    buttons[next]?.focus()
  }

  const total = Math.min(recents.length, MAX_RECENTS)
  useLayoutEffect(() => {
    const el = listRef.current
    const host = el?.parentElement
    if (el === null || host === null || host === undefined) return
    const box = getComputedStyle(host)
    const avail = host.clientHeight - (Number.parseFloat(box.paddingTop) || 0) - (Number.parseFloat(box.paddingBottom) || 0)
    if (avail <= 0 || el.offsetHeight <= 0) return
    const rows = el.querySelectorAll<HTMLElement>('.empty-pane-recent .empty-pane-row')
    const section = el.querySelector<HTMLElement>('.empty-pane-section')
    const hint = el.querySelector<HTMLElement>('.empty-pane-hint')
    const known = sizes.current
    const first = rows[0]
    const last = rows[rows.length - 1]
    if (first !== undefined && last !== undefined) {
      known.pitch = rows.length >= 2 ? (last.getBoundingClientRect().top - first.getBoundingClientRect().top) / (rows.length - 1) : first.offsetHeight + 1
    }
    if (section !== null) { const m = getComputedStyle(section); known.sectionH = section.offsetHeight + (Number.parseFloat(m.marginTop) || 0) + (Number.parseFloat(m.marginBottom) || 0) }
    if (hint !== null) { const m = getComputedStyle(hint); known.hintH = hint.offsetHeight + (Number.parseFloat(m.marginTop) || 0) + (Number.parseFloat(m.marginBottom) || 0) }
    // 지금 덜어 낸 만큼을 더해 「다 보일 때」 높이를 구한 뒤 다시 정한다
    let natural = el.offsetHeight
    natural += (total - trim.recents) * known.pitch
    if (trim.recents === 0 && total > 0) natural += known.sectionH
    if (!trim.hint) natural += known.hintH
    const next = fitEmptyPane(natural, avail, total, known.pitch, known.sectionH)
    if (next.recents !== trim.recents || next.hint !== trim.hint) setTrim(next)
  }, [tick, total, trim.recents, trim.hint])

  const recentRows = recents.slice(0, Math.min(MAX_RECENTS, trim.recents))
  return (
    <div className="empty-pane" ref={listRef} onKeyDown={onKeyDown}>
      <SquaresFour className="empty-pane-icon" size={28} aria-hidden="true" />
      <p className="empty-pane-title">{t('빈 칸')}</p>
      {trim.hint ? <p className="empty-pane-hint">{t('문서를 열거나, 다른 칸의 탭을 끌어 오세요')}</p> : null}
      {rows.length === 0 ? null : (
        <div className="empty-pane-actions" role="group" aria-label={t('이 칸에 열기')}>
          {rows.map((row, index) => (
            <button key={row.id} type="button" className="empty-pane-row" data-empty-row={row.id} tabIndex={index === 0 ? 0 : -1} onClick={row.run}>
              <span className="empty-pane-row-icon" aria-hidden="true">{row.icon}</span>
              <span className="empty-pane-row-label">{row.label}</span>
              {row.hint === undefined ? null : <kbd className="empty-pane-row-hint">{row.hint}</kbd>}
            </button>
          ))}
        </div>
      )}
      {recentRows.length === 0 ? null : (
        <div className="empty-pane-recent" role="group" aria-label={t('최근')}>
          <p className="empty-pane-section">{t('최근')}</p>
          {recentRows.map((recent) => (
            <button key={recent.key} type="button" className="empty-pane-row" data-empty-row="recent" tabIndex={-1} title={recent.title} onClick={recent.onOpen}>
              <span className="empty-pane-row-icon" aria-hidden="true">{recent.kind === 'markdown' ? <FileText size={ICON} /> : <FilePdf size={ICON} />}</span>
              <span className="empty-pane-row-label">{recent.title}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
