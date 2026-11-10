import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useBarZoom, useBarZoomWheel } from './useBarZoom'
import { setAppPref, useAppPrefs } from './appPrefs'
import { pageImageUrl } from '../bridge/pdf'
import { startInternalDrag } from '../core/internalDrag'
import type { CSSProperties, KeyboardEvent, MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent, ReactNode } from 'react'
import {
  CaretDown,
  CaretRight,
  ClockCounterClockwise,
  FileMd,
  FilePdf,
  Folder,
  MagnifyingGlass,
  NotePencil,
  Rows,
  SortAscending,
  SortDescending,
  SquaresFour,
  Stack,
  Star,
} from '@phosphor-icons/react'
import {
  collectLibraryItems,
  filterLibraryItems,
  libraryFolders,
  selectRange,
  sortLibraryItems,
  type LibraryCollection,
  type LibraryFolder,
  type LibraryItem,
  type LibraryOpenTarget,
  type LibrarySortKey,
} from '../core/libraryItems'
import { folderIconKey } from '../core/vaultMetadata'
import type { VaultTreeNode } from '../core/vaultTree'
import type { VaultSearchRecord } from '../core/vaultSearch'
import { errorText } from '../core/errorText'
import type { BibEntry } from '../core/bibliography'
import { ItemEmoji } from './ItemEmoji'
import '../ui/library-view.css'
import { dateLocale, pick, t } from '../i18n'

/** 표에서 끌어 온 항목 id 목록. 사이드바 트리의 끌기(text/plain 한 개)와 섞이지 않는다 */
const DRAG_TYPE = 'application/x-iwae-library-items'
const KIND_LABEL = { pdf: 'PDF', markdown: 'Markdown', note: '노트' } as const
const COLUMNS: readonly { key: LibrarySortKey; label: string }[] = [
  { key: 'name', label: '이름' },
  { key: 'author', label: '저자' },
  { key: 'year', label: '연도' },
  { key: 'kind', label: '종류' },
  { key: 'folder', label: '폴더' },
  { key: 'date', label: '최근' },
  { key: 'storage', label: '저장' },
]

const dateText = (value: string | null) => {
  if (value === null) return ''
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString(dateLocale())
}
const sameCollection = (a: LibraryCollection, b: LibraryCollection) =>
  a.kind === b.kind && (a.kind !== 'folder' || (b.kind === 'folder' && a.path === b.path))

/** 표에서 바로 고칠 수 있는 칸 */
type EditableColumn = 'name' | 'author' | 'year'

/** 저자 칸은 쉼표·세미콜론으로 나눈다 */
export function parseAuthors(text: string): string[] {
  return text.split(/[;,]/u).map((part) => part.trim()).filter(Boolean)
}

/**
 * 표 칸 하나를 그 자리에서 고친다. Enter·바깥 클릭이면 저장, Esc 면 취소.
 * 값이 그대로면 저장하지 않는다 — 이름을 건드리지 않고 나왔는데 색인이 다시 쓰이면 안 된다.
 */
function CellEditor({
  initial,
  label,
  inputMode,
  onCommit,
  onCancel,
}: {
  initial: string
  label: string
  inputMode?: 'numeric'
  onCommit: (value: string) => void
  onCancel: () => void
}) {
  const [value, setValue] = useState(initial)
  const inputRef = useRef<HTMLInputElement>(null)
  const doneRef = useRef(false)
  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [])
  const finish = (commit: boolean) => {
    if (doneRef.current) return
    doneRef.current = true
    if (commit && value.trim() !== initial.trim()) onCommit(value)
    else onCancel()
  }
  return (
    <input
      ref={inputRef}
      className="library-cell-input"
      aria-label={label}
      value={value}
      inputMode={inputMode}
      onChange={(event) => setValue(event.target.value)}
      onClick={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        event.stopPropagation()
        if (event.key === 'Enter') finish(true)
        else if (event.key === 'Escape') finish(false)
      }}
      onBlur={() => finish(true)}
    />
  )
}

interface LibraryViewProps {
  readonly tree: readonly VaultTreeNode[]
  readonly records: readonly VaultSearchRecord[]
  readonly itemIcons: Readonly<Record<string, string>>
  /** PDF 서지 정보. 저자·연도 칸에 쓴다 */
  readonly bibliography?: Readonly<Record<string, BibEntry>>
  readonly onOpenItem: (target: LibraryOpenTarget) => void
  readonly onMoveEntry?: (id: string, destinationFolder: string) => Promise<void>
  readonly onItemContextMenu?: (event: ReactMouseEvent<HTMLElement>, item: LibraryItem) => void
  readonly onFolderContextMenu?: (event: ReactMouseEvent<HTMLElement>, folder: LibraryFolder) => void
  /** 이름 칸을 고쳤을 때. 파일 이름이 아니라 표시 이름만 바꾼다 */
  readonly onRenameItem?: (id: string, name: string) => Promise<void>
  /** 저자·연도 칸을 고쳤을 때(PDF 만). 서지 정보에 사람이 고친 값으로 남는다 */
  readonly onUpdateBibliography?: (docId: string, patch: { authors?: readonly string[]; year?: number | null }) => void
  /** 아이콘을 눌러 이모지를 고를 때(열쇠: 항목 id 또는 folderIconKey). 고르기 창을 띄울 자리를 함께 준다 */
  readonly onPickIcon?: (key: string, x: number, y: number) => void
  /** 탐색기에서 끌어 온 파일이 들어갈 폴더. 그 폴더 줄을 칠한다 */
  readonly externalDropFolder?: string | null
  /** 폴더 이름 바꾸기·새 하위 폴더를 이 칸에서 그 자리에 한다(왼쪽 바 메뉴·단추와 같은 일) */
  readonly folderEdit?:
    | { readonly kind: 'rename'; readonly path: string; readonly name: string }
    | { readonly kind: 'create'; readonly parentPath: string }
    | null
  readonly onFolderEditCommit?: (name: string) => void
  readonly onFolderEditCancel?: () => void
  /** 폴더 줄을 두 번 눌렀을 때(이름 바꾸기 시작) */
  readonly onStartFolderRename?: (folder: LibraryFolder) => void
  /** 메뉴의 「이름 바꾸기」: 그 항목의 이름 칸을 고치기 시작한다 */
  readonly renameRequest?: { readonly id: string; readonly nonce: number } | null
  /**
   * 펼친 라이브러리: 모음·폴더 목록은 왼쪽 바(navHost)에, 표는 그 오른쪽 영역(tableHost)에 그린다.
   * 둘 다 주지 않으면(단독 사용·테스트) 한 덩어리로 그 자리에 그린다.
   */
  readonly navHost?: HTMLElement | null
  readonly tableHost?: HTMLElement | null
}

/**
 * 라이브러리 모드 본문 — Zotero 처럼 왼쪽 모음·폴더 트리, 오른쪽 항목 표.
 *
 * 폴더는 옮기지 않는다. 파일 계층은 항목 하나씩만 옮길 수 있고, 폴더를
 * 통째로 옮기려면 그 아래 모든 색인 경로를 함께 다시 써야 한다.
 * 여러 항목은 하나씩 차례로 옮긴다 — 동시에 옮기면 같은 색인 파일을
 * 서로 덮어쓴다.
 */
export function LibraryView({
  tree,
  records,
  itemIcons,
  bibliography = {},
  onOpenItem,
  onMoveEntry,
  onItemContextMenu,
  onFolderContextMenu,
  onRenameItem,
  onUpdateBibliography,
  onPickIcon,
  externalDropFolder = null,
  folderEdit = null,
  onFolderEditCommit,
  onFolderEditCancel,
  onStartFolderRename,
  renameRequest = null,
  navHost,
  tableHost,
}: LibraryViewProps) {
  const portalMode = navHost !== undefined || tableHost !== undefined
  const [editing, setEditing] = useState<{ id: string; column: EditableColumn } | null>(null)
  const [collection, setCollection] = useState<LibraryCollection>({ kind: 'all' })
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<{ key: LibrarySortKey; direction: 'asc' | 'desc' }>({ key: 'name', direction: 'asc' })
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set())
  const [anchorId, setAnchorId] = useState<string | null>(null)
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set())
  const [dropFolder, setDropFolder] = useState<string | null>(null)
  const [status, setStatus] = useState('')
  // 알림은 잠깐 보였다가 사라진다 — 빈 띠가 남지 않게
  useEffect(() => {
    if (status === '') return undefined
    const timer = window.setTimeout(() => setStatus(''), 6000)
    return () => window.clearTimeout(timer)
  }, [status])
  const [itemsElement, setItemsElement] = useState<HTMLElement | null>(null)
  const zoom = useBarZoom('library')
  const view = useAppPrefs().libraryView
  useBarZoomWheel(itemsElement, 'library', portalMode)
  useEffect(() => {
    if (renameRequest !== null) setEditing({ id: renameRequest.id, column: 'name' })
  }, [renameRequest])

  const items = useMemo(() => collectLibraryItems(tree, records, bibliography), [bibliography, records, tree])
  const folders = useMemo(() => libraryFolders(tree), [tree])
  const rows = useMemo(
    () => sortLibraryItems(filterLibraryItems(items, collection, query), sort.key, sort.direction),
    [collection, items, query, sort],
  )
  const orderedIds = rows.map((row) => row.id)

  const selectOnly = (id: string) => {
    setSelected(new Set([id]))
    setAnchorId(id)
  }

  const clickRow = (event: ReactMouseEvent<HTMLElement>, item: LibraryItem) => {
    if (event.shiftKey && anchorId !== null) {
      setSelected(new Set(selectRange(orderedIds, anchorId, item.id)))
      return
    }
    if (event.ctrlKey || event.metaKey) {
      setSelected((current) => {
        const next = new Set(current)
        if (next.has(item.id)) next.delete(item.id)
        else next.add(item.id)
        return next
      })
      setAnchorId(item.id)
      return
    }
    selectOnly(item.id)
  }

  const moveItems = async (ids: readonly string[], destination: string, label: string) => {
    if (onMoveEntry === undefined) return
    const targets = items.filter((item) => ids.includes(item.id))
    // 참조 PDF 는 Library 안 정리 위치만 옮긴다. 참조 Markdown 은 옮길 수 있는 위치가 없다.
    const canMove = (item: LibraryItem) => item.storage === 'vault' || item.kind === 'pdf'
    const movable = targets.filter((item) => canMove(item) && item.folder !== destination)
    const references = targets.filter((item) => !canMove(item)).length
    let moved = 0
    const failures: string[] = []
    for (const item of movable) {
      try {
        await onMoveEntry(item.id, destination)
        moved += 1
      } catch (err) {
        failures.push(`${item.name}: ${errorText(err)}`)
      }
    }
    const parts = [t("{count}개 항목을 '{folder}'(으)로 이동했습니다.", { count: moved, folder: label })]
    if (references > 0) parts.push(t('외부 참조 {count}개는 이동하지 않았습니다 — 먼저 Vault에 복사하세요.', { count: references }))
    if (failures.length > 0) parts.push(t('실패 {count}개: {list}', { count: failures.length, list: failures.join(', ') }))
    setStatus(parts.join(' '))
  }

  // 폴더 줄은 앱 안 끌기(core/internalDrag)의 받는 곳이다 — Windows 의 Tauri 에서 HTML5 드래그가 놓이지 않는다
  const folderDropProps = (path: string, label: string) => ({
    'data-internal-drop': 'library-folder',
    'data-library-folder': path,
    'data-library-label': label,
  })

  const folderOf = (target: Element | null): { path: string; label: string } | null => {
    if (!(target instanceof HTMLElement) || target.dataset.internalDrop !== 'library-folder') return null
    return { path: target.dataset.libraryFolder ?? '', label: target.dataset.libraryLabel ?? '' }
  }

  const startRowDrag = (event: ReactPointerEvent<HTMLElement>, item: LibraryItem) => {
    if (event.button !== 0 || onMoveEntry === undefined || editing?.id === item.id) return
    if (event.shiftKey || event.ctrlKey || event.metaKey) return
    if ((event.target as Element).closest('input, textarea') !== null) return
    const ids = selected.has(item.id) ? orderedIds.filter((id) => selected.has(id)) : [item.id]
    startInternalDrag(event, { [DRAG_TYPE]: JSON.stringify(ids), 'text/plain': ids.join('\n') }, {
      label: ids.length === 1 ? item.name : t('{count}개 항목', { count: ids.length }),
      onStart: () => {
        if (!selected.has(item.id)) selectOnly(item.id)
      },
      onOver: (target) => setDropFolder(folderOf(target)?.path ?? null),
      onEnd: (_dropped, target) => {
        setDropFolder(null)
        const folder = folderOf(target)
        if (folder !== null) void moveItems(ids, folder.path, folder.label)
      },
    })
  }

  /** 왼쪽 바의 문서 줄과 같은 줄(side-tree-row). 폴더는 펼침 화살표가 있는 side-tree-toggle, 나머지는 side-tree-item */
  const collectionRow = (
    key: string,
    target: LibraryCollection,
    label: string,
    icon: ReactNode,
    options: {
      depth?: number
      caret?: ReactNode
      /** 폴더 줄(펼침 화살표 자리를 둔다) */
      folder?: boolean
      drop?: { path: string }
      onContextMenu?: (event: ReactMouseEvent<HTMLElement>) => void
      onDoubleClick?: () => void
      expanded?: boolean
      /** 이름 대신 그릴 것(이름 고치는 칸) */
      editor?: ReactNode
    } = {},
  ) => {
    const active = sameCollection(collection, target)
    return (
      <div key={key} role="none" className="side-tree-row" style={{ '--side-tree-depth': options.depth ?? 0 } as CSSProperties}>
        <div
          role="treeitem"
          aria-selected={active}
          aria-expanded={options.expanded}
          aria-label={label}
          tabIndex={0}
          className={[
            'side-item',
            options.folder === true ? 'side-tree-toggle' : 'side-tree-item',
            'library-nav-row',
            active ? 'side-item-open' : '',
            options.drop !== undefined && (dropFolder === options.drop.path || externalDropFolder === options.drop.path) ? 'library-collection-drop' : '',
          ].filter(Boolean).join(' ')}
          onClick={() => setCollection(target)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') setCollection(target)
          }}
          onContextMenu={options.onContextMenu}
          onDoubleClick={options.onDoubleClick === undefined ? undefined : (event) => {
            event.preventDefault()
            options.onDoubleClick?.()
          }}
          {...(options.drop !== undefined ? folderDropProps(options.drop.path, label) : {})}
        >
          {options.folder === true ? options.caret ?? <span className="side-tree-chevron" aria-hidden="true" /> : null}
          {icon}
          {options.editor ?? <span className="side-item-title">{label}</span>}
        </div>
      </div>
    )
  }

  /** 새 하위 폴더 이름을 쓰는 줄 */
  const folderDraftRow = (parentPath: string, depth: number) => folderEdit?.kind === 'create' && folderEdit.parentPath === parentPath ? (
    <li role="none" key={`draft:${parentPath}`} className="side-tree-node">
      <div className="side-tree-row" style={{ '--side-tree-depth': depth } as CSSProperties}>
        <div className="side-item side-tree-toggle library-nav-row library-collection-draft">
        <span className="side-tree-chevron" aria-hidden="true" />
        <Folder size={14} aria-hidden="true" />
        <CellEditor
          initial=""
          label={t('새 폴더 이름')}
          onCommit={(value) => onFolderEditCommit?.(value)}
          onCancel={() => onFolderEditCancel?.()}
        />
        </div>
      </div>
    </li>
  ) : null

  const renderFolders = (nodes: readonly LibraryFolder[], depth: number): ReactNode => nodes.map((folder) => {
    // 새 하위 폴더를 쓰는 중이면 그 폴더(와 위 폴더들)를 펼쳐 둔다
    const drafting = folderEdit?.kind === 'create'
      && (folderEdit.parentPath === folder.path || folderEdit.parentPath.startsWith(`${folder.path}/`))
    const open = !collapsed.has(folder.path) || drafting
    const hasChildren = folder.children.length > 0 || drafting
    const renaming = folderEdit?.kind === 'rename' && folderEdit.path === folder.path
    return (
      <li key={folder.id} role="none" className="side-tree-node">
        {collectionRow(
          folder.id,
          { kind: 'folder', path: folder.path },
          folder.name,
          <ItemEmoji
            emoji={itemIcons[folderIconKey(folder.path)]}
            onPick={onPickIcon === undefined ? undefined : (x, y) => onPickIcon(folderIconKey(folder.path), x, y)}
            fallback={<Folder size={14} aria-hidden="true" />}
          />,
          {
            depth,
            folder: true,
            drop: { path: folder.path },
            expanded: hasChildren ? open : undefined,
            onContextMenu: onFolderContextMenu === undefined ? undefined : (event) => onFolderContextMenu(event, folder),
            onDoubleClick: onStartFolderRename === undefined ? undefined : () => onStartFolderRename(folder),
            editor: renaming ? (
              <CellEditor
                initial={folderEdit.name}
                label={t('{name} 폴더 이름', { name: folder.name })}
                onCommit={(value) => onFolderEditCommit?.(value)}
                onCancel={() => onFolderEditCancel?.()}
              />
            ) : undefined,
            caret: hasChildren ? (
              <button
                type="button"
                className="side-tree-chevron"
                aria-label={open ? t('{name} 접기', { name: folder.name }) : t('{name} 펼치기', { name: folder.name })}
                onClick={(event) => {
                  event.stopPropagation()
                  setCollapsed((current) => {
                    const next = new Set(current)
                    if (next.has(folder.path)) next.delete(folder.path)
                    else next.add(folder.path)
                    return next
                  })
                }}
              >
                {open ? <CaretDown size={11} weight="bold" /> : <CaretRight size={11} weight="bold" />}
              </button>
            ) : undefined,
          },
        )}
        {open && hasChildren ? (
          <ul role="group" className="side-tree-children">
            {folderDraftRow(folder.path, depth + 1)}
            {renderFolders(folder.children, depth + 1)}
          </ul>
        ) : null}
      </li>
    )
  })

  const kindIcon = (item: LibraryItem, size = 16) => item.kind === 'pdf'
    ? <FilePdf size={size} aria-hidden="true" />
    : item.kind === 'markdown'
      ? <FileMd size={size} aria-hidden="true" />
      : <NotePencil size={size} aria-hidden="true" />
  const kindLabel = (item: LibraryItem) => item.kind === 'note' ? pick({ ko: KIND_LABEL.note, en: 'Note' }) : KIND_LABEL[item.kind]

  const canEdit = (item: LibraryItem, column: EditableColumn) => column === 'name'
    ? onRenameItem !== undefined
    : onUpdateBibliography !== undefined && item.open.kind === 'pdf'
  const docIdOf = (item: LibraryItem) => item.open.kind === 'pdf' ? item.open.doc.docId : item.id
  const commitEdit = (item: LibraryItem, column: EditableColumn, value: string) => {
    setEditing(null)
    if (column === 'name') {
      const name = value.trim()
      if (name === '' || onRenameItem === undefined) return
      void onRenameItem(item.id, name)
        .then(() => setStatus(t("이름을 '{name}'(으)로 바꿨습니다.", { name })))
        .catch((err: unknown) => setStatus(t('이름을 바꾸지 못했습니다: {error}', { error: errorText(err) })))
      return
    }
    if (column === 'author') {
      onUpdateBibliography?.(docIdOf(item), { authors: parseAuthors(value) })
      setStatus(t('저자를 고쳤습니다.'))
      return
    }
    const trimmed = value.trim()
    const year = trimmed === '' ? null : Number.parseInt(trimmed, 10)
    if (year !== null && (!Number.isFinite(year) || year < 1000 || year > 9999)) {
      setStatus(t('연도는 네 자리 숫자로 적어 주세요.'))
      return
    }
    onUpdateBibliography?.(docIdOf(item), { year })
    setStatus(t('연도를 고쳤습니다.'))
  }
  /** 고칠 수 있는 칸이면 편집기를, 아니면 값을 그린다. 두 번 누르면 편집을 시작한다 */
  const editableCell = (item: LibraryItem, column: EditableColumn, text: string, className: string | undefined, extra?: ReactNode) => {
    const active = editing?.id === item.id && editing.column === column
    const editable = canEdit(item, column)
    const label = column === 'name' ? '이름' : column === 'author' ? '저자' : '연도'
    return (
      <span
        role="gridcell"
        className={[className, editable ? 'library-cell-editable' : ''].filter(Boolean).join(' ') || undefined}
        title={editable && !active ? t('두 번 눌러 {label} 고치기', { label: t(label) }) : undefined}
        onDoubleClick={editable ? (event) => {
          event.stopPropagation()
          setEditing({ id: item.id, column })
        } : undefined}
      >
        {active ? (
          <CellEditor
            initial={text}
            label={`${item.name} ${label}`}
            inputMode={column === 'year' ? 'numeric' : undefined}
            onCommit={(value) => commitEdit(item, column, value)}
            onCancel={() => setEditing(null)}
          />
        ) : (
          <>{text}{extra}</>
        )}
      </span>
    )
  }

  const rowKeyDown = (event: KeyboardEvent<HTMLElement>, item: LibraryItem, index: number) => {
    if (event.key === 'F2' && canEdit(item, 'name')) {
      event.preventDefault()
      setEditing({ id: item.id, column: 'name' })
      return
    }
    if (event.key === 'Enter') {
      event.preventDefault()
      onOpenItem(item.open)
      return
    }
    const forward = event.key === 'ArrowDown' || event.key === 'ArrowRight'
    if (!forward && event.key !== 'ArrowUp' && event.key !== 'ArrowLeft') return
    event.preventDefault()
    const next = rows[index + (forward ? 1 : -1)]
    if (next === undefined) return
    selectOnly(next.id)
    const sibling = forward
      ? event.currentTarget.nextElementSibling
      : event.currentTarget.previousElementSibling
    if (sibling instanceof HTMLElement) sibling.focus()
  }

  const nav = (
    <ul className="side-tree library-nav-tree" role="tree" aria-label={t('모음과 폴더')}>
      <li role="none" className="side-tree-node">{collectionRow('all', { kind: 'all' }, t('전체'), <Stack size={14} aria-hidden="true" />)}</li>
      <li role="none" className="side-tree-node">{collectionRow('favorites', { kind: 'favorites' }, t('즐겨찾기'), <Star size={14} aria-hidden="true" />)}</li>
      <li role="none" className="side-tree-node">{collectionRow('recent', { kind: 'recent' }, t('최근 열람'), <ClockCounterClockwise size={14} aria-hidden="true" />)}</li>
      <li role="none" className="library-nav-separator" aria-hidden="true" />
      <li role="none" className="side-tree-node">
        {collectionRow('root', { kind: 'folder', path: '' }, t('Vault 루트'), <Folder size={14} aria-hidden="true" />, { drop: { path: '' } })}
      </li>
      {folderDraftRow('', 1)}
      {renderFolders(folders, 1)}
    </ul>
  )

  // 보이는 항목 모두에서 비어 있는 열은 감춘다(저자·연도·폴더·저장). 한 칸만 비면 빈칸으로 둔다
  const visibleColumns = COLUMNS.filter((column) => {
    if (column.key === 'author') return rows.some((row) => row.authors !== '')
    if (column.key === 'year') return rows.some((row) => row.year !== null)
    if (column.key === 'folder') return rows.some((row) => row.folder !== '')
    if (column.key === 'storage') return rows.some((row) => row.storage !== 'vault')
    return true
  })
  const COLUMN_WIDTH: Record<LibrarySortKey, string> = {
    name: 'minmax(180px, 3fr)',
    author: 'minmax(90px, 1.4fr)',
    year: '64px',
    kind: '90px',
    folder: 'minmax(100px, 1.6fr)',
    date: '110px',
    storage: '70px',
  }
  const columnsTemplate = ['32px', ...visibleColumns.map((column) => COLUMN_WIDTH[column.key])].join(' ')
  const shows = (key: LibrarySortKey) => visibleColumns.some((column) => column.key === key)

  const viewName = collection.kind === 'all' ? t('전체')
    : collection.kind === 'favorites' ? t('즐겨찾기')
      : collection.kind === 'recent' ? t('최근 열람')
        : collection.path === '' ? t('Vault 루트') : collection.path.split('/').at(-1) ?? collection.path

  // Ctrl+F: 펼친 라이브러리에서는 검색칸으로(가려진 PDF 창의 찾기로 가지 않게 먼저 받는다)
  const searchRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (!portalMode) return undefined
    const onKey = (event: globalThis.KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && !event.shiftKey && !event.altKey && event.key.toLowerCase() === 'f') {
        event.preventDefault()
        event.stopPropagation()
        searchRef.current?.focus()
        searchRef.current?.select()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [portalMode])

  const rowEvents = (item: LibraryItem, index: number) => ({
    tabIndex: 0,
    'aria-selected': selected.has(item.id),
    onClick: (event: ReactMouseEvent<HTMLElement>) => clickRow(event, item),
    onDoubleClick: () => onOpenItem(item.open),
    onKeyDown: (event: KeyboardEvent<HTMLElement>) => rowKeyDown(event, item, index),
    onContextMenu: (event: ReactMouseEvent<HTMLElement>) => {
      if (!selected.has(item.id)) selectOnly(item.id)
      onItemContextMenu?.(event, item)
    },
    onPointerDown: (event: ReactPointerEvent<HTMLElement>) => startRowDrag(event, item),
  })

  const emptyState = rows.length === 0 ? (
    <div className="library-empty">
      <Stack size={28} aria-hidden="true" />
      <p>{query.trim() !== '' ? t('찾는 항목이 없습니다') : collection.kind === 'favorites' ? t('즐겨찾기한 항목이 없습니다') : collection.kind === 'recent' ? t('최근에 연 항목이 없습니다') : t('항목이 없습니다')}</p>
    </div>
  ) : null

  const selectAllOnCtrlA = (event: KeyboardEvent<HTMLElement>) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a') {
      event.preventDefault()
      setSelected(new Set(orderedIds))
    }
  }

  const listView = (
    <div
      className="library-table"
      role="grid"
      aria-label={t('항목 목록')}
      aria-multiselectable="true"
      style={{ '--library-cols': columnsTemplate } as CSSProperties}
      onKeyDown={selectAllOnCtrlA}
    >
      <div className="library-row library-row-head" role="row">
        <span role="columnheader" className="library-cell-icon" aria-label={t('아이콘')} />
        {visibleColumns.map((column) => (
          <span
            key={column.key}
            role="columnheader"
            className={column.key === 'year' ? 'library-cell-num' : undefined}
            aria-sort={sort.key === column.key ? (sort.direction === 'asc' ? 'ascending' : 'descending') : 'none'}
          >
            <button
              type="button"
              className="library-sort"
              onClick={() => setSort((current) => ({
                key: column.key,
                direction: current.key === column.key && current.direction === 'asc' ? 'desc' : 'asc',
              }))}
            >
              {column.key === 'storage' ? pick({ ko: column.label, en: 'Storage' }) : t(column.label)}
              {sort.key === column.key
                ? (sort.direction === 'asc'
                  ? <SortAscending size={12} aria-hidden="true" />
                  : <SortDescending size={12} aria-hidden="true" />)
                : null}
            </button>
          </span>
        ))}
      </div>
      {emptyState}
      {rows.map((item, index) => (
        <div
          key={item.id}
          role="row"
          className={`library-row${selected.has(item.id) ? ' library-row-selected' : ''}`}
          {...rowEvents(item, index)}
        >
          <span role="gridcell" className="library-cell-icon">
            <ItemEmoji
              emoji={itemIcons[item.id]}
              onPick={onPickIcon === undefined ? undefined : (x, y) => onPickIcon(item.id, x, y)}
              fallback={kindIcon(item)}
            />
          </span>
          {editableCell(item, 'name', item.name, 'library-cell-name',
            item.favorite ? <Star size={11} weight="fill" className="library-favorite" aria-label={t('즐겨찾기')} /> : null)}
          {shows('author') ? editableCell(item, 'author', item.authors, 'library-cell-author') : null}
          {shows('year') ? editableCell(item, 'year', item.year === null ? '' : String(item.year), 'library-cell-num') : null}
          <span role="gridcell">{kindLabel(item)}</span>
          {shows('folder') ? <span role="gridcell" className="library-cell-folder">{item.folder}</span> : null}
          <span role="gridcell" className="library-cell-date">{dateText(item.lastOpenedAt ?? item.addedAt)}</span>
          {shows('storage') ? <span role="gridcell">{item.storage === 'vault' ? 'Vault' : t('참조')}</span> : null}
        </div>
      ))}
    </div>
  )

  const gridView = (
    <div
      className="library-grid"
      role="listbox"
      aria-label={t('항목 목록')}
      aria-multiselectable="true"
      onKeyDown={selectAllOnCtrlA}
    >
      {emptyState}
      {rows.map((item, index) => {
        const nameEditing = editing?.id === item.id && editing.column === 'name'
        const meta = [item.year === null ? '' : String(item.year), kindLabel(item)].filter(Boolean).join(' · ')
        return (
          <div
            key={item.id}
            role="option"
            aria-label={item.name}
            className={`library-card${selected.has(item.id) ? ' library-card-selected' : ''}`}
            {...rowEvents(item, index)}
          >
            <span className="library-card-thumb">
              <span className="library-card-icon" aria-hidden="true">
                <ItemEmoji
                  emoji={itemIcons[item.id]}
                  onPick={onPickIcon === undefined ? undefined : (x, y) => onPickIcon(item.id, x, y)}
                  fallback={kindIcon(item, 32)}
                />
              </span>
              {item.open.kind === 'pdf' ? (
                // 왼쪽 바 미리보기와 같은 쪽 그림(첫 쪽). 화면 근처에 올 때 불러온다
                <img
                  className="library-card-page"
                  src={pageImageUrl(item.open.doc.docId, 0, 320)}
                  alt=""
                  loading="lazy"
                  decoding="async"
                  draggable={false}
                  onError={(event) => { event.currentTarget.style.display = 'none' }}
                />
              ) : null}
              {item.favorite ? <Star size={13} weight="fill" className="library-card-star" aria-label={t('즐겨찾기')} /> : null}
            </span>
            {nameEditing ? (
              <CellEditor
                initial={item.name}
                label={`${item.name} ${t('이름')}`}
                onCommit={(value) => commitEdit(item, 'name', value)}
                onCancel={() => setEditing(null)}
              />
            ) : (
              <span className="library-card-title" title={item.name}>{item.name}</span>
            )}
            <span className="library-card-meta">{meta}</span>
          </div>
        )
      })}
    </div>
  )

  const itemsSection = (
      <section
        ref={setItemsElement}
        className={`library-items${collection.kind === 'folder' && externalDropFolder === collection.path ? ' library-items-drop' : ''}`}
        aria-label={t('라이브러리 항목')}
        style={{ '--bar-zoom': zoom } as CSSProperties}
        // 탐색기에서 표 위에 놓으면 지금 보고 있는 폴더로 들어간다
        data-drop-folder={collection.kind === 'folder' ? collection.path : undefined}
      >
        <div className="library-items-head">
          <h2 className="library-items-title">{viewName}</h2>
          <span className="library-items-count">
            {rows.length}{selected.size > 0 ? ` · ${t('{count}개 선택', { count: selected.size })}` : ''}
          </span>
          <span className="library-items-spacer" />
          <label className="library-search">
            <MagnifyingGlass size={14} aria-hidden="true" />
            <input
              ref={searchRef}
              type="search"
              aria-label={t('라이브러리 필터')}
              placeholder={t('검색')}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          <div className="library-view-switch" role="group" aria-label={t('보기 방식')}>
            <button
              type="button"
              aria-label={t('목록으로 보기')}
              title={t('목록으로 보기')}
              aria-pressed={view === 'list'}
              onClick={() => setAppPref('libraryView', 'list')}
            >
              <Rows size={15} aria-hidden="true" />
            </button>
            <button
              type="button"
              aria-label={t('카드로 보기')}
              title={t('카드로 보기')}
              aria-pressed={view === 'grid'}
              onClick={() => setAppPref('libraryView', 'grid')}
            >
              <SquaresFour size={15} aria-hidden="true" />
            </button>
          </div>
        </div>
        {view === 'grid' ? gridView : listView}
        <p className="library-status" role="status" aria-live="polite">{status}</p>
      </section>
  )

  if (portalMode) {
    return (
      <>
        {navHost ? createPortal(nav, navHost) : null}
        {tableHost ? createPortal(itemsSection, tableHost) : null}
      </>
    )
  }
  return (
    <div className="library-view">
      <nav className="library-collections" aria-label={t('라이브러리 모음')}>{nav}</nav>
      {itemsSection}
    </div>
  )
}
