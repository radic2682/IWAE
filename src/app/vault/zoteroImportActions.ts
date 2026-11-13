import { attachPdfToLibrary, readLibrary, type VaultHandle } from '../../bridge/vault'
import { openPdf, pageTextIndex } from '../../bridge/pdf'
import { readZoteroLibrary } from '../../bridge/zotero'
import type { BibEntry } from '../../core/bibliography'
import type { HighlightColorDef } from '../../core/highlightColors'
import type { PageTextIndex } from '../../core/textIndex'
import { convertZoteroAnnotations, zoteroBibEntry, zoteroFolderFor, type ZoteroItem } from '../../core/zoteroImport'
import type { PersistentPdfHighlight } from '../../pdf/persistentHighlight'
import { errorText } from '../../core/errorText'
import { t } from '../../i18n'

export interface ZoteroImportDeps {
  readonly vault: VaultHandle
  readonly colors: readonly HighlightColorDef[]
  /** 형광펜을 더한다. 실제로 더해진(이미 없던) 형광펜 */
  readonly addHighlights: (highlights: readonly PersistentPdfHighlight[]) => readonly PersistentPdfHighlight[]
  /** 그 PDF 의 노트 끝에 메모(형광펜 id)와 글을 붙인다. 이미 있는 것은 건너뛴다 */
  readonly addToDocNote: (docId: string, highlightIds: readonly string[], texts: readonly string[]) => void
  readonly existingBibliography: (docId: string) => BibEntry | undefined
  readonly saveBibliography: (docId: string, entry: BibEntry) => void
  readonly onProgress?: (text: string) => void
}

export interface ZoteroImportReport {
  readonly items: number
  readonly pdfs: number
  /** 이미 Vault 에 있어 복사하지 않은 PDF */
  readonly existing: number
  readonly bibliography: number
  readonly highlights: number
  /** 형광펜으로 바꾸지 못해 노트에 글로 남긴 주석·항목 노트 */
  readonly memos: number
  /** 파일이 없는 첨부(링크만 있거나 동기화 안 됨) */
  readonly missingFiles: number
  readonly failed: readonly string[]
}

/**
 * Zotero 데이터 폴더를 읽어 PDF 를 Vault 의 「Zotero/컬렉션」 폴더로 복사하고, 서지 정보·주석·노트를 옮긴다.
 * Zotero 쪽에는 아무것도 쓰지 않는다. 이미 가져온 PDF 는 다시 복사하지 않고, 주석은 같은 자리를 건너뛴다.
 */
export async function importZoteroLibrary(path: string, deps: ZoteroImportDeps): Promise<ZoteroImportReport> {
  const library = await readZoteroLibrary(path)
  const candidates = library.items.filter((item) => item.attachments.length > 0 || item.notes.length > 0)
  let pdfs = 0
  let existing = 0
  let bibliography = 0
  let highlights = 0
  let memos = 0
  let missingFiles = 0
  const failed: string[] = []
  const now = new Date().toISOString()

  let known = new Set((await readLibrary(deps.vault)).map((entry) => entry.sha256))

  for (const [position, item] of candidates.entries()) {
    deps.onProgress?.(t('Zotero 가져오는 중 {done}/{total}', { done: position + 1, total: candidates.length }))
    let firstDoc: string | null = null
    for (const attachment of item.attachments) {
      if (attachment.path === undefined) { missingFiles += 1; continue }
      try {
        const meta = await openPdf(attachment.path, undefined, { askPassword: false })
        const wasKnown = known.has(meta.sha256)
        const entry = await attachPdfToLibrary(deps.vault, {
          sourcePath: attachment.path,
          title: meta.title,
          pages: meta.pageCount,
          policy: { kind: 'copy-another-folder', folderPath: zoteroFolderFor(item) },
        })
        known = new Set([...known, meta.sha256])
        if (wasKnown) existing += 1
        else pdfs += 1
        firstDoc ??= entry.docId

        const prior = deps.existingBibliography(entry.docId)
        if (prior === undefined || prior.source === 'pdf') {
          deps.saveBibliography(entry.docId, zoteroBibEntry(item, now))
          bibliography += 1
        }

        const indexes = new Map<number, PageTextIndex | null>()
        for (const page of new Set(attachment.annotations.flatMap((annotation) => (annotation.pageIndex === undefined ? [] : [annotation.pageIndex])))) {
          indexes.set(page, page < meta.pageCount ? await pageTextIndex(entry.docId, page).catch(() => null) : null)
        }
        const converted = convertZoteroAnnotations(entry.docId, attachment.annotations, (page) => indexes.get(page) ?? null, deps.colors, now)
        const added = deps.addHighlights(converted.highlights)
        highlights += added.length
        memos += converted.memos.length
        if (added.length > 0 || converted.memos.length > 0) deps.addToDocNote(entry.docId, added.map(({ id }) => id), converted.memos)
      } catch (cause) {
        failed.push(`${attachment.fileName || item.title || item.key}: ${errorText(cause)}`)
      }
    }
    // 항목에 붙은 노트는 그 항목의 첫 PDF 노트에 글로 남긴다
    if (firstDoc !== null && item.notes.length > 0) {
      deps.addToDocNote(firstDoc, [], itemNoteTexts(item))
      memos += item.notes.length
    }
  }
  return { items: candidates.length, pdfs, existing, bibliography, highlights, memos, missingFiles, failed }
}

const itemNoteTexts = (item: ZoteroItem): string[] => item.notes.map((note) => `${t('Zotero 노트')}: ${note.replace(/\s+/gu, ' ').trim()}`)

/** 사람이 읽을 한 줄 결과 */
export function zoteroReportLine(report: ZoteroImportReport): string {
  if (report.items === 0) return t('가져올 Zotero 항목이 없습니다')
  const parts = [t('PDF {pdfs}개', { pdfs: report.pdfs })]
  if (report.existing > 0) parts.push(t('이미 있던 PDF {count}개', { count: report.existing }))
  parts.push(t('서지 {count}건', { count: report.bibliography }))
  parts.push(t('형광펜 {count}개', { count: report.highlights }))
  if (report.memos > 0) parts.push(t('글 메모 {count}개', { count: report.memos }))
  if (report.missingFiles > 0) parts.push(t('파일 없는 첨부 {count}개 건너뜀', { count: report.missingFiles }))
  if (report.failed.length > 0) parts.push(t('실패 {count}개', { count: report.failed.length }))
  return t('Zotero에서 가져왔습니다: {summary}', { summary: parts.join(', ') })
}
