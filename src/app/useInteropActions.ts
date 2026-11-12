import { useCallback, useEffect, useRef, useState } from 'react'
import { pageTextIndex, pdfAnnotations } from '../bridge/pdf'
import { pickZoteroFolder } from '../bridge/zotero'
import { isDesktop } from '../bridge/window'
import type { VaultHandle } from '../bridge/vault'
import type { BibEntry } from '../core/bibliography'
import {
  annotationOfferCount,
  annotationOfferSeen,
  importedToHighlights,
  markAnnotationOfferSeen,
} from '../core/annotationImport'
import { errorText } from '../core/errorText'
import type { PageTextIndex } from '../core/textIndex'
import { docNoteTitle, insertBlock, memoBlock, memoHighlightIds, textBlock, type MemoNote } from '../core/memoNote'
import type { PersistentPdfHighlight } from '../pdf/persistentHighlight'
import { announceAction } from './actionFeedback'
import { getHighlightColors } from './highlightColorStyle'
import { exportNotesAsMarkdown, type MarkdownExportScope } from './markdownExportActions'
import { importZoteroLibrary, zoteroReportLine } from './zoteroImportActions'
import { APP_COMMAND_EVENT } from '../ui/documentContextMenu'
import { t } from '../i18n'

/** 열 때 자동으로 표시를 찾아보는 PDF 의 쪽 수 상한(그보다 큰 문서는 도구에서 직접 가져온다) */
const OFFER_MAX_PAGES = 80

export interface PdfMarkImport {
  /** PDF 안에서 찾은 표시 수 */
  readonly found: number
  readonly imported: number
  /** 이미 있거나 글자 층이 없어 건너뛴 수 */
  readonly skipped: number
}

interface InteropDeps {
  readonly vault: VaultHandle | null
  readonly highlights: readonly PersistentPdfHighlight[]
  readonly addManyHighlights: (highlights: readonly PersistentPdfHighlight[]) => number
  readonly memoNotes: {
    readonly entries: readonly { readonly path: string; readonly title: string; readonly docId?: string }[]
    readonly listNotes: () => { path: string; title: string; blocks: number }[]
    readonly editNoteTitled: (title: string, change: (note: MemoNote) => MemoNote, create: boolean) => string
  }
  readonly docOwner: (docId: string) => string | null
  readonly docLabel: (docId: string) => string
  readonly bibliography: {
    readonly entries: Readonly<Record<string, BibEntry>>
    readonly saveEntry: (docId: string, entry: BibEntry) => void
  }
  /** 지금 PDF 탭의 문서 id(없으면 null) */
  readonly activePdfDocId: string | null
  /** 그 문서의 쪽 수. 큰 PDF 는 열 때 자동으로 훑지 않는다(PDF 스레드를 오래 잡는다) */
  readonly activePdfPages: number
  /** 노트를 문서 창 옆에 탭으로 보인다(들여온 메모가 어디 들어갔는지 보이게) */
  readonly showNote: (path: string) => void
}

/**
 * 「내 데이터가 갇히지 않는다」: 다른 도구의 표시·서지를 들여오고(PDF 안의 표시, Zotero) 노트를 Markdown 으로 내보낸다.
 * App 의 상태(형광펜·노트·서지)를 쓰는 부분을 한 곳에 모았다.
 */
export function useInteropActions(deps: InteropDeps) {
  const ref = useRef(deps)
  ref.current = deps
  const [offer, setOffer] = useState<{ docId: string; count: number } | null>(null)

  /** 그 PDF 의 노트 끝에 메모(형광펜 id)와 글을 붙인다. 노트가 없으면 만든다. 이미 있는 것은 건너뛴다 */
  const addToDocNote = useCallback((docId: string, highlightIds: readonly string[], texts: readonly string[]) => {
    const { memoNotes, docOwner, docLabel } = ref.current
    const owner = docOwner(docId) ?? docId
    const existing = memoNotes.entries.find((entry) => entry.docId === owner)
    const title = existing?.title ?? docNoteTitle(docLabel(owner), memoNotes.listNotes().map((note) => note.title))
    const path = memoNotes.editNoteTitled(title, (note) => {
      const have = new Set(note.blocks.flatMap((block) => (block.kind === 'memo' ? memoHighlightIds(block) : [])))
      const haveText = new Set(note.blocks.flatMap((block) => (block.kind === 'text' ? [block.text.trim()] : [])))
      let next: MemoNote = note.docId === undefined ? { ...note, docId: owner } : note
      for (const id of highlightIds) {
        if (have.has(id)) continue
        next = insertBlock(next, memoBlock(id), next.blocks.length)
      }
      for (const text of texts) {
        if (haveText.has(text.trim())) continue
        next = insertBlock(next, textBlock(text), next.blocks.length)
      }
      return next
    }, true)
    ref.current.showNote(path)
  }, [])

  /** 열린 PDF 안의 형광펜·밑줄·붙임 쪽지를 내 형광펜(메모)으로 가져온다 */
  const importPdfMarks = useCallback(async (docId: string): Promise<PdfMarkImport> => {
    const found = await pdfAnnotations(docId)
    const indexes = new Map<number, PageTextIndex | null>()
    for (const page of new Set(found.map((annotation) => annotation.page))) {
      indexes.set(page, await pageTextIndex(docId, page).catch(() => null))
    }
    const converted = importedToHighlights(docId, found, (page) => indexes.get(page) ?? null, ref.current.highlights, getHighlightColors())
    const before = new Set(ref.current.highlights.map(({ id }) => id))
    const fresh = converted.highlights.filter(({ id }) => !before.has(id))
    const imported = ref.current.addManyHighlights(fresh)
    if (imported > 0) addToDocNote(docId, fresh.map(({ id }) => id), [])
    return { found: found.length, imported, skipped: found.length - imported }
  }, [addToDocNote])

  const importMarksMessage = (result: PdfMarkImport): string => {
    if (result.found === 0) return t('이 PDF 에는 가져올 표시가 없습니다')
    const base = t('{count}개 가져왔습니다', { count: result.imported })
    return result.skipped > 0 ? `${base} ${t('(이미 있거나 글자를 찾지 못한 표시 {skipped}개는 건너뜀)', { skipped: result.skipped })}` : base
  }

  // PDF 를 열면 다른 프로그램이 남긴 표시가 있는지 한 번 살펴 작은 알림으로 권한다(문서마다 한 번)
  const { activePdfDocId, activePdfPages, vault } = deps
  useEffect(() => {
    if (!isDesktop() || vault === null || activePdfDocId === null || activePdfPages > OFFER_MAX_PAGES || annotationOfferSeen(activePdfDocId)) return undefined
    const docId = activePdfDocId
    let alive = true
    const timer = window.setTimeout(() => {
      void pdfAnnotations(docId).then((found) => {
        if (!alive) return
        markAnnotationOfferSeen(docId)
        const count = annotationOfferCount(docId, found, ref.current.highlights, false)
        if (count > 0) setOffer({ docId, count })
      }).catch(() => undefined)
    }, 1500)
    return () => { alive = false; window.clearTimeout(timer) }
  }, [activePdfDocId, activePdfPages, vault])
  useEffect(() => { setOffer((current) => (current !== null && current.docId !== activePdfDocId ? null : current)) }, [activePdfDocId])

  const acceptOffer = useCallback(() => {
    if (offer === null) return
    const docId = offer.docId
    setOffer(null)
    void importPdfMarks(docId).then((result) => announceAction(importMarksMessage(result)), (cause: unknown) => announceAction(errorText(cause)))
  }, [offer, importPdfMarks])

  const runZotero = useCallback(async (path?: string) => {
    const { vault: current } = ref.current
    if (current === null) { announceAction(t('먼저 Vault 를 열어 주세요')); return null }
    try {
      const folder = path ?? await pickZoteroFolder()
      if (folder === null) return null
      announceAction(t('Zotero 읽는 중…'))
      const report = await importZoteroLibrary(folder, {
        vault: current,
        colors: getHighlightColors(),
        addHighlights: (items) => {
          const have = new Set(ref.current.highlights.map(({ id }) => id))
          const fresh = items.filter(({ id }) => !have.has(id))
          ref.current.addManyHighlights(fresh)
          return fresh
        },
        addToDocNote,
        existingBibliography: (docId) => ref.current.bibliography.entries[docId],
        saveBibliography: (docId, entry) => ref.current.bibliography.saveEntry(docId, entry),
        onProgress: (text) => announceAction(text),
      })
      announceAction(zoteroReportLine(report))
      return report
    } catch (cause) {
      announceAction(errorText(cause))
      return null
    }
  }, [addToDocNote])

  const exportMarkdown = useCallback(async (scope: MarkdownExportScope, folder?: string) => {
    const { vault: current } = ref.current
    if (current === null) { announceAction(t('먼저 Vault 를 열어 주세요')); return null }
    try {
      const result = await exportNotesAsMarkdown(current, scope, folder === undefined ? {} : { folder })
      if (result === null) return null
      announceAction(t('Markdown {count}개를 내보냈습니다: {folder}', { count: result.files.length, folder: result.folder }))
      return result
    } catch (cause) {
      announceAction(errorText(cause))
      return null
    }
  }, [])

  // 명령 팔레트·메뉴가 보내는 일(폴더를 미리 정하면 고르는 창을 건너뛴다)
  useEffect(() => {
    const onCommand = (event: Event) => {
      const detail = (event as CustomEvent<{ name?: string; docId?: string; path?: string; scope?: MarkdownExportScope; folder?: string }>).detail
      if (detail?.name === 'importPdfMarks' && detail.docId !== undefined) {
        void importPdfMarks(detail.docId).then((result) => announceAction(importMarksMessage(result)), (cause: unknown) => announceAction(errorText(cause)))
      }
      if (detail?.name === 'zoteroImport') void runZotero(detail.path)
      if (detail?.name === 'exportMarkdown' && detail.scope !== undefined) void exportMarkdown(detail.scope, detail.folder)
    }
    window.addEventListener(APP_COMMAND_EVENT, onCommand)
    return () => window.removeEventListener(APP_COMMAND_EVENT, onCommand)
  }, [runZotero, exportMarkdown, importPdfMarks])

  return {
    importPdfMarks,
    importMarksMessage,
    offer,
    acceptOffer,
    dismissOffer: () => setOffer(null),
    runZotero,
    exportMarkdown,
  }
}
