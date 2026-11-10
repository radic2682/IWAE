import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { translateWithCacheUsing, useTranslationCacheBridge } from './translationCacheStore'
import { clearUndo, redo as redoChange, undo as undoChange } from './undoStack'
import { CommandPalette, type PaletteCommand } from './CommandPalette'
import { InputSettings, SearchSettings } from './BehaviorSettings'
import { APP_COMMAND_EVENT } from '../ui/documentContextMenu'
import { CANVAS_ENABLED, SPLIT_PANES_ENABLED } from '../core/features'
import { onOpenFiles, openDefaultAppsSettings, takeOpenFiles } from '../bridge/openFiles'
import { dropZoneAt, type DropZone, type TreeDropPlace } from './dropZone'
import { X } from '@phosphor-icons/react'
import { updatePersistentPdfHighlight } from '../pdf/persistentHighlight'
import { SplitPanes, type FocusedPane } from './SplitPanes'
import { ActionToast } from './ActionToast'
import { registerLiveCanvas } from './liveCanvasRegistry'
import { useMcpCanvasBridge } from './useMcpCanvasBridge'
import { announceAction } from './actionFeedback'
import { exportPdfImages, isPasswordProtectedDoc, pageTextIndex, pdfBlankPages, pdfOutline, setPdfPasswordPrompt, type SearchablePdfPage } from '../bridge/pdf'
import { PdfToolsDialog, type PdfToolId } from './PdfToolsDialog'
import { PdfPasswordDialog } from './PdfPasswordDialog'
import { buildFlattenOp, countMarks } from '../core/pdfToolOps'
import { diffLines, pageLines } from '../core/pdfTextDiff'
import { getPdfToolJob, setPdfToolJob } from '../pdf/pdfToolJobs'
import { setOverlayTool } from '../pdf/overlayToolStore'
import { recognizePdfPageLines } from '../pdf/pdfOcrText'
import { detectPageRotation } from '../pdf/pdfPageOrientation'
import type { PageTextIndex } from '../core/textIndex'
import type { PersistentPdfHighlight } from '../pdf/persistentHighlight'
import { setMemoBarVisible, useMemoBarVisible } from '../pdf/memoStore'
import { MemoNoteContext, requestTitleEdit, type MemoNoteApi } from '../pdf/memoNoteContext'
import { useMemoNotes } from './useMemoNotes'
import { useMouseGestures } from './useMouseGestures'
import { useSmoothWheel } from './useSmoothWheel'
import { memoFolderIconKey, memoNoteIconKey } from './MemoNotesSection'
import { memoNoteAbsolutePath, revealMemoNote } from '../bridge/memoNotes'
import { copyFileToClipboard, revealInFolder } from '../bridge/vaultBackup'
import { docNoteTitle, memoNoteOwner, orderMemoNoteEntries } from '../core/memoNote'
import { useMcpMemoBridge } from './useMcpMemoBridge'
import type { MemoCategorySummary } from './Sidebar'
import { Sidebar, SidebarFooter } from './Sidebar'
import { PaneShell } from './PaneShell'
import { DocumentView, type DocumentViewController, type DocumentViewState } from './DocumentView'
import { DocumentSearchPanel, useDocumentSearch } from './DocumentSearchPanel'
import { PageEditDialog } from './PageEditDialog'
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
import { closeSplitCell, isPdfSplitLayoutId, pdfSplitLayout, type PdfSplitLayoutId } from '../core/pdfSplit'
import { TopBar, type SidebarMode } from './TopBar'
import { OutlinePreviewPanel, OutlinePanel, ThumbnailPanel } from './SidePanels'
import { MarkdownOutline, MarkdownOutlinePreview, MarkdownSectionPreview } from './MarkdownOutline'
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
  PANE_IDS,
  allPaneTabs,
  mergeHiddenPanes,
  visiblePanes,
  paneLabel,
  type PaneCount,
  type TabsState,
  tabDocId,
  type PaneId,
  type Tab,
} from './tabs'
import type { LibraryDoc, NotebookGroup, VaultMarkdownNode, VaultTreeNode } from '../core/vaultTree'
import type { LibraryOpenTarget } from '../core/libraryItems'
import type { Anchor } from '../core/anchor'
import type { PdfExcerptSelection, SourceJumpRequest } from '../core/pdfExcerpt'
import { OPEN_TRANSLATION_SETTINGS_EVENT, type PdfSelectionTranslation } from '../pdf/SelectionActions'
import { TranslationCardSettingsContext, type TranslationCardSettings } from '../ui/TranslationCard'
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
import { toBibtex } from '../core/bibliography'
import { readPdfViewPrefs, writePdfViewPrefs, type PdfRotation, type PdfViewPrefs } from '../core/pdfViewPrefs'
import { openExternalUrl } from '../bridge/external'
import { aiSetVault, listenAiLocation, ragIndex, type AiLocation } from '../bridge/ai'
import { AiLocationInbox } from './AiLocationInbox'
import { AiSettings } from './AiSettings'
import { buildAnchor } from '../core/anchor'
import { errorText } from '../core/errorText'
import { UpdateSettings } from './UpdateSettings'
import { useUpdater } from './useUpdater'
import packageMetadata from '../../package.json'
import developmentMarkdown from '../fixtures/development-note.md?raw'
import { createDevelopmentCanvasDocument } from '../fixtures/developmentCanvasDocument'
import { createOllamaTranslationProvider } from '../bridge/translation'
import { runAfterCanvasFlush } from './canvasClose'
import { buildEvidenceHtml, createCanvasRasterizer, saveHtmlFile } from './exportEvidence'
import { closeWindow, interceptWindowClose, isDesktop } from '../bridge/window'
import { closeSecondaryWindows, focusThisWindow, onCloseNow, onReattach, openAppWindow, sendReattach } from '../bridge/windows'
import { currentWindowMode, windowQuery } from '../core/windowMode'
import { queueInitialZoom } from './pendingViewState'
import { hasPendingVaultRecovery } from '../bridge/vaultRecovery'
import { listenForDocumentDrop } from '../bridge/fileDrop'
import {
  SAMPLE_DOC_ID,
  SAMPLE_HAS_TEXT,
  SAMPLE_PAGE_COUNT,
  SAMPLE_TITLE,
  samplePageSizes,
} from '../pdf/samplePage'
import { pick, t } from '../i18n'

const PDF_EMPTY = '사이드바에서 PDF 문서를 여세요'
const NOTE_EMPTY = '사이드바에서 노트를 여세요'
/** 나눈 창의 빈 칸. 탭을 끌어 오거나 사이드바에서 문서를 열면 된다 */
const SPLIT_PANE_EMPTY = '탭을 여기로 끌어 오거나 사이드바에서 문서를 여세요'
/** 좌우로만 나누는 배치(탭이 상단바에 놓인다) */
const COLUMN_LAYOUTS: ReadonlySet<string> = new Set(['single', 'cols2', 'cols3'])

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
  kind: 'note',
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
  // 창의 역할: 메인 · 떼어 낸 창(PDF 하나 + 노트 바) · 새 창. 같은 화면을 쓰고 몇 가지만 다르다
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
  const vaultState = useVault({
    onImportedFrom: (docId, path) => recordImportedSourceRef.current(docId, path),
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
    pdfTabs,
    setPdfTabs,
    panes,
    setPanes,
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
      (paths, point) => routeDropRef.current(paths, dropZoneAt(point)),
      (active, point) => {
        const zone = active ? dropZoneAt(point) : null
        setDocumentDropActive(zone?.kind === 'vault')
        setDocumentDropFolder(zone?.kind === 'vault' ? zone.folderPath : null)
        const place = zone?.kind === 'vault' ? zone.place ?? null : null
        setDocumentDropPlace((current) => current?.nodeId === place?.nodeId && current?.position === place?.position ? current : place)
        setReaderDropActive(zone?.kind === 'reader')
      },
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
        for (const path of paths) await openExternalPdfRef.current(path)
      })
      .catch(() => undefined)
  }, [vault])
  useEffect(() => {
    if (!isMainWindow) return undefined
    let disposed = false
    let unlisten: () => void = () => undefined
    void onOpenFiles((paths) => {
      void (async () => {
        for (const path of paths) await openExternalPdfRef.current(path)
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
  const [aboutOpen, setAboutOpen] = useState(false)
  // 저절로 열 때 먼저 보일 설정 항목. 사용자가 열면 지난번 항목 그대로
  const [settingsSection, setSettingsSection] = useState<string | undefined>(undefined)
  const [draftPdfHighlight, setDraftPdfHighlight] = useState<Anchor | null>(null)
  const draftPdfHighlightRef = useRef(draftPdfHighlight)
  draftPdfHighlightRef.current = draftPdfHighlight
  const [focusedPane, setFocusedPane] = useState<FocusedPane>('split')
  const [libraryExpanded, setLibraryExpanded] = useState(false)
  // 쪽 편집 중인 PDF. 저장하면 열린 노트 캔버스를 새로 읽게 canvasEpoch 를 올린다.
  const [pageEditDocId, setPageEditDocId] = useState<string | null>(null)
  const [canvasEpoch, setCanvasEpoch] = useState(0)
  // 문서 검색 화면. 왼쪽 패널 자리에 검색 결과, 오른쪽 패널에 원본 PDF 를 띄운다.
  const [docSearchMode, setDocSearchMode] = useState(false)
  // 창 나누기 배치(PDF 안 화면 나누기와 같은 9가지). 처음엔 한 화면이고 다음 실행에도 기억한다.
  // 예전 값(단 수 1·2·3)이 있으면 좌우 배치로 옮긴다
  const [paneLayoutId, setPaneLayoutIdState] = useState<PdfSplitLayoutId>(() => {
    if (!SPLIT_PANES_ENABLED || isDetachedWindow) return 'single'
    try {
      const saved = window.localStorage.getItem('iwae:pane-layout:v1')
      if (isPdfSplitLayoutId(saved)) return saved
      const count = window.localStorage.getItem('iwae:pane-count:v1')
      if (count === '2') return 'cols2'
      if (count === '3') return 'cols3'
      if (count === null && window.localStorage.getItem('iwae:single-pane:v2') === '0') return 'cols2'
    } catch { /* 기본값 */ }
    return 'single'
  })
  const paneCount = pdfSplitLayout(paneLayoutId).cells.length as PaneCount
  const singlePane = paneCount === 1
  const documentSearch = useDocumentSearch()
  const [pendingExternalLink, setPendingExternalLink] = useState<string | null>(null)
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
    const pane = PANE_IDS.find((id) => panes[id].tabs.some((tab) => tab.id === tabId))
    const oldTab = pane === undefined ? undefined : panes[pane].tabs.find((tab) => tab.id === tabId)
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
    const pane = PANE_IDS.find((id) => panes[id].tabs.some((tab) => tab.id === tabId))
    if (doc === undefined || pane === undefined) return
    const oldTab = panes[pane].tabs.find((tab) => tab.id === tabId)
    const oldDocId = oldTab === undefined ? null : tabDocId(oldTab)
    const fromPage = docControllersRef.current[pane]?.docId === oldDocId ? docViews[pane]?.page ?? null : null
    const meta = await openAnyDocument(doc, false)
    if (fromPage !== null && oldDocId !== null && meta !== null && meta !== undefined) {
      const [fromOutline, toOutline] = await Promise.all([pdfOutline(oldDocId).catch(() => []), pdfOutline(docId).catch(() => [])])
      pendingDocPageRef.current = { docId, page: matchVersionPage(fromOutline, fromPage - 1, toOutline, meta.pageCount) + 1 }
    }
    const target: PaneId = pane === 'left' ? 'right' : 'left'
    const needed = (PANE_IDS.indexOf(target) + 1) as PaneCount
    if (needed > paneCount) setPaneCount(needed)
    const existing = PANE_IDS.find((id) => panes[id].tabs.some((tab) => tab.id === docId))
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
      if (!open) setFocusedPane('split')
      return !open
    })
  }, [])
  const toggleFocus = useCallback((pane: Exclude<FocusedPane, 'split'>) => {
    setLibraryExpanded(false)
    setFocusedPane((current) => current === pane ? 'split' : pane)
  }, [])
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
  const translateForCache = useCallback(async (text: string, targetLanguage?: string) => {
    const result = await translateText(text, undefined, targetLanguage)
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
  useEffect(() => {
    let unlisten: (() => void) | undefined
    void interceptWindowClose(
      async () => {
        // 노트·메모 저장을 끝낸다. 이 창이 쓴 것은 파일에 있으니 다른 창이 이어서 쓴다
        await flushCanvasSaves()
        if (isMainWindow) {
          // 메인이 닫히면 떼어 낸 창·새 창도 저장하고 함께 닫는다(세션은 메인만 저장하므로 메인이 끝까지 남는다).
          // 떼어 낸 창은 닫히면서 탭을 메인으로 돌려보낸다 — 그 탭이 다음 실행에 되살아나게 잠시 뒤 세션을 다시 저장한다
          if (await closeSecondaryWindows() > 0) {
            await new Promise((resolve) => window.setTimeout(resolve, 400))
            await flushSessionRef.current()
          }
        } else if (isDetachedWindow) {
          await sendTabsBackRef.current()
        }
        // 번역용 로컬 모델(Ollama)도 메모리에서 내린다
        await releaseTranslationModelRef.current()
      },
      (cause) => window.alert(t('노트를 저장하지 못해 앱을 종료하지 않았습니다: {error}', { error: cause instanceof Error ? cause.message : String(cause) })),
    ).then((stop) => { unlisten = stop })
    return () => unlisten?.()
  }, [])
  useEffect(() => {
    if (isMainWindow) return undefined
    let disposed = false
    let stop: (() => void) | undefined
    void onCloseNow(() => closeWindow()).then((unlisten) => {
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
      if (note !== undefined) openInPane({ id: note.path, title: note.title, kind: 'note' })
    }
  }, [openDocument, openInPane, openMarkdown, shownLibrary, shownNotebooks])
  /** 라이브러리에서 연 항목은 해당 패널에 탭으로 열고, 그 패널이 보이도록 라이브러리를 접는다 */
  const openLibraryItem = useCallback((target: LibraryOpenTarget) => {
    if (target.kind === 'pdf') void openDocument(target.doc)
    else if (target.kind === 'markdown') void openMarkdown(target.node)
    else if (CANVAS_ENABLED) openInPane({ id: target.note.path, title: target.note.title, kind: 'note' })
    setLibraryExpanded(false)
  }, [openDocument, openInPane, openMarkdown])
  const toggleDocSearchMode = useCallback(() => {
    setDocSearchMode((open) => {
      if (!open) {
        setLibraryExpanded(false)
        setFocusedPane('split')
      }
      return !open
    })
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
      window.setTimeout(() => window.dispatchEvent(new CustomEvent('iwae:pdf-search', { detail: { query } })), 30)
    },
    navBack: () => navigationBackRef.current(),
    navForward: () => navigationForwardRef.current(),
    toggleLibrary: isDetachedWindow ? undefined : toggleLibrary,
    escape: libraryExpanded ? () => setLibraryExpanded(false) : docSearchMode ? () => setDocSearchMode(false) : undefined,
    documentSearch: toggleDocSearchMode,
    nextTab: () => paneShortcutsRef.current.cycleTab(1),
    prevTab: () => paneShortcutsRef.current.cycleTab(-1),
    closeTab: () => paneShortcutsRef.current.closeActiveTab(),
    focusLeftPane: () => paneShortcutsRef.current.focus('left'),
    focusRightPane: () => { if (SPLIT_PANES_ENABLED) paneShortcutsRef.current.focus('right') },
    goTo: () => window.dispatchEvent(new CustomEvent('iwae:goto')),
    print: () => window.dispatchEvent(new CustomEvent('iwae:print')),
    openSettings: () => { setSettingsSection(undefined); setSettingsOpen(true) },
    toggleSinglePane: () => { if (SPLIT_PANES_ENABLED) toggleSinglePaneRef.current() },
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
    commandPalette: () => setPaletteOpen((open) => !open),
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
      if (name === 'pdfTools' && detail?.docId !== undefined) setPdfToolsTarget({ docId: detail.docId, ...(detail.tool === undefined ? {} : { tool: detail.tool as PdfToolId }) })
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
    const open = (tool: PdfToolId) => () => setPdfToolsTarget({ docId, tool })
    const meta = openedDocs.find((doc) => doc.docId === docId)
    return [
      { id: 'pdf-tools', kind: 'action', label: t('PDF 도구…'), keywords: 'pdf tools stirling', run: open(meta?.hasText === false ? 'ocr' : 'flatten') },
      { id: 'pdf-ocr', kind: 'action', label: t('PDF: OCR 로 글자 입히기'), keywords: 'ocr scan text recognize', run: () => { void ocrDocumentRef.current(docId).catch((cause: unknown) => announceAction(errorText(cause))) } },
      { id: 'pdf-flatten', kind: 'action', label: t('PDF: 표시 넣은 사본'), keywords: 'flatten annotate export share', run: open('flatten') },
      { id: 'pdf-redact', kind: 'action', label: t('PDF: 가린 사본'), keywords: 'redact hide privacy', run: open('redact') },
      { id: 'pdf-compare', kind: 'action', label: t('PDF: 다른 판과 글자 비교'), keywords: 'compare diff version', run: open('compare') },
      { id: 'pdf-extract', kind: 'action', label: t('PDF: 쪽 뽑아 새 PDF'), keywords: 'extract split pages', run: open('extract') },
      { id: 'pdf-split', kind: 'action', label: t('PDF: 목차 단위로 나누기'), keywords: 'split chapters', run: open('split') },
      { id: 'pdf-merge', kind: 'action', label: t('PDF: 다른 PDF 와 합치기'), keywords: 'merge combine', run: open('merge') },
      { id: 'pdf-blanks', kind: 'action', label: t('PDF: 빈 쪽 빼기'), keywords: 'blank remove pages', run: open('blanks') },
      { id: 'pdf-orient', kind: 'action', label: t('PDF: 스캔 쪽 방향 바로잡기'), keywords: 'orientation rotate scan upside down sideways', run: open('orient') },
      { id: 'pdf-compress', kind: 'action', label: t('PDF: 압축'), keywords: 'compress shrink size images', run: open('compress') },
      { id: 'pdf-numbers', kind: 'action', label: t('PDF: 쪽 번호 넣기'), keywords: 'page numbers', run: open('numbers') },
      { id: 'pdf-watermark', kind: 'action', label: t('PDF: 워터마크'), keywords: 'watermark stamp', run: open('watermark') },
      { id: 'pdf-crop', kind: 'action', label: t('PDF: 여백 자르기'), keywords: 'crop margins', run: open('crop') },
      { id: 'pdf-nup', kind: 'action', label: t('PDF: 모아찍기'), keywords: 'n-up layout print', run: open('nup') },
      { id: 'pdf-images', kind: 'action', label: t('PDF: 쪽 그림(PNG)으로 내보내기'), keywords: 'images png export', run: open('images') },
      { id: 'pdf-markdown', kind: 'action', label: t('PDF: 글을 Markdown 으로'), keywords: 'markdown text export', run: open('markdown') },
    ]
  }
  /** 명령 팔레트(Ctrl+Shift+P)에 보일 동작과 문서 */
  const paletteCommands = (): PaletteCommand[] => {
    const act = (name: keyof AppShortcutActions) => () => shortcutActionsRef.current[name]?.()
    const actions: PaletteCommand[] = [
      { id: 'new-window', kind: 'action', label: t('새 창'), shortcut: 'Ctrl+Shift+N', keywords: 'new window', run: act('newWindow') },
      ...(isDetachedWindow
        ? [{ id: 'reattach', kind: 'action' as const, label: t('다시 붙이기'), keywords: 'reattach attach back window main', run: () => windowActionsRef.current.reattach() }]
        : activeDocumentTab?.kind === 'pdf'
          ? [{ id: 'detach', kind: 'action' as const, label: t('창으로 떼어 내기'), keywords: 'detach window pop out separate', run: () => windowActionsRef.current.detachActive() }]
          : []),
      { id: 'settings', kind: 'action', label: t('설정 열기'), shortcut: 'Ctrl+,', keywords: 'settings preferences', run: act('openSettings') },
      { id: 'translation-settings', kind: 'action', label: t('번역 설정 열기'), keywords: 'translation translate', run: () => { setSettingsSection('translation'); setSettingsOpen(true) } },
      { id: 'doc-search', kind: 'action', label: t('모든 문서에서 찾기'), shortcut: 'Ctrl+Shift+F', keywords: 'search vault find', run: act('documentSearch') },
      { id: 'find', kind: 'action', label: t('이 문서에서 찾기'), shortcut: 'Ctrl+F', keywords: 'find search', run: act('search') },
      { id: 'goto', kind: 'action', label: t('쪽으로 가기'), shortcut: 'Ctrl+G', keywords: 'go to page', run: act('goTo') },
      ...(isDetachedWindow ? [] : [
        { id: 'library', kind: 'action' as const, label: t('라이브러리 펼치기·접기'), shortcut: 'Ctrl+Shift+L', keywords: 'library', run: act('toggleLibrary') },
        { id: 'sidebar', kind: 'action' as const, label: t('왼쪽 바 접기·펴기'), keywords: 'sidebar', run: () => setSidebarCollapsed((value) => !value) },
      ]),
      { id: 'new-note', kind: 'action', label: t('새 노트 만들기'), keywords: 'new note', run: () => { void memoNotes.create() } },
      { id: 'undo', kind: 'action', label: t('되돌리기'), shortcut: 'Ctrl+Z', keywords: 'undo', run: act('undo') },
      { id: 'redo', kind: 'action', label: t('다시 하기'), shortcut: 'Ctrl+Shift+Z', keywords: 'redo', run: act('redo') },
      { id: 'next-tab', kind: 'action', label: t('다음 탭'), shortcut: 'Ctrl+Tab', keywords: 'next tab', run: act('nextTab') },
      { id: 'prev-tab', kind: 'action', label: t('이전 탭'), shortcut: 'Ctrl+Shift+Tab', keywords: 'previous tab', run: act('prevTab') },
      { id: 'close-tab', kind: 'action', label: t('탭 닫기'), shortcut: 'Ctrl+W', keywords: 'close tab', run: act('closeTab') },
      { id: 'back', kind: 'action', label: t('뒤로 (문서 점프)'), shortcut: 'Alt+←', keywords: 'back', run: act('navBack') },
      { id: 'forward', kind: 'action', label: t('앞으로 (문서 점프)'), shortcut: 'Alt+→', keywords: 'forward', run: act('navForward') },
      { id: 'print', kind: 'action', label: t('인쇄'), shortcut: 'Ctrl+P', keywords: 'print', run: act('print') },
      { id: 'theme', kind: 'action', label: theme.resolvedTheme === 'dark' ? t('밝은 화면으로') : t('어두운 화면으로'), keywords: 'theme dark light', run: () => theme.setPreference(theme.resolvedTheme === 'dark' ? 'light' : 'dark') },
      ...(SPLIT_PANES_ENABLED ? [{ id: 'split', kind: 'action' as const, label: t('화면 나누기 바꾸기'), shortcut: 'Ctrl+\\', keywords: 'split pane', run: act('toggleSinglePane') }] : []),
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
    focus: (_pane: PaneId) => undefined as void,
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
  // MCP memo_* 도구(Claude 가 PDF 에 형광펜 메모를 만들고 고친다)
  const markdownHighlightStorage = useMemo(
    () => vault === null
      ? createBrowserMarkdownHighlightStorage()
      : createVaultMarkdownHighlightStorage(vault),
    [vault],
  )
  const markdownHighlights = useMarkdownHighlights(markdownHighlightStorage)
  const pdfBookmarkStorage = useMemo(
    () => vault === null
      ? createBrowserPdfBookmarkStorage()
      : createVaultPdfBookmarkStorage(vault),
    [vault],
  )
  const pdfBookmarks = usePdfBookmarks(pdfBookmarkStorage)
  // 마지막으로 만진 패널. 사이드바 목차·축소판·주석과 Ctrl+F 가 이 패널의 문서를 따른다.
  const [activePaneId, setActivePaneId] = useState<PaneId>('left')
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
  const isDocTab = (tab: Tab | null) => tab !== null && tab.kind !== 'note'
  // 문서 기능(목차·검색·쪽 이동)이 향할 패널: 만진 패널이 문서면 그쪽, 아니면 반대편 문서.
  const docPaneId: PaneId | null = isDocTab(activeTab(panes[activePaneId]))
    ? activePaneId
    : isDocTab(activeTab(panes[otherPane(activePaneId)])) ? otherPane(activePaneId) : null
  // 발췌를 받을 캔버스: 만진 패널이 캔버스면 그쪽, 아니면 반대편 캔버스.
  const notePaneId: PaneId | null = activeTab(panes[activePaneId])?.kind === 'note'
    ? activePaneId
    : activeTab(panes[otherPane(activePaneId)])?.kind === 'note' ? otherPane(activePaneId) : null
  const activeDocumentTab = docPaneId === null ? null : activeTab(panes[docPaneId])
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
  const activeNoteId = notePaneId === null ? null : activeTab(panes[notePaneId])?.id ?? null
  const currentPdfPage = docPaneId === null ? 1 : docViews[docPaneId]?.page ?? 1
  paneShortcutsRef.current = {
    cycleTab: (step) => {
      const state = panes[activePaneId]
      if (state.tabs.length < 2) return
      const index = state.tabs.findIndex((tab) => tab.id === state.activeId)
      const next = state.tabs[(index + step + state.tabs.length) % state.tabs.length]
      if (next !== undefined) setPanes((current) => ({ ...current, [activePaneId]: activateTab(current[activePaneId], next.id) }))
    },
    closeActiveTab: () => {
      const id = panes[activePaneId].activeId
      if (id === null) return
      const tab = panes[activePaneId].tabs.find((candidate) => candidate.id === id)
      if (tab?.kind === 'note') closeNoteTabSafely(id)
      else setPanes((current) => closeTabEverywhere(current, id))
    },
    focus: (pane) => setActivePaneId(pane),
  }
  /**
   * 단 수를 바꾼다(1·2·3단). 줄이면 숨는 패널의 탭은 남는 맨 끝 패널로 합쳐지고(아래 효과), 늘리면 새 패널은 빈 채로
   * 시작한다 — 탭을 끌거나 탭 메뉴 「… 패널로 옮기기」로 채운다.
   */
  const setPaneLayout = (next: PdfSplitLayoutId) => {
    setPaneLayoutIdState(next)
    // 나눔 배치는 다음 실행에 메인 창이 되살린다. 다른 창의 배치로 바꾸지 않는다
    if (isMainWindow) {
      try { window.localStorage.setItem('iwae:pane-layout:v1', next) } catch { /* 이번 실행에만 */ }
    }
    if (next === 'single') setFocusedPane('split')
  }
  /** 패널 수만 정할 때(탭을 새 패널로 옮기기 등): 1 한 화면, 2 좌우 둘, 3 좌우 셋, 4 넷 */
  const setPaneCount = (next: PaneCount) => setPaneLayout(next === 1 ? 'single' : next === 2 ? 'cols2' : next === 3 ? 'cols3' : 'grid4')
  // Ctrl+\ : 한 화면 → 좌우 둘 → 좌우 셋 → 한 화면
  const toggleSinglePaneRef = useRef(() => setPaneCount(paneCount >= 3 ? 1 : (paneCount + 1) as PaneCount))
  toggleSinglePaneRef.current = () => setPaneCount(paneCount >= 3 ? 1 : (paneCount + 1) as PaneCount)
  // 문서 검색 화면은 오른쪽(2번) 패널을 잠깐 빌려 쓴다(그동안은 좌우 둘)
  const shownLayoutId: PdfSplitLayoutId = docSearchMode && (paneCount < 2 || !COLUMN_LAYOUTS.has(paneLayoutId)) ? 'cols2' : paneLayoutId
  const shownPaneCount = pdfSplitLayout(shownLayoutId).cells.length as PaneCount
  // 위아래·2×2 같은 격자 배치: 패널마다 바로 위에 탭 줄을 둔다(좌우 배치는 상단바에 탭)
  const gridLayout = !COLUMN_LAYOUTS.has(shownLayoutId) && focusedPane === 'split' ? pdfSplitLayout(shownLayoutId) : null
  // 보이지 않는 패널에 탭이 남으면(단 수를 줄임, 지난 세션 복원, 문서 검색을 닫은 뒤) 남는 맨 끝 패널로 합친다
  const hiddenTabCount = PANE_IDS.filter((pane) => !visiblePanes(shownPaneCount).includes(pane))
    .reduce((sum, pane) => sum + panes[pane].tabs.length, 0)
  useEffect(() => {
    const shown = visiblePanes(shownPaneCount)
    if (hiddenTabCount === 0) {
      if (!shown.includes(activePaneId)) setActivePaneId(shown[shown.length - 1]!)
      return
    }
    setPanes((current) => mergeHiddenPanes(current, shownPaneCount, activePaneId))
    const target = shown[shown.length - 1]!
    if (!shown.includes(activePaneId)) setActivePaneId(target)
    for (const kind of ['doc', 'note'] as const) {
      if (!shown.includes(paneRouteRef.current[kind])) setPaneRoute(kind, target)
    }
  }, [shownPaneCount, hiddenTabCount, activePaneId, setPanes, setPaneRoute, paneRouteRef])
  const focusPane = useCallback((pane: PaneId) => {
    setActivePaneId(pane)
    const tab = activeTab(panes[pane])
    if (tab !== null) setPaneRoute(tab.kind === 'note' ? 'note' : 'doc', pane)
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

  // 문서 검색이 새로 연 PDF 탭. 다른 결과로 넘어가면 이 탭을 닫아 탭이 쌓이지 않게 한다
  // (미리보기 탭). 사용자가 원래 열어 둔 탭은 건드리지 않는다.
  const searchPreviewDocRef = useRef<string | null>(null)
  // 문서 검색을 닫으면 마지막 미리보기 탭은 사용자 탭이 된다. 다음 검색에서 닫지 않는다.
  useEffect(() => {
    if (!docSearchMode) searchPreviewDocRef.current = null
  }, [docSearchMode])
  /**
   * 검색 화면에서 고른 자리를 오른쪽 패널에 연다: 그 PDF 를 그 쪽으로 열고 anchor 자리를 칠한다.
   * 검색이 새로 연 탭은 미리보기 탭이라 다른 결과로 넘어가면 닫힌다.
   */
  const showInRightPane = useCallback((record: { id: string; displayName: string }, page: number, anchor: Anchor | null) => {
    const docId = record.id
    setDraftPdfHighlight(anchor)
    setActivePaneId('right')
    setPaneRoute('doc', 'right')
    if (docControllersRef.current.right?.docId === docId) {
      docControllersRef.current.right.requestPage(page)
      return
    }
    pendingDocPageRef.current = { docId, page }
    const alreadyOpen = allPaneTabs(panes).some((tab) => tabDocId(tab) === docId)
    const previous = searchPreviewDocRef.current
    if (!alreadyOpen) {
      if (previous !== null && previous !== docId) setPanes((current) => closeTabEverywhere(current, previous))
      searchPreviewDocRef.current = docId
    }
    if (panes.left.tabs.some((tab) => tab.id === docId)) moveTab(docId, 'right')
    const opened = openedDocs.find((doc) => doc.docId === docId)
    if (opened !== undefined) {
      openInPane({ id: docId, title: record.displayName || opened.title, kind: 'pdf' }, 'right')
      return
    }
    const libraryDoc = shownLibrary.find((doc) => doc.docId === docId)
    if (libraryDoc === undefined) {
      pendingDocPageRef.current = null
      announceAction(t('Vault 에서 이 PDF 를 열 수 없습니다: {name}', { name: record.displayName }))
      return
    }
    void openDocument(libraryDoc)
  }, [moveTab, openDocument, openInPane, openedDocs, panes.left.tabs, panes.right.tabs, setPanes, setPaneRoute, shownLibrary])

  /** 문서 검색 결과: 그 쪽을 열고 검색어가 처음 나오는 자리를 칠한다 */
  const openVaultHit = useCallback(async (hit: VaultSearchHit) => {
    if (hit.page === null) return
    const pageIndex = hit.page
    showInRightPane(hit.record, pageIndex + 1, null)
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
  }, [showInRightPane])

  const requestPdfPage = useCallback((page: number) => {
    if (docPaneId !== null) docControllersRef.current[docPaneId]?.requestPage(page)
  }, [docPaneId])

  /** 문서·쪽으로 간다. 어느 패널에 보이면 그 패널에서, 아니면 탭을 열고 쪽은 맡겨 둔다. */
  const navigateToPdfLocation = useCallback((location: NavLocation) => {
    // 같은 PDF 가 양쪽에 열려 있으면 지금 만지는 패널이 먼저다
    const showing = [activePaneId, otherPane(activePaneId)].find((pane) => docControllersRef.current[pane]?.docId === location.docId)
    if (showing !== undefined) {
      docControllersRef.current[showing]?.requestPage(location.page)
      setActivePaneId(showing)
      return
    }
    pendingDocPageRef.current = location
    const placed = PANE_IDS.find((pane) => panes[pane].tabs.some((tab) => tabDocId(tab) === location.docId))
    setActivePaneId(placed ?? paneRouteRef.current.doc)
    const opened = openedDocs.find((doc) => doc.docId === location.docId)
    if (opened !== undefined) {
      openInPane({ id: opened.docId, title: opened.title, kind: 'pdf' })
      return
    }
    const libraryDoc = shownLibrary.find((doc) => doc.docId === location.docId)
    if (libraryDoc !== undefined) void openDocument(libraryDoc)
    else pendingDocPageRef.current = null
  }, [activePaneId, openDocument, openInPane, openedDocs, paneRouteRef, panes, shownLibrary])

  const navigation = useNavigationHistory({
    current: () => activePdfDoc === null ? null : { docId: activePdfDoc.docId, page: currentPdfPage },
    navigate: navigateToPdfLocation,
    exists: (location) => openedDocs.some((doc) => doc.docId === location.docId)
      || shownLibrary.some((doc) => doc.docId === location.docId),
  })
  // 왼쪽 바 「PDF 검색」 보기의 칸. 지금 문서의 검색 칸·결과가 여기에 붙는다
  const memoBarVisible = useMemoBarVisible()
  const [pdfSearchSlot, setPdfSearchSlot] = useState<HTMLElement | null>(null)
  // 메모 노트: 오른쪽 바에 PDF 와 따로 여는 노트(여러 PDF 의 메모 + 글 블록). 처음 한 번 예전 카테고리를 노트로 옮긴다
  const memoNoteDocTitle = useCallback((docId: string) => docTitles[docId] ?? '', [docTitles])
  const memoNotes = useMemoNotes(vault, pdfHighlights.highlights, memoNoteDocTitle, announceAction)
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
  const createNoteForDoc = useCallback(async (docId: string) => {
    const owner = noteDocOwner(docId) ?? docId
    const title = docNoteTitle(noteDocLabel(owner), memoNotes.entries.map((entry) => entry.title))
    const path = await memoNotes.createIn('', title, owner)
    if (path !== null) {
      setMemoBarVisible(true)
      requestTitleEdit(path)
    }
    return path
  }, [memoNotes, noteDocLabel, noteDocOwner])
  const memoNoteApi: MemoNoteApi = { ...memoNotes, docOwner: noteDocOwner, docLabel: noteDocLabel, createForDoc: createNoteForDoc }
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
  useMcpMemoBridge({
    highlights: pdfHighlights.highlights,
    add: pdfHighlights.add,
    update: pdfHighlights.update,
    remove: (id) => {
      pdfHighlights.remove(id)
      memoNotes.forgetHighlight(id)
    },
    loadPdfById,
    addToNote: memoNotes.addToNoteTitled,
    docSources: vault === null ? undefined : { all: () => docSourcesRef.current.sources, add: (docId, input) => docSourcesRef.current.add(docId, input), update: (docId, id, patch) => docSourcesRef.current.update(docId, id, patch), remove: (docId, id) => docSourcesRef.current.remove(docId, id) },
    notes: vault === null ? undefined : { list: memoNotes.listNotes, find: memoNotes.findNoteTitled, edit: memoNotes.editNoteTitled, trash: memoNotes.trash },
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
      if (range !== null) setDraftPdfHighlight(buildAnchor(location.docId, pageIndex, index, range[0], range[1]))
    }).catch(() => undefined)
  }, [docTitles, navigation, openMarkdown, searchRecords])
  /** PDF 도구 창(대상 문서·먼저 고를 도구) */
  const [pdfToolsTarget, setPdfToolsTarget] = useState<{ docId: string; tool?: PdfToolId } | null>(null)
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
  const sendPdfSelectionToCanvas = useCallback((selection: PdfExcerptSelection) => {
    if (activeNoteId === null) return
    const sourceTitle = docTitles[selection.anchor.docId] ?? activePdfDoc?.title ?? ''
    setExcerptInsertRequest((current) => ({
      id: (current?.id ?? 0) + 1,
      targetNoteId: activeNoteId,
      payload: { selection, sourceTitle },
    }))
  }, [activeNoteId, activePdfDoc, docTitles])

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
    setDocSearchMode(true)
    documentSearch.run(query)
  }, [documentSearch])
  const searchDocumentsFromSelection = useCallback((selection: PdfExcerptSelection) => {
    const query = selection.anchor.quote.replace(/\s+/gu, ' ').trim().slice(0, 200)
    if (query === '') return
    documentSearch.setQuery(query)
    setLibraryExpanded(false)
    setFocusedPane('split')
    setDocSearchMode(true)
    documentSearch.run(query)
  }, [documentSearch])
  const translatePdfSelection = useCallback(async (selection: PdfExcerptSelection, options?: { readonly force?: boolean; readonly targetLanguage?: string }) => {
    const source = normalizeSelectionText(selection.anchor.quote)
    if (source === '') return null
    const text = await translateWithCacheUsing(translateForCache, source, { docId: selection.anchor.docId, page: selection.anchor.page }, options?.force === true, options?.targetLanguage)
    if (text === null) return null
    return { text, targetLanguage: options?.targetLanguage ?? translation.settings.targetLanguage, model: translation.selectedModel ?? translation.settings.externalProvider }
  }, [translation, translateForCache])

  const sendTranslatedPdfSelectionToCanvas = useCallback((
    selection: PdfExcerptSelection,
    translated: PdfSelectionTranslation,
  ) => {
    if (activeNoteId === null) return
    const sourceTitle = docTitles[selection.anchor.docId] ?? activePdfDoc?.title ?? ''
    setExcerptInsertRequest((current) => ({
      id: (current?.id ?? 0) + 1,
      targetNoteId: activeNoteId,
      payload: { selection, sourceTitle },
      translation: translated,
    }))
  }, [activeNoteId, activePdfDoc, docTitles])

  const translateMarkdownSelection = useCallback(async (text: string, options?: { readonly force?: boolean; readonly targetLanguage?: string }) => {
    const source = normalizeSelectionText(text)
    if (source === '') return null
    const translated = await translateWithCacheUsing(translateForCache, source, { docId: activeMarkdownPath ?? undefined }, options?.force === true, options?.targetLanguage)
    if (translated === null) return null
    return { text: translated, targetLanguage: options?.targetLanguage ?? translation.settings.targetLanguage, model: translation.selectedModel ?? translation.settings.externalProvider }
  }, [translation, translateForCache, activeMarkdownPath])

  const sendTranslatedMarkdownSelectionToCanvas = useCallback((
    payload: MarkdownExcerptDragPayload,
    translated: MarkdownSelectionTranslation,
  ) => {
    if (activeNoteId === null) return
    setExcerptInsertRequest((current) => ({
      id: (current?.id ?? 0) + 1,
      targetNoteId: activeNoteId,
      payload,
      translation: translated,
    }))
  }, [activeNoteId])

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
    setPageEditDocId(null)
    announceAction(t('쪽 편집을 저장했습니다. 원본은 .iwae/history/pdf-edits 에 남겨 두었습니다'))
  }
  /** PDF 도구 창. 문서의 표시 수·목차·다른 PDF 를 모아 넘기고, 창이 부탁하는 일을 해 준다 */
  const renderPdfTools = (target: { docId: string; tool?: PdfToolId }) => {
    const docId = target.docId
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
      <PdfToolsDialog
        docId={docId}
        title={title}
        pageCount={meta?.pageCount ?? 0}
        hasText={meta?.hasText ?? true}
        passwordProtected={isPasswordProtectedDoc(docId)}
        outline={pdfToolsOutline[docId] ?? []}
        otherPdfs={others}
        marks={countMarks(docId, pdfHighlights.highlights, docOverlays)}
        buildFlatten={(choice) => buildFlattenOp(docId, pdfHighlights.highlights, docOverlays, choice)}
        initialTool={target.tool}
        onClose={() => setPdfToolsTarget(null)}
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
    const docPanes = PANE_IDS.filter((pane) => isDocTab(activeTab(panes[pane])))
    if (docPanes.length < 2) return null
    return (
      <div className="side-doc-target" role="radiogroup" aria-label={t('목차를 볼 문서')}>
        {docPanes.map((pane) => {
          const tab = activeTab(panes[pane])
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
              <span className="side-doc-target-side">{pane === 'left' ? t('왼쪽') : t('오른쪽')}</span>
              <span className="side-doc-target-name">{tab === null ? '' : docTitles[tabDocId(tab)] ?? tab.title}</span>
            </button>
          )
        })}
      </div>
    )
  }
  /** 패널 하나를 화면 전체로. SplitPanes 의 'reader'/'note' 는 각각 왼쪽/오른쪽 패널이다 */
  const fullscreenModeOf = (pane: PaneId): Exclude<FocusedPane, 'split'> => pane === 'left' ? 'reader' : 'note'
  const closePaneTab = (id: string) => {
    const tab = openTabIds.find((candidate) => candidate.id === id)
    if (tab?.kind === 'note') closeNoteTabSafely(id)
    else setPanes((current) => closeTabEverywhere(current, id))
  }
  /** 이 창이 지금 보는 쪽(1부터)과 배율. 활성 탭이 아니면 마지막으로 읽던 쪽 */
  const viewOfDoc = (docId: string, tabId: string): { page: number; zoom: DocZoom | null } => {
    const pane = PANE_IDS.find((candidate) => panes[candidate].tabs.some((tab) => tab.id === tabId))
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
  const openNewWindow = async () => {
    try {
      await openAppWindow('extra', windowQuery({ role: 'extra', docId: null, page: null, vaultRoot: vault?.root ?? null }))
    } catch (cause) {
      announceAction(t('창을 열지 못했습니다: {error}', { error: errorText(cause) }))
    }
  }
  windowActionsRef.current = {
    newWindow: () => { void openNewWindow() },
    detachActive: () => { if (activeDocumentTab?.kind === 'pdf') void detachPaneTab(activeDocumentTab.id) },
    // 닫는 길(onCloseRequested)이 탭을 메인으로 돌려보낸다
    reattach: () => closeWindowSafely(),
  }
  sendTabsBackRef.current = async () => {
    for (const tab of openTabIds.filter((candidate) => candidate.kind === 'pdf')) {
      const docId = tabDocId(tab)
      const { page, zoom } = viewOfDoc(docId, tab.id)
      await sendReattach({ docId, page, zoom })
    }
  }
  // 메인 창: 떼어 낸 창이 닫히면서 돌려준 탭을 같은 쪽·배율로 연다
  useEffect(() => {
    if (!isMainWindow) return undefined
    let disposed = false
    let stop: (() => void) | undefined
    void onReattach((request) => {
      if (request.zoom !== null) queueInitialZoom(request.docId, request.zoom)
      navigationJumpRef.current({ docId: request.docId, page: request.page })
      void focusThisWindow()
    }).then((unlisten) => {
      if (disposed) unlisten()
      else stop = unlisten
    })
    return () => { disposed = true; stop?.() }
  }, [])
  const movePaneTab = (id: string, target: PaneId) => {
    const tab = openTabIds.find((candidate) => candidate.id === id)
    // 보이지 않는 패널로 옮기면 그만큼 단을 늘려 나란히 보인다(안 그러면 다시 합쳐진다)
    const needed = (PANE_IDS.indexOf(target) + 1) as PaneCount
    if (needed > paneCount) setPaneCount(needed)
    moveTab(id, target)
    setActivePaneId(target)
    if (tab !== undefined) setPaneRoute(tab.kind === 'note' ? 'note' : 'doc', target)
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
  /** 칸막이 「양쪽 바꾸기」: 두 패널의 탭(과 보던 탭)을 통째로 맞바꾼다. 쪽 위치는 탭마다 기억해 그대로 돌아온다 */
  const swapPanes = (boundary: 0 | 1) => {
    const [a, b]: readonly [PaneId, PaneId] = boundary === 0 ? ['left', 'right'] : ['right', 'third']
    setPanes((current) => ({ ...current, [a]: current[b], [b]: current[a] }))
    setActivePaneId((current) => current === a ? b : current === b ? a : current)
    for (const kind of ['doc', 'note'] as const) {
      const route = paneRouteRef.current[kind]
      if (route === a) setPaneRoute(kind, b)
      else if (route === b) setPaneRoute(kind, a)
    }
  }
  /** 이 패널의 탭을 옮길 곳: 보이는 다른 패널들 + (3단 전까지) 단을 하나 늘려 새로 여는 오른쪽 패널 */
  const paneMoveTargets = (pane: PaneId) => {
    const shown = visiblePanes(shownPaneCount)
    const targets = shown.filter((target) => target !== pane)
      .map((target) => ({ pane: target, label: gridLayout !== null ? t('{index}번 패널로 옮기기', { index: PANE_IDS.indexOf(target) + 1 }) : t('{pane} 패널로 옮기기', { pane: paneLabel(target, shownPaneCount) }) }))
    if (shownPaneCount < 3) {
      const next = PANE_IDS[shownPaneCount]!
      targets.push({ pane: next, label: t('새 오른쪽 패널로 옮기기 ({count}단)', { count: shownPaneCount + 1 }) })
    }
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
  // 창 하나만 닫기: 남은 창이 그 자리를 채우고(배치는 한 칸 적은 것으로), 닫은 창의 탭은 옆 창으로
  const closePane = (pane: PaneId) => {
    const shown = visiblePanes(shownPaneCount)
    const index = shown.indexOf(pane)
    if (index < 0 || shown.length <= 1) return
    const { layout, keep } = closeSplitCell(shownLayoutId, index)
    const target = Math.min(index, keep.length - 1)
    setPanes((current) => {
      const old = PANE_IDS.map((id) => current[id])
      const next = { ...current }
      PANE_IDS.forEach((id, slot) => { next[id] = slot < keep.length ? old[keep[slot]!]! : emptyTabs })
      const closed = old[index]!
      if (closed.tabs.length > 0) {
        const into = PANE_IDS[target]!
        next[into] = { tabs: [...next[into].tabs, ...closed.tabs], activeId: next[into].activeId ?? closed.activeId }
      }
      return next
    })
    setPaneLayout(layout)
    setActivePaneId(PANE_IDS[target]!)
  }
  const renderPaneTabs = (pane: PaneId) => (
    <PaneTabsMenu
      onClosePane={shownPaneCount > 1 && !docSearchMode ? () => closePane(pane) : undefined}
      state={tabsWithVersion(panes[pane])}
      label={t('탭')}
      paneId={pane}
      focused={activePaneId === pane}
      onActivate={(id) => {
        setPanes((current) => ({ ...current, [pane]: activateTab(current[pane], id) }))
        setActivePaneId(pane)
      }}
      onClose={closePaneTab}
      onMoveTab={SPLIT_PANES_ENABLED ? movePaneTab : undefined}
      moveTargets={SPLIT_PANES_ENABLED ? paneMoveTargets(pane) : undefined}
      onReorderTab={(id, toIndex) => setPanes((current) => ({ ...current, [pane]: reorderTab(current[pane], id, toIndex) }))}
      onEditPages={(id) => {
        const tab = openTabIds.find((candidate) => candidate.id === id)
        if (tab !== undefined) setPageEditDocId(tabDocId(tab))
      }}
      onDetachTab={isDetachedWindow ? undefined : (id) => { void detachPaneTab(id) }}
      onReattach={isDetachedWindow ? () => windowActionsRef.current.reattach() : undefined}
      onDuplicateTab={(id) => {
        const tab = openTabIds.find((candidate) => candidate.id === id)
        if (tab === undefined || tab.kind !== 'pdf') return
        const docId = tabDocId(tab)
        // 같은 PDF 를 한 군데 더: 1단이면 같은 패널, 2단이면 반대편 패널에 연다
        const target = singlePane ? pane : otherPane(pane)
        openInPane({ id: nextViewTabId(panes, docId), title: docTitles[docId] ?? tab.title, kind: 'pdf' }, target)
        setActivePaneId(target)
      }}
    />
  )
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
  const renderPaneBody = (pane: PaneId) => {
    const state = panes[pane]
    const tab = activeTab(state)
    if (tab === null) {
      // 문서 검색 화면의 오른쪽 칸은 결과를 누르면 원본이 열리는 자리다
      const hint = docSearchMode && pane !== 'left' ? t('왼쪽 결과를 누르면 원본 PDF 가 여기에 열립니다') : pane === 'left' ? t(PDF_EMPTY) : t(SPLIT_PANE_EMPTY)
      return <PaneShell state={state} emptyHint={hint} placeholder="" />
    }
    if (tab.kind === 'note') {
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
              onToggleFullscreen={() => toggleFocus(fullscreenModeOf(pane))}
              onExportWithEvidence={(document) => exportWithEvidence(noteTab.title, document)}
              insertRequest={excerptInsertRequest}
              onTranslateText={translation.selectedModel === null ? undefined : translateCanvasText}
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
    return (
      <DocumentView
        key={pane}
        paneId={pane}
        state={state}
        tab={tab}
        meta={meta}
        fullscreen={focusedPane === fullscreenModeOf(pane)}
        onToggleFullscreen={() => toggleFocus(fullscreenModeOf(pane))}
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
        onAnchorCreated={setDraftPdfHighlight}
        sourceHighlights={workspaceSources.visibleSources}
        persistentHighlights={pdfHighlights.highlights}
        onPersistentHighlightCreated={pdfHighlights.add}
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
        onMemoJump={jumpToAnnotation}
        docTitles={docTitles}
        flashHighlightId={flashHighlightId}
        onSendToCanvas={!CANVAS_ENABLED || activeNoteId === null ? undefined : sendPdfSelectionToCanvas}
        onCopyWithSource={(selection) => void copyPdfSelectionWithSource(selection)}
        onSearchDocuments={searchDocumentsFromSelection}
        onTranslateSelection={translation.settings.enabled ? translatePdfSelection : undefined}
        onSendTranslatedSelection={!CANVAS_ENABLED || activeNoteId === null ? undefined : sendTranslatedPdfSelectionToCanvas}
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
        onSendTranslatedMarkdownSelection={!CANVAS_ENABLED || activeNoteId === null ? undefined : sendTranslatedMarkdownSelectionToCanvas}
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
        onEditPages={(id) => setPageEditDocId(id)}
        versionLabel={tab.kind === 'pdf' ? versionLabelOf(tabDocId(tab)) : undefined}
        onOpenVersions={tab.kind === 'pdf' ? (anchor) => setTabVersionMenu({ tabId: tab.id, docId: tabDocId(tab), anchor }) : undefined}
      />
    )
  }
  // 패널 안 어디를 누르든 그 패널이 "지금 만지는 패널"이 된다. display: contents 라 배치에는 끼지 않는다.
  const renderPane = (pane: PaneId) => (
    <div className="pane-focus-scope" data-pane-id={pane} onPointerDownCapture={() => focusPane(pane)}>
      {renderPaneBody(pane)}
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
        {error !== null && (
          <div className="app-error" role="alert">
            <span>{error}</span>
            <button type="button" className="app-error-close" aria-label={t('알림 닫기')} onClick={dismissError}><X size={14} aria-hidden="true" /></button>
          </div>
        )}
      </>
    )
  }

  return (
    <MemoNoteContext.Provider value={memoNoteApi}>
    <TranslationCardSettingsContext.Provider value={translationCardSettings}>
    <ActionToast />
    <UpdateBanner state={updater} />
    {error !== null && (
          <div className="app-error" role="alert">
            <span>{error}</span>
            <button type="button" className="app-error-close" aria-label={t('알림 닫기')} onClick={dismissError}><X size={14} aria-hidden="true" /></button>
          </div>
        )}
    <SplitPanes
      sidebar={
        sidebarMode === 'library' || libraryExpanded ? (
          <Sidebar
            library={shownLibrary}
            notebooks={shownNotebooks}
            showNotes={CANVAS_ENABLED}
            onOpenDoc={(doc) => void openDocument(doc)}
            memoNotes={vault === null ? undefined : {
              docOwner: noteDocOwner,
              onCreateForDoc: (docId) => { void createNoteForDoc(docId) },
              entries: orderMemoNoteEntries(memoNotes.entries, noteOrder),
              openPath: memoNotes.openPath,
              onReorder: setNoteOrder,
              onOpen: (path) => {
                memoNotes.open(path)
                setMemoBarVisible(true)
              },
              onCreate: () => {
                void memoNotes.create()
                setMemoBarVisible(true)
              },
              onCreateIn: (folder) => {
                void memoNotes.createIn(folder)
                setMemoBarVisible(true)
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
            onOpenNote={(note) => openInPane({ id: note.path, title: note.title, kind: 'note' })}
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
            openDocIds={openTabIds.filter((tab) => tab.kind !== 'note').map(tabDocId)}
            openNotePaths={openTabIds.filter((tab) => tab.kind === 'note').map((tab) => tab.id)}
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
            showVaultSearch={false}
            onToggleLibrary={toggleLibrary}
            onOpenLibraryItem={openLibraryItem}
            bibliography={bibliography.entries}
            onEditBibliography={setBibliographyDocId}
            onCopyBibtex={copyBibtex}
            onOpenPdfTools={(docId) => setPdfToolsTarget({ docId })}
          />
        ) : (
          <div className="side-doc-target-wrap">
          {renderDocTargetSwitch()}
          {sidebarMode === 'search' ? (
          <div className="side-pdf-search" ref={setPdfSearchSlot} aria-label={t('PDF 검색')}>
            {activePdfDoc === null && activeDocumentTab?.kind !== 'markdown' ? <p className="side-section-empty">{t('PDF·Markdown 을 열면 여기서 검색합니다')}</p> : null}
          </div>
        ) : sidebarMode === 'thumbnails' && activeDocumentTab?.kind === 'markdown' && markdownSources[activeDocumentTab.id] !== undefined ? (
          <MarkdownSectionPreview
            source={markdownSources[activeDocumentTab.id]!}
            currentSection={markdownSectionState[activeDocumentTab.id] ?? 0}
            onSelectSection={(index) => window.dispatchEvent(new CustomEvent('iwae:md-section-go', { detail: { path: activeDocumentTab.id, index } }))}
          />
        ) : sidebarMode === 'thumbnails' ? (
          <ThumbnailPanel
            activeDoc={activePdfDoc}
            currentPage={currentPdfPage - 1}
            onSelectPage={(page) => jumpToPage(page + 1)}
          />
        ) : sidebarMode === 'outlinePreview' && activeDocumentTab?.kind === 'markdown' && markdownSources[activeDocumentTab.id] !== undefined ? (
          <MarkdownOutlinePreview
            source={markdownSources[activeDocumentTab.id]!}
            currentSection={markdownSectionState[activeDocumentTab.id] ?? 0}
            onSelectSection={(index) => window.dispatchEvent(new CustomEvent('iwae:md-section-go', { detail: { path: activeDocumentTab.id, index } }))}
          />
        ) : sidebarMode === 'outlinePreview' ? (
          <OutlinePreviewPanel
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
      singlePane={singlePane && !docSearchMode}
      threePane={shownPaneCount === 3 && gridLayout === null}
      grid={gridLayout === null ? undefined : { layout: gridLayout, tabs: visiblePanes(shownPaneCount).map((pane) => renderPaneTabs(pane)) }}
      onSwapPanes={docSearchMode ? undefined : swapPanes}
      topBar={({ sidebarPx, leftFrac, sidebarVisible, paneGrows, gridZones }) => (
        <TopBar
          sidebarCollapsed={sidebarCollapsed}
          sidebarVisible={sidebarVisible}
          onToggleSidebar={() => setSidebarCollapsed((v) => !v)}
          sidebarMode={sidebarMode}
          onSidebarModeChange={setSidebarMode}
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
            [{
              id: 'theme',
              label: theme.resolvedTheme === 'dark' ? t('밝은 화면으로') : t('어두운 화면으로'),
              onSelect: () => theme.setPreference(theme.resolvedTheme === 'dark' ? 'light' : 'dark'),
            }],
            [
              { id: 'updates', label: t('업데이트 확인'), onSelect: () => { setSettingsSection('updates'); setSettingsOpen(true) } },
              { id: 'about', label: t('정보 보기'), onSelect: () => setAboutOpen(true) },
              { id: 'settings', label: t('설정'), hint: 'Ctrl+,', onSelect: () => { setSettingsSection(undefined); setSettingsOpen(true) } },
            ],
          ]}
          sidebarPx={sidebarPx}
          leftFrac={leftFrac}
          leftTabs={docSearchMode ? <span className="topbar-docsearch-label">{t('문서 검색')}</span> : gridLayout !== null ? null : renderPaneTabs('left')}
          rightTabs={gridLayout !== null ? null : renderPaneTabs('right')}
          thirdTabs={shownPaneCount === 3 && gridLayout === null ? renderPaneTabs('third') : undefined}
          gridZones={gridLayout === null || gridZones === undefined ? undefined : gridZones.map((zone) => {
            const pane = visiblePanes(shownPaneCount)[zone.index] ?? 'left'
            return { paneId: pane, tabs: renderPaneTabs(pane), grow: zone.grow }
          })}
          paneGrows={paneGrows}
          docSearchActive={docSearchMode}
          onToggleDocSearch={toggleDocSearchMode}
          singlePane={singlePane}
          paneLayout={paneLayoutId}
          onPaneLayoutChange={SPLIT_PANES_ENABLED && !isDetachedWindow ? setPaneLayout : undefined}
          memoBar={(activeDocumentTab?.kind === 'pdf' || activeDocumentTab?.kind === 'markdown') && !docSearchMode ? { visible: memoBarVisible, onToggle: () => setMemoBarVisible(!memoBarVisible) } : undefined}
          onCloseWindow={closeWindowSafely}
          // 떼어 낸 창은 왼쪽 바 없이 시작한다(찾기 등으로 열렸을 때만 접을 수 있게 단추가 나온다)
          hideSidebarToggle={isDetachedWindow && sidebarCollapsed}
        />
      )}
      sidebarCollapsed={sidebarCollapsed || docSearchMode}
      left={docSearchMode ? (
        <DocumentSearchPanel
          state={documentSearch}
          records={searchRecords}
          indexProgress={searchIndexProgress}
          onOpenHit={(hit) => void openVaultHit(hit)}
          onClose={() => setDocSearchMode(false)}
        />
      ) : renderPane('left')}
      right={renderPane('right')}
      third={renderPane('third')}
      fourth={renderPane('fourth')}
    />
    {CANVAS_ENABLED && focusedPane === 'split' && !libraryExpanded ? (
      <SourceTrace
        sources={workspaceSources.visibleSources}
      />
    ) : null}
    <AiLocationInbox
      items={aiLocations}
      docTitles={docTitles}
      onOpen={openAiLocation}
      onDismiss={(id) => setAiLocations((current) => current.filter((item) => item.id !== id))}
    />
    {pageEditDocId !== null ? (() => {
      const meta = openedDocs.find((doc) => doc.docId === pageEditDocId)
      if (meta === undefined) return null
      return (
        <PageEditDialog
          key={pageEditDocId}
          docId={pageEditDocId}
          title={docTitles[pageEditDocId] ?? meta.title}
          pageCount={meta.pageCount}
          onCancel={() => setPageEditDocId(null)}
          onSave={(items) => savePageEdit(meta.docId, meta.pageSizes, items)}
        />
      )
    })() : null}
    {pdfToolsTarget !== null ? renderPdfTools(pdfToolsTarget) : null}
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
    {aboutOpen ? <AboutDialog version={packageMetadata.version} onClose={() => setAboutOpen(false)} /> : null}
    {paletteOpen ? <CommandPalette commands={paletteCommands()} onClose={() => setPaletteOpen(false)} /> : null}
    <SettingsModal
      open={settingsOpen}
      initialSectionId={settingsSection}
      onClose={() => {
        setSettingsOpen(false)
        setSettingsSection(undefined)
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
          content: <UpdateSettings currentVersion={packageMetadata.version} state={updater} />,
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
    </TranslationCardSettingsContext.Provider>
    </MemoNoteContext.Provider>
  )
}
