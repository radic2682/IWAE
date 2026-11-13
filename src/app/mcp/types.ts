import type { PdfDocMeta } from '../../bridge/pdf'
import type { DocSource } from '../../core/docSources'
import type { MemoNote } from '../../core/memoNote'
import type { PdfBookmark } from '../../core/pdfBookmarks'
import type { PersistentPdfHighlight, PersistentPdfHighlightPatch } from '../../pdf/persistentHighlight'
import type { LayoutNode } from '../../core/layoutTree'
import type { PaneId, TabKind } from '../workspace/tabs'
import type { PaneChannel } from '../workspace/workspaceChannels'
import type { NoteAdapter, NoteStoreDeps } from './noteAdapter'
import type { McpWorkspaceState } from './workspaceCommand'

/** 도구 한 번의 성격(Rust app_tools.rs 의 Class 와 같다) */
export type OpClass = 'read' | 'write' | 'destructive' | 'ui'

/**
 * 어느 칸인가. 칸 번호(왼쪽 위부터 0 — '0'…'7', 예전 이름 left=0, right=1, third=2, fourth=3), 칸 id(app_state 가 알려 준다),
 * 또는 active(지금 만진 칸)·other(만진 칸의 다음 칸)
 */
export type PaneRef = string

export interface McpTab {
  readonly id: string
  readonly title: string
  readonly kind: TabKind
}

export interface McpPaneState {
  /** 칸 번호(왼쪽 위부터 0) */
  readonly index: number
  readonly id: PaneId
  readonly tabs: readonly McpTab[]
  readonly activeId: string | null
  /** 색 채널(같은 색끼리 연동). null 은 연동 없음 */
  readonly channel: PaneChannel
}

/** 떠 있는 칸 하나(칸 번호는 없다) */
export interface McpFloatState {
  readonly id: PaneId
  readonly tabs: readonly McpTab[]
  readonly activeId: string | null
}

/** 화면(tmux window) 하나: 번호 · 이름 · 보는 화면인가 · 그 화면의 칸들 */
/** 세션 하나의 요약(app_state.session) */
export interface McpSessionInfo {
  readonly name: string
  readonly active: boolean
  readonly screens: number
  /** 마지막으로 쓴 때(ms). 모르면 null */
  readonly last_used_at: number | null
}

/** 앱 창(client) 하나: 창 id · 이름(A 가 메인 창) · 붙은 세션 · 보는 화면 번호(0부터) */
export interface McpClientInfo {
  readonly id: string
  readonly label: string
  readonly session: string
  readonly screen: number
}

export interface McpSessionState {
  readonly name: string
  readonly sessions: readonly McpSessionInfo[]
}

export interface McpScreenState {
  /** 화면 번호(맨 위 줄 차례, 0 부터) */
  readonly index: number
  readonly id: string
  readonly name: string
  readonly active: boolean
  readonly panes: readonly McpPaneState[]
  /** 떠 있는 칸들 */
  readonly floats: readonly McpFloatState[]
}

/** 서재의 문서 한 건(PDF·Markdown) */
export interface McpLibraryDoc {
  readonly docId: string
  readonly title: string
  readonly kind: 'pdf' | 'markdown'
  /** Vault 안 폴더(맨 위는 '') */
  readonly folder: string
  readonly favorite: boolean
  readonly pageCount: number | null
  readonly lastOpenedAt: string | null
  readonly addedAt: string | null
  /** 글자 층이 있는 쪽 수(색인에서). 모르면 null */
  readonly pagesWithText: number | null
  /** 스캔본인가(글자 층이 없다). 모르면 null */
  readonly scanned: boolean | null
  /** OCR 상태. 모르면 null */
  readonly ocr: 'none' | 'running' | 'done' | null
}

export interface McpBookmarkPatch {
  readonly page?: number
  readonly title?: string
  readonly y?: number
  readonly emoji?: string
}

export interface McpPdfToolResult {
  readonly path: string
  readonly docId: string | null
  readonly pageCount: number | null
}

/** 화면·번역·PDF 도구·서재: App 이 채워 주는 것들. 모두 한 곳(App.tsx 의 연결 자리)에서 만든다 */
export interface McpAppDeps {
  readonly vaultRoot: string | null
  readonly paneCount: number
  /** 칸 나누기 트리(칸 id 가 잎) */
  readonly layout: LayoutNode
  readonly activePane: PaneId
  /** 칸 번호 차례의 칸들(지금 보는 화면) */
  readonly panes: readonly McpPaneState[]
  /** 모든 화면(맨 위 줄 차례). 보는 화면의 칸들은 panes 와 같다 */
  readonly screens: readonly McpScreenState[]
  /** 지금 보는 화면의 떠 있는 칸들 */
  readonly floats: readonly McpFloatState[]
  /** 패널마다 지금 보이는 PDF 와 쪽(1부터) */
  readonly docViews: Readonly<Partial<Record<PaneId, { readonly docId: string; readonly page: number; readonly pageCount?: number }>>>
  /** 지금 PDF 에서 고른 글(없으면 null) */
  readonly selection: () => { readonly docId: string; readonly page: number; readonly text: string } | null
  readonly docs: readonly McpLibraryDoc[]
  readonly bookmarks: readonly PdfBookmark[]

  /** 문서를 연다. 열린 패널과 쪽을 돌려준다 */
  readonly openDocument: (docId: string, options: { readonly pane?: PaneRef; readonly page?: number; readonly activate?: boolean }) => Promise<{ readonly pane: PaneId; readonly page: number | null }>
  /** 노트를 탭으로 연다(path 는 Vault 상대 경로) */
  readonly openNote: (path: string, pane?: PaneRef) => { readonly pane: PaneId }
  /** 칸 수를 바꾼다(1–8). focus 는 만질 칸 번호. 바꾼 뒤의 칸 수와 만진 칸 번호 */
  readonly setLayout: (paneCount: number, focus?: number) => { readonly paneCount: number; readonly activePane: number }
  /** 그 쪽으로 가서(문서를 열고) quote 가 있으면 칠해 깜박인다 */
  readonly goto: (input: { readonly docId: string; readonly page: number; readonly quote?: string; readonly flash: boolean; readonly pane?: PaneRef }) => Promise<{ readonly flashed: boolean }>
  readonly closeTab: (tabId: string) => boolean
  /** 명령줄 명령(`split-window -h ; open 노트 A`)을 앱의 `:` 명령줄과 같은 실행기로 돌리고, 끝난 뒤의 화면 · 칸 요약을 돌려준다 */
  readonly workspaceCommand: (command: string, client?: string) => Promise<{ readonly ok: boolean; readonly message: string; readonly state: McpWorkspaceState }>
  /** 세션에 붙은 앱 창들(app_state.clients). 메인 창은 A */
  readonly clients: () => readonly McpClientInfo[]
  /** 지금 세션의 이름과 있는 세션들 */
  readonly session: () => Promise<McpSessionState>

  readonly addBookmark: (docId: string, page: number, title: string, options: { readonly y?: number; readonly emoji?: string }) => string
  readonly updateBookmark: (id: string, patch: McpBookmarkPatch) => string
  readonly removeBookmark: (id: string) => void
  /** 되돌리기용: 지웠던 책갈피를 그대로 되살린다 */
  readonly restoreBookmarks: (bookmarks: readonly PdfBookmark[]) => void
  readonly setFavorite: (docId: string, favorite: boolean) => void

  readonly translation: {
    readonly enabled: boolean
    /** 'local' 은 이 컴퓨터(Ollama), 'external-api' 는 밖으로 나가는 번역기 */
    readonly executionMode: string
    readonly externalProvider: string
    readonly targetLanguage: string
    readonly ready: boolean
    readonly translate: (text: string, source?: string, target?: string) => Promise<string>
  }
  /** PDF 도구: 항상 새 파일(Vault 안, 겹치지 않는 이름)로 쓰고 서재에 올린다 */
  readonly runPdfTool: (
    docId: string,
    tool: { readonly kind: 'extract'; readonly pages: string; readonly outputName?: string }
      | { readonly kind: 'pageNumbers'; readonly pages?: string; readonly position?: string; readonly startAt?: number; readonly outputName?: string },
  ) => Promise<McpPdfToolResult>
  /** 노트를 내보내기 폴더의 새 파일로(덮어쓰지 않는다). 쓴 경로 */
  readonly exportNoteMarkdownFile: (notePath: string) => Promise<string>
  readonly settings: () => { readonly language: string; readonly theme: string }
}

export interface McpDeps {
  readonly highlights: readonly PersistentPdfHighlight[]
  readonly add: (highlight: PersistentPdfHighlight) => void
  readonly update: (id: string, patch: PersistentPdfHighlightPatch) => void
  /** 형광펜을 지우고 노트의 메모 블록도 뺀다 */
  readonly remove: (id: string) => void
  readonly loadPdfById: (docId: string) => Promise<{ meta: PdfDocMeta; title: string }>
  /** MCP note_*: 앱이 가진 노트를 읽고 고친다(켜져 있어도 .iwnote 를 밖에서 고치지 않게) */
  readonly notes?: NoteStoreDeps
  /** MCP source_*: 문서 원본 출처 */
  readonly docSources?: {
    readonly all: () => Readonly<Record<string, readonly DocSource[]>>
    readonly add: (docId: string, input: { label?: string; target: string; note?: string }) => boolean
    readonly update: (docId: string, sourceId: string, patch: { label?: string; target?: string; note?: string }) => void
    readonly remove: (docId: string, sourceId: string) => void
  }
  readonly app?: McpAppDeps
  /** 문서 id 가 노트를 가지는 PDF(버전 묶음이면 대표). 모르면 null */
  readonly noteOwner?: (docId: string) => string | null
}

/** 한 번의 쓰기(되돌리기 묶음 하나)가 채우는 정보 */
export interface ChangeNote {
  /** 펼 때 보일 대상(노트 제목·문서 제목) */
  target: string
  /** 바뀐 개수(메모·블록·책갈피 …) */
  count: number
  /** ai_changes 에 보일 한 줄 */
  summary: string
}

export type { MemoNote }

/** 도구 하나가 받는 것 */
export interface OpContext {
  readonly deps: McpDeps
  readonly notes: NoteAdapter
  /** 쓰기 하나가 채우는 기록(대상·개수·요약) */
  readonly change: ChangeNote
  /** 지금 형광펜 전부(방금 만든 것을 포함, 방금 지운 것을 제외) */
  readonly highlights: () => readonly PersistentPdfHighlight[]
}

export type OpHandler = (args: Record<string, unknown>, ctx: OpContext) => unknown | Promise<unknown>

export interface OpDef {
  readonly cls: OpClass
  readonly run: OpHandler
}

export const op = (cls: OpClass, run: OpHandler): OpDef => ({ cls, run })
