import { readLibrary, readPdfHighlights, readTranslationCache, pickVaultFolder, type VaultHandle } from '../../bridge/vault'
import { listMemoNoteTree, readMemoNote } from '../../bridge/memoNotes'
import { pageImageUrl } from '../../bridge/pdf'
import { isDesktop } from '../../bridge/window'
import {
  buildMarkdownBlocks,
  markdownFileStem,
  relativePdfLink,
  renderNoteMarkdown,
  uniqueFileStem,
} from '../../core/markdownExport'
import { memoHighlightIds, type MemoNote } from '../../core/memoNote'
import { normalizeSource } from '../../core/translationCache'
import type { PersistentPdfHighlight } from '../../pdf/persistentHighlight'
import { createCanvasRasterizer } from '../documents/exportEvidence'
import { t } from '../../i18n'

/** 무엇을 내보내는가: 노트 하나, 한 PDF 의 노트 모두, Vault 의 노트 전부 */
export type MarkdownExportScope =
  | { readonly kind: 'note'; readonly path: string }
  | { readonly kind: 'doc'; readonly docId: string }
  | { readonly kind: 'vault' }

export interface MarkdownExportResult {
  readonly folder: string
  readonly files: readonly string[]
  readonly images: number
  /** 그림을 만들지 못한 영역 메모 수 */
  readonly imagesFailed: number
}

const isAbsolutePath = (path: string) => /^[A-Za-z]:[\\/]/u.test(path) || path.startsWith('/') || path.startsWith('\\\\')

/**
 * 노트를 Markdown 파일로 내보낸다. 노트 한 장이 파일 하나이고, 영역 메모의 그림은 `<파일 이름>.assets/` 폴더에
 * PNG 로 둔다. 읽기는 모두 Vault 파일에서 하므로(저장된 것 기준) 화면의 상태에 기대지 않는다.
 * folder 를 주지 않으면 폴더를 고르는 창을 연다(취소하면 null).
 */
export async function exportNotesAsMarkdown(
  vault: VaultHandle,
  scope: MarkdownExportScope,
  options: { readonly folder?: string; readonly now?: Date } = {},
): Promise<MarkdownExportResult | null> {
  if (!isDesktop()) throw new Error(t('Markdown 내보내기는 데스크톱 앱에서만 됩니다.'))
  const folder = options.folder ?? await pickVaultFolder()
  if (folder === null) return null

  const { join } = await import('@tauri-apps/api/path')
  const { mkdir, writeFile, writeTextFile, exists } = await import('@tauri-apps/plugin-fs')

  const [tree, highlights, library, translations] = await Promise.all([
    listMemoNoteTree(vault),
    readPdfHighlights(vault),
    readLibrary(vault),
    readTranslationCache(vault).catch(() => []),
  ])
  const notes: { path: string; title: string; note: MemoNote }[] = []
  for (const entry of tree.entries) {
    const note = await readMemoNote(vault, entry.path).catch(() => null)
    if (note === null) continue
    if (scope.kind === 'note' && entry.path !== scope.path) continue
    if (scope.kind === 'doc') {
      const mentioned = note.blocks.some((block) => block.kind === 'memo' && memoHighlightIds(block).some((id) => highlights.find((item) => item.id === id)?.anchor.docId === scope.docId))
      if (note.docId !== scope.docId && !mentioned) continue
    }
    notes.push({ path: entry.path, title: entry.title, note })
  }
  if (notes.length === 0) throw new Error(t('내보낼 노트가 없습니다.'))

  const byId = new Map<string, PersistentPdfHighlight>(highlights.map((item) => [item.id, item]))
  const docs = new Map(library.map((entry) => [entry.docId, entry]))
  const translationBySource = new Map(translations.map((entry) => [normalizeSource(entry.source), entry.translated]))

  await mkdir(folder, { recursive: true })
  const taken = new Set<string>()
  const files: string[] = []
  let images = 0
  let imagesFailed = 0
  const rasterizer = createCanvasRasterizer()
  // 날짜는 쓰는 사람의 달력(현지 시각)으로 — UTC 로 자르면 한국 새벽에는 하루 전 날짜가 된다
  const stamp = options.now ?? new Date()
  const exportedAt = `${stamp.getFullYear()}-${String(stamp.getMonth() + 1).padStart(2, '0')}-${String(stamp.getDate()).padStart(2, '0')}`

  for (const { title, note } of notes) {
    const stem = uniqueFileStem(markdownFileStem(title), taken)
    taken.add(stem.toLowerCase())
    const assetsName = `${stem}.assets`
    // 영역 그림: 영역 메모마다 PNG 하나
    const imageNames = new Map<string, string>()
    const regions = note.blocks.flatMap((block) => (block.kind === 'memo' ? memoHighlightIds(block) : []))
      .map((id) => byId.get(id)).filter((item): item is PersistentPdfHighlight => item?.kind === 'region')
    for (const region of regions) {
      const rect = region.anchor.rects[0]
      if (rect === undefined || region.pageSize === undefined || imageNames.has(region.id)) continue
      try {
        const rendered = await rasterizer.page(pageImageUrl(region.anchor.docId, region.anchor.page, 1600), region.pageSize, { region: { x: rect.x, y: rect.y, w: rect.w, h: rect.h } }, [])
        const dataUrl = rendered.crops.region
        if (dataUrl === null || dataUrl === undefined) throw new Error('no image')
        const bytes = Uint8Array.from(atob(dataUrl.slice(dataUrl.indexOf(',') + 1)), (char) => char.charCodeAt(0))
        const assetsDir = await join(folder, assetsName)
        if (!(await exists(assetsDir))) await mkdir(assetsDir, { recursive: true })
        const fileName = `region-${imageNames.size + 1}.png`
        await writeFile(await join(assetsDir, fileName), bytes)
        imageNames.set(region.id, `${encodeURIComponent(assetsName)}/${fileName}`)
        images += 1
      } catch {
        imagesFailed += 1
      }
    }
    const blocks = buildMarkdownBlocks(note, {
      highlights: byId,
      docTitle: (docId) => docs.get(docId)?.title ?? 'PDF',
      link: (docId, page) => {
        const entry = docs.get(docId)
        return entry === undefined ? undefined : relativePdfLinkSync(folder, entry.path, vault.root, page)
      },
      translation: (quote) => translationBySource.get(normalizeSource(quote)),
      image: (highlight) => imageNames.get(highlight.id),
    })
    await writeTextFile(await join(folder, `${stem}.md`), renderNoteMarkdown({ title, blocks, exportedAt }))
    files.push(`${stem}.md`)
  }
  return { folder, files, images, imagesFailed }
}

/** 상대 경로로 적힌 PDF 는 Vault 뿌리에서 풀어 링크를 만든다 */
function relativePdfLinkSync(folder: string, pdfPath: string, vaultRoot: string, page: number): string {
  const absolute = isAbsolutePath(pdfPath) ? pdfPath : `${vaultRoot.replace(/[\\/]+$/u, '')}/${pdfPath.replaceAll('\\', '/')}`
  return relativePdfLink(folder, absolute, page)
}
