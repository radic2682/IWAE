import { Fragment, lazy, Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, KeyboardEvent, MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent, ReactElement, ReactNode } from 'react'
import { startInternalDrag } from '../core/internalDrag'
import { sidebarDefaults } from './sidebarDefaults'
import { ArrowClockwise, PushPin, GitBranch, GithubLogo, ArrowsInLineHorizontal, ArrowsInLineVertical, ArrowsOutLineHorizontal, ArrowsOutLineVertical, CaretDown, CaretRight, FileMd, FilePdf, FilePlus, Books, Notebook, Folder, FolderOpen, FolderPlus, GearSix, NotePencil, Plus, X, ArrowSquareOut, CaretUpDown, Copy, House, Sparkle, BookOpenText, ClipboardText, CopySimple, DownloadSimple, Eraser, LinkSimple, ListBullets, PencilSimple, Quotes, Smiley, Stack, Star, Toolbox, Trash, WarningCircle } from '@phosphor-icons/react'
import {
  buildLegacyWorkspaceTree,
  projectVaultTree,
  type LibraryDoc,
  type NotebookGroup,
  type NotebookNote,
  type PdfAttachmentPolicy,
  type VaultMarkdownNode,
  type VaultTreeNode,
  type VaultTreePlaceRequest,
  type VaultTreeReorderRequest,
} from '../core/vaultTree'
import { errorText } from '../core/errorText'
import type { VaultSearchHit, VaultSearchRecord } from '../core/vaultSearch'
import { VaultSearch } from './VaultSearch'
import { ItemEmoji } from './ItemEmoji'
import { MemoNotesSection, type MemoNotesSectionProps } from './MemoNotesSection'
import { useGutterHeadLines } from './useGutterHeadLines'
import { FOLDER_COLORS, folderColorHex, type FolderColor } from '../core/folderColors'
import { recentPdfDate, type RecentPdf } from '../core/recentPdfs'
import { categoryColor } from '../pdf/CategoryTag'
import { LibraryView } from './LibraryView'
import type { LibraryFolder, LibraryItem, LibraryOpenTarget } from '../core/libraryItems'
import type { BibEntry } from '../core/bibliography'
import { folderIconKey } from '../core/vaultMetadata'
import { AddPdfDialog, DeleteFolderDialog, FolderNameDialog } from './SidebarDialogs'
import type { GithubSource } from '../bridge/github'
import { defaultVersion, hiddenVersionDocIds, type VersionGroup } from '../core/versionGroups'
import type { VersionMenuActions } from './VersionMenu'
import { DocNoteRows } from './DocNoteRows'
import { attachBarZoomWheel, useBarZoom } from './useBarZoom'
import { groupMemoNotesByDoc } from '../core/memoNote'
import '../ui/version-groups.css'
import { cleanEntryName } from '../bridge/vaultFiles'
import '../ui/sidebar-followup.css'
import { t } from '../i18n'
import { createExampleVaultFolder, forgetVault, pickVaultFolder } from '../bridge/vault'
import { revealInFolder } from '../bridge/vaultBackup'
import { isMacPlatform } from '../core/platform'
import { announceAction } from './actionFeedback'
import '../ui/vault-menu.css'
import '../ui/sidebar-buttons.css'
import '../ui/left-bar-rows.css'

// 선택창과 이모지 데이터는 처음 열 때만 불러온다 — 시작 번들을 키우지 않는다.
const LazyEmojiPicker = lazy(async () => {
  const module = await import('./EmojiPicker')
  return { default: module.EmojiPicker }
})

interface SidebarProps {
  library: readonly LibraryDoc[]
  notebooks: readonly NotebookGroup[]
  onOpenDoc: (doc: LibraryDoc) => void
  /** 노트(캔버스) 구역을 보일까. 기능 스위치로 끌 수 있다 */
  showNotes?: boolean
  /** PDF 별 메모 카테고리(메모가 있는 PDF 만). 열린 PDF 밑에 펼쳐 보인다 */
  memoCategories?: Readonly<Record<string, MemoCategorySummary>>
  /** 지금 고른 메모 카테고리. topic: null = 메모 전체, '' = 카테고리 없음 */
  memoFilter?: { readonly docId: string; readonly topic: string | null } | null
  onSelectMemoCategory?: (doc: LibraryDoc, topic: string | null) => void
  onOpenNote: (note: NotebookNote) => void
  onOpenMarkdown?: (markdown: VaultMarkdownNode) => void
  /** PDF 문서 머리의 "문서 추가". 파일 대화상자를 여는 것은 App 의 일이다 */
  onAddDoc: (policy?: PdfAttachmentPolicy) => void
  onCreateNote?: (notebookName: string, noteName: string) => Promise<void>
  onRelinkDoc?: (docId: string) => void
  missingDocIds?: readonly string[]
  vaultRoot?: string
  /** 테스트용: 처음에 모든 폴더를 펼친다(앱에서는 접힌 것이 기본) */
  initiallyExpandAll?: boolean
  onSwitchVault?: () => void
  recentVaultPaths?: readonly string[]
  onOpenRecentVault?: (root: string) => void
  /** 지금 왼쪽 패널에 탭으로 열려 있는 문서들 */
  openDocIds: readonly string[]
  /** 지금 오른쪽 패널에 탭으로 열려 있는 노트들 */
  openNotePaths: readonly string[]
  /** 열린 문서 가운데 지금 보고 있는(켜진 탭의) 것. 문서 id(PDF) 또는 경로(Markdown). 이것만 진한 바탕을 받는다 */
  activeDocId?: string | null
  /** 열린 노트 가운데 지금 보고 있는 것의 경로 */
  activeNotePath?: string | null
  tree?: readonly VaultTreeNode[]
  onReorderNode?: (request: VaultTreeReorderRequest) => void
  onRenameEntry?: (id: string, displayName: string) => Promise<void>
  /** 라이브러리 표에서 저자·연도를 고쳤을 때 */
  onUpdateBibliography?: (docId: string, patch: { authors?: readonly string[]; year?: number | null }) => void
  onCreateFolder?: (parentPath: string, name: string) => Promise<void>
  onMoveEntry?: (id: string, destinationFolder: string) => Promise<void>
  /** 끌어 놓은 자리에 둔다(다른 폴더·맨 위로도). 있으면 끌어 놓기는 이것을 쓴다 */
  onPlaceNode?: (request: VaultTreePlaceRequest) => Promise<void>
  /** 여러 항목을 고른 차례대로 한 자리에 놓는다(Ctrl·Shift 로 고른 뒤 끌기) */
  onPlaceNodes?: (
    nodes: readonly { readonly nodeId: string; readonly fromParent: string }[],
    place: Pick<VaultTreePlaceRequest, 'toParent' | 'targetNodeId' | 'position'>,
  ) => Promise<void>
  onDuplicateEntry?: (id: string, destinationFolder?: string) => Promise<void>
  onTrashEntry?: (id: string) => Promise<void>
  /** 폴더를 통째로 Vault 휴지통으로 옮긴다 */
  onTrashFolder?: (path: string) => Promise<void>
  onRenameFolder?: (path: string, name: string) => Promise<void>
  onConvertEntryToCopy?: (id: string, destinationFolder?: string) => Promise<void>
  onCopyEntryPath?: (id: string) => Promise<string>
  /** GitHub 에서 가져온 폴더(키 = Vault 경로 GitHub/<이름>). 폴더 줄에 브랜치·새 커밋 수를 보이고 메뉴를 더한다 */
  githubSources?: ReadonlyMap<string, GithubSource>
  onGithubAction?: (action: 'fetch' | 'pull' | 'versions' | 'open', name: string) => void
  /** 「GitHub 에서 가져오기」 창을 연다 */
  onGithubImport?: () => void
  /** 왼쪽 바 「새로고침」: Vault 폴더를 다시 훑는다 */
  onRefresh?: () => Promise<void>
  /** 파일 탐색기에서 그 파일이 있는 폴더를 연다(파일이 골라진 채로) */
  onRevealEntry?: (id: string) => Promise<void>
  /** 문서 판 묶음. 대표 자리 줄에 판 칩·펼침 단추를 보이고, 나머지 판은 목록에서 숨긴다 */
  versionGroups?: Readonly<Record<string, VersionGroup>>
  versionActions?: VersionMenuActions
  /** 문서 우클릭 「판으로 겹치기…」(다른 문서를 이 문서의 판으로) */
  onStackRequest?: (docId: string) => void
  /** 문서 우클릭 「판 관리 시작」(이 문서 하나로 판 묶음을 만든다) */
  onStartVersions?: (docId: string) => void
  /** 문서 우클릭 「원본 출처…」: 출처 창을 연다. 출처 수를 주면 메뉴에 수를 보인다 */
  onOpenSources?: (docId: string) => void
  sourceCounts?: Readonly<Record<string, number>>
  /** 문서 우클릭 「원본 열기」: 첫 출처를 바로 연다(출처가 있을 때만 보인다) */
  onOpenFirstSource?: (docId: string) => void
  /** 파일 탐색기에서 Vault 안의 그 폴더를 연다 */
  onRevealFolder?: (path: string) => Promise<void>
  searchRecords?: readonly VaultSearchRecord[]
  onOpenSearchResult?: (hit: VaultSearchHit) => void
  searchIndexProgress?: { readonly indexed: number; readonly total: number }
  onFavoriteChange?: (id: string, favorite: boolean) => void
  onOpenSettings?: () => void
  documentDropActive?: boolean
  /** 탐색기에서 끌어 온 파일이 들어갈 폴더(null = Vault 기본 자리). documentDropActive 일 때만 본다 */
  documentDropFolder?: string | null
  /** 탐색기에서 끌어 온 파일을 놓을 트리 자리(그 줄 앞·뒤, 폴더 안). 그 줄에 놓일 자리 선을 그린다 */
  documentDropPlace?: { readonly nodeId: string; readonly position: 'before' | 'after' | 'inside' } | null
  /** 항목 이모지. 파일은 항목 id, 폴더는 folderIconKey(path) 가 키다 */
  itemIcons?: Readonly<Record<string, string>>
  onItemIconChange?: (key: string, emoji: string | null) => void
  /** 폴더 색(웨일 북마크 폴더처럼). 키는 folderIconKey(path) */
  itemColors?: Readonly<Record<string, FolderColor>>
  onItemColorChange?: (key: string, color: FolderColor | null) => void
  /** 메모 노트(오른쪽 바에 여는 노트) 목록. 주면 왼쪽 바에 「노트」 구역이 생긴다 */
  memoNotes?: MemoNotesSectionProps
  /** 맨 위의 Vault 검색 단추(끄면 PDF 검색은 왼쪽 바 「PDF 검색」 보기로) */
  showVaultSearch?: boolean
  /** 최근에 연 Vault 밖 PDF(탐색기에서 IWAE 로 연 것). 바닥 줄 위에 날짜와 함께 보인다 */
  recentPdfs?: readonly RecentPdf[]
  onOpenRecentPdf?: (path: string) => void
  /** 최근 PDF 를 끌어 Vault 폴더(빈 곳이면 맨 위)에 놓으면 그 폴더로 가져온다 */
  onImportRecentPdf?: (path: string, folderPath: string) => Promise<void>
  onForgetRecentPdf?: (path: string) => void
  /** 최근 PDF 우클릭 「폴더 열기」: 탐색기에서 그 파일을 골라 보인다 */
  onRevealRecentPdf?: (path: string) => void
  /** 라이브러리 모드. 펼쳐지면 트리 대신 폴더·항목 표를 그린다 */
  libraryExpanded?: boolean
  /** 펼친 라이브러리를 그릴 자리(왼쪽 바 오른쪽 영역). 왼쪽 바 자체는 그대로 두고 라이브러리만 이 자리에 올린다 */
  libraryHost?: HTMLElement | null
  onToggleLibrary?: () => void
  onOpenLibraryItem?: (target: LibraryOpenTarget) => void
  /** PDF 서지 정보. 라이브러리 표의 저자·연도 칸에 쓴다 */
  bibliography?: Readonly<Record<string, BibEntry>>
  onEditBibliography?: (docId: string) => void
  onCopyBibtex?: (docId: string) => void
  /** 스캔 PDF 에 보이지 않는 글자 층을 깐 사본을 만든다 */
  /** PDF 도구 창(OCR·합치기·표시 넣은 사본 …)을 연다 */
  onOpenPdfTools?: (docId: string) => void
}

export interface MemoCategorySummary {
  readonly total: number
  readonly untagged: number
  readonly topics: readonly (readonly [string, number])[]
}

function collectFolderPaths(nodes: readonly VaultTreeNode[]): string[] {
  return nodes.flatMap((node) => node.kind === 'folder'
    ? [node.path, ...collectFolderPaths(node.children)]
    : [])
}

/** 폴더 안(하위 폴더 포함)의 문서 수와 하위 폴더 수 */
function countFolderContents(nodes: readonly VaultTreeNode[]): { documents: number; folders: number } {
  let documents = 0
  let folders = 0
  for (const node of nodes) {
    if (node.kind === 'folder') {
      const inner = countFolderContents(node.children)
      folders += 1 + inner.folders
      documents += inner.documents
    } else {
      documents += 1
    }
  }
  return { documents, folders }
}

function findFolder(nodes: readonly VaultTreeNode[], path: string): Extract<VaultTreeNode, { kind: 'folder' }> | null {
  for (const node of nodes) {
    if (node.kind !== 'folder') continue
    if (node.path === path) return node
    const inner = findFolder(node.children, path)
    if (inner !== null) return inner
  }
  return null
}

function parentOf(path: string): string {
  return path.split('/').slice(0, -1).join('/')
}

function entryId(node: Exclude<VaultTreeNode, { kind: 'folder' }>): string {
  return node.kind === 'pdf' ? node.doc.docId : node.path
}

function entryIdFromNodeId(nodeId: string): string {
  const separator = nodeId.indexOf(':')
  return separator === -1 ? nodeId : nodeId.slice(separator + 1)
}

/**
 * 저장 순서는 하나의 vault 트리로 유지하되, 화면에서는 PDF 문서와 노트를
 * 서로 다른 이름 있는 구역으로 투영한다. PDF와 읽기 전용 Markdown은
 * 왼쪽 문서 패널에, 편집 캔버스만 오른쪽 노트 패널에 열린다.
 *
 * 구역 이름을 대문자로 쓰지 않는다. 자간 벌린 대문자 라벨은 내용을 더
 * 읽기 쉽게 만들지 않으면서 시선만 먼저 가져간다 — 주인공은 문서 제목이다.
 *
 * 항목의 점은 장식이 아니라 현재 탭으로 열려 있는지를 표시한다.
 *
 * vault 이름 줄과 목록을 나눠 둔 이유는 시각이 아니라 창 조작이다.
 * 이 줄이 창의 왼쪽 위 드래그 손잡이(data-tauri-drag-region)인데,
 * 스크롤되는 영역 안에 있으면 목록을 내리는 순간 손잡이가 화면 밖으로
 * 나간다. 네이티브 제목 표시줄이 없는 창이라(decorations: false) 그때
 * 왼쪽 위 모서리로는 창을 옮길 방법이 없어진다. 가짜 데이터 아홉 줄은
 * 스크롤되지 않지만 실제 vault 의 마흔 줄은 스크롤된다.
 */
/** 폴더 그림. 색을 정했으면 그 색으로 칠한다(웨일 북마크 폴더처럼) */
function FolderGlyph({ color }: { readonly color?: FolderColor }) {
  const hex = folderColorHex(color)
  return hex === undefined
    ? <Folder className="side-folder-icon" size={14} aria-hidden="true" />
    : <Folder className="side-folder-icon side-folder-icon-colored" size={15} weight="fill" style={{ color: hex }} aria-hidden="true" />
}

export function Sidebar({
  library,
  notebooks,
  onOpenDoc,
  showNotes = true,
  memoCategories,
  memoFilter = null,
  onSelectMemoCategory,
  onOpenNote,
  onOpenMarkdown,
  onAddDoc,
  onCreateNote,
  onRelinkDoc,
  missingDocIds = [],
  vaultRoot,
  initiallyExpandAll = sidebarDefaults.expandAll,
  onSwitchVault,
  recentVaultPaths = [],
  onOpenRecentVault,
  openDocIds,
  openNotePaths,
  activeDocId = null,
  activeNotePath = null,
  tree,
  onReorderNode,
  onRenameEntry,
  onUpdateBibliography,
  onCreateFolder,
  onMoveEntry,
  onPlaceNode,
  onPlaceNodes,
  onDuplicateEntry,
  onTrashEntry,
  onTrashFolder,
  onRenameFolder,
  onConvertEntryToCopy,
  onCopyEntryPath,
  onRevealEntry,
  onOpenSources,
  sourceCounts,
  onOpenFirstSource,
  versionGroups,
  versionActions,
  onStackRequest,
  onStartVersions,
  onRevealFolder,
  githubSources,
  onGithubAction,
  onGithubImport,
  onRefresh,
  searchRecords = [],
  onOpenSearchResult,
  searchIndexProgress,
  onFavoriteChange,
  onOpenSettings,
  documentDropActive = false,
  documentDropFolder = null,
  documentDropPlace = null,
  itemIcons = {},
  onItemIconChange,
  itemColors = {},
  onItemColorChange,
  memoNotes,
  showVaultSearch = true,
  recentPdfs = [],
  onOpenRecentPdf,
  onImportRecentPdf,
  onForgetRecentPdf,
  onRevealRecentPdf,
  libraryExpanded = false,
  libraryHost = null,
  onToggleLibrary,
  onOpenLibraryItem,
  bibliography,
  onEditBibliography,
  onCopyBibtex,
  onOpenPdfTools,
}: SidebarProps) {
  // vault 줄과 목록이 같은 스크롤 영역에 있으면 목록이
  // 길어졌을 때 vault 줄이 화면 밖으로 밀려난다 — 항상 손이 닿아야
  // 하는 것이라 목록 스크롤과 분리된 바닥 줄로 둔다.
  // 컨플루언스처럼 트리 안에 새 줄을 먼저 놓고 거기서 이름을 받는다
  const [draft, setDraft] = useState<{ kind: 'folder' | 'note'; section: 'documents' | 'notes'; parentPath: string } | null>(null)
  const [draftName, setDraftName] = useState('')
  const [draftError, setDraftError] = useState<string | null>(null)
  const [draftBusy, setDraftBusy] = useState(false)
  const workspaceTree = useMemo(
    () => tree ?? buildLegacyWorkspaceTree(library, notebooks),
    [library, notebooks, tree],
  )
  const projectedTree = useMemo(() => projectVaultTree(workspaceTree), [workspaceTree])
  // 폴더는 접힌 것이 기본이다. 펼친 폴더만 기억해 두고(이 PC·이 Vault), 앱을 다시 열어도 그대로 둔다
  const expandedStorageKey = `iwae.sidebar.expanded:${vaultRoot ?? ''}`
  const [expandedFolders, setExpandedFolders] = useState<ReadonlySet<string>>(() => readExpandedFolders(expandedStorageKey))
  // 판 묶음: 대표 자리 문서 → 묶음, 목록에서 숨길 문서들, 펼친 묶음, 열린 판 드롭다운
  const groupByAnchor = useMemo(() => new Map(Object.values(versionGroups ?? {}).map((group) => [group.anchorDocId, group])), [versionGroups])
  const hiddenVersionIds = useMemo(() => hiddenVersionDocIds(versionGroups ?? {}), [versionGroups])
  // PDF 에 속한 노트는 그 PDF 줄 아래에, 나머지(일반 노트·PDF 가 사라진 노트)는 아래 「노트」 구역에 둔다
  const noteGroups = useMemo(() => groupMemoNotesByDoc(memoNotes?.entries ?? [], memoNotes?.docOwner), [memoNotes?.docOwner, memoNotes?.entries])
  const docNotesOf = (docId: string) => noteGroups.byDoc.get(docId) ?? []
  const [expandedVersionGroups, setExpandedVersionGroups] = useState<ReadonlySet<string>>(new Set())
  // 펼친 판 줄을 끌어 묶음 밖에 놓으면 묶음에서 뺀다: 끄는 판과 지금 묶음 밖인지
  const [versionDrag, setVersionDrag] = useState<{ docId: string; x: number; y: number; outside: boolean } | null>(null)
  const startVersionDrag = (event: React.PointerEvent<HTMLElement>, docId: string, onRemove: (docId: string) => void) => {
    if (event.button !== 0) return
    // 왼쪽 바의 문서 끌기(순서 바꾸기·판으로 겹치기)가 같이 시작되지 않게
    event.stopPropagation()
    const groupNode = event.currentTarget.closest('.side-tree-node')
    const start = { x: event.clientX, y: event.clientY }
    let dragging = false
    const isOutside = (x: number, y: number) => {
      const bounds = groupNode?.getBoundingClientRect()
      return bounds === undefined || y < bounds.top || y > bounds.bottom || x < bounds.left || x > bounds.right
    }
    const onMove = (move: PointerEvent) => {
      if (!dragging && Math.hypot(move.clientX - start.x, move.clientY - start.y) < 5) return
      dragging = true
      setVersionDrag({ docId, x: move.clientX, y: move.clientY, outside: isOutside(move.clientX, move.clientY) })
    }
    const finish = (up: PointerEvent) => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', finish)
      window.removeEventListener('pointercancel', finish)
      setVersionDrag(null)
      if (!dragging) return
      // 끈 다음 놓은 것이므로 이어지는 click(기본 판 고르기)은 막는다
      suppressVersionClickRef.current = true
      window.setTimeout(() => { suppressVersionClickRef.current = false }, 0)
      if (up.type === 'pointerup' && isOutside(up.clientX, up.clientY)) onRemove(docId)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', finish)
    window.addEventListener('pointercancel', finish)
  }
  const suppressVersionClickRef = useRef(false)
  /** 묶음·노트가 있는 줄의 펼침 상태 열쇠: 버전 묶음이면 묶음 id, 아니면 문서 id */
  const childKeyOf = (versionGroup: VersionGroup | undefined, docId: string | undefined) => versionGroup?.id ?? `doc:${docId ?? ''}`
  /** 버전 묶음 줄의 제목: 「문서 이름 · 지금 버전」 */
  const docRowTitle = (name: string, versionGroup: VersionGroup | undefined) => versionGroup === undefined
    ? <span className="side-item-title">{name}</span>
    : <><span className="side-item-title">{versionGroup.title}</span><span className="side-item-version">{` · ${defaultVersion(versionGroup).label}`}</span></>
  const toggleChildren = (key: string) => setExpandedVersionGroups((current) => {
    const next = new Set(current)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    return next
  })
  /** 줄 오른쪽 끝의 펼침 화살표 하나: 버전이 있거나 이 PDF 의 노트가 있을 때만. 버전·노트는 펼친 안쪽에 모은다 */
  const docCaret = (versionGroup: VersionGroup | undefined, docId: string | undefined, name: string) => {
    if (versionGroup === undefined && (docId === undefined || docNotesOf(docId).length === 0)) return null
    const key = childKeyOf(versionGroup, docId)
    const open = expandedVersionGroups.has(key)
    return (
      <button
        type="button"
        className="side-doc-caret"
        aria-label={open ? t('{name} 접기', { name }) : t('{name} 펼치기', { name })}
        aria-expanded={open}
        title={open ? t('접기') : t('펼치기')}
        onClick={(event) => {
          event.stopPropagation()
          toggleChildren(key)
        }}
      >
        {open ? <CaretDown size={11} weight="bold" aria-hidden="true" /> : <CaretRight size={11} weight="bold" aria-hidden="true" />}
      </button>
    )
  }
  /** 마우스를 올렸을 때만 보이는 「+」: 이 PDF 에 노트 만들기 */
  const docNoteAdd = (docId: string, versionGroup: VersionGroup | undefined, name: string, hasCaret: boolean) => memoNotes?.onCreateForDoc === undefined ? null : (
    <button
      type="button"
      className={`side-doc-note-add${hasCaret ? ' side-doc-note-add-with-caret' : ''}`}
      aria-label={t('{name}에 노트 만들기', { name })}
      title={t('이 PDF에 노트 만들기')}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => {
        event.stopPropagation()
        setExpandedVersionGroups((current) => new Set([...current, childKeyOf(versionGroup, docId)]))
        memoNotes.onCreateForDoc?.(docId)
      }}
    >
      <Plus size={12} weight="bold" aria-hidden="true" />
    </button>
  )
  /** 펼친 안쪽: 「버전」 알약 한 줄(지금 버전이 켜짐) → 이 PDF 의 노트들 */
  const docChildren = (versionGroup: VersionGroup | undefined, docId: string | undefined, depth: number) => {
    if (!expandedVersionGroups.has(childKeyOf(versionGroup, docId))) return null
    const notes = docId === undefined ? [] : docNotesOf(docId)
    const showVersions = versionGroup !== undefined && versionActions !== undefined
    if (!showVersions && notes.length === 0) return null
    return (
      <div className="side-doc-children" style={{ '--side-tree-depth': depth } as CSSProperties}>
        {showVersions ? (
          <div className="side-version-pills" role="group" aria-label={t('{title} 버전', { title: versionGroup.title })}>
            <span className="side-version-pills-label">{t('버전')}</span>
            {versionGroup.versions.map((version) => {
              const isCurrent = version.docId === defaultVersion(versionGroup).docId
              if (renamingVersion?.docId === version.docId) {
                return (
                  <input
                    key={version.docId}
                    className="side-version-pill-input"
                    aria-label={t('버전 이름')}
                    value={renamingVersion.value}
                    autoFocus
                    onFocus={(event) => event.currentTarget.select()}
                    onChange={(event) => setRenamingVersion({ docId: version.docId, value: event.target.value })}
                    onBlur={() => {
                      const value = renamingVersion.value.trim()
                      setRenamingVersion(null)
                      if (value !== '' && value !== version.label) versionActions.onRename(version.docId, value)
                    }}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') event.currentTarget.blur()
                      else if (event.key === 'Escape') setRenamingVersion(null)
                    }}
                  />
                )
              }
              return (
                <button
                  key={version.docId}
                  type="button"
                  className={`side-version-pill${isCurrent ? ' side-version-pill-on' : ''}${versionDrag?.docId === version.docId ? ' side-version-row-dragging' : ''}`}
                  aria-pressed={isCurrent}
                  aria-label={t('{label} 버전으로 바꾸기', { label: version.label })}
                  title={t('눌러서 이 버전으로 · 우클릭: 더 보기 · 끌어서 묶음 밖에 놓으면 빼기')}
                  onPointerDown={(event) => startVersionDrag(event, version.docId, versionActions.onRemove)}
                  onClick={() => {
                    if (suppressVersionClickRef.current) return
                    versionActions.onPin(version.docId)
                  }}
                  onContextMenu={(event) => {
                    event.preventDefault()
                    event.stopPropagation()
                    setVersionMenu({ docId: version.docId, label: version.label, x: event.clientX, y: event.clientY })
                  }}
                >
                  {version.label}
                </button>
              )
            })}
          </div>
        ) : null}
        {notes.length > 0 && memoNotes !== undefined ? (
          <DocNoteRows
            entries={notes}
            openPath={memoNotes.openPath}
            depth={depth + 1}
            onOpen={memoNotes.onOpen}
            onRename={memoNotes.onRename}
            onTrash={memoNotes.onTrash}
            icons={itemIcons}
            colors={itemColors}
            onPickIcon={onItemIconChange === undefined ? undefined : (key, x, y) => setEmojiTarget({ key, x, y })}
            onClearIcon={onItemIconChange === undefined ? undefined : (key) => onItemIconChange(key, null)}
            onReveal={memoNotes.onReveal}
            onCopyPath={memoNotes.onCopyPath}
          />
        ) : null}
      </div>
    )
  }
  const [renamingVersion, setRenamingVersion] = useState<{ docId: string; value: string } | null>(null)
  /** 버전 알약 우클릭 메뉴: 열기 · 이름 바꾸기 · 묶음에서 빼기 */
  const [versionMenu, setVersionMenu] = useState<{ docId: string; label: string; x: number; y: number } | null>(null)
  // 다른 Vault 로 바뀌면 그 Vault 에서 펼쳐 둔 것을 불러온다(처음 그릴 때는 위 초기값이 이미 그것이다)
  const [loadedStorageKey, setLoadedStorageKey] = useState(expandedStorageKey)
  if (loadedStorageKey !== expandedStorageKey) {
    setLoadedStorageKey(expandedStorageKey)
    setExpandedFolders(readExpandedFolders(expandedStorageKey))
  }
  useEffect(() => {
    try {
      window.localStorage.setItem(expandedStorageKey, JSON.stringify([...expandedFolders]))
    } catch {
      // 저장소를 못 쓰면 이번 실행 동안만 기억한다
    }
  }, [expandedFolders, expandedStorageKey])
  const [attachmentMenuOpen, setAttachmentMenuOpen] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [activeFolderPath, setActiveFolderPath] = useState('')
  const folderPaths = useMemo(() => collectFolderPaths(workspaceTree), [workspaceTree])
  const [attachmentFolderPath, setAttachmentFolderPath] = useState('')
  const [draggedNode, setDraggedNode] = useState<{
    section: 'documents' | 'notes'
    parentPath: string
    nodeId: string
  } | null>(null)
  const [dropTarget, setDropTarget] = useState<{
    section: 'documents' | 'notes'
    nodeId: string
    position: 'before' | 'after' | 'inside'
  } | null>(null)
  /** Ctrl·Shift 로 고른 트리 항목(노드 id). 고른 것 중 하나를 끌면 함께 옮긴다 */
  const [selectedNodes, setSelectedNodes] = useState<ReadonlySet<string>>(() => new Set())
  const selectionAnchorRef = useRef<string | null>(null)
  const sidebarRef = useRef<HTMLElement | null>(null)
  // 왼쪽 바 안쪽 확대: Ctrl+휠을 이 바 위에서 굴리면 목록만 커지고 작아진다(문서·오른쪽 바와 따로)
  const leftZoom = useBarZoom('left')
  // 라이브러리 모음·폴더 목록을 그릴 자리(펼쳤을 때 문서 트리 대신 들어선다)와 전환 애니메이션
  const [navHost, setNavHost] = useState<HTMLElement | null>(null)
  const [swapping, setSwapping] = useState(false)
  const sideScrollRef = useRef<HTMLDivElement>(null)
  useGutterHeadLines(sideScrollRef)
  // 펼침 값이 실제로 바뀔 때만 전환한다(탭을 바꿔 다시 마운트되거나 StrictMode 가 효과를 두 번 돌려도 움직이지 않는다)
  // 첫 화면 전에 클래스를 붙여야(layout effect) 애니메이션 전 한 프레임이 번쩍이지 않는다
  const swapPrevRef = useRef(libraryExpanded)
  useLayoutEffect(() => {
    if (swapPrevRef.current === libraryExpanded) return undefined
    swapPrevRef.current = libraryExpanded
    setSwapping(true)
    const timer = window.setTimeout(() => setSwapping(false), 220)
    return () => window.clearTimeout(timer)
  }, [libraryExpanded])
  useEffect(() => (sidebarRef.current === null ? undefined : attachBarZoomWheel(sidebarRef.current, 'left')), [])
  const [reorderAnnouncement, setReorderAnnouncement] = useState('')
  const [editingEntryId, setEditingEntryId] = useState<string | null>(null)
  const [editingName, setEditingName] = useState('')
  const [renameError, setRenameError] = useState<string | null>(null)
  /** 새 폴더 / 폴더 이름 바꾸기 대화상자 */
  const [folderDialog, setFolderDialog] = useState<
    | { mode: 'create'; parentPath: string }
    | { mode: 'rename'; path: string; name: string }
    | null
  >(null)
  const [deleteFolderTarget, setDeleteFolderTarget] = useState<{ path: string; name: string } | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [contextMenu, setContextMenu] = useState<{
    kind: 'entry' | 'folder'
    /** PDF 항목인가. 서지 메뉴는 PDF 에만 있다 */
    pdf: boolean
    /** 판 관리에 쓰는 문서 id(PDF docId, Markdown 은 색인 id). 판 관리가 안 되는 항목이면 없다 */
    versionDocId?: string
    iconKey: string
    id: string
    name: string
    parentPath: string
    storage: VaultSearchRecord['storage']
    favorite: boolean
    x: number
    y: number
  } | null>(null)

  const [emojiTarget, setEmojiTarget] = useState<{ key: string; x: number; y: number } | null>(null)
  /** 최근 PDF 우클릭 메뉴 */
  const [recentMenu, setRecentMenu] = useState<{ recent: RecentPdf; x: number; y: number } | null>(null)
  const skipRenameBlurRef = useRef(false)

  /**
   * 이모지 키는 즐겨찾기와 같은 항목 id 다. PDF 는 노드가 docId 를 들고
   * 있지만 Markdown·노트는 경로만 들고 있어서 검색 레코드로 id 를 찾는다.
   */
  const iconKeyFor = (node: Exclude<VaultTreeNode, { kind: 'folder' }>): string => {
    if (node.kind === 'pdf') return node.doc.docId
    return searchRecords.find((record) => record.path === node.path)?.id ?? node.path
  }

  /** 왼쪽 바 아이콘을 누르면 그 자리에 이모지 고르기 창을 띄운다 */
  const pickIcon = (key: string) => onItemIconChange === undefined
    ? undefined
    : (x: number, y: number) => setEmojiTarget({ key, x, y })

  const startRenaming = (id: string, name: string) => {
    if (onRenameEntry === undefined) return
    // Enter 로 끝낸 앞 편집은 칸이 사라져 blur 가 오지 않으므로, 건너뛰기 표시가 남아 다음 편집의 blur 를 삼킨다
    skipRenameBlurRef.current = false
    setEditingEntryId(id)
    setEditingName(name)
    setRenameError(null)
  }

  const finishRenaming = async (id: string) => {
    if (onRenameEntry === undefined) return
    const displayName = editingName.trim()
    if (displayName === '') {
      setRenameError(t('표시 이름을 입력해 주세요.'))
      return
    }
    // 판 묶음 줄: 줄에 보이는 것은 묶음 이름이므로 묶음 이름을 바꾼다(PDF 는 docId, Markdown 은 경로로 온다)
    const markdownIndexId = (() => {
      const walk = (nodes: readonly VaultTreeNode[]): string | null => {
        for (const node of nodes) {
          if (node.kind === 'markdown' && node.path === id) return node.indexId
          if (node.kind === 'folder') {
            const found = walk(node.children)
            if (found !== null) return found
          }
        }
        return null
      }
      return walk(tree ?? [])
    })()
    const group = groupByAnchor.get(id) ?? (markdownIndexId === null ? undefined : groupByAnchor.get(markdownIndexId))
    if (group !== undefined && versionActions?.onRenameGroup !== undefined) {
      versionActions.onRenameGroup(group.id, displayName)
      setEditingEntryId(null)
      setRenameError(null)
      return
    }
    try {
      await onRenameEntry(id, displayName)
      setEditingEntryId(null)
      setRenameError(null)
    } catch (err) {
      setRenameError(errorText(err))
    }
  }

  /** 폴더 이름도 파일처럼 그 자리에서 고친다. 편집 중인 항목 id 는 폴더 노드 id(folder:경로)다 */
  const startFolderRenaming = (folder: { id: string; name: string }) => {
    if (onRenameFolder === undefined) return
    skipRenameBlurRef.current = false
    setEditingEntryId(folder.id)
    setEditingName(folder.name)
    setRenameError(null)
  }

  const finishFolderRenaming = async (path: string) => {
    if (onRenameFolder === undefined) return
    const name = editingName.trim()
    if (name === '') {
      setRenameError(t('폴더 이름을 입력해 주세요.'))
      return
    }
    try {
      await onRenameFolder(path, name)
      setEditingEntryId(null)
      setRenameError(null)
    } catch (err) {
      setRenameError(errorText(err))
    }
  }

  /** 펼친 라이브러리의 폴더 칸에서 쓴 폴더 이름(이름 바꾸기·새 폴더) */
  const commitLibraryFolderEdit = async (value: string) => {
    const renaming = editingEntryId?.startsWith('folder:') === true ? editingEntryId.slice('folder:'.length) : null
    const parentPath = draft?.kind === 'folder' ? draft.parentPath : null
    setEditingEntryId(null)
    setDraft(null)
    setActionError(null)
    try {
      if (renaming !== null) await onRenameFolder?.(renaming, value.trim())
      else if (parentPath !== null) await onCreateFolder?.(parentPath, cleanEntryName(value))
    } catch (err) {
      setActionError(errorText(err))
    }
  }
  /** 펼친 라이브러리 표에서 메뉴의 「이름 바꾸기」를 고른 항목 */
  const [libraryRenameRequest, setLibraryRenameRequest] = useState<{ id: string; nonce: number } | null>(null)

  /** 두 구역(PDF 문서·노트)의 모든 폴더 키. "모두 접기" 가 이것을 한꺼번에 접는다 */
  const allFolderKeys = useMemo(() => {
    const collect = (nodes: readonly VaultTreeNode[], section: 'documents' | 'notes'): string[] => nodes.flatMap((node) => (
      node.kind === 'folder' ? [`${section}:${node.id}`, ...collect(node.children, section)] : []
    ))
    return [...collect(projectedTree.documents, 'documents'), ...collect(projectedTree.notes, 'notes')]
  }, [projectedTree])
  const [expandAllApplied, setExpandAllApplied] = useState(false)
  if (initiallyExpandAll && !expandAllApplied && allFolderKeys.length > 0) {
    setExpandAllApplied(true)
    setExpandedFolders(new Set(allFolderKeys))
  }
  /** 새 줄을 놓고, 그 줄이 보이도록 부모 폴더들을 펼친다 */
  const startDraft = (kind: 'folder' | 'note', section: 'documents' | 'notes', parentPath: string) => {
    setDraft({ kind, section, parentPath })
    setDraftName('')
    setDraftError(null)
    setDraftBusy(false)
    if (parentPath === '') return
    setExpandedFolders((current) => new Set([...current, ...allFolderKeys.filter((key) => {
      if (!key.startsWith(`${section}:`)) return false
      const path = key.slice(key.indexOf(':folder:') + ':folder:'.length)
      return parentPath === path || parentPath.startsWith(`${path}/`)
    })]))
  }
  const cancelDraft = () => {
    setDraft(null)
    setDraftError(null)
  }
  const commitDraft = async () => {
    if (draft === null || draftBusy) return
    if (draftName.trim() === '') {
      cancelDraft()
      return
    }
    let name: string
    try {
      name = cleanEntryName(draftName)
    } catch (err) {
      setDraftError(errorText(err))
      return
    }
    setDraftBusy(true)
    setDraftError(null)
    try {
      if (draft.kind === 'folder') await onCreateFolder?.(draft.parentPath, name)
      else await onCreateNote?.(draft.parentPath, name)
      setDraft(null)
    } catch (err) {
      setDraftError(errorText(err))
    } finally {
      setDraftBusy(false)
    }
  }
  /** 폴더가 어느 구역(PDF 문서·노트)에 보이는가. 둘 다면 PDF 문서 */
  const sectionOfFolder = (path: string): 'documents' | 'notes' => {
    const has = (nodes: readonly VaultTreeNode[]): boolean => nodes.some((node) => (
      node.kind === 'folder' && (node.path === path || has(node.children))
    ))
    return has(projectedTree.documents) || !has(projectedTree.notes) ? 'documents' : 'notes'
  }

  const allFoldersCollapsed = allFolderKeys.length > 0 && allFolderKeys.every((key) => !expandedFolders.has(key))
  const toggleAllFolders = () => {
    setExpandedFolders(allFoldersCollapsed ? new Set(allFolderKeys) : new Set())
  }

  const openEntryMenu = (
    event: ReactMouseEvent<HTMLElement>,
    node: Exclude<VaultTreeNode, { kind: 'folder' }>,
    parentPath: string,
  ) => {
    event.preventDefault()
    event.stopPropagation()
    const id = entryId(node)
    const record = searchRecords.find((candidate) => candidate.id === id || candidate.path === id)
    setActionError(null)
    setContextMenu({
      kind: 'entry',
      pdf: node.kind === 'pdf',
      ...(node.kind === 'pdf' ? { versionDocId: node.doc.docId } : node.kind === 'markdown' ? { versionDocId: node.indexId } : {}),
      iconKey: iconKeyFor(node),
      id,
      name: node.name,
      parentPath,
      storage: record?.storage ?? 'vault',
      favorite: record?.favorite ?? false,
      x: event.clientX,
      y: event.clientY,
    })
  }

  const openFolderMenu = (event: ReactMouseEvent<HTMLElement>, node: { name: string; path: string }) => {
    if (onItemIconChange === undefined && onItemColorChange === undefined && onCreateFolder === undefined && onRenameFolder === undefined && onTrashFolder === undefined) return
    event.preventDefault()
    event.stopPropagation()
    setActionError(null)
    setContextMenu({
      kind: 'folder',
      pdf: false,
      // 폴더도 판 관리를 한다(같은 문서 묶음의 여러 판 폴더)
      versionDocId: `folder:${node.path}`,
      iconKey: folderIconKey(node.path),
      id: node.path,
      name: node.name,
      parentPath: node.path,
      storage: 'vault',
      favorite: false,
      x: event.clientX,
      y: event.clientY,
    })
  }

  /** 라이브러리 표의 행도 트리 항목과 같은 메뉴를 쓴다 */
  const openLibraryItemMenu = (event: ReactMouseEvent<HTMLElement>, item: LibraryItem) => {
    event.preventDefault()
    event.stopPropagation()
    setActionError(null)
    // 왼쪽 바 문서 메뉴와 같은 항목(버전 관리 시작·버전으로 묶기 포함)이 보이게 버전 id 도 넘긴다
    const versionDocId = item.open.kind === 'pdf' ? item.open.doc.docId : item.open.kind === 'markdown' ? item.open.node.indexId : undefined
    setContextMenu({
      kind: 'entry',
      pdf: item.kind === 'pdf',
      ...(versionDocId === undefined ? {} : { versionDocId }),
      iconKey: item.id,
      id: item.id,
      name: item.name,
      parentPath: item.folder,
      storage: item.storage,
      favorite: item.favorite,
      x: event.clientX,
      y: event.clientY,
    })
  }

  // 위쪽 바는 메뉴 바탕막보다 위에 그려져 거기를 눌러도 메뉴가 안 닫혔다. 창 어디를 누르든 메뉴 밖이면 닫는다
  useEffect(() => {
    if (contextMenu === null) return undefined
    const closeOutside = (event: PointerEvent) => {
      const target = event.target as Element | null
      if (target?.closest?.('.side-context-menu') == null) setContextMenu(null)
    }
    document.addEventListener('pointerdown', closeOutside, true)
    return () => document.removeEventListener('pointerdown', closeOutside, true)
  }, [contextMenu])

  const runEntryAction = async (action: () => Promise<void> | void) => {
    setContextMenu(null)
    setActionError(null)
    try {
      await action()
    } catch (err) {
      setActionError(errorText(err))
    }
  }

  type DraggedNode = { section: 'documents' | 'notes'; parentPath: string; nodeId: string }
  type TreeDrop =
    | { kind: 'move'; section: 'documents' | 'notes'; nodeId: string; folderPath: string }
    | { kind: 'reorder'; section: 'documents' | 'notes'; nodeId: string; parentPath: string; position: 'before' | 'after' }
    | { kind: 'place'; section: 'documents' | 'notes'; nodeId: string; request: VaultTreePlaceRequest }
    /** PDF 줄 가운데에 PDF 를 놓으면 판으로 겹친다(아래에 깔린 문서 = baseDocId) */
    | { kind: 'stack'; section: 'documents'; nodeId: string; baseDocId: string }

  const canDrag = onPlaceNode !== undefined || onReorderNode !== undefined || onMoveEntry !== undefined

  // 끌던 항목을 놓을 자리. onPlaceNode 가 있으면 어디든(다른 폴더의 줄 사이, 폴더 안, 구역 빈 곳 = 맨 위) 놓는다
  const treeDropAt = (dragged: DraggedNode, target: Element | null, clientY: number): TreeDrop | null => {
    if (!(target instanceof HTMLElement)) return null
    const section = target.dataset.section === 'notes' ? 'notes' : 'documents'
    if (onPlaceNode !== undefined && target.dataset.internalDrop === 'tree-root') {
      if (section !== dragged.section) return null
      return {
        kind: 'place',
        section,
        nodeId: '',
        request: { nodeId: dragged.nodeId, fromParent: dragged.parentPath, toParent: '', targetNodeId: null, position: 'after' },
      }
    }
    if (target.dataset.internalDrop !== 'tree-node') return null
    const nodeId = target.dataset.nodeId ?? ''
    const parentPath = target.dataset.parentPath ?? ''
    if (nodeId === '' || nodeId === dragged.nodeId) return null
    const row = target.querySelector(':scope > .side-tree-row') ?? target
    const bounds = row.getBoundingClientRect()
    const ratio = bounds.height > 0 ? (clientY - bounds.top) / bounds.height : 0.5
    const isFolder = target.dataset.kind === 'folder'
    // PDF 를 다른 PDF 줄 가운데에 놓으면 판으로 겹친다(줄 위·아래 끝에 놓으면 지금처럼 순서 바꾸기)
    if (
      versionActions?.onStack !== undefined && section === 'documents' && dragged.section === 'documents'
      && ((dragged.nodeId.startsWith('pdf:') && nodeId.startsWith('pdf:')) || (dragged.nodeId.startsWith('markdown:') && nodeId.startsWith('markdown:')))
      && dragged.nodeId !== nodeId && ratio > 0.3 && ratio < 0.7
    ) {
      return { kind: 'stack', section: 'documents', nodeId, baseDocId: entryIdFromNodeId(nodeId) }
    }
    if (onPlaceNode !== undefined) {
      if (section !== dragged.section) return null
      // 폴더를 자기 안(하위)으로는 못 넣는다
      if (dragged.nodeId.startsWith('folder:')) {
        const own = dragged.nodeId.slice('folder:'.length)
        const into = isFolder && ratio > 0.25 && ratio < 0.75 ? target.dataset.path ?? '' : parentPath
        if (into === own || into.startsWith(`${own}/`)) return null
      }
      if (isFolder && ratio > 0.25 && ratio < 0.75) {
        return {
          kind: 'place',
          section,
          nodeId,
          request: { nodeId: dragged.nodeId, fromParent: dragged.parentPath, toParent: target.dataset.path ?? '', targetNodeId: null, position: 'inside' },
        }
      }
      return {
        kind: 'place',
        section,
        nodeId,
        request: { nodeId: dragged.nodeId, fromParent: dragged.parentPath, toParent: parentPath, targetNodeId: nodeId, position: ratio < 0.5 ? 'before' : 'after' },
      }
    }
    if (isFolder && onMoveEntry !== undefined && !dragged.nodeId.startsWith('folder:')) {
      return { kind: 'move', section, nodeId, folderPath: target.dataset.path ?? '' }
    }
    if (onReorderNode === undefined || dragged.section !== section || dragged.parentPath !== parentPath) return null
    return { kind: 'reorder', section, nodeId, parentPath, position: ratio < 0.5 ? 'before' : 'after' }
  }

  /** 지금 보이는 트리 줄(펼친 폴더 안 포함)을 화면 차례대로 */
  const visibleTreeRows = (section: 'documents' | 'notes') => Array.from(
    sidebarRef.current?.querySelectorAll<HTMLElement>(`li[data-internal-drop="tree-node"][data-section="${section}"]`) ?? [],
  )

  /**
   * Ctrl+누르기는 하나씩 더하고 빼기, Shift+누르기는 마지막으로 누른 줄부터 여기까지 고르기.
   * 그때는 열거나 펼치지 않는다(true 를 돌려준다). 그냥 누르면 고른 것을 풀고 원래대로 연다.
   */
  const selectClick = (event: ReactMouseEvent<HTMLElement>, nodeId: string, section: 'documents' | 'notes'): boolean => {
    if (!(event.ctrlKey || event.metaKey || event.shiftKey)) {
      if (selectedNodes.size > 0) setSelectedNodes(new Set())
      selectionAnchorRef.current = nodeId
      return false
    }
    event.preventDefault()
    event.stopPropagation()
    const anchor = selectionAnchorRef.current
    if (event.shiftKey && anchor !== null) {
      const ids = visibleTreeRows(section).map((row) => row.dataset.nodeId ?? '')
      const from = ids.indexOf(anchor)
      const to = ids.indexOf(nodeId)
      if (from >= 0 && to >= 0) {
        const range = ids.slice(Math.min(from, to), Math.max(from, to) + 1)
        setSelectedNodes(new Set([...(event.ctrlKey || event.metaKey ? selectedNodes : []), ...range]))
        return true
      }
    }
    const next = new Set(selectedNodes)
    if (next.has(nodeId)) next.delete(nodeId)
    else next.add(nodeId)
    setSelectedNodes(next)
    selectionAnchorRef.current = nodeId
    return true
  }

  /** 함께 끌 항목: 고른 것 중 같은 구역의 것을 화면 차례대로. 고른 폴더 안의 것은 폴더와 함께 가므로 뺀다 */
  const draggedGroup = (dragged: DraggedNode): DraggedNode[] => {
    if (!selectedNodes.has(dragged.nodeId) || selectedNodes.size < 2) return [dragged]
    const rows = visibleTreeRows(dragged.section).filter((row) => selectedNodes.has(row.dataset.nodeId ?? ''))
    const folders = rows.filter((row) => row.dataset.kind === 'folder').map((row) => row.dataset.path ?? '')
    return rows
      .map((row) => ({ section: dragged.section, parentPath: row.dataset.parentPath ?? '', nodeId: row.dataset.nodeId ?? '' }))
      .filter((node) => node.nodeId !== '' && !folders.some((folder) => node.parentPath === folder || node.parentPath.startsWith(`${folder}/`)))
  }

  /** 여러 개를 놓을 수 있는가: 고른 것 위에는 못 놓고, 고른 폴더를 자기 안으로도 못 넣는다 */
  const groupDropAllowed = (group: readonly DraggedNode[], drop: TreeDrop): boolean => {
    if (group.length < 2) return true
    if (group.some((node) => node.nodeId === drop.nodeId)) return false
    // 판 겹치기는 하나씩만
    if (drop.kind === 'stack') return false
    if (drop.kind !== 'place') return true
    const into = drop.request.toParent
    return group.every((node) => {
      if (!node.nodeId.startsWith('folder:')) return true
      const own = node.nodeId.slice('folder:'.length)
      return into !== own && !into.startsWith(`${own}/`)
    })
  }

  // 왼쪽 트리 끌기도 포인터로 한다(core/internalDrag — Windows 의 Tauri 에서 HTML5 드래그가 놓이지 않는다)
  const startTreeDrag = (event: ReactPointerEvent<HTMLLIElement>, dragged: DraggedNode, label: string) => {
    if (event.button !== 0 || !canDrag) return
    if ((event.target as Element).closest('input, textarea, .side-tree-add, [data-emoji-pick]') !== null) return
    event.stopPropagation()
    const group = draggedGroup(dragged)
    const dropFor = (target: Element | null, y: number) => {
      const drop = treeDropAt(dragged, target, y)
      return drop !== null && groupDropAllowed(group, drop) ? drop : null
    }
    startInternalDrag(event, {}, {
      label: group.length > 1 ? t('{count}개 항목', { count: group.length }) : label,
      onStart: () => setDraggedNode(dragged),
      onOver: (target, _x, y) => {
        const drop = dropFor(target, y)
        setDropTarget(drop === null ? null : {
          section: drop.section,
          nodeId: drop.nodeId,
          position: drop.kind === 'move' || drop.kind === 'stack' ? 'inside' : drop.kind === 'place' ? drop.request.position : drop.position,
        })
      },
      onEnd: (_dropped, target, _x, y) => {
        const drop = dropFor(target, y)
        setDraggedNode(null)
        setDropTarget(null)
        if (drop === null) return
        setActionError(null)
        if (group.length > 1) {
          const nodes = group.map((node) => ({ nodeId: node.nodeId, fromParent: node.parentPath }))
          let done: Promise<unknown> = Promise.resolve()
          if (drop.kind === 'place') {
            done = onPlaceNodes !== undefined
              ? onPlaceNodes(nodes, drop.request)
              : nodes.reduce<Promise<unknown>>((chain, node) => chain.then(() => onPlaceNode?.({ ...drop.request, ...node })), Promise.resolve())
          } else if (drop.kind === 'move') {
            done = nodes.filter((node) => !node.nodeId.startsWith('folder:'))
              .reduce<Promise<unknown>>((chain, node) => chain.then(() => onMoveEntry?.(entryIdFromNodeId(node.nodeId), drop.folderPath)), Promise.resolve())
          }
          void done
            .then(() => setReorderAnnouncement(t('{count}개 항목을 옮겼습니다.', { count: nodes.length })))
            .catch((err: unknown) => setActionError(errorText(err)))
          setSelectedNodes(new Set())
          return
        }
        if (drop.kind === 'stack') {
          versionActions?.onStack?.(entryIdFromNodeId(dragged.nodeId), drop.baseDocId)
        } else if (drop.kind === 'place') {
          onPlaceNode?.(drop.request).catch((err: unknown) => setActionError(errorText(err)))
        } else if (drop.kind === 'move') {
          onMoveEntry?.(entryIdFromNodeId(dragged.nodeId), drop.folderPath)
            .catch((err: unknown) => setActionError(errorText(err)))
        } else {
          onReorderNode?.({ parentPath: drop.parentPath, nodeId: dragged.nodeId, targetNodeId: drop.nodeId, position: drop.position })
        }
      },
    })
  }

  /** 최근 PDF 를 놓을 Vault 폴더: 폴더 위면 그 폴더, 문서 위면 그 문서의 폴더, 구역 빈 곳이면 맨 위 */
  const recentDropFolder = (target: Element | null): { folderPath: string; nodeId: string } | null => {
    if (!(target instanceof HTMLElement) || target.dataset.section === 'notes') return null
    if (target.dataset.internalDrop === 'tree-root') return { folderPath: '', nodeId: '' }
    if (target.dataset.internalDrop !== 'tree-node') return null
    const folderPath = target.dataset.kind === 'folder' ? target.dataset.path ?? '' : target.dataset.parentPath ?? ''
    return { folderPath, nodeId: target.dataset.kind === 'folder' ? target.dataset.nodeId ?? '' : '' }
  }
  const startRecentDrag = (event: ReactPointerEvent<HTMLLIElement>, recent: RecentPdf) => {
    if (event.button !== 0 || onImportRecentPdf === undefined) return
    if ((event.target as Element).closest('.side-recent-forget') !== null) return
    startInternalDrag(event, {}, {
      label: `${recent.title} → Vault`,
      onOver: (target) => {
        const drop = recentDropFolder(target)
        setDropTarget(drop === null ? null : { section: 'documents', nodeId: drop.nodeId, position: 'inside' })
      },
      onEnd: (_dropped, target) => {
        const drop = recentDropFolder(target)
        setDropTarget(null)
        if (drop === null) return
        setActionError(null)
        onImportRecentPdf(recent.path, drop.folderPath).catch((err: unknown) => setActionError(errorText(err)))
      },
    })
  }

  // 구역의 빈 곳에 놓으면 Vault 맨 위(폴더 밖) 맨 끝으로 간다
  const sectionDropProps = (section: 'documents' | 'notes') => onPlaceNode === undefined ? {} : {
    'data-internal-drop': 'tree-root',
    'data-section': section,
  }
  const sectionDropClass = (section: 'documents' | 'notes') =>
    dropTarget?.section === section && dropTarget.nodeId === '' ? ' side-section-drop' : ''

  const renderTree = (
    nodes: readonly VaultTreeNode[],
    parentPath: string,
    depth: number,
    section: 'documents' | 'notes',
  ) => (
    <ul
      className={depth === 0 ? 'side-tree' : 'side-tree-children'}
      role={depth === 0 ? 'tree' : 'group'}
      aria-label={depth === 0 ? (section === 'documents' ? t('PDF 문서 트리') : t('노트 트리')) : undefined}
    >
      {draft !== null && draft.section === section && draft.parentPath === parentPath ? (
        <li className="side-tree-node side-tree-draft" role="treeitem" aria-selected={false}>
          <div className="side-tree-row" style={{ '--side-tree-depth': depth } as CSSProperties}>
            <div className="side-item side-tree-item side-inline-rename-row side-draft-row">
              {draft.kind === 'folder'
                ? <Folder className="side-folder-icon" size={14} aria-hidden="true" />
                : <NotePencil className="side-file-icon" size={14} aria-hidden="true" />}
              <input
                className="side-inline-rename"
                aria-label={draft.kind === 'folder' ? t('새 폴더 이름') : t('새 노트 이름')}
                placeholder={draft.kind === 'folder' ? t('새 폴더') : t('제목 없는 노트')}
                value={draftName}
                autoFocus
                spellCheck={false}
                disabled={draftBusy}
                aria-invalid={draftError !== null}
                onChange={(event) => {
                  setDraftName(event.target.value)
                  setDraftError(null)
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    void commitDraft()
                  } else if (event.key === 'Escape') {
                    event.preventDefault()
                    event.stopPropagation()
                    cancelDraft()
                  }
                }}
                onBlur={() => {
                  // 비어 있으면 그냥 지우고, 쓴 게 있으면 만든다(이름 오류면 줄을 남겨 고치게 한다)
                  if (draftError === null) void commitDraft()
                }}
              />
            </div>
          </div>
          {draftError !== null ? <span className="side-inline-rename-error" role="alert">{draftError}</span> : null}
        </li>
      ) : null}
      {nodes.map((node, index) => {
        // 판으로 겹쳐진 문서(대표 자리가 아닌 판)는 묶음 줄 안에 있다
        if (node.kind === 'pdf' && hiddenVersionIds.has(node.doc.docId)) return null
        if (node.kind === 'markdown' && hiddenVersionIds.has(node.indexId)) return null
        // 폴더 판: 대표 폴더 줄 하나만 보이고, 펼치면 기본 판 폴더의 내용이 나온다
        if (node.kind === 'folder' && hiddenVersionIds.has(`folder:${node.path}`)) return null
        const versionGroup = node.kind === 'pdf' ? groupByAnchor.get(node.doc.docId) : node.kind === 'markdown' ? groupByAnchor.get(node.indexId) : groupByAnchor.get(`folder:${node.path}`)
        const shownFolder = node.kind === 'folder' && versionGroup !== undefined
          ? findFolder(tree ?? [], defaultVersion(versionGroup).docId.slice('folder:'.length)) ?? node
          : node
        const sectionNodeKey = `${section}:${node.id}`
        const open = node.kind === 'folder' && expandedFolders.has(sectionNodeKey)
        const isDropTarget = dropTarget?.section === section && dropTarget.nodeId === node.id
        const rowClassName = [
          'side-tree-node',
          draggedNode?.nodeId === node.id || (draggedNode !== null && selectedNodes.has(draggedNode.nodeId) && selectedNodes.has(node.id)) ? 'side-tree-node-dragging' : '',
          selectedNodes.has(node.id) ? 'side-tree-node-selected' : '',
          isDropTarget ? `side-tree-drop-${dropTarget.position}` : '',
          // 탐색기에서 끌어 온 파일이 들어갈 폴더
          documentDropActive && section === 'documents' && (documentDropPlace === null
            ? node.kind === 'folder' && node.path === documentDropFolder ? 'side-tree-drop-inside' : ''
            : documentDropPlace.nodeId === node.id ? `side-tree-drop-${documentDropPlace.position}` : ''),
        ].filter(Boolean).join(' ')

        // 줄을 끌어 옮기는 것 말고, 키보드로는 그 줄에 초점을 두고 Alt+↑/↓ 로 형제 사이를 옮긴다
        const moveWithKeyboard = (event: KeyboardEvent<HTMLLIElement>) => {
          if (!event.altKey || onReorderNode === undefined) return
          if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
          if ((event.target as Element).closest('input, textarea') !== null) return
          event.preventDefault()
          // 안쪽(하위 폴더) 줄에서 눌렀으면 그 줄만 옮긴다
          event.stopPropagation()
          const targetIndex = event.key === 'ArrowUp' ? index - 1 : index + 1
          const target = nodes[targetIndex]
          if (target === undefined) return
          const position = event.key === 'ArrowUp' ? 'before' : 'after'
          onReorderNode({ parentPath, nodeId: node.id, targetNodeId: target.id, position })
          setReorderAnnouncement((event.key === 'ArrowUp' ? t('{name}을 위로 이동했습니다.', { name: node.name }) : t('{name}을 아래로 이동했습니다.', { name: node.name })))
        }

        return (
          <li
            key={node.id}
            className={rowClassName}
            role="treeitem"
            aria-expanded={node.kind === 'folder' ? open : undefined}
            data-internal-drop="tree-node"
            data-section={section}
            data-node-id={node.id}
            data-parent-path={parentPath}
            data-kind={node.kind}
            data-path={node.kind === 'folder' ? node.path : undefined}
            onPointerDown={editingEntryId === node.id ? undefined : (event) => startTreeDrag(event, { section, parentPath, nodeId: node.id }, node.name)}
            onKeyDown={moveWithKeyboard}
          >
            <div className="side-tree-row" style={{ '--side-tree-depth': depth } as CSSProperties}>
              {node.kind === 'folder' && editingEntryId === node.id ? (
                <div className="side-tree-toggle side-inline-rename-row">
                  <span className="side-tree-chevron" aria-hidden="true">
                    {open ? <CaretDown size={12} weight="bold" /> : <CaretRight size={12} weight="bold" />}
                  </span>
                  <ItemEmoji
                    emoji={itemIcons[folderIconKey(node.path)]}
                    fallback={<FolderGlyph color={itemColors[folderIconKey(node.path)]} />}
                  />
                  <input
                    className="side-inline-rename"
                    aria-label={t('{name} 폴더 이름', { name: node.name })}
                    value={editingName}
                    autoFocus
                    onFocus={(event) => event.currentTarget.select()}
                    onChange={(event) => setEditingName(event.target.value)}
                    onClick={(event) => event.stopPropagation()}
                    // 다른 곳을 눌러 칸을 벗어나도 바꾼 이름을 적용한다(Enter·Esc 로 끝낸 뒤에는 건너뛴다)
                    onBlur={() => {
                      if (skipRenameBlurRef.current) {
                        skipRenameBlurRef.current = false
                        return
                      }
                      void finishFolderRenaming(node.path)
                    }}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault()
                        skipRenameBlurRef.current = true
                        void finishFolderRenaming(node.path)
                      } else if (event.key === 'Escape') {
                        event.preventDefault()
                        skipRenameBlurRef.current = true
                        setEditingEntryId(null)
                        setRenameError(null)
                      }
                    }}
                  />
                </div>
              ) : node.kind === 'folder' ? (
                <>
                <button
                  type="button"
                  className="side-tree-toggle"
                  aria-label={open ? t('{name} 접기', { name: node.name }) : t('{name} 펼치기', { name: node.name })}
                  aria-expanded={open}
                  onContextMenu={(event) => openFolderMenu(event, node)}
                  onDoubleClick={(event) => {
                    event.preventDefault()
                    event.stopPropagation()
                    startFolderRenaming(node)
                  }}
                  onClick={(event) => !selectClick(event, node.id, section) && setExpandedFolders((current) => {
                    setActiveFolderPath(node.path)
                    setAttachmentFolderPath((path) => path === '' ? node.path : path)
                    const next = new Set(current)
                    if (next.has(sectionNodeKey)) next.delete(sectionNodeKey)
                    else next.add(sectionNodeKey)
                    return next
                  })}
                >
                  <span className="side-tree-chevron" aria-hidden="true">
                    {open ? <CaretDown size={12} weight="bold" /> : <CaretRight size={12} weight="bold" />}
                  </span>
                  <ItemEmoji
                    emoji={itemIcons[folderIconKey(node.path)]}
                    onPick={pickIcon(folderIconKey(node.path))}
                    fallback={<FolderGlyph color={itemColors[folderIconKey(node.path)]} />}
                  />
                  {docRowTitle(node.name, versionGroup)}
                  {(() => {
                    const source = githubSources?.get(shownFolder.kind === 'folder' ? shownFolder.path : node.path)
                    if (source === undefined) return null
                    return (
                      <span
                        className={`side-github-badge${source.behind > 0 ? ' side-github-badge-behind' : ''}`}
                        title={[
                          source.url.replace(/\.git$/u, ''),
                          `${source.branch ?? source.detached} · ${source.headDate} ${source.headSubject}`,
                          ...(source.behind > 0 ? [t('새 커밋 {count}개', { count: source.behind })] : []),
                        ].join('\n')}
                      >
                        <GitBranch size={10} weight="bold" aria-hidden="true" />
                        {source.branch ?? source.detached}
                        {source.behind > 0 ? ` · ↓${source.behind}` : ''}
                      </span>
                    )
                  })()}
                </button>
                {versionGroup === undefined ? null : docCaret(versionGroup, undefined, versionGroup.title)}
                </>
              ) : node.kind === 'pdf' ? (
                <>
                  {editingEntryId === node.doc.docId ? (
                    <div className="side-item side-tree-item side-inline-rename-row">
                      <ItemEmoji emoji={itemIcons[node.doc.docId]} fallback={<FilePdf className="side-file-icon" size={14} aria-hidden="true" />} />
                      <input
                        className="side-inline-rename"
                        aria-label={t('{name} 표시 이름', { name: node.name })}
                        value={editingName}
                        autoFocus
                        onChange={(event) => setEditingName(event.target.value)}
                        onClick={(event) => event.stopPropagation()}
                        // 다른 곳을 눌러 칸을 벗어나도 바꾼 이름을 적용한다(Enter·Esc 로 끝낸 뒤에는 건너뛴다)
                        onBlur={() => {
                          if (skipRenameBlurRef.current) {
                            skipRenameBlurRef.current = false
                            return
                          }
                          void finishRenaming(node.doc.docId)
                        }}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') {
                            event.preventDefault()
                            skipRenameBlurRef.current = true
                            void finishRenaming(node.doc.docId)
                          } else if (event.key === 'Escape') {
                            event.preventDefault()
                            skipRenameBlurRef.current = true
                            setEditingEntryId(null)
                            setRenameError(null)
                          }
                        }}
                      />
                    </div>
                  ) : (
                    <div className={`side-version-line${(versionGroup === undefined ? openDocIds.includes(node.doc.docId) : versionGroup.versions.some((version) => openDocIds.includes(version.docId))) ? ' side-version-line-open' : ''}${(versionGroup === undefined ? activeDocId === node.doc.docId : versionGroup.versions.some((version) => version.docId === activeDocId)) ? ' side-version-line-active' : ''}`}>
                    <button
                      type="button"
                      className={`side-item side-tree-item${(versionGroup === undefined ? openDocIds.includes(node.doc.docId) : versionGroup.versions.some((version) => openDocIds.includes(version.docId))) ? ' side-item-open' : ''}${(versionGroup === undefined ? activeDocId === node.doc.docId : versionGroup.versions.some((version) => version.docId === activeDocId)) ? ' side-item-active' : ''}`}
                      aria-label={versionGroup === undefined ? node.name : `${versionGroup.title} ${defaultVersion(versionGroup).label}`}
                      disabled={missingDocIds.includes(node.doc.docId)}
                      onClick={(event) => {
                        if (selectClick(event, node.id, section)) return
                        // 묶음 줄은 기본 판을 연다
                        const target = versionGroup === undefined ? node.doc : library.find((doc) => doc.docId === defaultVersion(versionGroup).docId) ?? node.doc
                        onOpenDoc(target)
                      }}
                      onDoubleClick={(event) => {
                        event.preventDefault()
                        event.stopPropagation()
                        startRenaming(node.doc.docId, versionGroup?.title ?? node.name)
                      }}
                      onContextMenu={(event) => openEntryMenu(event, node, parentPath)}
                    >
                      <span className="side-doc-icon">
                        <ItemEmoji emoji={itemIcons[node.doc.docId]} onPick={pickIcon(node.doc.docId)} fallback={<FilePdf className="side-file-icon" size={14} aria-hidden="true" />} />
                        {docNotesOf(node.doc.docId).length > 0 ? <i className="side-doc-note-dot" aria-hidden="true" /> : null}
                      </span>
                      <span className={`side-dot${(versionGroup === undefined ? openDocIds.includes(node.doc.docId) : versionGroup.versions.some((version) => openDocIds.includes(version.docId))) ? ' side-dot-open' : ''}`} aria-hidden="true" />
                      {docRowTitle(node.name, versionGroup)}
                    </button>
                    {missingDocIds.includes(node.doc.docId) ? null : docNoteAdd(node.doc.docId, versionGroup, versionGroup?.title ?? node.name, versionGroup !== undefined || docNotesOf(node.doc.docId).length > 0)}
                    {missingDocIds.includes(node.doc.docId) && (
                      <>
                        <span className="side-missing" title={t('찾을 수 없음')}>
                          <WarningCircle className="side-missing-icon" size={14} aria-hidden="true" />
                          <span className="side-missing-text">{t('찾을 수 없음')}</span>
                        </span>
                        <button type="button" className="side-relink" title={t('다시 연결')} aria-label={t('{name} 다시 연결', { name: node.name })} onClick={() => onRelinkDoc?.(node.doc.docId)}>
                          <LinkSimple className="side-relink-icon" size={14} aria-hidden="true" />
                          <span className="side-relink-text">{t('다시 연결')}</span>
                        </button>
                      </>
                    )}
                    {docCaret(versionGroup, node.doc.docId, versionGroup?.title ?? node.name)}
                    </div>
                  )}
                  {editingEntryId === node.doc.docId && renameError !== null && (
                    <span className="side-inline-rename-error" role="alert">{renameError}</span>
                  )}
                  {docChildren(versionGroup, node.doc.docId, depth)}
                  {(() => {
                    // 열린 PDF 밑에 그 PDF 의 메모 카테고리를 펼친다. 누르면 메모 열·메모만 보기가 그 카테고리만 보이고,
                    // 고른 것을 다시 누르면 풀린다(전체)
                    const summary = memoCategories?.[node.doc.docId]
                    if (summary === undefined || summary.topics.length === 0 || !openDocIds.includes(node.doc.docId) || onSelectMemoCategory === undefined) return null
                    const selected = memoFilter?.docId === node.doc.docId ? memoFilter.topic : undefined
                    return (
                      <div className="side-memo-categories" role="group" aria-label={t('{name} 메모 카테고리', { name: node.name })}>
                        {summary.topics.map(([topic, count]) => (
                          <button
                            key={topic}
                            type="button"
                            className={`side-memo-category${selected === topic ? ' side-memo-category-active' : ''}`}
                            aria-pressed={selected === topic}
                            onClick={() => onSelectMemoCategory(node.doc, selected === topic ? null : topic)}
                          >
                            <span className="memo-tag-dot" style={{ background: categoryColor(topic) }} aria-hidden="true" />
                            <span className="side-item-title">{topic}</span>
                          </button>
                        ))}
                        {summary.untagged > 0 ? (
                          <button
                            type="button"
                            className={`side-memo-category${selected === '' ? ' side-memo-category-active' : ''}`}
                            aria-pressed={selected === ''}
                            onClick={() => onSelectMemoCategory(node.doc, selected === '' ? null : '')}
                          >
                            <span className="side-item-title">{t('카테고리 없음')}</span>
                          </button>
                        ) : null}
                      </div>
                    )
                  })()}
                </>
              ) : node.kind === 'note' ? (
                editingEntryId === node.path ? (
                  <div className="side-item side-tree-item side-inline-rename-row">
                    <ItemEmoji emoji={itemIcons[iconKeyFor(node)]} fallback={<NotePencil className="side-file-icon" size={14} aria-hidden="true" />} />
                    <input
                      className="side-inline-rename"
                      aria-label={t('{name} 표시 이름', { name: node.name })}
                      value={editingName}
                      autoFocus
                      onChange={(event) => setEditingName(event.target.value)}
                      onClick={(event) => event.stopPropagation()}
                      // 다른 곳을 눌러 칸을 벗어나도 바꾼 이름을 적용한다(Enter·Esc 로 끝낸 뒤에는 건너뛴다)
                      onBlur={() => {
                        if (skipRenameBlurRef.current) {
                          skipRenameBlurRef.current = false
                          return
                        }
                        void finishRenaming(node.path)
                      }}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          event.preventDefault()
                          skipRenameBlurRef.current = true
                          void finishRenaming(node.path)
                        } else if (event.key === 'Escape') {
                          event.preventDefault()
                          skipRenameBlurRef.current = true
                          setEditingEntryId(null)
                          setRenameError(null)
                        }
                      }}
                    />
                  </div>
                ) : (
                  <button
                    type="button"
                    className={`side-item side-tree-item${openNotePaths.includes(node.path) ? ' side-item-open' : ''}${activeNotePath === node.path ? ' side-item-active' : ''}`}
                    onClick={(event) => {
                      if (!selectClick(event, node.id, section)) onOpenNote({ path: node.path, title: node.name })
                    }}
                    onDoubleClick={(event) => {
                      event.preventDefault()
                      event.stopPropagation()
                      startRenaming(node.path, node.name)
                    }}
                    onContextMenu={(event) => openEntryMenu(event, node, parentPath)}
                  >
                    <ItemEmoji emoji={itemIcons[iconKeyFor(node)]} onPick={pickIcon(iconKeyFor(node))} fallback={<NotePencil className="side-file-icon" size={14} aria-hidden="true" />} />
                    <span className={`side-dot${openNotePaths.includes(node.path) ? ' side-dot-open' : ''}`} aria-hidden="true" />
                    <span className="side-item-title">{node.name}</span>
                  </button>
                )
              ) : (
                editingEntryId === node.path ? (
                  <div className="side-item side-tree-item side-inline-rename-row">
                    <ItemEmoji emoji={itemIcons[iconKeyFor(node)]} fallback={<FileMd className="side-file-icon side-file-icon-md" size={14} aria-hidden="true" />} />
                    <input
                      className="side-inline-rename"
                      aria-label={t('{name} 표시 이름', { name: node.name })}
                      value={editingName}
                      autoFocus
                      onChange={(event) => setEditingName(event.target.value)}
                      onClick={(event) => event.stopPropagation()}
                      // 다른 곳을 눌러 칸을 벗어나도 바꾼 이름을 적용한다(Enter·Esc 로 끝낸 뒤에는 건너뛴다)
                      onBlur={() => {
                        if (skipRenameBlurRef.current) {
                          skipRenameBlurRef.current = false
                          return
                        }
                        void finishRenaming(node.path)
                      }}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          event.preventDefault()
                          skipRenameBlurRef.current = true
                          void finishRenaming(node.path)
                        } else if (event.key === 'Escape') {
                          event.preventDefault()
                          skipRenameBlurRef.current = true
                          setEditingEntryId(null)
                          setRenameError(null)
                        }
                      }}
                    />
                  </div>
                ) : (
                  <>
                  <div className={versionGroup === undefined ? 'side-version-line-plain' : `side-version-line${versionGroup.versions.some((version) => openDocIds.includes(version.docId)) ? ' side-version-line-open' : ''}${versionGroup.versions.some((version) => version.docId === activeDocId) ? ' side-version-line-active' : ''}`}>
                  <button
                    type="button"
                    className={`side-item side-tree-item side-markdown-item${openDocIds.includes(node.path) || openDocIds.includes(node.indexId) || (versionGroup !== undefined && versionGroup.versions.some((version) => openDocIds.includes(version.docId))) ? ' side-item-open' : ''}${activeDocId !== null && (activeDocId === node.path || activeDocId === node.indexId || (versionGroup !== undefined && versionGroup.versions.some((version) => version.docId === activeDocId))) ? ' side-item-active' : ''}`}
                    aria-label={versionGroup === undefined ? `${node.name}, Markdown` : `${versionGroup.title} ${defaultVersion(versionGroup).label}`}
                    disabled={onOpenMarkdown === undefined}
                    onClick={(event) => {
                      if (selectClick(event, node.id, section)) return
                      // 묶음 줄은 기본 판을 연다
                      if (versionGroup !== undefined && versionActions !== undefined && defaultVersion(versionGroup).docId !== node.indexId) versionActions.onOpen(defaultVersion(versionGroup).docId)
                      else onOpenMarkdown?.(node)
                    }}
                    onDoubleClick={(event) => {
                      event.preventDefault()
                      event.stopPropagation()
                      startRenaming(node.path, versionGroup?.title ?? node.name)
                    }}
                    onContextMenu={(event) => openEntryMenu(event, node, parentPath)}
                  >
                    <ItemEmoji emoji={itemIcons[iconKeyFor(node)]} onPick={pickIcon(iconKeyFor(node))} fallback={<FileMd className="side-file-icon side-file-icon-md" size={14} aria-hidden="true" />} />
                    <span className={`side-dot${openDocIds.includes(node.path) ? ' side-dot-open' : ''}`} aria-hidden="true" />
                    {docRowTitle(node.name, versionGroup)}
                  </button>
                  {versionGroup === undefined ? null : docCaret(versionGroup, undefined, versionGroup.title)}
                  </div>
                  {docChildren(versionGroup, undefined, depth)}
                  </>
                )
              )}
              {node.kind === 'folder' && editingEntryId === node.id && renameError !== null && (
                <span className="side-inline-rename-error" role="alert">{renameError}</span>
              )}
              {node.kind !== 'folder' && node.kind !== 'pdf' && editingEntryId === node.path && renameError !== null && (
                <span className="side-inline-rename-error" role="alert">{renameError}</span>
              )}
              {node.kind === 'folder' && (section === 'notes' ? onCreateNote : onCreateFolder) !== undefined ? (
                <button
                  type="button"
                  className="side-tree-add"
                  aria-label={section === 'notes' ? t('{name}에 새 노트', { name: node.name }) : t('{name}에 새 하위 폴더', { name: node.name })}
                  title={section === 'notes' ? t('새 노트') : t('새 하위 폴더')}
                  onClick={(event) => {
                    event.stopPropagation()
                    startDraft(section === 'notes' ? 'note' : 'folder', section, node.path)
                  }}
                >
                  <Plus size={12} weight="bold" aria-hidden="true" />
                </button>
              ) : null}
            </div>
            {node.kind === 'folder' && versionGroup !== undefined ? docChildren(versionGroup, undefined, depth) : null}
            {node.kind === 'folder' && shownFolder.kind === 'folder' && (open || (draft !== null && draft.section === section && draft.parentPath === shownFolder.path))
              && renderTree(shownFolder.children, shownFolder.path, depth + 1, section)}
          </li>
        )
      })}
    </ul>
  )



  // 문서 머리 단추(라이브러리·폴더 펼치기·새로고침·가져오기·새 폴더·문서 추가). 「문서」 제목 줄 오른쪽에 단다
  const headActions = (
    <>
          {showVaultSearch ? <VaultSearch
            compact
            records={searchRecords}
            onOpen={(hit) => onOpenSearchResult?.(hit)}
            onFavoriteChange={onFavoriteChange}
            indexingProgress={searchIndexProgress}
          /> : null}
          {onToggleLibrary !== undefined ? (
            <button
              type="button"
              className="side-top-action"
              aria-label={libraryExpanded ? t('라이브러리 접기') : t('라이브러리 펼치기')}
              title={`${libraryExpanded ? t('라이브러리 접기') : t('라이브러리 펼치기')} (Ctrl+Shift+L)`}
              aria-pressed={libraryExpanded}
              onClick={onToggleLibrary}
            >
              {libraryExpanded
                ? <ArrowsInLineHorizontal size={16} aria-hidden="true" />
                : <ArrowsOutLineHorizontal size={16} aria-hidden="true" />}
            </button>
          ) : null}
          {allFolderKeys.length === 0 ? null : (
            <button
              type="button"
              className="side-top-action"
              aria-label={allFoldersCollapsed ? t('모든 폴더 펼치기') : t('모든 폴더 접기')}
              title={allFoldersCollapsed ? t('모든 폴더 펼치기') : t('모든 폴더 접기')}
              onClick={toggleAllFolders}
            >
              {allFoldersCollapsed
                ? <ArrowsOutLineVertical size={16} aria-hidden="true" />
                : <ArrowsInLineVertical size={16} aria-hidden="true" />}
            </button>
          )}
          {onRefresh === undefined ? null : (
            <button
              type="button"
              className={`side-top-action${refreshing ? ' side-top-action-spinning' : ''}`}
              aria-label={t('새로고침')}
              title={t('새로고침')}
              disabled={refreshing}
              onClick={() => {
                setRefreshing(true)
                void onRefresh().finally(() => setRefreshing(false))
              }}
            >
              <ArrowClockwise size={16} aria-hidden="true" />
            </button>
          )}
          {onGithubImport === undefined ? null : (
            <button type="button" className="side-top-action" aria-label={t('GitHub에서 가져오기')} title={t('GitHub에서 가져오기')} onClick={onGithubImport}>
              <GithubLogo size={16} aria-hidden="true" />
            </button>
          )}
          {onCreateFolder === undefined ? null : (
            <button
              type="button"
              className="side-top-action"
              aria-label={t('새 폴더')}
              title={t('새 폴더')}
              aria-haspopup="dialog"
              // 맨 위 단추는 늘 Vault 맨 위에 만든다. 폴더 안에는 그 폴더 줄의 + 로 만든다
              onClick={() => startDraft('folder', 'documents', '')}
            >
              <FolderPlus size={16} aria-hidden="true" />
            </button>
          )}
          <div className="side-attach-wrap side-top-attach-wrap">
            <button
              type="button"
              className="side-top-action"
              aria-label={t('문서 추가')}
              title={t('문서 추가')}
              aria-expanded={attachmentMenuOpen}
              onClick={() => setAttachmentMenuOpen((open) => !open)}
            >
              <FilePlus size={16} aria-hidden="true" />
            </button>
          </div>
    </>
  )
  return (
    <nav
      ref={sidebarRef}
      className="sidebar-inner"
      style={{ '--bar-zoom': leftZoom } as CSSProperties}
      onKeyDown={(event) => {
        // 메뉴·이름 바꾸기가 열려 있을 때의 Escape 는 그것만 닫는다.
        // 라이브러리 모드를 접는 앱 단축키까지 가면 정리하던 화면이 사라진다.
        if (event.key !== 'Escape') return
        if (selectedNodes.size > 0 && contextMenu === null && editingEntryId === null) {
          event.preventDefault()
          event.stopPropagation()
          setSelectedNodes(new Set())
          return
        }
        if (contextMenu === null && recentMenu === null && editingEntryId === null && !attachmentMenuOpen) return
        event.preventDefault()
        event.stopPropagation()
        setContextMenu(null)
        setRecentMenu(null)
        setAttachmentMenuOpen(false)
      }}
    >
      {versionMenu !== null && versionActions !== undefined ? (
        <>
          <div className="side-menu-backdrop" onClick={() => setVersionMenu(null)} onContextMenu={(event) => { event.preventDefault(); setVersionMenu(null) }} />
          <div className="side-context-menu" role="menu" aria-label={t('{label} 버전 작업', { label: versionMenu.label })} style={{ left: versionMenu.x, top: versionMenu.y }}>
            <button type="button" role="menuitem" onClick={() => { versionActions.onOpen(versionMenu.docId); setVersionMenu(null) }}>
              <span className="side-context-icon" aria-hidden="true"><ArrowSquareOut size={15} /></span><span className="side-context-label">{t('이 버전 열기')}</span>
            </button>
            <button type="button" role="menuitem" onClick={() => { setRenamingVersion({ docId: versionMenu.docId, value: versionMenu.label }); setVersionMenu(null) }}>
              <span className="side-context-icon" aria-hidden="true"><PencilSimple size={15} /></span><span className="side-context-label">{t('버전 이름 바꾸기')}</span>
            </button>
            <hr className="side-context-sep" />
            <button type="button" role="menuitem" onClick={() => { versionActions.onRemove(versionMenu.docId); setVersionMenu(null) }}>
              <span className="side-context-icon" aria-hidden="true"><Stack size={15} /></span><span className="side-context-label">{t('이 버전을 묶음에서 빼기')}</span>
            </button>
          </div>
        </>
      ) : null}
      {versionDrag !== null ? (
        <div className={`side-version-drag-ghost${versionDrag.outside ? ' side-version-drag-ghost-out' : ''}`} style={{ left: versionDrag.x + 12, top: versionDrag.y + 8 }} aria-hidden="true">
          {versionDrag.outside ? t('놓으면 묶음에서 빼기') : t('묶음 밖으로 끌어 놓기')}
        </div>
      ) : null}
      {documentDropActive ? (
        // 목록을 가리지 않는다 — 어느 폴더 위인지 보이고, 그 폴더가 칠해진다
        <div className="side-document-drop-target" role="status">
          <span className="side-document-drop-banner">
            {documentDropFolder === null || documentDropFolder === ''
              ? documentDropPlace === null
                ? t('놓으면 Vault 에 복사 · 줄 사이에 놓으면 그 자리, 폴더 위면 그 폴더 안')
                : t('놓으면 Vault 맨 위의 선 자리에 복사')
              : documentDropPlace === null || documentDropPlace.position === 'inside'
                ? t('놓으면 「{folder}」 폴더에 복사', { folder: documentDropFolder.split('/').at(-1) ?? documentDropFolder })
                : t('놓으면 「{folder}」 폴더의 선 자리에 복사', { folder: documentDropFolder.split('/').at(-1) ?? documentDropFolder })}
          </span>
        </div>
      ) : null}
      <div ref={sideScrollRef} className={`side-scroll${swapping ? ' side-scroll-swapping' : ''}`}>
        {libraryExpanded ? (
          <LibraryView
            navHost={navHost}
            tableHost={libraryHost}
            tree={workspaceTree}
            records={searchRecords}
            itemIcons={itemIcons}
            bibliography={bibliography}
            onOpenItem={(target) => onOpenLibraryItem?.(target)}
            onMoveEntry={onMoveEntry}
            onItemContextMenu={openLibraryItemMenu}
            onFolderContextMenu={(event, folder: LibraryFolder) => openFolderMenu(event, folder)}
            onRenameItem={onRenameEntry}
            onUpdateBibliography={onUpdateBibliography}
            onPickIcon={onItemIconChange === undefined ? undefined : (key, x, y) => setEmojiTarget({ key, x, y })}
            externalDropFolder={documentDropActive ? documentDropFolder : null}
            folderEdit={editingEntryId?.startsWith('folder:') === true
              ? { kind: 'rename', path: editingEntryId.slice('folder:'.length), name: editingName }
              : draft?.kind === 'folder' ? { kind: 'create', parentPath: draft.parentPath } : null}
            onFolderEditCommit={(value) => void commitLibraryFolderEdit(value)}
            onFolderEditCancel={() => {
              setEditingEntryId(null)
              setDraft(null)
            }}
            onStartFolderRename={onRenameFolder === undefined ? undefined : (folder) => startFolderRenaming({ id: `folder:${folder.path}`, name: folder.name })}
            renameRequest={libraryRenameRequest}
          />
        ) : null}
        {(
        <>
        <section className={`side-section side-documents-section${sectionDropClass('documents')}`} aria-labelledby="side-documents-heading" {...sectionDropProps('documents')}>
          <div className="side-head-row side-documents-head">
            <h2 id="side-documents-heading" className="side-head"><Books className="side-section-icon" size={15} aria-hidden="true" />{t('문서')}</h2>
            {headActions}
          </div>
          {libraryExpanded
            // 펼친 동안 문서 트리 자리에 라이브러리 모음·폴더 목록이 들어온다(LibraryView 가 이 자리에 그린다)
            ? <div ref={setNavHost} className="library-nav-host" />
            : projectedTree.documents.length > 0 || draft?.section === 'documents'
            ? renderTree(projectedTree.documents, '', 0, 'documents')
            : <p className="side-section-empty">{t('문서가 없습니다 · PDF·Markdown 을 끌어 넣으세요')}</p>}
        </section>

        {memoNotes !== undefined && !libraryExpanded ? (
          <MemoNotesSection
            {...memoNotes}
            entries={noteGroups.general}
            icons={itemIcons}
            onPickIcon={onItemIconChange === undefined ? undefined : (key, x, y) => setEmojiTarget({ key, x, y })}
            onClearIcon={onItemIconChange === undefined ? undefined : (key) => onItemIconChange(key, null)}
            colors={itemColors}
            onColorChange={onItemColorChange}
            expandedStorageKey={`iwae.sidebar.memo-expanded:${vaultRoot ?? ''}`}
          />
        ) : null}
        {showNotes && !libraryExpanded ? (
        <section className={`side-section side-notes-section${sectionDropClass('notes')}`} aria-labelledby="side-notes-heading" {...sectionDropProps('notes')}>
          <div className="side-head-row side-notebook-head">
            <h2 id="side-notes-heading" className="side-head"><Notebook className="side-section-icon" size={15} aria-hidden="true" />{t('노트')}</h2>
            <button type="button" className="side-add" onClick={() => startDraft('note', 'notes', '')}>
              {t('새 노트')}
            </button>
          </div>
          {projectedTree.notes.length > 0 || draft?.section === 'notes'
            ? renderTree(projectedTree.notes, '', 0, 'notes')
            : <p className="side-section-empty">{t('노트가 없습니다')}</p>}
        </section>
        ) : null}
        </>
        )}
        <p className="side-reorder-status" aria-live="polite">{reorderAnnouncement}</p>
        {actionError !== null && <p className="side-action-error" role="alert">{actionError}</p>}
      </div>

      {contextMenu !== null && (() => {
        const close = () => setContextMenu(null)
        const mac = isMacPlatform()
        const revealLabel = mac ? t('Finder 에서 보기') : t('탐색기에서 보기')
        const isEntry = contextMenu.kind === 'entry'
        const isFolder = contextMenu.kind === 'folder'
        const item = (key: string, icon: ReactNode, label: string, onClick: () => void, danger = false) => (
          <button key={key} type="button" role="menuitem" className={danger ? 'side-context-danger' : undefined} onClick={onClick}>
            <span className="side-context-icon" aria-hidden="true">{icon}</span>
            <span className="side-context-label">{label}</span>
          </button>
        )
        const docId = contextMenu.versionDocId
        const versionGroup = docId === undefined ? undefined : Object.values(versionGroups ?? {}).find((group) => group.versions.some((version) => version.docId === docId))
        const sourceCount = sourceCounts?.[contextMenu.id] ?? 0
        const folderFullPath = isFolder && vaultRoot !== undefined
          ? [vaultRoot.replace(/[\\/]+$/u, ''), ...contextMenu.id.split('/')].join(vaultRoot.includes('\\') ? '\\' : '/')
          : undefined
        // 묶음마다 선을 긋는다. 빈 묶음은 건너뛴다
        const groups: ReactNode[][] = [
          // GitHub 에서 가져온 폴더
          isFolder && onGithubAction !== undefined && githubSources?.get(contextMenu.id) !== undefined ? (() => {
            const source = githubSources.get(contextMenu.id)!
            const act = (action: 'fetch' | 'pull' | 'versions' | 'open') => () => { close(); onGithubAction(action, source.name) }
            return [
              item('gh-fetch', <ArrowClockwise size={15} />, t('새 소식 확인'), act('fetch')),
              item('gh-pull', <DownloadSimple size={15} />, source.behind > 0 ? t('최신으로 (새 커밋 {count}개)', { count: source.behind }) : t('최신으로'), act('pull')),
              item('gh-versions', <GitBranch size={15} />, t('다른 버전 보기…'), act('versions')),
              item('gh-open', <GithubLogo size={15} />, t('GitHub에서 열기'), act('open')),
            ]
          })() : [],
          // 만들기
          isFolder && onCreateFolder !== undefined ? [
            item('new-folder', <FolderPlus size={15} />, t('새 하위 폴더…'), () => { startDraft('folder', sectionOfFolder(contextMenu.id), contextMenu.id); close() }),
          ] : [],
          // 정리: 이름·이모지·색·즐겨찾기·복제
          [
            isFolder && onRenameFolder !== undefined
              ? item('rename', <PencilSimple size={15} />, t('이름 바꾸기'), () => { startFolderRenaming({ id: `folder:${contextMenu.id}`, name: contextMenu.name }); close() })
              : null,
            isEntry && onRenameEntry !== undefined
              ? item('rename', <PencilSimple size={15} />, t('이름 바꾸기'), () => {
                  // 펼친 라이브러리에서는 표의 이름 칸을 그 자리에서 고친다
                  if (libraryExpanded) setLibraryRenameRequest({ id: contextMenu.id, nonce: Date.now() })
                  else startRenaming(contextMenu.id, contextMenu.name)
                  close()
                })
              : null,
            onItemIconChange !== undefined
              ? item('emoji', <Smiley size={15} />, itemIcons[contextMenu.iconKey] === undefined ? t('이모지 설정…') : t('이모지 바꾸기…'), () => { setEmojiTarget({ key: contextMenu.iconKey, x: contextMenu.x, y: contextMenu.y }); close() })
              : null,
            onItemIconChange !== undefined && itemIcons[contextMenu.iconKey] !== undefined
              ? item('emoji-clear', <Eraser size={15} />, t('이모지 지우기'), () => void runEntryAction(() => onItemIconChange(contextMenu.iconKey, null)))
              : null,
            onItemColorChange !== undefined && contextMenu.iconKey.startsWith('folder:') ? (
              <div key="colors" className="side-color-row" role="group" aria-label={t('폴더 색')}>
                {FOLDER_COLORS.map((color) => (
                  <button
                    key={color.id}
                    type="button"
                    role="menuitemradio"
                    aria-checked={itemColors[contextMenu.iconKey] === color.id}
                    aria-label={t('폴더 색 {color}', { color: t(color.label) })}
                    title={t(color.label)}
                    className="side-color-swatch"
                    style={{ background: color.hex }}
                    onClick={() => void runEntryAction(() => onItemColorChange(contextMenu.iconKey, color.id))}
                  />
                ))}
                <button
                  type="button"
                  role="menuitemradio"
                  aria-checked={itemColors[contextMenu.iconKey] === undefined}
                  aria-label={t('폴더 색 없음')}
                  title={t('색 없음')}
                  className="side-color-swatch side-color-none"
                  onClick={() => void runEntryAction(() => onItemColorChange(contextMenu.iconKey, null))}
                />
              </div>
            ) : null,
            isEntry && onFavoriteChange !== undefined
              ? item('favorite', <Star size={15} weight={contextMenu.favorite ? 'fill' : 'regular'} />, contextMenu.favorite ? t('즐겨찾기 해제') : t('즐겨찾기 추가'), () => void runEntryAction(() => onFavoriteChange(contextMenu.id, !contextMenu.favorite)))
              : null,
            isEntry && onDuplicateEntry !== undefined
              ? item('duplicate', <CopySimple size={15} />, t('복제'), () => void runEntryAction(() => onDuplicateEntry(contextMenu.id, contextMenu.parentPath)))
              : null,
          ].filter((node): node is ReactElement => node !== null),
          // 문헌: 서지·출처
          [
            contextMenu.pdf && onEditBibliography !== undefined
              ? item('bib', <BookOpenText size={15} />, t('논문 정보…'), () => void runEntryAction(() => onEditBibliography(contextMenu.id)))
              : null,
            contextMenu.pdf && onCopyBibtex !== undefined
              ? item('bibtex', <Quotes size={15} />, t('인용 정보 복사 (BibTeX)'), () => void runEntryAction(() => onCopyBibtex(contextMenu.id)))
              : null,
            isEntry && contextMenu.pdf && onOpenFirstSource !== undefined && sourceCount > 0
              ? item('source-open', <LinkSimple size={15} />, t('원본 열기'), () => { onOpenFirstSource(contextMenu.id); close() })
              : null,
            isEntry && contextMenu.pdf && onOpenSources !== undefined
              ? item('sources', <ListBullets size={15} />, `${t('원본 출처…')}${sourceCount > 0 ? ` (${sourceCount})` : ''}`, () => { onOpenSources(contextMenu.id); close() })
              : null,
          ].filter((node): node is ReactElement => node !== null),
          // 도구: 검색 사본·판 관리·Vault 로 복사
          [
            contextMenu.pdf && memoNotes?.onCreateForDoc !== undefined && contextMenu.versionDocId !== undefined && !missingDocIds.includes(contextMenu.versionDocId)
              ? item('doc-note-new', <NotePencil size={15} />, t('이 PDF에 노트 만들기'), () => {
                  const target = contextMenu.versionDocId!
                  const group = Object.values(versionGroups ?? {}).find((candidate) => candidate.versions.some((version) => version.docId === target))
                  setExpandedVersionGroups((current) => new Set([...current, childKeyOf(group, target)]))
                  memoNotes.onCreateForDoc?.(target)
                  close()
                })
              : null,
            contextMenu.pdf && onOpenPdfTools !== undefined
              ? item('pdf-tools', <Toolbox size={15} />, t('PDF 도구…'), () => { onOpenPdfTools(contextMenu.id); close() })
              : null,
            docId !== undefined && versionGroup === undefined && onStartVersions !== undefined
              ? item('versions-start', <Stack size={15} />, t('버전 관리 시작'), () => { onStartVersions(docId); close() })
              : null,
            docId !== undefined && onStackRequest !== undefined
              ? item('versions-stack', <Stack size={15} />, versionGroup === undefined ? t('다른 파일과 버전으로 묶기…') : t('이 묶음에 버전 추가…'), () => { onStackRequest(docId); close() })
              : null,
            versionGroup !== undefined && versionActions !== undefined
              ? item('versions-end', <Stack size={15} />, t('버전 묶음 풀기 (파일은 그대로)'), () => { versionActions.onDissolve(versionGroup.id); close() })
              : null,
            isEntry && contextMenu.storage === 'reference' && onConvertEntryToCopy !== undefined
              ? item('to-vault', <DownloadSimple size={15} />, t('Vault에 복사'), () => void runEntryAction(() => onConvertEntryToCopy(contextMenu.id, contextMenu.parentPath)))
              : null,
          ].filter((node): node is ReactElement => node !== null),
          // 위치: 탐색기에서 보기·경로 복사
          [
            isFolder && onRevealFolder !== undefined
              ? item('reveal', <ArrowSquareOut size={15} />, revealLabel, () => void runEntryAction(() => onRevealFolder(contextMenu.id)))
              : null,
            isEntry && onRevealEntry !== undefined
              ? item('reveal', <ArrowSquareOut size={15} />, revealLabel, () => void runEntryAction(() => onRevealEntry(contextMenu.id)))
              : null,
            isEntry && onCopyEntryPath !== undefined
              ? item('copy-path', <ClipboardText size={15} />, t('경로 복사'), () => void runEntryAction(async () => {
                  const path = await onCopyEntryPath(contextMenu.id)
                  await navigator.clipboard.writeText(path)
                  announceAction(t('경로를 복사했습니다'))
                }))
              : null,
            folderFullPath !== undefined
              ? item('copy-path', <ClipboardText size={15} />, t('경로 복사'), () => void runEntryAction(async () => {
                  await navigator.clipboard.writeText(folderFullPath)
                  announceAction(t('경로를 복사했습니다'))
                }))
              : null,
          ].filter((node): node is ReactElement => node !== null),
          // 지우기(휴지통으로)
          [
            isEntry && onTrashEntry !== undefined
              ? item('trash', <Trash size={15} />, t('휴지통으로 이동'), () => void runEntryAction(() => onTrashEntry(contextMenu.id)), true)
              : null,
            isFolder && onTrashFolder !== undefined
              ? item('trash', <Trash size={15} />, t('휴지통으로 이동…'), () => { setDeleteFolderTarget({ path: contextMenu.id, name: contextMenu.name }); close() }, true)
              : null,
          ].filter((node): node is ReactElement => node !== null),
        ].filter((group) => group.length > 0)
        return (
          <>
            <div className="side-menu-backdrop" onClick={close} />
            <div
              className="side-context-menu"
              role="menu"
              tabIndex={-1}
              aria-label={t('{name} 작업', { name: contextMenu.name })}
              style={{ left: contextMenu.x, top: contextMenu.y }}
              // 창 아래·오른쪽 끝에서 열면 메뉴가 창 밖으로 나간다. 창 안으로 들어오게 옮긴다. 열리면 첫 항목에 초점을 둔다(Escape·화살표가 듣게)
              ref={(element) => {
                if (element === null) return
                const rect = element.getBoundingClientRect()
                if (rect.bottom > window.innerHeight - 8) element.style.top = `${Math.max(8, window.innerHeight - rect.height - 8)}px`
                if (rect.right > window.innerWidth - 8) element.style.left = `${Math.max(8, window.innerWidth - rect.width - 8)}px`
                // 첫 항목이 아니라 메뉴 틀에 초점(앞서 키보드를 썼으면 첫 항목이 열자마자 칠해진다). ↓ 를 누르면 첫 항목부터
                if (!element.contains(document.activeElement)) element.focus({ preventScroll: true })
              }}
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  event.preventDefault()
                  event.stopPropagation()
                  close()
                  return
                }
                const items = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role=menuitem]'))
                const index = items.indexOf(document.activeElement as HTMLButtonElement)
                const next = event.key === 'ArrowDown' ? (index + 1) % items.length
                  : event.key === 'ArrowUp' ? (index <= 0 ? items.length - 1 : index - 1)
                    : event.key === 'Home' ? 0
                      : event.key === 'End' ? items.length - 1
                        : null
                if (next === null || items.length === 0) return
                event.preventDefault()
                items[next]?.focus()
              }}
            >
              {groups.map((group, index) => (
                <Fragment key={index}>
                  {index === 0 ? null : <div className="side-context-sep" role="separator" />}
                  {group}
                </Fragment>
              ))}
            </div>
          </>
        )
      })()}

      {attachmentMenuOpen ? (
        <AddPdfDialog
          currentFolder={activeFolderPath}
          folderChoices={folderPaths}
          onChoose={(choice) => onAddDoc(choice)}
          onClose={() => setAttachmentMenuOpen(false)}
        />
      ) : null}
      {folderDialog?.mode === 'rename' ? (
        <FolderNameDialog
          mode="rename"
          initialName={folderDialog.name}
          parentPath={parentOf(folderDialog.path)}
          onSubmit={async (_parent, name) => {
            await onRenameFolder?.(folderDialog.path, name)
          }}
          onClose={() => setFolderDialog(null)}
        />
      ) : null}
      {deleteFolderTarget !== null ? (
        <DeleteFolderDialog
          name={deleteFolderTarget.name}
          path={parentOf(deleteFolderTarget.path)}
          {...(() => {
            const counts = countFolderContents(findFolder(workspaceTree, deleteFolderTarget.path)?.children ?? [])
            return { documentCount: counts.documents, folderCount: counts.folders }
          })()}
          onConfirm={async () => {
            await onTrashFolder?.(deleteFolderTarget.path)
            const removed = deleteFolderTarget.path
            if (activeFolderPath === removed || activeFolderPath.startsWith(`${removed}/`)) setActiveFolderPath(parentOf(removed))
            if (attachmentFolderPath === removed || attachmentFolderPath.startsWith(`${removed}/`)) setAttachmentFolderPath('')
          }}
          onClose={() => setDeleteFolderTarget(null)}
        />
      ) : null}

      {emojiTarget !== null && onItemIconChange !== undefined ? (
        <Suspense fallback={null}>
          <LazyEmojiPicker
            anchor={emojiTarget}
            current={itemIcons[emojiTarget.key]}
            onSelect={(emoji) => {
              onItemIconChange(emojiTarget.key, emoji)
              setEmojiTarget(null)
            }}
            onRemove={() => {
              onItemIconChange(emojiTarget.key, null)
              setEmojiTarget(null)
            }}
            onClose={() => setEmojiTarget(null)}
          />
        </Suspense>
      ) : null}

      {recentPdfs.length > 0 && onOpenRecentPdf !== undefined ? (
        <section className="side-recent" aria-label={t('최근 연 PDF')}>
          <h3 className="side-recent-title">{t('최근 연 PDF')}</h3>
          <ul>
            {recentPdfs.map((recent) => (
              <li key={recent.path} onPointerDown={(event) => startRecentDrag(event, recent)}>
                <button
                  type="button"
                  className="side-recent-item"
                  title={recent.path}
                  onClick={() => onOpenRecentPdf(recent.path)}
                  onContextMenu={(event) => {
                    event.preventDefault()
                    setRecentMenu({ recent, x: event.clientX, y: event.clientY })
                  }}
                >
                  <FilePdf className="side-file-icon" size={14} aria-hidden="true" />
                  <span className="side-item-title">{recent.title}</span>
                  <span className="side-recent-date">{recentPdfDate(recent.openedAt)}</span>
                </button>
                {onForgetRecentPdf !== undefined ? (
                  <button type="button" className="side-recent-forget" aria-label={t('{title} 목록에서 빼기', { title: recent.title })} title={t('목록에서 빼기')} onClick={() => onForgetRecentPdf(recent.path)}>
                    <X size={12} aria-hidden="true" />
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {recentMenu !== null && onOpenRecentPdf !== undefined ? (
        <>
          <div className="side-menu-backdrop" onClick={() => setRecentMenu(null)} />
          <div
            className="side-context-menu"
            role="menu"
            aria-label={t('{name} 작업', { name: recentMenu.recent.title })}
            style={{ left: recentMenu.x, top: recentMenu.y }}
            ref={(element) => {
              if (element === null) return
              const rect = element.getBoundingClientRect()
              if (rect.bottom > window.innerHeight - 8) element.style.top = `${Math.max(8, window.innerHeight - rect.height - 8)}px`
              if (rect.right > window.innerWidth - 8) element.style.left = `${Math.max(8, window.innerWidth - rect.width - 8)}px`
            }}
          >
            <button type="button" role="menuitem" onClick={() => {
              onOpenRecentPdf(recentMenu.recent.path)
              setRecentMenu(null)
            }}>{t('열기')}</button>
            {onRevealRecentPdf !== undefined ? (
              <button type="button" role="menuitem" onClick={() => {
                onRevealRecentPdf(recentMenu.recent.path)
                setRecentMenu(null)
              }}>{t('폴더 열기')}</button>
            ) : null}
            <button type="button" role="menuitem" onClick={() => void runEntryAction(() => navigator.clipboard.writeText(recentMenu.recent.path)).then(() => setRecentMenu(null))}>
              {t('경로 복사')}
            </button>
            {onForgetRecentPdf !== undefined ? (
              <>
                <hr className="side-context-sep" />
                <button type="button" role="menuitem" onClick={() => {
                  onForgetRecentPdf(recentMenu.recent.path)
                  setRecentMenu(null)
                }}>{t('목록에서 빼기')}</button>
              </>
            ) : null}
          </div>
        </>
      ) : null}

      <SidebarFooter
        vaultRoot={vaultRoot}
        recentVaultPaths={recentVaultPaths}
        onSwitchVault={onSwitchVault}
        onOpenRecentVault={onOpenRecentVault}
        onOpenSettings={onOpenSettings}
      />
    </nav>
  )
}

/**
 * 왼쪽 바 바닥 줄: 왼쪽은 지금 Vault(누르면 Vault 메뉴), 오른쪽은 설정.
 * 탐색기뿐 아니라 목차·미리보기·검색 보기에서도 같은 자리에 둔다
 */
export function SidebarFooter({ vaultRoot, recentVaultPaths, onSwitchVault, onOpenRecentVault, onOpenSettings }: {
  readonly vaultRoot?: string | undefined
  readonly recentVaultPaths: readonly string[]
  /** 시작 화면으로(지금 Vault 닫기) */
  readonly onSwitchVault?: (() => void) | undefined
  /** 경로로 Vault 열기(최근 목록·고른 폴더·예시 Vault) */
  readonly onOpenRecentVault?: ((root: string) => void) | undefined
  readonly onOpenSettings?: (() => void) | undefined
}) {
  const [open, setOpen] = useState(false)
  const [forgotten, setForgotten] = useState<readonly string[]>([])
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (!open) return
    const escape = (event: globalThis.KeyboardEvent) => { if (event.key === 'Escape') setOpen(false) }
    window.addEventListener('keydown', escape)
    return () => window.removeEventListener('keydown', escape)
  }, [open])
  const sameVault = (a: string, b: string | null | undefined) => b != null && shownPath(a).toLowerCase() === shownPath(b).toLowerCase()
  const others = recentVaultPaths.filter((root, index, all) => !sameVault(root, vaultRoot) && !forgotten.includes(root) && all.findIndex((other) => sameVault(other, root)) === index)
  const close = () => setOpen(false)
  const run = (action: () => Promise<void>) => {
    setBusy(true)
    void action()
      .catch((cause: unknown) => window.alert(errorText(cause)))
      .finally(() => setBusy(false))
  }
  const mac = isMacPlatform()
  return (
    <div className="side-footer">
      <button
        type="button"
        className={`side-vault-btn${open ? ' side-vault-btn-open' : ''}`}
        title={vaultRoot}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((shown) => !shown)}
      >
        <Folder size={14} aria-hidden="true" />
        {/* 폴더 이름만 보인다. 전체 경로는 마우스를 올리면, 그리고 메뉴 맨 위에 나온다 */}
        <span className="side-vault-label">{vaultRoot === undefined ? t('폴더를 선택하세요') : vaultFolderName(vaultRoot)}</span>
        <CaretUpDown size={12} className="side-vault-caret" aria-hidden="true" />
      </button>
      {onOpenSettings === undefined ? null : (
        <button type="button" className="side-settings-btn" aria-label={t('설정')} title={t('설정 (Ctrl+,)')} onClick={onOpenSettings}>
          <GearSix size={15} aria-hidden="true" />
        </button>
      )}
      {open && (
        <>
          {/* 바깥을 누르면 닫힌다. 메뉴 자체보다 먼저 그려서 z-index 로만 가른다 */}
          <div className="side-menu-backdrop" onClick={close} />
          <div className="vault-menu" role="menu" aria-label={t('Vault 메뉴')}>
            {vaultRoot === undefined ? null : (
              <div className="vault-menu-current">
                <Folder size={18} weight="fill" className="vault-menu-current-icon" aria-hidden="true" />
                <div className="vault-menu-current-text">
                  <strong>{vaultFolderName(vaultRoot)}</strong>
                  <small>{shownPath(vaultRoot)}</small>
                </div>
                <div className="vault-menu-current-tools">
                  <button
                    type="button"
                    className="vault-menu-icon-btn"
                    aria-label={mac ? t('Finder 에서 보기') : t('탐색기에서 보기')}
                    title={mac ? t('Finder 에서 보기') : t('탐색기에서 보기')}
                    onClick={() => run(() => revealInFolder(vaultRoot))}
                  >
                    <ArrowSquareOut size={15} aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    className="vault-menu-icon-btn"
                    aria-label={t('경로 복사')}
                    title={t('경로 복사')}
                    onClick={() => run(async () => {
                      await navigator.clipboard.writeText(vaultRoot)
                      announceAction(t('경로를 복사했습니다'))
                    })}
                  >
                    <Copy size={15} aria-hidden="true" />
                  </button>
                </div>
              </div>
            )}
            <div className="vault-menu-actions">
              <button
                type="button"
                role="menuitem"
                className="vault-menu-item"
                disabled={busy}
                onClick={() => run(async () => {
                  const root = await pickVaultFolder(vaultRoot)
                  if (root === null) return
                  close()
                  onOpenRecentVault?.(root)
                })}
              >
                <FolderOpen size={16} aria-hidden="true" />
                <span>{t('다른 폴더 열기…')}</span>
              </button>
              <button
                type="button"
                role="menuitem"
                className="vault-menu-item"
                disabled={busy}
                onClick={() => run(async () => {
                  const root = await createExampleVaultFolder(t('IWAE 예시'))
                  close()
                  onOpenRecentVault?.(root)
                })}
              >
                <Sparkle size={16} aria-hidden="true" />
                <span>{t('예시 Vault 만들기')}</span>
              </button>
              {onSwitchVault === undefined ? null : (
                <button type="button" role="menuitem" className="vault-menu-item" disabled={busy} onClick={() => { close(); onSwitchVault() }}>
                  <House size={16} aria-hidden="true" />
                  <span>{t('시작 화면으로')}</span>
                </button>
              )}
            </div>
            <div className="vault-menu-recent">
              <div className="vault-menu-heading">{t('최근 Vault')}</div>
              {others.length === 0 ? <div className="vault-menu-empty">{t('최근에 연 다른 Vault 가 없습니다')}</div> : (
                <ul>
                  {others.map((root) => (
                    <li key={root}>
                      <button
                        type="button"
                        role="menuitem"
                        className="vault-menu-recent-open"
                        title={root}
                        disabled={busy}
                        onClick={() => { close(); onOpenRecentVault?.(root) }}
                      >
                        <Folder size={15} aria-hidden="true" />
                        <span>
                          <strong>{vaultFolderName(root)}</strong>
                          <small>{shownPath(root)}</small>
                        </span>
                      </button>
                      <button
                        type="button"
                        className="vault-menu-recent-remove"
                        aria-label={t('{name} 를 목록에서 빼기', { name: vaultFolderName(root) })}
                        title={t('목록에서 빼기 (폴더는 그대로)')}
                        onClick={() => {
                          setForgotten((current) => [...current, root])
                          void forgetVault(root).catch(() => undefined)
                        }}
                      >
                        <X size={12} aria-hidden="true" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}

function readExpandedFolders(key: string): ReadonlySet<string> {
  try {
    const raw = window.localStorage.getItem(key)
    const parsed: unknown = raw === null ? [] : JSON.parse(raw)
    return new Set(Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [])
  } catch {
    return new Set()
  }
}

/** Vault 경로의 마지막 폴더 이름. 드라이브 루트(C:/)처럼 이름이 없으면 경로를 그대로 쓴다 */
export function vaultFolderName(root: string): string {
  return root.split(/[\\/]/u).filter((part) => part !== '').at(-1) ?? root
}

/** 화면에 보일 경로: Windows 에서는 \ 로, macOS 에서는 / 로 맞춘다(저장된 경로는 / 와 \ 가 섞여 있을 수 있다) */
export function shownPath(path: string): string {
  return isMacPlatform() ? path.replace(/\\/gu, '/') : path.replace(/\//gu, '\\')
}
