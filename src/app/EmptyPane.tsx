import { useRef, type KeyboardEvent, type ReactNode } from 'react'
import { FilePdf, FileText, Graph, NotePencil, SquaresFour, Translate, X } from '@phosphor-icons/react'
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
  /** 없으면 그 줄을 그리지 않는다(Vault 가 없을 때 노트 · 캔버스, 떼어 낸 창 등) */
  readonly onPdf?: () => void
  readonly onMarkdown?: () => void
  readonly onNote?: () => void
  readonly onCanvas?: () => void
  readonly onTranslator?: () => void
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

/**
 * 빈 칸(설계 3): 가운데 한 줄 기둥 — 흐린 아이콘 · 「빈 칸」 · 한 줄 안내 · 조용한 명령 목록(왼쪽 아이콘 · 이름 · 오른쪽 키 힌트) · 「최근」.
 * 줄은 모두 단추라서 Tab 으로 들어와 ↑ ↓ (Home · End)로 오가고 Enter 로 연다. 키 힌트는 지금 접두키를 따른다.
 * 움직임 없음, 색은 토큰만. 좁은 칸(260px)에서도 읽히고, 칸이 낮으면 「최근」 은 접는다(empty-pane.css).
 */
export function EmptyPane({ prefixText, onPdf, onMarkdown, onNote, onCanvas, onTranslator, onClose, recents = [] }: EmptyPaneProps) {
  const listRef = useRef<HTMLDivElement>(null)
  const rows: Row[] = []
  if (onPdf !== undefined) rows.push({ id: 'pdf', icon: <FilePdf size={ICON} aria-hidden="true" />, label: t('PDF 열기'), run: onPdf })
  if (onMarkdown !== undefined) rows.push({ id: 'markdown', icon: <FileText size={ICON} aria-hidden="true" />, label: t('Markdown 열기'), run: onMarkdown })
  if (onNote !== undefined) rows.push({ id: 'note', icon: <NotePencil size={ICON} aria-hidden="true" />, label: t('노트 열기'), run: onNote })
  if (onCanvas !== undefined) rows.push({ id: 'canvas', icon: <Graph size={ICON} aria-hidden="true" />, label: t('캔버스 열기'), run: onCanvas })
  if (onTranslator !== undefined) rows.push({ id: 'translator', icon: <Translate size={ICON} aria-hidden="true" />, label: t('번역기 띄우기'), hint: `${prefixText} w`, run: onTranslator })
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

  const recentRows = recents.slice(0, 4)
  return (
    <div className="empty-pane" ref={listRef} onKeyDown={onKeyDown}>
      <SquaresFour className="empty-pane-icon" size={28} aria-hidden="true" />
      <p className="empty-pane-title">{t('빈 칸')}</p>
      <p className="empty-pane-hint">{t('문서를 열거나, 다른 칸의 탭을 끌어 오세요')}</p>
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
