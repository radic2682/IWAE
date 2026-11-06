import { buildAnchor, type Anchor } from '../core/anchor'
import { memoBlock, sectionBlock, textBlock, MEMO_NOTES_FOLDER, MEMO_NOTE_EXTENSION, type MemoNoteBlock } from '../core/memoNote'
import { markdownToMemoHtml } from '../pdf/memoRichText'
import { createPersistentPdfHighlight, type PersistentPdfHighlight } from '../pdf/persistentHighlight'
import type { PageTextIndex } from '../core/textIndex'

/**
 * 처음 만든(빈) Vault 에 넣는 예시: PDF 하나, Markdown 하나, 그 PDF 에 단 메모로 엮은 노트 하나.
 * 내용은 앱에 함께 실린 `sample-vault/manifest.json` 이 정한다(코드는 PDF 종류를 모른다).
 */
export interface SampleManifest {
  readonly pdf: { readonly file: string; readonly name: string }
  readonly markdown: { readonly file: string; readonly name: string }
  readonly note: {
    readonly title: string
    readonly blocks: readonly SampleBlock[]
  }
}

export type SampleBlock =
  | { readonly kind: 'section'; readonly title: string }
  | { readonly kind: 'text'; readonly markdown: string }
  /** PDF 의 page 쪽(1부터)에서 quote 를 찾아 형광펜을 칠하고 note 를 메모로. ticket 이 있으면 티켓 블록 */
  | { readonly kind: 'memo'; readonly page: number; readonly quote: string; readonly note: string; readonly ticket?: string }

export interface SampleVaultIo {
  /** Vault 안에 사용자 파일이 하나라도 있는가(.iwae 등 앱 폴더는 빼고) */
  readonly isEmpty: () => Promise<boolean>
  readonly fetchAsset: (file: string) => Promise<ArrayBuffer>
  readonly writeBinary: (relativePath: string, data: Uint8Array) => Promise<void>
  readonly writeText: (relativePath: string, text: string) => Promise<void>
  /** Vault 에 새로 둔 PDF 를 목록에 올리고 그 docId 를 돌려준다 */
  readonly registerPdf: (relativePath: string) => Promise<string | null>
  readonly pageText: (docId: string, page: number) => Promise<PageTextIndex>
  readonly readHighlights: () => Promise<PersistentPdfHighlight[]>
  readonly writeHighlights: (highlights: readonly PersistentPdfHighlight[]) => Promise<void>
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
}

/** 줄바꿈·여러 칸 띄어쓰기를 가리지 않고 quote 가 나오는 [시작, 끝) */
export function findQuote(text: string, quote: string): readonly [number, number] | null {
  const words = quote.trim().split(/\s+/u).filter((word) => word !== '')
  if (words.length === 0) return null
  const match = new RegExp(words.map(escapeRegExp).join('\\s+'), 'u').exec(text)
  return match === null ? null : [match.index, match.index + match[0].length]
}

/** 빈 Vault 면 예시를 넣는다. 넣었으면 true. 하나라도 실패하면 거기서 멈추고 넣은 것까지만 남긴다 */
export async function seedSampleVault(io: SampleVaultIo, manifest: SampleManifest): Promise<boolean> {
  if (!(await io.isEmpty())) return false
  await io.writeBinary(manifest.pdf.name, new Uint8Array(await io.fetchAsset(manifest.pdf.file)))
  await io.writeText(manifest.markdown.name, new TextDecoder().decode(await io.fetchAsset(manifest.markdown.file)))
  const docId = await io.registerPdf(manifest.pdf.name)

  const highlights: PersistentPdfHighlight[] = []
  const blocks: MemoNoteBlock[] = []
  const texts = new Map<number, PageTextIndex>()
  const createdAt = new Date().toISOString()
  for (const block of manifest.note.blocks) {
    if (block.kind === 'section') {
      blocks.push(sectionBlock(block.title))
      continue
    }
    if (block.kind === 'text') {
      blocks.push(textBlock(block.markdown, markdownToMemoHtml(block.markdown)))
      continue
    }
    if (docId === null) continue
    const page = block.page - 1
    const index = texts.get(page) ?? await io.pageText(docId, page)
    texts.set(page, index)
    const range = findQuote(index.text, block.quote)
    if (range === null) continue
    const anchor: Anchor = buildAnchor(docId, page, index, range[0], range[1])
    const highlight = createPersistentPdfHighlight(anchor, 'yellow', { note: block.note, createdAt, source: 'iwae' })
    highlights.push(highlight)
    blocks.push(memoBlock(highlight.id, block.ticket === undefined ? undefined : { title: block.ticket }))
  }
  if (highlights.length > 0) await io.writeHighlights([...(await io.readHighlights()), ...highlights])
  await io.writeText(`${MEMO_NOTES_FOLDER}/${manifest.note.title}${MEMO_NOTE_EXTENSION}`, `${JSON.stringify({ version: 1, blocks }, null, 2)}\n`)
  return true
}
