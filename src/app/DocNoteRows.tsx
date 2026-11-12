import { useState, type CSSProperties } from 'react'
import { fitMenuInViewport } from '../ui/fitMenu'
import { ArrowSquareIn, ArrowSquareOut, Browsers, ClipboardText, Eraser, PencilSimple, Smiley, Trash } from '@phosphor-icons/react'
import type { FolderColor } from '../core/folderColors'
import type { MemoNoteEntry } from '../core/memoNote'
import { t } from '../i18n'
import { ItemEmoji } from './ItemEmoji'
import { NoteGlyph, memoNoteIconKey } from './MemoNotesSection'

/**
 * 왼쪽 바에서 PDF 줄 아래에 펼쳐지는 그 PDF 의 노트들(노트 아이콘 + 제목 한 줄씩).
 * 누르면 오른쪽 바에 열리고, 두 번 누르면 이름 바꾸기, 우클릭 메뉴에 이름 바꾸기·이모지·위치·휴지통이 있다.
 */
export function DocNoteRows({ entries, openPath, depth, onOpen, onOpenInTab, onRename, onTrash, icons = {}, colors = {}, onPickIcon, onClearIcon, onReveal, onCopyPath }: {
  readonly entries: readonly MemoNoteEntry[]
  readonly openPath: string | null
  readonly depth: number
  readonly onOpen: (path: string) => void
  /** 노트를 창의 탭으로 연다. 없으면 메뉴에 보이지 않는다 */
  readonly onOpenInTab?: (path: string) => void
  readonly onRename: (path: string, title: string) => Promise<void>
  readonly onTrash: (path: string) => Promise<void>
  readonly icons?: Readonly<Record<string, string>>
  readonly colors?: Readonly<Record<string, FolderColor>>
  readonly onPickIcon?: (key: string, x: number, y: number) => void
  readonly onClearIcon?: (key: string) => void
  readonly onReveal?: (path: string) => void
  readonly onCopyPath?: (path: string) => void
}) {
  const [menu, setMenu] = useState<{ path: string; title: string; x: number; y: number } | null>(null)
  const [renaming, setRenaming] = useState<{ path: string; value: string } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const fail = (cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause))

  const commitRename = () => {
    if (renaming === null) return
    const { path, value } = renaming
    setRenaming(null)
    if (value.trim() !== '') onRename(path, value.trim()).catch(fail)
  }

  const menuKey = menu === null ? '' : memoNoteIconKey(menu.path)

  return (
    <ul className="side-doc-notes" role="group" aria-label={t('이 PDF의 노트')} style={{ '--side-tree-depth': depth } as CSSProperties}>
      {entries.map((entry) => {
        const key = memoNoteIconKey(entry.path)
        const isOpen = entry.path === openPath
        return (
          <li key={entry.path} className="side-doc-note-item" data-memo-row="doc-note" data-path={entry.path}>
            {renaming?.path === entry.path ? (
              <div className="side-item side-tree-item side-inline-rename-row">
                <ItemEmoji emoji={icons[key]} fallback={<NoteGlyph color={colors[key]} />} />
                <input
                  className="side-inline-rename"
                  aria-label={t('{name} 노트 이름', { name: entry.title })}
                  value={renaming.value}
                  autoFocus
                  onFocus={(event) => event.currentTarget.select()}
                  onChange={(event) => setRenaming({ path: entry.path, value: event.target.value })}
                  onBlur={commitRename}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') commitRename()
                    else if (event.key === 'Escape') setRenaming(null)
                  }}
                />
              </div>
            ) : (
              <button
                type="button"
                className={`side-item side-tree-item side-memo-note side-doc-note${isOpen ? ' side-item-open side-memo-note-open' : ''}`}
                aria-current={isOpen ? 'true' : undefined}
                onClick={() => onOpen(entry.path)}
                onPointerDown={(event) => event.stopPropagation()}
                onDoubleClick={() => setRenaming({ path: entry.path, value: entry.title })}
                onContextMenu={(event) => {
                  event.preventDefault()
                  event.stopPropagation()
                  setMenu({ path: entry.path, title: entry.title, x: event.clientX, y: event.clientY })
                }}
              >
                <ItemEmoji
                  emoji={icons[key]}
                  onPick={onPickIcon === undefined ? undefined : (x, y) => onPickIcon(key, x, y)}
                  fallback={<NoteGlyph color={colors[key]} />}
                />
                <span className="side-item-title">{entry.title}</span>
              </button>
            )}
          </li>
        )
      })}
      {error !== null ? <li className="side-action-error" role="alert">{error}</li> : null}
      {menu === null ? null : (
        <li className="side-doc-note-menu-host">
          <div className="side-menu-backdrop" onClick={() => setMenu(null)} onContextMenu={(event) => { event.preventDefault(); setMenu(null) }} />
          <div
            className="side-context-menu"
            role="menu"
            aria-label={t('{name} 작업', { name: menu.title })}
            style={{ left: menu.x, top: menu.y }}
            ref={(element) => {
              if (element === null) return
              fitMenuInViewport(element)
            }}
          >
            <button type="button" role="menuitem" onClick={() => { onOpen(menu.path); setMenu(null) }}>
              <span className="side-context-icon" aria-hidden="true"><ArrowSquareIn size={15} /></span><span className="side-context-label">{t('열기')}</span>
            </button>
            {onOpenInTab === undefined ? null : (
              <button type="button" role="menuitem" onClick={() => { onOpenInTab(menu.path); setMenu(null) }}>
                <span className="side-context-icon" aria-hidden="true"><Browsers size={15} /></span><span className="side-context-label">{t('탭으로 열기')}</span>
              </button>
            )}
            <button type="button" role="menuitem" onClick={() => { setRenaming({ path: menu.path, value: menu.title }); setMenu(null) }}>
              <span className="side-context-icon" aria-hidden="true"><PencilSimple size={15} /></span><span className="side-context-label">{t('이름 바꾸기')}</span>
            </button>
            {onPickIcon === undefined ? null : (
              <button type="button" role="menuitem" onClick={() => { onPickIcon(menuKey, menu.x, menu.y); setMenu(null) }}>
                <span className="side-context-icon" aria-hidden="true"><Smiley size={15} /></span><span className="side-context-label">{icons[menuKey] === undefined ? t('이모지 설정…') : t('이모지 바꾸기…')}</span>
              </button>
            )}
            {onClearIcon === undefined || icons[menuKey] === undefined ? null : (
              <button type="button" role="menuitem" onClick={() => { onClearIcon(menuKey); setMenu(null) }}>
                <span className="side-context-icon" aria-hidden="true"><Eraser size={15} /></span><span className="side-context-label">{t('이모지 지우기')}</span>
              </button>
            )}
            {onReveal === undefined && onCopyPath === undefined ? null : <hr className="side-context-sep" />}
            {onReveal === undefined ? null : (
              <button type="button" role="menuitem" onClick={() => { onReveal(menu.path); setMenu(null) }}>
                <span className="side-context-icon" aria-hidden="true"><ArrowSquareOut size={15} /></span><span className="side-context-label">{t('탐색기에서 보기')}</span>
              </button>
            )}
            {onCopyPath === undefined ? null : (
              <button type="button" role="menuitem" onClick={() => { onCopyPath(menu.path); setMenu(null) }}>
                <span className="side-context-icon" aria-hidden="true"><ClipboardText size={15} /></span><span className="side-context-label">{t('경로 복사')}</span>
              </button>
            )}
            <hr className="side-context-sep" />
            <button type="button" role="menuitem" className="side-context-danger" onClick={() => { const { path } = menu; setMenu(null); onTrash(path).catch(fail) }}>
              <span className="side-context-icon" aria-hidden="true"><Trash size={15} /></span><span className="side-context-label">{t('휴지통으로 이동')}</span>
            </button>
          </div>
        </li>
      )}
    </ul>
  )
}
