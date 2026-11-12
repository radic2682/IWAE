import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react'
import { CaretDown, CaretRight } from '@phosphor-icons/react'
import { openExternalUrl } from '../bridge/external'
import { renderMarkdown } from '../core/markdown'
import { BUNDLED_RELEASE_NOTES, compareVersions, type ReleaseNote } from '../core/releaseNotes'
import { dateLocale, t } from '../i18n'
import '../ui/release-notes.css'

/** YYYY-MM-DD 를 이 언어의 날짜로. 시간대에 밀리지 않게 날짜 부분만 쓴다 */
export function releaseDateLabel(date: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(date)
  if (match === null) return date
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])).toLocaleDateString(dateLocale())
}

/** 노트 Markdown 을 그린다. 바깥 링크는 웹뷰가 아니라 기본 브라우저로 연다 */
export function ReleaseNotesBody({ markdown }: { readonly markdown: string }) {
  const html = useMemo(() => renderMarkdown(markdown), [markdown])
  const onClick = (event: MouseEvent<HTMLDivElement>) => {
    const anchor = event.target instanceof Element ? event.target.closest('a') : null
    if (anchor === null) return
    event.preventDefault()
    const href = anchor.getAttribute('href') ?? ''
    if (/^https?:/iu.test(href)) void openExternalUrl(href).catch(() => {})
  }
  // 노트는 우리가 묶어 넣은 글이고 renderMarkdown 이 DOMPurify 로 거른다
  // eslint-disable-next-line react/no-danger
  return <div className="release-notes-body" onClick={onClick} dangerouslySetInnerHTML={{ __html: html }} />
}

interface ReleaseHistoryProps {
  readonly currentVersion: string
  /** 설정을 이 버전을 보려고 열었으면 그 버전을 펼치고 그 자리로 스크롤한다 */
  readonly focusVersion?: string | null
  readonly notes?: readonly ReleaseNote[]
}

/** 설정 → 업데이트 → 업데이트 기록: 묶인 모든 버전, 새 버전 먼저. 한 줄을 누르면 노트가 펼쳐진다 */
export function ReleaseHistory({ currentVersion, focusVersion = null, notes = BUNDLED_RELEASE_NOTES }: ReleaseHistoryProps) {
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set(focusVersion === null ? [] : [focusVersion]))
  const rows = useRef(new Map<string, HTMLElement>())
  const section = useRef<HTMLElement | null>(null)

  useEffect(() => {
    if (focusVersion === null) return
    setOpen((previous) => (previous.has(focusVersion) ? previous : new Set(previous).add(focusVersion)))
    const target = rows.current.get(focusVersion) ?? section.current
    target?.scrollIntoView?.({ block: 'nearest' })
  }, [focusVersion])

  const toggle = (version: string) => setOpen((previous) => {
    const next = new Set(previous)
    if (!next.delete(version)) next.add(version)
    return next
  })

  return (
    <section ref={section} className="release-history" aria-labelledby="release-history-title">
      <h3 id="release-history-title">{t('업데이트 기록')}</h3>
      {notes.length === 0 ? (
        <p className="release-history-empty">{t('묶인 업데이트 기록이 없습니다.')}</p>
      ) : (
        <ul className="release-history-list">
          {notes.map((note) => {
            const expanded = open.has(note.version)
            const isCurrent = compareVersions(note.version, currentVersion) === 0
            const bodyId = `release-notes-${note.version}`
            return (
              <li
                key={note.version}
                ref={(element) => { if (element === null) rows.current.delete(note.version); else rows.current.set(note.version, element) }}
                className="release-history-row"
                data-expanded={expanded ? 'true' : 'false'}
              >
                <button type="button" className="release-history-toggle" aria-expanded={expanded} aria-controls={bodyId} onClick={() => toggle(note.version)}>
                  {expanded ? <CaretDown size={13} aria-hidden="true" /> : <CaretRight size={13} aria-hidden="true" />}
                  <strong>{`v${note.version}`}</strong>
                  {isCurrent ? <span className="release-history-current">{t('지금 버전')}</span> : null}
                  {note.date !== null ? <time dateTime={note.date}>{releaseDateLabel(note.date)}</time> : null}
                </button>
                {expanded ? <div id={bodyId}><ReleaseNotesBody markdown={note.body} /></div> : null}
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
