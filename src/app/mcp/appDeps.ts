import { pageTextIndex, type PdfToolOp } from '../../bridge/pdf'
import { buildAnchor, type Anchor } from '../../core/anchor'
import { findTextRange } from '../../core/canvasOps'
import { parsePageRanges } from '../../core/pdfToolOps'
import type { PdfBookmark } from '../../core/pdfBookmarks'
import type { VaultSearchRecord } from '../../core/vaultSearch'
import type { LibraryDoc } from '../../core/vaultTree'
import type { PersistentPdfHighlight } from '../../pdf/persistentHighlight'
import { leaves, MAX_PANES, type LayoutNode } from '../../core/layoutTree'
import { otherPane, tabDocId, tabsOf, type PaneId, type PanesState, type Tab } from '../tabs'
import { channelOf, type PaneChannels } from '../workspaceChannels'
import type { McpAppDeps, McpBookmarkPatch, McpLibraryDoc, McpPaneState, McpScreenState, PaneRef } from './types'
import type { Screen } from '../screens'

/** 예전 칸 이름 → 칸 번호(왼쪽 위부터 0) */
const LEGACY_PANE_INDEX: Readonly<Record<string, number>> = { left: 0, right: 1, third: 2, fourth: 3 }

/** 칸 참조(예전 이름·'0'…'7')의 칸 번호. 이름이 아니면 null */
export function paneIndexOfRef(ref: string): number | null {
  const legacy = LEGACY_PANE_INDEX[ref]
  if (legacy !== undefined) return legacy
  return /^[0-7]$/u.test(ref) ? Number(ref) : null
}

/** App 이 가진 상태와 손잡이. buildMcpAppDeps 가 이것을 MCP 의 McpAppDeps 로 바꾼다 */
export interface McpAppInput {
  readonly vaultRoot: string | null
  readonly paneCount: number
  readonly layout: LayoutNode
  readonly channels: PaneChannels
  /** 적어도 count 칸이 되게 늘리고 칸 차례를 돌려준다(아직 없는 칸 번호를 가리켰을 때) */
  readonly growPanes: (count: number) => readonly PaneId[]
  readonly activePaneId: PaneId
  readonly panes: PanesState
  /** 모든 화면(맨 위 줄 차례)과 보는 화면의 id. 보는 화면의 칸은 위의 layout · panes · channels 와 같다 */
  readonly screens: readonly Screen[]
  readonly activeScreenId: string
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
  /** 칸 수를 바꾸고 바뀐 칸 차례를 돌려준다 */
  readonly setPaneCount: (count: number) => readonly PaneId[]
  readonly setActivePane: (pane: PaneId) => void
  readonly setPaneRoute: (kind: 'doc' | 'note', pane: PaneId) => void
  readonly activateTabIn: (pane: PaneId, tabId: string) => void
  readonly closeTab: (tab: Tab) => void
  /** 그 패널이 그 문서를 보고 있으면 쪽을 바꾼다. 바꿨으면 true */
  readonly requestPage: (pane: PaneId, docId: string, page: number) => boolean
  /** 문서가 열린 뒤 이 쪽으로 가도록 맡겨 둔다 */
  readonly pendingPage: (docId: string, page: number) => void
  readonly jump: (docId: string, page: number) => void
  /** AI 가 가리키는 임시 표시(저장되지 않는다. 선택·형광펜과 따로 그린다) */
  readonly pointAt: (anchor: Anchor, message?: string | null) => void
  readonly draftAnchor: (anchor: Anchor) => void
  /** 노트를 탭으로 연다: pane 이 있으면 그 창의 탭으로, 없으면 문서 창 옆(이미 노트를 보이는 창이 있으면 그 창의 탭). 놓은 창 */
  readonly openMemoNote: (path: string, pane?: PaneId) => PaneId
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

/** 화면 하나의 칸들을 MCP 모양(칸 번호 · id · 탭 · 보던 탭 · 색)으로 */
function paneStatesOf(layout: LayoutNode, panes: PanesState, channels: PaneChannels): McpPaneState[] {
  return leaves(layout).map((pane, index) => ({
    index,
    id: pane,
    tabs: tabsOf(panes, pane).tabs.map((tab) => ({ id: tab.id, title: tab.title, kind: tab.kind })),
    activeId: tabsOf(panes, pane).activeId,
    channel: channelOf(channels, pane),
  }))
}

export function buildMcpAppDeps(input: McpAppInput): McpAppDeps {
  const order = leaves(input.layout)
  /**
   * 칸 참조를 칸 id 로. active·other·칸 id·칸 번호('0'…'7', left/right/third/fourth = 0–3).
   * 아직 없는 칸 번호는 칸을 늘려서 만든다(칸이 상한이거나 너무 작아 못 만들면 오류)
   */
  const resolvePane = (ref: PaneRef | undefined): PaneId => {
    if (ref === undefined || ref === 'active') return input.activePaneId
    if (ref === 'other') return otherPane(order, input.activePaneId)
    if (order.includes(ref)) return ref
    const index = paneIndexOfRef(ref)
    if (index === null) throw new Error('unknown pane: ' + ref)
    const existing = order[index]
    if (existing !== undefined) return existing
    const grown = input.growPanes(index + 1)[index]
    if (grown === undefined) throw new Error('pane ' + index + ' could not be created (at most ' + MAX_PANES + ' panes, each at least 240x160 px)')
    return grown
  }
  const tabLocation = (tabId: string): { pane: PaneId; tab: Tab } | null => {
    for (const pane of order) {
      const tab = tabsOf(input.panes, pane).tabs.find((candidate) => candidate.id === tabId)
      if (tab !== undefined) return { pane, tab }
    }
    return null
  }
  const docLocation = (docId: string): PaneId | undefined => order.find((pane) => tabsOf(input.panes, pane).tabs.some((tab) => tabDocId(tab) === docId))

  const openDocument: McpAppDeps['openDocument'] = async (docId, options) => {
    const doc = input.shownLibrary.find((item) => item.docId === docId) ?? input.markdownDocById(docId)
    if (doc === undefined) throw new Error(`doc_id not found: ${docId}`)
    const explicit = options.pane !== undefined && options.pane !== 'active'
    const target = resolvePane(options.pane)
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

  let cachedDocs: McpLibraryDoc[] | undefined
  return {
    vaultRoot: input.vaultRoot,
    paneCount: input.paneCount,
    layout: input.layout,
    activePane: input.activePaneId,
    panes: paneStatesOf(input.layout, input.panes, input.channels),
    screens: input.screens.map((screen, index): McpScreenState => ({
      index,
      id: screen.id,
      name: screen.name,
      active: screen.id === input.activeScreenId,
      // 보는 화면은 App 이 막 만든 최신 값(layout · panes · channels), 나머지는 저장된 화면의 값
      panes: screen.id === input.activeScreenId ? paneStatesOf(input.layout, input.panes, input.channels) : paneStatesOf(screen.layout, screen.panes, screen.channels),
    })),
    docViews: input.docViews,
    selection: input.liveSelection,
    // 색인 기록 전체를 훑으므로 쓸 때만 계산한다(App 이 그릴 때마다 만들지 않는다)
    get docs() {
      cachedDocs ??= libraryDocs(input, input.pdfToolBusy)
      return cachedDocs
    },
    bookmarks: input.bookmarks.list,

    openDocument,
    openNote: (path, pane) => {
      const explicit = pane !== undefined && pane !== 'active'
      const target = explicit ? resolvePane(pane) : undefined
      return { pane: input.openMemoNote(path, target) }
    },
    setLayout: (count, focus) => {
      const after = input.setPaneCount(count)
      const focused = focus === undefined ? undefined : after[Math.min(focus, after.length - 1)]
      if (focused !== undefined) input.setActivePane(focused)
      const active = focused ?? (after.includes(input.activePaneId) ? input.activePaneId : after[after.length - 1]!)
      return { paneCount: after.length, activePane: after.indexOf(active) }
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
        // 저장된 형광펜은 건드리지 않고 그 자리에 AI 가리킴만 그린다
        input.pointAt(hit.anchor)
        return { flashed: true }
      }
      try {
        const index = await pageTextIndex(docId, page - 1)
        const [start, end] = findTextRange(index, quote)
        input.pointAt(buildAnchor(docId, page - 1, index, start, end))
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
