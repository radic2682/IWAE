import { useEffect, useMemo, useRef } from 'react'
import { Browsers, NotePencil, Plus, Trash } from '@phosphor-icons/react'
import { groupMemoNotesByDoc, type MemoNoteEntry } from '../core/memoNote'
import { t } from '../i18n'
import type { MemoNoteApi } from './memoNoteContext'

/** 지금 문서가 가진 노트와 다른 노트로 나눈다. 문서가 노트를 가질 수 없으면(Markdown 등) 모두 한 목록 */
export function noteSwitcherGroups(api: MemoNoteApi, currentDocId: string): {
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
  // 다른 PDF 의 노트를 열어 두었으면 그 노트도 목록에 보여 지금 보는 노트를 알 수 있게 한다
  const open = api.entries.find((entry) => entry.path === api.openPath)
  if (open !== undefined && !mine.some((entry) => entry.path === open.path) && !others.some((entry) => entry.path === open.path)) others.push(open)
  return { owner, mine, others }
}

/** 오른쪽 바 머리의 노트 바꾸기 목록: 「이 PDF 의 노트」 · 구분선 · 「다른 노트」 */
export function NoteSwitcherMenu({ api, currentDocId, docLabel, onClose, onTrashOpen }: {
  readonly api: MemoNoteApi
  readonly currentDocId: string
  /** 「이 PDF 의 노트 · …」 에 쓸 문서 이름 */
  readonly docLabel: string
  readonly onClose: () => void
  /** 「이 노트 휴지통으로 이동…」을 눌렀다(열린 노트가 있을 때만 항목이 보인다) */
  readonly onTrashOpen?: () => void
}) {
  const ref = useRef<HTMLDivElement | null>(null)
  const { owner, mine, others } = useMemo(() => noteSwitcherGroups(api, currentDocId), [api, currentDocId])

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
    const current = entry.path === api.openPath
    return (
      <button
        key={entry.path}
        type="button"
        role="menuitemradio"
        aria-checked={current}
        className={`note-switch-item${current ? ' note-switch-item-current' : ''}`}
        onClick={() => {
          api.open(entry.path)
          onClose()
        }}
      >
        <NotePencil size={14} aria-hidden="true" />
        <span>{entry.title}</span>
      </button>
    )
  }

  return (
    <div ref={ref} className="note-switch-menu" role="menu" aria-label={t('노트 바꾸기')}>
      {owner !== null ? (
        <div role="group" aria-label={t('이 PDF의 노트 · {title}', { title: docLabel })}>
          <div className="note-switch-head">{t('이 PDF의 노트 · {title}', { title: docLabel })}</div>
          {mine.map(item)}
          {api.createForDoc === undefined ? null : (
            <button
              type="button"
              role="menuitem"
              className="note-switch-item note-switch-create"
              onClick={() => {
                onClose()
                void api.createForDoc?.(currentDocId)
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
      {(onTrashOpen === undefined && api.openInTab === undefined) || api.openPath === null ? null : (
        <>
          <hr className="note-switch-sep" />
          {api.openInTab === undefined ? null : (
            <button type="button" role="menuitem" className="note-switch-item note-switch-open-tab" onClick={() => { const path = api.openPath; onClose(); if (path !== null) api.openInTab?.(path) }}>
              <Browsers size={14} aria-hidden="true" />
              <span>{t('이 노트를 탭으로 열기')}</span>
            </button>
          )}
          {onTrashOpen === undefined ? null : (
            <button type="button" role="menuitem" className="note-switch-item note-switch-danger" onClick={() => { onClose(); onTrashOpen() }}>
              <Trash size={14} aria-hidden="true" />
              <span>{t('이 노트 휴지통으로 이동…')}</span>
            </button>
          )}
        </>
      )}
    </div>
  )
}
