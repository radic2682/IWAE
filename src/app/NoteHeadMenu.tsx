import { useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { CaretDown } from '@phosphor-icons/react'
import { memoNoteTitleOf } from '../core/memoNote'
import { t } from '../i18n'
import { requestTitleEdit, type MemoNoteApi } from '../pdf/memoNoteContext'
import { NoteSwitcherMenu } from '../pdf/NoteSwitcher'
import { DeleteEntryDialog } from './SidebarDialogs'

/**
 * 칸 머리의 메모 노트 탭 제목 뒤 작은 ⌄: 「노트 열기」 목록(다른 노트로 바꾸기 · 새 노트 · 이 노트 휴지통)을 연다.
 * 예전에는 노트 탭 도구줄의 첫 줄(노트 이름 ⌄)이었고, 이름이 칸 머리와 겹쳐 두 번 보여서 칸 머리로 옮겼다.
 * 노트를 바꿀 수 없으면(열 수 있는 노트가 없다) 아무것도 그리지 않는다.
 */
export function NoteHeadMenu({ api, path }: { readonly api: MemoNoteApi; readonly path: string }) {
  const [at, setAt] = useState<{ readonly left: number; readonly top: number } | null>(null)
  const [trashTarget, setTrashTarget] = useState<{ readonly path: string; readonly title: string } | null>(null)
  const button = useRef<HTMLButtonElement | null>(null)
  const noteDocId = api.noteAt(path)?.docId ?? ''
  const canSwitch = api.openInTab !== undefined && api.entries.length > 0
  if (!canSwitch && trashTarget === null) return null
  const close = () => setAt(null)
  const create = (created: string | null) => {
    if (created === null) return
    api.openInTab?.(created)
    requestTitleEdit(created)
  }
  return (
    <>
      {canSwitch ? (
        <button
          ref={button}
          type="button"
          className="pane-top-tab-note-menu"
          data-note-switch-trigger=""
          data-tauri-drag-region="false"
          aria-haspopup="menu"
          aria-expanded={at !== null}
          aria-label={t('노트 바꾸기: {title}', { title: memoNoteTitleOf(path) })}
          title={t('눌러서 노트 바꾸기 · 제목을 두 번 눌러 이름 바꾸기')}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={() => {
            if (at !== null) { close(); return }
            const box = button.current?.getBoundingClientRect()
            setAt({ left: Math.min(box?.left ?? 0, Math.max(window.innerWidth - 300, 8)), top: (box?.bottom ?? 0) + 4 })
          }}
        >
          <CaretDown size={11} weight="bold" aria-hidden="true" />
        </button>
      ) : null}
      {at === null ? null : createPortal(
        <div className="note-head-menu-pop" style={{ left: at.left, top: at.top }}>
          <NoteSwitcherMenu
            api={api}
            currentDocId={noteDocId}
            docLabel={api.docLabel?.(noteDocId) ?? ''}
            currentPath={path}
            onPick={(picked) => api.openInTab?.(picked)}
            onCreate={api.createForDoc !== undefined && noteDocId !== '' && api.docOwner?.(noteDocId) != null
              ? () => { void api.createForDoc?.(noteDocId).then(create) }
              : () => { void api.create().then(create) }}
            onClose={close}
            onTrashCurrent={api.trashNote === undefined ? undefined : () => setTrashTarget({ path, title: memoNoteTitleOf(path) })}
          />
        </div>,
        document.body,
      )}
      {trashTarget !== null && api.trashNote !== undefined ? (
        <DeleteEntryDialog
          kind="note"
          name={trashTarget.title}
          path={trashTarget.path.replaceAll('\\', '/').split('/').slice(0, -1).join('/')}
          onConfirm={() => api.trashNote!(trashTarget.path, 'note-tab-confirmed')}
          onClose={() => setTrashTarget(null)}
        />
      ) : null}
    </>
  )
}
