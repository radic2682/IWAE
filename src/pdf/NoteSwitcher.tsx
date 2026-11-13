import { useEffect, useMemo, useRef } from 'react'
import { NotePencil, Plus, Trash } from '@phosphor-icons/react'
import { groupMemoNotesByDoc, type MemoNoteEntry } from '../core/memoNote'
import { t } from '../i18n'
import type { MemoNoteApi } from './memoNoteContext'

/**
 * 지금 문서가 가진 노트와 다른 노트로 나눈다. 문서가 노트를 가질 수 없으면(Markdown 등) 모두 한 목록.
 * currentPath: 지금 보는 노트(노트 탭의 노트). 다른 PDF 의 노트면 「다른 노트」에 끼워 지금 보는 노트를 알 수 있게 한다
 */
export function noteSwitcherGroups(api: MemoNoteApi, currentDocId: string, currentPath: string | null = api.openPath): {
  readonly owner: string | null
  readonly mine: readonly MemoNoteEntry[]
  readonly others: readonly MemoNoteEntry[]
} {
  const owner = api.docOwner?.(currentDocId) ?? null
  const { byDoc, general } = groupMemoNotesByDoc(api.entries, api.docOwner)
  if (owner === null) {
    // 노트를 PDF 별로 나누지 않는 문서: 모든 노트를 제목순으로 한 목록에
    return { owner, mine: [], others: [...api.entries] }
  }
  const mine = byDoc.get(owner) ?? []
  const others = [...general]
  const open = api.entries.find((entry) => entry.path === currentPath)
  if (open !== undefined && !mine.some((entry) => entry.path === open.path) && !others.some((entry) => entry.path === open.path)) others.push(open)
  return { owner, mine, others }
}

/**
 * 노트 탭 도구줄의 「노트 열기」 목록: 「이 PDF의 노트」 · 구분선 · 「다른 노트」. 노트를 고르면 탭으로 연다(onPick).
 * 맨 아래에 새 노트 만들기(onCreate)와 이 노트 휴지통(onTrashCurrent)이 있다.
 */
export function NoteSwitcherMenu({ api, currentDocId, docLabel, currentPath, onPick, onCreate, onClose, onTrashCurrent }: {
  readonly api: MemoNoteApi
  /** 이 노트가 속한 문서 id(없으면 빈 문자열: 일반 노트) */
  readonly currentDocId: string
  /** 「이 PDF의 노트 · …」 에 쓸 문서 이름 */
  readonly docLabel: string
  /** 지금 보는 노트 */
  readonly currentPath: string | null
  readonly onPick: (path: string) => void
  /** 「새 노트」를 눌렀다(문서에 속한 노트면 그 PDF 의 노트를 만든다) */
  readonly onCreate?: () => void
  readonly onClose: () => void
  /** 「이 노트 휴지통으로 이동…」을 눌렀다 */
  readonly onTrashCurrent?: () => void
}) {
  const ref = useRef<HTMLDivElement | null>(null)
  const { owner, mine, others } = useMemo(() => noteSwitcherGroups(api, currentDocId, currentPath), [api, currentDocId, currentPath])

  useEffect(() => {
    const onDown = (event: PointerEvent) => {
      const target = event.target
      if (!(target instanceof Node)) return
      if (ref.current?.contains(target)) return
      // 이름 단추를 누르면 그 단추가 여닫는다
      if (target instanceof Element && target.closest('[data-note-switch-trigger]') !== null) return
      onClose()
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      onClose()
    }
    window.addEventListener('pointerdown', onDown, true)
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('blur', onClose)
    return () => {
      window.removeEventListener('pointerdown', onDown, true)
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('blur', onClose)
    }
  }, [onClose])

  const item = (entry: MemoNoteEntry) => {
    const current = entry.path === currentPath
    return (
      <button
        key={entry.path}
        type="button"
        role="menuitemradio"
        aria-checked={current}
        className={`note-switch-item${current ? ' note-switch-item-current' : ''}`}
        onClick={() => {
          onPick(entry.path)
          onClose()
        }}
      >
        <NotePencil size={14} aria-hidden="true" />
        <span>{entry.title}</span>
      </button>
    )
  }

  return (
    <div ref={ref} className="note-switch-menu" role="menu" aria-label={t('노트 열기')}>
      {owner !== null ? (
        <div role="group" aria-label={t('이 PDF의 노트 · {title}', { title: docLabel })}>
          <div className="note-switch-head">{t('이 PDF의 노트 · {title}', { title: docLabel })}</div>
          {mine.map(item)}
          {onCreate === undefined ? null : (
            <button
              type="button"
              role="menuitem"
              className="note-switch-item note-switch-create"
              onClick={() => {
                onClose()
                onCreate()
              }}
            >
              <Plus size={14} weight="bold" aria-hidden="true" />
              <span>{t('이 PDF에 노트 만들기')}</span>
            </button>
          )}
          {others.length > 0 ? <hr className="note-switch-sep" /> : null}
        </div>
      ) : null}
      {others.length > 0 ? (
        <div role="group" aria-label={owner === null ? t('노트') : t('다른 노트')}>
          {owner === null ? null : <div className="note-switch-head">{t('다른 노트')}</div>}
          {others.map(item)}
        </div>
      ) : null}
      {owner === null && others.length === 0 ? <p className="note-switch-empty">{t('노트가 없습니다')}</p> : null}
      {owner === null && onCreate !== undefined ? (
        <button
          type="button"
          role="menuitem"
          className="note-switch-item note-switch-create"
          onClick={() => {
            onClose()
            onCreate()
          }}
        >
          <Plus size={14} weight="bold" aria-hidden="true" />
          <span>{t('새 노트 만들기')}</span>
        </button>
      ) : null}
      {onTrashCurrent === undefined || currentPath === null ? null : (
        <>
          <hr className="note-switch-sep" />
          <button type="button" role="menuitem" className="note-switch-item note-switch-danger" onClick={() => { onClose(); onTrashCurrent() }}>
            <Trash size={14} aria-hidden="true" />
            <span>{t('이 노트를 휴지통으로 이동…')}</span>
          </button>
        </>
      )}
    </div>
  )
}
