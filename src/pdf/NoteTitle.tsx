import { useEffect, useState } from 'react'
import { CaretDown } from '@phosphor-icons/react'
import { announceAction } from '../app/actionFeedback'
import { t } from '../i18n'
import { onTitleEditRequest, takeTitleEdit, type MemoNoteApi } from './memoNoteContext'
import { errorText } from '../core/errorText'

/** 오른쪽 바 머리의 노트 이름. 두 번 누르면 그 자리에서 이름을 바꾼다 */
export function NoteTitle({ api, fallback, className, as = 'span', switcher }: {
  readonly api: MemoNoteApi | null
  /** 노트가 없을 때 보일 말 */
  readonly fallback: string
  readonly className?: string
  readonly as?: 'span' | 'strong'
  /** 주면 이름이 노트 바꾸기 목록을 여닫는 단추가 된다(두 번 누르기는 그대로 이름 바꾸기) */
  readonly switcher?: { readonly open: boolean; readonly onToggle: () => void; readonly onRename?: () => void }
}) {
  const [editing, setEditing] = useState(false)
  const title = api?.openTitle ?? null
  const path = api?.openPath ?? null
  const canRename = api?.rename !== undefined && path !== null && title !== null
  // 이 PDF 에 노트를 막 만들었으면 이름 칸을 바로 연다
  useEffect(() => {
    const check = () => { if (takeTitleEdit(path)) setEditing(true) }
    check()
    return onTitleEditRequest(check)
  }, [path])
  if (editing && canRename) {
    const finish = (value: string) => {
      setEditing(false)
      const next = value.trim()
      if (next === '' || next === title) return
      void api.rename!(path, next).catch((error: unknown) => {
        announceAction(t('노트 이름을 바꾸지 못했습니다: {reason}', { reason: errorText(error) }))
      })
    }
    return (
      <input
        className={`note-head-title-input${className ? ` ${className}` : ''}`}
        aria-label={t('노트 이름')}
        defaultValue={title}
        autoFocus
        onFocus={(event) => event.currentTarget.select()}
        onBlur={(event) => finish(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur()
          else if (event.key === 'Escape') setEditing(false)
        }}
      />
    )
  }
  if (switcher !== undefined) {
    return (
      <button
        type="button"
        className={`${className ?? ''} note-head-title-button`}
        aria-haspopup="menu"
        aria-expanded={switcher.open}
        aria-label={t('노트 바꾸기: {title}', { title: title ?? fallback })}
        title={canRename ? t('눌러서 노트 바꾸기 · 두 번 눌러 이름 바꾸기') : t('눌러서 노트 바꾸기')}
        onClick={switcher.onToggle}
        onDoubleClick={canRename ? () => { switcher.onRename?.(); setEditing(true) } : undefined}
      >
        <span className="note-head-title-text">{title ?? fallback}</span>
        <CaretDown size={11} weight="bold" aria-hidden="true" />
      </button>
    )
  }
  const Tag = as
  return (
    <Tag
      className={className}
      title={canRename ? t('두 번 눌러 이름 바꾸기') : path ?? undefined}
      onDoubleClick={canRename ? () => setEditing(true) : undefined}
    >
      {title ?? fallback}
    </Tag>
  )
}
