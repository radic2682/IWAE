import { useState } from 'react'
import { announceAction } from '../app/actionFeedback'
import { t } from '../i18n'
import type { MemoNoteApi } from './memoNoteContext'
import { errorText } from '../core/errorText'

/** 오른쪽 바 머리의 노트 이름. 두 번 누르면 그 자리에서 이름을 바꾼다 */
export function NoteTitle({ api, fallback, className, as = 'span' }: {
  readonly api: MemoNoteApi | null
  /** 노트가 없을 때 보일 말 */
  readonly fallback: string
  readonly className?: string
  readonly as?: 'span' | 'strong'
}) {
  const [editing, setEditing] = useState(false)
  const title = api?.openTitle ?? null
  const path = api?.openPath ?? null
  const canRename = api?.rename !== undefined && path !== null && title !== null
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
