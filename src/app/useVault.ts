import { getAppPrefs } from './appPrefs'
import { isMarkdownPath } from '../core/markdownPath'
import { emptyVaultSearchTextCache } from '../core/vaultSearchCache'
import type { FolderColor } from '../core/folderColors'
import { seedSampleVaultInto } from './sampleVaultDesktop'
import { addRecentPdf, readRecentPdfs, removeRecentPdf, samePath, writeRecentPdfs, type RecentPdf } from '../core/recentPdfs'
import { CANVAS_ENABLED } from '../core/features'
import { useCallback, useEffect, useMemo, useRef, useState, type SetStateAction } from 'react'
import type {
  LibraryDoc,
  NotebookGroup,
  NotebookNote,
  PdfAttachmentPolicy,
  VaultTreeEntry,
  VaultTreeNode,
  VaultTreeOrder,
  VaultTreePlaceRequest,
  VaultTreeReorderRequest,
  VaultMarkdownNode,
} from '../core/vaultTree'
import { editPdfPages, invalidateDocument, openPdf, pageTextIndex, pickPdfFile, runPdfTool, type PdfDocMeta, type PdfPageEditOp, type PdfToolOp, type PdfToolResult } from '../bridge/pdf'
import {
  attachPdfToLibrary,
  attachMarkdownReference,
  createMarkdownFile,
  createNote,
  isMissingPathError,
  isOwnLatestWrite,
  listVaultTree,
  openVault,
  pickVaultFolder,
  readCanvas,
  readLibrary,
  readMarkdown,
  readPdfBookmarks,
  readPdfHighlights,
  registerUnlistedVaultPdfs,
  loadSessions,
  listSessionNames,
  readSessionNamed,
  removeSessionNamed,
  trashSessionNamed,
  writeSessionsMeta,
  readVaultTreeOrder,
  readVaultIndex,
  readVaultMetadata,
  readVaultSearchTextCache,
  recentVaults,
  rememberVault,
  subscribeVaultFile,
  relinkDocument,
  writeCanvas,
  updateLibraryPageCount,
  writeLibrary,
  writeSessionNamed,
  writeVaultIndex,
  writeVaultTreeOrder,
  writeVaultMetadata,
  writeVaultSearchTextCache,
  type VaultHandle,
  type VaultLibraryEntry,
} from '../bridge/vault'
import type { VaultIndexEntry } from '../core/vaultIndex'
import { partitionDroppedDocumentPaths } from '../core/documentDrop'
import { reconcileLibraryPdfEntries, reconcileMissingVaultPdfs, reconcileVaultIndexFiles, type VaultIndexFile } from '../core/vaultIndex'
import { errorText } from '../core/errorText'
import { t } from '../i18n'
import { folderAccessText, isFolderAccessDenied } from '../core/vaultAccess'
import { adoptLegacyTranslatorFloat, mayAdoptLegacyTranslator } from './translatorPanelState'
import { captureSession, dormantTabsOf, emptySession, parseSession, readLegacyLayoutId, screensFromSession, singleScreenSnapshot, type DormantTabs, type ScreenSnapshot, type ScreensSnapshot, type SessionState } from '../core/session'
import { allScreenPaneIds, screenPaneIds, activeScreenOf, addScreen, blankScreen, breakPane, closeScreen, lastScreenOf, newScreenId, renameScreen, reorderScreen, setZoomed, stepScreen, switchScreen, switchScreenAt, withActiveWorkspace, workspaceOf, type Screen, type ScreensState } from './screens'
import { hasPane, layoutForLegacyId, leaves, newPaneId, paneNode, type LayoutNode } from '../core/layoutTree'
import { memoNoteTitleOf } from '../core/memoNote'
import { findSessionName, removeFromMeta, renameInMeta, emptySessionsMeta, touchSessionMeta, uniqueSessionName, validateSessionName, type SessionSummary, type SessionsMeta } from '../core/sessionNames'
import { allPaneTabs } from './tabs'
import { currentWindowMode, isAppClient, sessionForWindow, type WindowMode } from '../core/windowMode'
import { useSessionClients } from './useSessionClients'
import { mergeRemoteScreens } from './sessionSync'
import type { RunResult } from './sessionSync'
import { MAIN_CLIENT_LETTER } from '../core/clients'
import type { SyncCodec } from '../core/vaultSync'
import { findStaleDocuments } from '../core/staleDocuments'
import {
  buildLegacyWorkspaceTree,
  buildNotebookTree,
  buildVaultWorkspaceTree,
  placeInTreeOrder,
  renameFolderInTreeOrder,
  reorderVaultTreeNode,
  vaultTreeOrder,
} from '../core/vaultTree'
import {
  closeTabEverywhere,
  emptyTabs,
  isDocumentKind,
  mapPaneTabs,
  mapPanes,
  markPreviewTabs,
  moveTabToPane,
  openTabInPanes,
  paneRouteOf,
  type PaneId,
  type PanesState,
  type Tab,
  type TabsState,
} from './tabs'
import { useVaultWatcher } from './useVaultWatcher'
import { type PaneChannel, type PaneChannels } from './workspaceChannels'
import type { TreeWorkspace } from './tabDock'
import {
  convertReferenceToCopy,
  copyVaultEntryPath,
  createVaultFolder,
  duplicateVaultEntry,
  moveVaultEntry,
  moveVaultFolder,
  renameVaultEntry,
  renameVaultFolder,
  trashVaultEntry,
  trashVaultFolder,
  type TrashSource,
} from '../bridge/vaultFiles'
import { githubMoveTarget } from '../bridge/github'
import { markdownToPdf } from '../bridge/pdf'
import { isDesktop } from '../bridge/window'
import { MARKDOWN_AS_PDF, SPLIT_PANES_ENABLED } from '../core/features'
import { markdownPdfHtml, markdownPdfKey } from '../core/markdownPdf'
import { buildSearchRecords, type VaultSearchPage, type VaultSearchRecord } from '../core/vaultSearch'
import {
  parseVaultMetadata,
  recordFileOpened as updateFileOpened,
  setFileFavorite as updateFileFavorite,
  setItemIcon as updateItemIcon,
  setItemColor as updateItemColor,
  setFileReadingPosition,
  setMarkdownTheme as updateMarkdownTheme,
  setNoteOrder as updateNoteOrder,
  type VaultFileActivity,
  type VaultMetadata,
} from '../core/vaultMetadata'
import type { MarkdownThemeId } from '../core/markdownTheme'
import { extractPdfDocumentPages } from '../core/pdfTextExtraction'
import { recognizePdfPageText } from '../pdf/pdfOcrText'
import {
  matchingCachedSearchPages,
  updateVaultSearchTextCache,
} from '../core/vaultSearchCache'

interface UseVaultOptions {
  /** 밖에서 가져온 PDF 의 원래 경로를 문서 출처로 적어 둔다(복사하면 원래 자리 정보가 사라지므로) */
  onImportedFrom?: (docId: string, sourcePath: string) => void
  library?: LibraryDoc[]
  notebooks?: NotebookGroup[]
  openedDocs?: readonly PdfDocMeta[]
  pdfTabs?: TabsState
  noteTabs?: TabsState
  markdownSources?: Readonly<Record<string, string>>
  /** 새로 만든 캔버스를 어디에 열지(문서 창 옆 등). 없으면 캔버스 쪽 패널에 탭으로 연다 */
  openCanvas?: (note: { readonly path: string; readonly title: string }) => void
}

function restoredTabs(
  tabs: readonly Tab[],
  requestedActiveId: string | null,
): TabsState {
  const activeId = requestedActiveId !== null && tabs.some((tab) => tab.id === requestedActiveId)
    ? requestedActiveId
    : tabs[0]?.id ?? null
  return { tabs: [...tabs], activeId }
}

/**
 * 세션의 화면들(화면마다 트리·칸의 탭·보던 탭·색)을 탭 기록으로 되살린다. 어느 칸에도 적히지 않은 탭은 첫 화면의 문서는 첫 칸, 노트는 둘째 칸(없으면 첫 칸)에 둔다.
 * 같은 탭이 두 화면에 적혀 있으면 두 화면 모두에 둔다. 사라진 파일의 탭은 위에서 이미 걸러졌으므로 여기서는 순서와 활성 탭만 맞춘다.
 */
function restoredScreens(
  docs: TabsState,
  notes: TabsState,
  snapshot: ScreensSnapshot,
): ScreensState {
  const byId = new Map([...docs.tabs, ...notes.tabs].map((tab) => [tab.id, tab]))
  const placed = new Set(snapshot.screens.flatMap((screen) => [...leaves(screen.layout), ...(screen.floats ?? []).map((float) => float.paneId)].flatMap((pane) => screen.paneState[pane]?.tabIds ?? [])))
  const tabOf = (id: string): Tab[] => { const tab = byId.get(id); return tab !== undefined ? [tab] : [] }
  const screens = snapshot.screens.map((screen, screenIndex): Screen => {
    const order = leaves(screen.layout)
    const first = screenIndex === 0
    const docTarget = first ? order[0]! : null
    const noteTarget = first ? order[1] ?? order[0]! : null
    const panes: Record<string, TabsState> = {}
    const channels: Record<string, PaneChannel> = {}
    for (const pane of order) {
      const saved = screen.paneState[pane]
      const own = (saved?.tabIds ?? []).flatMap(tabOf)
      const extra = [
        ...(pane === docTarget ? docs.tabs.filter((tab) => !placed.has(tab.id)) : []),
        ...(pane === noteTarget ? notes.tabs.filter((tab) => !placed.has(tab.id)) : []),
      ]
      const tabs = [...own, ...extra]
      const ownActive = (id: string | null) => id !== null && tabs.some((tab) => tab.id === id) ? id : null
      const fallbackActive = (pane === docTarget ? ownActive(docs.activeId) : null) ?? (pane === noteTarget ? ownActive(notes.activeId) : null)
      panes[pane] = restoredTabs(tabs, ownActive(saved?.activeId ?? null) ?? fallbackActive)
      channels[pane] = saved?.channel === undefined ? 'blue' : saved.channel
    }
    // 떠 있는 칸: 보통 칸처럼 탭 · 보던 탭 · 색을 되살린다
    for (const float of screen.floats ?? []) {
      const saved = screen.paneState[float.paneId]
      const tabs = (saved?.tabIds ?? []).flatMap(tabOf)
      panes[float.paneId] = restoredTabs(tabs, saved?.activeId ?? null)
      channels[float.paneId] = saved?.channel === undefined ? 'blue' : saved.channel
    }
    const zoomed = screen.zoomed !== undefined && screen.zoomed !== null && order.includes(screen.zoomed) ? screen.zoomed : null
    return { id: screen.id, name: screen.name, layout: screen.layout, panes, channels, zoomed, floats: screen.floats ?? [], ...(screen.floatsHidden === true ? { floatsHidden: true } : {}) }
  })
  const activeScreen = screens.some((screen) => screen.id === snapshot.activeScreen) ? snapshot.activeScreen : screens[0]!.id
  const lastScreen = snapshot.lastScreen !== null && snapshot.lastScreen !== activeScreen && screens.some((screen) => screen.id === snapshot.lastScreen) ? snapshot.lastScreen : null
  return { screens, activeScreen, lastScreen }
}

/** 처음 상태: 한 칸(문서). 샘플 작업 공간처럼 노트 탭을 함께 받으면 좌우 둘로 시작한다 */
function initialWorkspace(options: UseVaultOptions, windowRole: string): TreeWorkspace {
  const first = newPaneId()
  const docs = options.pdfTabs === undefined ? emptyTabs : { tabs: [...options.pdfTabs.tabs], activeId: options.pdfTabs.activeId }
  const notes = options.noteTabs === undefined ? emptyTabs : { tabs: [...options.noteTabs.tabs], activeId: options.noteTabs.activeId }
  if (notes.tabs.length > 0 && SPLIT_PANES_ENABLED && windowRole === 'main') {
    const second = newPaneId([first])
    return { panes: { [first]: docs, [second]: notes }, channels: { [first]: 'blue', [second]: 'blue' }, layout: layoutForLegacyId('cols2', [first, second]) }
  }
  return { panes: { [first]: { tabs: [...docs.tabs, ...notes.tabs], activeId: docs.activeId ?? notes.activeId } }, channels: { [first]: 'blue' }, layout: paneNode(first) }
}

/** 처음 상태: 화면 하나(「읽기」) */
function initialScreens(options: UseVaultOptions, windowRole: string): ScreensState {
  const workspace = initialWorkspace(options, windowRole)
  const id = newScreenId()
  return { screens: [{ id, name: t('읽기'), ...workspace, zoomed: null, floats: [] }], activeScreen: id, lastScreen: null }
}

function isPdfDocMeta(value: PdfDocMeta | null): value is PdfDocMeta {
  return value !== null
}

/** 캔버스를 꺼 둔 동안 세션에서 되살리지 않는 탭 id(노트 탭 목록의 캔버스 경로). 켜져 있으면 없다 */
function dormantCanvasIds(session: SessionState): ReadonlySet<string> {
  return CANVAS_ENABLED ? new Set() : new Set(session.noteTabIds.filter((id) => !isMarkdownPath(id)))
}

function displayEntries(
  entries: readonly VaultLibraryEntry[],
  indexEntries: readonly VaultIndexEntry[],
): LibraryDoc[] {
  const displayNames = new Map(indexEntries.map((entry) => [entry.id, entry.displayName]))
  return entries.map((entry) => ({
    docId: entry.docId,
    title: displayNames.get(entry.docId) ?? entry.title,
    pages: entry.pages,
    folderPath: entry.folderPath,
  }))
}

function indexedDisplayNames(entries: readonly VaultIndexEntry[]): ReadonlyMap<string, string> {
  return new Map(entries
    .filter((entry) => entry.storage === 'vault')
    .map((entry) => [entry.path, entry.displayName]))
}

/**
 * 디스크와 맞추기(Vault 안 PDF): 앱이 꺼진 사이 지워진 파일은 목록에서 빼고,
 * 하이라이트·책갈피가 있으면 목록에 남겨 「찾을 수 없음」으로 둔다.
 */
async function settleMissingPdfs(
  handle: VaultHandle,
  libraryEntries: readonly VaultLibraryEntry[],
  index: VaultIndexFile,
  treeEntries: readonly VaultTreeEntry[],
  readOnly: boolean,
): Promise<{ library: readonly VaultLibraryEntry[]; index: VaultIndexFile; absentDocIds: string[] }> {
  const probe = reconcileMissingVaultPdfs(index, libraryEntries, treeEntries, () => false)
  if (probe.library.length === libraryEntries.length && probe.absentDocIds.length === 0 && JSON.stringify(probe.index) === JSON.stringify(index)) {
    return { library: libraryEntries, index, absentDocIds: [] }
  }
  const [highlights, bookmarks] = await Promise.all([
    readPdfHighlights(handle).catch(() => []),
    readPdfBookmarks(handle).catch(() => []),
  ])
  const withData = new Set<string>([
    ...highlights.map((highlight) => highlight.anchor.docId),
    ...bookmarks.map((bookmark) => bookmark.docId),
  ])
  const result = reconcileMissingVaultPdfs(index, libraryEntries, treeEntries, (docId) => withData.has(docId))
  if (!readOnly && result.library.length !== libraryEntries.length) {
    await writeLibrary(handle, result.library as VaultLibraryEntry[])
  }
  return { library: result.library as VaultLibraryEntry[], index: result.index, absentDocIds: result.absentDocIds }
}

/** 읽던 쪽을 파일에 쓰기 전에 기다리는 시간. 그사이 쪽이 또 바뀌면 다시 센다 */
const READING_POSITION_WRITE_DELAY_MS = 1500

/** 창 사이 알림에서 내용은 쓰지 않고 「바뀌었다」만 본다 */
const SIGNAL_CODEC: SyncCodec<string> = { serialize: (value) => value, parse: (text) => text }

interface RestoreContext {
  readonly handle: VaultHandle
  readonly windowMode: WindowMode
  readonly libraryEntries: readonly VaultLibraryEntry[]
  readonly reconciledIndex: VaultIndexFile
  readonly nextTreeEntries: readonly VaultTreeEntry[]
  readonly groups: readonly NotebookGroup[]
  readonly markdownAsPdf: (handle: VaultHandle, indexId: string, path: string, storage: 'vault' | 'reference', title: string, source: string) => Promise<PdfDocMeta | null>
  /**
   * 예전 세션의 번역기 칸을 번역기 창으로 옮겨도 되는가: 이 세션의 소유자가 될 창만(메인 창 · 아무도 안 붙은 세션으로 갈아탄 창).
   * 먼저 붙은 새 앱 창(`new-client`)은 소유자가 아니라 다시 옮기지 않는다 — 번역기 창 상태는 앱의 모든 창이 나눠 갖는다.
   */
  readonly adoptLegacyTranslator: boolean
}

interface RestoredSession {
  readonly missing: string[]
  readonly documents: PdfDocMeta[]
  readonly restoredMarkdownSources: Record<string, string>
  readonly screens: ScreensState
  /** 되살리지 않은 탭(꺼 둔 캔버스)이 있던 칸: 저장할 때 그대로 되돌려 쓴다 */
  readonly dormant: DormantTabs
}

/**
 * 세션 하나의 탭(문서 · 노트)을 다시 열고 화면들로 되살린다. Vault 를 열 때와 세션을 바꿀 때 같이 쓴다.
 * 사라진 파일의 탭은 missing 에 적고 건너뛴다.
 */
async function restoreSessionState(ctx: RestoreContext, session: SessionState, sessionName: string): Promise<RestoredSession> {
  const { handle, windowMode, libraryEntries, reconciledIndex, nextTreeEntries, groups, markdownAsPdf, adoptLegacyTranslator } = ctx
  const missing: string[] = []
  const notes = new Map<string, NotebookNote>()
  for (const group of groups) {
    for (const note of group.notes) notes.set(note.path, note)
  }
  const markdownTitles = new Map<string, string>()
  for (const entry of nextTreeEntries) {
    if (entry.isDirectory) continue
    const path = entry.path.replaceAll('\\', '/')
    const filename = path.split('/').at(-1)
    if (filename === undefined || !isMarkdownPath(filename)) continue
    markdownTitles.set(path, filename.replace(/\.(?:md|markdown)$/iu, ''))
  }
  const externalMarkdownByPath = new Map(reconciledIndex.entries
    .filter((entry) => entry.kind === 'markdown' && entry.storage === 'reference' && !entry.missing)
    .map((entry) => [entry.path.replaceAll('\\', '/').toLocaleLowerCase(), entry]))
  const legacyMarkdownIds = session.noteTabIds.filter(isMarkdownPath)
  const documentTabIds = [...new Set([...session.pdfTabIds, ...legacyMarkdownIds])]
  const restoredDocumentRecords = await Promise.all(documentTabIds.map(async (id) => {
    if (isMarkdownPath(id)) {
      const external = externalMarkdownByPath.get(id.replaceAll('\\', '/').toLocaleLowerCase())
      const title = external?.displayName ?? markdownTitles.get(id)
      if (title === undefined) return null
      try {
        const source = await readMarkdown(handle, external?.id ?? id)
        // 예전 세션의 Markdown 탭도 PDF 화면으로 연다(탭 id 가 색인 id 로 바뀐다)
        const indexed = external ?? reconciledIndex.entries.find((entry) => entry.kind === 'markdown' && entry.path.replaceAll('\\', '/').toLocaleLowerCase() === id.replaceAll('\\', '/').toLocaleLowerCase())
        if (indexed !== undefined) {
          const document = await markdownAsPdf(handle, indexed.id, indexed.path, indexed.storage === 'reference' ? 'reference' : 'vault', title, source)
          if (document !== null) return { tab: { id: indexed.id, title, kind: 'pdf' as const }, document, source: null }
        }
        return {
          tab: { id, title, kind: 'markdown' as const },
          document: null,
          source,
        }
      } catch {
        return null
      }
    }
    // 같은 PDF 의 두 번째 보기("docId#2")도 원래 문서로 연다
    const baseId = id.replace(/#\d+$/u, '')
    const entry = libraryEntries.find((candidate) => candidate.docId === baseId)
    // PDF 화면으로 연 Markdown(탭 id = 색인 id)
    const markdownEntry = entry === undefined ? reconciledIndex.entries.find((indexed) => indexed.id === baseId && indexed.kind === 'markdown' && !indexed.missing) : undefined
    if (markdownEntry !== undefined) {
      try {
        const source = await readMarkdown(handle, markdownEntry.storage === 'reference' ? markdownEntry.id : markdownEntry.path)
        const title = markdownEntry.displayName ?? (markdownEntry.path.split('/').at(-1) ?? markdownEntry.path).replace(/\.(?:md|markdown)$/iu, '')
        const document = await markdownAsPdf(handle, markdownEntry.id, markdownEntry.path, markdownEntry.storage === 'reference' ? 'reference' : 'vault', title, source)
        // PDF 화면을 쓰지 않으면 Markdown 뷰어 탭으로(탭 id 는 경로)
        if (document === null) return { tab: { id: markdownEntry.path, title, kind: 'markdown' as const }, document: null, source }
        return { tab: { id, title, kind: 'pdf' as const }, document, source: null }
      } catch {
        missing.push(id)
        return null
      }
    }
    if (entry === undefined) return null
    try {
      const document = await openPdf(entry.path, entry.docId)
      return {
        // 탭 제목은 사이드바와 같은 표시 이름이다. 파일 이름은 표시 이름이 없을 때만 쓴다.
        tab: { id: id === baseId ? document.docId : id, title: reconciledIndex.entries.find((indexed) => indexed.id === document.docId)?.displayName ?? document.title, kind: 'pdf' as const },
        document,
        source: null,
      }
    } catch {
      missing.push(id)
      return null
    }
  }))
  const availableDocumentRecords = restoredDocumentRecords.filter((record) => record !== null)
  const documents = availableDocumentRecords
    .map((record) => record.document)
    .filter(isPdfDocMeta)
  const restoredNotes = session.noteTabIds.flatMap((path) => {
    if (isMarkdownPath(path)) return []
    if (!CANVAS_ENABLED) return []
    const note = notes.get(path)
    return note === undefined ? [] : [note]
  })
  const restoredMarkdownSources = Object.fromEntries(availableDocumentRecords.flatMap((record) => (
    record.source === null ? [] : [[record.tab.id, record.source]]
  )))
  const migratedActiveMarkdownId = session.activeNoteTabId !== null && isMarkdownPath(session.activeNoteTabId)
    ? session.activeNoteTabId
    : null
  // 앱 창(메인 창 · 세션에 붙은 새 창)은 저장된 칸 배치(예전 세션이면 배치 id·칸 이름을 트리로 옮겨서), 떼어 낸 창은 한 칸에서 시작한다
  // 번역기 탭을 담은 떠 있는 칸이 저장돼 있던 세션이면 그 자리 · 크기로 번역기 창을 연다(칸 · 탭은 읽을 때 이미 버렸다)
  if (adoptLegacyTranslator && session.legacyTranslator !== undefined && isAppClient(windowMode)) adoptLegacyTranslatorFloat(session.legacyTranslator, `${handle.root}|${sessionName}`)
  const snapshot = isAppClient(windowMode) && SPLIT_PANES_ENABLED
    ? screensFromSession(session, readLegacyLayoutId(typeof window === 'undefined' ? null : window.localStorage), t('읽기'))
    : singleScreenSnapshot(t('읽기'))
  const restored = restoredScreens(
    restoredTabs(
      availableDocumentRecords.map((record) => record.tab),
      migratedActiveMarkdownId ?? session.activePdfTabId,
    ),
    restoredTabs(
      [
        ...restoredNotes.map((note): Tab => ({ id: note.path, title: note.title, kind: 'canvas' })),
        // 탭으로 연 메모 노트: 노트 목록은 따로(useMemoNotes) 읽으므로 여기서는 이름만 경로에서 따 두고, 없어진 노트의 탭은 App 이 목록을 읽은 뒤 닫는다
        ...(session.memoNoteTabIds ?? []).map((path): Tab => ({ id: path, title: memoNoteTitleOf(path), kind: 'memoNote' })),
      ],
      migratedActiveMarkdownId === null ? session.activeNoteTabId : null,
    ),
    snapshot,
  )
  const screens = { ...restored, screens: restored.screens.map((screen) => ({ ...screen, panes: markPreviewTabs(screen.panes, session.previewTabIds ?? []) })) }
  return { missing, documents, restoredMarkdownSources, screens, dormant: dormantTabsOf(snapshot, dormantCanvasIds(session)) }
}

/**
 * 이미 열린 탭들만으로 세션의 화면들을 되살린다. 다른 앱 창이 보낸 상태에 새로 열 문서가 없을 때 쓰는 가벼운 길이다
 * (탭 하나를 바꿀 때마다 문서를 다시 열지 않으려고).
 */
function screensFromKnownTabs(session: SessionState, known: ReadonlyMap<string, Tab>): ScreensState {
  const pick = (ids: readonly string[]) => ids.flatMap((id) => { const tab = known.get(id); return tab === undefined ? [] : [tab] })
  const restored = restoredScreens(
    restoredTabs(pick(session.pdfTabIds), session.activePdfTabId),
    restoredTabs(pick([...session.noteTabIds, ...(session.memoNoteTabIds ?? [])]), session.activeNoteTabId),
    screensFromSession(session, null, t('읽기')),
  )
  return { ...restored, screens: restored.screens.map((screen) => ({ ...screen, panes: markPreviewTabs(screen.panes, session.previewTabIds ?? []) })) }
}

export function useVault(options: UseVaultOptions = {}) {
  // 이 창의 역할(메인·떼어 낸 창·새 창). 창이 사는 동안 바뀌지 않는다
  const windowMode = currentWindowMode()
  const injected = options.library !== undefined && options.notebooks !== undefined
  const [initializing, setInitializing] = useState(!injected)
  const [vault, setVault] = useState<VaultHandle | null>(null)
  const [entries, setEntries] = useState<readonly VaultLibraryEntry[]>([])
  // 최근에 연 Vault 밖 PDF(탐색기에서 IWAE 로 연 것)
  const [recentPdfs, setRecentPdfs] = useState<readonly RecentPdf[]>(readRecentPdfs)
  const [injectedLibrary, setInjectedLibrary] = useState<readonly LibraryDoc[]>(options.library ?? [])
  const [notebooks, setNotebooks] = useState<NotebookGroup[]>(options.notebooks ?? [])
  const [treeEntries, setTreeEntries] = useState<readonly VaultTreeEntry[]>([])
  const [treeOrder, setTreeOrder] = useState<VaultTreeOrder>({})
  const treeOrderRef = useRef(treeOrder)
  treeOrderRef.current = treeOrder
  const [vaultIndex, setVaultIndex] = useState<readonly VaultIndexEntry[]>([])
  const [dirtyFileIds, setDirtyFileIds] = useState<ReadonlySet<string>>(() => new Set())
  const [conflictFileIds, setConflictFileIds] = useState<readonly string[]>([])
  const [tree, setTree] = useState<readonly VaultTreeNode[]>(() => injected
    ? buildLegacyWorkspaceTree(options.library ?? [], options.notebooks ?? [])
    : [])
  const [openedDocs, setOpenedDocs] = useState<readonly PdfDocMeta[]>(options.openedDocs ?? [])
  // 칸(패널)의 탭·색 채널·나누기 트리를 한 상태에 둔다. 칸이 생기고 없어지는 일(나누기·닫기)이 세 값을 한꺼번에 바꾸고,
  // "이미 다른 칸에 열려 있으면 거기서 활성화"를 한 번의 갱신으로 판단하려면 한 곳에 있어야 한다.
  // 화면들(tmux 의 window). 지금 보는 화면의 칸·색·배치가 workspace 이고, 아래 모든 갱신은 보는 화면에만 닿는다.
  const [screensState, setScreensState] = useState<ScreensState>(() => initialScreens(options, windowMode.role))
  // 캔버스를 꺼 둔 동안 세션에 있던 캔버스 탭(화면에는 없다): 저장할 때 그대로 되돌려 써서 다시 켜면 돌아온다
  const dormantTabsRef = useRef<DormantTabs>({})
  const activeScreen = activeScreenOf(screensState)
  const workspace = useMemo<TreeWorkspace>(
    () => ({ panes: activeScreen.panes, channels: activeScreen.channels, layout: activeScreen.layout }),
    [activeScreen.panes, activeScreen.channels, activeScreen.layout],
  )
  const { panes, channels, layout: paneLayout } = workspace
  const screensStateRef = useRef(screensState)
  screensStateRef.current = screensState
  const setWorkspace = useCallback((update: SetStateAction<TreeWorkspace>) => {
    setScreensState((current) => {
      const now = workspaceOf(activeScreenOf(current))
      return withActiveWorkspace(current, typeof update === 'function' ? update(now) : update)
    })
  }, [])
  const setPanes = useCallback((update: SetStateAction<PanesState>) => {
    setWorkspace((current) => {
      const next = typeof update === 'function' ? update(current.panes) : update
      return next === current.panes ? current : { ...current, panes: next }
    })
  }, [])
  // 창마다 색 채널(같은 색의 창끼리 연동). 새 칸은 나눈 칸의 색을 받는다
  const setChannels = useCallback((update: SetStateAction<PaneChannels>) => {
    setWorkspace((current) => {
      const next = typeof update === 'function' ? update(current.channels) : update
      return next === current.channels ? current : { ...current, channels: next }
    })
  }, [])
  const setPaneLayout = useCallback((update: SetStateAction<LayoutNode>) => {
    setWorkspace((current) => {
      const next = typeof update === 'function' ? update(current.layout) : update
      return next === current.layout ? current : { ...current, layout: next }
    })
  }, [])
  // 새 탭을 어느 패널에 열지. 문서·캔버스 각각 마지막으로 쓴 패널을 따른다(없어진 칸이면 첫 칸).
  const paneRouteRef = useRef<Record<'doc' | 'note', PaneId>>((() => {
    const order = leaves(workspace.layout)
    return { doc: order[0]!, note: order[1] ?? order[0]! }
  })())
  const setPaneRoute = useCallback((kind: 'doc' | 'note', pane: PaneId) => {
    paneRouteRef.current = { ...paneRouteRef.current, [kind]: pane }
  }, [])
  const openInPane = useCallback((tab: Tab, pane?: PaneId) => {
    setWorkspace((current) => {
      const wanted = pane ?? paneRouteRef.current[paneRouteOf(tab.kind)]
      // 떠 있는 칸(나누기 트리 밖이지만 칸 상태가 있다)도 열 곳이 된다
      const target = hasPane(current.layout, wanted) || current.panes[wanted] !== undefined ? wanted : leaves(current.layout)[0]!
      const next = openTabInPanes(current.panes, tab, target)
      return next === current.panes ? current : { ...current, panes: next }
    })
  }, [])
  const moveTab = useCallback((id: string, target: PaneId) => {
    setPanes((current) => (current[target] === undefined ? current : moveTabToPane(current, id, target)))
  }, [setPanes])
  // 화면을 옮기면 새 탭은 그 화면의 칸으로 간다(예전 화면의 칸 id 로 남지 않게)
  const activeScreenId = activeScreen.id
  useEffect(() => {
    const order = leaves(activeScreenOf(screensStateRef.current).layout)
    const route = paneRouteRef.current
    if (!order.includes(route.doc) || !order.includes(route.note)) {
      paneRouteRef.current = { doc: order.includes(route.doc) ? route.doc : order[0]!, note: order.includes(route.note) ? route.note : order[1] ?? order[0]! }
    }
  }, [activeScreenId, paneRouteRef])
  const screenOps = useMemo(() => ({
    /** 화면 id 로 옮겨 간다 */
    switchTo: (id: string) => setScreensState((current) => switchScreen(current, id)),
    /** 번호(0 부터)로 옮겨 간다 */
    switchAt: (index: number) => setScreensState((current) => switchScreenAt(current, index)),
    /** 다음(1) · 이전(-1) 화면 */
    step: (step: number) => setScreensState((current) => stepScreen(current, step)),
    /** 바로 앞에 보던 화면 */
    last: () => setScreensState((current) => lastScreenOf(current)),
    /** 새 화면을 맨 뒤에 더한다. activate 면 그 화면으로 간다 */
    add: (screen: Omit<Screen, 'id'>, activate = true) => setScreensState((current) => addScreen(current, screen, activate)),
    rename: (id: string, name: string) => setScreensState((current) => renameScreen(current, id, name)),
    reorder: (id: string, toIndex: number) => setScreensState((current) => reorderScreen(current, id, toIndex)),
    close: (id: string) => setScreensState((current) => closeScreen(current, id) ?? current),
    /** 칸 하나를 새 화면으로 떼어 그리로 간다(break-pane) */
    breakPane: (pane: string, name: string) => setScreensState((current) => breakPane(current, pane, name) ?? current),
    /** 보는 화면의 「크게」 칸(null 이면 푼다) */
    setZoomed: (pane: string | null) => setScreensState((current) => setZoomed(current, pane)),
    /** 화면 상태를 통째로 바꾼다(명령줄 명령이 계산한 새 상태) */
    replace: (next: ScreensState) => setScreensState(next),
  }), [])
  const [sidebarCollapsed, setSidebarCollapsed] = useState(emptySession.sidebarCollapsed)
  const [layout, setLayout] = useState({
    sidebarPx: emptySession.sidebarPx,
    leftFrac: emptySession.leftFrac,
  })
  const [openFailedDocIds, setMissingDocIds] = useState<readonly string[]>([])
  /** 파일이 Vault 에 없는 문서(디스크와 맞추다 찾은 것) */
  const [absentDocIds, setAbsentDocIds] = useState<readonly string[]>([])
  const missingDocIds = useMemo(() => [...new Set([...openFailedDocIds, ...absentDocIds])], [openFailedDocIds, absentDocIds])
  const [markdownSources, setMarkdownSources] = useState<Readonly<Record<string, string>>>(options.markdownSources ?? {})
  const onImportedFromRef = useRef(options.onImportedFrom)
  onImportedFromRef.current = options.onImportedFrom
  const markdownSourcesRef = useRef(markdownSources)
  markdownSourcesRef.current = markdownSources
  const [error, setError] = useState<string | null>(null)
  const [markdownTheme, setMarkdownThemeState] = useState<MarkdownThemeId>('light')
  const [fileActivity, setFileActivity] = useState<Readonly<Record<string, VaultFileActivity>>>({})
  const [itemIcons, setItemIcons] = useState<Readonly<Record<string, string>>>({})
  const [noteOrder, setNoteOrderState] = useState<readonly string[]>([])
  const [itemColors, setItemColors] = useState<Readonly<Record<string, FolderColor>>>({})
  const [recentVaultPaths, setRecentVaultPaths] = useState<readonly string[]>([])
  const [extractedSearchText, setExtractedSearchText] = useState<Readonly<Record<string, string>>>({})
  const [extractedSearchPages, setExtractedSearchPages] = useState<Readonly<Record<string, readonly VaultSearchPage[]>>>({})
  const [searchIndexProgress, setSearchIndexProgress] = useState({ indexed: 0, total: 0 })
  /** 「색인 다시 만들기」: 설정과 상관없이 이번 한 번은 색인한다 */
  const forceIndexRef = useRef(false)
  const searchGenerationRef = useRef(0)
  const metadataWriteQueueRef = useRef<Promise<void>>(Promise.resolve())

  useEffect(() => {
    if (!injected) return
    setTree(buildLegacyWorkspaceTree(injectedLibrary, notebooks))
  }, [injected, injectedLibrary, notebooks])
  const [sessionReady, setSessionReady] = useState(false)
  // 이름 붙은 세션(docs/design/workspace-tmux.md 6): 지금 쓰는 세션 · 있는 세션들 · 바꿀 때마다 오르는 번호(칸 보기를 새로 마운트하는 열쇠)
  const [sessionName, setSessionName] = useState(() => t('기본'))
  const [sessionNames, setSessionNames] = useState<readonly string[]>([])
  const [sessionEpoch, setSessionEpoch] = useState(0)
  const sessionNameRef = useRef(sessionName)
  sessionNameRef.current = sessionName
  const sessionNamesRef = useRef(sessionNames)
  sessionNamesRef.current = sessionNames
  const sessionMetaRef = useRef<SessionsMeta>(emptySessionsMeta)
  const sessionQueueRef = useRef<Promise<unknown>>(Promise.resolve())

  const loadVault = useCallback(async (handle: VaultHandle) => {
    const searchGeneration = searchGenerationRef.current + 1
    searchGenerationRef.current = searchGeneration
    setInitializing(true)
    setSessionReady(false)
    setError(null)
    try {
      // 처음 여는 폴더(또는 탐색기로 PDF 를 넣은 뒤)도 PDF 가 목록·검색에 바로 오르게, 새로 고침과 같이 먼저 등록한다.
      // 떼어 낸 창은 메인 창이 이미 한 일이라 건너뛴다
      if (windowMode.role !== 'detached') await registerUnlistedVaultPdfs(handle).catch(() => [])
      const [
        rawLibraryEntries,
        nextTreeEntries,
        loadedSessions,
        savedTreeOrder,
        savedIndex,
        metadata,
        searchTextCache,
      ] = await Promise.all([
        readLibrary(handle),
        listVaultTree(handle),
        loadSessions(handle, t('기본')),
        readVaultTreeOrder(handle),
        readVaultIndex(handle),
        readVaultMetadata(handle),
        readVaultSearchTextCache(handle),
      ])
      const groups = buildNotebookTree(nextTreeEntries)
      const indexedWithLibrary = reconcileVaultIndexFiles(
        reconcileLibraryPdfEntries(savedIndex, rawLibraryEntries, new Date().toISOString()),
        nextTreeEntries,
        new Date().toISOString(),
      )
      const settled = await settleMissingPdfs(handle, rawLibraryEntries, indexedWithLibrary, nextTreeEntries, windowMode.role === 'detached')
      const libraryEntries = settled.library
      const reconciledIndex = settled.index
      if (JSON.stringify(reconciledIndex) !== JSON.stringify(savedIndex)) {
        await writeVaultIndex(handle, reconciledIndex)
      }
      // 메인은 마지막 세션, 떼어 낸 창은 그 문서 하나, 새 앱 창은 붙기로 한 세션(없으면 빈 탭)에서 시작한다
      const wantedSession = windowMode.role === 'extra' ? windowMode.session ?? null : null
      const startName = wantedSession !== null && loadedSessions.names.includes(wantedSession) ? wantedSession : loadedSessions.name
      const startRaw = startName === loadedSessions.name ? loadedSessions.raw : await readSessionNamed(handle, startName)
      const session = sessionForWindow(windowMode, parseSession(startRaw))
      const restoredSession = await restoreSessionState({ handle, windowMode, libraryEntries, reconciledIndex, nextTreeEntries, groups, markdownAsPdf, adoptLegacyTranslator: mayAdoptLegacyTranslator({ at: 'start', role: windowMode.role }) }, session, startName)
      const { missing, documents, restoredMarkdownSources } = restoredSession
      dormantTabsRef.current = restoredSession.dormant
      const searchablePdfEntries = reconciledIndex.entries.filter((entry) => (
        entry.kind === 'pdf' && !entry.missing
      ))
      const cachedPdfSearchPages = matchingCachedSearchPages(searchablePdfEntries, searchTextCache)
      const cachedPdfSearchText = Object.fromEntries(Object.entries(cachedPdfSearchPages)
        .map(([id, pages]) => [id, pages.map(({ text }) => text).filter(Boolean).join('\n\n')]))

      setVault(handle)
      setEntries(libraryEntries)
      setNotebooks(groups)
      setTreeEntries(nextTreeEntries)
      setTreeOrder(savedTreeOrder)
      setVaultIndex(reconciledIndex.entries)
      setMarkdownThemeState(metadata.markdownTheme)
      setFileActivity(windowMode.role === 'detached' && windowMode.docId !== null && windowMode.page !== null
        // 떼어 내기 전에 보던 쪽에서 시작한다
        ? { ...metadata.fileActivity, [windowMode.docId]: { ...(metadata.fileActivity[windowMode.docId] ?? { favorite: false, lastOpenedAt: null }), lastPage: windowMode.page } }
        : metadata.fileActivity)
      setItemIcons(metadata.itemIcons)
      setItemColors(metadata.itemColors ?? {})
      setNoteOrderState(metadata.noteOrder ?? [])
      setExtractedSearchText(cachedPdfSearchText)
      setExtractedSearchPages(cachedPdfSearchPages)
      setSearchIndexProgress({
        indexed: searchablePdfEntries.filter((entry) => {
          const cached = searchTextCache.documents[entry.id]
          return cached !== undefined && cached.contentHash === entry.contentHash && cached.complete
        }).length,
        total: searchablePdfEntries.length,
      })
      setTree(buildVaultWorkspaceTree(
        nextTreeEntries,
        displayEntries(libraryEntries, reconciledIndex.entries),
        savedTreeOrder,
        indexedDisplayNames(reconciledIndex.entries),
        reconciledIndex.entries,
      ))
      setOpenedDocs(documents)
      // 새 앱 창은 연 창이 정해 준 화면에서 시작한다
      const startScreens = windowMode.role === 'extra' && windowMode.screen !== undefined && windowMode.screen !== null
        ? switchScreenAt(restoredSession.screens, windowMode.screen)
        : restoredSession.screens
      const restoredOrder = leaves(activeScreenOf(startScreens).layout)
      paneRouteRef.current = { doc: restoredOrder[0]!, note: restoredOrder[1] ?? restoredOrder[0]! }
      setScreensState(startScreens)
      setMarkdownSources(restoredMarkdownSources)
      setMissingDocIds(missing)
      setAbsentDocIds(settled.absentDocIds)
      setSidebarCollapsed(session.sidebarCollapsed)
      setLayout({ sidebarPx: session.sidebarPx, leftFrac: session.leftFrac })
      setSessionName(startName)
      sessionNameRef.current = startName
      setSessionNames(loadedSessions.names.includes(startName) ? loadedSessions.names : [...loadedSessions.names, startName])
      sessionMetaRef.current = loadedSessions.meta
      setSessionReady(true)
      const markdownEntries = reconciledIndex.entries.filter((entry) => (
        entry.kind === 'markdown' && entry.storage === 'vault' && !entry.missing
      ))
      void Promise.all(markdownEntries.map(async (entry) => {
        try {
          return [entry.id, await readMarkdown(handle, entry.path)] as const
        } catch {
          return null
        }
      })).then((records) => {
        if (searchGenerationRef.current !== searchGeneration) return
        setExtractedSearchText((current) => ({
          ...current,
          ...Object.fromEntries(records.filter((record) => record !== null)),
        }))
      })
      // 설정 「Vault 를 열 때 모든 PDF 색인」을 끄면 미리 읽지 않는다(「색인 다시 만들기」로 따로 만든다)
      // 색인은 메인 창이 만든다(다른 창은 저장된 색인을 쓴다 — 여러 창이 같은 캐시를 쓰면 서로 덮는다)
      const indexNow = windowMode.role === 'main' && (getAppPrefs().autoIndex || forceIndexRef.current)
      forceIndexRef.current = false
      if (!indexNow) setSearchIndexProgress({ indexed: 0, total: 0 })
      if (indexNow) void (async () => {
        let nextCache = searchTextCache
        for (const indexEntry of searchablePdfEntries) {
          const cached = nextCache.documents[indexEntry.id]
          if (cached !== undefined && cached.contentHash === indexEntry.contentHash && cached.complete) continue
          const libraryEntry = libraryEntries.find((candidate) => candidate.docId === indexEntry.id)
          if (libraryEntry === undefined) continue
          try {
            const document = documents.find((candidate) => candidate.docId === indexEntry.id)
              ?? await openPdf(libraryEntry.path)
            let extractionIncomplete = false
            const pendingPages = new Map<number, VaultSearchPage>()
            let flushTimer: ReturnType<typeof setTimeout> | null = null
            const pages = await extractPdfDocumentPages(
              document.pageCount,
              async (page) => {
                try {
                  return document.hasText
                    ? await pageTextIndex(document.docId, page)
                    : { text: '', chars: [] }
                } catch (err) {
                  extractionIncomplete = true
                  throw err
                }
              },
              4,
              async (page) => {
                // OCR 을 끄면 스캔 쪽은 비워 두되 「다 읽음」으로 남기지 않는다(나중에 켜면 다시 읽게)
                if (!getAppPrefs().ocr) {
                  extractionIncomplete = true
                  return ''
                }
                try {
                  return await recognizePdfPageText(document.docId, page)
                } catch (err) {
                  extractionIncomplete = true
                  throw err
                }
              },
              (page) => {
                if (searchGenerationRef.current !== searchGeneration) return
                // 쪽마다 상태를 바꾸면 600쪽 문서에서 앱 전체가 600번 다시 그려지고 검색 기록도 그만큼 다시 만든다.
                // 읽은 쪽을 모아 두었다가 1초에 한 번만 반영한다.
                pendingPages.set(page.page, page)
                if (flushTimer !== null) return
                flushTimer = setTimeout(() => {
                  flushTimer = null
                  if (searchGenerationRef.current !== searchGeneration) return
                  const batch = [...pendingPages.values()]
                  pendingPages.clear()
                  setExtractedSearchPages((current) => {
                    const known = new Map((current[indexEntry.id] ?? []).map((candidate) => [candidate.page, candidate]))
                    for (const item of batch) known.set(item.page, item)
                    return { ...current, [indexEntry.id]: [...known.values()].sort((left, right) => left.page - right.page) }
                  })
                }, 1000)
              },
            )
            if (flushTimer !== null) clearTimeout(flushTimer)
            if (searchGenerationRef.current !== searchGeneration) return
            if (extractionIncomplete) continue
            nextCache = updateVaultSearchTextCache(
              nextCache,
              indexEntry.id,
              indexEntry.contentHash,
              pages,
            )
            setExtractedSearchPages((current) => ({ ...current, [indexEntry.id]: pages }))
            setExtractedSearchText((current) => ({
              ...current,
              [indexEntry.id]: pages.map(({ text }) => text).filter(Boolean).join('\n\n'),
            }))
            await writeVaultSearchTextCache(handle, nextCache)
          } catch {
          } finally {
            if (searchGenerationRef.current === searchGeneration) {
              setSearchIndexProgress((current) => ({ ...current, indexed: Math.min(current.total, current.indexed + 1) }))
            }
          }
        }
      })()
    } catch (err) {
      setVault(null)
      setError(errorText(err))
    } finally {
      setInitializing(false)
    }
  }, [])

  const persistMetadataUpdate = useCallback((update: (metadata: VaultMetadata) => VaultMetadata) => {
    if (vault === null) return
    const handle = vault
    metadataWriteQueueRef.current = metadataWriteQueueRef.current
      .catch(() => undefined)
      .then(async () => {
        const current = await readVaultMetadata(handle)
        await writeVaultMetadata(handle, update(current))
      })
      .catch((err: unknown) => setError(errorText(err)))
  }, [vault])

  const recordFileOpened = useCallback((id: string) => {
    const openedAt = new Date().toISOString()
    setFileActivity((current) => ({
      ...current,
      [id]: { ...(current[id] ?? { favorite: false, lastOpenedAt: null }), lastOpenedAt: openedAt },
    }))
    persistMetadataUpdate((metadata) => updateFileOpened(metadata, id, openedAt))
  }, [persistMetadataUpdate])

  const setFileFavorite = useCallback((id: string, favorite: boolean) => {
    setFileActivity((current) => ({
      ...current,
      [id]: { ...(current[id] ?? { favorite: false, lastOpenedAt: null }), favorite },
    }))
    persistMetadataUpdate((metadata) => updateFileFavorite(metadata, id, favorite))
  }, [persistMetadataUpdate])

  /**
   * 읽던 쪽. 스크롤할 때마다 불리므로 화면 상태는 바로 바꾸고 파일 쓰기는 파일마다
   * 1.5초 동안 몰아서 한 번만 한다 — 쪽을 넘길 때마다 메타데이터 파일을 다시 쓰면
   * 동기화 폴더(Google Drive)가 쉬지 않고 업로드한다.
   */
  const readingWriteTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())
  const recordReadingPosition = useCallback((id: string, page: number) => {
    if (!Number.isInteger(page) || page < 1) return
    setFileActivity((current) => {
      const previous = current[id] ?? { favorite: false, lastOpenedAt: null }
      if (previous.lastPage === page) return current
      return { ...current, [id]: { ...previous, lastPage: page } }
    })
    const timers = readingWriteTimersRef.current
    const pending = timers.get(id)
    if (pending !== undefined) clearTimeout(pending)
    timers.set(id, setTimeout(() => {
      timers.delete(id)
      persistMetadataUpdate((metadata) => setFileReadingPosition(metadata, id, page))
    }, READING_POSITION_WRITE_DELAY_MS))
  }, [persistMetadataUpdate])
  const readingPositions = useMemo(() => Object.fromEntries(
    Object.entries(fileActivity)
      .filter((entry): entry is [string, VaultFileActivity & { lastPage: number }] => entry[1].lastPage !== undefined)
      .map(([id, activity]) => [id, activity.lastPage]),
  ) as Readonly<Record<string, number>>, [fileActivity])

  /** 항목 이모지. vault 가 없으면(미리보기) 화면 상태에만 남는다 */
  const setItemIcon = useCallback((key: string, emoji: string | null) => {
    setItemIcons((current) => {
      const next = { ...current }
      if (emoji === null) delete next[key]
      else next[key] = emoji
      return next
    })
    persistMetadataUpdate((metadata) => updateItemIcon(metadata, key, emoji))
  }, [persistMetadataUpdate])

  /** 왼쪽 바 「노트」의 차례(노트 경로) */
  const setNoteOrder = useCallback((order: readonly string[]) => {
    setNoteOrderState(order)
    persistMetadataUpdate((metadata) => updateNoteOrder(metadata, order))
  }, [persistMetadataUpdate])

  const setItemColor = useCallback((key: string, color: FolderColor | null) => {
    setItemColors((current) => {
      const next = { ...current }
      if (color === null) delete next[key]
      else next[key] = color
      return next
    })
    persistMetadataUpdate((metadata) => updateItemColor(metadata, key, color))
  }, [persistMetadataUpdate])

  const openVaultPath = useCallback(async (root: string) => {
    let handle: VaultHandle
    try {
      handle = await openVault(root)
    } catch (err) {
      // 이 앱이 아직 허락받지 않은 폴더(새로 설치한 앱 등): 그 폴더가 잡힌 선택 창으로 한 번 고르게 한다
      if (!isFolderAccessDenied(err)) throw err
      const picked = await pickVaultFolder(root)
      if (picked === null) return
      handle = await openVault(picked)
    }
    await rememberVault(handle.root)
    setRecentVaultPaths((current) => [handle.root, ...current.filter((candidate) => candidate !== handle.root)].slice(0, 10))
    // 처음 고른 빈 폴더면 예시(PDF·Markdown·노트)를 넣는다. 실패해도 Vault 는 연다
    await seedSampleVaultInto(handle).catch(() => false)
    await loadVault(handle)
  }, [loadVault])

  useEffect(() => {
    if (injected) return
    let alive = true
    void (async () => {
      let root: string | undefined
      try {
        const roots = await recentVaults()
        if (alive) setRecentVaultPaths(roots)
        root = windowMode.vaultRoot ?? roots[0]
        if (root === undefined) {
          if (alive) setInitializing(false)
          return
        }
        const handle = await openVault(root)
        if (alive) await loadVault(handle)
      } catch (err) {
        if (alive) {
          setError(root !== undefined && isFolderAccessDenied(err) ? folderAccessText(root) : errorText(err))
          setInitializing(false)
        }
      }
    })()
    return () => {
      alive = false
    }
  }, [injected, loadVault])

  // 지금 상태(세션 모양). 앱 창들이 이것을 주고받고, 소유자 창은 이것을 세션 파일에 쓴다
  const sessionSnapshot = useMemo(() => (vault === null || !sessionReady ? null : captureSession(screensState, {
    sidebarCollapsed,
    sidebarPx: layout.sidebarPx,
    leftFrac: layout.leftFrac,
  }, dormantTabsRef.current)), [vault, sessionReady, screensState, sidebarCollapsed, layout.sidebarPx, layout.leftFrac])
  const sessionSnapshotRef = useRef<{ vault: VaultHandle | null; session: SessionState | null }>({ vault: null, session: null })
  sessionSnapshotRef.current = { vault, session: sessionSnapshot }

  // ───────── 세션에 붙은 앱 창들(docs/design/workspace-tmux.md 7, 동기화 방식은 sessionSync.ts) ─────────
  const restoreCtxRef = useRef<Omit<RestoreContext, 'markdownAsPdf' | 'adoptLegacyTranslator'>>(null as unknown as Omit<RestoreContext, 'markdownAsPdf' | 'adoptLegacyTranslator'>)
  restoreCtxRef.current = { handle: vault as VaultHandle, windowMode, libraryEntries: entries, reconciledIndex: { version: 1, entries: vaultIndex } as VaultIndexFile, nextTreeEntries: treeEntries, groups: notebooks }
  /** 다른 앱 창이 정한 공유 상태를 이 창에 반영한다. 보는 화면 · 크게 · 포커스는 이 창 것을 지킨다 */
  const applyRemoteSession = useCallback(async (raw: SessionState) => {
    const handle = sessionSnapshotRef.current.vault
    if (handle === null) return
    const session = parseSession(raw)
    const known = new Map<string, Tab>()
    for (const screen of screensStateRef.current.screens) {
      for (const tab of allPaneTabs(screen.panes, screenPaneIds(screen))) {
        const { preview: _preview, ...plain } = tab
        known.set(tab.id, plain)
      }
    }
    // 꺼 둔 캔버스 탭은 열 수 없으니 기다리지 않는다
    const dormantIds = dormantCanvasIds(session)
    const wanted = [...session.pdfTabIds, ...session.noteTabIds.filter((id) => !dormantIds.has(id)), ...(session.memoNoteTabIds ?? [])]
    let remote: ScreensState
    if (wanted.every((id) => known.has(id))) {
      remote = screensFromKnownTabs(session, known)
    } else {
      // 이 창에 아직 없는 문서가 있다: 세션을 되살리듯 열어 온다
      const restored = await restoreSessionState({ ...restoreCtxRef.current, handle, markdownAsPdf, adoptLegacyTranslator: mayAdoptLegacyTranslator({ at: 'remote' }) }, session, sessionNameRef.current)
      setOpenedDocs((current) => [...current, ...restored.documents.filter((document) => !current.some((candidate) => candidate.docId === document.docId))])
      setMarkdownSources((current) => ({ ...restored.restoredMarkdownSources, ...current }))
      remote = restored.screens
    }
    dormantTabsRef.current = { ...dormantTabsRef.current, ...dormantTabsOf(screensFromSession(session, null, t('읽기')), dormantIds) }
    setScreensState((current) => mergeRemoteScreens(current, remote))
    // 상태가 화면에 닿을 때까지(엔진이 그 사이의 변화를 「우리가 만든 것」으로 세지 않게)
    await new Promise<void>((resolve) => { window.setTimeout(resolve, 60) })
  }, [])
  const clientHooksRef = useRef<{ runCommand: (line: string) => Promise<RunResult>; quit: () => void }>({
    runCommand: async () => ({ ok: false, message: 'not ready' }),
    quit: () => undefined,
  })
  /** 메인 창을 떼면 숨긴 채 남는다(MCP · 백업을 맡는다). 숨긴 창은 앱 창 목록에 숨김으로 표시된다 */
  const [windowHidden, setWindowHidden] = useState(false)
  const clients = useSessionClients({
    windowMode,
    ready: sessionReady && vault !== null,
    session: sessionName,
    screen: Math.max(screensState.screens.findIndex((screen) => screen.id === screensState.activeScreen), 0),
    hidden: windowHidden,
    snapshot: sessionSnapshot,
    apply: applyRemoteSession,
    runCommand: (line) => clientHooksRef.current.runCommand(line),
    quit: () => clientHooksRef.current.quit(),
  })
  const selfClientId = clients.selfId
  const sessionOwnerRef = useRef(clients.isOwner)
  sessionOwnerRef.current = clients.isOwner
  const clientRegistryRef = useRef(clients.registry)
  clientRegistryRef.current = clients.registry

  // 지금 탭·배치를 바로 세션 파일에 쓴다(창이 닫히기 전에 마지막 변화를 싣는 데 쓴다). 소유자 창이 아니면 아무것도 안 한다 — 파일은 소유자만 쓴다
  const flushSession = useCallback(async () => {
    const { vault: handle, session } = sessionSnapshotRef.current
    if (handle === null || session === null || !sessionOwnerRef.current) return
    await writeSessionNamed(handle, sessionNameRef.current, session)
  }, [])

  useEffect(() => {
    // 세션 파일은 세션마다 소유자 창 하나만 쓴다. 다른 창의 상태가 소유자의 것을 덮으면 안 된다(소유자가 바뀌면 새 소유자가 이어서 쓴다)
    if (vault === null || !sessionReady || !clients.isOwner || sessionSnapshot === null) return
    const timer = window.setTimeout(() => {
      void writeSessionNamed(vault, sessionName, sessionSnapshot).catch((err: unknown) => setError(errorText(err)))
    }, 300)
    return () => window.clearTimeout(timer)
  }, [sessionReady, vault, sessionSnapshot, sessionName, clients.isOwner])


  // ───────── 이름 붙은 세션 동작(만들기 · 바꾸기 · 갈래 · 이름 바꾸기 · 지우기) ─────────
  // 동작은 하나씩 차례로 한다(바꾸는 사이에 다른 동작이 끼면 저장할 상태가 어긋난다)
  const sessionOps = useMemo(() => {
    type Outcome = { readonly ok: boolean; readonly message: string }
    const okResult = (message = ''): Outcome => ({ ok: true, message })
    const failResult = (message: string): Outcome => ({ ok: false, message })
    const exclusive = <T,>(task: () => Promise<T>): Promise<T> => {
      const next = sessionQueueRef.current.then(task, task)
      sessionQueueRef.current = next.catch(() => undefined)
      return next
    }
    const guard = (): { readonly handle: VaultHandle } | Outcome => {
      const handle = sessionSnapshotRef.current.vault
      if (handle === null) return failResult(t('Vault 를 연 뒤에 쓸 수 있습니다'))
      if (!isAppClient(windowMode)) return failResult(t('세션은 앱 창에서만 바꿀 수 있습니다'))
      return { handle }
    }
    const names = () => sessionNamesRef.current
    const writeMeta = async (handle: VaultHandle, meta: SessionsMeta) => {
      sessionMetaRef.current = meta
      await writeSessionsMeta(handle, meta)
    }
    /** 지금 상태를 지금 세션 파일에 쓴다(소유자 창만 쓴다) */
    const flush = async (handle: VaultHandle) => {
      const session = sessionSnapshotRef.current.session
      if (session !== null && sessionOwnerRef.current) await writeSessionNamed(handle, sessionNameRef.current, session)
    }
    /** 이 이름의 세션에 이 창 말고 다른 앱 창이 붙어 있는가(이름 바꾸기 · 지우기는 그 창들의 세션을 건드리므로 막는다) */
    const attachedElsewhere = (name: string) => clientRegistryRef.current.some((client) => client.session === name && client.id !== selfClientId)
    /** 이 이름의 세션으로 갈아탄다: 저장된 화면 · 탭을 다시 열고, 칸 보기를 새로 마운트한다 */
    const applySession = async (handle: VaultHandle, name: string, raw: unknown) => {
      setSessionReady(false)
      try {
        const session = parseSession(raw)
        const restored = await restoreSessionState({ ...restoreCtxRef.current, handle, markdownAsPdf, adoptLegacyTranslator: mayAdoptLegacyTranslator({ at: 'switch', attachedElsewhere: attachedElsewhere(name) }) }, session, name)
        const order = leaves(activeScreenOf(restored.screens).layout)
        paneRouteRef.current = { doc: order[0]!, note: order[1] ?? order[0]! }
        setOpenedDocs(restored.documents)
        setMarkdownSources(restored.restoredMarkdownSources)
        setMissingDocIds(restored.missing)
        dormantTabsRef.current = restored.dormant
        setScreensState(restored.screens)
        setSessionName(name)
        sessionNameRef.current = name
        setSessionNames((current) => (current.includes(name) ? current : [...current, name]))
        setSessionEpoch((current) => current + 1)
        await writeMeta(handle, touchSessionMeta(sessionMetaRef.current, name, Date.now()))
      } finally {
        setSessionReady(true)
      }
    }
    const switchTo = (query: string): Promise<Outcome> => exclusive(async () => {
      const checked = guard()
      if (!('handle' in checked)) return checked
      const name = findSessionName(names(), query)
      if (name === null) return failResult(t('세션을 찾을 수 없습니다: {name}', { name: query }))
      if (name === sessionNameRef.current) return okResult()
      await flush(checked.handle)
      const raw = await readSessionNamed(checked.handle, name)
      await applySession(checked.handle, name, raw)
      return okResult(t('세션: {name}', { name }))
    })
    const create = (wanted?: string): Promise<Outcome> => exclusive(async () => {
      const checked = guard()
      if (!('handle' in checked)) return checked
      const name = wanted === undefined || wanted.trim() === '' ? uniqueSessionName(t('세션'), names()) : wanted
      const valid = validateSessionName(name, names())
      if (!valid.ok) return failResult(valid.reason)
      await flush(checked.handle)
      const blank = blankScreen(t('빈 화면'), allScreenPaneIds(screensStateRef.current))
      const state: ScreensState = { screens: [blank], activeScreen: blank.id, lastScreen: null }
      const created = captureSession(state, { sidebarCollapsed, sidebarPx: layout.sidebarPx, leftFrac: layout.leftFrac })
      await writeSessionNamed(checked.handle, valid.name, created)
      await applySession(checked.handle, valid.name, created)
      return okResult(t('새 세션: {name}', { name: valid.name }))
    })
    const fork = (wanted: string): Promise<Outcome> => exclusive(async () => {
      const checked = guard()
      if (!('handle' in checked)) return checked
      const valid = validateSessionName(wanted, names())
      if (!valid.ok) return failResult(valid.reason)
      const session = sessionSnapshotRef.current.session
      if (session === null) return failResult(t('지금은 저장할 수 없습니다'))
      // 원래 세션은 지금까지의 상태로 두고, 같은 상태를 새 이름으로 쓴 뒤 그 세션으로 이어 간다
      await flush(checked.handle)
      await writeSessionNamed(checked.handle, valid.name, session)
      setSessionName(valid.name)
      sessionNameRef.current = valid.name
      setSessionNames((current) => [...current, valid.name])
      await writeMeta(checked.handle, touchSessionMeta(sessionMetaRef.current, valid.name, Date.now()))
      return okResult(t('다른 이름으로 저장했습니다: {name}', { name: valid.name }))
    })
    const rename = (from: string, wanted: string): Promise<Outcome> => exclusive(async () => {
      const checked = guard()
      if (!('handle' in checked)) return checked
      const source = findSessionName(names(), from)
      if (source === null) return failResult(t('세션을 찾을 수 없습니다: {name}', { name: from }))
      const valid = validateSessionName(wanted, names(), source)
      if (!valid.ok) return failResult(valid.reason)
      if (valid.name === source) return okResult()
      if (attachedElsewhere(source)) return failResult(t('다른 앱 창이 붙어 있어 바꿀 수 없습니다: {name}', { name: source }))
      const active = source === sessionNameRef.current
      if (active) await flush(checked.handle)
      const raw = active ? sessionSnapshotRef.current.session : await readSessionNamed(checked.handle, source)
      if (raw === null || raw === undefined) return failResult(t('지금은 저장할 수 없습니다'))
      await writeSessionNamed(checked.handle, valid.name, raw as SessionState)
      await removeSessionNamed(checked.handle, source)
      if (active) { setSessionName(valid.name); sessionNameRef.current = valid.name }
      setSessionNames((current) => current.map((candidate) => (candidate === source ? valid.name : candidate)))
      await writeMeta(checked.handle, renameInMeta(sessionMetaRef.current, source, valid.name))
      return okResult(t('이름을 바꿨습니다: {name}', { name: valid.name }))
    })
    const remove = (query: string): Promise<Outcome> => exclusive(async () => {
      const checked = guard()
      if (!('handle' in checked)) return checked
      const name = findSessionName(names(), query)
      if (name === null) return failResult(t('세션을 찾을 수 없습니다: {name}', { name: query }))
      if (names().length <= 1) return failResult(t('마지막 세션은 지울 수 없습니다'))
      if (attachedElsewhere(name)) return failResult(t('다른 앱 창이 붙어 있어 지울 수 없습니다: {name}', { name }))
      if (name === sessionNameRef.current) {
        // 지우는 세션이 지금 세션이면, 가장 최근에 쓴 다른 세션으로 먼저 옮겨 간다
        const used = sessionMetaRef.current.used
        const next = names().filter((candidate) => candidate !== name).sort((a, b) => (used[b] ?? 0) - (used[a] ?? 0))[0]!
        await applySession(checked.handle, next, await readSessionNamed(checked.handle, next))
      }
      await trashSessionNamed(checked.handle, name)
      setSessionNames((current) => current.filter((candidate) => candidate !== name))
      await writeMeta(checked.handle, removeFromMeta(sessionMetaRef.current, name))
      return okResult(t('세션을 지웠습니다: {name}', { name }))
    })
    /** 목록(화면 수 · 마지막으로 쓴 때). 파일을 읽어 센다 — 지금 세션은 지금 상태로 */
    const list = async (): Promise<SessionSummary[]> => {
      const handle = sessionSnapshotRef.current.vault
      const attachedTo = (name: string) => clientRegistryRef.current.filter((client) => client.session === name).length
      if (handle === null) return [{ name: sessionNameRef.current, screenCount: screensStateRef.current.screens.length, lastUsedAt: null, attached: attachedTo(sessionNameRef.current) }]
      const onDisk = await listSessionNames(handle)
      const all = [...new Set([...onDisk, ...sessionNamesRef.current])]
      const used = sessionMetaRef.current.used
      const rows = await Promise.all(all.map(async (name): Promise<SessionSummary> => {
        const active = name === sessionNameRef.current
        const count = active ? screensStateRef.current.screens.length : parseSession(await readSessionNamed(handle, name)).screens?.length ?? 1
        return { name, screenCount: count, lastUsedAt: used[name] ?? null, attached: attachedTo(name) }
      }))
      return rows.sort((a, b) => (a.name === sessionNameRef.current ? -1 : b.name === sessionNameRef.current ? 1 : (b.lastUsedAt ?? 0) - (a.lastUsedAt ?? 0) || a.name.localeCompare(b.name)))
    }
    const saveNow = (): Promise<Outcome> => exclusive(async () => {
      const checked = guard()
      if (!('handle' in checked)) return checked
      if (!sessionOwnerRef.current) return okResult(t('이 세션은 다른 앱 창이 저장합니다'))
      await flush(checked.handle)
      return okResult(t('세션을 저장했습니다: {name}', { name: sessionNameRef.current }))
    })
    return { switchTo, create, fork, rename, remove, list, saveNow }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [windowMode, sidebarCollapsed, layout.sidebarPx, layout.leftFrac])

  /** PDF 를 열어 탭에 띄운다. 연 문서의 메타를 돌려주고, 열지 못하면 null */
  /** openTab 이 false 면 PDF 를 열어 두기만 하고 탭은 만들지 않는다(탭 안에서 판을 바꿀 때) */
  const openDocument = useCallback(async (doc: LibraryDoc, openTab = true): Promise<PdfDocMeta | null> => {
    const entry = entries.find((candidate) => candidate.docId === doc.docId)
    if (entry === undefined) {
      if (openTab) openInPane({ id: doc.docId, title: doc.title, kind: 'pdf' })
      return null
    }
    try {
      const meta = await openPdf(entry.path, entry.docId)
      if (vault !== null && entry.pages !== meta.pageCount) {
        // 암호 PDF 는 쪽 수를 모른 채(0) 등록되므로 열린 김에 실제 쪽 수로 고친다
        const updated = await updateLibraryPageCount(vault, entry.docId, meta.pageCount).catch(() => null)
        if (updated !== null) setEntries(updated)
      }
      setOpenedDocs((current) => current.some((item) => item.docId === meta.docId)
        ? current
        : [...current, meta])
      setMissingDocIds((current) => current.filter((docId) => docId !== entry.docId))
      if (openTab) openInPane({ id: meta.docId, title: doc.title, kind: 'pdf' })
      recordFileOpened(entry.docId)
      return meta
    } catch (err) {
      setMissingDocIds((current) => current.includes(entry.docId) ? current : [...current, entry.docId])
      setError(errorText(err))
      return null
    }
  }, [entries, recordFileOpened, vault])

  /**
   * Vault 밖 PDF 를 연다(탐색기에서 IWAE 로 연 것). Vault 에 같은 파일이 있으면 그것을 열고,
   * 없으면 가져오지 않고 탭으로만 연 뒤 「최근 연 PDF」에 남긴다.
   */
  const openExternalPdf = useCallback(async (path: string) => {
    try {
      const meta = await openPdf(path)
      const entry = entries.find((candidate) => candidate.docId === meta.docId || candidate.sha256 === meta.sha256)
      if (entry !== undefined) {
        await openDocument({ docId: entry.docId, title: entry.title, pages: entry.pages })
        return
      }
      setOpenedDocs((current) => current.some((item) => item.docId === meta.docId) ? current : [...current, meta])
      openInPane({ id: meta.docId, title: meta.title, kind: 'pdf' })
      setRecentPdfs((current) => {
        const next = addRecentPdf(current, { path, title: meta.title, openedAt: new Date().toISOString() })
        writeRecentPdfs(next)
        return next
      })
    } catch (err) {
      setError(errorText(err))
    }
  }, [entries, openDocument])

  const forgetRecentPdf = useCallback((path: string) => {
    setRecentPdfs((current) => {
      const next = removeRecentPdf(current, path)
      writeRecentPdfs(next)
      return next
    })
  }, [])

  const addDocument = useCallback(async (
    policy: PdfAttachmentPolicy = { kind: 'reference' },
  ) => {
    if (vault === null && !injected) return
    setError(null)
    try {
      const path = await pickPdfFile()
      if (path === null) return
      const meta = await openPdf(path)
      if (vault === null) {
        setInjectedLibrary((current) => {
          const next = current.some((item) => item.docId === meta.docId)
            ? current
            : [...current, { docId: meta.docId, title: meta.title, pages: meta.pageCount }]
          setTree(buildLegacyWorkspaceTree(next, notebooks))
          return next
        })
        setOpenedDocs((current) => current.some((item) => item.docId === meta.docId)
          ? current
          : [...current, meta])
        openInPane({ id: meta.docId, title: meta.title, kind: 'pdf' })
        return
      }
      const entry = await attachPdfToLibrary(vault, {
        sourcePath: path,
        title: meta.title,
        pages: meta.pageCount,
        policy,
      })
      setEntries((current) => {
        const next = current.some((item) => item.docId === entry.docId)
          ? current
          : [...current, entry]
        setTree(buildVaultWorkspaceTree(treeEntries, displayEntries(next, vaultIndex), treeOrder, indexedDisplayNames(vaultIndex), vaultIndex))
        return next
      })
      setOpenedDocs((current) => current.some((item) => item.docId === meta.docId)
        ? current
        : [...current, meta])
      openInPane({ id: meta.docId, title: meta.title, kind: 'pdf' })
    } catch (err) {
      setError(errorText(err))
    }
  }, [injected, notebooks, treeEntries, treeOrder, vault, vaultIndex])

  // addNote 가 아래에서 정의되는 refreshVaultFiles 를 쓰도록 ref 로 잇는다
  const refreshVaultFilesRef = useRef<(handle: VaultHandle) => Promise<void>>(async () => undefined)
  const openCanvasRef = useRef(options.openCanvas)
  openCanvasRef.current = options.openCanvas
  /** 캔버스 파일을 만든다(열지는 않는다). 만든 캔버스, Vault 가 없으면 undefined */
  const createCanvasNote = useCallback(async (notebookName: string, noteName: string): Promise<{ path: string; title: string } | undefined> => {
    if (vault === null) return undefined
    const path = await createNote(vault, notebookName, noteName)
    // 새 캔버스도 바로 Vault 목록(index)에 올린다 — 안 그러면 다시 열기 전까지 이름 바꾸기·휴지통이
    // "Vault 파일을 찾지 못했습니다" 로 실패한다
    await refreshVaultFilesRef.current(vault)
    return { path, title: path.split('/').at(-1)?.replace(/\.canvas$/iu, '') ?? noteName }
  }, [vault])
  const addNote = useCallback(async (notebookName: string, noteName: string) => {
    const note = await createCanvasNote(notebookName, noteName)
    if (note === undefined) return
    if (openCanvasRef.current !== undefined) openCanvasRef.current(note)
    else openInPane({ id: note.path, title: note.title, kind: 'canvas' })
  }, [createCanvasNote])

  const reorderTreeNode = useCallback(async (request: VaultTreeReorderRequest) => {
    const next = reorderVaultTreeNode(tree, request)
    const nextOrder = vaultTreeOrder(next)
    setTree(next)
    setTreeOrder(nextOrder)
    if (vault !== null) await writeVaultTreeOrder(vault, nextOrder)
  }, [tree, vault])

  const renameEntry = useCallback(async (id: string, displayName: string) => {
    const trimmedName = displayName.trim()
    if (trimmedName === '') throw new Error(t('표시 이름을 입력해 주세요.'))
    if (vault === null) {
      if (!injected) throw new Error(t('Vault가 열려 있지 않습니다.'))
      setInjectedLibrary((current) => current.map((entry) => (
        entry.docId === id ? { ...entry, title: trimmedName } : entry
      )))
      setPanes((current) => mapPaneTabs(current, (tab) => tab.id === id ? { ...tab, title: trimmedName } : tab))
      return
    }
    const stableId = vaultIndex.find((entry) => entry.path.toLocaleLowerCase() === id.replaceAll('\\', '/').toLocaleLowerCase())?.id ?? id
    const updated = await renameVaultEntry(vault, stableId, trimmedName, 'display')
    const nextIndex = vaultIndex.map((entry) => entry.id === stableId ? updated : entry)
    setVaultIndex(nextIndex)
    setTree(buildVaultWorkspaceTree(treeEntries, displayEntries(entries, nextIndex), treeOrder, indexedDisplayNames(nextIndex), nextIndex))
    setPanes((current) => mapPaneTabs(current, (tab) => (
      tab.id === updated.path || (isDocumentKind(tab.kind) && tab.id === id) ? { ...tab, title: updated.displayName } : tab
    )))
  }, [entries, injected, treeEntries, treeOrder, vault, vaultIndex])

  /**
   * PDF 쪽 편집을 원본에 덮어쓴다. 문서 id 는 그대로 두고(형광펜·책갈피·노트 출처가 따라오게)
   * 목록·색인의 해시·크기·쪽 수만 고친다. 노트(.canvas) 안의 이 문서 출처는 remapNote 로 옮긴다.
   * 덮기 전 원본은 .iwae/history/pdf-edits 에 남는다.
   */
  /** 원본이 바뀐 PDF(같은 docId)의 목록·색인 해시·크기·쪽 수를 고친다 */
  const commitReplacedDocument = useCallback(async (docId: string, meta: PdfDocMeta) => {
    if (vault === null) return
    const updated = entries.map((candidate) => candidate.docId === docId
      ? { ...candidate, sha256: meta.sha256, size: meta.size, pages: meta.pageCount }
      : candidate)
    await writeLibrary(vault, updated)
    const index = await readVaultIndex(vault)
    const nextIndex = index.entries.map((item) => item.id === docId ? { ...item, contentHash: meta.sha256, size: meta.size } : item)
    await writeVaultIndex(vault, { version: 1, entries: nextIndex })
    setEntries(updated)
    setVaultIndex(nextIndex)
    setOpenedDocs((current) => current.map((doc) => doc.docId === docId ? meta : doc))
  }, [entries, vault])

  /** 덮기 전 원본을 남길 자리(.iwae/history/pdf-edits) */
  const backupPathFor = useCallback(async (title: string) => {
    if (vault === null) throw new Error(t('Vault가 열려 있지 않습니다.'))
    const { join } = await import('@tauri-apps/api/path')
    const stamp = new Date().toISOString().replace(/[:.]/gu, '-')
    return join(vault.root, '.iwae', 'history', 'pdf-edits', `${title}-${stamp}.pdf`)
  }, [vault])

  /**
   * PDF 쪽 편집을 원본에 덮어쓴다. 문서 id 는 그대로 두고(형광펜·책갈피·노트 출처가 따라오게)
   * 목록·색인의 해시·크기·쪽 수만 고친다. 노트(.canvas) 안의 이 문서 출처는 remapNote 로 옮긴다.
   * 덮기 전 원본은 .iwae/history/pdf-edits 에 남는다.
   */
  const editDocumentPages = useCallback(async (
    docId: string,
    plan: readonly PdfPageEditOp[],
    remapNote: (document: unknown) => unknown | null,
  ): Promise<PdfDocMeta> => {
    if (vault === null) throw new Error(t('Vault가 열려 있지 않습니다.'))
    const entry = entries.find((candidate) => candidate.docId === docId)
    if (entry === undefined) throw new Error(t('Vault 목록에 없는 PDF 는 편집할 수 없습니다.'))
    const backup = await backupPathFor(entry.title)
    const meta = await editPdfPages(docId, entry.path, backup, plan)
    await commitReplacedDocument(docId, meta)
    for (const note of notebooks.flatMap((group) => group.notes)) {
      try {
        const document = await readCanvas(vault, note.path)
        if (document === null) continue
        const next = remapNote(document)
        if (next !== null) await writeCanvas(vault, note.path, next as Parameters<typeof writeCanvas>[2])
      } catch {
        // 노트 하나를 못 고쳐도 PDF 편집은 끝났다. 그 노트의 출처만 예전 쪽을 가리킨다.
      }
    }
    return meta
  }, [backupPathFor, commitReplacedDocument, entries, notebooks, vault])

  /**
   * PDF 도구를 원본에 적용한다(OCR 글자 층·쪽 번호·워터마크·여백 자르기처럼 쪽 수·순서가 그대로인 것).
   * 문서 id 는 그대로라 형광펜·메모가 따라온다. 덮기 전 원본은 .iwae/history/pdf-edits 에 남는다.
   */
  const applyDocumentTool = useCallback(async (docId: string, op: PdfToolOp): Promise<PdfToolResult> => {
    if (vault === null) throw new Error(t('Vault가 열려 있지 않습니다.'))
    const entry = entries.find((candidate) => candidate.docId === docId)
    if (entry === undefined) throw new Error(t('Vault 목록에 없는 PDF 는 편집할 수 없습니다.'))
    const backup = await backupPathFor(entry.title)
    const result = await runPdfTool(docId, op, { kind: 'inPlace', path: entry.path, backup })
    if (result === null || result.meta === null) throw new Error(t('PDF 를 고치지 못했습니다'))
    await commitReplacedDocument(docId, result.meta)
    return result
  }, [backupPathFor, commitReplacedDocument, entries, vault])

  /**
   * PDF 도구의 결과를 원본 옆(같은 폴더) 새 PDF 로 쓰고 목록에 올린다. 이름이 겹치면 (2)·(3)… 을 붙인다.
   * 쓴 파일의 절대 경로를 돌려준다.
   */
  const writeDocumentToolCopy = useCallback(async (docId: string, op: PdfToolOp, suffix: string, subfolder?: string, onReport?: (report: PdfToolResult['report']) => void): Promise<string> => {
    if (vault === null) throw new Error(t('Vault가 열려 있지 않습니다.'))
    const entry = entries.find((candidate) => candidate.docId === docId)
    if (entry === undefined) throw new Error(t('Vault 목록에 없는 PDF 입니다.'))
    const { dirname, join } = await import('@tauri-apps/api/path')
    const { exists } = await import('@tauri-apps/plugin-fs')
    const parent = await dirname(entry.path)
    const folder = subfolder === undefined ? parent : await join(parent, subfolder.replace(/[\\/:*?"<>|]/gu, '').trim() || 'PDF')
    const base = `${entry.title} ${suffix}`.replace(/[\\/:*?"<>|]/gu, '').trim()
    let path = await join(folder, `${base}.pdf`)
    for (let n = 2; await exists(path); n += 1) path = await join(folder, `${base} (${n}).pdf`)
    const result = await runPdfTool(docId, op, { kind: 'newFile', path })
    if (result === null) throw new Error(t('새 PDF 를 만들지 못했습니다'))
    onReport?.(result.report)
    await refreshVaultFilesRef.current(vault)
    return result.path
  }, [entries, vault])

  /** PDF 의 글을 원본 옆 Markdown 파일로 쓴다. 쓴 경로 */
  const writeDocumentMarkdown = useCallback(async (docId: string, markdown: string): Promise<string> => {
    if (vault === null) throw new Error(t('Vault가 열려 있지 않습니다.'))
    const entry = entries.find((candidate) => candidate.docId === docId)
    if (entry === undefined) throw new Error(t('Vault 목록에 없는 PDF 입니다.'))
    const { dirname, join } = await import('@tauri-apps/api/path')
    const { exists, writeTextFile } = await import('@tauri-apps/plugin-fs')
    const folder = await dirname(entry.path)
    const base = entry.title.replace(/[\\/:*?"<>|]/gu, '').trim() || 'PDF'
    let path = await join(folder, `${base}.md`)
    for (let n = 2; await exists(path); n += 1) path = await join(folder, `${base} (${n}).md`)
    await writeTextFile(path, markdown)
    await refreshVaultFilesRef.current(vault)
    return path
  }, [entries, vault])

  /** Vault 의 PDF 들(합치기·비교에 고를 것) */
  const vaultPdfs = useMemo(() => entries.map((entry) => ({ docId: entry.docId, title: entry.title, path: entry.path })), [entries])

  /** 경로로 PDF 를 연다(방금 도구로 만든 파일). Vault 목록에 있으면 그것으로, 없으면 밖의 파일처럼 */
  const openPdfAtPath = useCallback(async (path: string) => {
    const key = path.replaceAll('\\', '/').toLocaleLowerCase()
    const entry = entries.find((candidate) => candidate.path.replaceAll('\\', '/').toLocaleLowerCase() === key)
    if (entry !== undefined) await openDocument({ docId: entry.docId, title: entry.title, pages: entry.pages })
    else await openExternalPdf(path)
  }, [entries, openDocument, openExternalPdf])

  const setMarkdownTheme = useCallback(async (nextTheme: MarkdownThemeId) => {
    setMarkdownThemeState(nextTheme)
    if (vault === null) return
    try {
      const metadata = await readVaultMetadata(vault)
      await writeVaultMetadata(vault, updateMarkdownTheme(metadata, nextTheme))
    } catch (err) {
      setError(errorText(err))
      setMarkdownThemeState(parseVaultMetadata(null).markdownTheme)
    }
  }, [vault])

  const refreshVaultFiles = useCallback(async (handle: VaultHandle, orderOverride?: VaultTreeOrder) => {
    // 탐색기로 Vault 폴더에 바로 넣은 PDF 도 목록에 올린다(예전에는 「색인」을 눌러야 보였다)
    await registerUnlistedVaultPdfs(handle).catch(() => [])
    const [rawLibraryEntries, nextTreeEntries, savedIndex] = await Promise.all([
      readLibrary(handle),
      listVaultTree(handle),
      readVaultIndex(handle),
    ])
    const indexedWithLibrary = reconcileVaultIndexFiles(
      reconcileLibraryPdfEntries(savedIndex, rawLibraryEntries, new Date().toISOString()),
      nextTreeEntries,
      new Date().toISOString(),
    )
    const settled = await settleMissingPdfs(handle, rawLibraryEntries, indexedWithLibrary, nextTreeEntries, windowMode.role === 'detached')
    const libraryEntries = settled.library
    const nextIndex = settled.index
    setAbsentDocIds(settled.absentDocIds)
    if (JSON.stringify(nextIndex) !== JSON.stringify(savedIndex)) {
      await writeVaultIndex(handle, nextIndex)
    }
    const groups = buildNotebookTree(nextTreeEntries)
    setEntries(libraryEntries)
    setTreeEntries(nextTreeEntries)
    setNotebooks(groups)
    setVaultIndex(nextIndex.entries)
    setTree(buildVaultWorkspaceTree(
      nextTreeEntries,
      displayEntries(libraryEntries, nextIndex.entries),
      orderOverride ?? treeOrder,
      indexedDisplayNames(nextIndex.entries),
      nextIndex.entries,
    ))
  }, [treeOrder])
  refreshVaultFilesRef.current = refreshVaultFiles

  /** 최근 연 PDF 를 Vault 의 폴더로 가져온다(그 폴더에 복사). 목록에서는 빠진다 */
  const importExternalPdf = useCallback(async (path: string, folderPath: string) => {
    if (vault === null) throw new Error(t('Vault가 열려 있지 않습니다.'))
    const meta = await openPdf(path)
    await attachPdfToLibrary(vault, {
      sourcePath: path,
      title: meta.title,
      pages: meta.pageCount,
      policy: { kind: 'copy-another-folder', folderPath },
    })
    onImportedFromRef.current?.(meta.docId, path)
    await refreshVaultFiles(vault)
    setRecentPdfs((current) => {
      const next = removeRecentPdf(current, path)
      writeRecentPdfs(next)
      return next
    })
  }, [refreshVaultFiles, vault])

  const importDroppedDocuments = useCallback(async (paths: readonly string[]) => {
    const { accepted, rejected } = partitionDroppedDocumentPaths(paths)
    if (vault === null) {
      setError(t('파일을 가져오려면 먼저 Vault를 열어 주세요.'))
      return { imported: 0, rejected: rejected.length, failed: accepted.length }
    }

    setError(null)
    let imported = 0
    let failed = 0
    let firstImported: { kind: 'pdf'; meta: PdfDocMeta } | { kind: 'markdown'; entry: VaultIndexEntry } | null = null

    for (const path of accepted) {
      try {
        if (/\.pdf$/iu.test(path)) {
          const meta = await openPdf(path)
          await attachPdfToLibrary(vault, {
            sourcePath: path,
            title: meta.title,
            pages: meta.pageCount,
            // 끌어 넣은 PDF 는 Vault 맨 위로 복사한다(참조만 하면 원본을 옮기거나 지울 때 Vault 에서 사라진다)
            policy: { kind: 'copy-another-folder', folderPath: '' },
          })
          firstImported ??= { kind: 'pdf', meta }
        } else {
          const entry = await attachMarkdownReference(vault, path)
          firstImported ??= { kind: 'markdown', entry }
        }
        imported += 1
      } catch {
        failed += 1
      }
    }

    if (imported > 0) {
      await refreshVaultFiles(vault)
      if (firstImported?.kind === 'pdf') {
        const { meta } = firstImported
        setOpenedDocs((current) => current.some((item) => item.docId === meta.docId)
          ? current
          : [...current, meta])
        openInPane({ id: meta.docId, title: meta.title, kind: 'pdf' })
      } else if (firstImported?.kind === 'markdown') {
        const { entry } = firstImported
        const source = await readMarkdown(vault, entry.id)
        setMarkdownSources((current) => ({ ...current, [entry.path]: source }))
        openInPane({
          id: entry.path,
          title: entry.displayName,
          kind: 'markdown',
        })
      }
    }

    if (rejected.length > 0 || failed > 0) {
      setError(t('가져오기 완료: {imported}개, 지원하지 않음 {rejected}개, 실패 {failed}개', { imported, rejected: rejected.length, failed }))
    }
    return { imported, rejected: rejected.length, failed }
  }, [refreshVaultFiles, vault])

  /**
   * 탐색기에서 왼쪽 바로 끌어 온 PDF·Markdown 을 Vault 로 복사해 가져온다(기본은 복사 — 원본을 참조만 하지 않는다).
   * folderPath 폴더에 복사하고, place 가 있으면 트리의 그 자리(줄 앞·뒤)에 순서를 둔다. 여러 개면 놓은 차례대로 이어 붙인다.
   * 이미 참조로만 올라 있던 같은 PDF 면 그 폴더로 복사해 Vault 파일로 바꾼다. 첫 문서를 연다.
   */
  const importPdfsAt = useCallback(async (
    paths: readonly string[],
    folderPath: string,
    place?: { readonly nodeId: string; readonly position: 'before' | 'after' | 'inside' },
  ) => {
    if (vault === null) {
      setError(t('파일을 가져오려면 먼저 Vault를 열어 주세요.'))
      return [] as string[]
    }
    setError(null)
    // 가져온(또는 이미 있던) PDF 의 docId, 놓은 차례대로 — 판으로 겹치기에 쓴다
    const pdfDocIds: string[] = []
    // 놓은 차례. PDF 는 트리 id 를 바로 알고, Markdown 은 목록을 새로 읽어 id 가 정해진 뒤에 안다
    const placed: ({ readonly kind: 'pdf'; readonly nodeId: string } | { readonly kind: 'markdown'; readonly relativePath: string })[] = []
    let first: { readonly kind: 'pdf'; readonly meta: PdfDocMeta } | { readonly kind: 'markdown'; readonly relativePath: string } | null = null
    const failures: string[] = []
    const { join } = await import('@tauri-apps/api/path')
    const { copyFile, exists, mkdir } = await import('@tauri-apps/plugin-fs')
    for (const path of paths) {
      const fileName = path.split(/[\\/]/u).at(-1) ?? path
      try {
        if (isMarkdownPath(path)) {
          const relativePath = [folderPath, fileName].filter(Boolean).join('/')
          const directory = folderPath === '' ? vault.root : await join(vault.root, ...folderPath.split('/'))
          const target = await join(directory, fileName)
          if (await exists(target)) throw new Error(t('대상 폴더에 같은 이름의 파일이 이미 있습니다.'))
          await mkdir(directory, { recursive: true })
          await copyFile(path, target)
          placed.push({ kind: 'markdown', relativePath })
          first ??= { kind: 'markdown', relativePath }
          continue
        }
        const meta = await openPdf(path)
        const known = (await readLibrary(vault)).find((entry) => entry.sha256 === meta.sha256)
        if (known !== undefined) {
          // 이미 있다: 참조로만 올라 있으면 이 폴더로 복사해 Vault 파일로 바꾼다. 자리는 그대로 둔다
          if (known.attachmentPolicy?.kind === 'reference' || known.folderPath === undefined) {
            const indexed = (await readVaultIndex(vault)).entries.find((entry) => entry.id === known.docId)
            if (indexed?.storage === 'reference') await convertReferenceToCopy(vault, known.docId, folderPath)
          }
          first ??= { kind: 'pdf', meta }
          pdfDocIds.push(meta.docId)
          continue
        }
        await attachPdfToLibrary(vault, {
          sourcePath: path,
          title: meta.title,
          pages: meta.pageCount,
          policy: { kind: 'copy-another-folder', folderPath },
        })
        onImportedFromRef.current?.(meta.docId, path)
        placed.push({ kind: 'pdf', nodeId: `pdf:${meta.docId}` })
        pdfDocIds.push(meta.docId)
        first ??= { kind: 'pdf', meta }
      } catch (err) {
        failures.push(`${fileName}: ${errorText(err)}`)
      }
    }
    // Markdown 은 목록에 올라야(색인 id 가 생겨야) 트리 자리를 정할 수 있다
    const hasMarkdown = placed.some((item) => item.kind === 'markdown')
    if (hasMarkdown) await refreshVaultFiles(vault)
    const indexEntries = hasMarkdown ? (await readVaultIndex(vault)).entries : []
    const markdownNodeId = (relativePath: string) => {
      const indexed = indexEntries.find((entry) => entry.storage === 'vault' && entry.path.toLocaleLowerCase() === relativePath.toLocaleLowerCase())
      return `markdown:${indexed?.id ?? relativePath}`
    }
    let order: VaultTreeOrder = vaultTreeOrder(tree)
    let target = place === undefined || place.position === 'inside' ? null : place.nodeId
    let position: 'before' | 'after' = place?.position === 'before' ? 'before' : 'after'
    for (const item of placed) {
      const nodeId = item.kind === 'pdf' ? item.nodeId : markdownNodeId(item.relativePath)
      order = placeInTreeOrder(order, { nodeId, fromParent: folderPath, toParent: folderPath, targetNodeId: target, position: target === null ? 'inside' : position })
      target = nodeId
      position = 'after'
    }
    setTreeOrder(order)
    await writeVaultTreeOrder(vault, order).catch(() => {})
    await refreshVaultFiles(vault, order)
    if (first?.kind === 'pdf') {
      const { meta } = first
      setOpenedDocs((current) => current.some((item) => item.docId === meta.docId) ? current : [...current, meta])
      openInPane({ id: meta.docId, title: meta.title, kind: 'pdf' })
    } else if (first?.kind === 'markdown') {
      const { relativePath } = first
      try {
        const source = await readMarkdown(vault, relativePath)
        setMarkdownSources((current) => ({ ...current, [relativePath]: source }))
        openInPane({ id: relativePath, title: (relativePath.split('/').at(-1) ?? relativePath).replace(/\.(?:md|markdown)$/iu, ''), kind: 'markdown' })
      } catch {
        // 열지 못해도 가져오기는 끝났다. 왼쪽 바에서 열면 된다
      }
    }
    if (failures.length > 0) setError(t('{count}개를 가져오지 못했습니다: {names}', { count: failures.length, names: failures.join(', ') }))
    return pdfDocIds
  }, [refreshVaultFiles, tree, vault])

  /**
   * 왼쪽 바 「새로고침」: Vault 폴더를 다시 훑어 목록을 맞추고(탐색기로 넣은 PDF 등록 포함),
   * 열린 Markdown 은 파일에서 다시 읽는다(GitHub 「최신으로」 뒤에도 쓴다).
   */
  const refreshVault = useCallback(async () => {
    if (vault === null) return
    await refreshVaultFiles(vault)
    const paths = Object.keys(markdownSourcesRef.current)
    const reloaded = await Promise.all(paths.map(async (path) => {
      try {
        return [path, await readMarkdown(vault, path)] as const
      } catch {
        return null
      }
    }))
    const fresh = reloaded.filter((item): item is readonly [string, string] => item !== null)
    if (fresh.length > 0) setMarkdownSources((current) => ({ ...current, ...Object.fromEntries(fresh) }))
  }, [refreshVaultFiles, vault])

  const stableFileId = useCallback((idOrPath: string) => (
    vaultIndex.find((entry) => entry.id === idOrPath || entry.path === idOrPath)?.id ?? idOrPath
  ), [vaultIndex])

  const createFolder = useCallback(async (parentPath: string, name: string) => {
    if (vault === null) throw new Error(t('Vault가 열려 있지 않습니다.'))
    await createVaultFolder(vault, parentPath, name)
    await refreshVaultFiles(vault)
  }, [refreshVaultFiles, vault])

  /** 파일을 옮기고 열린 탭 경로를 따라 고친다(목록 새로고침은 부르는 쪽이 한다) */
  const moveEntryFile = useCallback(async (idOrPath: string, destinationFolder: string) => {
    if (vault === null) throw new Error(t('Vault가 열려 있지 않습니다.'))
    const id = stableFileId(idOrPath)
    const previous = vaultIndex.find((entry) => entry.id === id)
    const updated = await moveVaultEntry(vault, id, destinationFolder)
    if (previous !== undefined && previous.path !== updated.path) {
      setPanes((current) => {
        const renamed = mapPaneTabs(current, (tab) => tab.id === previous.path ? { ...tab, id: updated.path } : tab)
        return mapPanes(renamed, (state) => ({ ...state, activeId: state.activeId === previous.path ? updated.path : state.activeId }))
      })
      setMarkdownSources((current) => {
        const source = current[previous.path]
        if (source === undefined) return current
        const next = { ...current, [updated.path]: source }
        delete next[previous.path]
        return next
      })
    }
    return updated
  }, [stableFileId, vault, vaultIndex])

  const moveEntry = useCallback(async (idOrPath: string, destinationFolder: string) => {
    if (vault === null) throw new Error(t('Vault가 열려 있지 않습니다.'))
    await moveEntryFile(idOrPath, destinationFolder)
    await refreshVaultFiles(vault)
  }, [moveEntryFile, refreshVaultFiles, vault])

  /** Vault 안에 Markdown 파일을 새로 만든다. 같은 이름이면 번호를 붙인다. 상대 경로를 돌려준다 */
  const saveMarkdownFile = useCallback(async (folder: string, name: string, content: string) => {
    if (vault === null) throw new Error(t('Vault가 열려 있지 않습니다.'))
    const path = await createMarkdownFile(vault, folder, name, content)
    await refreshVaultFiles(vault)
    return path
  }, [refreshVaultFiles, vault])

  const duplicateEntry = useCallback(async (idOrPath: string, destinationFolder = '') => {
    if (vault === null) throw new Error(t('Vault가 열려 있지 않습니다.'))
    await duplicateVaultEntry(vault, stableFileId(idOrPath), destinationFolder)
    await refreshVaultFiles(vault)
  }, [refreshVaultFiles, stableFileId, vault])

  const trashEntry = useCallback(async (idOrPath: string, source: TrashSource = 'unspecified') => {
    if (vault === null) throw new Error(t('Vault가 열려 있지 않습니다.'))
    const id = stableFileId(idOrPath)
    const entry = vaultIndex.find((candidate) => candidate.id === id)
    await trashVaultEntry(vault, id, source)
    if (itemIcons[id] !== undefined) setItemIcon(id, null)
    if (entry !== undefined) {
      setPanes((current) => closeTabEverywhere(closeTabEverywhere(current, id), entry.path))
      setOpenedDocs((current) => current.filter((document) => document.docId !== id))
      setMarkdownSources((current) => Object.fromEntries(
        Object.entries(current).filter(([path]) => path !== entry.path),
      ))
    }
    await refreshVaultFiles(vault)
  }, [itemIcons, refreshVaultFiles, setItemIcon, stableFileId, vault, vaultIndex])

  /** 폴더 이모지 키(folder:경로)를 폴더 이동에 맞춰 옮기거나(next) 지운다(null) */
  const remapFolderIcons = useCallback((folder: string, next: string | null, extraRemovals: readonly string[] = []) => {
    const prefix = `folder:${folder}`
    const changes: [string, string | null][] = []
    for (const [key, emoji] of Object.entries(itemIcons)) {
      if (key !== prefix && !key.startsWith(`${prefix}/`)) continue
      changes.push([key, null])
      if (next !== null) changes.push([`folder:${next}${key.slice(prefix.length)}`, emoji])
    }
    for (const id of extraRemovals) {
      if (itemIcons[id] !== undefined) changes.push([id, null])
    }
    for (const [key, emoji] of changes) setItemIcon(key, emoji)
    // 폴더 색도 같이 옮긴다
    for (const [key, color] of Object.entries(itemColors)) {
      if (key !== prefix && !key.startsWith(`${prefix}/`)) continue
      setItemColor(key, null)
      if (next !== null) setItemColor(`folder:${next}${key.slice(prefix.length)}`, color)
    }
  }, [itemColors, itemIcons, setItemColor, setItemIcon])

  /** 폴더를 통째로 Vault 휴지통으로 옮긴다. 안의 문서 탭은 닫는다 */
  const trashFolder = useCallback(async (folderPath: string, source: TrashSource = 'unspecified') => {
    if (vault === null) throw new Error(t('Vault가 열려 있지 않습니다.'))
    const folder = folderPath.replaceAll('\\', '/')
    const inside = (path: string) => path === folder || path.startsWith(`${folder}/`)
    const removedIds = await trashVaultFolder(vault, folder, source)
    const removed = new Set(removedIds)
    const removedPaths = vaultIndex.filter((entry) => removed.has(entry.id)).map((entry) => entry.path)
    remapFolderIcons(folder, null, removedIds)
    setPanes((current) => {
      let next = current
      for (const id of removedIds) next = closeTabEverywhere(next, id)
      for (const path of removedPaths) next = closeTabEverywhere(next, path)
      return next
    })
    setOpenedDocs((current) => current.filter((document) => !removed.has(document.docId)))
    setMarkdownSources((current) => Object.fromEntries(
      Object.entries(current).filter(([path]) => !inside(path)),
    ))
    await refreshVaultFiles(vault)
  }, [refreshVaultFiles, remapFolderIcons, vault, vaultIndex])

  /** 폴더 이름을 바꾼다. 열린 노트·Markdown 탭의 경로와 폴더 이모지도 따라간다 */
  const followFolder = useCallback((folder: string, nextFolder: string, order: VaultTreeOrder): VaultTreeOrder => {
    const movePath = (path: string) => path === folder || path.startsWith(`${folder}/`)
      ? `${nextFolder}${path.slice(folder.length)}`
      : path
    remapFolderIcons(folder, nextFolder)
    // 폴더 판 묶음도 따라간다
    window.dispatchEvent(new CustomEvent('iwae:folder-moved', { detail: { from: folder, to: nextFolder } }))
    // GitHub 에서 받은 폴더(또는 그 안)를 옮기면 연결도 따라간다
    if (vault !== null) {
      void githubMoveTarget(vault.root, folder, nextFolder)
        .then(() => window.dispatchEvent(new Event('iwae:github-links-changed')))
        .catch(() => undefined)
    }
    setPanes((current) => {
      const renamed = mapPaneTabs(current, (tab) => ({ ...tab, id: movePath(tab.id) }))
      return mapPanes(renamed, (state) => ({ ...state, activeId: state.activeId === null ? null : movePath(state.activeId) }))
    })
    setMarkdownSources((current) => Object.fromEntries(
      Object.entries(current).map(([path, source]) => [movePath(path), source]),
    ))
    return renameFolderInTreeOrder(order, folder, nextFolder)
  }, [remapFolderIcons, vault])

  const renameFolder = useCallback(async (folderPath: string, name: string) => {
    if (vault === null) throw new Error(t('Vault가 열려 있지 않습니다.'))
    const folder = folderPath.replaceAll('\\', '/')
    const nextFolder = await renameVaultFolder(vault, folder, name)
    if (nextFolder === folder) return
    const nextOrder = followFolder(folder, nextFolder, treeOrder)
    setTreeOrder(nextOrder)
    await writeVaultTreeOrder(vault, nextOrder).catch(() => {})
    await refreshVaultFiles(vault, nextOrder)
  }, [followFolder, refreshVaultFiles, treeOrder, vault])

  /**
   * 왼쪽 트리에서 항목(여러 개면 고른 차례대로)을 아무 자리에 놓는다. 부모 폴더가 바뀌면 실제 파일·폴더를
   * 옮기고, 놓은 자리에 순서를 둔다(이름순이 아니라 놓은 위치가 그대로 남는다). 둘째부터는 앞 항목 바로 뒤에 붙는다.
   * 하나가 실패해도 나머지는 옮기고, 실패한 것을 모아 알린다.
   */
  const placeTreeNodes = useCallback(async (
    nodes: readonly { readonly nodeId: string; readonly fromParent: string }[],
    place: Pick<VaultTreePlaceRequest, 'toParent' | 'targetNodeId' | 'position'>,
  ) => {
    if (nodes.length === 0) return
    if (vault === null) {
      let target = place.targetNodeId
      let position = place.position
      for (const node of nodes) {
        const targetNodeId = target
        if (node.fromParent === place.toParent && targetNodeId !== null && position !== 'inside') {
          const at = position === 'before' ? 'before' : 'after'
          setTree((current) => reorderVaultTreeNode(current, { parentPath: place.toParent, nodeId: node.nodeId, targetNodeId, position: at }))
          target = node.nodeId
          position = 'after'
        }
      }
      return
    }
    let order: VaultTreeOrder = vaultTreeOrder(tree)
    let target = place.targetNodeId
    let position = place.position
    const failures: string[] = []
    for (const node of nodes) {
      let newNodeId = node.nodeId
      try {
        if (node.fromParent !== place.toParent) {
          const separator = node.nodeId.indexOf(':')
          const kind = node.nodeId.slice(0, separator)
          const key = node.nodeId.slice(separator + 1)
          if (kind === 'folder') {
            const nextFolder = await moveVaultFolder(vault, key, place.toParent)
            order = followFolder(key, nextFolder, order)
            newNodeId = `folder:${nextFolder}`
          } else {
            const updated = await moveEntryFile(key, place.toParent)
            if (kind === 'note') newNodeId = `note:${updated.path}`
            else if (kind === 'markdown') newNodeId = `markdown:${updated.id}`
          }
        }
      } catch (err) {
        failures.push(errorText(err))
        continue
      }
      order = placeInTreeOrder(order, { nodeId: node.nodeId, fromParent: node.fromParent, toParent: place.toParent, targetNodeId: target, position }, newNodeId)
      if (position !== 'inside') {
        target = newNodeId
        position = 'after'
      }
    }
    setTreeOrder(order)
    await writeVaultTreeOrder(vault, order).catch(() => {})
    await refreshVaultFiles(vault, order)
    if (failures.length > 0) throw new Error(t('{count}개를 옮기지 못했습니다: {names}', { count: failures.length, names: failures.join(', ') }))
  }, [followFolder, moveEntryFile, refreshVaultFiles, tree, vault])

  const placeTreeNode = useCallback(
    (request: VaultTreePlaceRequest) => placeTreeNodes([{ nodeId: request.nodeId, fromParent: request.fromParent }], request),
    [placeTreeNodes],
  )

  const convertEntryToCopy = useCallback(async (idOrPath: string, destinationFolder = '') => {
    if (vault === null) throw new Error(t('Vault가 열려 있지 않습니다.'))
    await convertReferenceToCopy(vault, stableFileId(idOrPath), destinationFolder)
    await refreshVaultFiles(vault)
  }, [refreshVaultFiles, stableFileId, vault])

  const copyEntryPath = useCallback(async (idOrPath: string) => {
    if (vault === null) throw new Error(t('Vault가 열려 있지 않습니다.'))
    return copyVaultEntryPath(vault, stableFileId(idOrPath))
  }, [stableFileId, vault])

  /**
   * Markdown 을 PDF 로 바꿔 PDF 리더로 연다(PDF 와 같은 화면·메모·편집·검색·판 관리). 문서 id 는 색인 id 그대로라
   * 형광펜·메모·출처·판 묶음이 그 Markdown 에 붙는다. 바꾸지 못하면(Edge 없음 등) null
   */
  const markdownAsPdf = useCallback(async (handle: VaultHandle, indexId: string, path: string, storage: 'vault' | 'reference', title: string, source: string): Promise<PdfDocMeta | null> => {
    if (!isDesktop() || !MARKDOWN_AS_PDF) return null
    try {
      const { join } = await import('@tauri-apps/api/path')
      const absolute = storage === 'reference' ? path : await join(handle.root, ...path.split('/'))
      const pdfPath = await markdownToPdf(handle.root, markdownPdfKey(indexId, source), markdownPdfHtml(source, title, absolute))
      const meta = await openPdf(pdfPath, indexId)
      return { ...meta, title }
    } catch (err) {
      setError(t('Markdown 을 리더 화면으로 열지 못해 간단 보기로 엽니다: {error}', { error: errorText(err) }))
      return null
    }
  }, [])

  /** Markdown 을 연다(가능하면 PDF 화면으로). openTab 이 false 면 열어 두기만 한다(탭 안에서 판을 바꿀 때). PDF 로 연 메타를 돌려준다 */
  const openMarkdown = useCallback(async (markdown: VaultMarkdownNode, openTab = true): Promise<PdfDocMeta | null> => {
    setError(null)
    if (vault === null) {
      if (markdownSources[markdown.path] === undefined) return null
      openInPane({
        id: markdown.path,
        title: markdown.name,
        kind: 'markdown',
      })
      return null
    }
    try {
      const source = await readMarkdown(vault, markdown.storage === 'reference' ? markdown.indexId : markdown.path)
      const fileId = vaultIndex.find((entry) => entry.path === markdown.path)?.id
      if (fileId !== undefined) {
        setExtractedSearchText((current) => ({ ...current, [fileId]: source }))
        recordFileOpened(fileId)
      }
      setMarkdownSources((current) => ({ ...current, [markdown.path]: source }))
      const meta = await markdownAsPdf(vault, markdown.indexId, markdown.storage === 'reference' ? (vaultIndex.find((entry) => entry.id === markdown.indexId)?.path ?? markdown.path) : markdown.path, markdown.storage === 'reference' ? 'reference' : 'vault', markdown.name, source)
      if (meta !== null) {
        setOpenedDocs((current) => [...current.filter((item) => item.docId !== meta.docId), meta])
        if (openTab) openInPane({ id: meta.docId, title: markdown.name, kind: 'pdf' })
        return meta
      }
      if (openTab) {
        openInPane({
          id: markdown.path,
          title: markdown.name,
          kind: 'markdown',
        })
      }
      return null
    } catch (err) {
      setError(errorText(err))
      return null
    }
  }, [markdownAsPdf, markdownSources, recordFileOpened, vault, vaultIndex])

  const relink = useCallback(async (docId: string) => {
    if (vault === null) return
    setError(null)
    try {
      const path = await pickPdfFile()
      if (path === null) return
      const updated = await relinkDocument(vault, docId, path)
      const meta = await openPdf(updated.path)
      setEntries((current) => current.map((entry) => entry.docId === docId ? updated : entry))
      setOpenedDocs((current) => [
        ...current.filter((doc) => doc.docId !== docId),
        meta,
      ])
      setMissingDocIds((current) => current.filter((id) => id !== docId))
      openInPane({ id: meta.docId, title: meta.title, kind: 'pdf' })
    } catch (err) {
      setError(errorText(err))
    }
  }, [vault])

  const closeVault = useCallback(() => {
    searchGenerationRef.current += 1
    setVault(null)
    setEntries([])
    setNotebooks([])
    setTreeEntries([])
    setTreeOrder({})
    setVaultIndex([])
    setDirtyFileIds(new Set())
    setConflictFileIds([])
    setTree([])
    setOpenedDocs([])
    const fresh = blankScreen(t('읽기'))
    const freshId = leaves(fresh.layout)[0]!
    paneRouteRef.current = { doc: freshId, note: freshId }
    setScreensState({ screens: [fresh], activeScreen: fresh.id, lastScreen: null })
    setMarkdownSources({})
    setMissingDocIds([])
    setSessionReady(false)
    setMarkdownThemeState('light')
    setFileActivity({})
    setItemIcons({})
    setNoteOrderState([])
    setExtractedSearchText({})
    setExtractedSearchPages({})
    setSearchIndexProgress({ indexed: 0, total: 0 })
    setError(null)
  }, [])

  const reloadWatchedFile = useCallback((id: string) => {
    if (vault === null) return
    // 폴더 이름을 바꾸거나 파일을 옮긴 직후에는 감시자가 옛 경로로 다시 읽으려 한다.
    // 그때 색인은 아직 옛 경로라 "경로를 찾을 수 없습니다" 가 나는데, 곧 목록을 새로 읽으며 맞춰지므로 알리지 않는다.
    const reportReloadError = (err: unknown) => {
      if (!isMissingPathError(err)) setError(errorText(err))
    }
    const entry = vaultIndex.find((candidate) => candidate.id === id)
    if (entry === undefined) return
    if (entry.kind === 'markdown' && entry.storage === 'vault') {
      void readMarkdown(vault, entry.path).then((source) => {
        setMarkdownSources((current) => ({ ...current, [entry.path]: source }))
        setExtractedSearchText((current) => ({ ...current, [entry.id]: source }))
      }).catch(reportReloadError)
      return
    }
    if (entry.kind === 'pdf') {
      // 색인의 Vault PDF 경로는 Vault 기준 상대 경로다. 그대로 넘기면 PDF 엔진이 앱 폴더 기준으로 찾다
      // "경로를 찾을 수 없습니다" 가 난다(파일을 옮긴 직후 감시자가 다시 읽을 때). 절대 경로로 바꾼다.
      const absolutePath = async () => {
        const known = entries.find((doc) => doc.docId === entry.id)?.path
        if (known !== undefined && entry.storage !== 'vault') return known
        if (entry.storage !== 'vault') return entry.path
        const { join } = await import('@tauri-apps/api/path')
        return join(vault.root, ...entry.path.split('/'))
      }
      void absolutePath().then((path) => openPdf(path, entry.id)).then((document) => {
        setOpenedDocs((current) => [
          ...current.filter((candidate) => candidate.docId !== document.docId),
          document,
        ])
      }).catch(reportReloadError)
    }
  }, [entries, vault, vaultIndex])

  /**
   * 문서 id(색인 id = MCP 의 doc_id)로 PDF 를 열어 메타와 표시 이름을 준다. 탭은 열지 않는다.
   * 바깥 AI 가 캔버스에 발췌를 넣을 때 쪽 크기·글자 상자를 얻으려고 쓴다.
   */
  const loadPdfById = useCallback(async (docId: string): Promise<{ meta: PdfDocMeta; title: string }> => {
    if (vault === null) throw new Error(t('열린 Vault 가 없습니다.'))
    const entry = vaultIndex.find((candidate) => candidate.id === docId && candidate.kind === 'pdf')
    if (entry === undefined) throw new Error(t('그 PDF 를 찾지 못했습니다: {docId}', { docId }))
    const known = entries.find((doc) => doc.docId === entry.id)?.path
    let path = entry.path
    if (entry.storage === 'vault') {
      const { join } = await import('@tauri-apps/api/path')
      path = await join(vault.root, ...entry.path.split('/'))
    } else if (known !== undefined) {
      path = known
    }
    const meta = await openPdf(path, entry.id)
    return { meta, title: entry.displayName || meta.title }
  }, [entries, vault, vaultIndex])

  const reportWatchedConflict = useCallback((id: string) => {
    const report = () => {
      setConflictFileIds((current) => current.includes(id) ? current : [...current, id])
      setError(t('외부 변경과 저장되지 않은 변경이 충돌했습니다.'))
    }
    const entry = vaultIndex.find((candidate) => candidate.id === id)
    if (vault === null || entry === undefined || entry.storage !== 'vault') {
      report()
      return
    }
    // 감시는 앱 자신의 저장도 알린다. 디스크 내용이 앱이 마지막으로 쓴 것과 같으면 충돌이 아니다
    void isOwnLatestWrite(vault, entry.path).then((own) => {
      if (!own) report()
    })
  }, [vault, vaultIndex])

  const setFileDirty = useCallback((path: string, dirty: boolean) => {
    const normalized = path.replaceAll('\\', '/').toLocaleLowerCase()
    const id = vaultIndex.find((entry) => (
      entry.storage === 'vault' && entry.path.toLocaleLowerCase() === normalized
    ))?.id
    if (id === undefined) return
    setDirtyFileIds((current) => {
      const next = new Set(current)
      if (dirty) next.add(id)
      else next.delete(id)
      return next
    })
  }, [vaultIndex])

  // 탐색기에서 PDF 를 넣거나 지우면(파일 감시) 새로 고침과 같이 디스크와 맞춘다. 연달아 오는 알림은 한 번으로 묶는다
  const reindexTimerRef = useRef<number | null>(null)
  const reindexWatchedFiles = useCallback(() => {
    if (vault === null) return
    if (reindexTimerRef.current !== null) window.clearTimeout(reindexTimerRef.current)
    reindexTimerRef.current = window.setTimeout(() => {
      reindexTimerRef.current = null
      void refreshVaultFilesRef.current(vault).catch((err: unknown) => setError(errorText(err)))
    }, 400)
  }, [vault])

  useVaultWatcher({
    vaultPath: vault?.root ?? null,
    index: vaultIndex,
    dirtyIds: dirtyFileIds,
    onReload: reloadWatchedFile,
    onConflict: reportWatchedConflict,
    onReindex: reindexWatchedFiles,
  })

  // 다른 창이 Vault 목록·색인·순서·설정을 고치면 이 창도 디스크 내용을 다시 읽는다(.iwae 는 파일 감시가 무시한다)
  const reindexRef = useRef(reindexWatchedFiles)
  reindexRef.current = reindexWatchedFiles
  useEffect(() => {
    if (vault === null || injected) return undefined
    const handle = vault
    const stops = [
      subscribeVaultFile(handle, 'library.json', SIGNAL_CODEC, () => reindexRef.current()),
      subscribeVaultFile(handle, 'index.json', SIGNAL_CODEC, () => reindexRef.current()),
      subscribeVaultFile(handle, 'tree-order.json', SIGNAL_CODEC, () => {
        void readVaultTreeOrder(handle).then((order) => {
          treeOrderRef.current = order
          setTreeOrder(order)
          reindexRef.current()
        }).catch(() => undefined)
      }),
      subscribeVaultFile(handle, 'metadata.json', SIGNAL_CODEC, () => {
        void readVaultMetadata(handle).then((metadata) => {
          setMarkdownThemeState(metadata.markdownTheme)
          setItemIcons(metadata.itemIcons)
          setItemColors(metadata.itemColors ?? {})
          setNoteOrderState(metadata.noteOrder ?? [])
          // 읽던 쪽·마지막으로 연 때는 이 창이 방금 정한 값을 지우지 않는다(다른 창은 즐겨찾기만 따라온다)
          setFileActivity((current) => {
            const next: Record<string, VaultFileActivity> = { ...metadata.fileActivity }
            for (const [id, local] of Object.entries(current)) {
              const remote = next[id]
              next[id] = remote === undefined ? local : { ...remote, ...(local.lastPage === undefined ? {} : { lastPage: local.lastPage }), lastOpenedAt: local.lastOpenedAt ?? remote.lastOpenedAt }
            }
            return next
          })
        }).catch(() => undefined)
      }),
    ]
    return () => { for (const stop of stops) stop() }
  }, [injected, vault])

  // 다른 창이 쪽 편집·PDF 도구로 파일을 바꿨다: 목록의 해시가 달라진 문서는 다시 열어 쪽 수·크기·그림을 새로 한다
  const refreshedHashesRef = useRef(new Set<string>())
  useEffect(() => {
    if (vault === null || injected) return
    for (const stale of findStaleDocuments(openedDocs, entries, refreshedHashesRef.current)) {
      refreshedHashesRef.current.add(stale.key)
      invalidateDocument(stale.docId)
      void openPdf(stale.path, stale.docId).then((meta) => {
        setOpenedDocs((current) => current.map((candidate) => candidate.docId === meta.docId ? meta : candidate))
      }).catch(() => undefined)
    }
  }, [entries, injected, openedDocs, vault])

  const displayedLibrary = useMemo(
    () => injected ? injectedLibrary : displayEntries(entries, vaultIndex),
    [entries, injected, injectedLibrary, vaultIndex],
  )
  const searchRecords = useMemo<readonly VaultSearchRecord[]>(() => {
    if (!injected) return buildSearchRecords(vaultIndex, extractedSearchText, fileActivity, extractedSearchPages)
    return injectedLibrary.map((entry) => ({
      id: entry.docId,
      kind: 'pdf',
      storage: 'reference',
      path: entry.folderPath === undefined ? entry.title : `${entry.folderPath}/${entry.title}`,
      folder: entry.folderPath ?? '',
      filename: entry.title,
      displayName: entry.title,
      extractedText: '',
      pages: [],
      missing: false,
      favorite: false,
      lastOpenedAt: null,
      addedAt: '',
    }))
  }, [extractedSearchPages, extractedSearchText, fileActivity, injected, injectedLibrary, vaultIndex])

  /** 설정 「색인 다시 만들기」: 저장해 둔 글자를 지우고 Vault 를 다시 읽으며 모든 PDF 를 새로 읽는다 */
  const rebuildSearchIndex = useCallback(async () => {
    if (vault === null) return
    await writeVaultSearchTextCache(vault, emptyVaultSearchTextCache())
    setExtractedSearchPages({})
    setExtractedSearchText({})
    forceIndexRef.current = true
    await loadVault(vault)
  }, [loadVault, vault])

  return {
    flushSession,
    rebuildSearchIndex,
    initializing,
    vault,
    library: displayedLibrary,
    notebooks,
    tree,
    openedDocs,
    panes,
    setPanes,
    channels,
    setChannels,
    paneLayout,
    setPaneLayout,
    setWorkspace,
    screens: screensState.screens,
    activeScreenId: screensState.activeScreen,
    lastScreenId: screensState.lastScreen,
    screensState,
    zoomedPane: activeScreen.zoomed,
    screenOps,
    openInPane,
    moveTab,
    setPaneRoute,
    paneRouteRef,
    sidebarCollapsed,
    setSidebarCollapsed,
    layout,
    setLayout,
    missingDocIds,
    conflictFileIds,
    searchRecords,
    searchIndexProgress,
    setDirtyFileIds,
    setFileDirty,
    setFileFavorite,
    itemIcons,
    noteOrder,
    setNoteOrder,
    itemColors,
    recentPdfs: recentPdfs.filter((recent) => !entries.some((entry) => samePath(entry.path, recent.path))),
    openExternalPdf,
    importExternalPdf,
    forgetRecentPdf,
    setItemColor,
    setItemIcon,
    readingPositions,
    recordReadingPosition,
    markdownSources,
    markdownTheme,
    recentVaultPaths,
    setMarkdownTheme,
    error,
    dismissError: () => setError(null),
    sessionName,
    // 아직 파일이 없는 새 Vault(또는 Vault 가 없을 때)도 지금 세션 하나는 있다
    sessionNames: sessionNames.length === 0 ? [sessionName] : sessionNames,
    sessionEpoch,
    sessionOps,
    /** 세션에 붙은 앱 창들(동기화 · 소유자 · 목록) */
    clients,
    clientHooksRef,
    setWindowHidden,
    loadVault,
    openVaultPath,
    closeVault,
    openDocument,
    addDocument,
    importDroppedDocuments,
    importPdfsAt,
    refreshVault,
    addNote,
    createCanvasNote,
    createFolder,
    saveMarkdownFile,
    moveEntry,
    placeTreeNode,
    placeTreeNodes,
    duplicateEntry,
    trashEntry,
    trashFolder,
    renameFolder,
    convertEntryToCopy,
    copyEntryPath,
    reorderTreeNode,
    renameEntry,
    openMarkdown,
    relink,
    editDocumentPages,
    applyDocumentTool,
    writeDocumentToolCopy,
    writeDocumentMarkdown,
    vaultPdfs,
    openPdfAtPath,
    loadPdfById,
  }
}
