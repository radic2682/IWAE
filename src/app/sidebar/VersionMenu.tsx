import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Check, Columns, PencilSimple, PushPin } from '@phosphor-icons/react'
import type { VersionGroup } from '../../core/versionGroups'
import { t } from '../../i18n'

export interface VersionMenuActions {
  /** 판을 연다(지금 탭 자리에서) */
  readonly onOpen: (docId: string) => void
  /** 핀: 이 판을 문서 기본 판으로 */
  readonly onPin: (docId: string) => void
  readonly onRename: (docId: string, label: string) => void
  /** 이 판을 묶음에서 뺀다(파일은 그대로, 독립 문서로) */
  readonly onRemove: (docId: string) => void
  readonly onDissolve: (groupId: string) => void
  /** 묶음 이름 바꾸기(묶음 줄을 더블클릭해 고친다) */
  readonly onRenameGroup?: (groupId: string, title: string) => void
  /** 다른 문서를 이 묶음의 판으로 겹친다(문서 고르는 창) */
  readonly onAddVersion: (groupId: string) => void
  /** 왼쪽 바에서 PDF 를 다른 PDF 위에 놓았다: 판으로 겹치기 확인 창(App) */
  readonly onStack?: (draggedDocId: string, baseDocId: string) => void
  /** 이 판을 옆 패널에 나란히 연다(탭에서 연 메뉴일 때만, 지금 보는 판과 비교) */
  readonly onCompare?: (docId: string) => void
}

interface VersionMenuProps extends VersionMenuActions {
  readonly group: VersionGroup
  /** 지금 열려 있는 판들 */
  readonly openDocIds: readonly string[]
  /** 이 탭이 지금 보는 판(탭에서 연 메뉴일 때 체크로 보인다) */
  readonly currentDocId?: string
  /** 메뉴를 붙일 단추의 화면 자리 */
  readonly anchor: DOMRect
  readonly onClose: () => void
}

/**
 * 판 고르기 드롭다운. 판마다 [핀] 이름 [열림 점]. 이름을 누르면 그 판을 열고, 핀을 누르면 그 판이 문서의 기본 판이 된다.
 * 판 이름은 두 번 눌러 고친다. 판 넣기·빼기는 왼쪽 바에서 끌어 놓기로 한다.
 */
export function VersionMenu({ group, openDocIds, currentDocId, anchor, onClose, onOpen, onPin, onRename, onCompare }: VersionMenuProps) {
  const ref = useRef<HTMLDivElement | null>(null)
  const [editing, setEditing] = useState<string | null>(null)
  const [draft, setDraft] = useState('')

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      if (editing !== null) setEditing(null)
      else onClose()
    }
    const onDown = (event: PointerEvent) => {
      if (event.target instanceof Node && ref.current?.contains(event.target)) return
      onClose()
    }
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('pointerdown', onDown, true)
    window.addEventListener('blur', onClose)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('pointerdown', onDown, true)
      window.removeEventListener('blur', onClose)
    }
  }, [editing, onClose])

  const left = Math.min(Math.max(8, anchor.left), window.innerWidth - 268)
  const top = Math.min(anchor.bottom + 4, window.innerHeight - 40)

  const commitRename = (docId: string) => {
    if (draft.trim() !== '') onRename(docId, draft)
    setEditing(null)
  }

  return createPortal(
    <div ref={ref} className="version-menu" role="menu" aria-label={t('{title} 버전', { title: group.title })} style={{ left, top }}>
      <ul className="version-menu-list">
        {group.versions.map((version) => {
          const isDefault = version.docId === group.defaultDocId
          const open = openDocIds.includes(version.docId)
          return (
            <li key={version.docId} className="version-menu-row">
              <button
                type="button"
                className={`version-menu-pin${isDefault ? ' version-menu-pin-on' : ''}`}
                aria-label={isDefault ? t('{label} 기본 버전', { label: version.label }) : t('{label} 기본 버전으로', { label: version.label })}
                aria-pressed={isDefault}
                title={isDefault ? t('문서 기본 버전') : t('문서 기본 버전으로')}
                onClick={() => onPin(version.docId)}
              >
                <PushPin size={13} weight={isDefault ? 'fill' : 'regular'} aria-hidden="true" />
              </button>
              {editing === version.docId ? (
                <input
                  className="version-menu-input"
                  aria-label={t('버전 이름')}
                  value={draft}
                  autoFocus
                  onChange={(event) => setDraft(event.target.value)}
                  onBlur={() => commitRename(version.docId)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') { event.preventDefault(); commitRename(version.docId) }
                  }}
                />
              ) : (
                <button
                  type="button"
                  role="menuitem"
                  className="version-menu-name"
                  title={t('열기, 두 번 눌러 이름 바꾸기')}
                  onClick={() => { onOpen(version.docId); onClose() }}
                  onDoubleClick={(event) => { event.preventDefault(); setDraft(version.label); setEditing(version.docId) }}
                >
                  {currentDocId === version.docId ? <Check size={12} weight="bold" aria-label={t('지금 보는 버전')} /> : null}
                  <span>{version.label}</span>
                  {open ? <i className="version-menu-open" aria-label={t('열려 있음')} /> : null}
                </button>
              )}
              {onCompare !== undefined && currentDocId !== undefined && version.docId !== currentDocId ? (
                <button type="button" className="version-menu-compare" aria-label={t('{label} 나란히 비교', { label: version.label })} title={t('나란히 비교')} onClick={() => { onCompare(version.docId); onClose() }}>
                  <Columns size={13} aria-hidden="true" />
                </button>
              ) : null}
</li>
          )
        })}
      </ul>
    </div>,
    document.body,
  )
}

/** 판 칩(a)의 드롭다운: 묶음 줄을 눌렀을 때 열릴 기본 판을 고른다 */
export function DefaultVersionMenu({ group, anchor, onPick, onRename, onClose }: {
  readonly group: VersionGroup
  readonly anchor: DOMRect
  readonly onPick: (docId: string) => void
  /** 판 이름 바꾸기(연필 단추 또는 두 번 누르기) */
  readonly onRename?: (docId: string, label: string) => void
  readonly onClose: () => void
}) {
  const ref = useRef<HTMLDivElement | null>(null)
  const [editing, setEditing] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const startEdit = (docId: string, label: string) => {
    if (onRename === undefined) return
    setDraft(label)
    setEditing(docId)
  }
  const commitEdit = (docId: string) => {
    if (draft.trim() !== '') onRename?.(docId, draft)
    setEditing(null)
  }
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      if (editing !== null) setEditing(null)
      else onClose()
    }
    const onDown = (event: PointerEvent) => {
      if (event.target instanceof Node && ref.current?.contains(event.target)) return
      onClose()
    }
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('pointerdown', onDown, true)
    window.addEventListener('blur', onClose)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('pointerdown', onDown, true)
      window.removeEventListener('blur', onClose)
    }
  }, [editing, onClose])
  const left = Math.min(Math.max(8, anchor.left), window.innerWidth - 228)
  const top = Math.min(anchor.bottom + 4, window.innerHeight - 40)
  return createPortal(
    <div ref={ref} className="version-menu version-default-menu" role="menu" aria-label={t('{title} 기본 버전', { title: group.title })} style={{ left, top }}>
      <div className="version-default-head">{t('기본 버전')}</div>
      {group.versions.map((version) => {
        const isDefault = version.docId === group.defaultDocId
        if (editing === version.docId) {
          return (
            <div key={version.docId} className="version-default-row">
              <input
                className="version-menu-input version-default-input"
                aria-label={t('버전 이름')}
                value={draft}
                autoFocus
                onFocus={(event) => event.currentTarget.select()}
                onChange={(event) => setDraft(event.target.value)}
                onBlur={() => commitEdit(version.docId)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') { event.preventDefault(); commitEdit(version.docId) }
                }}
              />
            </div>
          )
        }
        return (
          <div key={version.docId} className="version-default-row">
            <button
              type="button"
              role="menuitemradio"
              aria-checked={isDefault}
              className={`version-default-item${isDefault ? ' version-default-item-on' : ''}`}
              title={onRename === undefined ? undefined : t('기본 버전으로, 두 번 눌러 이름 바꾸기')}
              onClick={() => { onPick(version.docId); onClose() }}
              onDoubleClick={(event) => { event.preventDefault(); startEdit(version.docId, version.label) }}
            >
              <span className="version-default-check">{isDefault ? <Check size={12} weight="bold" aria-hidden="true" /> : null}</span>
              <span>{version.label}</span>
            </button>
            {onRename === undefined ? null : (
              <button
                type="button"
                className="version-default-rename"
                aria-label={t('{label} 이름 바꾸기', { label: version.label })}
                title={t('이름 바꾸기')}
                onClick={() => startEdit(version.docId, version.label)}
              >
                <PencilSimple size={12} aria-hidden="true" />
              </button>
            )}
          </div>
        )
      })}
    </div>,
    document.body,
  )
}

