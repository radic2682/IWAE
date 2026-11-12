import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { translateWithCacheUsing, useTranslationCacheBridge } from './translationCacheStore'
import { clearUndo, redo as redoChange, undo as undoChange } from './undoStack'
import { CommandPalette, type PaletteCommand } from './CommandPalette'
import { ShortcutOverlay } from './ShortcutOverlay'
import { PREFIX_KEY_ID, comboText, effectiveKeys, getShortcutDef, getShortcutOverrides, shortcutText, withBinding } from '../core/shortcutRegistry'
import { parseKeysConf } from '../core/keysConf'
import { InputSettings, SearchSettings } from './BehaviorSettings'
import { APP_COMMAND_EVENT } from '../ui/documentContextMenu'
import { CANVAS_ENABLED, SPLIT_PANES_ENABLED } from '../core/features'
import { onOpenFiles, openDefaultAppsSettings, takeOpenFiles } from '../bridge/openFiles'
import { dropZoneAt, type DropZone, type TreeDropPlace } from './dropZone'
import { ArrowLineDownRight, Minus, X } from '@phosphor-icons/react'
import { updatePersistentPdfHighlight } from '../pdf/persistentHighlight'
import { SplitPanes, type FocusedPane } from './SplitPanes'
import { NoticeStack, ErrorNotice } from './NoticeStack'
import { AiActivityPill } from './AiActivityPill'
import { liveCanvas, registerLiveCanvas } from './liveCanvasRegistry'
import { useMcpCanvasBridge } from './useMcpCanvasBridge'
import { announceAction } from './actionFeedback'
import { exportPdfImages, isPasswordProtectedDoc, pageTextIndex, pdfBlankPages, pdfOutline, setPdfPasswordPrompt, type SearchablePdfPage } from '../bridge/pdf'
import { PdfToolForm, type PdfToolId, type PdfToolViewId } from './PdfToolsDialog'
import { PdfToolsPanel } from './PdfToolsPanel'
import { PdfPasswordDialog } from './PdfPasswordDialog'
import { buildFlattenOp, countMarks } from '../core/pdfToolOps'
import { getHighlightColors } from './highlightColorStyle'
import { setHighlightColorUsage } from './highlightColorUsage'
import { countByHighlightColor } from '../core/highlightColors'
import { diffLines, pageLines } from '../core/pdfTextDiff'
import { getPdfToolJob, setPdfToolJob } from '../pdf/pdfToolJobs'
import { setOverlayTool } from '../pdf/overlayToolStore'
import { recognizePdfPageLines } from '../pdf/pdfOcrText'
import { detectPageRotation } from '../pdf/pdfPageOrientation'
import type { PageTextIndex } from '../core/textIndex'
import type { PersistentPdfHighlight } from '../pdf/persistentHighlight'
import { MemoNoteContext, requestTitleEdit, type MemoNoteApi } from '../pdf/memoNoteContext'
import { MemoNoteTabView } from '../pdf/MemoNoteTabView'
import { useFollowMovedMemoNotes, useSyncMemoNoteTabs } from './useMemoNoteTabs'
import { blocksForTarget, pickCanvasPane, visibleCanvasPanes, type PointableHighlight } from './canvasWorkspace'
import { createNoteBesideOpener, pickNotePath, placeNoteTab, type NoteBesideOpener, type NoteBesideHost } from './noteBeside'
import { applyLayoutPreset, availableScreenTemplates, buildTemplateScreen, templateScreenName, type LayoutPresetId, type ScreenTemplateId } from './layoutPresets'
import { activeScreenOf, allScreenPaneIds, workspaceOf } from './screens'
import { pickByName, runCommandLine, type CommandHost, type CommandResult, type PaneRect, type WorkspaceModel } from './workspaceCommands'
import { usePrefixMode } from './usePrefixMode'
import { summarizeWorkspace, type McpWorkspaceState } from './mcp/workspaceCommand'
import { PaneNumbersOverlay } from './PaneNumbersOverlay'
import { PaneHead } from './PaneHead'
import { EmptyPane, type EmptyPaneRecent } from './EmptyPane'
import { PrefixChip } from './PrefixChip'
import { TopBarToolbarContext } from './topBarToolbar'
import { reactingPanes } from './paneReaction'
import { KeysHelpSheet } from './KeysHelpSheet'
import { TranslatorPanel } from './TranslatorPanel'
import { finishLegacyTranslatorMigration, readLegacyTranslatorPanels, toggleTranslatorWindow, translatorWindowFromLegacy, updateTranslatorWindow, useTranslatorWindow } from './translatorPanelState'
import { closeFloat, embedPane, floatIdsOf, floatOf, floatPane, patchFloat, raiseFloat, visibleFloats, type FloatOutcome } from './floatingPanes'
import { setFloatingLinkPanes } from './workspaceLinks'
import { barMigrationKey, legacyBarWasOpen, migrateNoteBar } from './noteBarMigration'
import { useMemoNotes } from './useMemoNotes'
import { useMouseGestures } from './useMouseGestures'
import { useSmoothWheel } from './useSmoothWheel'
import { memoFolderIconKey, memoNoteIconKey } from './MemoNotesSection'
import { memoNoteAbsolutePath, revealMemoNote } from '../bridge/memoNotes'
import { copyFileToClipboard, revealInFolder } from '../bridge/vaultBackup'
import { docNoteTitle, memoNoteOwner, memoNotesFolder, memoNoteTitleOf, orderMemoNoteEntries } from '../core/memoNote'
import { useMcpMemoBridge } from './useMcpMemoBridge'
import type { MemoCategorySummary } from './Sidebar'
import { Sidebar, SidebarFooter } from './Sidebar'
import { PaneShell } from './PaneShell'
import { DocumentView, type DocumentViewController, type DocumentViewState } from './DocumentView'
import { DocumentSearchPanel, SearchScopeSwitch, useDocumentSearch } from './DocumentSearchPanel'
import { PageEditDialog } from './PageEditDialog'
import { forgetPageEditDraft, setPageDragHost } from './pageDrag'
import { pageMoves, remapAnchor, remapDocumentReferences, type PageEditItem, type PageRotation } from '../core/pdfPageEdit'
import type { CanvasTranslationResult, ReaderExcerptInsertRequest } from './NoteCanvas'
import { createInitialCanvasDocument } from '../core/initialCanvasDocument'
import {
  createBrowserCanvasStorage,
  createMemoryCanvasStorage,
  createVaultCanvasStorage,
  flushCanvasSaves,
  useCanvasAutosave,
  type CanvasStorage,
} from './useCanvasAutosave'
import {
  createBrowserBlockPresetStorage,
  createVaultBlockPresetStorage,
  useBlockPresets,
  type BlockPresetStorage,
} from './useBlockPresets'
import { SourceTrace } from './SourceTrace'
import { useWorkspaceSources, type WorkspaceSourceState } from './useWorkspaceSources'
import { TranslationSettings } from './TranslationSettings'
import { SettingsModal } from './SettingsModal'
import { AboutDialog } from './AboutDialog'
import { ReportProblemDialog } from './ReportProblemDialog'
import { ThemeSettings } from './ThemeSettings'
import { UiScaleSettings, useUiScale } from './UiScaleSettings'
import { LanguageSettings } from './LanguageSettings'
import { UsageMeterSettings } from './UsageMeterSettings'
import { useTheme } from './useTheme'
import type { MarkdownExcerptDragPayload, MarkdownSourceJumpRequest } from '../core/markdownExcerpt'
import type { MarkdownSelectionTranslation } from './MarkdownPane'
import type { SourceOpenRequest } from './CanvasBlockShell'
import { useAppShortcuts, type AppShortcutActions } from './useAppShortcuts'
import { useNavigationHistory } from './useNavigationHistory'
import type { NavLocation } from '../core/navigationHistory'
import { normalizeSelectionText } from '../core/translationText'
import { externalProviderInfo } from '../core/translationSettings'
import { useTranslation } from './useTranslation'
import {
  createBrowserPdfHighlightStorage,
  createVaultPdfHighlightStorage,
  usePdfHighlights,
} from './usePdfHighlights'
import {
  createBrowserMarkdownHighlightStorage,
  createVaultMarkdownHighlightStorage,
  useMarkdownHighlights,
} from './useMarkdownHighlights'
import {
  createBrowserPdfBookmarkStorage,
  createVaultPdfBookmarkStorage,
  usePdfBookmarks,
} from './usePdfBookmarks'
import { pdfBookmarkId } from '../core/pdfBookmarks'
import { PaneTabsMenu } from './PaneTabsMenu'
import { NoteHeadMenu } from './NoteHeadMenu'
import { allowedDockEdges, closePaneTree, collapseEmptyPane, dockTab, dropTabAt, moveTabToPaneAt, type DockEdge, type TabDropTarget } from './tabDock'
import type { SidebarDropItem, SidebarPaneDrop } from './dockSession'
import { moveTabToNewPane, setPaneCountTree, splitPane, swapSplitSides } from './paneLayoutOps'
import { MAX_PANES, leaves, swapLeaves, type LayoutNode, type Size, type SplitDir, type SplitRefusal } from '../core/layoutTree'
import { channelOf, cyclePaneChannel, type Channel, type PaneChannel, type PaneChannels } from './workspaceChannels'
import { setAppPref, useAppPrefs } from './appPrefs'
import { PaneIdContext, WorkspaceContext, type WorkspaceLink } from './workspaceContext'
import { emitPointSignal, subscribePointSignal, type DeliveredSignal, type PointTarget } from './workspaceSignal'
import { activeKindOf, isNoteSurface, memoNoteTargetFor, needForMemo, needForPlace, resolvePointSignal, visibleNotePathsIn } from './workspaceRouting'
import { TopBar, type SidebarMode } from './TopBar'
import { OutlinePanel, ThumbnailPanel } from './SidePanels'
import { MarkdownOutline, MarkdownSectionPreview } from './MarkdownOutline'
import { VaultPicker } from './VaultPicker'
import { seedSampleVaultInto } from './sampleVaultDesktop'
import { StartupShell } from './StartupShell'
import { useVault } from './useVault'
import type { DocZoom } from '../core/windowMode'
import {
  emptyTabs,
  openTab,
  activateTab,
  reorderTab,
  replaceTab,
  activeTab,
  closeTabEverywhere,
  nextViewTabId,
  otherPane,
  allPaneTabs,
  closePaneInto,
  paneIdsOf,
  paneLabel,
  paneOfTab,
  pinTabInPanes,
  tabsOf,
  type TabsState,
  tabDocId,
  isDocumentKind,
  paneRouteOf,
  type PaneId,
  type PanesState,
  type Tab,
} from './tabs'
import type { LibraryDoc, NotebookGroup, VaultMarkdownNode, VaultTreeNode } from '../core/vaultTree'
import type { LibraryOpenTarget } from '../core/libraryItems'
import type { Anchor } from '../core/anchor'
import type { AiPointer } from '../pdf/AiPointerLayer'
import type { PdfExcerptSelection, SourceJumpRequest } from '../core/pdfExcerpt'
import { OPEN_TRANSLATION_SETTINGS_EVENT, type PdfSelectionTranslation } from '../pdf/SelectionActions'
import { TranslationCardSettingsContext, type TranslationCardSettings } from '../ui/TranslationCard'
import { TranslatorContext, type TranslatorService } from './translatorContext'
import type { PdfDocMeta } from '../bridge/pdf'
import type { CanvasBlockData } from '../core/canvasDocument'
import type { CanvasDocumentV2 } from '../core/canvasDocument'
import type { UserBlockPreset } from '../core/blockPresets'
import type { VaultSearchHit } from '../core/vaultSearch'
import { MarkdownThemeSettings } from './MarkdownThemeSettings'
import { VaultRecoveryDialog } from './VaultRecoveryDialog'
import { VaultBackupSettings } from './VaultDataTools'
import { DocSourcesDialog } from './DocSourcesDialog'
import { StackVersionsDialog, type StackDoc } from './StackVersionsDialog'
import { VersionMenu } from './VersionMenu'
import { useVersionGroups } from './useVersionGroups'
import { usePdfOverlays } from './usePdfOverlays'
import { findVersionSibling, groupOfDoc, groupTitleFromDocTitle, guessVersionLabel, matchVersionPage, type VersionGroup } from '../core/versionGroups'
import { useDocSources } from './useDocSources'
import { sourceTargetKind, type DocSource } from '../core/docSources'
import { AutoBackupSettings } from './AutoBackupSettings'
import { useAutoBackup } from './useAutoBackup'
import { UpdateBanner } from './UpdateBanner'
import { ExternalLinkConfirm } from './ExternalLinkConfirm'
import { ConfirmDialog } from './ConfirmDialog'
import { GithubChangesDialog, GithubImportDialog, GithubVersionsDialog } from './GithubDialogs'
import { githubCheckout, githubClone, githubFetch, githubList, githubPull, githubRefs, type GithubSource } from '../bridge/github'
import { isPowerPointPath, officeToPdf } from '../bridge/office'
import { isMacPlatform } from '../core/platform'
import { BibliographyDialog } from './BibliographyDialog'
import { useBibliography } from './useBibliography'
import { useInteropActions } from './useInteropActions'
import { exportNotesAsMarkdown } from './markdownExportActions'
import { AnnotationOfferBanner } from './AnnotationOfferBanner'
import { toBibtex } from '../core/bibliography'
import { readPdfViewPrefs, writePdfViewPrefs, type PdfRotation, type PdfViewPrefs } from '../core/pdfViewPrefs'
import { EXTERNAL_LINK_REQUEST_EVENT, openExternalUrl } from '../bridge/external'
import { aiSetVault, listenAiLocation, ragIndex, type AiLocation } from '../bridge/ai'
import { AiLocationInbox } from './AiLocationInbox'
import { AiSettings } from './AiSettings'
import { buildAnchor } from '../core/anchor'
import { errorText } from '../core/errorText'
import { UpdateSettings } from './UpdateSettings'
import { WhatsNewHost } from './WhatsNewDialog'
import { PrefixKeyHost } from './PrefixKeyDialog'
import { useUpdater } from './useUpdater'
import packageMetadata from '../../package.json'
import developmentMarkdown from '../fixtures/development-note.md?raw'
import { createDevelopmentCanvasDocument } from '../fixtures/developmentCanvasDocument'
import { createOllamaTranslationProvider } from '../bridge/translation'
import { runAfterCanvasFlush } from './canvasClose'
import { buildEvidenceHtml, createCanvasRasterizer, saveHtmlFile } from './exportEvidence'
import { closeWindow, currentWindowLabel, interceptWindowClose, isDesktop } from '../bridge/window'
import { beginTabDrag, closeSecondaryWindows, destroyAppWindow, focusThisWindow, onCloseNow, onReattach, onTabDragReleased, onTabHover, onTabZonesRequest, openAppWindow, reportTabZones, sendReattach, sendTabDrop, type ReattachRequest } from '../bridge/windows'
import { clearExternalTabHover, holdTabFlip, insertionIndexInPane, showExternalTabHover, tabZoneRects, type TearOffInfo } from './tabDrag'
import { currentWindowMode, ownsSession, windowQuery } from '../core/windowMode'
import { closePlan, detachPlan, findClient, newClientPlan } from '../core/clients'
import { hideThisWindow, openClientWindow, showAppWindow } from '../bridge/clients'
import { findSessionName } from '../core/sessionNames'
import { queueInitialZoom } from './pendingViewState'
import { hasPendingVaultRecovery } from '../bridge/vaultRecovery'
import { listenForDocumentDrop } from '../bridge/fileDrop'
import { ThemeIntakeHost } from './ThemeIntakeHost'
import { isOverThemeSection, offerThemePaths, partitionThemeDrop, setThemeDropHover } from './themeIntake'
import { useThemeFolder } from './themeFolder'
import { isThemeFileName } from '../core/themeFile'
import {
  SAMPLE_DOC_ID,
  SAMPLE_HAS_TEXT,
  SAMPLE_PAGE_COUNT,
  SAMPLE_TITLE,
  samplePageSizes,
} from '../pdf/samplePage'
import { getLocale, pick, t } from '../i18n'
import { buildMcpAppDeps } from './mcp/appDeps'

const NOTE_EMPTY = '사이드바에서 노트를 여세요'
/** 떼어 낸 새 창에서 첫 탭이 놓이는 자리(창 왼쪽 위에서, CSS 픽셀). 탭을 끌어 떼어 낼 때 마우스가 그 탭 위에 오게 한다 */
const DETACHED_TAB_LEFT = 54
const DETACHED_TAB_TOP = 5
/** 탭 메뉴 「새 오른쪽 패널로 옮기기」가 가리키는 칸(아직 없다) */
const NEW_PANE_TARGET = '__new-pane__'

const LazyNoteCanvas = lazy(async () => {
  const module = await import('./NoteCanvas')
  return { default: module.NoteCanvas }
})
const DEVELOPMENT_NOTE = {
  path: 'sample-note-0001',
  title: 'Evidence Map — Sample Research Note',
}
const DEVELOPMENT_PDF: PdfDocMeta = {
  docId: SAMPLE_DOC_ID,
  sha256: SAMPLE_DOC_ID.padEnd(64, '0'),
  size: 0,
  title: SAMPLE_TITLE,
  pageCount: SAMPLE_PAGE_COUNT,
  pageSizes: samplePageSizes,
  hasText: SAMPLE_HAS_TEXT,
}
const DEVELOPMENT_LIBRARY: LibraryDoc[] = [{
  docId: SAMPLE_DOC_ID,
  title: SAMPLE_TITLE,
  pages: SAMPLE_PAGE_COUNT,
}]
const DEVELOPMENT_NOTEBOOKS: NotebookGroup[] = [{
  name: '샘플',
  notes: [DEVELOPMENT_NOTE, { path: '샘플/Markdown-테스트.md', title: 'Markdown 테스트' }],
}]
const DEVELOPMENT_MARKDOWN_SOURCES = { '샘플/Markdown-테스트.md': developmentMarkdown }
const DEVELOPMENT_PDF_TABS = openTab(emptyTabs, {
  id: SAMPLE_DOC_ID,
  title: SAMPLE_TITLE,
  kind: 'pdf',
})
const DEVELOPMENT_NOTE_TABS = openTab(emptyTabs, {
  id: DEVELOPMENT_NOTE.path,
  title: DEVELOPMENT_NOTE.title,
  kind: 'canvas',
})

interface AppProps {
  /**
   * 테스트가 픽스처를 넣는 통로. 없으면 bridge 로 읽는다.
   *
   * 테스트를 bridge 의 가짜 데이터에 매어 두면 실제 vault 읽기 방식이
   * 바뀌는 순간 배선 테스트가 통째로 무너진다. 여기서 확인하려는
   * 것은 "누른 항목이 맞는 패널에 탭으로 열리는가"이지 특정 문서 제목이
   * 아니므로, 데이터는 밖에서 준다.
   */
  library?: LibraryDoc[]
  notebooks?: NotebookGroup[]
  /** 개발 서버에서 실제 vault 없이 샘플 작업 공간을 바로 연다. */
  developmentPreview?: boolean
}

function AutosavedNoteCanvas({
  noteId,
  title,
  storage,
  onOpenSource,
  onSourceStateChange,
  onToggleFullscreen,
  onExportWithEvidence,
  insertRequest,
  onTranslateText,
  userPresets,
  onSaveUserPreset,
  onDirtyChange,
  highlights,
  fallbackDocument: suppliedFallbackDocument,
}: {
  noteId: string
  title: string
  storage: CanvasStorage
  onOpenSource: (request: SourceOpenRequest) => void
  onSourceStateChange: (state: WorkspaceSourceState) => void
  onToggleFullscreen: () => void
  onExportWithEvidence?: (document: CanvasDocumentV2) => void
  insertRequest?: ReaderExcerptInsertRequest
  onTranslateText?: (text: string) => Promise<CanvasTranslationResult | null>
  userPresets: readonly UserBlockPreset[]
  onSaveUserPreset: (block: CanvasBlockData) => void
  onDirtyChange?: (dirty: boolean) => void
  highlights?: readonly PointableHighlight[]
  fallbackDocument?: CanvasDocumentV2
}) {
  const fallbackDocument = useMemo(
    () => suppliedFallbackDocument ?? createInitialCanvasDocument(title),
    [suppliedFallbackDocument, title],
  )
  const autosave = useCanvasAutosave({ noteId, fallbackDocument, storage, onDirtyChange })
  // 바깥 AI(MCP)가 이 캔버스를 고치면 문서를 바꿔 끼우고 화면을 새로 그린다(revision)
  const [revision, setRevision] = useState(0)
  const documentRef = useRef(autosave.document)
  documentRef.current = autosave.document
  const setDocumentRef = useRef(autosave.setDocument)
  setDocumentRef.current = autosave.setDocument
  const ready = autosave.status !== 'loading'
  useEffect(() => {
    if (!ready) return undefined
    return registerLiveCanvas(noteId, {
      get: () => documentRef.current,
      replace: (document) => {
        documentRef.current = document
        setDocumentRef.current(document)
        setRevision((current) => current + 1)
      },
    })
  }, [noteId, ready])

  if (autosave.status === 'loading') {
    return <div className="note-canvas-loading">{t('캔버스를 불러오는 중…')}</div>
  }

  return (
    <Suspense fallback={<div className="note-canvas-loading">{t('캔버스를 준비하는 중…')}</div>}>
      <LazyNoteCanvas
        key={revision}
        noteId={noteId}
        title={title}
        initialDocument={autosave.document}
        onDocumentChange={autosave.setDocument}
        saveStatus={autosave.status}
        saveError={autosave.error}
        onOpenSource={onOpenSource}
        onSourceStateChange={onSourceStateChange}
        onToggleFullscreen={onToggleFullscreen}
        onExportWithEvidence={onExportWithEvidence}
        insertRequest={insertRequest}
        onTranslateText={onTranslateText}
        userPresets={userPresets}
        onSaveUserPreset={onSaveUserPreset}
        highlights={highlights}
      />
    </Suspense>
  )
}

/**
 * 상태를 소유하고 조립만 한다. 전이 규칙은 tabs.ts 가, 폭 계산은
 * splitLayout.ts 가 갖는다 — 이 파일에 로직이 쌓이기 시작하면 그건
 * 순수 모듈로 내려가야 한다는 신호다.
 *
 * 패널 상태를 두 개로 나눠 둔 것이 스펙 §6.1 의 "역할 고정"을 코드로
 * 강제한다. 문서는 pdfTabs 로만, 노트는 noteTabs 로만 들어간다.
 */
export function App({ library, notebooks, developmentPreview }: AppProps = {}) {
  // 창의 역할: 메인 · 떼어 낸 창(PDF 하나) · 새 창. 같은 화면을 쓰고 몇 가지만 다르다
  const windowMode = currentWindowMode()
  const isMainWindow = windowMode.role === 'main'
  const isDetachedWindow = windowMode.role === 'detached'
  const theme = useTheme()
  const uiScale = useUiScale()
  const previewEnabled = developmentPreview
    // 데스크톱 앱은 dev 빌드여도 실제 Vault 를 연다. 샘플 워크스페이스는 브라우저 미리보기 전용.
    ?? (import.meta.env.DEV && !isDesktop() && library === undefined && notebooks === undefined)
  const developmentCanvasDocument = useMemo(() => createDevelopmentCanvasDocument(), [])
  const effectiveLibrary = previewEnabled ? DEVELOPMENT_LIBRARY : library
  const effectiveNotebooks = previewEnabled ? DEVELOPMENT_NOTEBOOKS : notebooks
  // 밖에서 가져온 PDF 의 원래 경로를 원본 출처로 적는다(docSources 는 vault 가 정해진 뒤 아래에서 만든다)
  const recordImportedSourceRef = useRef<(docId: string, path: string) => void>(() => undefined)
  // 캔버스 탭 열기(사이드바·검색·서재·새 캔버스). 창 배치를 아는 아래에서 채운다
  const openCanvasTabRef = useRef<(note: { readonly path: string; readonly title: string }) => void>(() => undefined)
  const vaultState = useVault({
    onImportedFrom: (docId, path) => recordImportedSourceRef.current(docId, path),
    openCanvas: (note) => openCanvasTabRef.current(note),
    library: effectiveLibrary,
    notebooks: effectiveNotebooks,
    openedDocs: previewEnabled ? [DEVELOPMENT_PDF] : undefined,
    pdfTabs: previewEnabled ? DEVELOPMENT_PDF_TABS : undefined,
    noteTabs: previewEnabled ? DEVELOPMENT_NOTE_TABS : undefined,
    markdownSources: previewEnabled ? DEVELOPMENT_MARKDOWN_SOURCES : undefined,
  })
  const {
    flushSession,
    initializing,
    vault,
    library: shownLibrary,
    notebooks: shownNotebooks,
    tree,
    openedDocs,
    panes,
    setPanes,
    channels,
    setChannels,
    paneLayout: layoutRoot,
    setPaneLayout: setLayoutRoot,
    setWorkspace,
    screens,
    activeScreenId,
    lastScreenId,
    screensState,
    sessionName,
    sessionNames,
    sessionEpoch,
    sessionOps,
    clients,
    clientHooksRef,
    setWindowHidden,
    zoomedPane,
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
    searchRecords,
    searchIndexProgress,
    rebuildSearchIndex,
    markdownSources,
    markdownTheme,
    recentVaultPaths,
    setMarkdownTheme,
    setFileDirty,
    setFileFavorite,
    itemIcons,
    setItemIcon,
    noteOrder,
    setNoteOrder,
    itemColors,
    setItemColor,
    readingPositions,
    recordReadingPosition,
    error,
    dismissError,
    loadVault,
    openVaultPath,
    closeVault,
    openDocument,
    addDocument,
    importDroppedDocuments,
    importPdfsAt,
    refreshVault,
    recentPdfs,
    openExternalPdf,
    importExternalPdf,
    forgetRecentPdf,
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
  } = vaultState
  useThemeFolder(vault?.root ?? null)
  const injected = effectiveLibrary !== undefined && effectiveNotebooks !== undefined
  // 사이드바의 표시 이름이 파일 이름보다 앞선다(뒤에 오는 값이 이긴다).
  const docTitles = useMemo(() => Object.fromEntries([
    ...openedDocs.map((doc) => [doc.docId, doc.title] as const),
    ...shownLibrary.map((doc) => [doc.docId, doc.title] as const),
  ]), [openedDocs, shownLibrary])
  const [documentDropActive, setDocumentDropActive] = useState(false)
  /** 끌어 온 파일이 들어갈 Vault 폴더(null = 기본 자리). 왼쪽 바가 그 폴더를 칠한다 */
  const [documentDropFolder, setDocumentDropFolder] = useState<string | null>(null)
  /** 끌어 온 파일을 놓을 트리 자리(줄 앞·뒤, 폴더 안). 왼쪽 바가 그 자리에 선을 그린다 */
  const [documentDropPlace, setDocumentDropPlace] = useState<TreeDropPlace | null>(null)

  // 탐색기에서 끌어 놓기: 어디에 놓든 Vault 로 복사한다(PDF 자리 = 맨 위, 왼쪽 바 = 놓은 폴더·자리)
  const routeDropRef = useRef<(paths: readonly string[], zone: DropZone) => void>(() => undefined)
  routeDropRef.current = (allPaths, zone) => {
    // PowerPoint 는 바로 넣지 않고 「PDF 로 바꿔 넣을까요?」 묻는다. 어디에 놓았든 왼쪽 바에 놓은 것처럼 Vault 로 넣는다
    const slides = allPaths.filter(isPowerPointPath)
    // PowerPoint 변환은 PC 의 PowerPoint(COM)를 쓰므로 Windows 에서만 된다
    if (slides.length > 0 && isMacPlatform()) announceAction(t('PowerPoint 를 PDF 로 바꾸는 기능은 Windows 에서만 됩니다. PDF 로 저장해서 넣어 주세요.'))
    else if (slides.length > 0) setPendingSlides({ paths: slides, folderPath: zone.kind === 'vault' ? zone.folderPath ?? '' : '', place: zone.kind === 'vault' ? zone.place : undefined })
    const paths = allPaths.filter((path) => !isPowerPointPath(path))
    if (paths.length === 0) return
    const pdfs = paths.filter((path) => /\.pdf$/iu.test(path))
    const others = paths.filter((path) => !/\.pdf$/iu.test(path))
    // PDF 자리에 놓아도 Vault 로 복사한다(Vault 맨 위). 왼쪽 바면 폴더 위는 그 폴더, 줄 사이는 그 자리, 빈 곳은 맨 위.
    // Vault 를 아직 열지 않았으면 예전처럼 열기만 한다
    if (zone.kind === 'reader' && vault === null) {
      void (async () => {
        for (const path of pdfs) await openExternalPdf(path)
        if (others.length > 0) await importDroppedDocuments(others)
      })()
      return
    }
    const folderPath = zone.kind === 'vault' ? zone.folderPath ?? '' : ''
    // PDF 줄 가운데에 PDF 하나를 놓으면: 그 줄 바로 뒤에 가져온 뒤 판으로 겹치기 창을 연다
    if (zone.kind === 'vault' && zone.stackOnDocId !== undefined && zone.place !== undefined) {
      const base = zone.stackOnDocId
      const after = { nodeId: zone.place.nodeId, position: 'after' as const }
      void (async () => {
        const imported = await importPdfsAt(paths.filter((path) => /\.(?:pdf|md|markdown)$/iu.test(path)), folderPath, after) ?? []
        const added = pdfs.length === 1 ? imported[0] : undefined
        if (added !== undefined && added !== base) setStackRequest({ baseDocId: base, addedDocId: added, addedFileName: pdfs[0]!.split(/[\\/]/u).at(-1) })
        if (others.length > 0) await importDroppedDocuments(others.filter((path) => !/\.(?:md|markdown)$/iu.test(path)))
      })()
      return
    }
    const documents = paths.filter((path) => /\.(?:pdf|md|markdown)$/iu.test(path))
    const unsupported = paths.filter((path) => !/\.(?:pdf|md|markdown)$/iu.test(path))
    void (async () => {
      const imported = documents.length > 0 ? await importPdfsAt(documents, folderPath, zone.kind === 'vault' ? zone.place : undefined) ?? [] : []
      if (unsupported.length > 0) await importDroppedDocuments(unsupported)
      // PDF 하나를 가져왔고 같은 폴더에 같은 문서의 다른 판(이름에서 판 표시만 다름)이 있으면 겹칠지 묻는다
      const added = pdfs.length === 1 ? imported[0] : undefined
      if (added === undefined) return
      const fileName = pdfs[0]!.split(/[\\/]/u).at(-1) ?? ''
      // 왼쪽 바 제목은 표시 이름일 수 있어 파일 이름으로 비교한다
      const byFileName = shownLibrary.map((doc) => {
        const path = searchRecords.find((record) => record.id === doc.docId)?.path
        return { ...doc, title: path === undefined ? doc.title : path.split(/[\\/]/u).at(-1) ?? doc.title }
      })
      const sibling = findVersionSibling({ docId: added, title: fileName, folderPath }, byFileName, versionGroups.groups)
      if (sibling !== null) setStackRequest({ baseDocId: sibling, addedDocId: added, addedFileName: fileName, suggested: true })
    })()
  }
  /** 끌어 온 PowerPoint: PDF 로 바꿔 넣을지 묻는 중 */
  const [pendingSlides, setPendingSlides] = useState<{ paths: readonly string[]; folderPath: string; place?: TreeDropPlace } | null>(null)
  const [convertingSlides, setConvertingSlides] = useState(false)
  const convertSlides = async (request: { paths: readonly string[]; folderPath: string; place?: TreeDropPlace }) => {
    if (vault === null) {
      announceAction(t('먼저 Vault 를 열어 주세요'))
      return
    }
    setConvertingSlides(true)
    const { join } = await import('@tauri-apps/api/path')
    const { remove } = await import('@tauri-apps/plugin-fs')
    const converted: string[] = []
    const failures: string[] = []
    for (const path of request.paths) {
      const name = (path.split(/[\\/]/u).at(-1) ?? 'slides').replace(/\.pptx?$/iu, '.pdf')
      // Vault 안 임시 자리에서 만든 뒤 고른 폴더로 복사하고 지운다(앱은 Vault 밖에 쓰지 못한다)
      const target = await join(vault.root, '.iwae', 'cache', 'converted', name)
      announceAction(t('PDF 로 바꾸는 중: {name}', { name }))
      try {
        await officeToPdf(path, target)
        converted.push(target)
      } catch (cause) {
        failures.push(`${name}: ${errorText(cause)}`)
      }
    }
    if (converted.length > 0) await importPdfsAt(converted, request.folderPath, request.place)
    for (const target of converted) await remove(target).catch(() => undefined)
    setConvertingSlides(false)
    setPendingSlides(null)
    if (failures.length > 0) announceAction(failures.join(' · '))
    else if (converted.length > 0) announceAction(t('PowerPoint {count}개를 PDF 로 바꿔 넣었습니다', { count: converted.length }))
  }
  const [readerDropActive, setReaderDropActive] = useState(false)
  useEffect(() => {
    document.body.classList.toggle('reader-drop-active', readerDropActive)
  }, [readerDropActive])
  useEffect(() => {
    let disposed = false
    let unlisten: () => void = () => undefined
    void listenForDocumentDrop(
      (paths, point) => {
        // 테마 파일은 문서로 가져오지 않고 「추가할까요?」 를 묻는다(.json 은 설정의 테마 구역 위에서만)
        const { themePaths, rest } = partitionThemeDrop(paths, isOverThemeSection(point))
        if (themePaths.length > 0) void offerThemePaths(themePaths)
        if (rest.length > 0) routeDropRef.current(rest, dropZoneAt(point))
      },
      (active, point) => {
        const zone = active ? dropZoneAt(point) : null
        setDocumentDropActive(zone?.kind === 'vault')
        setDocumentDropFolder(zone?.kind === 'vault' ? zone.folderPath : null)
        const place = zone?.kind === 'vault' ? zone.place ?? null : null
        setDocumentDropPlace((current) => current?.nodeId === place?.nodeId && current?.position === place?.position ? current : place)
        setReaderDropActive(zone?.kind === 'reader')
      },
      setThemeDropHover,
    ).then((nextUnlisten) => {
      if (disposed) nextUnlisten()
      else unlisten = nextUnlisten
    })
    return () => {
      disposed = true
      unlisten()
    }
  }, [])
  // 탐색기에서 PDF 를 IWAE 로 열었을 때: 처음 켜질 때 받은 것은 Vault 를 연 뒤 한 번, 켜진 동안은 올 때마다 연다
  const openExternalPdfRef = useRef(openExternalPdf)
  openExternalPdfRef.current = openExternalPdf
  const startupFilesTakenRef = useRef(false)
  useEffect(() => {
    // 켤 때 받은 PDF 는 메인 창이 맡는다
    if (vault === null || startupFilesTakenRef.current || !isMainWindow) return
    startupFilesTakenRef.current = true
    void takeOpenFiles()
      .then(async (paths) => {
        const themes = paths.filter((path) => isThemeFileName(path))
        if (themes.length > 0) await offerThemePaths(themes)
        for (const path of paths.filter((item) => !isThemeFileName(item))) await openExternalPdfRef.current(path)
      })
      .catch(() => undefined)
  }, [vault])
  useEffect(() => {
    if (!isMainWindow) return undefined
    let disposed = false
    let unlisten: () => void = () => undefined
    void onOpenFiles((paths) => {
      void (async () => {
        // 탐색기에서 연 .iwtheme 는 문서가 아니라 「테마를 추가할까요?」 로
        const themes = paths.filter((path) => isThemeFileName(path))
        if (themes.length > 0) await offerThemePaths(themes)
        for (const path of paths.filter((item) => !isThemeFileName(item))) await openExternalPdfRef.current(path)
      })()
    }).then((next) => {
      if (disposed) next()
      else unlisten = next
    })
    return () => {
      disposed = true
      unlisten()
    }
  }, [])
  // 사이드바가 지금 뭘 보여주는지 — vault 트리, 활성 PDF 의 축소판, 그
  // 목차. App 이 갖는 이유는 축소판·목차 둘 다 "지금 왼쪽 패널의 활성 탭"을
  // 알아야 하는데 그 값이 pdfTabs 에 있고, pdfTabs 는 여기서만 본다.
  const [sidebarMode, setSidebarMode] = useState<SidebarMode>('library')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [paletteOpen, setPaletteOpen] = useState(false)
  // 상단바의 도구줄 자리: 지금 만지는 칸의 도구줄이 포털로 여기에 그려진다
  const [toolbarSlot, setToolbarSlot] = useState<HTMLElement | null>(null)
  const [keysHelpOpen, setKeysHelpOpen] = useState(false)
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  const [aboutOpen, setAboutOpen] = useState(false)
  const [reportOpen, setReportOpen] = useState(false)
  // 저절로 열 때 먼저 보일 설정 항목. 사용자가 열면 지난번 항목 그대로
  const [settingsSection, setSettingsSection] = useState<string | undefined>(undefined)
  // 설정을 연 이유가 업데이트 기록일 때 먼저 펼칠 버전(「지난 기록 보기」·정보 보기의 「업데이트 기록」)
  const [settingsHistoryVersion, setSettingsHistoryVersion] = useState<string | null>(null)
  const openUpdateHistory = useCallback((version: string) => { setSettingsSection('updates'); setSettingsHistoryVersion(version); setSettingsOpen(true) }, [])
  const [draftPdfHighlight, setDraftPdfHighlight] = useState<Anchor | null>(null)
  const draftPdfHighlightRef = useRef(draftPdfHighlight)
  draftPdfHighlightRef.current = draftPdfHighlight
  /** AI 가 가리킨 자리. 저장·실행 취소와 무관한 임시 표시이고 선택(draftPdfHighlight)과 따로 둔다 */
  const [aiPointer, setAiPointer] = useState<AiPointer | null>(null)
  const aiPointerSeq = useRef(0)
  const pointAt = useCallback((anchor: Anchor, message?: string | null) => {
    aiPointerSeq.current += 1
    const text = (message ?? '').trim()
    setAiPointer({ id: `ai-pointer-${aiPointerSeq.current}`, docId: anchor.docId, page: anchor.page, anchor, ...(text === '' ? {} : { message: text }) })
  }, [])
  const dismissAiPointer = useCallback(() => setAiPointer(null), [])
  // 가리키던 문서가 닫히면(탭이 한 번 보였다가 사라지면) 표시도 지운다
  const aiPointerSeenRef = useRef<string | null>(null)
  useEffect(() => {
    if (aiPointer === null) { aiPointerSeenRef.current = null; return }
    const open = allPaneTabs(panes).some((tab) => tabDocId(tab) === aiPointer.docId)
    if (open) aiPointerSeenRef.current = aiPointer.id
    else if (aiPointerSeenRef.current === aiPointer.id) setAiPointer(null)
  }, [aiPointer, panes])
  // 「크게」(resize-pane -Z)는 화면마다 저장된다(screen.zoomed). 크게 보는 칸이 있으면 'zoom', 없으면 'split'
  const focusedPane: FocusedPane = zoomedPane !== null ? 'zoom' : 'split'
  const setFocusedPane = useCallback((mode: FocusedPane) => { if (mode === 'split') screenOps.setZoomed(null) }, [screenOps])
  const [libraryExpanded, setLibraryExpanded] = useState(false)
  /** 펼친 라이브러리가 올라갈 자리(왼쪽 바 오른쪽 영역). Sidebar 가 여기에 그린다 */
  const [libraryHost, setLibraryHost] = useState<HTMLElement | null>(null)
  // 저장하면 열린 노트 캔버스를 새로 읽게 canvasEpoch 를 올린다(쪽 편집).
  const [canvasEpoch, setCanvasEpoch] = useState(0)
  // 왼쪽 바 검색 보기의 범위: 지금 문서(pdf) / Vault 의 모든 문서(vault)
  const [searchScope, setSearchScope] = useState<'pdf' | 'vault'>('pdf')
  // 떠 있는 칸(설계 5): 나누기 트리 밖의 칸. 그릴 것은 보이는 것만(숨겼거나, 크게 보는 중 숨은 칸에 붙은 것은 뺀다)
  const activeScreenNow = activeScreenOf(screensState)
  const floatIds = useMemo(() => floatIdsOf(activeScreenNow), [activeScreenNow])
  const shownFloats = useMemo(
    () => visibleFloats(activeScreenNow).filter((float) => zoomedPane === null || float.anchor.kind === 'screen' || float.anchor.paneId === zoomedPane),
    [activeScreenNow, zoomedPane],
  )
  // 칸 나누기 트리(layoutRoot)는 useVault 가 칸의 탭·색과 함께 갖고 세션에 저장한다(예전 세션의 배치 id 는 읽을 때 트리로 옮긴다).
  // 칸 번호(0, 1, 2 …)는 트리를 왼쪽 위부터 센 차례다
  const paneOrder = useMemo(() => leaves(layoutRoot), [layoutRoot])
  const paneCount = paneOrder.length
  const documentSearch = useDocumentSearch()
  const [pendingExternalLink, setPendingExternalLink] = useState<string | null>(null)
  // 다른 화면(문제 보고·번역 설정 …)이 열려는 링크도 같은 확인 창을 거친다
  useEffect(() => {
    const request = (event: Event) => { if (typeof (event as CustomEvent<string>).detail === 'string') setPendingExternalLink((event as CustomEvent<string>).detail) }
    window.addEventListener(EXTERNAL_LINK_REQUEST_EVENT, request)
    return () => window.removeEventListener(EXTERNAL_LINK_REQUEST_EVENT, request)
  }, [])
  // 원본 출처: 문서(판)별 목록과 출처 창
  const docSources = useDocSources(vault)
  // 문서 판 묶음: 같은 문서의 여러 판을 왼쪽 바에서 한 줄로 겹쳐 보인다
  const versionGroups = useVersionGroups(vault)
  // PDF 위 편집(글 상자·선): 원본 PDF 는 건드리지 않는 덮개 층
  const pdfOverlays = usePdfOverlays(vault)
  /** 판으로 겹치기 창: base 아래에 added 를 겹친다(added 가 null 이면 창에서 고른다) */
  const [stackRequest, setStackRequest] = useState<{ baseDocId: string; addedDocId: string | null; addedFileName?: string; suggested?: boolean } | null>(null)
  /** 판 묶음에 속한 문서면 그 판의 이름 */
  const versionLabelOf = (docId: string): string | undefined => {
    const group = groupOfDoc(versionGroups.groups, docId)
    return group?.versions.find((version) => version.docId === docId)?.label
  }
  /** 도구줄 판 칩의 드롭다운(이 탭만 바뀐다) */
  const [tabVersionMenu, setTabVersionMenu] = useState<{ tabId: string; docId: string; anchor: DOMRect } | null>(null)
  /** 트리에서 색인 id 로 Markdown 줄을 찾는다(판 묶음의 Markdown 판을 열 때) */
  const markdownNodeById = (indexId: string): VaultMarkdownNode | null => {
    const walk = (nodes: readonly VaultTreeNode[]): VaultMarkdownNode | null => {
      for (const node of nodes) {
        if (node.kind === 'markdown' && node.indexId === indexId) return node
        if (node.kind === 'folder') {
          const found = walk(node.children)
          if (found !== null) return found
        }
      }
      return null
    }
    return walk(tree)
  }
  /** Markdown 판을 문서처럼(제목·id) 다루는 자리표 */
  const markdownDocById = (indexId: string): LibraryDoc | undefined => {
    const node = markdownNodeById(indexId)
    return node === null ? undefined : { docId: indexId, title: node.name, pages: 0 }
  }
  /** PDF 든 Markdown(PDF 화면) 이든 연다 */
  const openAnyDocument = async (doc: LibraryDoc, openTab = true) => {
    const markdown = shownLibrary.some((item) => item.docId === doc.docId) ? null : markdownNodeById(doc.docId)
    return markdown !== null ? openMarkdown(markdown, openTab) : openDocument(doc, openTab)
  }
  /** 탭 하나를 같은 자리에서 다른 판으로 바꾼다(묶음의 기본 판은 건드리지 않는다) */
  const switchTabVersion = async (tabId: string, docId: string) => {
    const doc = shownLibrary.find((item) => item.docId === docId) ?? markdownDocById(docId)
    if (doc === undefined) return
    // 읽던 자리: 이 탭이 보이는 패널의 지금 쪽(1-기반)
    const pane = paneOfTab(panes, tabId) ?? undefined
    const oldTab = pane === undefined ? undefined : tabsOf(panes, pane).tabs.find((tab) => tab.id === tabId)
    const oldDocId = oldTab === undefined ? null : tabDocId(oldTab)
    const fromPage = pane !== undefined && docControllersRef.current[pane]?.docId === oldDocId ? docViews[pane]?.page ?? null : null
    const meta = await openAnyDocument(doc, false)
    // 새 판에서 같은 절(목차 제목)로, 없으면 같은 쪽으로
    if (fromPage !== null && oldDocId !== null && meta !== null && meta !== undefined) {
      const [fromOutline, toOutline] = await Promise.all([
        pdfOutline(oldDocId).catch(() => []),
        pdfOutline(docId).catch(() => []),
      ])
      pendingDocPageRef.current = { docId, page: matchVersionPage(fromOutline, fromPage - 1, toOutline, meta.pageCount) + 1 }
    }
    const title = doc.title
    setPanes((current) => replaceTab(current, tabId, { id: docId, title, kind: 'pdf' }))
  }
  /** 판 나란히 비교: 고른 판을 옆 패널에 열고(1단이면 2단으로) 같은 절로 맞춘다 */
  const compareTabVersion = async (tabId: string, docId: string) => {
    const doc = shownLibrary.find((item) => item.docId === docId) ?? markdownDocById(docId)
    const pane = paneOfTab(panes, tabId) ?? undefined
    if (doc === undefined || pane === undefined) return
    const oldTab = tabsOf(panes, pane).tabs.find((tab) => tab.id === tabId)
    const oldDocId = oldTab === undefined ? null : tabDocId(oldTab)
    const fromPage = docControllersRef.current[pane]?.docId === oldDocId ? docViews[pane]?.page ?? null : null
    const meta = await openAnyDocument(doc, false)
    if (fromPage !== null && oldDocId !== null && meta !== null && meta !== undefined) {
      const [fromOutline, toOutline] = await Promise.all([pdfOutline(oldDocId).catch(() => []), pdfOutline(docId).catch(() => [])])
      pendingDocPageRef.current = { docId, page: matchVersionPage(fromOutline, fromPage - 1, toOutline, meta.pageCount) + 1 }
    }
    // 옆 칸(다음 칸, 없으면 오른쪽에 새로 만든 칸)에 연다
    const target = paneOrder.length > 1 ? otherPane(paneOrder, pane) : growPanes(2)[1]!
    const existing = paneOfTab(panes, docId) ?? undefined
    if (existing !== undefined && existing !== target) moveTab(docId, target)
    else openInPane({ id: docId, title: doc.title, kind: 'pdf' }, target)
    setActivePaneId(target)
    setPaneRoute('doc', target)
  }
  /** PDF 파일 복사: Vault 안 파일은 Vault 위치를 붙여 실제 경로로, 참조 파일은 그 경로 그대로 */
  const copyPdfFile = async (docId: string) => {
    // PDF 는 docId, Markdown 탭은 경로로 온다
    const record = searchRecords.find((item) => item.id === docId) ?? searchRecords.find((item) => item.path === docId)
    if (record === undefined || vault === null) {
      announceAction(t('이 문서의 파일 위치를 모릅니다'))
      return
    }
    try {
      const absolute = /^(?:[a-z]:[\\/]|\\\\)/iu.test(record.path)
        ? record.path
        : await (await import('@tauri-apps/api/path')).join(vault.root, ...record.path.split(/[\\/]/u))
      await copyFileToClipboard(absolute)
      announceAction(t('「{name}」 파일을 복사했습니다. 붙여 넣으면 PDF 가 들어갑니다', { name: record.displayName || record.filename }))
    } catch (cause) {
      announceAction(t('복사하지 못했습니다: {error}', { error: errorText(cause) }))
    }
  }
  const docSourcesRef = useRef(docSources)
  docSourcesRef.current = docSources
  recordImportedSourceRef.current = (docId, path) => { docSources.add(docId, { label: t('가져온 원본'), target: path }) }
  const [sourcesDocId, setSourcesDocId] = useState<string | null>(null)
  const openDocSource = (source: DocSource) => {
    if (sourceTargetKind(source.target) === 'url') {
      setPendingExternalLink(source.target)
      return
    }
    // 경로: 파일이면 탐색기에서 그 파일이 골라진 채로, 폴더면 그 폴더를 연다
    void revealInFolder(source.target).catch((cause: unknown) => announceAction(t('열 수 없습니다: {error}', { error: errorText(cause) })))
  }
  const [flashHighlightId, setFlashHighlightId] = useState<string | null>(null)
  const [pdfViewPrefs, setPdfViewPrefs] = useState<PdfViewPrefs>(readPdfViewPrefs)
  const updatePdfViewPrefs = useCallback((next: PdfViewPrefs) => {
    setPdfViewPrefs(next)
    writePdfViewPrefs(next)
  }, [])
  // 회전은 문서마다 다르고(가로로 누운 도면만 돌린다) 이번 세션에만 둔다.
  const [pdfRotations, setPdfRotations] = useState<Readonly<Record<string, PdfRotation>>>({})
  const bibliography = useBibliography(vault)
  // 바깥 AI 검색 색인. Rust 는 Vault 위치를 여기서만 받는다.
  useEffect(() => {
    void aiSetVault(vault?.root ?? null).catch(() => undefined)
  }, [vault?.root])
  // 본문 추출(OCR 포함)이 진행되거나 파일 목록이 바뀌면 3초 뒤 색인을 갱신한다.
  // Rust 쪽은 바뀐 문서만 다시 자르므로 자주 불러도 싸다.
  const ragTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // 바깥 AI 가 show_location 으로 보낸 자리. 최신이 위, 스무 개까지만 남긴다.
  const [aiLocations, setAiLocations] = useState<readonly AiLocation[]>([])
  useEffect(() => {
    let stop: () => void = () => undefined
    let disposed = false
    void listenAiLocation((location) => {
      setAiLocations((current) => [location, ...current.filter((item) => item.id !== location.id)].slice(0, 20))
    }).then((unlisten) => {
      if (disposed) unlisten()
      else stop = unlisten
    }).catch(() => undefined)
    return () => {
      disposed = true
      stop()
    }
  }, [])
  useEffect(() => {
    if (vault === null) return
    if (ragTimerRef.current !== null) clearTimeout(ragTimerRef.current)
    ragTimerRef.current = setTimeout(() => { void ragIndex().catch(() => undefined) }, 3000)
    return () => {
      if (ragTimerRef.current !== null) clearTimeout(ragTimerRef.current)
    }
  }, [vault, searchIndexProgress?.indexed, searchRecords.length])
  const [bibliographyDocId, setBibliographyDocId] = useState<string | null>(null)
  const flashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => {
    if (flashTimerRef.current !== null) clearTimeout(flashTimerRef.current)
  }, [])
  // 라이브러리는 분할 화면 위에서만 펼친다. 집중 모드에서 펼치면 접었을 때
  // 사이드바 없는 화면으로 돌아가서, 방금 정리한 트리가 보이지 않는다.
  const toggleLibrary = useCallback(() => {
    setLibraryExpanded((open) => {
      if (!open) {
        setFocusedPane('split')
        // 왼쪽 바는 그대로 두고 오른쪽만 라이브러리가 된다 — 바가 접혀 있거나 다른 보기여도 문서 트리 보기로 편다
        setSidebarCollapsed(false)
        setSidebarMode('library')
      }
      return !open
    })
  }, [])
  // 칸 하나를 화면 전체로(다시 누르면 되돌린다)
  const toggleFocus = useCallback((pane: PaneId) => {
    setLibraryExpanded(false)
    screenOps.setZoomed(zoomedPane === pane ? null : pane)
  }, [screenOps, zoomedPane])
  const [excerptInsertRequest, setExcerptInsertRequest] = useState<ReaderExcerptInsertRequest>()
  const [markdownJumpRequest, setMarkdownJumpRequest] = useState<MarkdownSourceJumpRequest | null>(null)
  useEffect(() => {
    // 복구 안내는 메인 창만 띄운다(다른 창이 열릴 때마다 설정 창이 뜨지 않게)
    if (vault === null || !isMainWindow) return
    let active = true
    void hasPendingVaultRecovery(vault)
      .then((needed) => {
        if (!active || !needed) return
        setSettingsSection('data')
        setSettingsOpen(true)
      })
      .catch(() => {})
    return () => { active = false }
  }, [vault])
  // 번역이 안 될 때 선택 작업 메뉴의 「번역 설정 열기」
  useEffect(() => {
    const openTranslationSettings = () => {
      setSettingsSection('translation')
      setSettingsOpen(true)
    }
    window.addEventListener(OPEN_TRANSLATION_SETTINGS_EVENT, openTranslationSettings)
    return () => window.removeEventListener(OPEN_TRANSLATION_SETTINGS_EVENT, openTranslationSettings)
  }, [])
  const translationProvider = useMemo(
    () => createOllamaTranslationProvider({ developmentFetch: import.meta.env.DEV }),
    [],
  )
  const translation = useTranslation({ provider: translationProvider })
  // 번역 캐시(번역 기록): 같은 글·언어·번역기면 다시 묻지 않는다. 노트 카드·글 고르기·설정이 함께 쓴다
  const translateText = translation.translate
  const translateForCache = useCallback(async (text: string, targetLanguage?: string, sourceLanguage?: string) => {
    const result = await translateText(text, sourceLanguage, targetLanguage)
    return result === null ? null : { text: result.translatedText }
  }, [translateText])
  const translationProviderKey = translation.settings.executionMode === 'external-api'
    ? translation.settings.externalProvider
    : `local:${translation.selectedModel ?? ''}`
  // 번역을 끄면 번역기를 넘기지 않는다 → 노트 카드의 번역 단추도 사라진다
  useTranslationCacheBridge(vault, translation.settings.enabled ? translateForCache : null, translation.settings.targetLanguage, translationProviderKey)
  // 창을 닫을 때 쓰던 번역 모델을 내린다(닫기 갈고리는 한 번만 걸려 최신 함수를 ref 로 부른다)
  const releaseTranslationModelRef = useRef(translation.releaseLocalModel)
  releaseTranslationModelRef.current = translation.releaseLocalModel
  const updater = useUpdater({
    // 업데이트 확인·내려받기는 메인 창만 한다(창마다 하면 알림과 내려받기가 겹친다)
    autoStart: isMainWindow && !initializing && (injected || vault !== null),
    flushBeforeInstall: flushCanvasSaves,
  })
  const closeNoteTabSafely = useCallback((id: string) => {
    void runAfterCanvasFlush(id, flushCanvasSaves, () => {
      setPanes((current) => closeTabEverywhere(current, id))
    }).catch((cause: unknown) => {
      window.alert(t('노트를 저장하지 못해 탭을 닫지 않았습니다: {error}', { error: cause instanceof Error ? cause.message : String(cause) }))
    })
  }, [setPanes])
  const closeVaultSafely = useCallback(() => {
    void runAfterCanvasFlush(undefined, flushCanvasSaves, closeVault).catch((cause: unknown) => {
      window.alert(t('노트를 저장하지 못해 Vault를 닫지 않았습니다: {error}', { error: cause instanceof Error ? cause.message : String(cause) }))
    })
  }, [closeVault])
  const openRecentVaultSafely = useCallback((root: string) => {
    void runAfterCanvasFlush(undefined, flushCanvasSaves, () => openVaultPath(root)).catch((cause: unknown) => {
      window.alert(t('노트를 저장하지 못해 Vault를 전환하지 않았습니다: {error}', { error: cause instanceof Error ? cause.message : String(cause) }))
    })
  }, [openVaultPath])
  const closeWindowSafely = useCallback(() => {
    void runAfterCanvasFlush(undefined, flushCanvasSaves, closeWindow).catch((cause: unknown) => {
      window.alert(t('노트를 저장하지 못해 앱을 종료하지 않았습니다: {error}', { error: cause instanceof Error ? cause.message : String(cause) }))
    })
  }, [])
  // 떼어 낸 창이 닫힐 때 탭을 메인 창으로 돌려보낸다(아래에서 최신 함수로 채운다)
  const sendTabsBackRef = useRef<() => Promise<void>>(async () => undefined)
  // 메인 창이 닫히면서 돌려받은 탭을 세션에 싣는다(최신 함수를 ref 로 부른다)
  const flushSessionRef = useRef(flushSession)
  flushSessionRef.current = flushSession
  // 앱 창(client) 닫기 · 떼기 · 끝내기(docs/design/workspace-tmux.md 7). 닫는 길(onCloseRequested)은 마운트할 때 한 번만 걸리므로 최신 판단은 ref 로 부른다
  const quittingRef = useRef(false)
  const clientsNowRef = useRef(clients)
  clientsNowRef.current = clients
  const beforeCloseRef = useRef<() => Promise<void | 'keep'>>(async () => undefined)
  beforeCloseRef.current = async () => {
    // 노트·메모 저장을 끝낸다. 이 창이 쓴 것은 파일에 있으니 다른 창이 이어서 쓴다
    await flushCanvasSaves()
    const { registry, selfId, engine } = clientsNowRef.current
    const action = isMainWindow || !isDetachedWindow ? closePlan(registry, selfId, isMainWindow, quittingRef.current) : 'close'
    if (isMainWindow) {
      // 다른 앱 창이 보이고 있으면 메인 창은 닫지 않고 숨긴다: MCP · 백업 · 색인을 맡는 창이라 앱이 살아 있는 동안 남아야 한다. 마지막 앱 창을 닫으면 앱이 끝난다
      if (action === 'hide') {
        await flushSessionRef.current()
        await hideThisWindow()
        setWindowHidden(true)
        return 'keep'
      }
      // 마지막 변화를 세션 파일에 쓰고, 떼어 낸 창 · 새 창도 저장하고 함께 닫는다.
      // 떼어 낸 창은 닫히면서 탭을 메인으로 돌려보낸다 — 그 탭이 다음 실행에 되살아나게 잠시 뒤 세션을 다시 저장한다
      await flushSessionRef.current()
      if (await closeSecondaryWindows() > 0) {
        await new Promise((resolve) => window.setTimeout(resolve, 400))
        await flushSessionRef.current()
      }
    } else if (isDetachedWindow) {
      await sendTabsBackRef.current()
    } else {
      // 세션에 붙은 앱 창: 이 창이 세션 소유자였다면 마지막 변화를 쓴다(다음 창이 이어받는다). 숨긴 메인 창만 남게 되면 앱 전체를 끝낸다
      await flushSessionRef.current()
      if (action === 'quit-via-main') {
        engine.requestQuit()
        return 'keep'
      }
      engine.leave()
    }
    // 번역용 로컬 모델(Ollama)도 메모리에서 내린다
    await releaseTranslationModelRef.current()
    return undefined
  }
  useEffect(() => {
    let unlisten: (() => void) | undefined
    void interceptWindowClose(
      () => beforeCloseRef.current(),
      (cause) => window.alert(t('노트를 저장하지 못해 앱을 종료하지 않았습니다: {error}', { error: cause instanceof Error ? cause.message : String(cause) })),
    ).then((stop) => { unlisten = stop })
    return () => unlisten?.()
  }, [])
  useEffect(() => {
    if (isMainWindow) return undefined
    let disposed = false
    let stop: (() => void) | undefined
    void onCloseNow(() => { quittingRef.current = true; closeWindow() }).then((unlisten) => {
      if (disposed) unlisten()
      else stop = unlisten
    })
    return () => { disposed = true; stop?.() }
  }, [])
  // 점프 기록 훅은 활성 문서를 알아야 해서 아래에서 만든다. 그보다 위에서 선언되는
  // 콜백(검색 결과 열기·단축키)은 이 ref 로 최신 함수를 부른다.
  const navigationJumpRef = useRef<(location: NavLocation) => void>(() => undefined)
  /** PDF 주석 가져오기(Task 8 에서 채운다) */
  const navigationBackRef = useRef<() => void>(() => undefined)
  const navigationForwardRef = useRef<() => void>(() => undefined)
  const openVaultSearchResult = useCallback((hit: VaultSearchHit) => {
    const { record } = hit
    if (record.kind === 'pdf') {
      const document = shownLibrary.find((entry) => entry.docId === record.id)
      if (document === undefined) return
      if (hit.page === null) void openDocument(document)
      else navigationJumpRef.current({ docId: record.id, page: hit.page + 1 })
      return
    }
    if (record.kind === 'markdown') {
      void openMarkdown({
        id: `markdown:${record.id}`,
        kind: 'markdown',
        name: record.displayName,
        path: record.path,
        storage: record.storage,
        indexId: record.id,
      })
      return
    }
    if (record.kind === 'canvas' && CANVAS_ENABLED) {
      const note = shownNotebooks.flatMap((group) => group.notes).find((entry) => entry.path === record.path)
      if (note !== undefined) openCanvasTabRef.current(note)
    }
  }, [openDocument, openMarkdown, shownLibrary, shownNotebooks])
  /** 라이브러리에서 연 항목은 해당 패널에 탭으로 열고, 그 패널이 보이도록 라이브러리를 접는다 */
  const openLibraryItem = useCallback((target: LibraryOpenTarget) => {
    if (target.kind === 'pdf') void openDocument(target.doc)
    else if (target.kind === 'markdown') void openMarkdown(target.node)
    else if (CANVAS_ENABLED) openCanvasTabRef.current(target.note)
    setLibraryExpanded(false)
  }, [openDocument, openMarkdown])
  /** Ctrl+Shift+F: 왼쪽 바 검색 보기를 모든 문서 범위로 연다 */
  const toggleDocSearchMode = useCallback(() => {
    setLibraryExpanded(false)
    setFocusedPane('split')
    setSidebarCollapsed(false)
    setSidebarMode('search')
    setSearchScope('vault')
  }, [])
  // 창 동작(새 창·떼어 내기·다시 붙이기). 패널 상태는 아래에서 만들어지므로 ref 로 잇는다
  const windowActionsRef = useRef({
    newWindow: () => undefined as void,
    detachActive: () => undefined as void,
    reattach: () => undefined as void,
  })
  const shortcutActions: AppShortcutActions = {
    newWindow: () => windowActionsRef.current.newWindow(),
    // Ctrl+F: 왼쪽 바를 「PDF 검색」 보기로 바꾸고 검색 칸으로
    // 글자를 골라 둔 채 누르면 그 글자로 바로 찾는다(PDF 는 고른 발췌, Markdown 등은 화면 선택)
    search: () => {
      const picked = (window.getSelection()?.toString() ?? '').trim() || (draftPdfHighlightRef.current?.quote ?? '').trim()
      const query = picked.replace(/\s+/gu, ' ').slice(0, 200)
      setLibraryExpanded(false)
      setSidebarCollapsed(false)
      setSidebarMode('search')
      setSearchScope('pdf')
      window.setTimeout(() => window.dispatchEvent(new CustomEvent('iwae:pdf-search', { detail: { query } })), 30)
    },
    navBack: () => navigationBackRef.current(),
    navForward: () => navigationForwardRef.current(),
    toggleLibrary: isDetachedWindow ? undefined : toggleLibrary,
    escape: libraryExpanded ? () => setLibraryExpanded(false) : undefined,
    documentSearch: toggleDocSearchMode,
    nextTab: () => paneShortcutsRef.current.cycleTab(1),
    prevTab: () => paneShortcutsRef.current.cycleTab(-1),
    closeTab: () => paneShortcutsRef.current.closeActiveTab(),
    focusLeftPane: () => paneShortcutsRef.current.focus(0),
    focusRightPane: () => { if (SPLIT_PANES_ENABLED) paneShortcutsRef.current.focus(1) },
    goTo: () => window.dispatchEvent(new CustomEvent('iwae:goto')),
    print: () => window.dispatchEvent(new CustomEvent('iwae:print')),
    openSettings: () => { setSettingsSection(undefined); setSettingsOpen(true) },
    toggleSinglePane: () => { if (SPLIT_PANES_ENABLED) toggleSinglePaneRef.current() },
    toggleNoteBeside: () => { if (vault !== null) toggleNoteBeside() },
    // 형광펜·메모·박스 메모·그림·노트 블록 되돌리기. 글 칸 안에서는 브라우저의 글자 되돌리기가 먼저다.
    // 예전 캔버스 노트가 열려 있으면 그쪽 기록을 쓴다(NoteCanvas)
    undo: () => {
      if (document.querySelector('.note-canvas') !== null) return
      if (!undoChange()) announceAction(t('되돌릴 것이 없습니다'))
    },
    redo: () => {
      if (document.querySelector('.note-canvas') !== null) return
      if (!redoChange()) announceAction(t('다시 할 것이 없습니다'))
    },
    commandPalette: () => { setPaletteInitial(''); setPaletteOpen((open) => !open) },
    showShortcuts: () => setShortcutsOpen((open) => !open),
    // 마지막으로 만진 문서 칸(PDF·Markdown)의 확대. 옛 캔버스 노트는 NoteCanvas 가 따로 받는다
    zoomIn: () => { if (document.querySelector('.note-canvas') === null) window.dispatchEvent(new CustomEvent('iwae:zoom', { detail: 'in' })) },
    zoomOut: () => { if (document.querySelector('.note-canvas') === null) window.dispatchEvent(new CustomEvent('iwae:zoom', { detail: 'out' })) },
    zoomReset: () => { if (document.querySelector('.note-canvas') === null) window.dispatchEvent(new CustomEvent('iwae:zoom', { detail: 'fit' })) },
  }
  useAppShortcuts(shortcutActions)
  const shortcutActionsRef = useRef(shortcutActions)
  shortcutActionsRef.current = shortcutActions
  // 문서 칸 우클릭 메뉴의 「이 문서에서 찾기」 등: 단축키와 같은 동작을 부른다
  useEffect(() => {
    const onCommand = (event: Event) => {
      const detail = (event as CustomEvent<{ name?: string; docId?: string; tool?: string }>).detail
      const name = detail?.name
      if (name === 'search' || name === 'documentSearch' || name === 'commandPalette') shortcutActionsRef.current[name]?.()
      if (name === 'pdfTools' && detail?.docId !== undefined) openPdfToolsView(detail.docId, detail.tool as PdfToolViewId | undefined)
      if (name === 'ocrDocument' && detail?.docId !== undefined) {
        void ocrDocumentRef.current(detail.docId).catch((cause: unknown) => announceAction(t('OCR 하지 못했습니다: {error}', { error: errorText(cause) })))
      }
    }
    window.addEventListener(APP_COMMAND_EVENT, onCommand)
    return () => window.removeEventListener(APP_COMMAND_EVENT, onCommand)
  }, [])
  useEffect(() => { clearUndo() }, [vault])
  /** 지금 PDF 에 쓸 수 있는 도구(명령 팔레트) */
  const pdfToolPaletteCommands = (docId: string): PaletteCommand[] => {
    const open = (tool: PdfToolId) => () => openPdfToolsView(docId, tool)
    const meta = openedDocs.find((doc) => doc.docId === docId)
    return [
      { id: 'pdf-tools', kind: 'action', label: t('PDF 도구…'), keywords: 'pdf tools stirling', run: open(meta?.hasText === false ? 'ocr' : 'flatten') },
      { id: 'pdf-ocr', kind: 'action', label: t('PDF: OCR (스캔 글자 인식)'), keywords: 'ocr scan text recognize 스캔 글자 인식', run: () => { void ocrDocumentRef.current(docId).catch((cause: unknown) => announceAction(errorText(cause))) } },
      { id: 'pdf-flatten', kind: 'action', label: t('PDF: 주석을 넣은 PDF 저장'), keywords: 'flatten annotate export share 주석 저장 공유', run: open('flatten') },
      { id: 'pdf-redact', kind: 'action', label: t('PDF: 민감 정보 가린 PDF 저장'), keywords: 'redact hide privacy 가리기 민감 정보', run: open('redact') },
      { id: 'pdf-compare', kind: 'action', label: t('PDF: 다른 버전과 글자 비교'), keywords: 'compare diff version 비교 버전', run: open('compare') },
      { id: 'pdf-extract', kind: 'action', label: t('PDF: 쪽 추출'), keywords: 'extract split pages 쪽 추출 뽑기 발췌', run: open('extract') },
      { id: 'pdf-split', kind: 'action', label: t('PDF: PDF 분할 (목차별)'), keywords: 'split chapters 분할 나누기 목차 장', run: open('split') },
      { id: 'pdf-merge', kind: 'action', label: t('PDF: PDF 병합'), keywords: 'merge combine 병합 합치기 붙이기', run: open('merge') },
      { id: 'pdf-blanks', kind: 'action', label: t('PDF: 빈 쪽 삭제'), keywords: 'blank remove delete pages 빈 쪽 삭제 빼기', run: open('blanks') },
      { id: 'pdf-orient', kind: 'action', label: t('PDF: 스캔 쪽 방향 자동 보정'), keywords: 'orientation rotate scan upside down sideways 방향 보정 회전 바로잡기', run: open('orient') },
      { id: 'pdf-compress', kind: 'action', label: t('PDF: PDF 압축 (용량 줄이기)'), keywords: 'compress shrink size images 압축 용량 줄이기', run: open('compress') },
      { id: 'pdf-numbers', kind: 'action', label: t('PDF: 쪽 번호 넣기'), keywords: 'page numbers 쪽 번호', run: open('numbers') },
      { id: 'pdf-watermark', kind: 'action', label: t('PDF: 워터마크 넣기'), keywords: 'watermark stamp 워터마크 도장', run: open('watermark') },
      { id: 'pdf-crop', kind: 'action', label: t('PDF: 여백 자르기'), keywords: 'crop margins 여백 자르기', run: open('crop') },
      { id: 'pdf-nup', kind: 'action', label: t('PDF: 모아찍기 (한 장에 여러 쪽)'), keywords: 'n-up layout print 모아찍기 한 장에 여러 쪽', run: open('nup') },
      { id: 'pdf-images', kind: 'action', label: t('PDF: 쪽을 PNG 이미지로 내보내기'), keywords: 'images png export 이미지 그림 내보내기', run: open('images') },
      { id: 'pdf-markdown', kind: 'action', label: t('PDF: 본문을 Markdown 으로'), keywords: 'markdown text export 본문 글 내보내기', run: open('markdown') },
      { id: 'pdf-import-marks', kind: 'action', label: t('PDF: 기존 주석 가져오기'), keywords: 'import annotations highlights acrobat preview zotero 주석 가져오기 형광펜', run: open('importMarks') },
      { id: 'pdf-notes-markdown', kind: 'action', label: t('PDF: 노트를 Markdown 으로'), keywords: 'markdown export obsidian notion notes', run: open('notesMarkdown') },
    ]
  }
  /** 명령 팔레트(Ctrl+Shift+P)에 보일 동작과 문서 */
  const paletteCommands = (): PaletteCommand[] => {
    const act = (name: keyof AppShortcutActions) => () => shortcutActionsRef.current[name]?.()
    const actions: PaletteCommand[] = [
      { id: 'new-window', kind: 'action', label: t('새 창'), shortcut: shortcutText('newWindow'), keywords: 'new window', run: act('newWindow') },
      ...(isDetachedWindow
        ? [{ id: 'reattach', kind: 'action' as const, label: t('다시 붙이기'), keywords: 'reattach attach back window main', run: () => windowActionsRef.current.reattach() }]
        : activeDocumentTab?.kind === 'pdf'
          ? [{ id: 'detach', kind: 'action' as const, label: t('창으로 떼어 내기'), keywords: 'detach window pop out separate', run: () => windowActionsRef.current.detachActive() }]
          : []),
      { id: 'settings', kind: 'action', label: t('설정 열기'), shortcut: shortcutText('openSettings'), keywords: 'settings preferences', run: act('openSettings') },
      { id: 'translation-settings', kind: 'action', label: t('번역 설정 열기'), keywords: 'translation translate', run: () => { setSettingsSection('translation'); setSettingsOpen(true) } },
      { id: 'translator', kind: 'action', label: translatorWindow.open ? t('번역기 닫기') : t('번역기 열기'), shortcut: `${prefixHint} w`, keywords: 'translator translate popup 번역기', run: toggleTranslatorWindow },
      { id: 'keys-help', kind: 'action', label: t('키와 명령 보기'), shortcut: `${prefixHint} ?`, keywords: 'keys help shortcuts commands list-keys 키 명령 도움말', run: () => setKeysHelpOpen(true) },
      { id: 'doc-search', kind: 'action', label: t('모든 문서에서 찾기'), shortcut: shortcutText('documentSearch'), keywords: 'search vault find', run: act('documentSearch') },
      { id: 'find', kind: 'action', label: t('이 문서에서 찾기'), shortcut: shortcutText('search'), keywords: 'find search', run: act('search') },
      { id: 'goto', kind: 'action', label: t('쪽으로 가기'), shortcut: shortcutText('goTo'), keywords: 'go to page', run: act('goTo') },
      ...(isDetachedWindow ? [] : [
        { id: 'library', kind: 'action' as const, label: t('라이브러리 펼치기·접기'), shortcut: shortcutText('toggleLibrary'), keywords: 'library', run: act('toggleLibrary') },
        { id: 'sidebar', kind: 'action' as const, label: t('왼쪽 바 접기·펴기'), keywords: 'sidebar', run: () => setSidebarCollapsed((value) => !value) },
      ]),
      { id: 'new-note', kind: 'action', label: t('새 노트 만들기'), keywords: 'new note', run: () => { void memoNotes.create().then((path) => { if (path !== null) openMemoNoteTab(path) }) } },
      ...(docPaneId !== null && vault !== null ? [{ id: 'note-beside', kind: 'action' as const, label: noteBesideShown ? t('옆에 노트 닫기') : t('옆에 노트 열기'), shortcut: shortcutText('toggleNoteBeside'), keywords: 'note beside side open close memo reading 노트 옆 읽기', run: act('toggleNoteBeside') }] : []),
      ...(SPLIT_PANES_ENABLED && !isDetachedWindow ? [
        ...availableScreenTemplates(CANVAS_ENABLED).map((template) => ({ id: `new-screen-${template.id}`, kind: 'action' as const, label: t('새 화면: {name}', { name: template.label }), keywords: 'new screen window template new-window 화면 템플릿', run: () => { void newScreenFromTemplate(template.id) } })),
        ...(vault === null ? [] : availableScreenTemplates(CANVAS_ENABLED).filter((template) => template.id !== 'blank').map((template) => ({ id: `reapply-${template.id}`, kind: 'action' as const, label: t('이 화면을 템플릿으로 다시 짜기: {name}', { name: template.label }), keywords: 'layout template rearrange apply reapply arrangement 배치 템플릿 다시 짜기', run: () => { void applyPreset(template.id as LayoutPresetId) } }))),
        { id: 'split-right', kind: 'action' as const, label: t('칸 나누기: 오른쪽으로'), keywords: 'split pane right split-window 칸 나누기', run: () => splitPaneFromHead(activePaneId, 'h') },
        { id: 'split-down', kind: 'action' as const, label: t('칸 나누기: 아래로'), keywords: 'split pane down split-window 칸 나누기', run: () => splitPaneFromHead(activePaneId, 'v') },
        { id: 'zoom-pane', kind: 'action' as const, label: zoomedPane === null ? t('이 칸만 크게') : t('크기 되돌리기'), keywords: 'zoom pane resize-pane 크게', run: () => toggleFocus(activePaneId) },
        { id: 'next-screen', kind: 'action' as const, label: t('다음 화면'), keywords: 'next screen window next-window', run: () => screenOps.step(1) },
        { id: 'prev-screen', kind: 'action' as const, label: t('이전 화면'), keywords: 'previous screen window previous-window', run: () => screenOps.step(-1) },
        { id: 'last-screen', kind: 'action' as const, label: t('마지막 화면으로'), keywords: 'last screen window last-window', run: () => screenOps.last() },
        ...(screens.length > 1 ? [{ id: 'close-screen', kind: 'action' as const, label: t('화면 닫기'), keywords: 'close screen window kill-window', run: () => screenOps.close(activeScreenId) }] : []),
      ] : []),
      { id: 'zotero-import', kind: 'action', label: t('Zotero 에서 가져오기…'), keywords: 'zotero import library references pdf', run: () => { void interop.runZotero() } },
      { id: 'export-vault-markdown', kind: 'action', label: t('모든 노트를 Markdown 으로 내보내기…'), keywords: 'markdown export obsidian notion vault notes', run: () => { void interop.exportMarkdown({ kind: 'vault' }) } },
      { id: 'undo', kind: 'action', label: t('되돌리기'), shortcut: shortcutText('undo'), keywords: 'undo', run: act('undo') },
      { id: 'redo', kind: 'action', label: t('다시 하기'), shortcut: shortcutText('redo'), keywords: 'redo', run: act('redo') },
      { id: 'next-tab', kind: 'action', label: t('다음 탭'), shortcut: shortcutText('nextTab'), keywords: 'next tab', run: act('nextTab') },
      { id: 'prev-tab', kind: 'action', label: t('이전 탭'), shortcut: shortcutText('prevTab'), keywords: 'previous tab', run: act('prevTab') },
      { id: 'close-tab', kind: 'action', label: t('탭 닫기'), shortcut: shortcutText('closeTab'), keywords: 'close tab', run: act('closeTab') },
      { id: 'back', kind: 'action', label: t('뒤로 (문서 점프)'), shortcut: shortcutText('navBack'), keywords: 'back', run: act('navBack') },
      { id: 'forward', kind: 'action', label: t('앞으로 (문서 점프)'), shortcut: shortcutText('navForward'), keywords: 'forward', run: act('navForward') },
      { id: 'print', kind: 'action', label: t('인쇄'), shortcut: shortcutText('print'), keywords: 'print', run: act('print') },
      { id: 'shortcuts', kind: 'action', label: t('단축키 보기'), shortcut: shortcutText('showShortcuts'), keywords: 'keyboard shortcuts help', run: act('showShortcuts') },
      { id: 'theme', kind: 'action', label: theme.resolvedTheme === 'dark' ? t('밝은 화면으로') : t('어두운 화면으로'), keywords: 'theme dark light', run: () => theme.setPreference(theme.resolvedTheme === 'dark' ? 'light' : 'dark') },
      ...(SPLIT_PANES_ENABLED ? [{ id: 'split', kind: 'action' as const, label: t('화면 나누기 바꾸기'), shortcut: shortcutText('toggleSinglePane'), keywords: 'split pane', run: act('toggleSinglePane') }] : []),
      ...(activePdfDoc === null ? [] : pdfToolPaletteCommands(activePdfDoc.docId)),
    ]
    const documents: PaletteCommand[] = searchRecords
      .filter((record) => record.kind === 'pdf' || record.kind === 'markdown')
      .map((record) => ({
        id: `doc:${record.id}`,
        kind: record.kind === 'pdf' ? 'pdf' as const : 'markdown' as const,
        label: record.displayName,
        keywords: record.path,
        run: () => openVaultSearchResult({ record, page: null, snippet: '', query: '' }),
      }))
    return [...actions, ...documents]
  }
  // 마우스 옆 단추(뒤로=3, 앞으로=4)는 어디서 누르든 문서 점프 기록을 오간다.
  useEffect(() => {
    const onMouseUp = (event: MouseEvent) => {
      if (event.button !== 3 && event.button !== 4) return
      event.preventDefault()
      if (event.button === 3) navigationBackRef.current()
      else navigationForwardRef.current()
    }
    // 웹뷰가 이 단추로 페이지 뒤로가기를 하지 않게 누를 때부터 막는다
    const swallow = (event: MouseEvent) => { if (event.button === 3 || event.button === 4) event.preventDefault() }
    window.addEventListener('mouseup', onMouseUp)
    window.addEventListener('mousedown', swallow)
    return () => {
      window.removeEventListener('mouseup', onMouseUp)
      window.removeEventListener('mousedown', swallow)
    }
  }, [])
  // 탭·패널 단축키가 부를 최신 함수. 패널 상태는 아래에서 만들어지므로 ref 로 잇는다.
  const paneShortcutsRef = useRef({
    cycleTab: (_step: number) => undefined as void,
    closeActiveTab: () => undefined as void,
    focus: (_index: number) => undefined as void,
  })
  const canvasStorage = useMemo<CanvasStorage>(
    () => previewEnabled
      ? createMemoryCanvasStorage()
      : vault === null
        ? createBrowserCanvasStorage()
        : createVaultCanvasStorage(vault),
    [previewEnabled, vault],
  )
  // 바깥 AI(MCP canvas_* 도구)가 캔버스를 읽고 고친다
  useMcpCanvasBridge({ vault, tree, storage: canvasStorage, loadPdfById, enabled: CANVAS_ENABLED })
  const blockPresetStorage = useMemo<BlockPresetStorage>(
    () => vault === null ? createBrowserBlockPresetStorage() : createVaultBlockPresetStorage(vault),
    [vault],
  )
  const blockPresets = useBlockPresets(blockPresetStorage)
  const pdfHighlightStorage = useMemo(
    () => vault === null
      ? createBrowserPdfHighlightStorage()
      : createVaultPdfHighlightStorage(vault),
    [vault],
  )
  const pdfHighlights = usePdfHighlights(pdfHighlightStorage)
  // 설정 창의 「형광펜 색」이 색을 지울 때 몇 개가 영향받는지 알려 주려고 색별 개수를 넘긴다
  useEffect(() => { setHighlightColorUsage(countByHighlightColor(pdfHighlights.highlights)) }, [pdfHighlights.highlights])
  // MCP memo_* 도구(Claude 가 PDF 에 형광펜 메모를 만들고 고친다)
  const markdownHighlightStorage = useMemo(
    () => vault === null
      ? createBrowserMarkdownHighlightStorage()
      : createVaultMarkdownHighlightStorage(vault),
    [vault],
  )
  const markdownHighlights = useMarkdownHighlights(markdownHighlightStorage)
  // 캔버스 블록이 어느 메모에 이어졌는지 알아내는 데 쓰는 형광펜(메모)들. Markdown 메모도 같은 저장소에 있다(anchor.docId 가 파일 경로)
  const canvasHighlights: readonly PointableHighlight[] = pdfHighlights.highlights
  const pdfBookmarkStorage = useMemo(
    () => vault === null
      ? createBrowserPdfBookmarkStorage()
      : createVaultPdfBookmarkStorage(vault),
    [vault],
  )
  const pdfBookmarks = usePdfBookmarks(pdfBookmarkStorage)
  // 마지막으로 만진 패널. 사이드바 목차·축소판·주석과 Ctrl+F 가 이 패널의 문서를 따른다.
  const [activePaneId, setActivePaneId] = useState<PaneId>(() => leaves(layoutRoot)[0]!)
  /** 방금 나눠서 생긴 패널(자라듯 나타나는 동안만) */
  const [freshPane, setFreshPane] = useState<PaneId | null>(null)
  // 패널마다 지금 보이는 PDF 와 쪽. DocumentView 가 알려 준다.
  const [docViews, setDocViews] = useState<Partial<Record<PaneId, DocumentViewState>>>({})
  const docControllersRef = useRef<Partial<Record<PaneId, DocumentViewController>>>({})
  const handleDocViewChange = useCallback((pane: PaneId, view: DocumentViewState | null) => {
    setDocViews((current) => {
      const previous = current[pane]
      if (view === null ? previous === undefined : previous?.docId === view.docId && previous.page === view.page) return current
      const next = { ...current }
      if (view === null) delete next[pane]
      else next[pane] = view
      return next
    })
  }, [])
  const isDocTab = (tab: Tab | null) => tab !== null && isDocumentKind(tab.kind)
  // 문서 기능(목차·검색·쪽 이동)이 향할 패널: 만진 패널이 문서면 그쪽, 아니면 반대편 문서.
  const docPaneId: PaneId | null = isDocTab(activeTab(tabsOf(panes, activePaneId)))
    ? activePaneId
    : paneOrder.find((pane) => pane !== activePaneId && isDocTab(activeTab(tabsOf(panes, pane)))) ?? null
  // 발췌를 받을 캔버스: 만진 패널이 캔버스면 그쪽, 아니면 반대편 캔버스.
  // 창이 둘 넘게 있어도 보이는 캔버스를 찾는다(만진 창 → 같은 색 → 아무 캔버스)
  const notePaneId: PaneId | null = pickCanvasPane({ panes, channels, visible: paneOrder, active: activePaneId })
  const activeDocumentTab = docPaneId === null ? null : activeTab(tabsOf(panes, docPaneId))
  // Markdown 탭마다 지금 절(왼쪽 바 「목차」에 지금 자리로 보인다)
  const [markdownSectionState, setMarkdownSectionState] = useState<Readonly<Record<string, number>>>({})
  useEffect(() => {
    const onState = (event: Event) => {
      const detail = (event as CustomEvent<{ path: string; current: number }>).detail
      if (detail !== undefined) setMarkdownSectionState((current) => (current[detail.path] === detail.current ? current : { ...current, [detail.path]: detail.current }))
    }
    window.addEventListener('iwae:md-section-state', onState)
    return () => window.removeEventListener('iwae:md-section-state', onState)
  }, [])
  const activePdfDoc = activeDocumentTab?.kind === 'pdf'
    ? openedDocs.find((doc) => doc.docId === tabDocId(activeDocumentTab)) ?? null
    : null
  const activeMarkdownPath = activeDocumentTab?.kind === 'markdown' ? activeDocumentTab.id : null
  const activeNoteId = notePaneId === null ? null : activeTab(tabsOf(panes, notePaneId))?.id ?? null
  const currentPdfPage = docPaneId === null ? 1 : docViews[docPaneId]?.page ?? 1
  paneShortcutsRef.current = {
    cycleTab: (step) => {
      const state = tabsOf(panes, activePaneId)
      if (state.tabs.length < 2) return
      const index = state.tabs.findIndex((tab) => tab.id === state.activeId)
      const next = state.tabs[(index + step + state.tabs.length) % state.tabs.length]
      if (next !== undefined) setPanes((current) => ({ ...current, [activePaneId]: activateTab(tabsOf(current, activePaneId), next.id) }))
    },
    closeActiveTab: () => {
      const id = tabsOf(panes, activePaneId).activeId
      if (id === null) return
      const tab = tabsOf(panes, activePaneId).tabs.find((candidate) => candidate.id === id)
      if (tab?.kind === 'canvas') closeNoteTabSafely(id)
      else setPanes((current) => closeTabEverywhere(current, id))
    },
    // 칸 번호(왼쪽 위부터 0)로 옮긴다
    focus: (index) => { const pane = paneOrder[index]; if (pane !== undefined) setActivePaneId(pane) },
  }
  /** 칸의 지금 크기(px)를 DOM 에서 잰다(나누기가 칸을 너무 작게 만들지 않는지 볼 때). 재지 못하면 null */
  const paneSizeOf = (pane: PaneId): Size | null => {
    const cell = document.querySelector(`.pane-focus-scope[data-pane-id="${pane}"]`)?.closest<HTMLElement>('.pane-grid-cell')
    if (cell == null) return null
    const box = cell.getBoundingClientRect()
    return box.width > 0 && box.height > 0 ? { width: box.width, height: box.height } : null
  }
  /** 칸을 못 나눈 까닭을 알린다 */
  const announceRefusal = (reason: SplitRefusal) => announceAction(reason === 'max' ? t('칸은 {max}개까지입니다', { max: MAX_PANES }) : t('칸이 너무 작습니다'))
  /** 칸 수만 정할 때(MCP 칸 수·Ctrl+\): 줄이면 뒤 칸을 합치고, 늘리면 마지막 칸을 좌우로 나눈다. 칸 수를 바꾼 뒤의 칸 차례 */
  const setPaneCount = (next: number): readonly PaneId[] => {
    const now = workspaceLatest.current
    const result = setPaneCountTree({ panes: now.panes, channels: now.channels, layout: now.layout }, next, paneSizeOf)
    applyWorkspace(result)
    if (result.refused !== null) announceRefusal(result.refused)
    const order = leaves(result.layout)
    if (!order.includes(now.activePaneId)) setActivePaneId(order[order.length - 1]!)
    if (next === 1) setFocusedPane('split')
    return order
  }
  /** 적어도 count 칸이 되게 늘린다(MCP 가 아직 없는 칸 번호를 가리킬 때). 칸 차례를 돌려준다 */
  const growPanes = (count: number): readonly PaneId[] => {
    const order = leaves(workspaceLatest.current.layout)
    return order.length >= count ? order : setPaneCount(count)
  }
  // Ctrl+\ : 한 칸 → 좌우 둘 → 좌우 셋 → 한 칸
  const toggleSinglePaneRef = useRef(() => setPaneCount(paneCount >= 3 ? 1 : paneCount + 1))
  toggleSinglePaneRef.current = () => setPaneCount(paneCount >= 3 ? 1 : paneCount + 1)
  // 트리와 칸 상태가 어긋나면(칸이 닫혔는데 탭이 남음, 만지던 칸이 사라짐) 바로잡는다: 남은 탭은 마지막 칸 뒤에 합친다
  // (떠 있는 칸은 트리 밖이지만 어긋난 칸이 아니다: 칸 상태가 있고, 보이는 동안은 만지는 칸 · 새 탭을 여는 칸이 될 수 있다)
  const orphanKey = paneIdsOf(panes).filter((pane) => !paneOrder.includes(pane) && !floatIds.includes(pane)).join(' ')
  const floatKey = shownFloats.map((float) => float.paneId).join(' ')
  useEffect(() => {
    const last = paneOrder[paneOrder.length - 1]!
    const usable = (pane: PaneId) => paneOrder.includes(pane) || (floatKey !== '' && floatKey.split(' ').includes(pane))
    if (orphanKey !== '') setPanes((current) => orphanKey.split(' ').reduce((next, pane) => closePaneInto(next, pane, last), current))
    if (!usable(activePaneId)) setActivePaneId(paneOrder[0]!)
    if (!usable(paneRouteRef.current.doc)) setPaneRoute('doc', paneOrder[0]!)
    if (!usable(paneRouteRef.current.note)) setPaneRoute('note', paneOrder[1] ?? paneOrder[0]!)
  }, [orphanKey, floatKey, paneOrder, activePaneId, setPanes, setPaneRoute, paneRouteRef])
  const focusPane = useCallback((pane: PaneId) => {
    setActivePaneId(pane)
    const tab = activeTab(tabsOf(panes, pane))
    if (tab !== null) setPaneRoute(paneRouteOf(tab.kind), pane)
    else {
      // 빈 창을 눌렀다: 다음에 여는 문서·노트가 이 창으로 온다
      setPaneRoute('doc', pane)
      setPaneRoute('note', pane)
    }
  }, [panes, setPaneRoute])
  const workspaceSources = useWorkspaceSources({
    scopeId: activeNoteId,
    activeDocId: activePdfDoc?.docId ?? null,
    activeMarkdownPath,
    currentPage: currentPdfPage - 1,
  })
  // 다른 문서의 특정 쪽으로 점프할 때 그 쪽 번호를 여기 맡겨 둔다. 그 문서를 연 패널이
  // 꺼내 쓴다 — 없으면 다른 문서로의 출처 이동이 언제나 마지막으로 읽던 쪽에서 멈춘다.
  const pendingDocPageRef = useRef<NavLocation | null>(null)


  const requestPdfPage = useCallback((page: number) => {
    if (docPaneId !== null) docControllersRef.current[docPaneId]?.requestPage(page)
  }, [docPaneId])

  /** 문서·쪽으로 간다. 어느 패널에 보이면 그 패널에서, 아니면 탭을 열고 쪽은 맡겨 둔다. */
  const navigateToPdfLocation = useCallback((location: NavLocation) => {
    // 같은 PDF 가 양쪽에 열려 있으면 지금 만지는 패널이 먼저다
    // 보이는 모든 창에서 찾는다(만진 창이 먼저)
    const showing = [activePaneId, ...paneOrder.filter((pane) => pane !== activePaneId)].find((pane) => docControllersRef.current[pane]?.docId === location.docId)
    if (showing !== undefined) {
      docControllersRef.current[showing]?.requestPage(location.page)
      setActivePaneId(showing)
      return
    }
    pendingDocPageRef.current = location
    const placed = paneIdsOf(panes).find((pane) => tabsOf(panes, pane).tabs.some((tab) => tabDocId(tab) === location.docId))
    setActivePaneId(placed ?? paneRouteRef.current.doc)
    const opened = openedDocs.find((doc) => doc.docId === location.docId)
    if (opened !== undefined) {
      openInPane({ id: opened.docId, title: opened.title, kind: 'pdf' })
      return
    }
    const libraryDoc = shownLibrary.find((doc) => doc.docId === location.docId)
    if (libraryDoc !== undefined) void openDocument(libraryDoc)
    else pendingDocPageRef.current = null
  }, [activePaneId, openDocument, openInPane, openedDocs, paneOrder, paneRouteRef, panes, shownLibrary])

  const navigation = useNavigationHistory({
    current: () => activePdfDoc === null ? null : { docId: activePdfDoc.docId, page: currentPdfPage },
    navigate: navigateToPdfLocation,
    exists: (location) => openedDocs.some((doc) => doc.docId === location.docId)
      || shownLibrary.some((doc) => doc.docId === location.docId),
  })
  /** 모든 문서 검색 결과: 그 쪽을 열고(이미 열린 탭이면 그 쪽으로) 검색어가 처음 나오는 자리를 칠한다 */
  const openVaultHit = useCallback(async (hit: VaultSearchHit) => {
    if (hit.page === null) return
    const pageIndex = hit.page
    setDraftPdfHighlight(null)
    navigation.jump({ docId: hit.record.id, page: pageIndex + 1 })
    // 쪽 글자는 문서가 열린 뒤에야 읽힌다. 처음 여는 문서면 조금 기다렸다 다시 묻는다.
    const query = hit.query.trim().toLocaleLowerCase()
    for (let attempt = 0; attempt < 10; attempt += 1) {
      try {
        const index = await pageTextIndex(hit.record.id, pageIndex)
        const at = index.text.toLocaleLowerCase().indexOf(query)
        if (at >= 0) setDraftPdfHighlight(buildAnchor(hit.record.id, pageIndex, index, at, at + query.length))
        return
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 300))
      }
    }
  }, [navigation])
  // 왼쪽 바 「PDF 검색」 보기의 칸. 지금 문서의 검색 칸·결과가 여기에 붙는다
  const [pdfSearchSlot, setPdfSearchSlot] = useState<HTMLElement | null>(null)
  // 메모 노트: 오른쪽 바에 PDF 와 따로 여는 노트(여러 PDF 의 메모 + 글 블록). 처음 한 번 예전 카테고리를 노트로 옮긴다
  const memoNoteDocTitle = useCallback((docId: string) => docTitles[docId] ?? '', [docTitles])
  // 노트 경로가 바뀌면(이름 바꾸기·옮기기) 그 노트를 탭으로 연 창의 탭도 따라가고, 지워진 노트의 탭은 닫는다
  const followMovedMemoNotes = useFollowMovedMemoNotes(setPanes)
  const memoNotes = useMemoNotes(vault, pdfHighlights.highlights, memoNoteDocTitle, announceAction, followMovedMemoNotes)
  useSyncMemoNoteTabs(setPanes, memoNotes.loaded, memoNotes.entries)
  // PDF 별 노트: 문서 id → 노트를 가지는 줄(버전 묶음이면 대표 문서). 지워졌거나 찾을 수 없는 PDF 의 노트는 일반 노트로 보인다
  const noteKnownDocIds = useMemo(() => new Set(shownLibrary.filter((doc) => !missingDocIds.includes(doc.docId)).map((doc) => doc.docId)), [missingDocIds, shownLibrary])
  const noteDocOwner = useCallback(
    (docId: string) => memoNoteOwner(docId, noteKnownDocIds, Object.values(versionGroups.groups)),
    [noteKnownDocIds, versionGroups.groups],
  )
  const noteDocLabel = useCallback(
    (docId: string) => groupOfDoc(versionGroups.groups, docId)?.title ?? docTitles[docId] ?? '',
    [docTitles, versionGroups.groups],
  )
  /** 이 PDF 의 노트를 만든다(만든 경로). 열기는 부르는 쪽이 한다 */
  const createNoteForDoc = useCallback(async (docId: string) => {
    const owner = noteDocOwner(docId) ?? docId
    const title = docNoteTitle(noteDocLabel(owner), memoNotes.entries.map((entry) => entry.title))
    return memoNotes.createIn('', title, owner)
  }, [memoNotes, noteDocLabel, noteDocOwner])

  // ---------- 작업 공간: 색 채널·가리키기 신호 ----------
  // 같은 색 창끼리만 연동한다. 형광펜·카드·출처를 누르면 그 창이 신호(workspaceSignal)를 보내고,
  // 여기서 「필요한 문서·노트가 같은 색 창에 보이게」 한다(탭 활성화 → 미리보기 탭 → 옆에 새 창). 스크롤·깜빡임은 받는 창이 한다.
  const previewTabsEnabled = useAppPrefs().previewTabs
  /** 화면을 옮긴다: 라이브러리는 접고(칸이 보이게) 화면은 바로 바뀐다(움직임 없음). 다른 화면의 PDF 보기는 닫히고, 돌아오면 저장된 쪽·배율로 다시 연다 */
  const switchToScreen = useCallback((id: string) => {
    setLibraryExpanded(false)
    screenOps.switchTo(id)
  }, [screenOps])
  /** 명령 팔레트 단추 곁에 보일 키: Ctrl+K(별칭)가 있으면 그것, 없으면 대표 키 */
  const paletteHint = (() => {
    const def = getShortcutDef('commandPalette')
    const keys = def === undefined ? [] : effectiveKeys(def)
    const preferred = keys.includes('Mod+K') ? 'Mod+K' : keys[0]
    return preferred === undefined ? undefined : comboText(preferred)
  })()
  const prefixHint = shortcutText(PREFIX_KEY_ID) ?? 'Ctrl+B'
  /** 「?」 목록의 「접두키 없이 되는 키」 */
  const shortcutKeys = (name: Parameters<typeof shortcutText>[0]) => shortcutText(name) ?? ''
  const keysHelpCurrentKeys = () => [
    { label: t('명령 팔레트'), keys: paletteHint ?? '' },
    { label: t('옆에 노트 열기·닫기'), keys: shortcutKeys('toggleNoteBeside') },
    { label: t('왼쪽 칸으로'), keys: shortcutKeys('focusLeftPane') },
    { label: t('오른쪽 칸으로'), keys: shortcutKeys('focusRightPane') },
    { label: t('다음 탭'), keys: shortcutKeys('nextTab') },
    { label: t('단축키 보기'), keys: shortcutKeys('showShortcuts') },
  ]
  const pinPaneTab = useCallback((tabId: string) => setPanes((current) => pinTabInPanes(current, tabId)), [setPanes])
  const workspaceLatest = useRef({ panes, channels, layout: layoutRoot, previewTabsEnabled, docPaneId, activePaneId })
  workspaceLatest.current = { panes, channels, layout: layoutRoot, previewTabsEnabled, docPaneId, activePaneId }
  const memoNotesRef = useRef(memoNotes)
  memoNotesRef.current = memoNotes

  // ---------- 옆에 노트 열기 ----------
  // 노트 바는 없다: 노트는 창의 탭이고, 「읽기」 배치(문서 | 노트)는 문서 창 옆에 노트 창을 여는 것이다.
  const noteTabOf = (path: string): Tab => ({ id: path, title: memoNoteTitleOf(path), kind: 'memoNote' })
  /** 새 창이 자라듯 나타나고, 끝나면 연결선이 새 자리를 다시 잰다 */
  const announceFreshPane = (pane: PaneId) => {
    setFreshPane(pane)
    window.setTimeout(() => setFreshPane(null), 320)
    window.setTimeout(() => {
      window.dispatchEvent(new Event('resize'))
      window.dispatchEvent(new Event('iwae:pane-resize-end'))
    }, 280)
  }
  /**
   * 창·색·배치를 바꾼다. 같은 틱의 다음 호출이 새 배치를 보도록 최신 값(workspaceLatest)도 바로 고친다.
   * fresh: 새로 생긴 창(자라듯 나타나게 한다)
   */
  const applyWorkspace = (next: { readonly panes: PanesState; readonly channels: PaneChannels; readonly layout: LayoutNode }, fresh?: PaneId) => {
    const latest = workspaceLatest.current
    workspaceLatest.current = { ...latest, panes: next.panes, channels: next.channels, layout: next.layout }
    if (next.panes !== latest.panes || next.channels !== latest.channels || next.layout !== latest.layout) {
      setWorkspace({ panes: next.panes, channels: next.channels, layout: next.layout })
    }
    if (fresh !== undefined) announceFreshPane(fresh)
  }
  /** 노트를 붙일 문서 창: 지금 보는 문서 창, 없으면 문서를 보는 첫 창. 문서가 없으면 null */
  const anchorDocPane = (): PaneId | null => {
    const now = workspaceLatest.current
    if (now.docPaneId !== null) return now.docPaneId
    return leaves(now.layout).find((pane) => isDocTab(activeTab(tabsOf(now.panes, pane)))) ?? null
  }
  // 옆에 노트 열기의 흐름(어느 노트를 열지 → 어디에 놓을지 → 반영)은 noteBeside.ts 가 맡고, 앱은 손잡이만 내준다
  const besideHostRef = useRef<NoteBesideHost | null>(null)
  besideHostRef.current = {
    snapshot: () => ({ panes: workspaceLatest.current.panes, channels: workspaceLatest.current.channels, layout: workspaceLatest.current.layout }),
    apply: applyWorkspace,
    sizeOf: paneSizeOf,
    lastTouched: () => memoNotesRef.current.openPath,
    entries: () => memoNotesRef.current.entries,
    docOwner: noteDocOwner,
    createForDoc: createNoteForDoc,
    createGeneral: () => memoNotesRef.current.create(),
    touch: (path) => memoNotesRef.current.open(path),
    available: () => vault !== null,
    docIdOf: (tab) => (tab !== null && isDocumentKind(tab.kind) ? tabDocId(tab) : null),
  }
  const besideRef = useRef<NoteBesideOpener | null>(null)
  besideRef.current ??= createNoteBesideOpener({
    snapshot: () => besideHostRef.current!.snapshot(),
    apply: (next, fresh) => besideHostRef.current!.apply(next, fresh),
    lastTouched: () => besideHostRef.current!.lastTouched(),
    entries: () => besideHostRef.current!.entries(),
    docOwner: (docId) => besideHostRef.current!.docOwner(docId),
    createForDoc: (docId) => besideHostRef.current!.createForDoc(docId),
    createGeneral: () => besideHostRef.current!.createGeneral(),
    touch: (path) => besideHostRef.current!.touch(path),
    available: () => besideHostRef.current!.available(),
    docIdOf: (tab) => besideHostRef.current!.docIdOf(tab),
  })
  /** 「옆에 노트 열기」: 어느 노트를 열지는 마지막으로 만진 노트 → 이 문서의 노트 → 새 노트 순서다. 열린 노트 경로(못 열면 null) */
  const openNoteBeside = (pane: PaneId | null, notePath?: string, preview = false): Promise<string | null> => {
    const anchor = pane ?? anchorDocPane()
    return anchor === null ? Promise.resolve(null) : besideRef.current!.open(anchor, notePath, preview)
  }
  /** 노트 탭 열기(사이드바·노트 열기 메뉴·티켓의 다른 자리): 이미 탭이면 그 탭으로, 노트를 보이는 창이 있으면 거기에 탭으로, 아니면 문서 창 옆에 새 창. 놓은 창 */
  const openMemoNoteTab = (path: string, from?: PaneId): PaneId => {
    const now = workspaceLatest.current
    const anchor = from ?? (activeTab(tabsOf(now.panes, now.activePaneId))?.kind === 'memoNote' ? now.activePaneId : anchorDocPane() ?? now.activePaneId)
    const outcome = besideRef.current!.place(anchor, path)
    setActivePaneId(outcome.pane)
    setPaneRoute('note', outcome.pane)
    return outcome.pane
  }
  /**
   * 캔버스 탭 열기(사이드바·검색·서재·새 캔버스·「정리」): 이미 탭이면 그 탭으로, 같은 색 창에 캔버스가 보이면 거기에 탭으로,
   * 아니면 문서 창 옆에 새 창(메모 노트와 같은 규칙). 비어 있는 창이거나 나눌 수 없으면 그 창에 바로 연다. 놓은 창
   */
  const openCanvasTab = (note: { readonly path: string; readonly title: string }): PaneId => {
    const now = workspaceLatest.current
    const tab: Tab = { id: note.path, title: note.title, kind: 'canvas' }
    const active = now.activePaneId
    const anchor = activeTab(tabsOf(now.panes, active))?.kind === 'canvas' ? active : anchorDocPane() ?? active
    if (!SPLIT_PANES_ENABLED || isDetachedWindow || tabsOf(now.panes, anchor).tabs.length === 0) {
      openInPane(tab, anchor)
      setActivePaneId(anchor)
      setPaneRoute('note', anchor)
      return anchor
    }
    const outcome = placeNoteTab({ panes: now.panes, channels: now.channels, layout: now.layout, anchor, tab, sizeOf: paneSizeOf })
    applyWorkspace({ panes: outcome.panes, channels: outcome.channels, layout: outcome.layout }, outcome.kind === 'beside' ? outcome.pane : undefined)
    setActivePaneId(outcome.pane)
    setPaneRoute('note', outcome.pane)
    return outcome.pane
  }
  openCanvasTabRef.current = openCanvasTab
  /** 「옆에 노트 열기 / 닫기」: 같은 색 창에 노트가 보이면 그 노트 창을 닫고, 아니면 연다 */
  const toggleNoteBeside = () => {
    const anchor = anchorDocPane()
    if (anchor === null) return
    const result = besideRef.current!.toggle(anchor)
    if (result.kind === 'opening') {
      void result.opened.then((path) => {
        if (path === null) announceAction(t('열 수 있는 노트가 없습니다'))
      })
      return
    }
    const landed = anchor
    setActivePaneId(landed)
    setPaneRoute('doc', landed)
  }
  /** 노트를 보이는 같은 색 창이 있는가(상단바 단추의 눌림 표시) */
  const noteBesideShown = docPaneId !== null && visibleNotePathsIn(panes, channels, paneOrder, channelOf(channels, docPaneId)).length > 0
  /** 이름 붙은 배치: 지금 탭들을 그 모양으로 다시 놓는다(탭은 닫지 않는다) */
  // 마지막으로 만진 캔버스: 캔버스 탭이 보이는 창에 포커스가 가면 그 캔버스(「정리」가 고른다)
  const lastCanvasRef = useRef<string | null>(null)
  const focusedCanvasTab = activeTab(tabsOf(panes, activePaneId))
  if (focusedCanvasTab?.kind === 'canvas') lastCanvasRef.current = focusedCanvasTab.id
  /** 「정리」에 놓을 새 캔버스(같은 이름이 있으면 번호를 붙인다). 못 만들면 undefined */
  const createCanvasForPreset = async (): Promise<{ path: string; title: string } | undefined> => {
    for (let attempt = 1; attempt <= 20; attempt += 1) {
      try {
        return await createCanvasNote('', attempt === 1 ? t('캔버스') : t('캔버스 {n}', { n: attempt }))
      } catch { /* 같은 이름이 이미 있다: 다음 이름으로 */ }
    }
    return undefined
  }
  /**
   * 템플릿이 쓸 노트·캔버스(없으면 만든다). pool 은 그 화면에 이미 있는 탭들(노트·캔버스가 있으면 그것을 쓰고 이 값은 필요 없다).
   * 「정리」: 열린 캔버스가 없으면 마지막으로 만진 캔버스 → 목록의 첫 캔버스 → 새 캔버스(노트를 만드는 것과 같은 길)
   */
  const resolveTemplateFallbacks = async (id: LayoutPresetId, pool: PanesState, docId: string | null): Promise<{ fallbackNote: Tab | null; fallbackCanvas: Tab | null }> => {
    const hasNote = allPaneTabs(pool).some((tab) => tab.kind === 'memoNote')
    let fallbackCanvas: Tab | null = null
    if (id === 'organize' && CANVAS_ENABLED && !allPaneTabs(pool).some((tab) => tab.kind === 'canvas')) {
      const known = shownNotebooks.flatMap((group) => group.notes).filter((note) => !/.(?:md|markdown)$/iu.test(note.path))
      const note = known.find((entry) => entry.path === lastCanvasRef.current) ?? known[0] ?? await createCanvasForPreset()
      if (note !== undefined) fallbackCanvas = { id: note.path, title: note.title, kind: 'canvas' }
    }
    let fallbackPath: string | null = null
    if (!hasNote && id !== 'organize') {
      fallbackPath = pickNotePath({ lastTouched: memoNotesRef.current.openPath, docId, entries: memoNotesRef.current.entries, docOwner: noteDocOwner })
      if (fallbackPath === null && docId !== null) fallbackPath = await createNoteForDoc(docId)
    }
    return { fallbackNote: fallbackPath === null ? null : noteTabOf(fallbackPath), fallbackCanvas }
  }
  /** 「이 화면을 템플릿으로 다시 짜기」: 지금 탭들을 그 모양으로 다시 놓는다(탭은 닫지 않는다) */
  const applyPreset = async (id: LayoutPresetId) => {
    const now = workspaceLatest.current
    const anchor = anchorDocPane()
    const docTab = anchor === null ? null : activeTab(tabsOf(now.panes, anchor))
    const docId = docTab !== null && isDocumentKind(docTab.kind) ? tabDocId(docTab) : null
    const fallbacks = await resolveTemplateFallbacks(id, now.panes, docId)
    const latest = workspaceLatest.current
    const result = applyLayoutPreset({ id, panes: latest.panes, channels: latest.channels, layout: latest.layout, anchor, lastTouched: memoNotesRef.current.openPath, fallbackNote: fallbacks.fallbackNote, lastCanvas: lastCanvasRef.current, fallbackCanvas: fallbacks.fallbackCanvas })
    applyWorkspace({ panes: result.panes, channels: result.channels, layout: result.layout })
    setActivePaneId(result.focus)
    const focusTab = activeTab(tabsOf(result.panes, result.focus))
    if (focusTab !== null) setPaneRoute(paneRouteOf(focusTab.kind), result.focus)
    announceFreshPane(result.fresh)
  }
  /** 「새 화면 ▸ 템플릿」: 보던 문서와 마지막으로 만진 노트로 그 모양의 새 화면을 만들어 그리로 간다(바로, 움직임 없이) */
  const newScreenFromTemplate = async (id: ScreenTemplateId, nameOverride?: string) => {
    const now = workspaceLatest.current
    setLibraryExpanded(false)
    const anchor = id === 'blank' ? null : anchorDocPane()
    const docTab = anchor === null ? null : activeTab(tabsOf(now.panes, anchor))
    const document = docTab !== null && isDocumentKind(docTab.kind) ? docTab : null
    const fallbacks = id === 'blank' ? { fallbackNote: null, fallbackCanvas: null } : await resolveTemplateFallbacks(id, {}, document === null ? null : tabDocId(document))
    const built = buildTemplateScreen({
      id,
      name: nameOverride ?? templateScreenName(id, screens.length),
      document,
      documentChannel: anchor === null ? null : channelOf(now.channels, anchor),
      lastTouched: memoNotesRef.current.openPath,
      fallbackNote: fallbacks.fallbackNote,
      lastCanvas: lastCanvasRef.current,
      fallbackCanvas: fallbacks.fallbackCanvas,
    }, allScreenPaneIds(screensState))
    screenOps.add(built.screen)
    const order = leaves(built.screen.layout)
    setActivePaneId(built.focus)
    setPaneRoute('doc', built.focus)
    setPaneRoute('note', order[1] ?? built.focus)
  }
  /** 칸 머리 ⋯ 「오른쪽으로 · 아래로 나누기」(split-window). 크게 보던 중이면 먼저 푼다. 새 칸은 비어 있고 이 칸의 색을 받는다 */
  const splitPaneFromHead = (pane: PaneId, dir: SplitDir) => {
    const now = workspaceLatest.current
    const result = splitPane({ panes: now.panes, channels: now.channels, layout: now.layout }, pane, dir, paneSizeOf)
    if ('refused' in result) { announceRefusal(result.refused); return }
    if (zoomedPane !== null) screenOps.setZoomed(null)
    applyWorkspace(result, result.newPane)
    setActivePaneId(result.newPane)
    // 빈 칸을 만들었다: 다음에 여는 문서·노트가 이 칸으로 온다
    setPaneRoute('doc', result.newPane)
    setPaneRoute('note', result.newPane)
  }
  /** 칸 머리 ⋯ 「칸 자리 바꾸기」(swap-pane): 다음 칸과(맨 끝 칸이면 앞 칸과) 자리를 맞바꾼다. 탭·색은 칸을 따라간다 */
  const swapPaneWithNeighbor = (pane: PaneId) => {
    const now = workspaceLatest.current
    const order = leaves(now.layout)
    const index = order.indexOf(pane)
    const other = order[index + 1] ?? order[index - 1]
    if (index < 0 || other === undefined) return
    applyWorkspace({ panes: now.panes, channels: now.channels, layout: swapLeaves(now.layout, pane, other) })
  }
  /** 칸 머리 ⋯ 「새 화면으로 떼기」(break-pane): 이 칸을 새 화면으로 옮겨 그리로 간다 */
  const breakPaneToScreen = (pane: PaneId) => {
    if (paneCount <= 1) { announceAction(t('칸이 하나뿐입니다')); return }
    setLibraryExpanded(false)
    screenOps.breakPane(pane, t('화면 {n}', { n: screens.length }))
    setActivePaneId(pane)
  }
  /** 빈 칸의 빠른 단추(PDF · MD · 노트. 캔버스는 꺼 두어 단추가 없다). 누른 칸이 다음에 여는 것을 받는다 */
  const emptyPaneActions = {
    pdf: (pane: PaneId) => { setPaneRoute('doc', pane); setActivePaneId(pane); void addDocument() },
    markdown: (pane: PaneId) => { setPaneRoute('doc', pane); setActivePaneId(pane); toggleLibrary() },
    note: async (pane: PaneId) => {
      setPaneRoute('note', pane)
      setActivePaneId(pane)
      const latest = memoNotesRef.current
      const last = latest.openPath !== null && latest.entries.some((entry) => entry.path === latest.openPath) ? latest.openPath : null
      const path = last ?? await latest.create()
      if (path === null) { announceAction(t('열 수 있는 노트가 없습니다')); return }
      openInPane(noteTabOf(path), pane)
      memoNotesRef.current.open(path)
    },
    canvas: async (pane: PaneId) => {
      setPaneRoute('note', pane)
      setActivePaneId(pane)
      const known = shownNotebooks.flatMap((group) => group.notes).filter((note) => !/.(?:md|markdown)$/iu.test(note.path))
      const note = known.find((entry) => entry.path === lastCanvasRef.current) ?? known[0] ?? await createCanvasForPreset()
      if (note === undefined) { announceAction(t('열 수 있는 노트가 없습니다')); return }
      openInPane({ id: note.path, title: note.title, kind: 'canvas' }, pane)
    },
  }
  // ───────── 접두키 · `:` 명령줄 · 워크스페이스 명령(설계 8) ─────────
  const [paneNumbersOpen, setPaneNumbersOpen] = useState(false)
  /** 지우기 확인을 기다리는 세션(kill-session · 세션 메뉴의 「삭제」) */
  const [sessionToKill, setSessionToKill] = useState<string | null>(null)
  /** 명령 팔레트를 열 때 미리 채울 글(`:` 명령줄이 팔레트로 온다) */
  const [paletteInitial, setPaletteInitial] = useState('')
  const commandModelRef = useRef<WorkspaceModel>({ screens: screensState, activePane: activePaneId })
  commandModelRef.current = { screens: screensState, activePane: activePaneId }
  const prefixApiRef = useRef<{ readonly startConfirm: () => void }>({ startConfirm: () => undefined })
  /** 접두키 칩의 y/n 이 무엇을 묻는가: 화면 닫기(&) · 앱 닫기(마지막 앱 창의 detach) */
  const confirmKindRef = useRef<'kill-window' | 'quit'>('kill-window')
  // .iwae/keys.conf: bind-key · unbind-key · set prefix. Vault 를 열 때와 source-file 때 읽는다(파일 감시는 하지 않는다)
  const [keyBindings, setKeyBindings] = useState<Readonly<Record<string, string>>>({})
  /** keys.conf 를 읽어 본 Vault(null = Vault 없음)와 거기서 접두키를 정했는가. 첫 실행 「접두키 고르기」 창이 이것을 기다린다 */
  const [keysConfPrefix, setKeysConfPrefix] = useState<{ readonly root: string | null; readonly sets: boolean } | null>(null)
  const loadKeysConf = useCallback(async (): Promise<CommandResult & { readonly found: boolean }> => {
    if (vault === null) { setKeyBindings({}); setKeysConfPrefix({ root: null, sets: false }); return { ok: false, found: false, message: t('Vault 를 연 뒤에 쓸 수 있습니다') } }
    try {
      const { readKeysConf } = await import('../bridge/vault')
      const text = await readKeysConf(vault)
      const conf = parseKeysConf(text ?? '')
      setKeyBindings(conf.bindings)
      setKeysConfPrefix({ root: vault.root, sets: conf.prefix !== null })
      if (conf.prefix !== null) setAppPref('shortcuts', withBinding(getShortcutOverrides(), PREFIX_KEY_ID, conf.prefix))
      if (conf.errors.length > 0) return { ok: false, found: true, message: t('keys.conf 를 일부 건너뛰었습니다: {line}', { line: conf.errors[0]! }) }
      return { ok: true, found: text !== null, message: text === null ? t('keys.conf 가 없습니다') : t('keys.conf 를 읽었습니다') }
    } catch {
      setKeysConfPrefix({ root: vault.root, sets: false })
      return { ok: false, found: false, message: t('keys.conf 를 읽지 못했습니다') }
    }
  }, [vault])
  useEffect(() => {
    void loadKeysConf().then((result) => { if (!result.ok && result.found) announceAction(result.message) })
  }, [loadKeysConf])
  /** 이름으로 열기(open 명령): 문서 · 노트 · 캔버스를 이름(없으면 경로)으로 찾아 pane 에 탭으로 연다 */
  const openByName = async (query: string, pane: PaneId): Promise<CommandResult> => {
    type Candidate = { readonly label: string; readonly hint: string; readonly run: () => void }
    const focus = (kind: 'doc' | 'note') => { setPaneRoute(kind, pane); setActivePaneId(pane) }
    const candidates: Candidate[] = [
      ...searchRecords.filter((record) => record.kind === 'pdf' || record.kind === 'markdown').map((record): Candidate => ({
        label: record.displayName || record.filename,
        hint: record.path,
        run: () => { focus('doc'); openVaultSearchResult({ record, page: null, snippet: '', query: '' }) },
      })),
      ...memoNotesRef.current.entries.map((entry): Candidate => ({
        label: entry.title,
        hint: entry.path,
        run: () => { focus('note'); openInPane(noteTabOf(entry.path), pane); memoNotesRef.current.open(entry.path) },
      })),
      ...(CANVAS_ENABLED ? shownNotebooks.flatMap((group) => group.notes).filter((note) => !/.(?:md|markdown)$/iu.test(note.path)).map((note): Candidate => ({
        label: note.title,
        hint: note.path,
        run: () => { focus('note'); openInPane({ id: note.path, title: note.title, kind: 'canvas' }, pane) },
      })) : []),
    ]
    const picked = pickByName(candidates, query) ?? pickByName(candidates.map((candidate) => ({ ...candidate, label: candidate.hint })), query)
    if (picked === null) return { ok: false, message: t('「{name}」을(를) 찾을 수 없습니다', { name: query }) }
    picked.run()
    return { ok: true, message: t('열었습니다: {name}', { name: picked.label }) }
  }
  /** 명령 실행기가 부르는 앱 쪽 손잡이. 렌더마다 새로 만들고, 실행기에는 늘 최신 것을 가리키는 commandHost 를 건넨다 */
  const commandHostRef = useRef<CommandHost>(null as unknown as CommandHost)
  commandHostRef.current = {
    getModel: () => commandModelRef.current,
    setModel: (model) => {
      const previous = commandModelRef.current
      commandModelRef.current = model
      if (model.screens.activeScreen !== previous.screens.activeScreen) setLibraryExpanded(false)
      screenOps.replace(model.screens)
      setActivePaneId(model.activePane)
      // 만진 칸이 비어 있으면 다음에 여는 문서·노트가 그 칸으로 온다(칸을 눌렀을 때와 같다)
      const tab = activeTab(tabsOf(workspaceOf(activeScreenOf(model.screens)).panes, model.activePane))
      if (tab === null) { setPaneRoute('doc', model.activePane); setPaneRoute('note', model.activePane) }
      else setPaneRoute(paneRouteOf(tab.kind), model.activePane)
    },
    sizeOf: paneSizeOf,
    paneRects: () => {
      const rects = new Map<string, PaneRect>()
      for (const pane of leaves(activeScreenOf(commandModelRef.current.screens).layout)) {
        const cell = document.querySelector(`.pane-focus-scope[data-pane-id="${pane}"]`)?.closest<HTMLElement>('.pane-grid-cell')
        const box = cell?.getBoundingClientRect()
        if (box === undefined || box.width === 0) return null
        rects.set(pane, { left: box.left, top: box.top, right: box.right, bottom: box.bottom })
      }
      return rects
    },
    blankScreenName: (count) => t('화면 {n}', { n: count }),
    templates: () => availableScreenTemplates(CANVAS_ENABLED).map((template) => ({ id: template.id, label: template.label })),
    settle: () => new Promise((resolve) => { window.setTimeout(resolve, 40) }),
    newWindowFromTemplate: async (id, name) => { await newScreenFromTemplate(id, name) },
    applyTemplate: async (id) => { await applyPreset(id) },
    open: openByName,
    noteBeside: async (pane) => {
      const path = await openNoteBeside(pane)
      if (path === null) announceAction(t('열 수 있는 노트가 없습니다'))
    },
    displayPanes: () => setPaneNumbersOpen(true),
    listKeys: () => setKeysHelpOpen(true),
    // `:` 명령줄은 명령 팔레트가 `:` 와 미리 채울 글로 열린 것이다(아래 상태 줄은 없앴다)
    promptCommand: (prefill) => { setPaletteInitial(`:${prefill}`); setPaletteOpen(true) },
    openTranslator: () => updateTranslatorWindow({ open: true }),
    confirmKillWindow: () => { confirmKindRef.current = 'kill-window'; prefixApiRef.current.startConfirm() },
    newClient: (wanted) => openNewClient(wanted),
    detach: () => detachThisClient(),
    showSessionMenu: () => window.dispatchEvent(new CustomEvent('iwae:open-session-menu')),
    sessionNames: () => sessionNames,
    newSession: (name) => sessionOps.create(name),
    switchSession: (name) => sessionOps.switchTo(name),
    renameSession: (name) => sessionOps.rename(sessionName, name),
    saveSession: (name) => (name === undefined ? sessionOps.saveNow() : sessionOps.fork(name)),
    killSession: async (name) => {
      const target = findSessionName(sessionNames, name ?? sessionName)
      if (target === null) return { ok: false, message: t('세션을 찾을 수 없습니다: {name}', { name: name ?? sessionName }) }
      if (sessionNames.length <= 1) return { ok: false, message: t('마지막 세션은 지울 수 없습니다') }
      // 지우기는 사람이 확인 창에서 정한다(바깥 AI 가 보낸 명령도 같다)
      setSessionToKill(target)
      return { ok: true, message: t('확인 창에서 세션 「{name}」 을(를) 지울지 정하세요', { name: target }) }
    },
    reloadKeys: loadKeysConf,
  }
  const commandHost = useMemo<CommandHost>(() => new Proxy({} as CommandHost, { get: (_target, key) => (commandHostRef.current as unknown as Record<PropertyKey, unknown>)[key] }), [])
  // ───────── 떠 있는 칸 조작(칸 머리 단추 · 번역기 단추 · 끌기). 명령(float-pane …)과 같은 순수 동작을 쓴다 ─────────
  const applyFloatOutcome = (outcome: FloatOutcome) => {
    if ('error' in outcome) { announceAction(outcome.error); return }
    commandHost.setModel(outcome.model)
    if (outcome.message !== undefined) announceAction(outcome.message)
  }
  const closeFloatPane = (pane: PaneId) => applyFloatOutcome(closeFloat(commandModelRef.current, pane))
  const embedFloatPane = (pane: PaneId) => applyFloatOutcome(embedPane(commandModelRef.current, paneSizeOf, pane))
  const floatPaneFromHead = (pane: PaneId) => applyFloatOutcome(floatPane(commandModelRef.current, pane))
  const collapseFloatPane = (pane: PaneId) => {
    const float = floatOf(activeScreenOf(commandModelRef.current.screens), pane)
    if (float !== undefined) screenOps.replace(patchFloat(commandModelRef.current.screens, pane, { collapsed: !float.collapsed }))
  }
  // 떠 있는 칸의 탭을 모두 옮기거나 닫으면(다른 칸으로 끌기 · 탭 닫기) 그 칸도 닫는다. 막 만든 빈 칸은 탭이 처음 들어올 때까지 둔다
  const floatSeenWithTabs = useRef(new Set<string>())
  useEffect(() => {
    const seen = floatSeenWithTabs.current
    for (const float of activeScreenNow.floats) {
      if (tabsOf(activeScreenNow.panes, float.paneId).tabs.length > 0) seen.add(float.paneId)
      else if (seen.has(float.paneId)) {
        seen.delete(float.paneId)
        applyFloatOutcome(closeFloat(commandModelRef.current, float.paneId))
        break
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- applyFloatOutcome 는 렌더마다 새로 만들어지지만 늘 최신 모델을 읽는다
  }, [activeScreenNow])
  // 문서 칸과 겹치는 떠 있는 칸은 연결선을 잇지 않는다(카드 강조만): 연결선 층에 떠 있는 칸을 알린다
  useEffect(() => { setFloatingLinkPanes(floatIds) }, [floatIds])
  // 문서 종류별로 저장하던 예전 번역기 값(iwae:translator-panel:v1)을 한 번 창 하나의 열림 · 크기로 옮긴다(떠 있는 칸 탭이던 세션 값은 세션을 읽을 때 옮긴다)
  const legacyTranslatorChecked = useRef(false)
  useEffect(() => {
    if (initializing || legacyTranslatorChecked.current) return
    legacyTranslatorChecked.current = true
    const legacy = readLegacyTranslatorPanels()
    if (legacy === null) return
    const moved = translatorWindowFromLegacy(legacy)
    if (moved !== null) updateTranslatorWindow(moved)
    finishLegacyTranslatorMigration()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 시작할 때 한 번
  }, [initializing])
  /** 접두키 · 명령줄 · 명령 팔레트(:) · MCP 가 같이 쓰는 실행기. 실패·알릴 말은 상태 줄(꺼져 있으면 알림)에 보인다 */
  const runWorkspaceLine = useCallback(async (line: string): Promise<CommandResult> => {
    const result = await runCommandLine(line, commandHost)
    if (result.message !== '') announceAction(result.message)
    return result
  }, [commandHost])
  const prefix = usePrefixMode({
    run: (line) => { void runWorkspaceLine(line) },
    announce: announceAction,
    onConfirm: () => { if (confirmKindRef.current === 'quit') quitApp(); else void runWorkspaceLine('kill-window') },
    numbersOpen: paneNumbersOpen,
    onNumber: (index) => { setPaneNumbersOpen(false); void runWorkspaceLine(`select-pane -t ${index}`) },
    onCloseNumbers: () => setPaneNumbersOpen(false),
    bindings: keyBindings,
  })
  prefixApiRef.current = prefix
  // 다른 앱 창이 시킨 명령(MCP 의 client 지정)과 앱 끝내기를 동기화 엔진에 잇는다
  clientHooksRef.current = {
    runCommand: async (line) => {
      const result = await runWorkspaceLine(line)
      await commandHost.settle?.()
      return { ok: result.ok, message: result.message, state: summarizeWorkspace(commandModelRef.current) }
    },
    quit: () => quitApp(),
  }
  // 숨겨 둔 메인 창이 다시 앞으로 나왔다(두 번째 실행 · 작업 표시줄)
  useEffect(() => {
    if (!isMainWindow) return undefined
    const shown = () => setWindowHidden(false)
    window.addEventListener('focus', shown)
    return () => window.removeEventListener('focus', shown)
  }, [isMainWindow, setWindowHidden])
  /** 문서 창에서 누른 형광펜을 보여 줄 노트가 같은 색 창에 안 보일 때: 그 메모의 노트를 옆에 열고(미리보기 설정이면 미리보기 탭) 그 카드를 보인다 */
  const revealMemoBeside = (pane: PaneId | null, memoId: string) => {
    const anchor = pane ?? anchorDocPane()
    if (anchor === null) return
    const owner = memoNotesRef.current.notesOf(memoId)[0]
    void openNoteBeside(anchor, owner, workspaceLatest.current.previewTabsEnabled).then((path) => {
      if (path === null) return
      emitPointSignal({ from: anchor, channel: channelOf(workspaceLatest.current.channels, anchor), target: { kind: 'memo', memoId, notePath: path }, reason: 'click', origin: 'document' })
    })
  }
  // 마지막으로 만진 노트: 노트 탭이 보이는 창에 포커스가 가면 그 노트가 「마지막으로 만진 노트」(openPath)다. 편집·열기는 useMemoNotes 가 같은 값을 바꾼다
  const focusedMemoNotePath = (() => { const tab = activeTab(tabsOf(panes, activePaneId)); return tab?.kind === 'memoNote' ? tab.id : null })()
  const touchMemoNote = memoNotes.open
  const memoNotesLoaded = memoNotes.loaded
  useEffect(() => {
    if (memoNotesLoaded && focusedMemoNotePath !== null) touchMemoNote(focusedMemoNotePath)
  }, [focusedMemoNotePath, memoNotesLoaded, touchMemoNote])
  // 예전 오른쪽 노트 바를 쓰던 Vault 는 처음 한 번 「읽기」 배치(문서 | 노트)로 옮긴다. 바를 닫아 두었으면 노트 창 없이 그대로 연다
  useEffect(() => {
    if (vault === null || !isMainWindow || initializing || !memoNotesLoaded) return
    const key = barMigrationKey(vault.root)
    try {
      if (window.localStorage.getItem(key) === '1') return
      window.localStorage.setItem(key, '1')
    } catch { /* 저장 못 하면 이번 실행에서만 한 번 */ }
    const now = workspaceLatest.current
    const anchor = anchorDocPane()
    const docTab = anchor === null ? null : activeTab(tabsOf(now.panes, anchor))
    const docId = docTab !== null && isDocumentKind(docTab.kind) ? tabDocId(docTab) : null
    const { openPath, entries } = memoNotesRef.current
    // 예전 바가 보이던 노트: 기억해 둔 열린 노트 → 이 문서의 노트 → 첫 노트
    const notePath = pickNotePath({ lastTouched: openPath, docId, entries, docOwner: noteDocOwner }) ?? entries[0]?.path ?? null
    const outcome = migrateNoteBar({ barOpen: legacyBarWasOpen(window.localStorage), panes: now.panes, channels: now.channels, layout: now.layout, anchor, notePath })
    if (outcome === null) return
    applyWorkspace({ panes: outcome.panes, channels: outcome.channels, layout: outcome.layout }, outcome.kind === 'beside' ? outcome.pane : undefined)
    // 같은 색 노트 창이 문서 창 옆에 붙었다. 보던 문서 창이 계속 만진 창이다
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 실행 한 번(Vault 를 연 직후)만
  }, [vault, isMainWindow, initializing, memoNotesLoaded])
  const memoNoteApi: MemoNoteApi = { ...memoNotes, openInTab: (path) => { openMemoNoteTab(path) }, docOwner: noteDocOwner, docLabel: noteDocLabel, createForDoc: createNoteForDoc, trashNote: async (path, source) => { await memoNotes.trash(path, source); forgetMemoPaths([path]) } }
  // 위 함수들은 렌더마다 새로 만들어지므로 ref 로 건넨다(workspaceLink 가 렌더마다 바뀌지 않게)
  const openNoteBesideRef = useRef(openNoteBeside)
  openNoteBesideRef.current = openNoteBeside
  const revealMemoBesideRef = useRef(revealMemoBeside)
  revealMemoBesideRef.current = revealMemoBeside
  // 마우스를 올린 메모 · 형광펜이 가리킬 창들(paneReaction.reactingPanes). 최신 상태를 ref 로 읽어 문맥 값(workspaceLink)이 형광펜 수정마다 바뀌지 않게 한다
  const reactionRef = useRef<(pane: PaneId, target: PointTarget) => ReadonlyMap<PaneId, Channel>>(() => new Map())
  reactionRef.current = (pane, target) => {
    const now = workspaceLatest.current
    const channel = channelOf(now.channels, pane)
    const found = new Map<PaneId, Channel>()
    if (channel === null) return found
    const memo = target.kind === 'memo' ? pdfHighlights.highlights.find((highlight) => highlight.id === target.memoId) : undefined
    const panesNow = reactingPanes({
      from: pane,
      target,
      visible: paneOrder,
      panes: now.panes,
      channels: now.channels,
      notesOf: memoNotes.notesOf,
      docIdOfMemo: () => memo?.anchor.docId ?? null,
      canvasShowsMemo: CANVAS_ENABLED ? (candidate, memoId) => {
        const noteId = activeTab(tabsOf(now.panes, candidate))?.id
        const document = noteId === undefined ? undefined : liveCanvas(noteId)?.get()
        return document !== undefined && blocksForTarget(document.nodes, { kind: 'memo', memoId }, canvasHighlights).length > 0
      } : undefined,
    })
    for (const candidate of panesNow) found.set(candidate, channel)
    return found
  }
  const workspaceLink = useMemo<WorkspaceLink>(() => {
    const visible = paneOrder
    return {
      channels,
      reactionPanesFor: (pane, target) => reactionRef.current(pane, target),
      memoNoteTargetFor: (pane) => (pane === null ? null : memoNoteTargetFor(panes, channels, visible, pane)),
      visibleNotePathsFor: (pane) => (pane === null ? [] : visibleNotePathsIn(panes, channels, visible, channelOf(channels, pane))),
      pinTab: pinPaneTab,
      openNoteBeside: (pane, notePath) => openNoteBesideRef.current(pane, notePath),
      revealMemo: (pane, memoId) => revealMemoBesideRef.current(pane, memoId),
      canvasShowsMemo: (pane, memoId) => pane !== null && canvasShowsMemoRef.current(channelOf(channels, pane), memoId, pane),
    }
  }, [channels, paneOrder, panes, pinPaneTab])
  /** 신호가 보여 줄 문서 탭: 이미 어느 창에 열린 문서·열린 PDF·라이브러리 PDF·Markdown. 알 수 없으면 null */
  const signalDocTab = (docId: string): Tab | null => {
    const existing = allPaneTabs(workspaceLatest.current.panes).find((tab) => isDocumentKind(tab.kind) && tabDocId(tab) === docId)
    if (existing !== undefined) return { id: existing.id, title: existing.title, kind: existing.kind }
    const opened = openedDocs.find((doc) => doc.docId === docId)
    if (opened !== undefined) return { id: opened.docId, title: docTitles[opened.docId] ?? opened.title, kind: 'pdf' }
    const entry = shownLibrary.find((doc) => doc.docId === docId)
    if (entry !== undefined) return { id: entry.docId, title: docTitles[entry.docId] ?? entry.title, kind: 'pdf' }
    if (markdownSources[docId] !== undefined) return { id: docId, title: docId.split(/[\\/]/u).at(-1)?.replace(/\.(?:md|markdown)$/iu, '') ?? docId, kind: 'markdown' }
    return null
  }
  /** channel 의 보이는 캔버스(except 창 제외) 중에 그 메모에 이어진 블록이 있는 것이 있는가 */
  const canvasShowsMemoRef = useRef<(channel: PaneChannel, memoId: string, except: PaneId | null) => boolean>(() => false)
  canvasShowsMemoRef.current = (channel, memoId, except) => {
    if (!CANVAS_ENABLED || channel === null) return false
    const now = workspaceLatest.current
    return visibleCanvasPanes(now.panes, leaves(now.layout)).some((pane) => {
      if (pane === except || channelOf(now.channels, pane) !== channel) return false
      const noteId = activeTab(tabsOf(now.panes, pane))?.id
      const document = noteId === undefined ? undefined : liveCanvas(noteId)?.get()
      return document !== undefined && blocksForTarget(document.nodes, { kind: 'memo', memoId }, canvasHighlights).length > 0
    })
  }
  const routePointSignalRef = useRef<(signal: DeliveredSignal) => Promise<void>>(async () => undefined)
  routePointSignalRef.current = async (signal) => {
    // 다른 앱 창에서 온 신호는 이미 보이는 칸이 스스로 반응한다. 문서 · 노트를 새로 여는 결정은 보낸 창만 한다
    if (signal.channel === null || isDetachedWindow || signal.remote === true) return
    const { target } = signal
    const senderKind = signal.origin === 'note' ? 'memoNote' : signal.origin === 'document' ? 'pdf' : activeKindOf(workspaceLatest.current.panes, signal.from)
    const fromNote = isNoteSurface(senderKind)
    const memo = target.kind === 'memo' ? pdfHighlights.highlights.find((highlight) => highlight.id === target.memoId) : undefined
    // 문서의 형광펜을 눌렀는데 같은 색 창에 보이는 캔버스가 그 메모의 블록을 갖고 있고 보이는 노트는 없다: 노트를 새로 열지 않는다(캔버스가 그 블록을 보인다)
    if (target.kind === 'memo' && !fromNote && target.notePath === undefined
      && visibleNotePathsIn(workspaceLatest.current.panes, workspaceLatest.current.channels, leaves(workspaceLatest.current.layout), signal.channel).length === 0
      && canvasShowsMemoRef.current(signal.channel, target.memoId, signal.from)) return
    const need = target.kind === 'memo'
      ? needForMemo({
        memoId: target.memoId,
        notePath: target.notePath,
        fromNote,
        notesOf: memoNotes.notesOf,
        visibleNotes: visibleNotePathsIn(workspaceLatest.current.panes, workspaceLatest.current.channels, leaves(workspaceLatest.current.layout), signal.channel),
        docIdOf: () => memo?.anchor.docId ?? null,
        docTab: signalDocTab,
        noteTab: (path) => ({ id: path, title: memoNoteTitleOf(path), kind: 'memoNote' }),
      })
      : needForPlace(target.docId, signalDocTab)
    // 노트 화면에서 누른 메모의 문서를 못 찾으면 예전처럼 문서를 연다
    const fallback = () => { if (memo !== undefined && fromNote) jumpToAnnotation(memo) }
    if (need === null) { fallback(); return }
    // 위치 신호(AI·검색)로 아직 열지 않은 문서를 여는 일은 예전 길(navigation.jump)이 한다. 눌러서 보낸 신호(캔버스 블록)는 아래에서 연다
    if (target.kind === 'place' && signal.reason !== 'click' && need.kind === 'doc' && need.tab.kind === 'pdf' && !openedDocs.some((doc) => doc.docId === need.tab.id)) return
    // 아직 열지 않은 라이브러리 PDF 는 탭 없이 먼저 연다(탭은 아래에서 정한 창에 연다)
    if (need.kind === 'doc' && need.tab.kind === 'pdf' && !openedDocs.some((doc) => doc.docId === need.tab.id)) {
      const entry = shownLibrary.find((doc) => doc.docId === need.tab.id)
      if (entry !== undefined && allPaneTabs(workspaceLatest.current.panes).every((tab) => tabDocId(tab) !== entry.docId)) await openDocument(entry, false)
    }
    const now = workspaceLatest.current
    const outcome = resolvePointSignal({
      panes: now.panes,
      channels: now.channels,
      layout: now.layout,
      sizeOf: paneSizeOf,
      from: signal.from,
      channel: signal.channel,
      need,
      preview: now.previewTabsEnabled,
      allowNewPane: SPLIT_PANES_ENABLED && focusedPane === 'split',
    })
    if (outcome.kind === 'none') { fallback(); return }
    // 칸이 가득이면 가장 오른쪽 창에 탭으로 들어가고(rightmost) 색이 바뀔 수 있다. 새 창은 자라듯 나타난다
    applyWorkspace({ panes: outcome.panes, channels: outcome.channels, layout: outcome.layout }, outcome.kind === 'beside' && outcome.pane !== null ? outcome.pane : undefined)
    // 위치 신호: 그 문서의 그 쪽으로 간다(이미 보이면 바로, 아니면 문서가 열리면 그 창이 꺼내 쓴다)
    if (target.kind === 'place' && outcome.pane !== null && need.tab.kind === 'markdown') {
      // Markdown 은 쪽이 없다: 글자 범위가 있으면 그 자리로 간다
      if (target.range !== undefined) setMarkdownJumpRequest({ kind: 'markdown', path: target.docId, startOffset: target.range[0], endOffset: target.range[1], quote: '' })
    } else if (target.kind === 'place' && outcome.pane !== null) {
      const controller = docControllersRef.current[outcome.pane]
      if (controller?.docId === target.docId) controller.requestPage(target.page)
      else pendingDocPageRef.current = { docId: target.docId, page: target.page }
    }
  }
  useEffect(() => subscribePointSignal((signal) => { void routePointSignalRef.current(signal) }), [])
  /** 노트 화면(메모 노트 탭의 카드·출처)에서 메모의 원문으로: 색 채널이 있으면 신호로(같은 색 창에 문서를 보인다), 없으면 예전처럼 */
  const jumpFromNotePane = (highlight: PersistentPdfHighlight, pane: PaneId) => {
    const channel = channelOf(channels, pane)
    if (isDetachedWindow || channel === null) {
      jumpToAnnotation(highlight)
      return
    }
    emitPointSignal({ from: pane, channel, target: { kind: 'memo', memoId: highlight.id }, reason: 'click', origin: 'note' })
  }
  // 들여오기·내보내기: PDF 안의 기존 표시, Zotero, Markdown
  const interop = useInteropActions({
    vault,
    highlights: pdfHighlights.highlights,
    addManyHighlights: pdfHighlights.addMany,
    memoNotes,
    docOwner: noteDocOwner,
    docLabel: noteDocLabel,
    bibliography,
    activePdfDocId: activePdfDoc?.docId ?? null,
    activePdfPages: activePdfDoc?.pageCount ?? 0,
    showNote: (path) => { openMemoNoteTab(path) },
  })
  /** 노트·폴더 경로가 바뀌면(이름 바꾸기·옮기기) 이모지·색·차례도 새 경로로 옮긴다 */
  const remapMemoPaths = (moved: ReadonlyMap<string, string>, order = true) => {
    for (const [from, to] of moved) {
      if (from === to) continue
      for (const keyOf of [memoNoteIconKey, memoFolderIconKey]) {
        const emoji = itemIcons[keyOf(from)]
        if (emoji !== undefined) {
          setItemIcon(keyOf(to), emoji)
          setItemIcon(keyOf(from), null)
        }
        const color = itemColors[keyOf(from)]
        if (color !== undefined) {
          setItemColor(keyOf(to), color)
          setItemColor(keyOf(from), null)
        }
      }
    }
    if (order && noteOrder.some((path) => moved.has(path))) setNoteOrder(noteOrder.map((path) => moved.get(path) ?? path))
  }
  /** 지운 노트·폴더의 이모지·색을 지운다 */
  const forgetMemoPaths = (paths: readonly string[]) => {
    for (const path of paths) {
      for (const keyOf of [memoNoteIconKey, memoFolderIconKey]) {
        if (itemIcons[keyOf(path)] !== undefined) setItemIcon(keyOf(path), null)
        if (itemColors[keyOf(path)] !== undefined) setItemColor(keyOf(path), null)
      }
    }
  }
  // MCP(바깥 AI) 연결: 형광펜·노트·화면·서재·번역·PDF 도구를 mcp/ 의 op 표에 이어 준다
  const mcpMemoNotesRef = useRef(memoNotes)
  mcpMemoNotesRef.current = memoNotes
  useMcpMemoBridge({
    highlights: pdfHighlights.highlights,
    add: pdfHighlights.add,
    update: pdfHighlights.update,
    remove: (id) => {
      pdfHighlights.remove(id)
      memoNotes.forgetHighlight(id)
    },
    loadPdfById,
    noteOwner: noteDocOwner,
    docSources: vault === null ? undefined : { all: () => docSourcesRef.current.sources, add: (docId, input) => docSourcesRef.current.add(docId, input), update: (docId, id, patch) => docSourcesRef.current.update(docId, id, patch), remove: (docId, id) => docSourcesRef.current.remove(docId, id) },
    notes: vault === null ? undefined : {
      list: memoNotes.listNotes,
      find: memoNotes.findNoteTitled,
      edit: memoNotes.editNoteTitled,
      trash: memoNotes.trash,
      createIn: memoNotes.createIn,
      rename: memoNotes.rename,
      conflict: () => mcpMemoNotesRef.current.conflict,
      folder: memoNotesFolder,
    },
    app: buildMcpAppDeps({
      vaultRoot: vault?.root ?? null,
      paneCount,
      layout: layoutRoot,
      channels,
      growPanes,
      activePaneId,
      panes,
      screens,
      activeScreenId,
      docViews,
      shownLibrary,
      openedDocs,
      searchRecords,
      docTitles,
      highlights: pdfHighlights.highlights,
      bookmarks: {
        list: pdfBookmarks.bookmarks,
        toggle: pdfBookmarks.toggle,
        isBookmarked: pdfBookmarks.isBookmarked,
        addPin: pdfBookmarks.addPin,
        updatePin: pdfBookmarks.updatePin,
        movePin: pdfBookmarks.movePin,
        remove: pdfBookmarks.remove,
      },
      translation: { settings: translation.settings, selectedModel: translation.selectedModel, translate: translation.translate },
      themePreference: theme.preference,
      language: getLocale(),
      openAnyDocument,
      markdownDocById,
      openInPane,
      moveTab,
      setPaneCount,
      setActivePane: setActivePaneId,
      setPaneRoute,
      workspaceCommand: async (command, client) => {
        if (client !== undefined) {
          // 다른 앱 창에서 돌린다(없는 창이면 AI 가 고치도록 오류)
          const target = findClient(clients.registry, client)
          if (target === null) throw new Error(`unknown client '${client}' (app_state.clients 의 label 이나 id 를 쓰세요: ${clients.registry.map((candidate) => candidate.letter).join(', ')})`)
          if (target.id !== clients.selfId) {
            const remote = await clients.engine.runOn(target.id, command)
            return { ok: remote.ok, message: remote.message, state: remote.state as McpWorkspaceState }
          }
        }
        const result = await runWorkspaceLine(command)
        await commandHost.settle?.()
        return { ok: result.ok, message: result.message, state: summarizeWorkspace(commandModelRef.current) }
      },
      clients: () => clients.registry.map((client) => ({ id: client.id, label: client.letter, session: client.session, screen: client.screen })),
      session: async () => {
        const rows = await sessionOps.list()
        return { name: sessionName, sessions: rows.map((row) => ({ name: row.name, active: row.name === sessionName, screens: row.screenCount, last_used_at: row.lastUsedAt })) }
      },
      activateTabIn: (pane, tabId) => setPanes((current) => ({ ...current, [pane]: activateTab(tabsOf(current, pane), tabId) })),
      closeTab: (tab) => {
        if (tab.kind === 'canvas') closeNoteTabSafely(tab.id)
        else setPanes((current) => closeTabEverywhere(current, tab.id))
      },
      requestPage: (pane, docId, page) => {
        const controller = docControllersRef.current[pane]
        if (controller?.docId !== docId) return false
        controller.requestPage(page)
        return true
      },
      pendingPage: (docId, page) => { pendingDocPageRef.current = { docId, page } },
      jump: (docId, page) => navigation.jump({ docId, page }),
      pointAt,
      draftAnchor: setDraftPdfHighlight,
      openMemoNote: (path, pane) => {
        // 창을 정했으면 그 창의 탭으로, 아니면 문서 창 옆(이미 노트를 보이는 창이 있으면 그 창의 탭)으로 연다
        if (pane !== undefined) {
          openInPane(noteTabOf(path), pane)
          memoNotes.open(path)
          setActivePaneId(pane)
          setPaneRoute('note', pane)
          return pane
        }
        return openMemoNoteTab(path)
      },
      liveSelection: () => {
        const draft = draftPdfHighlightRef.current
        if (draft !== null && draft.quote.trim() !== '') return { docId: draft.docId, page: draft.page + 1, text: draft.quote }
        const picked = (window.getSelection()?.toString() ?? '').trim()
        return picked !== '' && activePdfDoc !== null ? { docId: activePdfDoc.docId, page: currentPdfPage, text: picked } : null
      },
      setFileFavorite,
      toolCopy: (docId, op, suffix) => writeDocumentToolCopy(docId, op, suffix),
      exportNote: async (path) => {
        if (vault === null) throw new Error(t('Vault가 열려 있지 않습니다.'))
        const { join } = await import('@tauri-apps/api/path')
        const { exists } = await import('@tauri-apps/plugin-fs')
        // 내보내기마다 새 폴더: 있던 파일을 덮어쓰지 않는다
        const base = await join(vault.root, t('Markdown 내보내기'))
        const now = new Date()
        const stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}-${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}${String(now.getSeconds()).padStart(2, '0')}`
        let folder = await join(base, `${memoNoteTitleOf(path)} ${stamp}`)
        for (let n = 2; await exists(folder); n += 1) folder = await join(base, `${memoNoteTitleOf(path)} ${stamp} (${n})`)
        const result = await exportNotesAsMarkdown(vault, { kind: 'note', path }, { folder })
        if (result === null || result.files[0] === undefined) throw new Error(t('내보낼 노트가 없습니다.'))
        return join(result.folder, result.files[0])
      },
      pdfToolBusy: (docId) => getPdfToolJob(docId) !== undefined,
    }),
  })
  const jumpToAnnotation = useCallback((highlight: PersistentPdfHighlight) => {
    setFlashHighlightId(highlight.id)
    if (flashTimerRef.current !== null) clearTimeout(flashTimerRef.current)
    flashTimerRef.current = setTimeout(() => setFlashHighlightId(null), 1400)
    navigation.jump({ docId: highlight.anchor.docId, page: highlight.anchor.page + 1 })
  }, [navigation])
  // 문서를 처음 열 때 서지 정보를 자동으로 채운다(사람이 고친 값은 건드리지 않는다).
  const autoExtractBibliography = bibliography.autoExtract
  useEffect(() => {
    if (!bibliography.ready || activePdfDoc === null) return
    void autoExtractBibliography(activePdfDoc.docId, activePdfDoc.pageCount)
  }, [activePdfDoc, autoExtractBibliography, bibliography.ready])
  /** 라이브러리 표에서 고친 저자·연도. 사람이 고친 값이라 자동 추출이 덮어쓰지 않는다 */
  const saveBibliographyEntry = bibliography.saveEntry
  const bibliographyEntries = bibliography.entries
  const updateBibliography = useCallback((docId: string, patch: { authors?: readonly string[]; year?: number | null }) => {
    const current = bibliographyEntries[docId] ?? { authors: [], source: 'manual' as const, updatedAt: '' }
    const { year: _previousYear, ...rest } = current
    const year = patch.year === undefined ? current.year : patch.year ?? undefined
    saveBibliographyEntry(docId, {
      ...rest,
      ...(year === undefined ? {} : { year }),
      authors: patch.authors ?? current.authors,
      source: 'manual',
      updatedAt: new Date().toISOString(),
    })
  }, [bibliographyEntries, saveBibliographyEntry])
  const copyBibtex = useCallback((docId: string) => {
    const entry = bibliography.entries[docId] ?? { title: docTitles[docId], authors: [], source: 'manual' as const, updatedAt: '' }
    void navigator.clipboard.writeText(toBibtex({ ...entry, title: entry.title ?? docTitles[docId] }))
      .then(() => announceAction(t('BibTeX을 복사했습니다')))
      .catch((cause: unknown) => announceAction(t('복사하지 못했습니다: {error}', { error: errorText(cause) })))
  }, [bibliography.entries, docTitles])
  /** 노트와 인용한 원본 쪽을 HTML 한 파일로 묶어 저장한다 */
  const exportWithEvidence = useCallback((title: string, document: CanvasDocumentV2) => {
    const docs = Object.fromEntries(Object.entries(docTitles).map(([docId, docTitle]) => {
      const entry = bibliography.entries[docId]
      return [docId, { title: entry?.title ?? docTitle, authors: entry?.authors ?? [], year: entry?.year, doi: entry?.doi }]
    }))
    announceAction(t('근거 묶음을 만드는 중…'))
    void buildEvidenceHtml({ title, document, docs, rasterizer: createCanvasRasterizer() })
      .then((html) => saveHtmlFile(t('{title} 근거.html', { title: title.replace(/[\\/:*?"<>|]/g, '_') }), html))
      .then((path) => { if (path !== null) announceAction(t('근거와 함께 내보냈습니다: {path}', { path })) })
      .catch((cause: unknown) => announceAction(t('내보내지 못했습니다: {error}', { error: errorText(cause) })))
  }, [bibliography.entries, docTitles])
  /**
   * AI 가 보낸 자리로 간다. 글자 범위가 있으면 그 범위를, 없고 인용문만 있으면 쪽 본문에서
   * 인용문을 찾아 그 범위를 표시한다. Markdown 문서는 문서를 연다.
   */
  const openAiLocation = useCallback((location: AiLocation) => {
    setAiLocations((current) => current.filter((item) => item.id !== location.id))
    const record = searchRecords.find((candidate) => candidate.id === location.docId)
    if (record?.kind === 'markdown') {
      void openMarkdown({
        id: `markdown:${record.id}`,
        kind: 'markdown',
        name: record.displayName,
        path: record.path,
        storage: record.storage,
        indexId: record.id,
      })
      return
    }
    if (docTitles[location.docId] === undefined) {
      announceAction(t('AI가 보낸 문서를 이 Vault에서 찾을 수 없습니다'))
      return
    }
    // 같은 색 창에 그 문서가 보이게 한다(탭 활성화 → 미리보기 탭 → 옆에 새 창). 색 채널이 없는 창이면 예전처럼 쪽으로만 간다
    const senderChannel = channelOf(workspaceLatest.current.channels, activePaneId)
    if (senderChannel !== null) emitPointSignal({ from: activePaneId, channel: senderChannel, target: { kind: 'place', docId: location.docId, page: location.page }, reason: 'ai' })
    navigation.jump({ docId: location.docId, page: location.page })
    const pageIndex = location.page - 1
    void pageTextIndex(location.docId, pageIndex).then((index) => {
      let range: [number, number] | null = null
      if (typeof location.charStart === 'number' && typeof location.charEnd === 'number' && location.charEnd > location.charStart) {
        range = [location.charStart, location.charEnd]
      } else if (location.quote) {
        const at = index.text.indexOf(location.quote)
        if (at >= 0) range = [at, at + location.quote.length]
      }
      if (range !== null) pointAt(buildAnchor(location.docId, pageIndex, index, range[0], range[1]), location.message ?? location.quote)
    }).catch(() => undefined)
  }, [activePaneId, pointAt, docTitles, navigation, openMarkdown, searchRecords])
  /** PDF 도구 화면(대상 문서·펼친 도구). 있으면 그 문서를 보이던 PDF 창 자리를 도구 화면이 대신한다. 쪽 편집도 도구 하나다 */
  const [pdfToolsTarget, setPdfToolsTarget] = useState<{ docId: string; tool?: PdfToolViewId } | null>(null)
  /** 왼쪽 바 「PDF 도구」 탭을 열고 그 도구를 펼친다(명령 팔레트·탭 메뉴·문서 우클릭 메뉴가 부른다). 쪽 편집만 PDF 창 자리를 쓴다 */
  function openPdfToolsView(docId: string, tool?: PdfToolViewId) {
    setPdfToolsTarget({ docId, ...(tool === undefined ? {} : { tool }) })
    setLibraryExpanded(false)
    setSidebarCollapsed(false)
    setSidebarMode('tools')
  }
  /** 암호 PDF 를 열 때 묻는 창 */
  const [passwordRequest, setPasswordRequest] = useState<{ path: string; wrong: boolean; nonce: number; resolve: (password: string | null) => void } | null>(null)
  const passwordNonce = useRef(0)
  useEffect(() => {
    setPdfPasswordPrompt((request) => new Promise((resolve) => setPasswordRequest({ ...request, nonce: (passwordNonce.current += 1), resolve })))
    return () => setPdfPasswordPrompt(null)
  }, [])
  /** 도구를 돌릴 문서의 메타(열려 있지 않으면 연다) */
  const toolDocumentMeta = useCallback(async (docId: string) => {
    const opened = openedDocs.find((doc) => doc.docId === docId)
    if (opened !== undefined) return opened
    const libraryDoc = shownLibrary.find((doc) => doc.docId === docId)
    return libraryDoc === undefined ? null : openDocument(libraryDoc, false)
  }, [openDocument, openedDocs, shownLibrary])
  /**
   * 글자 층이 없는 쪽만 OCR 해서 원본에 보이지 않는 글자를 입힌다(덮기 전 원본은 .iwae/history/pdf-edits).
   * 이미 글자가 있는 쪽은 건드리지 않는다 — 원래 글자 위에 OCR 글자를 겹치면 검색 결과가 두 번씩 나온다.
   * 진행은 pdfToolJobs 로 알린다(스캔 표시 단추·도구 창이 같이 본다).
   */
  const ocrDocument = useCallback(async (docId: string): Promise<string> => {
    if (getPdfToolJob(docId) !== undefined) return t('이미 OCR 하는 중입니다')
    const meta = await toolDocumentMeta(docId)
    if (meta === null) throw new Error(t('PDF를 열 수 없습니다'))
    setPdfToolJob({ docId, label: 'OCR 준비 중', done: 0, total: meta.pageCount })
    try {
      const pages: SearchablePdfPage[] = []
      for (let page = 0; page < meta.pageCount; page += 1) {
        const native = await pageTextIndex(docId, page).catch(() => null)
        setPdfToolJob({ docId, label: 'OCR 중', done: page + 1, total: meta.pageCount })
        if (native !== null && native.chars.some((char) => char.c.trim() !== '' && char.w > 0)) continue
        const lines = await recognizePdfPageLines(docId, page, meta.pageSizes[page]?.[0] ?? 612).catch(() => [])
        if (lines.length > 0) pages.push({ page, lines: lines.map((line) => ({ ...line })) })
      }
      if (pages.length === 0) {
        const message = t('이 PDF는 이미 모든 쪽에 글자가 있습니다')
        announceAction(message)
        return message
      }
      setPdfToolJob({ docId, label: '글자 입히는 중', done: meta.pageCount, total: meta.pageCount })
      const result = await applyDocumentTool(docId, { kind: 'searchable', pages })
      const message = result.report.skipped > 0
        ? t('OCR 글자 {count}줄을 입혔습니다(한글 글꼴이 없어 {skipped}줄 제외). 원본은 .iwae/history/pdf-edits 에 남겨 두었습니다', { count: result.report.written, skipped: result.report.skipped })
        : t('OCR 글자 {count}줄을 입혔습니다. 원본은 .iwae/history/pdf-edits 에 남겨 두었습니다', { count: result.report.written })
      announceAction(message)
      return message
    } finally {
      setPdfToolJob({ docId, clear: true })
    }
  }, [applyDocumentTool, toolDocumentMeta])
  const ocrDocumentRef = useRef(ocrDocument)
  ocrDocumentRef.current = ocrDocument
  const [pdfToolsOutline, setPdfToolsOutline] = useState<Record<string, readonly { title: string; page: number | null; depth: number }[]>>({})
  useEffect(() => {
    const docId = pdfToolsTarget?.docId
    if (docId === undefined) return
    let alive = true
    void toolDocumentMeta(docId).then(() => pdfOutline(docId)).then((entries) => {
      if (!alive) return
      setPdfToolsOutline((current) => ({ ...current, [docId]: entries }))
    }).catch(() => undefined)
    return () => { alive = false }
  }, [pdfToolsTarget?.docId, toolDocumentMeta])
  navigationJumpRef.current = navigation.jump
  navigationBackRef.current = navigation.back
  navigationForwardRef.current = navigation.forward
  /** 지금 문서 안의 다른 쪽으로 점프한다(기록에 남는다). 1-기반 */
  const jumpToPage = useCallback((page: number) => {
    if (activePdfDoc === null) {
      requestPdfPage(page)
      return
    }
    navigation.jump({ docId: activePdfDoc.docId, page })
  }, [activePdfDoc, navigation, requestPdfPage])

  const openPdfSource = useCallback((request: SourceJumpRequest) => {
    setDraftPdfHighlight(request.anchor)
    navigation.jump({ docId: request.docId, page: request.page + 1 })
  }, [navigation])

  const openSource = useCallback((request: SourceOpenRequest) => {
    if ('kind' in request) {
      const existing = allPaneTabs(panes).find((tab) => tab.id === request.path)
      const title = existing?.title ?? request.path.split(/[\\/]/u).at(-1) ?? request.path
      // 아직 읽지 않은 Markdown 은 목록에서 여는 것과 같은 길로 연다(본문 없이 빈 탭이 열리지 않게)
      if (markdownSources[request.path] === undefined) {
        const wanted = request.path.replaceAll('\\', '/').toLocaleLowerCase()
        const find = (nodes: readonly VaultTreeNode[]): VaultMarkdownNode | null => {
          for (const node of nodes) {
            if (node.kind === 'markdown' && node.path.replaceAll('\\', '/').toLocaleLowerCase() === wanted) return node
            if (node.kind === 'folder') {
              const found = find(node.children)
              if (found !== null) return found
            }
          }
          return null
        }
        const node = find(tree)
        if (node !== null) void openMarkdown(node).then(() => setMarkdownJumpRequest(request))
        else announceAction(t('Vault 에 없는 문서입니다: {path}', { path: request.path }))
        return
      }
      openInPane({ id: request.path, title, kind: 'markdown' })
      setMarkdownJumpRequest(request)
      return
    }
    openPdfSource(request)
  }, [markdownSources, openInPane, openMarkdown, openPdfSource, panes, tree])

  // 발췌는 어느 패널의 PDF 에서든 온다. 제목은 그 발췌의 문서에서 찾는다.
  // 받을 캔버스(targetNoteId)는 보내는 문서 창이 정한다: 같은 색 창에 보이는 캔버스 → 만진 캔버스 → 보이는 아무 캔버스
  const sendPdfSelectionToCanvas = useCallback((targetNoteId: string, selection: PdfExcerptSelection) => {
    const sourceTitle = docTitles[selection.anchor.docId] ?? activePdfDoc?.title ?? ''
    setExcerptInsertRequest((current) => ({
      id: (current?.id ?? 0) + 1,
      targetNoteId,
      payload: { selection, sourceTitle },
    }))
  }, [activePdfDoc, docTitles])

  /**
   * 고른 글에 출처를 붙여 복사한다: "인용" — [문서, §절, p.쪽].
   * 절은 목차에서 그 쪽보다 앞에 있는 가장 가까운 항목이다(목차가 없으면 뺀다).
   */
  const copyPdfSelectionWithSource = useCallback(async (selection: PdfExcerptSelection) => {
    const { docId, page, quote } = selection.anchor
    let section: string | null = null
    try {
      const outline = await pdfOutline(docId)
      const before = outline.filter((entry) => entry.page !== null && entry.page <= page)
      section = before.at(-1)?.title.trim() ?? null
    } catch {
      section = null
    }
    const doc = docTitles[docId] ?? docId
    const where = [doc, section === null || section === '' ? null : `§${section}`, `p.${page + 1}`].filter(Boolean).join(', ')
    const text = `"${quote.replace(/\s+/gu, ' ').trim()}" — [${where}]`
    try {
      await navigator.clipboard.writeText(text)
      announceAction(t('출처와 함께 복사했습니다'))
    } catch (cause) {
      announceAction(t('복사하지 못했습니다: {error}', { error: errorText(cause) }))
    }
  }, [docTitles])
  /** 고른 글자로 문서 검색 화면을 열어 바로 찾는다 */
  const searchDocumentsFromText = useCallback((text: string) => {
    const query = text.replace(/\s+/gu, ' ').trim().slice(0, 200)
    if (query === '') return
    documentSearch.setQuery(query)
    setLibraryExpanded(false)
    setFocusedPane('split')
    setSidebarCollapsed(false)
    setSidebarMode('search')
    setSearchScope('vault')
    documentSearch.run(query)
  }, [documentSearch])
  const searchDocumentsFromSelection = useCallback((selection: PdfExcerptSelection) => {
    const query = selection.anchor.quote.replace(/\s+/gu, ' ').trim().slice(0, 200)
    if (query === '') return
    documentSearch.setQuery(query)
    setLibraryExpanded(false)
    setFocusedPane('split')
    setSidebarCollapsed(false)
    setSidebarMode('search')
    setSearchScope('vault')
    documentSearch.run(query)
  }, [documentSearch])
  const translatePdfSelection = useCallback(async (selection: PdfExcerptSelection, options?: { readonly force?: boolean; readonly targetLanguage?: string; readonly sourceLanguage?: string }) => {
    const source = normalizeSelectionText(selection.anchor.quote)
    if (source === '') return null
    const text = await translateWithCacheUsing(translateForCache, source, { docId: selection.anchor.docId, page: selection.anchor.page }, options?.force === true, options?.targetLanguage, options?.sourceLanguage)
    if (text === null) return null
    return { text, targetLanguage: options?.targetLanguage ?? translation.settings.targetLanguage, model: translation.selectedModel ?? translation.settings.externalProvider }
  }, [translation, translateForCache])

  const sendTranslatedPdfSelectionToCanvas = useCallback((
    targetNoteId: string,
    selection: PdfExcerptSelection,
    translated: PdfSelectionTranslation,
  ) => {
    const sourceTitle = docTitles[selection.anchor.docId] ?? activePdfDoc?.title ?? ''
    setExcerptInsertRequest((current) => ({
      id: (current?.id ?? 0) + 1,
      targetNoteId,
      payload: { selection, sourceTitle },
      translation: translated,
    }))
  }, [activePdfDoc, docTitles])

  const translateMarkdownSelection = useCallback(async (text: string, options?: { readonly force?: boolean; readonly targetLanguage?: string; readonly sourceLanguage?: string }) => {
    const source = normalizeSelectionText(text)
    if (source === '') return null
    const translated = await translateWithCacheUsing(translateForCache, source, { docId: activeMarkdownPath ?? undefined }, options?.force === true, options?.targetLanguage, options?.sourceLanguage)
    if (translated === null) return null
    return { text: translated, targetLanguage: options?.targetLanguage ?? translation.settings.targetLanguage, model: translation.selectedModel ?? translation.settings.externalProvider }
  }, [translation, translateForCache, activeMarkdownPath])

  const sendTranslatedMarkdownSelectionToCanvas = useCallback((
    targetNoteId: string,
    payload: MarkdownExcerptDragPayload,
    translated: MarkdownSelectionTranslation,
  ) => {
    setExcerptInsertRequest((current) => ({
      id: (current?.id ?? 0) + 1,
      targetNoteId,
      payload,
      translation: translated,
    }))
  }, [])
  /** 문서 창 pane 에서 보낸 발췌를 받을 캔버스 탭(없으면 null: 보내기 단추를 감춘다) */
  const canvasTargetFor = (pane: PaneId): string | null => {
    if (!CANVAS_ENABLED) return null
    const target = pickCanvasPane({ panes, channels, visible: paneOrder, active: activePaneId, from: pane })
    return target === null ? null : activeTab(tabsOf(panes, target))?.id ?? null
  }

  // 번역 카드의 언어·번역기 칩
  const { targetLanguage: cardTargetLanguage, executionMode: cardExecutionMode, externalProvider: cardExternalProvider } = translation.settings
  const cardSelectedModel = translation.selectedModel
  const updateTranslationSettings = translation.updateSettings
  const translationCardSettings = useMemo<TranslationCardSettings>(() => ({
    targetLanguage: cardTargetLanguage,
    providerLabel: cardExecutionMode === 'external-api'
      ? t(externalProviderInfo(cardExternalProvider).label).replace(/\s*\(.*\)\s*$/u, '')
      : cardSelectedModel ?? '',
    onChangeTargetLanguage: (code) => updateTranslationSettings({ targetLanguage: code }),
  }), [cardTargetLanguage, cardExecutionMode, cardExternalProvider, cardSelectedModel, updateTranslationSettings])

  // 번역기 창(앱 창 전체에 떠 있다): 열림은 도구줄 단추 · 접두키 w · display-popup 이 바꾼다
  const translatorWindow = useTranslatorWindow()
  // 상단바 도구줄의 주인 칩(색 점 · 칸 번호 · 문서 종류): 도구줄이 있는 종류(PDF · MD · 메모 노트)를 보는 칸이 만지는 칸일 때만
  const ownerTab = activeTab(tabsOf(panes, activePaneId))
  const toolbarOwner = ownerTab !== null && (ownerTab.kind === 'pdf' || ownerTab.kind === 'markdown' || ownerTab.kind === 'memoNote')
    ? { channel: channelOf(channels, activePaneId), number: paneOrder.indexOf(activePaneId) < 0 || floatIds.includes(activePaneId) ? null : leaves(layoutRoot).indexOf(activePaneId), kind: ownerTab.kind }
    : null
  const toolbarSlotValue = useMemo(() => ({ element: toolbarSlot, activePane: activePaneId }), [toolbarSlot, activePaneId])
  // 도구줄의 번역기 단추: 번역을 켜 둘 때만 있다
  const translatorService = useMemo<TranslatorService | null>(() => (translation.settings.enabled
    ? {
        providerLabel: translationCardSettings.providerLabel,
        translate: async (text, sourceLanguage, targetLanguage) => {
          const result = await translateText(text, sourceLanguage, targetLanguage)
          return result === null ? null : { text: result.translatedText, model: result.model }
        },
      }
    : null), [translation.settings.enabled, translationCardSettings.providerLabel, translateText])

  const translateCanvasText = useCallback(async (text: string) => {
    const result = await translation.translate(text)
    if (result === null) return null
    return {
      text: result.translatedText,
      targetLanguage: translation.settings.targetLanguage,
      model: result.model,
    }
  }, [translation])

  const openTabIds = allPaneTabs(panes)
  // 닫은 탭(마우스 제스처 ㄱ 으로 다시 연다). 옮기기는 닫기가 아니다: 어느 패널에도 없어진 탭만
  const closedTabsRef = useRef<Tab[]>([])
  const previousTabsRef = useRef<readonly Tab[]>(openTabIds)
  useEffect(() => {
    const now = new Set(openTabIds.map((tab) => tab.id))
    const closed = previousTabsRef.current.filter((tab) => !now.has(tab.id))
    if (closed.length > 0) closedTabsRef.current = [...closedTabsRef.current, ...closed].slice(-20)
    previousTabsRef.current = openTabIds
  })
  const reopenClosedTab = () => {
    const tab = closedTabsRef.current.pop()
    if (tab === undefined) {
      announceAction(t('다시 열 탭이 없습니다'))
      return
    }
    if (tab.kind === 'pdf') {
      const docId = tabDocId(tab)
      if (openedDocs.some((doc) => doc.docId === docId)) {
        openInPane(tab)
        return
      }
      const libraryDoc = shownLibrary.find((doc) => doc.docId === docId)
      if (libraryDoc !== undefined) void openDocument(libraryDoc)
      return
    }
    openInPane(tab)
  }
  // 마우스 휠을 브라우저처럼 부드럽게
  useSmoothWheel()
  // 오른쪽 단추로 그리는 마우스 제스처
  useMouseGestures({
    // 맨 위·아래로도 점프 기록에 남긴다(← 로 돌아온다)
    bottom: () => {
      if (activeDocumentTab?.kind === 'markdown') {
        window.dispatchEvent(new CustomEvent('iwae:md-edge', { detail: { path: activeDocumentTab.id, edge: 'bottom' } }))
        return
      }
      const meta = activePdfDoc === null ? undefined : openedDocs.find((doc) => doc.docId === activePdfDoc.docId)
      if (meta !== undefined) jumpToPage(meta.pageCount)
    },
    top: () => {
      if (activeDocumentTab?.kind === 'markdown') {
        window.dispatchEvent(new CustomEvent('iwae:md-edge', { detail: { path: activeDocumentTab.id, edge: 'top' } }))
        return
      }
      jumpToPage(1)
    },
    closeTab: () => paneShortcutsRef.current.closeActiveTab(),
    reopenTab: reopenClosedTab,
    back: () => navigationBackRef.current(),
    forward: () => navigationForwardRef.current(),
  })
  /**
   * 쪽 편집 저장: 노트를 먼저 저장해 두고, PDF 를 덮어쓴 뒤 형광펜·책갈피·노트 출처를 새 쪽으로
   * 옮긴다. 문서 id 는 그대로라 탭·목록은 그대로 두고 그림·글자만 새로 읽는다.
   */
  const savePageEdit = async (docId: string, sizes: readonly (readonly [number, number])[], items: readonly PageEditItem[]) => {
    await flushCanvasSaves()
    forgetPageEditDraft(docId)
    const moves = pageMoves(items)
    await editDocumentPages(
      docId,
      items.map((item) => ({ ...(item.source === undefined ? {} : { source: item.source }), page: item.page, rotate: item.rotate })),
      (document) => remapDocumentReferences(document, docId, moves, sizes),
    )
    pdfHighlights.mapAll((highlight) => {
      if (highlight.anchor.docId !== docId) return highlight
      const anchor = remapAnchor(highlight.anchor, moves, sizes)
      return anchor === null ? null : { ...highlight, anchor }
    })
    // 쪽이 옮겨지면 그 쪽 위의 글 상자·선도 같이 옮긴다(없어진 쪽의 것은 뺀다)
    pdfOverlays.remapPages(docId, new Map([...moves].map(([from, move]) => [from, move.to] as const)))
    pdfBookmarks.mapAll((bookmark) => {
      if (bookmark.docId !== docId) return bookmark
      const move = moves.get(bookmark.page)
      return move === undefined ? null : { ...bookmark, id: pdfBookmarkId(docId, move.to, bookmark.y), page: move.to }
    })
    setDraftPdfHighlight(null)
    setCanvasEpoch((epoch) => epoch + 1)
    // 쪽 편집 화면에서 저장했을 때만 닫는다(빈 쪽 삭제·방향 바로잡기는 왼쪽 바에서 펼친 채 결과를 보인다)
    setPdfToolsTarget((current) => (current?.tool === 'pageEdit' ? null : current))
    announceAction(t('쪽 편집을 저장했습니다. 원본은 .iwae/history/pdf-edits 에 남겨 두었습니다'))
  }
  /** 쪽 편집 화면: 큰 편집기라 PDF 창 자리를 대신한다 */
  const renderPageEdit = (target: { docId: string; tool?: PdfToolViewId }) => {
    const docId = target.docId
    const meta = openedDocs.find((doc) => doc.docId === docId)
    const title = docTitles[docId] ?? meta?.title ?? 'PDF'
    if (meta === undefined) return null
    return (
      <PageEditDialog
        key={docId}
        docId={docId}
        title={title}
        pageCount={meta.pageCount}
        sourcePath={vaultPdfs.find((pdf) => pdf.docId === docId)?.path}
        onCancel={() => setPdfToolsTarget(null)}
        onSave={(items) => savePageEdit(meta.docId, meta.pageSizes, items)}
      />
    )
  }
  /** 왼쪽 바 「PDF 도구」 목록에서 펼친 도구의 옵션(쪽 편집 말고). 문서의 표시 수·목차·다른 PDF 를 모아 넘기고, 도구가 부탁하는 일을 해 준다 */
  const renderPdfToolForm = (docId: string, tool: PdfToolId) => {
    const meta = openedDocs.find((doc) => doc.docId === docId)
    const title = docTitles[docId] ?? meta?.title ?? 'PDF'
    const docOverlays = pdfOverlays.overlays[docId] ?? []
    const group = groupOfDoc(versionGroups.groups, docId)
    const siblings = new Set(group?.versions.map((version) => version.docId) ?? [])
    const others = vaultPdfs
      .filter((pdf) => pdf.docId !== docId)
      .map((pdf) => ({ ...pdf, title: docTitles[pdf.docId] ?? pdf.title, sibling: siblings.has(pdf.docId) }))
      .sort((a, b) => Number(b.sibling) - Number(a.sibling) || a.title.localeCompare(b.title))
    const fileName = (path: string) => path.split(/[\\/]/u).at(-1) ?? path
    return (
      <PdfToolForm
        key={docId}
        tool={tool}
        docId={docId}
        title={title}
        pageCount={meta?.pageCount ?? 0}
        hasText={meta?.hasText ?? true}
        passwordProtected={isPasswordProtectedDoc(docId)}
        outline={pdfToolsOutline[docId] ?? []}
        otherPdfs={others}
        marks={countMarks(docId, pdfHighlights.highlights, docOverlays)}
        buildFlatten={(choice) => buildFlattenOp(docId, pdfHighlights.highlights, docOverlays, choice, getHighlightColors())}
        onToolChange={(next) => setPdfToolsTarget({ docId, tool: next })}
        actions={{
          ocr: () => ocrDocument(docId),
          applyInPlace: async (op) => {
            await applyDocumentTool(docId, op)
            const message = t('원본에 적용했습니다. 덮기 전 원본은 .iwae/history/pdf-edits 에 남겨 두었습니다')
            announceAction(message)
            return message
          },
          saveCopy: (op, suffix, folder) => writeDocumentToolCopy(docId, op, suffix, folder),
          compress: async (maxDpi, quality) => {
            let report: { sizeBefore: number; sizeAfter: number } = { sizeBefore: 0, sizeAfter: 0 }
            const path = await writeDocumentToolCopy(docId, { kind: 'compress', maxDpi, quality }, t('(압축)'), undefined, (next) => { report = next })
            return { path, sizeBefore: report.sizeBefore, sizeAfter: report.sizeAfter }
          },
          removePages: async (pages) => {
            if (meta === undefined) throw new Error(t('PDF를 열 수 없습니다'))
            const drop = new Set(pages)
            const items = Array.from({ length: meta.pageCount }, (_, page) => page)
              .filter((page) => !drop.has(page))
              .map((page) => ({ key: `p${page}`, page, rotate: 0 as const }))
            await savePageEdit(docId, meta.pageSizes, items)
            return t('{count}쪽을 뺐습니다', { count: pages.length })
          },
          findBlankPages: () => pdfBlankPages(docId),
          fixOrientation: async () => {
            if (meta === undefined) throw new Error(t('PDF를 열 수 없습니다'))
            if (getPdfToolJob(docId) !== undefined) return t('이미 작업하는 중입니다')
            setPdfToolJob({ docId, label: '방향 살피는 중', done: 0, total: meta.pageCount })
            const rotations = new Map<number, PageRotation>()
            let scanned = 0
            try {
              for (let page = 0; page < meta.pageCount; page += 1) {
                setPdfToolJob({ docId, label: '방향 살피는 중', done: page + 1, total: meta.pageCount })
                const native = await pageTextIndex(docId, page).catch(() => null)
                if (native !== null && native.chars.some((char) => char.c.trim() !== '' && char.w > 0)) continue
                scanned += 1
                const rotation = await detectPageRotation(docId, page).catch(() => null)
                if (rotation === null) throw new Error(t('PDF OCR 엔진을 사용할 수 없습니다.'))
                if (rotation !== 0) rotations.set(page, rotation)
              }
              if (scanned === 0) return t('글자 없는 스캔 쪽이 없습니다')
              if (rotations.size === 0) return t('{count}쪽을 살폈지만 돌릴 쪽이 없습니다', { count: scanned })
              setPdfToolJob({ docId, label: '쪽 돌리는 중', done: meta.pageCount, total: meta.pageCount })
              const items = Array.from({ length: meta.pageCount }, (_, page) => ({ key: `p${page}`, page, rotate: rotations.get(page) ?? (0 as PageRotation) }))
              await savePageEdit(docId, meta.pageSizes, items)
              return t('{count}쪽을 돌렸습니다', { count: rotations.size })
            } finally {
              setPdfToolJob({ docId, clear: true })
            }
          },
          exportImages: async (dpi) => {
            const result = await exportPdfImages(docId, title, dpi)
            return result === null ? t('취소했습니다') : t('그림 {count}장을 저장했습니다: {folder}', { count: result.count, folder: result.folder })
          },
          importMarks: async () => interop.importMarksMessage(await interop.importPdfMarks(docId)),
          exportNotesMarkdown: async (scope) => {
            if (vault === null) throw new Error(t('먼저 Vault 를 열어 주세요'))
            const result = await exportNotesAsMarkdown(vault, scope === 'doc' ? { kind: 'doc', docId } : { kind: 'vault' })
            return result === null ? t('취소했습니다') : t('Markdown {count}개를 내보냈습니다: {folder}', { count: result.files.length, folder: result.folder })
          },
          exportMarkdown: async () => {
            const pageCount = meta?.pageCount ?? 0
            const parts: string[] = [`# ${title}`, '']
            for (let page = 0; page < pageCount; page += 1) {
              const index = await pageTextIndex(docId, page).catch(() => null)
              const text = (index?.text ?? '').replace(/[ \t]+\n/gu, '\n').trim()
              parts.push(`## p.${page + 1}`, '', text === '' ? t('(글자 없음)') : text, '')
            }
            const path = await writeDocumentMarkdown(docId, parts.join('\n'))
            return t('Markdown 을 저장했습니다: {name}', { name: fileName(path) })
          },
          compare: async (otherDocId) => {
            const other = await toolDocumentMeta(otherDocId)
            if (meta === undefined || other === null) throw new Error(t('PDF를 열 수 없습니다'))
            const read = async (id: string, count: number) => {
              const texts: string[] = []
              for (let page = 0; page < count; page += 1) texts.push((await pageTextIndex(id, page).catch(() => null))?.text ?? '')
              return texts
            }
            const [mine, theirs] = await Promise.all([read(docId, meta.pageCount), read(otherDocId, other.pageCount)])
            return diffLines(pageLines(mine), pageLines(theirs))
          },
          openPath: (path) => { void openPdfAtPath(path) },
          jump: (id, page) => {
            const libraryDoc = shownLibrary.find((doc) => doc.docId === id)
            if (!openedDocs.some((doc) => doc.docId === id) && libraryDoc !== undefined) void openDocument(libraryDoc).then(() => navigation.jump({ docId: id, page: page + 1 }))
            else navigation.jump({ docId: id, page: page + 1 })
          },
          startRedactTool: () => {
            setPdfToolsTarget(null)
            setOverlayTool('redact')
            window.dispatchEvent(new CustomEvent('iwae:start-overlay-edit', { detail: { docId } }))
          },
        }}
      />
    )
  }
  /**
   * 목차·축소판·주석 패널 위에 "지금 어느 패널의 어느 문서를 따르는가"를 보인다.
   * 양쪽에 문서가 있으면 눌러서 대상을 바꾼다(그 패널을 만진 것과 같다).
   * 문서가 한 패널에만 있으면 고를 것이 없으니 보이지 않는다(문서 이름은 탭에 이미 있다).
   */
  const renderDocTargetSwitch = () => {
    const docPanes = paneOrder.filter((pane) => isDocTab(activeTab(tabsOf(panes, pane))))
    if (docPanes.length < 2) return null
    return (
      <div className="side-doc-target" role="radiogroup" aria-label={t('목차를 볼 문서')}>
        {docPanes.map((pane) => {
          const tab = activeTab(tabsOf(panes, pane))
          const selected = pane === docPaneId
          return (
            <button
              key={pane}
              type="button"
              role="radio"
              aria-checked={selected}
              className={`side-doc-target-btn${selected ? ' side-doc-target-btn-active' : ''}`}
              title={tab === null ? undefined : docTitles[tabDocId(tab)] ?? tab.title}
              onClick={() => setActivePaneId(pane)}
            >
              <span className="side-doc-target-side">{paneLabel(paneOrder.indexOf(pane))}</span>
              <span className="side-doc-target-name">{tab === null ? '' : docTitles[tabDocId(tab)] ?? tab.title}</span>
            </button>
          )
        })}
      </div>
    )
  }
  const closePaneTab = (id: string) => {
    const tab = openTabIds.find((candidate) => candidate.id === id)
    if (tab?.kind === 'canvas') closeNoteTabSafely(id)
    else setPanes((current) => closeTabEverywhere(current, id))
  }
  /** 이 창이 지금 보는 쪽(1부터)과 배율. 활성 탭이 아니면 마지막으로 읽던 쪽 */
  const viewOfDoc = (docId: string, tabId: string): { page: number; zoom: DocZoom | null } => {
    const pane = paneOfTab(panes, tabId) ?? undefined
    const controller = pane === undefined ? undefined : docControllersRef.current[pane]
    const view = pane === undefined ? undefined : docViews[pane]
    return {
      page: view?.docId === docId ? view.page : readingPositions[docId] ?? 1,
      zoom: controller?.docId === docId ? controller.getZoom?.() ?? null : null,
    }
  }
  /** PDF 탭을 새 창으로 떼어 낸다. 같은 문서의 창이 이미 있으면 그 창을 앞으로 가져온다 */
  const detachPaneTab = async (id: string) => {
    const tab = openTabIds.find((candidate) => candidate.id === id)
    if (tab === undefined || tab.kind !== 'pdf' || vault === null) return
    const docId = tabDocId(tab)
    const { page, zoom } = viewOfDoc(docId, id)
    try {
      const opened = await openAppWindow('detached', windowQuery({ role: 'detached', docId, page, zoom, vaultRoot: vault.root }), docId)
      if (opened === null) return
      if (opened.existing) {
        announceAction(t('이미 떼어 낸 창이 있어 그 창을 앞으로 가져왔습니다'))
        return
      }
      closePaneTab(id)
    } catch (cause) {
      announceAction(t('창을 열지 못했습니다: {error}', { error: errorText(cause) }))
    }
  }
  /** 세션에 붙는 새 앱 창(new-client). 같은 세션이면 다음 화면(없으면 같은 화면)을, 다른 세션이면 그 세션이 보던 화면을 보인다 */
  const openNewClient = async (wanted?: string): Promise<CommandResult> => {
    if (vault === null) return { ok: false, message: t('Vault 를 연 뒤에 쓸 수 있습니다') }
    const plan = newClientPlan({
      wanted,
      current: sessionName,
      resolve: (name) => findSessionName(sessionNames, name),
      screenCount: screens.length,
      activeIndex: screens.findIndex((screen) => screen.id === activeScreenId),
      registry: clients.registry,
    })
    if (plan === null) return { ok: false, message: t('세션을 찾을 수 없습니다: {name}', { name: wanted ?? '' }) }
    try {
      const opened = await openClientWindow({ ...plan, vaultRoot: vault.root })
      if (opened === null) return { ok: false, message: t('창을 열 수 없는 환경입니다') }
      return { ok: true, message: t('앱 창을 열었습니다: {name}', { name: plan.session }) }
    } catch (cause) {
      return { ok: false, message: t('창을 열지 못했습니다: {error}', { error: errorText(cause) }) }
    }
  }
  /** 이 앱 창을 뗀다(detach). 세션은 남는다. 마지막 앱 창이면 앱을 닫을지 상태 줄에서 묻는다 */
  const detachThisClient = async (): Promise<CommandResult> => {
    if (isDetachedWindow) return { ok: false, message: t('떼어 낸 PDF 창은 「다시 붙이기」로 닫습니다') }
    if (detachPlan(clients.registry, clients.selfId) === 'confirm-quit') {
      confirmKindRef.current = 'quit'
      prefixApiRef.current.startConfirm()
      return { ok: true, message: '' }
    }
    closeWindowSafely()
    return { ok: true, message: '' }
  }
  /** 앱 전체를 끝낸다. 메인 창이 모든 창을 정리하고 닫는다(숨겨 둔 메인 창이면 먼저 보인다) */
  const quitApp = () => {
    quittingRef.current = true
    if (!isMainWindow) { clientsNowRef.current.engine.requestQuit(); return }
    setWindowHidden(false)
    void showAppWindow(currentWindowLabel()).catch(() => undefined).then(() => closeWindowSafely())
  }
  windowActionsRef.current = {
    newWindow: () => { void openNewClient().then((result) => { if (!result.ok) announceAction(result.message) }) },
    detachActive: () => { if (activeDocumentTab?.kind === 'pdf') void detachPaneTab(activeDocumentTab.id) },
    // 닫는 길(onCloseRequested)이 탭을 메인으로 돌려보낸다
    reattach: () => closeWindowSafely(),
  }
  // 탭을 다른 창에 붙이고 이 창을 닫는 중이면 닫히면서 메인으로 또 돌려보내지 않는다
  const skipSendBackRef = useRef(false)
  sendTabsBackRef.current = async () => {
    if (skipSendBackRef.current) return
    for (const tab of openTabIds.filter((candidate) => candidate.kind === 'pdf')) {
      const docId = tabDocId(tab)
      const { page, zoom } = viewOfDoc(docId, tab.id)
      await sendReattach({ docId, page, zoom })
    }
  }
  // 떼어 낸 창이 아닌 창(메인·새 창): 돌려받은(또는 끌어서 붙인) 탭을 같은 쪽·배율로 연다.
  // 끌어서 붙였으면 놓은 자리(패널·x)에 들어가고, 탭 줄이 그 자리를 벌려 둔 채 기다린다
  const pendingPlacementRef = useRef<{ docId: string; pane: PaneId; index: number } | null>(null)
  const acceptTabDropRef = useRef<(request: ReattachRequest) => void>(() => undefined)
  acceptTabDropRef.current = (request) => {
    if (request.zoom !== null) queueInitialZoom(request.docId, request.zoom)
    const pane = paneOrder.find((candidate) => candidate === request.pane)
    if (pane !== undefined && request.x !== undefined) {
      pendingPlacementRef.current = { docId: request.docId, pane, index: insertionIndexInPane(pane, request.x) }
      setPaneRoute('doc', pane)
      // 탭이 끝내 안 열리면(문서를 못 찾음 등) 벌려 둔 자리를 닫는다
      window.setTimeout(() => {
        if (pendingPlacementRef.current?.docId !== request.docId) return
        pendingPlacementRef.current = null
        clearExternalTabHover()
      }, 6000)
    } else {
      clearExternalTabHover()
    }
    navigationJumpRef.current({ docId: request.docId, page: request.page })
    void focusThisWindow()
  }
  useEffect(() => {
    if (isDetachedWindow) return undefined
    let disposed = false
    let stop: (() => void) | undefined
    void onReattach((request) => acceptTabDropRef.current(request)).then((unlisten) => {
      if (disposed) unlisten()
      else stop = unlisten
    })
    return () => { disposed = true; stop?.() }
  }, [])
  // 붙인 탭이 열리면 놓은 자리로 옮긴다(벌려 둔 자리가 닫히는 것과 같은 그리기 안에서, 탭이 미끄러져 날아가 보이지 않게)
  useLayoutEffect(() => {
    const pending = pendingPlacementRef.current
    if (pending === null || paneOfTab(panes, pending.docId) === null) return
    pendingPlacementRef.current = null
    holdTabFlip()
    clearExternalTabHover(true)
    setPanes((current) => moveTabToPaneAt(current, pending.docId, pending.pane, pending.index))
    setActivePaneId(pending.pane)
  }, [panes, setPanes])
  // 다른 창에서 탭을 끌어 이 창 탭 줄 위로 왔을 때: 자리를 벌려 보이고, 탭 줄 자리를 알려 준다
  useEffect(() => {
    if (isDetachedWindow) return undefined
    let disposed = false
    const stops: (() => void)[] = []
    const keep = (unlisten: () => void) => { if (disposed) unlisten(); else stops.push(unlisten) }
    void onTabZonesRequest(() => { void reportTabZones(tabZoneRects()) }).then(keep)
    void onTabHover((hover) => showExternalTabHover(hover.pane, hover.x), () => clearExternalTabHover()).then(keep)
    return () => { disposed = true; stops.forEach((stop) => stop()) }
  }, [])
  /**
   * 탭을 창 밖으로 끌어냈다. 떼어 낸 창이 아니면 새 창을 만들어 마우스를 따라가게 하고(탭은 이 창에서 닫힌다),
   * 떼어 낸 창에서 탭이 하나뿐이면 창 자신이 따라간다. 놓은 자리가 다른 창의 탭 줄이면 그 창에 붙는다(아래 onTabDragReleased)
   */
  const tearRef = useRef<{ label: string; mode: 'new' | 'self'; docId: string; page: number; zoom: DocZoom | null } | null>(null)
  const tearOffTab = async (id: string, info: TearOffInfo): Promise<boolean> => {
    const tab = openTabIds.find((candidate) => candidate.id === id)
    if (tab === undefined || tab.kind !== 'pdf' || vault === null) return false
    const docId = tabDocId(tab)
    const { page, zoom } = viewOfDoc(docId, id)
    const ratio = window.devicePixelRatio || 1
    try {
      if (isDetachedWindow) {
        if (allPaneTabs(panes).length !== 1) return false
        const began = await beginTabDrag({ mode: 'self' })
        if (began === null) return false
        tearRef.current = { label: began.label, mode: 'self', docId, page, zoom }
        return true
      }
      const began = await beginTabDrag({
        mode: 'new',
        docId,
        query: windowQuery({ role: 'detached', docId, page, zoom, vaultRoot: vault.root }),
        // 새 창의 첫 탭이 놓이는 자리(왼쪽 위에서)에 마우스가 오게 한다
        grabX: Math.round((info.grabX + DETACHED_TAB_LEFT) * ratio),
        grabY: Math.round((info.grabY + DETACHED_TAB_TOP) * ratio),
      })
      if (began === null) return false
      if (began.existing) {
        announceAction(t('이미 떼어 낸 창이 있어 그 창을 앞으로 가져왔습니다'))
        return true
      }
      tearRef.current = { label: began.label, mode: 'new', docId, page, zoom }
      closePaneTab(id)
      return true
    } catch (cause) {
      announceAction(t('창을 열지 못했습니다: {error}', { error: errorText(cause) }))
      return false
    }
  }
  useEffect(() => {
    let disposed = false
    let stop: (() => void) | undefined
    void onTabDragReleased((event) => {
      const drag = tearRef.current
      if (drag === null || drag.label !== event.dragged) return
      tearRef.current = null
      // 빈 곳에 놓았다: 창은 놓인 자리에 그대로 둔다
      if (event.target === null) return
      const request = { docId: drag.docId, page: drag.page, zoom: drag.zoom, pane: event.pane ?? undefined, x: event.x }
      void (async () => {
        try {
          if (drag.mode === 'new') {
            if (event.target === currentWindowLabel()) acceptTabDropRef.current({ ...request, source: drag.label })
            else await sendTabDrop(event.target!, request)
            await destroyAppWindow(drag.label)
          } else {
            // 떼어 낸 창을 통째로 끌어 다른 창의 탭 줄에 놓았다: 저장하고 탭을 보낸 뒤 이 창을 닫는다
            await flushCanvasSaves()
            skipSendBackRef.current = true
            await sendTabDrop(event.target!, request)
            await destroyAppWindow(currentWindowLabel())
          }
        } catch (cause) {
          skipSendBackRef.current = false
          announceAction(t('창을 열지 못했습니다: {error}', { error: errorText(cause) }))
        }
      })()
    }).then((unlisten) => {
      if (disposed) unlisten()
      else stop = unlisten
    })
    return () => { disposed = true; stop?.() }
  }, [])
  /** 탭을 다른 패널의 탭 줄 index 자리(또는 본문)로 끌어 놓았다 */
  const movePaneTabAt = (id: string, target: PaneId, index: number) => {
    const tab = openTabIds.find((candidate) => candidate.id === id)
    const source = paneOfTab(panes, id)
    const moved = moveTabToPaneAt(panes, id, target, index)
    // 탭을 다 끌어낸 패널은 닫힌다(크롬에서 창의 탭을 다 끌어내면 그 창이 닫히듯). 남은 패널이 그 자리를 채운다
    const collapsed = SPLIT_PANES_ENABLED && !isDetachedWindow && source !== null && source !== target ? collapseEmptyPane({ panes: moved, channels, layout: layoutRoot }, source) : null
    const landed = target
    if (collapsed === null) setPanes(moved)
    else applyWorkspace(collapsed)
    setActivePaneId(landed)
    if (tab !== undefined) setPaneRoute(paneRouteOf(tab.kind), landed)
    if (collapsed !== null) {
      window.setTimeout(() => {
        window.dispatchEvent(new Event('resize'))
        window.dispatchEvent(new Event('iwae:pane-resize-end'))
      }, 280)
    }
  }
  /**
   * 이 패널에서 탭을 가장자리로 끌어 나눌 수 있는 쪽들(창 모드·탭 수에 따라 달라진다). 칸이 상한이거나 너무 작아 못 나누는 쪽은 빼서,
   * 미리보기가 보이는 자리는 놓으면 꼭 된다(그런 가장자리는 「이 칸으로 옮기기」 가운데로 본다)
   */
  const dockEdgesFor = (pane: PaneId, id: string): readonly DockEdge[] => {
    if (!SPLIT_PANES_ENABLED || isDetachedWindow || focusedPane !== 'split' || libraryExpanded) return []
    if (!paneOrder.includes(pane)) return []
    const source = paneOfTab(panes, id)
    if (source === pane && tabsOf(panes, pane).tabs.length <= 1) return []
    // 하나뿐인 탭을 다른 칸으로 끌면 원래 칸이 닫히므로 칸 수 상한은 닫힌 뒤로 본다
    const closing = source !== null && source !== pane && tabsOf(panes, source).tabs.length <= 1 ? source : null
    return allowedDockEdges(layoutRoot, pane, closing, paneSizeOf)
  }
  /** 왼쪽 바 줄이 열 탭의 id 후보(이미 열려 있으면 그 탭을 옮긴다). Markdown 은 PDF 화면 id 일 수도, 경로일 수도 있다 */
  const sidebarItemTabIds = (item: SidebarDropItem): readonly string[] => item.kind === 'pdf' ? [item.doc.docId] : item.kind === 'markdown' ? [item.node.indexId, item.node.path] : [item.path]
  /** 왼쪽 바에서 끌어 온 줄이 이 칸의 가장자리로 나눌 수 있는 쪽들. 빈 칸은 가운데만(나눌 것이 없다) */
  const sidebarDockEdgesFor = (pane: PaneId, item: SidebarDropItem): readonly DockEdge[] => {
    if (!SPLIT_PANES_ENABLED || isDetachedWindow || focusedPane !== 'split' || libraryExpanded) return []
    if (!paneOrder.includes(pane) || tabsOf(panes, pane).tabs.length === 0) return []
    // 이미 열려 있는 탭이면 탭 끌기와 같다: 자기 칸의 하나뿐인 탭은 나눌 수 없고, 하나뿐인 탭이 다른 칸에서 오면 그 칸이 닫힌다
    const source = sidebarItemTabIds(item).map((id) => paneOfTab(panes, id)).find((found) => found !== null) ?? null
    if (source === pane && tabsOf(panes, pane).tabs.length <= 1) return []
    const closing = source !== null && source !== pane && tabsOf(panes, source).tabs.length <= 1 ? source : null
    return allowedDockEdges(layoutRoot, pane, closing, paneSizeOf)
  }
  /** 왼쪽 바에서 끌어 온 문서·노트를 놓은 자리(칸 가운데 · 가장자리 · 탭 줄)에 보통 탭으로 연다 */
  const openSidebarItemAt = async (item: SidebarDropItem, target: TabDropTarget) => {
    let tab: Tab | null = null
    if (item.kind === 'pdf') {
      const meta = await openDocument(item.doc, false)
      // 파일이 있는 문서인데 못 열었으면(오류는 이미 알렸다) 탭을 만들지 않는다
      if (meta !== null || !shownLibrary.some((doc) => doc.docId === item.doc.docId)) tab = { id: item.doc.docId, title: item.doc.title, kind: 'pdf' }
    } else if (item.kind === 'markdown') {
      const meta = await openMarkdown(item.node, false)
      tab = meta !== null ? { id: meta.docId, title: item.node.name, kind: 'pdf' } : { id: item.node.path, title: item.node.name, kind: 'markdown' }
    } else {
      tab = noteTabOf(item.path)
      memoNotesRef.current.open(item.path)
    }
    if (tab === null) return
    const now = workspaceLatest.current
    const result = dropTabAt({ panes: now.panes, channels: now.channels, layout: now.layout }, tab, target, paneSizeOf)
    if (result === null) return
    if ('refused' in result) { announceRefusal(result.refused); return }
    applyWorkspace(result, result.created ?? undefined)
    setActivePaneId(result.landed)
    setPaneRoute(paneRouteOf(tab.kind), result.landed)
    if (leaves(result.layout).length !== leaves(now.layout).length) {
      window.setTimeout(() => {
        window.dispatchEvent(new Event('resize'))
        window.dispatchEvent(new Event('iwae:pane-resize-end'))
      }, 280)
    }
  }
  const sidebarPaneDrop: SidebarPaneDrop = { edgesFor: sidebarDockEdgesFor, open: (item, target) => { void openSidebarItemAt(item, target) } }
  /** 탭을 패널의 edge 쪽을 갈라 새 패널에 넣는다 */
  const dockPaneTab = (id: string, target: PaneId, edge: DockEdge) => {
    const result = dockTab({ panes, channels, layout: layoutRoot }, id, target, edge, paneSizeOf)
    if (result === null) return
    if ('refused' in result) {
      announceRefusal(result.refused)
      return
    }
    const tab = openTabIds.find((candidate) => candidate.id === id)
    // 하나뿐인 탭을 다른 패널의 가장자리로 끌어 나누면, 비어 버린 원래 패널은 닫힌다(dockTab 이 한다). 새 창은 탭이 떠난 창의 색 채널을 받는다
    const landed = result.newPane
    applyWorkspace(result, landed)
    setActivePaneId(landed)
    if (tab !== undefined) setPaneRoute(paneRouteOf(tab.kind), landed)
    // 새 패널은 자라듯 나타나고, 끝나면 연결선이 새 자리를 다시 잰다(applyWorkspace 가 함께 한다)
  }
  /** 탭을 다른 칸으로 옮긴다. target 이 NEW_PANE_TARGET 이면 이 탭이 있는 칸의 오른쪽에 새 칸을 만들어 옮긴다 */
  const movePaneTab = (id: string, target: PaneId) => {
    const tab = openTabIds.find((candidate) => candidate.id === id)
    let landed = target
    if (target === NEW_PANE_TARGET) {
      const source = paneOfTab(panes, id)
      if (source === null) return
      const result = moveTabToNewPane({ panes, channels, layout: layoutRoot }, id, source, 'right', paneSizeOf)
      if (result === null) return
      if ('refused' in result) { announceRefusal(result.refused); return }
      applyWorkspace(result, result.newPane)
      landed = result.newPane
    } else {
      moveTab(id, target)
    }
    setActivePaneId(landed)
    if (tab !== undefined) setPaneRoute(paneRouteOf(tab.kind), landed)
  }
  /** Markdown 안의 상대 링크: 그 경로의 문서를 왼쪽 바 목록에서 찾아 연다. 없으면 알린다 */
  const openMarkdownPath = (path: string) => {
    const wanted = path.toLocaleLowerCase()
    const find = (nodes: readonly VaultTreeNode[]): VaultMarkdownNode | null => {
      for (const node of nodes) {
        if (node.kind === 'markdown' && node.path.replaceAll('\\', '/').toLocaleLowerCase() === wanted) return node
        if (node.kind === 'folder') {
          const found = find(node.children)
          if (found !== null) return found
        }
      }
      return null
    }
    const node = find(tree)
    if (node === null) announceAction(t('Vault 에 없는 문서입니다: {path}', { path }))
    else void openMarkdown(node)
  }
  /**
   * PDF 안 링크: Vault 안 파일(Markdown 을 PDF 로 바꾼 문서의 상대 링크는 file:/// 로 남는다)은 앱 안에서 열고,
   * 바깥 주소는 확인 뒤 브라우저로
   */
  const openPdfLink = (url: string) => {
    if (vault !== null && /^file:/iu.test(url)) {
      let absolute = decodeURIComponent(url.replace(/^file:\/+/iu, '')).split('#')[0] ?? ''
      absolute = absolute.replaceAll('\\', '/')
      const root = vault.root.replaceAll('\\', '/').replace(/\/+$/u, '')
      if (absolute.toLocaleLowerCase().startsWith(`${root.toLocaleLowerCase()}/`)) {
        const relative = absolute.slice(root.length + 1)
        if (/\.(?:md|markdown)$/iu.test(relative)) {
          openMarkdownPath(relative)
          return
        }
        if (/\.pdf$/iu.test(relative)) {
          const record = searchRecords.find((item) => item.kind === 'pdf' && item.path.replaceAll('\\', '/').toLocaleLowerCase() === relative.toLocaleLowerCase())
          const doc = record === undefined ? undefined : shownLibrary.find((item) => item.docId === record.id)
          if (doc !== undefined) {
            void openDocument(doc)
            return
          }
        }
      }
    }
    setPendingExternalLink(url)
  }
  // ---------- GitHub 문서 폴더 ----------
  // 자동 백업: n 일마다 Vault 전체를 zip 으로(설정 › 데이터 및 복구)
  const autoBackup = useAutoBackup(isMainWindow ? vault?.root ?? null : null)
  const [githubSources, setGithubSources] = useState<ReadonlyMap<string, GithubSource>>(() => new Map())
  /** Vault 의 모든 폴더(Vault 기준 경로, 트리 차례) — GitHub 가져오기에서 넣을 곳을 고른다 */
  const vaultFolderPaths = useMemo(() => {
    const out: string[] = []
    const walk = (nodes: readonly VaultTreeNode[]) => {
      for (const node of nodes) {
        if (node.kind === 'folder') {
          out.push(node.path)
          walk(node.children)
        }
      }
    }
    walk(tree)
    return out
  }, [tree])
  const [githubDialog, setGithubDialog] = useState<
    | { kind: 'import'; folder?: string }
    | { kind: 'versions'; source: GithubSource }
    | { kind: 'changes'; source: GithubSource; changed: readonly string[]; applied: boolean }
    | null
  >(null)
  const reloadGithubSources = useCallback(async () => {
    if (vault === null) {
      setGithubSources(new Map())
      return
    }
    try {
      const sources = await githubList(vault.root)
      setGithubSources(new Map(sources.map((source) => [source.target, source])))
    } catch {
      setGithubSources(new Map())
    }
  }, [vault])
  useEffect(() => { void reloadGithubSources() }, [reloadGithubSources])
  // 이어진 폴더를 옮기면(useVault 가 연결을 고친 뒤 알린다) 목록을 다시 읽는다
  useEffect(() => {
    const reload = () => { void reloadGithubSources() }
    window.addEventListener('iwae:github-links-changed', reload)
    return () => window.removeEventListener('iwae:github-links-changed', reload)
  }, [reloadGithubSources])
  /** 이 파일이 GitHub 와 이어진 폴더(받아 둔 저장소) 안에 있으면 그 연결 */
  const githubSourceOf = (path: string): GithubSource | undefined => {
    const wanted = path.replaceAll('\\', '/').toLocaleLowerCase()
    for (const [target, source] of githubSources) {
      const folder = target.replaceAll('\\', '/').replace(/\/+$/u, '').toLocaleLowerCase()
      if (folder !== '' && wanted.startsWith(`${folder}/`)) return source
    }
    return undefined
  }
  const putGithubSource = (source: GithubSource) => setGithubSources((current) => new Map(current).set(source.target, source))
  const refreshAll = async () => {
    await refreshVault()
    await reloadGithubSources()
  }
  const githubPullAndShow = async (name: string) => {
    if (vault === null) return
    const result = await githubPull(vault.root, name)
    putGithubSource(result.source)
    await refreshVault()
    setGithubDialog({ kind: 'changes', source: result.source, changed: result.changed, applied: true })
  }
  const githubAction = (action: 'fetch' | 'pull' | 'versions' | 'open', name: string) => {
    if (vault === null) return
    const source = [...githubSources.values()].find((item) => item.name === name)
    if (source === undefined) return
    if (action === 'open') {
      const base = source.url.replace(/\.git$/u, '')
      setPendingExternalLink(source.path === null ? base : `${base}/tree/${source.branch ?? source.head}/${source.path}`)
      return
    }
    if (action === 'versions') {
      setGithubDialog({ kind: 'versions', source })
      return
    }
    void (async () => {
      try {
        if (action === 'fetch') {
          announceAction(t('{name}: 새 소식 확인 중…', { name }))
          const result = await githubFetch(vault.root, name)
          putGithubSource(result.source)
          setGithubDialog({ kind: 'changes', source: result.source, changed: result.changed, applied: false })
        } else {
          announceAction(t('{name}: 최신으로 받는 중…', { name }))
          await githubPullAndShow(name)
        }
      } catch (cause) {
        announceAction(`${name}: ${errorText(cause)}`)
      }
    })()
  }
  /** 칸막이 「양쪽 바꾸기」: 그 나누기의 두 쪽을 맞바꾼다. 칸의 탭·색·읽던 쪽은 칸 id 에 붙어 있어 칸과 함께 자리를 옮긴다 */
  const swapPanes = (splitId: string) => {
    const now = workspaceLatest.current
    applyWorkspace(swapSplitSides({ panes: now.panes, channels: now.channels, layout: now.layout }, splitId))
  }
  /** 이 패널의 탭을 옮길 곳: 다른 칸들 + (칸이 상한 전까지) 이 칸 오른쪽에 새로 여는 칸 */
  const paneMoveTargets = (pane: PaneId) => {
    const targets = paneOrder.filter((target) => target !== pane)
      .map((target) => ({ pane: target, label: t('{index}번 패널로 옮기기', { index: paneOrder.indexOf(target) + 1 }) }))
    if (paneCount < MAX_PANES) targets.push({ pane: NEW_PANE_TARGET, label: t('새 오른쪽 패널로 옮기기') })
    return targets
  }
  /** 판 묶음의 문서는 탭 이름을 「묶음 이름 판 이름」으로(같은 문서의 두 판이 열려도 구별된다) */
  const tabsWithVersion = (state: TabsState): TabsState => {
    if (Object.keys(versionGroups.groups).length === 0) return state
    return {
      ...state,
      tabs: state.tabs.map((tab) => {
        if (tab.kind !== 'pdf') return tab
        const group = groupOfDoc(versionGroups.groups, tabDocId(tab))
        const label = group?.versions.find((version) => version.docId === tabDocId(tab))?.label
        // 「묶음 이름 판 이름」(비활성 탭은 ' · ' 뒤를 잘라 보이므로 그 구분자를 쓰지 않는다 — 판이 늘 보이게)
        return group === null || label === undefined ? tab : { ...tab, title: `${group.title} ${label}` }
      }),
    }
  }
  // 칸 하나만 닫기: 남은 칸이 그 자리를 채우고, 닫은 칸의 탭은 다음 칸 뒤로 합친다
  const closePane = (pane: PaneId) => {
    const now = workspaceLatest.current
    const result = closePaneTree({ panes: now.panes, channels: now.channels, layout: now.layout }, pane)
    if (result === null) return
    applyWorkspace(result)
    setActivePaneId(result.landed)
    if (zoomedPane === pane) setFocusedPane('split')
  }
  // 쪽 편집 화면에서 쪽을 끌어 다른 PDF 의 탭·쪽 편집 화면에 놓는 끌기(pageDrag.ts)가 묻고 시키는 것들
  const pageDragRef = useRef({ vaultPdfs, openedDocs })
  pageDragRef.current = { vaultPdfs, openedDocs }
  useEffect(() => {
    setPageDragHost({
      docInfo: (docId) => {
        const { vaultPdfs: pdfs, openedDocs: docs } = pageDragRef.current
        const entry = pdfs.find((pdf) => pdf.docId === docId)
        if (entry === undefined && !docs.some((doc) => doc.docId === docId)) return null
        return { docId, title: entry?.title ?? docs.find((doc) => doc.docId === docId)?.title ?? 'PDF', editable: entry !== undefined, locked: isPasswordProtectedDoc(docId) }
      },
      activateTab: (pane, tabId) => {
        setPanes((current) => ({ ...current, [pane]: activateTab(tabsOf(current, pane), tabId) }))
        setActivePaneId(pane)
      },
      openEditor: (docId) => setPdfToolsTarget({ docId, tool: 'pageEdit' }),
      announce: announceAction,
    })
    return () => setPageDragHost(null)
  })
  const renderPaneTabs = (pane: PaneId, index: number | undefined) => (
    <PaneTabsMenu
      // 색 점과 칸 번호는 칸이 하나여도 보인다(모든 칸의 머리가 같다)
      channel={channelOf(channels, pane)}
      onCycleChannel={() => setChannels((current) => cyclePaneChannel(current, pane))}
      paneNumber={index}
      secondary={paneSecondary(pane)}
      // 메모 노트 탭: 제목 뒤 ⌄ 에서 노트 열기 · 제목을 두 번 눌러 이름 바꾸기(예전엔 노트 탭 안의 제목 줄이었다)
      renderTabExtra={(tab) => (tab.kind === 'memoNote' ? <NoteHeadMenu api={memoNoteApi} path={tab.id} /> : null)}
      canRenameTab={(tab) => tab.kind === 'memoNote'}
      onRenameTab={(tab, title) => {
        void memoNotes.rename(tab.id, title).catch((error: unknown) => {
          announceAction(t('노트 이름을 바꾸지 못했습니다: {reason}', { reason: errorText(error) }))
        })
      }}
      onPinTab={(id) => setPanes((current) => pinTabInPanes(current, id))}
      state={tabsWithVersion(tabsOf(panes, pane))}
      label={t('탭')}
      paneId={pane}
      focused={activePaneId === pane}
      onActivate={(id) => {
        setPanes((current) => ({ ...current, [pane]: activateTab(tabsOf(current, pane), id) }))
        setActivePaneId(pane)
      }}
      onClose={closePaneTab}
      onMoveTab={SPLIT_PANES_ENABLED ? movePaneTab : undefined}
      moveTargets={SPLIT_PANES_ENABLED ? paneMoveTargets(pane) : undefined}
      onReorderTab={(id, toIndex) => setPanes((current) => ({ ...current, [pane]: reorderTab(tabsOf(current, pane), id, toIndex) }))}
      onMoveTabAt={SPLIT_PANES_ENABLED ? movePaneTabAt : undefined}
      onDockTab={SPLIT_PANES_ENABLED && !isDetachedWindow ? dockPaneTab : undefined}
      dockEdges={dockEdgesFor}
      onTearOffTab={isDesktop() ? tearOffTab : undefined}
      dragWindow={isDetachedWindow}
      onEditPages={(id) => {
        const tab = openTabIds.find((candidate) => candidate.id === id)
        if (tab !== undefined) setPdfToolsTarget({ docId: tabDocId(tab), tool: 'pageEdit' })
      }}
      onDetachTab={isDetachedWindow ? undefined : (id) => { void detachPaneTab(id) }}
      onReattach={isDetachedWindow ? () => windowActionsRef.current.reattach() : undefined}
      onDuplicateTab={(id) => {
        const tab = openTabIds.find((candidate) => candidate.id === id)
        if (tab === undefined || tab.kind !== 'pdf') return
        const docId = tabDocId(tab)
        // 같은 PDF 를 한 군데 더: 한 칸이면 같은 패널, 여럿이면 다음 패널에 연다
        const target = otherPane(paneOrder, pane)
        openInPane({ id: nextViewTabId(panes, docId), title: docTitles[docId] ?? tab.title, kind: 'pdf' }, target)
        setActivePaneId(target)
      }}
    />
  )
  /** 보는 탭의 제목 뒤에 흐리게 붙는 보조 글(탭이 여럿이어도 보는 탭에만): PDF 는 쪽, 노트는 폴더, Markdown 은 경로 */
  const paneSecondary = (pane: PaneId): string | null => {
    const state = tabsOf(panes, pane)
    const tab = activeTab(state)
    if (tab === null) return null
    if (tab.kind === 'pdf') { const page = docViews[pane]?.page; return page === undefined ? null : `p.${page}` }
    if (tab.kind === 'markdown') return tab.id
    if (tab.kind === 'memoNote') { const at = tab.id.lastIndexOf('/'); return at < 0 ? null : tab.id.slice(0, at) }
    return null
  }
  /** 칸 머리: 색 점 · 번호 · 탭 줄 + ⋯ 메뉴(나누기 · 크게 · 새 화면으로 떼기 · 자리 · 색 · 닫기). 모든 칸이 같다 */
  const renderPaneHead = (pane: PaneId, index: number) => (
    <PaneHead
      tabs={renderPaneTabs(pane, index)}
      prefixText={prefixHint}
      paneCount={paneCount}
      zoomed={zoomedPane === pane}
      splitEnabled={SPLIT_PANES_ENABLED && !isDetachedWindow}
      channel={channelOf(channels, pane)}
      onSplit={(dir) => splitPaneFromHead(pane, dir)}
      onToggleZoom={() => toggleFocus(pane)}
      onBreak={() => breakPaneToScreen(pane)}
      onSwap={() => swapPaneWithNeighbor(pane)}
      onFloat={SPLIT_PANES_ENABLED && !isDetachedWindow ? () => floatPaneFromHead(pane) : undefined}
      onCycleChannel={() => setChannels((current) => cyclePaneChannel(current, pane))}
      onClose={() => closePane(pane)}
    />
  )
  /** 떠 있는 칸의 머리: 탭 줄 + 잡고 끄는 자리 + ▁ 접기 · ⇲ 칸으로 넣기 · × 닫기 */
  const renderFloatHead = (pane: PaneId) => {
    const collapsed = floatOf(activeScreenNow, pane)?.collapsed === true
    return (
      <>
        {renderPaneTabs(pane, undefined)}
        <span className="pane-float-grip" aria-hidden="true" />
        <button type="button" className="pane-float-button" aria-label={collapsed ? t('펼치기') : t('접기')} title={collapsed ? t('펼치기') : t('접기 (머리만 남깁니다)')} aria-pressed={collapsed} onClick={() => collapseFloatPane(pane)}>
          <Minus size={14} weight="bold" aria-hidden="true" />
        </button>
        <button type="button" className="pane-float-button" aria-label={t('칸으로 넣기')} title={t('칸으로 넣기 (embed-pane)')} onClick={() => embedFloatPane(pane)}>
          <ArrowLineDownRight size={14} weight="bold" aria-hidden="true" />
        </button>
        <button type="button" className="pane-float-button" aria-label={t('떠 있는 칸 닫기')} title={t('닫기')} onClick={() => closeFloatPane(pane)}>
          <X size={14} weight="bold" aria-hidden="true" />
        </button>
      </>
    )
  }
  /**
   * 도구줄에 보일 문서 이름. 탭은 짧은 표시 이름이라, 여기는 정식 이름(PDF 서지 제목)을
   * 진하게, 파일 이름을 흐리게 둔다. 정식 이름을 모르면 표시 이름을 쓴다.
   */
  const documentHeading = (tab: Tab, meta: { title: string } | null) => {
    const docId = tabDocId(tab)
    const shown = docTitles[docId] ?? tab.title
    const path = searchRecords.find((record) => record.id === docId)?.path ?? (tab.kind === 'markdown' ? tab.id : null)
    const fileName = path === null ? meta?.title : path.split(/[\\/]/u).at(-1)
    const formal = bibliography.entries[docId]?.title?.trim()
    const main = formal !== undefined && formal.length >= 8 ? formal : shown
    return { main, sub: fileName === undefined || fileName === main ? undefined : fileName }
  }
  /** 빈 칸: 조용한 명령 목록(PDF · Markdown · 노트 · 이 칸 닫기)과 최근 문서(EmptyPane) */
  const renderEmptyPane = (pane: PaneId) => {
    const open = (run: () => void) => () => { setPaneRoute('doc', pane); setActivePaneId(pane); run() }
    const recents: EmptyPaneRecent[] = isDetachedWindow ? [] : [
      ...searchRecords
        .filter((record) => (record.kind === 'pdf' || record.kind === 'markdown') && record.lastOpenedAt !== null && !record.missing)
        .map((record) => ({ key: `doc:${record.id}`, at: record.lastOpenedAt ?? '', title: record.displayName || record.filename, kind: record.kind === 'markdown' ? 'markdown' as const : 'pdf' as const, onOpen: open(() => openVaultSearchResult({ record, page: null, snippet: '', query: '' })) })),
      ...recentPdfs.map((recent) => ({ key: `ext:${recent.path}`, at: recent.openedAt, title: recent.title, kind: 'pdf' as const, onOpen: open(() => { void openExternalPdf(recent.path) }) })),
    ].sort((left, right) => right.at.localeCompare(left.at)).slice(0, 4)
    return (
      <EmptyPane
        prefixText={prefixHint}
        onPdf={isDetachedWindow ? undefined : () => emptyPaneActions.pdf(pane)}
        onMarkdown={isDetachedWindow ? undefined : () => emptyPaneActions.markdown(pane)}
        onNote={isDetachedWindow || vault === null ? undefined : () => void emptyPaneActions.note(pane)}
        onClose={paneCount > 1 ? () => closePane(pane) : undefined}
        recents={recents}
      />
    )
  }
  const renderPaneBody = (pane: PaneId) => {
    const state = tabsOf(panes, pane)
    const tab = activeTab(state)
    if (tab === null) {
      return <PaneShell state={state} emptyHint="" placeholder="" emptyContent={renderEmptyPane(pane)} />
    }
    if (tab.kind === 'memoNote') {
      return (
        <PaneShell
          state={state}
          emptyHint={t(NOTE_EMPTY)}
          placeholder={t('노트를 불러올 수 없습니다')}
          renderBody={(memoTab) => (
            <MemoNoteTabView
              key={memoTab.id}
              path={memoTab.id}
              highlights={pdfHighlights.highlights}
              docTitles={docTitles}
              onHighlightUpdated={pdfHighlights.update}
              onHighlightRemoved={(id) => {
                pdfHighlights.remove(id)
                memoNotes.forgetHighlight(id)
              }}
              onJump={(highlight) => jumpFromNotePane(highlight, pane)}
              onEdited={() => pinPaneTab(memoTab.id)}
            />
          )}
        />
      )
    }
    if (tab.kind === 'canvas') {
      return (
        <PaneShell
          state={state}
          emptyHint={t(NOTE_EMPTY)}
          placeholder={t('노트를 불러올 수 없습니다')}
          renderBody={(noteTab) => (
            <AutosavedNoteCanvas
              key={`${noteTab.id}:${canvasEpoch}`}
              noteId={noteTab.id}
              title={noteTab.title}
              storage={canvasStorage}
              onOpenSource={openSource}
              onSourceStateChange={workspaceSources.setSourceState}
              onToggleFullscreen={() => toggleFocus(pane)}
              onExportWithEvidence={(document) => exportWithEvidence(noteTab.title, document)}
              insertRequest={excerptInsertRequest}
              onTranslateText={translation.selectedModel === null ? undefined : translateCanvasText}
              highlights={canvasHighlights}
              userPresets={blockPresets.presets}
              onSaveUserPreset={blockPresets.add}
              onDirtyChange={(dirty) => setFileDirty(noteTab.id, dirty)}
              fallbackDocument={previewEnabled && noteTab.id === DEVELOPMENT_NOTE.path
                ? developmentCanvasDocument
                : undefined}
            />
          )}
        />
      )
    }
    const meta = tab.kind === 'pdf' ? openedDocs.find((doc) => doc.docId === tabDocId(tab)) ?? null : null
    const canvasTarget = canvasTargetFor(pane)
    return (
      <DocumentView
        key={`${sessionEpoch}:${pane}`}
        paneId={pane}
        state={state}
        tab={tab}
        meta={meta}
        fullscreen={focusedPane === 'zoom' && zoomedPane === pane}
        onToggleFullscreen={() => toggleFocus(pane)}
        pendingPageRef={pendingDocPageRef}
        readingPositions={readingPositions}
        recordReadingPosition={recordReadingPosition}
        onViewChange={handleDocViewChange}
        controllersRef={docControllersRef}
        shortcutTarget={docPaneId === pane}
        searchSlot={sidebarMode === 'search' && !libraryExpanded ? pdfSearchSlot : null}
        jumpToPage={jumpToPage}
        canGoBack={navigation.canBack}
        canGoForward={navigation.canForward}
        onBack={navigation.back}
        onForward={navigation.forward}
        pins={pdfBookmarks.bookmarks}
        onAddPin={pdfBookmarks.addPin}
        onUpdatePin={pdfBookmarks.updatePin}
        onMovePin={pdfBookmarks.movePin}
        onRemovePin={pdfBookmarks.remove}
        pdfViewPrefs={pdfViewPrefs}
        onPdfViewPrefsChange={updatePdfViewPrefs}
        rotations={pdfRotations}
        onRotationsChange={setPdfRotations}
        draftHighlight={draftPdfHighlight}
        aiPointer={aiPointer}
        onAiPointerDismiss={dismissAiPointer}
        onAnchorCreated={setDraftPdfHighlight}
        sourceHighlights={workspaceSources.visibleSources}
        persistentHighlights={pdfHighlights.highlights}
        onPersistentHighlightCreated={(highlight) => {
          pdfHighlights.add(highlight)
          // 형광펜을 만들면 그 문서 탭은 보통 탭으로 고정된다(미리보기 탭이 다음 미리보기에 갈아 끼워지지 않게)
          for (const tab of allPaneTabs(workspaceLatest.current.panes)) if (tab.preview === true && tabDocId(tab) === highlight.anchor.docId) pinPaneTab(tab.id)
        }}
        onPersistentHighlightRemoved={(id) => {
          pdfHighlights.remove(id)
          memoNotes.forgetHighlight(id)
        }}
        onPersistentHighlightUpdated={pdfHighlights.update}
        onPersistentHighlightsPatched={(patches) => {
          // 순서 바꾸기·모두 접기처럼 여러 메모를 한 번에(저장도 한 번)
          const byId = new Map(patches.map(({ id, patch }) => [id, patch]))
          pdfHighlights.mapAll((highlight) => {
            const patch = byId.get(highlight.id)
            return patch === undefined ? highlight : updatePersistentPdfHighlight(highlight, patch)
          })
        }}
        flashHighlightId={flashHighlightId}
        onSendToCanvas={canvasTarget === null ? undefined : (selection) => sendPdfSelectionToCanvas(canvasTarget, selection)}
        onCopyWithSource={(selection) => void copyPdfSelectionWithSource(selection)}
        onSearchDocuments={searchDocumentsFromSelection}
        onTranslateSelection={translation.settings.enabled ? translatePdfSelection : undefined}
        onSendTranslatedSelection={canvasTarget === null ? undefined : (selection, translated) => sendTranslatedPdfSelectionToCanvas(canvasTarget, selection, translated)}
        onExternalLink={openPdfLink}
        onNavigateBack={navigation.back}
        onNavigateForward={navigation.forward}
        markdownSource={tab.kind === 'markdown' ? markdownSources[tab.id] : undefined}
        markdownSourceFileId={searchRecords.find((record) => record.path === tab.id)?.id ?? tab.id}
        vaultRoot={vault?.root}
        onOpenMarkdownPath={openMarkdownPath}
        markdownTheme={markdownTheme}
        onTranslateMarkdownSelection={!translation.settings.enabled || translation.selectedModel === null ? undefined : translateMarkdownSelection}
        onSearchDocumentsText={searchDocumentsFromText}
        onSendTranslatedMarkdownSelection={canvasTarget === null ? undefined : (payload, translated) => sendTranslatedMarkdownSelectionToCanvas(canvasTarget, payload, translated)}
        markdownHighlights={markdownHighlights.highlights}
        onMarkdownHighlightCreated={markdownHighlights.add}
        onMarkdownHighlightRemoved={markdownHighlights.remove}
        markdownJumpRequest={markdownJumpRequest}
        onMarkdownJumpHandled={() => setMarkdownJumpRequest(null)}
        placeholder={t('문서를 불러올 수 없습니다. 사이드바에서 문서를 다시 연결해 주세요')}
        fullTitle={documentHeading(tab, meta).main}
        subtitle={documentHeading(tab, meta).sub}
        overlays={pdfOverlays.overlays[tabDocId(tab)]}
        onOverlayAdd={pdfOverlays.add}
        onOverlayUpdate={pdfOverlays.update}
        onOverlayRemove={pdfOverlays.remove}
        sourceCount={docSources.sources[tabDocId(tab)]?.length ?? 0}
        onOpenSources={() => setSourcesDocId(tabDocId(tab))}
        github={(() => {
          const source = tab.kind === 'markdown' ? githubSourceOf(tab.id) : undefined
          return source === undefined ? undefined : { name: source.name, behind: source.behind, onAction: (action) => githubAction(action, source.name) }
        })()}
        onCopyFile={() => void copyPdfFile(tabDocId(tab))}
        onEditPages={(id) => setPdfToolsTarget({ docId: id, tool: 'pageEdit' })}
        versionLabel={tab.kind === 'pdf' ? versionLabelOf(tabDocId(tab)) : undefined}
        onOpenVersions={tab.kind === 'pdf' ? (anchor) => setTabVersionMenu({ tabId: tab.id, docId: tabDocId(tab), anchor }) : undefined}
      />
    )
  }
  // 패널 안 어디를 누르든 그 패널이 "지금 만지는 패널"이 된다. display: contents 라 배치에는 끼지 않는다.
  // PDF 도구 화면이 대신할 창: 그 문서를 보이는 창(없으면 지금 문서 창)
  const pdfToolsPane: PaneId | null = pdfToolsTarget === null ? null
    : paneOrder.find((pane) => { const tab = activeTab(tabsOf(panes, pane)); return tab?.kind === 'pdf' && tabDocId(tab) === pdfToolsTarget.docId }) ?? docPaneId
  // 다른 PDF 로 옮겨 가면 펼쳐 둔 도구는 접는다(쪽 편집 화면은 그 문서 것이라 둔다)
  const activePdfDocId = activePdfDoc?.docId
  useEffect(() => {
    setPdfToolsTarget((current) => (current === null || current.tool === 'pageEdit' || activePdfDocId === undefined || current.docId === activePdfDocId ? current : null))
  }, [activePdfDocId])
  // 「PDF 도구」 탭이 다루는 문서: 도구를 연 문서(문서 우클릭 메뉴 등), 없으면 지금 보는 PDF
  const pdfToolsDoc = (pdfToolsTarget === null ? null : openedDocs.find((doc) => doc.docId === pdfToolsTarget.docId)) ?? activePdfDoc
  const renderPane = (pane: PaneId) => (
    <div className="pane-focus-scope" data-pane-id={pane} data-pane-fresh={freshPane === pane ? '' : undefined} data-pane-active={activePaneId === pane && (paneCount > 1 || floatIds.includes(pane)) ? '' : undefined} onPointerDownCapture={() => focusPane(pane)}>
      <PaneIdContext.Provider value={pane}>
        {renderPaneBody(pane)}
      </PaneIdContext.Provider>
      {pdfToolsTarget !== null && pdfToolsTarget.tool === 'pageEdit' && pdfToolsPane === pane ? renderPageEdit(pdfToolsTarget) : null}
    </div>
  )

  if (initializing) {
    return <StartupShell><div className="vault-loading">{t('Vault를 여는 중…')}</div></StartupShell>
  }
  if (!injected && vault === null) {
    return (
      <>
        {/* 첫 화면에서 고른 폴더도 비어 있으면 예시(사용 안내서·노트)를 넣는다. 실패해도 Vault 는 연다 */}
        <VaultPicker
          onOpened={(handle) => void seedSampleVaultInto(handle).catch(() => false).then(() => loadVault(handle))}
          theme={{
            preference: theme.preference,
            resolvedTheme: theme.resolvedTheme,
            setPreference: theme.setPreference,
            palette: theme.palette,
            setPalette: theme.setPalette,
            accent: theme.accent,
            setAccent: theme.setAccent,
          }}
          version={packageMetadata.version}
        />
        <ThemeIntakeHost resolvedTheme={theme.resolvedTheme} />
        <NoticeStack>
          {error !== null && <ErrorNotice message={error} onDismiss={dismissError} />}
        </NoticeStack>
      </>
    )
  }

  return (
    <MemoNoteContext.Provider value={memoNoteApi}>
    <WorkspaceContext.Provider value={workspaceLink}>
    <TranslationCardSettingsContext.Provider value={translationCardSettings}>
    <TranslatorContext.Provider value={translatorService}>
    <TopBarToolbarContext.Provider value={toolbarSlotValue}>
    <SplitPanes
      sidebar={
        sidebarMode === 'library' || libraryExpanded ? (
          <Sidebar
            paneDrop={sidebarPaneDrop}
            library={shownLibrary}
            notebooks={shownNotebooks}
            showNotes={CANVAS_ENABLED}
            onOpenDoc={(doc) => { setLibraryExpanded(false); void openDocument(doc) }}
            memoNotes={vault === null ? undefined : {
              docOwner: noteDocOwner,
              onCreateForDoc: (docId) => {
                void createNoteForDoc(docId).then((path) => {
                  if (path === null) return
                  openMemoNoteTab(path)
                  requestTitleEdit(path)
                })
              },
              entries: orderMemoNoteEntries(memoNotes.entries, noteOrder),
              openPath: memoNotes.openPath,
              onReorder: setNoteOrder,
              onOpen: (path) => { openMemoNoteTab(path) },
              onCreate: () => {
                void memoNotes.create().then((path) => { if (path !== null) openMemoNoteTab(path) })
              },
              onCreateIn: (folder) => {
                void memoNotes.createIn(folder).then((path) => { if (path !== null) openMemoNoteTab(path) })
              },
              onRename: async (path, title) => {
                const next = await memoNotes.rename(path, title)
                remapMemoPaths(new Map([[path, next]]))
              },
              onTrash: async (path) => {
                await memoNotes.trash(path)
                forgetMemoPaths([path])
              },
              folders: memoNotes.folders,
              onCreateFolder: async (parent, name) => { await memoNotes.createFolder(parent, name) },
              onRenameFolder: async (path, name) => remapMemoPaths(await memoNotes.renameFolder(path, name)),
              onMoveFolder: async (path, parent) => remapMemoPaths(await memoNotes.moveFolder(path, parent)),
              onTrashFolder: async (path) => forgetMemoPaths([path, ...await memoNotes.trashFolder(path)]),
              onMove: async (path, folder, place) => {
                const next = await memoNotes.move(path, folder)
                const order = orderMemoNoteEntries(memoNotes.entries, noteOrder).map((entry) => entry.path === path ? next : entry.path)
                const rest = order.filter((candidate) => candidate !== next)
                const at = place === undefined ? -1 : rest.indexOf(place.target)
                if (at >= 0) rest.splice(place!.position === 'before' ? at : at + 1, 0, next)
                else rest.push(next)
                setNoteOrder(rest)
                remapMemoPaths(new Map([[path, next]]), false)
              },
              onReveal: (path) => {
                if (vault !== null) void revealMemoNote(vault, path).catch((cause: unknown) => announceAction(errorText(cause)))
              },
              onCopyPath: (path) => {
                if (vault === null) return
                void memoNoteAbsolutePath(vault, path)
                  .then((absolute) => navigator.clipboard.writeText(absolute))
                  .then(() => announceAction(t('경로를 복사했습니다.')))
                  .catch((cause: unknown) => announceAction(errorText(cause)))
              },
            }}
            onOpenNote={(note) => openCanvasTab(note)}
            onOpenMarkdown={(markdown) => void openMarkdown(markdown)}
            onAddDoc={(policy) => void addDocument(policy)}
            onCreateNote={addNote}
            onCreateFolder={createFolder}
            onMoveEntry={moveEntry}
            onPlaceNode={placeTreeNode}
            onPlaceNodes={placeTreeNodes}
            onDuplicateEntry={duplicateEntry}
            onTrashEntry={trashEntry}
            onTrashFolder={trashFolder}
            onRenameFolder={renameFolder}
            onConvertEntryToCopy={convertEntryToCopy}
            onCopyEntryPath={copyEntryPath}
            githubSources={githubSources}
            onGithubAction={githubAction}
            onGithubImport={vault === null ? undefined : () => setGithubDialog({ kind: 'import' })}
            onRefresh={vault === null ? undefined : refreshAll}
            onRevealEntry={async (id) => { await revealInFolder(await copyEntryPath(id)) }}
            versionGroups={versionGroups.groups}
            versionActions={{
              onOpen: (docId) => {
                const doc = shownLibrary.find((item) => item.docId === docId)
                if (doc !== undefined) {
                  void openDocument(doc)
                  return
                }
                const markdown = markdownNodeById(docId)
                if (markdown !== null) {
                  void openMarkdown(markdown)
                  return
                }
                // 폴더 판: 고르면 그 폴더가 기본 판이 된다(묶음 폴더를 펼치면 그 내용이 보인다)
                if (docId.startsWith('folder:')) versionGroups.setDefault(docId)
              },
              onPin: versionGroups.setDefault,
              onRename: versionGroups.renameVersion,
              onRemove: versionGroups.removeVersion,
              onDissolve: versionGroups.dissolve,
              onRenameGroup: versionGroups.renameGroup,
              onAddVersion: (groupId) => {
                const group = versionGroups.groups[groupId]
                if (group !== undefined) setStackRequest({ baseDocId: group.anchorDocId, addedDocId: null })
              },
              onStack: (draggedDocId, baseDocId) => setStackRequest({ baseDocId, addedDocId: draggedDocId }),
            }}
            onStackRequest={(docId) => setStackRequest({ baseDocId: docId, addedDocId: null })}
            onStartVersions={(docId) => {
              const folderName = docId.startsWith('folder:') ? docId.slice('folder:'.length).split('/').at(-1) ?? docId : null
              const fileName = folderName ?? searchRecords.find((record) => record.id === docId)?.path.split(/[\\/]/u).at(-1) ?? docTitles[docId] ?? docId
              const shownTitle = folderName ?? docTitles[docId] ?? searchRecords.find((record) => record.id === docId)?.displayName ?? docId
              const label = guessVersionLabel(fileName, folderName ?? docTitles[docId])
              const ok = versionGroups.start({ docId, title: groupTitleFromDocTitle(shownTitle, label), label })
              announceAction(ok ? t('버전 묶음을 만들었습니다({label}). 새 버전은 이 문서 위로 끌어 놓거나 우클릭 「이 묶음에 버전 추가…」로 넣습니다', { label }) : t('이미 버전 묶음에 있는 문서입니다'))
            }}
            onOpenSources={setSourcesDocId}
            onOpenFirstSource={(docId: string) => { const first = docSources.sources[docId]?.[0]; if (first !== undefined) openDocSource(first) }}
            sourceCounts={Object.fromEntries(Object.entries(docSources.sources).map(([id, list]) => [id, list.length]))}
            // 폴더는 그 폴더가 골라진 채로 상위 폴더를 연다(아무 경로나 여는 권한은 앱에 주지 않는다)
            onRevealFolder={vault === null ? undefined : async (path) => {
              const { join } = await import('@tauri-apps/api/path')
              await revealInFolder(path === '' ? vault.root : await join(vault.root, ...path.split('/')))
            }}
            onRelinkDoc={(docId) => void relink(docId)}
            missingDocIds={missingDocIds}
            vaultRoot={vault?.root}
            onSwitchVault={closeVaultSafely}
            recentVaultPaths={recentVaultPaths}
            onOpenRecentVault={openRecentVaultSafely}
            onOpenSettings={() => { setSettingsSection(undefined); setSettingsOpen(true) }}
            openDocIds={openTabIds.filter((tab) => isDocumentKind(tab.kind)).map(tabDocId)}
            openNotePaths={openTabIds.filter((tab) => tab.kind === 'canvas').map((tab) => tab.id)}
            activeDocId={activeDocumentTab === null ? null : tabDocId(activeDocumentTab)}
            activeNotePath={activeNoteId}
            tree={tree}
            onReorderNode={(request) => void reorderTreeNode(request)}
            onRenameEntry={renameEntry}
            onUpdateBibliography={updateBibliography}
            searchRecords={searchRecords}
            searchIndexProgress={searchIndexProgress}
            onOpenSearchResult={openVaultSearchResult}
            onFavoriteChange={setFileFavorite}
            documentDropActive={documentDropActive}
            documentDropFolder={documentDropFolder}
            documentDropPlace={documentDropPlace}
            itemIcons={itemIcons}
            onItemIconChange={setItemIcon}
            itemColors={itemColors}
            recentPdfs={recentPdfs}
            onOpenRecentPdf={(path) => void openExternalPdf(path)}
            onImportRecentPdf={importExternalPdf}
            onForgetRecentPdf={forgetRecentPdf}
            onRevealRecentPdf={(path) => void revealInFolder(path).catch((cause: unknown) => announceAction(errorText(cause)))}
            onItemColorChange={setItemColor}
            libraryExpanded={libraryExpanded}
            libraryHost={libraryHost}
            showVaultSearch={false}
            onToggleLibrary={toggleLibrary}
            onOpenLibraryItem={openLibraryItem}
            bibliography={bibliography.entries}
            onEditBibliography={setBibliographyDocId}
            onCopyBibtex={copyBibtex}
            onOpenPdfTools={(docId) => openPdfToolsView(docId, openedDocs.find((doc) => doc.docId === docId)?.hasText === false ? 'ocr' : 'flatten')}
          />
        ) : (
          <div className="side-doc-target-wrap">
          {renderDocTargetSwitch()}
          {sidebarMode === 'search' ? (
          <div className="side-search-tab">
            <SearchScopeSwitch scope={searchScope} onChange={setSearchScope} />
            <div className="side-pdf-search" ref={setPdfSearchSlot} aria-label={t('PDF 검색')} hidden={searchScope === 'vault'}>
              {activePdfDoc === null && activeDocumentTab?.kind !== 'markdown' ? <p className="side-section-empty">{t('PDF·Markdown 을 열면 여기서 검색합니다')}</p> : null}
            </div>
            {searchScope === 'vault' ? (
              <div className="side-pdf-search side-vault-search" aria-label={t('모든 문서 검색')}>
                <DocumentSearchPanel
                  state={documentSearch}
                  records={searchRecords}
                  indexProgress={searchIndexProgress}
                  onOpenHit={(hit) => void openVaultHit(hit)}
                />
              </div>
            ) : null}
          </div>
        ) : sidebarMode === 'tools' ? (
          <PdfToolsPanel
            docTitle={pdfToolsDoc === null ? null : docTitles[pdfToolsDoc.docId] ?? pdfToolsDoc.title}
            activeTool={pdfToolsTarget === null || pdfToolsDoc === null || pdfToolsTarget.docId !== pdfToolsDoc.docId ? null : pdfToolsTarget.tool ?? (pdfToolsDoc.hasText === false ? 'ocr' : 'flatten')}
            onPick={(tool) => {
              if (pdfToolsDoc === null) return
              // 펼친 도구를 다시 누르면 접는다
              if (pdfToolsTarget?.docId === pdfToolsDoc.docId && (pdfToolsTarget.tool ?? (pdfToolsDoc.hasText === false ? 'ocr' : 'flatten')) === tool) setPdfToolsTarget(null)
              else setPdfToolsTarget({ docId: pdfToolsDoc.docId, tool })
            }}
            renderTool={(tool) => (tool === 'pageEdit' ? null : renderPdfToolForm(pdfToolsDoc!.docId, tool))}
          />
        ) : sidebarMode === 'thumbnails' && activeDocumentTab?.kind === 'markdown' && markdownSources[activeDocumentTab.id] !== undefined ? (
          <MarkdownSectionPreview
            source={markdownSources[activeDocumentTab.id]!}
            currentSection={markdownSectionState[activeDocumentTab.id] ?? 0}
            onSelectSection={(index) => window.dispatchEvent(new CustomEvent('iwae:md-section-go', { detail: { path: activeDocumentTab.id, index } }))}
          />
        ) : sidebarMode === 'thumbnails' ? (
          <ThumbnailPanel
            viewportPane={docPaneId}
            activeDoc={activePdfDoc}
            currentPage={currentPdfPage - 1}
            onSelectPage={(page) => jumpToPage(page + 1)}
          />
        ) : (
          activeDocumentTab?.kind === 'markdown' && markdownSources[activeDocumentTab.id] !== undefined ? (
            <MarkdownOutline
              source={markdownSources[activeDocumentTab.id]!}
              currentSection={markdownSectionState[activeDocumentTab.id] ?? 0}
              onSelectSection={(index) => window.dispatchEvent(new CustomEvent('iwae:md-section-go', { detail: { path: activeDocumentTab.id, index } }))}
              bookmarks={pdfBookmarks.bookmarks.filter((bookmark) => bookmark.docId === activeDocumentTab.id)}
              onSelectBookmark={(bookmark) => window.dispatchEvent(new CustomEvent('iwae:md-pin-go', { detail: { path: activeDocumentTab.id, y: bookmark.y ?? 0 } }))}
              onRemoveBookmark={(bookmark) => pdfBookmarks.remove(bookmark.id)}
            />
          ) : <OutlinePanel
            activeDoc={activePdfDoc}
            currentPage={currentPdfPage - 1}
            bookmarks={pdfBookmarks.bookmarks}
            onSelectPage={(page) => jumpToPage(page + 1)}
            onRemoveBookmark={(bookmark) => pdfBookmarks.remove(bookmark.id)}
          />
          )}
          {/* 바닥 줄(Vault·설정)은 탐색기와 같은 자리에 늘 있다 */}
          <SidebarFooter
            vaultRoot={vault?.root}
            recentVaultPaths={recentVaultPaths}
            onSwitchVault={closeVaultSafely}
            onOpenRecentVault={openRecentVaultSafely}
            onOpenSettings={() => { setSettingsSection(undefined); setSettingsOpen(true) }}
          />
          </div>
        )
      }
      layout={layout}
      onLayoutChange={setLayout}
      focusedPane={focusedPane}
      libraryExpanded={libraryExpanded}
      onLibraryHost={setLibraryHost}
      zoomedPane={zoomedPane}
      root={layoutRoot}
      epoch={sessionEpoch}
      onRootChange={setLayoutRoot}
      renderPane={(pane) => renderPane(pane)}
      // 모든 칸이(하나여도) 자기 머리를 칸 맨 위에 둔다
      renderHead={(pane, index) => renderPaneHead(pane, index)}
      paneChannel={(pane) => channelOf(channels, pane)}
      onFocusPane={focusPane}
      paneEmpty={(pane) => tabsOf(panes, pane).tabs.length === 0}
      activePane={activePaneId}
      floats={shownFloats}
      renderFloatHead={renderFloatHead}
      onFloatChange={(pane, patch) => screenOps.replace(patchFloat(commandModelRef.current.screens, pane, patch))}
      onFloatRaise={(pane) => { const raised = raiseFloat(commandModelRef.current.screens, pane); if (raised !== commandModelRef.current.screens) screenOps.replace(raised) }}
      onSwapSplit={swapPanes}
      topBar={({ sidebarPx, leftFrac, sidebarVisible }) => (
        <TopBar
          sidebarCollapsed={sidebarCollapsed}
          sidebarVisible={sidebarVisible}
          onToggleSidebar={() => setSidebarCollapsed((v) => !v)}
          sidebarMode={sidebarMode}
          onSidebarModeChange={(mode) => { setLibraryExpanded(false); setSidebarMode(mode) }}
          appMenu={[
            activeDocumentTab?.kind === 'pdf' || activeDocumentTab?.kind === 'markdown'
              ? [{ id: 'print', label: t('인쇄'), hint: 'Ctrl+P', onSelect: () => window.dispatchEvent(new CustomEvent('iwae:print')) }]
              : [],
            [
              { id: 'new-window', label: t('새 창'), hint: 'Ctrl+Shift+N', onSelect: () => windowActionsRef.current.newWindow() },
              ...(isDetachedWindow
                ? [{ id: 'reattach', label: t('다시 붙이기'), onSelect: () => windowActionsRef.current.reattach() }]
                : activeDocumentTab?.kind === 'pdf'
                  ? [{ id: 'detach', label: t('창으로 떼어 내기'), onSelect: () => windowActionsRef.current.detachActive() }]
                  : []),
            ],
            [
              { id: 'zotero-import', label: t('Zotero 에서 가져오기…'), onSelect: () => { void interop.runZotero() } },
              { id: 'export-markdown', label: t('모든 노트를 Markdown 으로 내보내기…'), onSelect: () => { void interop.exportMarkdown({ kind: 'vault' }) } },
            ],
            [{
              id: 'theme',
              label: theme.resolvedTheme === 'dark' ? t('밝은 화면으로') : t('어두운 화면으로'),
              onSelect: () => theme.setPreference(theme.resolvedTheme === 'dark' ? 'light' : 'dark'),
            }],
            [
              { id: 'updates', label: t('업데이트 확인'), onSelect: () => { setSettingsSection('updates'); setSettingsOpen(true) } },
              { id: 'settings', label: t('설정'), hint: 'Ctrl+,', onSelect: () => { setSettingsSection(undefined); setSettingsOpen(true) } },
              { id: 'report', label: t('문제 보고…'), onSelect: () => setReportOpen(true) },
              { id: 'about', label: t('정보 보기'), onSelect: () => setAboutOpen(true) },
            ],
          ]}
          sidebarPx={sidebarPx}
          sessionName={sessionName}
          clientLabel={isMainWindow || isDetachedWindow ? undefined : clients.selfLetter}
          sessionActions={ownsSession(windowMode)
            ? {
                list: sessionOps.list,
                onSwitch: sessionOps.switchTo,
                onNew: (name) => sessionOps.create(name),
                onSaveAs: sessionOps.fork,
                onRename: (name) => sessionOps.rename(sessionName, name),
                onDelete: () => setSessionToKill(sessionName),
                onNewClient: () => { void openNewClient().then((result) => { if (!result.ok) announceAction(result.message) }) },
              }
            : undefined}
          toolbarSlotRef={setToolbarSlot}
          toolbarOwner={toolbarOwner}
          screens={SPLIT_PANES_ENABLED && !isDetachedWindow ? {
            items: screens,
            activeId: activeScreenId,
            lastId: lastScreenId,
            templates: availableScreenTemplates(CANVAS_ENABLED),
            onSelect: switchToScreen,
            onRename: screenOps.rename,
            onReorder: screenOps.reorder,
            onClose: screenOps.close,
            onNew: (id) => { void newScreenFromTemplate(id as ScreenTemplateId) },
          } : undefined}
          onCloseWindow={closeWindowSafely}
          // 떼어 낸 창은 왼쪽 바 없이 시작한다(찾기 등으로 열렸을 때만 접을 수 있게 단추가 나온다)
          hideSidebarToggle={isDetachedWindow && sidebarCollapsed}
        />
      )}
      sidebarCollapsed={sidebarCollapsed}
    />
    {CANVAS_ENABLED && focusedPane === 'split' && !libraryExpanded ? (
      <SourceTrace
        sources={workspaceSources.visibleSources}
      />
    ) : null}
    {/* 앱의 모든 알림은 오른쪽 아래 한 줄기로: 위 토스트, 아래로 오류 · AI 위치 · 가져오기 권유 · 업데이트 · AI 알약 */}
    <NoticeStack>
      {error !== null && <ErrorNotice message={error} onDismiss={dismissError} />}
      <AiLocationInbox
        items={aiLocations}
        docTitles={docTitles}
        onOpen={openAiLocation}
        onDismiss={(id) => setAiLocations((current) => current.filter((item) => item.id !== id))}
      />
      {interop.offer === null ? null : <AnnotationOfferBanner count={interop.offer.count} onImport={interop.acceptOffer} onDismiss={interop.dismissOffer} />}
      <UpdateBanner state={updater} hidden={settingsOpen} />
      <AiActivityPill />
    </NoticeStack>
    {passwordRequest !== null ? (
      <PdfPasswordDialog
        key={passwordRequest.nonce}
        path={passwordRequest.path}
        wrong={passwordRequest.wrong}
        onSubmit={(password) => { passwordRequest.resolve(password); setPasswordRequest(null) }}
        onCancel={() => { passwordRequest.resolve(null); setPasswordRequest(null) }}
      />
    ) : null}
    {bibliographyDocId !== null ? (
      <BibliographyDialog
        documentTitle={docTitles[bibliographyDocId] ?? bibliographyDocId}
        entry={bibliography.entries[bibliographyDocId]}
        onClose={() => setBibliographyDocId(null)}
        onSave={(entry) => {
          bibliography.saveEntry(bibliographyDocId, entry)
          setBibliographyDocId(null)
        }}
        onFetchCrossref={bibliography.fetchCrossref}
      />
    ) : null}
    {tabVersionMenu !== null && versionGroups.groups !== undefined ? (() => {
      const group = groupOfDoc(versionGroups.groups, tabVersionMenu.docId)
      if (group === null) return null
      return (
        <VersionMenu
          group={group}
          openDocIds={openTabIds.map((tab) => tabDocId(tab))}
          anchor={tabVersionMenu.anchor}
          currentDocId={tabVersionMenu.docId}
          onClose={() => setTabVersionMenu(null)}
          onOpen={(docId) => void switchTabVersion(tabVersionMenu.tabId, docId)}
          onCompare={SPLIT_PANES_ENABLED ? (docId) => void compareTabVersion(tabVersionMenu.tabId, docId) : undefined}
          onPin={versionGroups.setDefault}
          onRename={versionGroups.renameVersion}
          onRemove={versionGroups.removeVersion}
          onDissolve={versionGroups.dissolve}
          onAddVersion={(groupId) => {
            const target = versionGroups.groups[groupId]
            if (target !== undefined) setStackRequest({ baseDocId: target.anchorDocId, addedDocId: null })
          }}
        />
      )
    })() : null}
    {stackRequest !== null ? (() => {
      const fileNameOf = (docId: string) => {
        if (docId.startsWith('folder:')) return docId.slice('folder:'.length).split('/').at(-1) ?? docId
        const path = searchRecords.find((record) => record.id === docId)?.path
        return path === undefined ? docTitles[docId] ?? docId : path.split(/[\\/]/u).at(-1) ?? path
      }
      const toDoc = (docId: string): StackDoc => ({ docId, title: docId.startsWith('folder:') ? docId.slice('folder:'.length) : docTitles[docId] ?? searchRecords.find((record) => record.id === docId)?.displayName ?? docId, fileName: fileNameOf(docId) })
      const existing = groupOfDoc(versionGroups.groups, stackRequest.baseDocId)
      const baseDocId = existing?.anchorDocId ?? stackRequest.baseDocId
      const inGroup = new Set(Object.values(versionGroups.groups).flatMap((group) => group.versions.map((version) => version.docId)))
      // 폴더는 폴더끼리, Markdown 은 Markdown 끼리, PDF 는 PDF 끼리 겹친다
      const baseFolder = baseDocId.startsWith('folder:') ? baseDocId.slice('folder:'.length) : null
      const baseIsMarkdown = baseFolder === null && !shownLibrary.some((doc) => doc.docId === baseDocId)
      const candidateIds = baseFolder !== null
        ? vaultFolderPaths
          .filter((path) => path !== baseFolder && !path.startsWith(`${baseFolder}/`) && !baseFolder.startsWith(`${path}/`))
          .map((path) => `folder:${path}`)
        : baseIsMarkdown
          ? searchRecords.filter((record) => record.kind === 'markdown').map((record) => record.id)
          : shownLibrary.map((doc) => doc.docId)
      const candidates = candidateIds
        .filter((id) => id !== baseDocId && !inGroup.has(id))
        .map((id) => toDoc(id))
      return (
        <StackVersionsDialog
          base={toDoc(baseDocId)}
          added={stackRequest.addedDocId === null ? null : { ...toDoc(stackRequest.addedDocId), ...(stackRequest.addedFileName === undefined ? {} : { fileName: stackRequest.addedFileName }) }}
          candidates={candidates}
          {...(existing === null ? {} : { groupTitle: existing.title, existingLabels: existing.versions.map((version) => version.label) })}
          suggested={stackRequest.suggested === true}
          onClose={() => setStackRequest(null)}
          onConfirm={({ added, baseLabel, addedLabel, makeDefault }) => {
            const ok = versionGroups.stack(
              { docId: baseDocId, title: groupTitleFromDocTitle(docTitles[baseDocId] ?? baseDocId, baseLabel ?? addedLabel), label: baseLabel ?? addedLabel },
              { docId: added.docId, label: addedLabel },
            )
            if (!ok) announceAction(t('버전으로 묶을 수 없습니다(이미 다른 묶음에 있는 문서입니다)'))
            else {
              if (makeDefault) versionGroups.setDefault(added.docId)
              announceAction(t('「{title}」를 {label} 버전으로 묶었습니다', { title: docTitles[added.docId] ?? added.docId, label: addedLabel }))
            }
            setStackRequest(null)
          }}
        />
      )
    })() : null}
    {sourcesDocId !== null ? (
      <DocSourcesDialog
        title={docTitles[sourcesDocId] ?? sourcesDocId}
        sources={docSources.sources[sourcesDocId] ?? []}
        suggestions={(() => {
          const entry = bibliography.entries[sourcesDocId]
          const list: { label: string; target: string }[] = []
          if (entry?.doi !== undefined && entry.doi !== '') list.push({ label: 'DOI', target: `https://doi.org/${entry.doi}` })
          if (entry?.arxiv !== undefined && entry.arxiv !== '') list.push({ label: 'arXiv', target: `https://arxiv.org/abs/${entry.arxiv}` })
          return list
        })()}
        onOpen={openDocSource}
        onAdd={(input) => docSources.add(sourcesDocId, input)}
        onUpdate={(sourceId, patch) => docSources.update(sourcesDocId, sourceId, patch)}
        onRemove={(sourceId) => docSources.remove(sourcesDocId, sourceId)}
        onClose={() => setSourcesDocId(null)}
      />
    ) : null}
    {githubDialog?.kind === 'import' && vault !== null ? (
      <GithubImportDialog
        folders={vaultFolderPaths}
        initialFolder={githubDialog.folder ?? ''}
        onClose={() => setGithubDialog(null)}
        onImport={async (url, target) => {
          const source = await githubClone(vault.root, url, target)
          putGithubSource(source)
          await refreshVault()
          announceAction(t('「{target}」 에 받았습니다 ({ref} · {date})', { target: source.target, ref: source.branch ?? source.detached ?? '', date: source.headDate }))
        }}
      />
    ) : null}
    {githubDialog?.kind === 'versions' && vault !== null ? (
      <GithubVersionsDialog
        source={githubDialog.source}
        load={() => githubRefs(vault.root, githubDialog.source.name)}
        onClose={() => setGithubDialog(null)}
        onPick={async (ref) => {
          const source = await githubCheckout(vault.root, githubDialog.source.name, ref.kind, ref.name)
          putGithubSource(source)
          await refreshVault()
          announceAction(t('{name}: {ref} ({date}) 문서로 바꿨습니다', { name: source.name, ref: source.branch ?? source.detached ?? '', date: source.headDate }))
        }}
      />
    ) : null}
    {githubDialog?.kind === 'changes' ? (
      <GithubChangesDialog
        source={githubDialog.source}
        changed={githubDialog.changed}
        applied={githubDialog.applied}
        onClose={() => setGithubDialog(null)}
        onOpen={(path) => openMarkdownPath(path)}
        onPull={() => githubPullAndShow(githubDialog.source.name)}
      />
    ) : null}
    {sessionToKill !== null ? (
      <ConfirmDialog
        title={t('세션을 지울까요?')}
        confirmLabel={t('삭제')}
        tone="danger"
        onConfirm={() => {
          const name = sessionToKill
          setSessionToKill(null)
          void sessionOps.remove(name).then((result) => { if (result.message !== '') announceAction(result.message) })
        }}
        onCancel={() => setSessionToKill(null)}
      >
        <p>{t('세션 「{name}」 을(를) 지웁니다. 세션 파일은 .iwae/sessions/.trash 폴더로 옮겨 두고, 열려 있는 문서와 노트는 그대로입니다.', { name: sessionToKill })}</p>
      </ConfirmDialog>
    ) : null}
    {memoNotes.conflict !== null ? (
      <ConfirmDialog
        title={t('노트가 다른 곳에서 바뀌었습니다')}
        confirmLabel={t('내 것을 사본으로 저장')}
        cancelLabel={t('파일의 것으로 되돌리기')}
        extra={{ label: t('내 것으로 덮어쓰기'), onClick: () => void memoNotes.resolveConflict('mine') }}
        locked
        onConfirm={() => void memoNotes.resolveConflict('copy')}
        onCancel={() => void memoNotes.resolveConflict('file')}
      >
        <p>{t('「{name}」 노트를 다른 프로그램이 바꿨고, 이 앱에도 아직 저장하지 않은 변경이 있습니다. 어느 쪽을 남길까요?', { name: memoNotes.conflict.title })}</p>
        <p>{t('정할 때까지 이 노트는 파일에 저장하지 않습니다. 「파일의 것으로 되돌리기」는 이 앱의 저장하지 않은 변경을 버립니다.')}</p>
      </ConfirmDialog>
    ) : null}
    {pendingSlides !== null ? (
      <ConfirmDialog
        title={t('PowerPoint 를 PDF 로 바꿔 넣을까요?')}
        confirmLabel={convertingSlides ? t('바꾸는 중…') : t('PDF 로 바꿔 넣기')}
        busy={convertingSlides}
        onConfirm={() => void convertSlides(pendingSlides)}
        onCancel={() => setPendingSlides(null)}
      >
        <p>
          {t('{files}를 이 PC 의 PowerPoint 로 PDF 로 바꿔 {place}에 넣습니다. 원본 PPT 는 그대로 둡니다. 형광펜·메모·검색은 PDF 처럼 쓸 수 있습니다. 한 파일에 몇 초 걸립니다.', {
            files: pendingSlides.paths.length === 1
              ? `「${pendingSlides.paths[0]!.split(/[\\/]/u).at(-1)}」`
              : t('PowerPoint {count}개', { count: pendingSlides.paths.length }),
            place: pendingSlides.folderPath === '' ? t('Vault 맨 위') : t('「{folder}」 폴더', { folder: pendingSlides.folderPath.split('/').at(-1) ?? '' }),
          })}
        </p>
      </ConfirmDialog>
    ) : null}
    {pendingExternalLink !== null ? (
      <ExternalLinkConfirm
        url={pendingExternalLink}
        onCancel={() => setPendingExternalLink(null)}
        onOpen={(url) => {
          setPendingExternalLink(null)
          void openExternalUrl(url).catch((cause: unknown) => window.alert(errorText(cause)))
        }}
      />
    ) : null}
    {aboutOpen ? <AboutDialog version={packageMetadata.version} onClose={() => setAboutOpen(false)} onShowHistory={() => { setAboutOpen(false); openUpdateHistory(packageMetadata.version) }} /> : null}
    <WhatsNewHost enabled={isMainWindow && !initializing} version={packageMetadata.version} onShowHistory={openUpdateHistory} />
    <PrefixKeyHost
      enabled={isMainWindow && !initializing && keysConfPrefix !== null && keysConfPrefix.root === (vault?.root ?? null) && !keysConfPrefix.sets}
      onChooseCustom={() => { setSettingsSection('input'); setSettingsOpen(true) }}
    />
    {reportOpen ? <ReportProblemDialog version={packageMetadata.version} vaultRoot={vault?.root ?? null} onClose={() => setReportOpen(false)} /> : null}
    {keysHelpOpen ? <KeysHelpSheet onClose={() => setKeysHelpOpen(false)} currentKeys={keysHelpCurrentKeys()} prefixText={prefixHint} /> : null}
    <TranslatorPanel />
    <PrefixChip phase={prefix.phase} prefixText={prefixHint} confirmText={confirmKindRef.current === 'quit' ? t('앱을 닫을까요? y/n') : t('화면을 닫을까요? y/n')} />
    {paneNumbersOpen ? <PaneNumbersOverlay panes={paneOrder} activePane={activePaneId} onDone={() => setPaneNumbersOpen(false)} /> : null}
    {paletteOpen ? <CommandPalette commands={paletteCommands()} completion={{ screenNames: screens.map((screen) => screen.name), sessionNames, templateNames: availableScreenTemplates(CANVAS_ENABLED).map((template) => template.label) }} initialQuery={paletteInitial} onRunLine={(line) => { void runWorkspaceLine(line) }} onClose={() => { setPaletteOpen(false); setPaletteInitial('') }} /> : null}
    {shortcutsOpen ? <ShortcutOverlay onClose={() => setShortcutsOpen(false)} onOpenSettings={() => { setSettingsSection('input'); setSettingsOpen(true) }} /> : null}
    <ThemeIntakeHost resolvedTheme={theme.resolvedTheme} />
    <SettingsModal
      open={settingsOpen}
      initialSectionId={settingsSection}
      onClose={() => {
        setSettingsOpen(false)
        setSettingsSection(undefined)
        setSettingsHistoryVersion(null)
      }}
      sections={[
        {
          id: 'appearance',
          label: t('화면 및 문서'),
          content: (
            <>
              <ThemeSettings
                preference={theme.preference}
                resolvedTheme={theme.resolvedTheme}
                onChange={theme.setPreference}
                palette={theme.palette}
                onPaletteChange={theme.setPalette}
                accent={theme.accent}
                onAccentChange={theme.setAccent}
                vaultRoot={vault?.root ?? null}
              />
              <LanguageSettings />
              <UiScaleSettings scale={uiScale.scale} onChange={uiScale.setScale} />
              <UsageMeterSettings />
              <MarkdownThemeSettings value={markdownTheme} onChange={(value) => void setMarkdownTheme(value)} />
            </>
          ),
        },
        { id: 'input', label: t('단축키·마우스'), content: <InputSettings /> },
        { id: 'search', label: t('검색·OCR'), content: <SearchSettings onRebuildIndex={vault === null ? undefined : rebuildSearchIndex} /> },
        { id: 'translation', label: t('번역'), content: <TranslationSettings state={translation} /> },
        {
          id: 'ai',
          label: t('외부 AI 연결'),
          content: (
            <AiSettings
              listModels={async (endpoint) => (await translationProvider.listModels(endpoint)).map((model) => model.name)}
              pullModel={async (endpoint, model, onProgress) => { await translationProvider.pullModel(endpoint, model, onProgress ?? (() => undefined)) }}
            />
          ),
        },
        {
          id: 'default-app',
          label: t('기본 PDF 앱'),
          content: (
            <section className="default-app-settings" aria-label={t('기본 PDF 앱')}>
              {isMacPlatform() ? (
                <p>
                  {pick({
                    ko: <>Finder 에서 PDF 하나를 고르고 <b>정보 가져오기</b>(⌘I)를 연 뒤, <b>다음으로 열기</b>에서 IWAE 를 고르고 <b>모두 변경…</b>을 누르면
                      모든 PDF 가 IWAE 로 열립니다.</>,
                    en: <>In Finder, select a PDF and choose <b>Get Info</b> (⌘I). Under <b>Open with</b>, pick IWAE and click <b>Change All…</b> to open every PDF with IWAE.</>,
                  })}
                </p>
              ) : (
              <p>
                {pick({
                  ko: <>IWAE 를 설치하면 PDF 를 여는 앱 목록에 IWAE 가 들어갑니다. Windows 는 앱이 스스로 기본 앱을 바꾸지 못하게 하므로,
                    아래 단추로 「기본 앱」 설정을 열어 <b>.pdf</b> 의 기본 앱을 IWAE 로 골라 주세요.</>,
                  en: <>Installing IWAE adds it to the list of apps that can open PDFs. Windows does not let apps change the default app themselves,
                    so use the button below to open Default apps and choose IWAE for <b>.pdf</b>.</>,
                })}
              </p>
              )}
              <p>{isMacPlatform()
                ? t('Finder 에서 연 PDF 는 Vault 로 가져오지 않고 열리며, 왼쪽 바 아래 「최근 연 PDF」에 남습니다. 끌어서 Vault 폴더에 놓으면 그 폴더로 가져옵니다.')
                : t('탐색기에서 연 PDF 는 Vault 로 가져오지 않고 열리며, 왼쪽 바 아래 「최근 연 PDF」에 남습니다. 끌어서 Vault 폴더에 놓으면 그 폴더로 가져옵니다.')}</p>
              {isMacPlatform() ? null : (
                <button type="button" onClick={() => void openDefaultAppsSettings().catch((cause: unknown) => window.alert(errorText(cause)))}>
                  {t('Windows 기본 앱 설정 열기')}
                </button>
              )}
            </section>
          ),
        },
        {
          id: 'updates',
          label: t('업데이트'),
          content: <UpdateSettings currentVersion={packageMetadata.version} state={updater} historyFocusVersion={settingsHistoryVersion} />,
        },
        {
          id: 'data',
          label: t('데이터 및 복구'),
          content: vault === null
            ? <p className="settings-empty-copy">{t('Vault를 열면 백업과 복구 기록을 확인할 수 있습니다.')}</p>
            : (
              <>
                <AutoBackupSettings
                  settings={autoBackup.settings}
                  running={autoBackup.running}
                  onChange={autoBackup.update}
                  onRunNow={() => void autoBackup.runNow()}
                />
                <VaultBackupSettings
                  vault={vault}
                  onOpenVault={(root) => {
                    setSettingsOpen(false)
                    openRecentVaultSafely(root)
                  }}
                />
                <VaultRecoveryDialog vault={vault} />
              </>
            ),
        },
      ]}
    />
    </TopBarToolbarContext.Provider>
    </TranslatorContext.Provider>
    </TranslationCardSettingsContext.Provider>
    </WorkspaceContext.Provider>
    </MemoNoteContext.Provider>
  )
}
