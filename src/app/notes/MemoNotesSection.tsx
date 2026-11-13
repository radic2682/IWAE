import { t } from '../../i18n'
import { fitMenuInViewport } from '../../ui/fitMenu'
import { Fragment, useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react'
import { ArrowSquareIn, ArrowSquareOut, ArrowsInLineVertical, Browsers, ArrowsOutLineVertical, CaretDown, CaretRight, ClipboardText, Eraser, Export, FilePlus, Folder, FolderPlus, Notebook, NotePencil, Palette, PencilSimple, Plus, Smiley, Trash } from '@phosphor-icons/react'
import { memoNotesFolder, isInsideMemoFolder, memoParentOf, type MemoNoteEntry } from '../../core/memoNote'
import { FOLDER_COLORS, folderColorHex, folderColorLabel, type FolderColor } from '../../core/folderColors'
import { ItemEmoji } from '../sidebar/ItemEmoji'
import { APP_COMMAND_EVENT } from '../../ui/documentContextMenu'
import { DeleteFolderDialog } from '../sidebar/SidebarDialogs'
import { createPillGhost, startDockSession, type DockSession, type PillGhost, type SidebarPaneDrop } from '../workspace/dockSession'
import { setDockDragging, setDockDropOk } from '../workspace/tabDrag'
import type { TabDropTarget } from '../workspace/tabDock'

/** 노트 이모지·색의 열쇠(파일·폴더 이모지와 같은 표에 둔다) */
export function memoNoteIconKey(path: string): string {
  return `memo-note:${path}`
}

/** 노트 폴더 이모지·색의 열쇠. PDF 폴더(folder:…)와 겹치지 않게 따로 둔다 */
export function memoFolderIconKey(path: string): string {
  return `memo-folder:${path}`
}

export interface MemoNotesSectionProps {
  /** 모든 노트. PDF 에 속한 노트(docId 가 있고 그 PDF 가 있는 것)는 왼쪽 바의 그 PDF 줄 아래에 보이고 이 구역에는 일반 노트만 남는다 */
  readonly entries: readonly MemoNoteEntry[]
  /** 문서 id → 노트를 가지는 PDF 줄의 열쇠. 모르는(지워진) PDF 면 null 이라 그 노트는 이 구역에 남는다 */
  readonly docOwner?: (docId: string) => string | null
  /** PDF 줄의 「+」·우클릭: 그 PDF 에 노트를 만든다 */
  readonly onCreateForDoc?: (docId: string) => void
  /** 오른쪽 바에 열린 노트 */
  readonly openPath: string | null
  readonly onOpen: (path: string) => void
  /** 노트를 창의 탭으로 연다(문서 옆에, 이미 노트를 보이는 창이 있으면 그 창의 탭으로). 없으면 메뉴에 보이지 않는다 */
  readonly onOpenInTab?: (path: string) => void
  readonly onCreate: () => void
  /** 그 폴더에 새 노트(폴더 우클릭·폴더 줄의 +) */
  readonly onCreateIn?: (folder: string) => void
  readonly onRename: (path: string, title: string) => Promise<void>
  readonly onTrash: (path: string) => Promise<void>
  /** 노트 이모지(열쇠는 memoNoteIconKey). 아이콘을 누르거나 우클릭으로 고른다 */
  readonly icons?: Readonly<Record<string, string>>
  readonly onPickIcon?: (key: string, x: number, y: number) => void
  readonly onClearIcon?: (key: string) => void
  /** 끌어서(또는 Alt+↑↓로) 바꾼 차례. 노트 경로 전체를 새 차례로 준다 */
  readonly onReorder?: (paths: readonly string[]) => void
  /** 「노트」 아래 하위 폴더(Vault 상대 경로, 예: 노트/회의) */
  readonly folders?: readonly string[]
  readonly onCreateFolder?: (parent: string, name: string) => Promise<void>
  readonly onRenameFolder?: (path: string, name: string) => Promise<void>
  readonly onTrashFolder?: (path: string) => Promise<void>
  /** 노트를 다른 폴더로. place 를 주면 그 노트 앞·뒤에 놓는다 */
  readonly onMove?: (path: string, folder: string, place?: { readonly target: string; readonly position: 'before' | 'after' }) => Promise<void>
  readonly onMoveFolder?: (path: string, parent: string) => Promise<void>
  /** 노트·폴더 색(열쇠는 memoNoteIconKey·memoFolderIconKey). 폴더 색과 같은 표 */
  readonly colors?: Readonly<Record<string, FolderColor>>
  readonly onColorChange?: (key: string, color: FolderColor | null) => void
  /** 탐색기에서 보기 */
  readonly onReveal?: (path: string) => void
  readonly onCopyPath?: (path: string) => void
  /** 펼친 폴더를 기억할 저장소 열쇠(Vault 마다). 없으면 이번 실행 동안만 */
  readonly expandedStorageKey?: string
  /** 노트 줄을 칸으로 끌어 열기. 없으면 목록 안에서만 옮긴다 */
  readonly paneDrop?: SidebarPaneDrop
}

/** 이만큼(px) 움직여야 누르기가 아니라 끌기로 본다 */
const DRAG_START_PX = 4

type Row =
  | { readonly kind: 'folder'; readonly path: string; readonly name: string; readonly depth: number }
  | { readonly kind: 'note'; readonly entry: MemoNoteEntry; readonly parent: string; readonly depth: number }

type Drop =
  | { readonly kind: 'inside'; readonly folder: string; readonly row: string }
  | { readonly kind: 'beside'; readonly folder: string; readonly row: string; readonly target: string | null; readonly position: 'before' | 'after' }

function folderName(path: string): string {
  return path.split('/').at(-1) ?? path
}

/** 경로 목록에서 path 를 target 앞·뒤로 옮긴 새 차례 */
function placeNear(paths: readonly string[], path: string, target: string | null, position: 'before' | 'after'): string[] {
  const rest = paths.filter((item) => item !== path)
  if (target === null) return [...rest, path]
  const at = rest.indexOf(target)
  if (at < 0) return [...rest, path]
  rest.splice(position === 'before' ? at : at + 1, 0, path)
  return rest
}

function readExpanded(key: string | undefined): ReadonlySet<string> {
  if (key === undefined) return new Set()
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(key) ?? '[]')
    return new Set(Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [])
  } catch {
    return new Set()
  }
}

/** 노트 그림. 색을 정했으면 그 색으로 칠한다(폴더 색처럼) */
export function NoteGlyph({ color }: { readonly color?: FolderColor }) {
  const hex = folderColorHex(color)
  return hex === undefined
    ? <NotePencil className="side-file-icon" size={14} aria-hidden="true" />
    : <NotePencil className="side-file-icon side-memo-note-colored" size={15} weight="fill" style={{ color: hex }} aria-hidden="true" />
}

function FolderGlyph({ color }: { readonly color?: FolderColor }) {
  const hex = folderColorHex(color)
  return hex === undefined
    ? <Folder className="side-folder-icon" size={14} aria-hidden="true" />
    : <Folder className="side-folder-icon side-folder-icon-colored" size={15} weight="fill" style={{ color: hex }} aria-hidden="true" />
}

/**
 * 왼쪽 바의 「노트」: 메모 노트 목록. 누르면 오른쪽 바에 열린다(PDF 와 따로).
 * 「노트」 폴더 아래 하위 폴더로 묶고(PDF 트리와 같은 모양), 끌어서 차례를 바꾸거나 다른 폴더로 옮긴다.
 * 우클릭으로 이름 바꾸기·색·이모지·옮기기·탐색기에서 보기·지우기(지우면 .iwae/trash/notes 로 옮긴다).
 */
export function MemoNotesSection({
  entries,
  openPath,
  onOpen,
  onOpenInTab,
  onCreate,
  onCreateIn,
  onRename,
  onTrash,
  icons = {},
  onPickIcon,
  onClearIcon,
  onReorder,
  folders = [],
  onCreateFolder,
  onRenameFolder,
  onTrashFolder,
  onMove,
  onMoveFolder,
  colors = {},
  onColorChange,
  onReveal,
  onCopyPath,
  expandedStorageKey,
  paneDrop,
}: MemoNotesSectionProps) {
  const [menu, setMenu] = useState<{ kind: 'note' | 'folder'; path: string; title: string; x: number; y: number } | null>(null)
  const [colorPop, setColorPop] = useState<{ key: string; label: string; x: number; y: number } | null>(null)
  const [renaming, setRenaming] = useState<{ kind: 'note' | 'folder'; path: string; value: string } | null>(null)
  const [draftFolder, setDraftFolder] = useState<{ parent: string; value: string } | null>(null)
  const [deleteFolder, setDeleteFolder] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => readExpanded(expandedStorageKey))
  const [loadedKey, setLoadedKey] = useState(expandedStorageKey)
  if (loadedKey !== expandedStorageKey) {
    setLoadedKey(expandedStorageKey)
    setExpanded(readExpanded(expandedStorageKey))
  }
  useEffect(() => {
    if (expandedStorageKey === undefined) return
    try {
      window.localStorage.setItem(expandedStorageKey, JSON.stringify([...expanded]))
    } catch {
      // 저장소를 못 쓰면 이번 실행 동안만 기억한다
    }
  }, [expanded, expandedStorageKey])

  /** 끌고 있는 줄과 놓을 자리 */
  const [drag, setDrag] = useState<{ from: string; drop: Drop | null } | null>(null)
  const listRef = useRef<HTMLUListElement | null>(null)
  const pressRef = useRef<{ row: Row; startY: number; pointerId: number; active: boolean } | null>(null)
  const suppressClickRef = useRef(false)
  const stopPressRef = useRef<(() => void) | null>(null)
  useEffect(() => () => stopPressRef.current?.(), [])

  const fail = (cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause))
  const paths = entries.map((entry) => entry.path)
  const folderSet = useMemo(() => new Set(folders), [folders])
  /** 노트가 든 폴더. 모르는 폴더면 맨 위로 본다 */
  const parentOfNote = (path: string) => {
    const parent = memoParentOf(path)
    return folderSet.has(parent) ? parent : memoNotesFolder()
  }

  const rows = useMemo(() => {
    const out: Row[] = []
    const childFolders = (parent: string) => folders
      .filter((folder) => memoParentOf(folder) === parent)
      .sort((a, b) => folderName(a).localeCompare(folderName(b), 'ko-KR'))
    const walk = (parent: string, depth: number) => {
      for (const folder of childFolders(parent)) {
        out.push({ kind: 'folder', path: folder, name: folderName(folder), depth })
        if (expanded.has(folder) || draftFolder?.parent === folder) walk(folder, depth + 1)
      }
      for (const entry of entries) {
        const own = memoParentOf(entry.path)
        const parentFolder = folderSet.has(own) ? own : memoNotesFolder()
        if (parentFolder === parent) out.push({ kind: 'note', entry, parent, depth })
      }
    }
    walk(memoNotesFolder(), 0)
    return out
  }, [draftFolder?.parent, entries, expanded, folderSet, folders])

  const rowKey = (row: Row) => row.kind === 'folder' ? `folder:${row.path}` : row.entry.path

  const reorder = (path: string, target: string, position: 'before' | 'after') => {
    if (onReorder === undefined) return
    const next = placeNear(paths, path, target, position)
    if (next.join('\n') !== paths.join('\n')) onReorder(next)
  }

  /** 포인터 높이에서 놓을 자리 */
  const dropAt = (dragged: Row, clientY: number): Drop | null => {
    const items = [...(listRef.current?.children ?? [])].filter((item): item is HTMLElement => item instanceof HTMLElement && item.dataset.memoRow !== undefined)
    if (items.length === 0) return null
    const hit = items.find((item) => {
      const rect = item.getBoundingClientRect()
      return clientY >= rect.top && clientY < rect.bottom
    })
    const last = items.at(-1)!
    if (hit === undefined) {
      // 목록 아래 빈 곳 = 「노트」 맨 위 폴더의 끝
      if (clientY >= last.getBoundingClientRect().bottom) return { kind: 'beside', folder: memoNotesFolder(), row: '', target: null, position: 'after' }
      return null
    }
    const kind = hit.dataset.memoRow
    const path = hit.dataset.path ?? ''
    const rect = hit.getBoundingClientRect()
    const ratio = rect.height > 0 ? (clientY - rect.top) / rect.height : 0.5
    const key = kind === 'folder' ? `folder:${path}` : path
    if (key === rowKey(dragged)) return null
    let drop: Drop
    if (kind === 'folder' && ratio > 0.25 && ratio < 0.75) {
      drop = { kind: 'inside', folder: path, row: key }
    } else if (kind === 'folder') {
      drop = { kind: 'beside', folder: memoParentOf(path), row: key, target: null, position: ratio < 0.5 ? 'before' : 'after' }
    } else {
      drop = { kind: 'beside', folder: parentOfNote(path), row: key, target: path, position: ratio < 0.5 ? 'before' : 'after' }
    }
    // 폴더를 자기 안(하위)으로는 못 넣는다
    if (dragged.kind === 'folder' && (drop.folder === dragged.path || isInsideMemoFolder(drop.folder, dragged.path))) return null
    return drop
  }

  const finishDrop = (dragged: Row, drop: Drop) => {
    if (dragged.kind === 'folder') {
      if (drop.folder === memoParentOf(dragged.path)) return
      onMoveFolder?.(dragged.path, drop.folder).catch(fail)
      return
    }
    const path = dragged.entry.path
    const place = drop.kind === 'beside' && drop.target !== null ? { target: drop.target, position: drop.position } : undefined
    if (drop.folder === dragged.parent) {
      if (place !== undefined) reorder(path, place.target, place.position)
      else if (drop.kind === 'beside' && drop.row === '') reorder(path, paths.at(-1) ?? path, 'after')
      return
    }
    onMove?.(path, drop.folder, place).catch(fail)
  }

  const canDrag = onReorder !== undefined || onMove !== undefined || onMoveFolder !== undefined

  const startPress = (row: Row) => (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return
    // 칸으로 끌어 열 수 있는 것은 노트 줄이다(폴더는 아니다). 목록 안에서 옮기는 것은 줄이 둘 이상일 때만
    const toPane = paneDrop !== undefined && row.kind === 'note'
    const inList = canDrag && rows.length >= 2
    if (!toPane && !inList) return
    if ((event.target as Element).closest('[data-emoji-pick]') !== null) return
    stopPressRef.current?.()
    const startX = event.clientX
    pressRef.current = { row, startY: event.clientY, pointerId: event.pointerId, active: false }
    const icon = event.currentTarget.querySelector('.item-emoji, svg')
    const title = row.kind === 'folder' ? row.name : row.entry.title
    const section = listRef.current?.closest('.side-memo-notes') ?? listRef.current
    /** 목록 안인가: 밖에서는 목록의 놓을 자리 줄을 보이지 않고, 놓아도 차례를 바꾸지 않는다 */
    const insideList = (x: number, y: number) => {
      const bounds = section?.getBoundingClientRect()
      return bounds !== undefined && x >= bounds.left && x < bounds.right && y >= bounds.top && y < bounds.bottom
    }
    let ghost: PillGhost | null = null
    let session: DockSession | null = null
    let target: TabDropTarget | null = null
    const move = (moveEvent: PointerEvent) => {
      const press = pressRef.current
      if (press === null || moveEvent.pointerId !== press.pointerId) return
      if (!press.active) {
        if (Math.hypot(moveEvent.clientX - startX, moveEvent.clientY - press.startY) < DRAG_START_PX) return
        press.active = true
        ghost = createPillGhost(icon, title)
        ghost.attach()
        window.getSelection()?.removeAllRanges()
        // 칸으로 열 수 있으면 끌기 세션이 dock-dragging 을 켠다(startDockSession). 아니면 여기서 켠다
        if (toPane) session = startDockSession({ edgesFor: (pane) => paneDrop.edgesFor(pane, { kind: 'note', path: row.kind === 'note' ? row.entry.path : '' }) })
        else setDockDragging(true)
      }
      moveEvent.preventDefault()
      ghost?.move(moveEvent.clientX, moveEvent.clientY)
      const inside = insideList(moveEvent.clientX, moveEvent.clientY)
      target = session?.update(moveEvent.clientX, moveEvent.clientY) ?? null
      const drop = inside && inList ? dropAt(press.row, moveEvent.clientY) : null
      setDockDropOk(drop !== null || target !== null)
      setDrag({ from: rowKey(press.row), drop })
    }
    const up = (upEvent: PointerEvent) => {
      const press = pressRef.current
      if (press === null || upEvent.pointerId !== press.pointerId) return
      const final = session?.update(upEvent.clientX, upEvent.clientY) ?? null
      stop()
      if (!press.active) return
      // 끈 뒤에 따라오는 click 은 노트 열기가 아니다
      suppressClickRef.current = true
      window.setTimeout(() => { suppressClickRef.current = false }, 0)
      if (final !== null && press.row.kind === 'note') {
        paneDrop?.open({ kind: 'note', path: press.row.entry.path }, final)
        return
      }
      if (!inList || !insideList(upEvent.clientX, upEvent.clientY)) return
      const drop = dropAt(press.row, upEvent.clientY)
      if (drop !== null) finishDrop(press.row, drop)
    }
    // Esc: 끄는 중이면 끌기만 취소하고 그 Esc 는 다른 곳(팔레트 · 메뉴 · 닫기)으로 가지 않게 먼저 받는다(capture + stopPropagation — tabDrag · internalDrag 와 같다)
    const key = (keyEvent: KeyboardEvent) => {
      if (keyEvent.key !== 'Escape') return
      if (pressRef.current?.active === true) {
        keyEvent.preventDefault()
        keyEvent.stopPropagation()
      }
      stop()
    }
    const stop = () => {
      pressRef.current = null
      setDrag(null)
      ghost?.remove()
      ghost = null
      session?.end()
      session = null
      setDockDragging(false)
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', stop)
      window.removeEventListener('keydown', key, true)
      stopPressRef.current = null
    }
    stopPressRef.current = stop
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', stop)
    window.addEventListener('keydown', key, true)
  }

  const commitRename = () => {
    if (renaming === null) return
    const { kind, path, value } = renaming
    setRenaming(null)
    if (value.trim() === '') return
    if (kind === 'note') onRename(path, value.trim()).catch(fail)
    else onRenameFolder?.(path, value.trim()).catch(fail)
  }

  const commitDraftFolder = () => {
    if (draftFolder === null) return
    const { parent, value } = draftFolder
    setDraftFolder(null)
    if (value.trim() === '' || onCreateFolder === undefined) return
    onCreateFolder(parent, value.trim())
      .then(() => setExpanded((current) => new Set([...current, parent])))
      .catch(fail)
  }

  const startDraftFolder = (parent: string) => {
    setDraftFolder({ parent, value: '' })
    if (parent !== memoNotesFolder()) setExpanded((current) => new Set([...current, parent]))
  }

  const toggleFolder = (path: string) => setExpanded((current) => {
    const next = new Set(current)
    if (next.has(path)) next.delete(path)
    else next.add(path)
    return next
  })

  /** PDF 머리의 「모든 폴더 접기/펼치기」와 같다 */
  const allFoldersCollapsed = folders.every((folder) => !expanded.has(folder))
  const toggleAllFolders = () => setExpanded(allFoldersCollapsed ? new Set(folders) : new Set())

  const openColorPop = (key: string, label: string, element: HTMLElement) => {
    const rect = element.getBoundingClientRect()
    setColorPop({ key, label, x: rect.left, y: rect.bottom + 4 })
  }

  const renameInput = (label: string) => renaming === null ? null : (
    <input
      className="side-inline-rename"
      aria-label={label}
      value={renaming.value}
      autoFocus
      onFocus={(event) => event.currentTarget.select()}
      onChange={(event) => setRenaming({ ...renaming, value: event.target.value })}
      onBlur={commitRename}
      onKeyDown={(event) => {
        if (event.key === 'Enter') commitRename()
        else if (event.key === 'Escape') setRenaming(null)
      }}
    />
  )

  const draftRow = (parent: string, depth: number) => draftFolder?.parent !== parent ? null : (
    <li className="side-tree-node side-tree-draft" key={`draft:${parent}`}>
      <div className="side-tree-row" style={{ '--side-tree-depth': depth } as CSSProperties}>
        <div className="side-item side-tree-item side-inline-rename-row side-draft-row">
          <Folder className="side-folder-icon" size={14} aria-hidden="true" />
          <input
            className="side-inline-rename"
            aria-label={t('새 노트 폴더 이름')}
            placeholder={t('새 폴더')}
            value={draftFolder.value}
            autoFocus
            spellCheck={false}
            onChange={(event) => setDraftFolder({ parent, value: event.target.value })}
            onBlur={commitDraftFolder}
            onKeyDown={(event) => {
              if (event.key === 'Enter') commitDraftFolder()
              else if (event.key === 'Escape') {
                event.stopPropagation()
                setDraftFolder(null)
              }
            }}
          />
        </div>
      </div>
    </li>
  )

  const colorButton = (key: string, label: string) => onColorChange === undefined ? null : (
    <button
      type="button"
      className="side-tree-add side-memo-color-btn"
      aria-label={t('{name} 색 바꾸기', { name: label })}
      title={t('색 바꾸기')}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => {
        event.stopPropagation()
        openColorPop(key, label, event.currentTarget)
      }}
    >
      <Palette size={12} weight="bold" aria-hidden="true" />
    </button>
  )

  /** 옮길 수 있는 폴더(맨 위 「노트」 포함). 지금 폴더와, 폴더라면 자기·자기 안은 뺀다 */
  const moveChoices = (kind: 'note' | 'folder', path: string) => {
    const current = kind === 'note' ? parentOfNote(path) : memoParentOf(path)
    return [memoNotesFolder(), ...[...folders].sort((a, b) => a.localeCompare(b, 'ko-KR'))].filter((folder) => (
      folder !== current && (kind === 'note' || (folder !== path && !isInsideMemoFolder(folder, path)))
    ))
  }

  const dropClass = (key: string) => {
    const drop = drag?.drop
    if (drop === null || drop === undefined || drop.row !== key) return ''
    if (drop.kind === 'inside') return 'side-tree-drop-inside'
    return drop.position === 'before' ? 'side-tree-drop-before side-memo-drop-before' : 'side-tree-drop-after side-memo-drop-after'
  }

  const menuKey = menu === null ? '' : menu.kind === 'note' ? memoNoteIconKey(menu.path) : memoFolderIconKey(menu.path)
  const deleteCounts = deleteFolder === null ? null : {
    documentCount: entries.filter((entry) => isInsideMemoFolder(entry.path, deleteFolder)).length,
    folderCount: folders.filter((folder) => isInsideMemoFolder(folder, deleteFolder)).length,
  }

  return (
    <section className="side-section side-memo-notes" aria-labelledby="side-memo-notes-heading">
      <div className="side-head-row side-notebook-head">
        <h2 id="side-memo-notes-heading" className="side-head"><Notebook className="side-section-icon" size={15} aria-hidden="true" />{t('노트')}</h2>
        {/* PDF 머리 단추와 같은 모양·크기(side-top-action, 16px) */}
        {folders.length > 0 ? (
          <button
            type="button"
            className="side-top-action"
            aria-label={allFoldersCollapsed ? t('모든 노트 폴더 펼치기') : t('모든 노트 폴더 접기')}
            title={allFoldersCollapsed ? t('모든 폴더 펼치기') : t('모든 폴더 접기')}
            onClick={toggleAllFolders}
          >
            {allFoldersCollapsed
              ? <ArrowsOutLineVertical size={16} aria-hidden="true" />
              : <ArrowsInLineVertical size={16} aria-hidden="true" />}
          </button>
        ) : null}
        {onCreateFolder !== undefined ? (
          <button type="button" className="side-top-action" aria-label={t('새 노트 폴더')} title={t('새 폴더')} onClick={() => startDraftFolder(memoNotesFolder())}>
            <FolderPlus size={16} aria-hidden="true" />
          </button>
        ) : null}
        <button type="button" className="side-top-action" aria-label={t('새 노트')} title={t('새 노트')} onClick={onCreate}>
          <FilePlus size={16} aria-hidden="true" />
        </button>
      </div>
      {rows.length === 0 && draftFolder === null ? <p className="side-section-empty">{t('노트가 없습니다')}</p> : (
        <ul
          ref={listRef}
          className={`side-tree side-memo-note-list${drag !== null ? ' side-memo-note-list-dragging' : ''}`}
          role="tree"
          aria-label={t('노트 트리')}
        >
          {draftRow(memoNotesFolder(), 0)}
          {rows.map((row, index) => {
            const key = rowKey(row)
            const dragging = drag?.from === key ? 'side-tree-node-dragging side-memo-note-dragging' : ''
            // 목록 아래 빈 곳에 놓을 때는 마지막 줄 밑에 선을 긋는다
            const endDrop = drag?.drop?.kind === 'beside' && drag.drop.row === '' && index === rows.length - 1 ? 'side-tree-drop-after side-memo-drop-after' : ''
            const className = ['side-tree-node', dragging, dropClass(key), endDrop].filter(Boolean).join(' ')
            if (row.kind === 'folder') {
              const open = expanded.has(row.path)
              const folderKey = memoFolderIconKey(row.path)
              return (
                <Fragment key={key}>
                  <li className={className} role="treeitem" aria-expanded={open} data-memo-row="folder" data-path={row.path}>
                    <div className="side-tree-row" style={{ '--side-tree-depth': row.depth } as CSSProperties}>
                      {renaming?.kind === 'folder' && renaming.path === row.path ? (
                        <div className="side-tree-toggle side-inline-rename-row">
                          <span className="side-tree-chevron" aria-hidden="true">{open ? <CaretDown size={12} weight="bold" /> : <CaretRight size={12} weight="bold" />}</span>
                          <ItemEmoji emoji={icons[folderKey]} fallback={<FolderGlyph color={colors[folderKey]} />} />
                          {renameInput(t('{name} 폴더 이름', { name: row.name }))}
                        </div>
                      ) : (
                        <button
                          type="button"
                          className="side-tree-toggle"
                          aria-label={open ? t('{name} 접기', { name: row.name }) : t('{name} 펼치기', { name: row.name })}
                          aria-expanded={open}
                          onClick={() => {
                            if (suppressClickRef.current) return
                            toggleFolder(row.path)
                          }}
                          onPointerDown={startPress(row)}
                          onDoubleClick={(event) => {
                            event.preventDefault()
                            if (onRenameFolder !== undefined) setRenaming({ kind: 'folder', path: row.path, value: row.name })
                          }}
                          onContextMenu={(event) => {
                            event.preventDefault()
                            setMenu({ kind: 'folder', path: row.path, title: row.name, x: event.clientX, y: event.clientY })
                          }}
                        >
                          <span className="side-tree-chevron" aria-hidden="true">{open ? <CaretDown size={12} weight="bold" /> : <CaretRight size={12} weight="bold" />}</span>
                          <ItemEmoji
                            emoji={icons[folderKey]}
                            onPick={onPickIcon === undefined ? undefined : (x, y) => onPickIcon(folderKey, x, y)}
                            fallback={<FolderGlyph color={colors[folderKey]} />}
                          />
                          <span className="side-item-title">{row.name}</span>
                        </button>
                      )}
                      {colorButton(folderKey, row.name)}
                      {onCreateIn !== undefined ? (
                        <button
                          type="button"
                          className="side-tree-add"
                          aria-label={t('{name}에 새 노트', { name: row.name })}
                          title={t('이 폴더에 새 노트')}
                          onPointerDown={(event) => event.stopPropagation()}
                          onClick={(event) => {
                            event.stopPropagation()
                            setExpanded((current) => new Set([...current, row.path]))
                            onCreateIn(row.path)
                          }}
                        >
                          <Plus size={12} weight="bold" aria-hidden="true" />
                        </button>
                      ) : null}
                    </div>
                  </li>
                  {draftRow(row.path, row.depth + 1)}
                </Fragment>
              )
            }
            const { entry } = row
            const noteKey = memoNoteIconKey(entry.path)
            const isOpen = entry.path === openPath
            const siblings = rows.filter((other): other is Extract<Row, { kind: 'note' }> => other.kind === 'note' && other.parent === row.parent)
            const at = siblings.findIndex((other) => other.entry.path === entry.path)
            return (
              <li key={key} className={className} role="treeitem" data-memo-row="note" data-path={entry.path}>
                <div className="side-tree-row" style={{ '--side-tree-depth': row.depth } as CSSProperties}>
                  {renaming?.kind === 'note' && renaming.path === entry.path ? (
                    <div className="side-item side-tree-item side-inline-rename-row">
                      <ItemEmoji emoji={icons[noteKey]} fallback={<NoteGlyph color={colors[noteKey]} />} />
                      {renameInput(t('{name} 노트 이름', { name: entry.title }))}
                    </div>
                  ) : (
                    <button
                      type="button"
                      className={`side-item side-tree-item side-memo-note${isOpen ? ' side-item-open side-item-active side-memo-note-open' : ''}`}
                      aria-current={isOpen ? 'true' : undefined}
                      onClick={() => {
                        if (suppressClickRef.current) return
                        onOpen(entry.path)
                      }}
                      onPointerDown={startPress(row)}
                      onKeyDown={(event) => {
                        // Alt+↑/↓ 로 같은 폴더 안에서 한 칸씩 옮긴다
                        if (!event.altKey || (event.key !== 'ArrowUp' && event.key !== 'ArrowDown')) return
                        event.preventDefault()
                        if (event.key === 'ArrowUp' && at > 0) reorder(entry.path, siblings[at - 1]!.entry.path, 'before')
                        if (event.key === 'ArrowDown' && at < siblings.length - 1) reorder(entry.path, siblings[at + 1]!.entry.path, 'after')
                      }}
                      onDoubleClick={() => setRenaming({ kind: 'note', path: entry.path, value: entry.title })}
                      onContextMenu={(event) => {
                        event.preventDefault()
                        setMenu({ kind: 'note', path: entry.path, title: entry.title, x: event.clientX, y: event.clientY })
                      }}
                    >
                      <ItemEmoji
                        emoji={icons[noteKey]}
                        onPick={onPickIcon === undefined ? undefined : (x, y) => onPickIcon(noteKey, x, y)}
                        fallback={<NoteGlyph color={colors[noteKey]} />} />
                      <span className={`side-dot${isOpen ? ' side-dot-open' : ''}`} aria-hidden="true" />
                      <span className="side-item-title">{entry.title}</span>
                    </button>
                  )}
                  {colorButton(noteKey, entry.title)}
                </div>
              </li>
            )
          })}
        </ul>
      )}
      {error !== null ? <p className="side-action-error" role="alert">{error}</p> : null}

      {colorPop !== null && onColorChange !== undefined ? (
        <>
          <div className="side-menu-backdrop" onClick={() => setColorPop(null)} />
          <div className="side-context-menu side-memo-color-pop" role="menu" aria-label={t('{name} 색', { name: colorPop.label })} style={{ left: colorPop.x, top: colorPop.y }}>
            <ColorSwatches
              current={colors[colorPop.key]}
              label={colorPop.key.startsWith('memo-folder:') ? t('폴더 색') : t('노트 색')}
              onPick={(color) => {
                onColorChange(colorPop.key, color)
                setColorPop(null)
              }}
            />
          </div>
        </>
      ) : null}

      {menu !== null ? (
        <>
          <div className="side-menu-backdrop" onClick={() => setMenu(null)} />
          <div
            className="side-context-menu"
            role="menu"
            aria-label={t('{name} 작업', { name: menu.title })}
            style={{ left: menu.x, top: menu.y }}
            // 창 아래·오른쪽 끝에서 열면 메뉴가 창 밖으로 나간다. 창 안으로 들어오게 옮긴다.
            ref={(element) => {
              if (element === null) return
              fitMenuInViewport(element)
            }}
          >
            {menu.kind === 'note' ? (
              <button type="button" role="menuitem" onClick={() => {
                onOpen(menu.path)
                setMenu(null)
              }}><span className="side-context-icon" aria-hidden="true"><ArrowSquareIn size={15} /></span><span className="side-context-label">{t('열기')}</span></button>
            ) : (
              <>
                {onCreateIn !== undefined ? (
                  <button type="button" role="menuitem" onClick={() => {
                    setExpanded((current) => new Set([...current, menu.path]))
                    onCreateIn(menu.path)
                    setMenu(null)
                  }}><span className="side-context-icon" aria-hidden="true"><FilePlus size={15} /></span><span className="side-context-label">{t('이 폴더에 새 노트')}</span></button>
                ) : null}
                {onCreateFolder !== undefined ? (
                  <button type="button" role="menuitem" onClick={() => {
                    startDraftFolder(menu.path)
                    setMenu(null)
                  }}><span className="side-context-icon" aria-hidden="true"><FolderPlus size={15} /></span><span className="side-context-label">{t('새 하위 폴더…')}</span></button>
                ) : null}
              </>
            )}
            {menu.kind === 'note' && onOpenInTab !== undefined ? (
              <button type="button" role="menuitem" onClick={() => {
                onOpenInTab(menu.path)
                setMenu(null)
              }}><span className="side-context-icon" aria-hidden="true"><Browsers size={15} /></span><span className="side-context-label">{t('탭으로 열기')}</span></button>
            ) : null}
            {menu.kind === 'note' ? (
              <button type="button" role="menuitem" onClick={() => {
                window.dispatchEvent(new CustomEvent(APP_COMMAND_EVENT, { detail: { name: 'exportMarkdown', scope: { kind: 'note', path: menu.path } } }))
                setMenu(null)
              }}><span className="side-context-icon" aria-hidden="true"><Export size={15} /></span><span className="side-context-label">{t('Markdown으로 내보내기…')}</span></button>
            ) : null}
            {menu.kind === 'note' || onRenameFolder !== undefined ? (
              <button type="button" role="menuitem" onClick={() => {
                setRenaming({ kind: menu.kind, path: menu.path, value: menu.title })
                setMenu(null)
              }}><span className="side-context-icon" aria-hidden="true"><PencilSimple size={15} /></span><span className="side-context-label">{t('이름 바꾸기')}</span></button>
            ) : null}
            {onPickIcon !== undefined ? (
              <button type="button" role="menuitem" onClick={() => {
                onPickIcon(menuKey, menu.x, menu.y)
                setMenu(null)
              }}><span className="side-context-icon" aria-hidden="true"><Smiley size={15} /></span><span className="side-context-label">{icons[menuKey] === undefined ? t('이모지 설정…') : t('이모지 바꾸기…')}</span></button>
            ) : null}
            {onClearIcon !== undefined && icons[menuKey] !== undefined ? (
              <button type="button" role="menuitem" onClick={() => {
                onClearIcon(menuKey)
                setMenu(null)
              }}><span className="side-context-icon" aria-hidden="true"><Eraser size={15} /></span><span className="side-context-label">{t('이모지 지우기')}</span></button>
            ) : null}
            {onColorChange !== undefined ? (
              <ColorSwatches
                current={colors[menuKey]}
                label={menu.kind === 'folder' ? t('폴더 색') : t('노트 색')}
                onPick={(color) => {
                  onColorChange(menuKey, color)
                  setMenu(null)
                }}
              />
            ) : null}
            {(menu.kind === 'note' ? onMove : onMoveFolder) !== undefined && moveChoices(menu.kind, menu.path).length > 0 ? (
              <div className="side-memo-move" role="group" aria-label={t('폴더로 옮기기')}>
                <hr className="side-context-sep" />
                <span className="side-memo-move-label">{t('폴더로 옮기기')}</span>
                <div className="side-memo-move-list">
                  {moveChoices(menu.kind, menu.path).map((folder) => (
                    <button
                      key={folder}
                      type="button"
                      role="menuitem"
                      style={{ paddingLeft: `${10 + Math.max(0, folder.split('/').length - 1) * 12}px` }}
                      onClick={() => {
                        const { kind, path } = menu
                        setMenu(null)
                        const done = kind === 'note' ? onMove?.(path, folder) : onMoveFolder?.(path, folder)
                        done?.catch(fail)
                      }}
                    >
                      <Folder size={13} aria-hidden="true" />
                      <span>{folder === memoNotesFolder() ? t('노트 (맨 위)') : folderName(folder)}</span>
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
            {onReveal !== undefined || onCopyPath !== undefined ? <hr className="side-context-sep" /> : null}
            {onReveal !== undefined ? (
              <button type="button" role="menuitem" onClick={() => {
                onReveal(menu.path)
                setMenu(null)
              }}><span className="side-context-icon" aria-hidden="true"><ArrowSquareOut size={15} /></span><span className="side-context-label">{t('탐색기에서 보기')}</span></button>
            ) : null}
            {onCopyPath !== undefined ? (
              <button type="button" role="menuitem" onClick={() => {
                onCopyPath(menu.path)
                setMenu(null)
              }}><span className="side-context-icon" aria-hidden="true"><ClipboardText size={15} /></span><span className="side-context-label">{t('경로 복사')}</span></button>
            ) : null}
            <hr className="side-context-sep" />
            {menu.kind === 'note' ? (
              <button type="button" role="menuitem" className="side-context-danger" onClick={() => {
                const { path } = menu
                setMenu(null)
                onTrash(path).catch(fail)
              }}><span className="side-context-icon" aria-hidden="true"><Trash size={15} /></span><span className="side-context-label">{t('휴지통으로 이동')}</span></button>
            ) : onTrashFolder !== undefined ? (
              <button type="button" role="menuitem" className="side-context-danger" onClick={() => {
                setDeleteFolder(menu.path)
                setMenu(null)
              }}><span className="side-context-icon" aria-hidden="true"><Trash size={15} /></span><span className="side-context-label">{t('휴지통으로 이동…')}</span></button>
            ) : null}
          </div>
        </>
      ) : null}

      {deleteFolder !== null && deleteCounts !== null && onTrashFolder !== undefined ? (
        <DeleteFolderDialog
          name={folderName(deleteFolder)}
          path={memoParentOf(deleteFolder)}
          documentCount={deleteCounts.documentCount}
          folderCount={deleteCounts.folderCount}
          onConfirm={() => onTrashFolder(deleteFolder)}
          onClose={() => setDeleteFolder(null)}
        />
      ) : null}
    </section>
  )
}

function ColorSwatches({ current, label, onPick }: {
  readonly current: FolderColor | undefined
  readonly label: string
  readonly onPick: (color: FolderColor | null) => void
}) {
  return (
    <div className="side-color-row" role="group" aria-label={label}>
      {FOLDER_COLORS.map((color) => (
        <button
          key={color.id}
          type="button"
          role="menuitemradio"
          aria-checked={current === color.id}
          aria-label={`${label} ${folderColorLabel(color)}`}
          title={folderColorLabel(color)}
          className="side-color-swatch"
          style={{ background: color.hex }}
          onClick={() => onPick(color.id)}
        />
      ))}
      <button
        type="button"
        role="menuitemradio"
        aria-checked={current === undefined}
        aria-label={t('{name} 없음', { name: label })}
        title={t('색 없음')}
        className="side-color-swatch side-color-none"
        onClick={() => onPick(null)}
      />
    </div>
  )
}
