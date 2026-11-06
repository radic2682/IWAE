import { describe, expect, it } from 'vitest'
import type { PageTextIndex } from '../core/textIndex'
import type { PersistentPdfHighlight } from '../pdf/persistentHighlight'
import { findQuote, seedSampleVault, type SampleManifest } from './sampleVault'

function pageIndex(text: string): PageTextIndex {
  return { text, chars: [...text].map((c, i) => ({ c, x: i * 5, y: 10, w: c === '\n' || c === '\r' ? 0 : 5, h: 10 })) }
}

describe('예시 Vault', () => {
  it('줄바꿈·띄어쓰기가 달라도 원문을 찾는다', () => {
    expect(findQuote('A JSON text is\r\na sequence of tokens.', 'JSON text is a sequence')).toEqual([2, 26])
    expect(findQuote('abc', 'zzz')).toBeNull()
  })

  it('빈 Vault 에만 PDF·Markdown·노트를 넣고, 메모·티켓을 형광펜으로 잇는다', async () => {
    const files = new Map<string, string | Uint8Array>()
    let highlights: PersistentPdfHighlight[] = []
    const manifest: SampleManifest = {
      pdf: { file: 'doc.pdf', name: 'Example.pdf' },
      markdown: { file: 'guide.md', name: 'Guide.md' },
      note: {
        title: 'Getting Started',
        blocks: [
          { kind: 'section', title: 'Overview' },
          { kind: 'text', markdown: '**Hello**' },
          { kind: 'memo', page: 1, quote: 'sequence of tokens', note: 'Tokens!' },
          { kind: 'memo', page: 1, quote: 'MUST be UTF-8', note: 'Encoding', ticket: 'REQ-1' },
          { kind: 'memo', page: 1, quote: 'not on the page', note: 'skipped' },
        ],
      },
    }
    const io = {
      isEmpty: async () => files.size === 0,
      fetchAsset: async (file: string) => new TextEncoder().encode(file === 'guide.md' ? '# Guide' : 'PDF').buffer as ArrayBuffer,
      writeBinary: async (path: string, data: Uint8Array) => { files.set(path, data) },
      writeText: async (path: string, text: string) => { files.set(path, text) },
      registerPdf: async () => 'doc-1',
      pageText: async () => pageIndex('A JSON text is a sequence of tokens. Text MUST be UTF-8.'),
      readHighlights: async () => highlights,
      writeHighlights: async (next: readonly PersistentPdfHighlight[]) => { highlights = [...next] },
    }
    expect(await seedSampleVault(io, manifest)).toBe(true)
    expect([...files.keys()].sort()).toEqual(['Example.pdf', 'Guide.md', '노트/Getting Started.iwnote'])
    expect(highlights.map((item) => [item.anchor.quote, item.note])).toEqual([['sequence of tokens', 'Tokens!'], ['MUST be UTF-8', 'Encoding']])
    const note = JSON.parse(files.get('노트/Getting Started.iwnote') as string) as { blocks: { kind: string; ticket?: { title: string } }[] }
    expect(note.blocks.map((block) => block.kind)).toEqual(['section', 'text', 'memo', 'memo'])
    expect(note.blocks[3]?.ticket).toEqual({ title: 'REQ-1' })
    // 이미 파일이 있으면 아무것도 하지 않는다
    expect(await seedSampleVault(io, manifest)).toBe(false)
  })
})
