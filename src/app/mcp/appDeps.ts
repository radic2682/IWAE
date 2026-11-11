import { pageTextIndex, type PdfToolOp } from '../../bridge/pdf'
import { buildAnchor, type Anchor } from '../../core/anchor'
import { findTextRange } from '../../core/canvasOps'
import { parsePageRanges } from '../../core/pdfToolOps'
import type { PdfBookmark } from '../../core/pdfBookmarks'
import type { VaultSearchRecord } from '../../core/vaultSearch'
import type { LibraryDoc } from '../../core/vaultTree'
import type { PersistentPdfHighlight } from '../../pdf/persistentHighlight'
import { otherPane, PANE_IDS, tabDocId, type PaneId, type PanesState, type Tab } from '../tabs'
import type { McpAppDeps, McpBookmarkPatch, McpLibraryDoc, PaneRef } from './types'

type PaneCount = 1 | 2 | 3 | 4

/** App 이 가진 상태와 손잡이. buildMcpAppDeps 가 이것을 MCP 의 McpAppDeps 로 바꾼다 */
export interface McpAppInput {
  readonly vaultRoot: string | null
  readonly paneCount: number
  readonly activePaneId: PaneId
  readonly panes: PanesState
  readonly docViews: Readonly<Partial<Record<PaneId, { readonly docId: string; readonly page: number }>>>
  readonly shownLibrary: readonly LibraryDoc[]
  readonly openedDocs: readonly { readonly docId: string; readonly title: string; readonly hasText?: boolean; readonly pageCount: number }[]
  readonly searchRecords: readonly VaultSearchRecord[]
  readonly docTitles: Readonly<Record<string, string>>
  readonly highlights: readonly PersistentPdfHighlight[]
  readonly bookmarks: {
    readonly list: readonly PdfBookmark[]
    readonly toggle: (docId: string, page: number, title: string) => void
    readonly isBookmarked: (docId: string, page: number) => boolean
    readonly addPin: (docId: string, page: number, y: number, title: string) => string
    readonly updatePin: (id: string, patch: { title?: string; emoji?: string | null }) => void
    readonly movePin: (id: string, page: number, y: number) => string
    readonly remove: (id: string) => void
  }
  readonly translation: {
    readonly settings: { readonly enabled: boolean; readonly executionMode: string; readonly externalProvider: string; readonly targetLanguage: string }
    readonly selectedModel: string | null
    readonly translate: (text: string, source?: string, target?: string) => Promise<{ readonly translatedText: string } | null>
  }
  readonly themePreference: string
  readonly language: string

  readonly openAnyDocument: (doc: LibraryDoc, openTab?: boolean) => Promise<unknown>
  readonly markdownDocById: (docId: string) => LibraryDoc | undefined
  readonly openInPane: (tab: Tab, pane?: PaneId) => void
  readonly moveTab: (id: string, target: PaneId) => void
  readonly setPaneCount: (count: PaneCount) => void
  readonly setActivePane: (pane: PaneId) => void
  readonly setPaneRoute: (kind: 'doc' | 'note', pane: PaneId) => void
  readonly activateTabIn: (pane: PaneId, tabId: string) => void
  readonly closeTab: (tab: Tab) => void
  /** 그 패널이 그 문서를 보고 있으면 쪽을 바꾼다. 바꿨으면 true */
  readonly requestPage: (pane: PaneId, docId: string, page: number) => boolean
  /** 문서가 열린 뒤 이 쪽으로 가도록 맡겨 둔다 */
  readonly pendingPage: (docId: string, page: number) => void
  readonly jump: (docId: string, page: number) => void
  readonly flashHighlight: (highlight: PersistentPdfHighlight) => void
  readonly draftAnchor: (anchor: Anchor) => void
  readonly openMemoNote: (path: string) => void
  readonly liveSelection: () => { readonly docId: string; readonly page: number; readonly text: string } | null
  readonly setFileFavorite: (id: string, favorite: boolean) => void
  /** PDF 도구를 새 파일로(원본 옆, Vault 안). 쓴 경로 */
  readonly toolCopy: (docId: string, op: PdfToolOp, suffix: string) => Promise<string>
  readonly exportNote: (path: string) => Promise<string>
  readonly pdfToolBusy: (docId: string) => boolean
}

const POSITION: Record<string, 'bottomCenter' | 'bottomRight' | 'bottomLeft' | 'topCenter' | 'topRight' | 'topLeft'> = {
  'bottom-center': 'bottomCenter',
  'bottom-right': 'bottomRight',
  'bottom-left': 'bottomLeft',
  'top-center': 'topCenter',
  'top-right': 'topRight',
  'top-left': 'topLeft',
}

const norm = (text: string) => text.replace(/\s+/gu, ' ').trim().toLowerCase()

/** 서재 문서(PDF·Markdown) 목록: 색인 기록 + 열린 문서 정보 */
function libraryDocs(input: McpAppInput, ocrBusy: (docId: string) => boolean): McpLibraryDoc[] {
  return input.searchRecords.flatMap((record): McpLibraryDoc[] => {
    if (record.kind !== 'pdf' && record.kind !== 'markdown') return []
    const library = input.shownLibrary.find((doc) => doc.docId === record.id)
    const opened = input.openedDocs.find((doc) => doc.docId === record.id)
    const withText = record.pages.length === 0 ? null : record.pages.filter((page) => page.text.trim() !== '').length
    const scanned = record.kind !== 'pdf' ? null : opened?.hasText === false ? true : withText === null ? (opened?.hasText === true ? false : null) : withText === 0
    return [{
      docId: record.id,
      title: input.docTitles[record.id] ?? (record.displayName || record.filename),
      kind: record.kind,
      folder: record.folder,
      favorite: record.favorite,
      pageCount: library?.pages ?? opened?.pageCount ?? (record.pages.length === 0 ? null : record.pages.length),
      lastOpenedAt: record.lastOpenedAt,
      addedAt: record.addedAt,
      pagesWithText: record.kind === 'pdf' ? withText : null,
      scanned,
      ocr: record.kind !== 'pdf' ? null : ocrBusy(record.id) ? 'running' : scanned === true ? 'none' : scanned === false ? 'done' : null,
    }]
  })
}

export function buildMcpAppDeps(input: McpAppInput): McpAppDeps {
  const resolvePane = (ref: PaneRef | undefined): PaneId => {
    if (ref === undefined || ref === 'active') return input.activePaneId
    if (ref === 'other') return otherPane(input.activePaneId)
    return ref
  }
  const ensurePane = (pane: PaneId) => {
    const needed = (PANE_IDS.indexOf(pane) + 1) as PaneCount
    if (needed > input.paneCount) input.setPaneCount(needed)
  }
  const tabLocation = (tabId: string): { pane: PaneId; tab: Tab } | null => {
    for (const pane of PANE_IDS) {
      const tab = input.panes[pane].tabs.find((candidate) => candidate.id === tabId)
      if (tab !== undefined) return { pane, tab }
    }
    return null
  }
  const docLocation = (docId: string): PaneId | undefined => PANE_IDS.find((pane) => input.panes[pane].tabs.some((tab) => tabDocId(tab) === docId))

  const openDocument: McpAppDeps['openDocument'] = async (docId, options) => {
    const doc = input.shownLibrary.find((item) => item.docId === docId) ?? input.markdownDocById(docId)
    if (doc === undefined) throw new Error(`doc_id not found: ${docId}`)
    const explicit = options.pane !== undefined && options.pane !== 'active'
    const target = resolvePane(options.pane)
    if (explicit) ensurePane(target)
    const isMarkdown = input.shownLibrary.every((item) => item.docId !== docId)
    const placed = docLocation(docId)
    if (isMarkdown) {
      await input.openAnyDocument(doc, placed === undefined)
    } else {
      // 탭은 아래에서 원하는 패널에 직접 놓는다(처음 여는 문서만)
      await input.openAnyDocument(doc, false)
      if (placed === undefined) input.openInPane({ id: docId, title: doc.title, kind: 'pdf' }, target)
    }
    let pane: PaneId = placed ?? target
    if (placed !== undefined && explicit && placed !== target) {
      input.moveTab(docId, target)
      pane = target
    } else if (placed === undefined && isMarkdown && explicit) {
      input.moveTab(docId, target)
      pane = target
    }
    if (options.activate !== false) {
      input.setActivePane(pane)
      input.setPaneRoute('doc', pane)
      input.activateTabIn(pane, tabLocation(docId)?.tab.id ?? docId)
    }
    if (options.page !== undefined && !isMarkdown) {
      if (!input.requestPage(pane, docId, options.page)) input.pendingPage(docId, options.page)
    }
    return { pane, page: options.page ?? null }
  }

  return {
    vaultRoot: input.vaultRoot,
    paneCount: input.paneCount,
    activePane: input.activePaneId,
    panes: Object.fromEntries(PANE_IDS.map((pane) => [pane, {
      tabs: input.panes[pane].tabs.map((tab) => ({ id: tab.id, title: tab.title, kind: tab.kind })),
      activeId: input.panes[pane].activeId,
    }])) as unknown as McpAppDeps['panes'],
    docViews: input.docViews,
    selection: input.liveSelection,
    docs: libraryDocs(input, input.pdfToolBusy),
    bookmarks: input.bookmarks.list,

    openDocument,
    openNote: (path) => {
      input.openMemoNote(path)
      return { pane: input.activePaneId }
    },
    setLayout: (count, focus) => {
      input.setPaneCount(count)
      if (focus !== undefined) input.setActivePane(focus)
      return { paneCount: count, activePane: focus ?? input.activePaneId }
    },
    goto: async ({ docId, page, quote, flash, pane }) => {
      const doc = input.shownLibrary.find((item) => item.docId === docId)
      if (doc === undefined) throw new Error(`doc_id not found: ${docId}`)
      if (pane !== undefined && pane !== 'active') await openDocument(docId, { pane, page })
      else input.jump(docId, page)
      if (!flash || quote === undefined || quote.trim() === '') return { flashed: false }
      const wanted = norm(quote)
      const hit = input.highlights.find((item) => item.anchor.docId === docId && item.anchor.page === page - 1 && norm(item.anchor.quote).includes(wanted))
      if (hit !== undefined) {
        input.flashHighlight(hit)
        return { flashed: true }
      }
      try {
        const index = await pageTextIndex(docId, page - 1)
        const [start, end] = findTextRange(index, quote)
        input.draftAnchor(buildAnchor(docId, page - 1, index, start, end))
        return { flashed: true }
      } catch {
        return { flashed: false }
      }
    },
    closeTab: (tabId) => {
      const found = tabLocation(tabId)
      if (found === null) return false
      input.closeTab(found.tab)
      return true
    },

    addBookmark: (docId, page, title, options) => {
      const y = options.y
      let id: string
      if (y === undefined) {
        if (!input.bookmarks.isBookmarked(docId, page)) input.bookmarks.toggle(docId, page, title)
        id = `${docId}:${page}`
      } else {
        id = input.bookmarks.addPin(docId, page, y, title)
      }
      if (options.emoji !== undefined) input.bookmarks.updatePin(id, { emoji: options.emoji })
      return id
    },
    updateBookmark: (id, patch: McpBookmarkPatch) => {
      const current = input.bookmarks.list.find((bookmark) => bookmark.id === id)
      if (current === undefined) throw new Error(`bookmark not found: ${id}`)
      const moves = patch.page !== undefined || patch.y !== undefined
      const nextId = moves ? input.bookmarks.movePin(id, patch.page ?? current.page, patch.y ?? current.y ?? 0) : id
      input.bookmarks.updatePin(nextId, {
        ...(patch.title === undefined ? {} : { title: patch.title }),
        ...(patch.emoji === undefined ? {} : { emoji: patch.emoji === '' ? null : patch.emoji }),
      })
      return nextId
    },
    removeBookmark: (id) => input.bookmarks.remove(id),
    restoreBookmarks: (list) => {
      for (const bookmark of list) {
        if (input.bookmarks.list.some((item) => item.id === bookmark.id)) continue
        const id = input.bookmarks.addPin(bookmark.docId, bookmark.page, bookmark.y ?? 0, bookmark.title)
        if (bookmark.emoji !== undefined) input.bookmarks.updatePin(id, { emoji: bookmark.emoji })
      }
    },
    setFavorite: (docId, favorite) => input.setFileFavorite(docId, favorite),

    translation: {
      enabled: input.translation.settings.enabled,
      executionMode: input.translation.settings.executionMode,
      externalProvider: input.translation.settings.externalProvider,
      targetLanguage: input.translation.settings.targetLanguage,
      ready: input.translation.settings.enabled && input.translation.selectedModel !== null,
      translate: async (text, source, target) => {
        const result = await input.translation.translate(text, source, target)
        if (result === null) throw new Error('translation returned nothing')
        return result.translatedText
      },
    },
    runPdfTool: async (docId, tool) => {
      const record = input.searchRecords.find((item) => item.id === docId)
      if (record === undefined || record.kind !== 'pdf') throw new Error(`doc_id not found: ${docId}`)
      // Vault 안의 문서만: 원본 옆에 새 파일을 쓰므로 Vault 밖(참조) 문서는 Vault 밖에 쓰게 된다
      if (record.storage !== 'vault') throw new Error('This document lives outside the Vault (a reference). Import it into the Vault first.')
      const library = input.shownLibrary.find((item) => item.docId === docId)
      const pageCount = library?.pages ?? input.openedDocs.find((item) => item.docId === docId)?.pageCount ?? 0
      if (tool.kind === 'extract') {
        const pages = parsePageRanges(tool.pages, pageCount)
        if (pages === null || pages.length === 0) throw new Error(`pages could not be read: ${tool.pages}`)
        const suffix = tool.outputName ?? `(p.${tool.pages.replace(/\s+/gu, '')})`
        const path = await input.toolCopy(docId, { kind: 'extract', pages }, suffix)
        return { path, docId: null, pageCount: pages.length }
      }
      if (tool.pages !== undefined) throw new Error('Stamping only some pages is not available: omit pages to number every page.')
      const path = await input.toolCopy(docId, {
        kind: 'pageNumbers',
        position: POSITION[tool.position ?? 'bottom-center'] ?? 'bottomCenter',
        start: tool.startAt ?? 1,
        template: '{n}',
        size: 10,
        skipFirst: false,
      }, tool.outputName ?? '(page numbers)')
      return { path, docId: null, pageCount: pageCount === 0 ? null : pageCount }
    },
    exportNoteMarkdownFile: (notePath) => input.exportNote(notePath),
    settings: () => ({ language: input.language, theme: input.themePreference }),
  }
}
