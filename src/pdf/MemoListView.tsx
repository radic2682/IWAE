import { useState } from 'react'
import { ArrowSquareOut } from '@phosphor-icons/react'
import type { PersistentPdfHighlight } from './persistentHighlight'
import { MemoEditor, MemoNoteView, type MemoContent } from './MemoColumn'
import { RegionCrop } from './RegionCrop'
import type { NoteFlowItem } from './NoteFlow'
import { t } from '../i18n'

/**
 * 「메모만 보기」: PDF 자리에 노트를 넓게 펼친다. 형광펜 메모는 한 줄에 원문(글·표·그림)과 메모를 나란히,
 * 노트에 쓴 글 블록은 한 줄 전체로, 노트의 차례 그대로.
 */
export function MemoListView({
  title,
  items,
  currentDocId,
  query,
  docTitle,
  pageSizeOf,
  onSave,
  onSaveText,
  onOpen,
}: {
  /** 노트 제목 */
  readonly title: string
  readonly items: readonly NoteFlowItem[]
  readonly currentDocId: string
  readonly query: string
  readonly docTitle: (docId: string) => string
  readonly pageSizeOf: (highlight: PersistentPdfHighlight) => readonly [number, number] | undefined
  readonly onSave: (id: string, content: MemoContent) => void
  readonly onSaveText?: (key: string, content: MemoContent) => void
  /** 원문 자리로 돌아간다 */
  readonly onOpen: (highlight: PersistentPdfHighlight) => void
}) {
  const [editingKey, setEditingKey] = useState<string | null>(null)
  const needle = query.trim().toLowerCase()
  const shown = items.filter((item) => {
    if (item.kind === 'memo' && item.draft === true) return false
    if (item.kind === 'section') return true
    if (needle === '') return true
    return item.kind === 'text'
      ? item.text.toLowerCase().includes(needle)
      : (item.highlight.note ?? '').toLowerCase().includes(needle) || item.highlight.anchor.quote.toLowerCase().includes(needle)
  })

  return (
    <div className="pdf-memo-list" role="region" aria-label={t('메모만 보기')}>
      <div className="pdf-memo-list-scope">{title}</div>
      {shown.length === 0 ? (
        <p className="pdf-memo-list-empty">{t('노트가 비어 있습니다. PDF에서 글을 끌거나, 표·그림을 영역 캡처 도구(또는 Ctrl+끌기)로 감싸 메모를 만드세요.')}</p>
      ) : shown.map((item) => {
        if (item.kind === 'section') {
          return <h3 key={item.key} className="pdf-memo-list-section">{item.title}<span className="note-section-count">{item.count}</span></h3>
        }
        if (item.kind === 'text') {
          return (
            <article key={item.key} className="pdf-memo-list-row pdf-memo-list-text" data-note-block={item.key}>
              {editingKey === item.key && onSaveText !== undefined ? (
                <MemoEditor
                  label={t('글')}
                  initialText={item.text}
                  initialHtml={item.html}
                  onSave={(content) => {
                    onSaveText(item.key, content)
                    setEditingKey(null)
                  }}
                  onCancel={() => setEditingKey(null)}
                />
              ) : (
                <MemoNoteView note={item.text} noteHtml={item.html} onEdit={() => setEditingKey(item.key)} onChange={onSaveText === undefined ? undefined : (content) => onSaveText(item.key, content)} />
              )}
            </article>
          )
        }
        const { highlight } = item
        const pageSize = pageSizeOf(highlight)
        const other = highlight.anchor.docId !== currentDocId
        return (
          <article key={item.key} className="pdf-memo-list-row" data-memo-id={highlight.id}>
            <div className="pdf-memo-list-source">
              <div className="pdf-memo-list-meta">
                <span className={`pdf-memo-dot pdf-memo-dot-${highlight.color}`} aria-hidden="true" />
                <span>{other ? `${docTitle(highlight.anchor.docId) || t('다른 PDF')} · ` : ''}p.{highlight.anchor.page + 1}{highlight.kind === 'region' ? ` · ${t('표/그림')}` : ''}</span>
                <button type="button" className="pdf-memo-list-open" onClick={() => onOpen(highlight)}>
                  {t('원문 보기')} <ArrowSquareOut size={12} aria-hidden="true" />
                </button>
              </div>
              {highlight.kind === 'region' && pageSize !== undefined
                ? <RegionCrop highlight={highlight} pageSize={pageSize} maxWidth={620} />
                : <div className={`pdf-memo-list-quote pdf-memo-list-quote-${highlight.color}`}>{highlight.anchor.quote.replace(/\s+/gu, ' ').trim()}</div>}
            </div>
            <div className="pdf-memo-list-note">
              {editingKey === item.key ? (
                <MemoEditor
                  initialText={highlight.note ?? ''}
                  initialHtml={highlight.noteHtml}
                  onSave={(content) => {
                    onSave(highlight.id, content)
                    setEditingKey(null)
                  }}
                  onCancel={() => setEditingKey(null)}
                />
              ) : (
                <MemoNoteView note={highlight.note} noteHtml={highlight.noteHtml} onEdit={() => setEditingKey(item.key)} onChange={(content) => onSave(highlight.id, content)} />
              )}
            </div>
          </article>
        )
      })}
    </div>
  )
}
