// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { fakeApp, makeEnv } from './testHarness'
import type { McpLibraryDoc } from './types'

vi.mock('../../bridge/pdf', async () => {
  const h = await import('./testPdf')
  return {
    ...(await vi.importActual<object>('../../bridge/pdf')),
    pageTextIndex: h.fakePageTextIndex,
    pdfOutline: async () => [{ title: '1장', page: 0, depth: 0 }, { title: '1.1', page: 1, depth: 1 }, { title: '외부', page: null, depth: 0 }],
    pdfMetadata: async () => ({ title: '메타', author: '저자' }),
  }
})

const doc = (docId: string, extra: Partial<McpLibraryDoc> = {}): McpLibraryDoc => ({ docId, title: `문서 ${docId}`, kind: 'pdf', folder: '', favorite: false, pageCount: 2, lastOpenedAt: null, addedAt: null, pagesWithText: 2, scanned: false, ocr: 'none', ...extra })

function setup() {
  const favorites = new Map<string, boolean>()
  const docs = [doc('b'), doc('a', { favorite: true, lastOpenedAt: '2026-02-01', folder: 'x/y', pageCount: 9 }), doc('m', { kind: 'markdown', lastOpenedAt: '2026-03-01' })]
  const app = fakeApp({
    docs,
    setFavorite: (id, favorite) => { favorites.set(id, favorite); const d = docs.find((item) => item.docId === id) as { favorite: boolean }; d.favorite = favorite },
  })
  return { env: makeEnv({ app, pdfs: { a: ['a1', 'a2'], b: ['b1', 'b2'] } }), favorites, docs }
}

describe('MCP 서재 도구', () => {
  it('library_list 는 모음·종류·검색·정렬을 따른다', async () => {
    const { env } = setup()
    const ids = async (args: Record<string, unknown>) => ((await env.call('library_list', args)) as { items: { doc_id: string }[] }).items.map((i) => i.doc_id)
    expect(await ids({})).toEqual(['a', 'b', 'm'])
    expect(await ids({ collection: 'favorites' })).toEqual(['a'])
    expect(await ids({ collection: 'recent' })).toEqual(['m', 'a'])
    expect(await ids({ collection: 'folder', folder: 'x' })).toEqual(['a'])
    expect(await ids({ kind: 'markdown' })).toEqual(['m'])
    expect(await ids({ query: '문서 b' })).toEqual(['b'])
    expect(await ids({ kind: 'pdf', sort: 'pages' })).toEqual(['a', 'b'])
    await expect(env.call('library_list', { collection: 'folder' })).rejects.toThrow()
  })

  it('library_set_favorite 는 ai_undo 로 되돌아간다', async () => {
    const { env, favorites } = setup()
    const result = await env.call('library_set_favorite', { doc_ids: ['b'], favorite: true }) as { updated: unknown[] }
    expect(result.updated).toEqual([{ doc_id: 'b', favorite: true }])
    expect(favorites.get('b')).toBe(true)
    await env.call('ai_undo')
    expect(favorites.get('b')).toBe(false)
    await expect(env.call('library_set_favorite', { doc_ids: ['zz'], favorite: true })).rejects.toThrow(/doc_id not found/u)
  })

  it('doc_flags·doc_info·doc_outline·ocr_status', async () => {
    const { env } = setup()
    await env.call('note_create', { title: '노트 A', doc_id: 'a' })
    await env.call('memo_add', { memos: [{ doc_id: 'a', page: 1, from_text: 'a1', note: '메모' }] })
    const flags = await env.call('doc_flags') as { docs: Record<string, { has_note: boolean; note_titles: string[]; favorite: boolean }> }
    expect(flags.docs.a).toMatchObject({ has_note: true, note_titles: ['노트 A'], favorite: true })
    expect(flags.docs.b!.has_note).toBe(false)
    const info = await env.call('doc_info', { doc_id: 'a' }) as Record<string, unknown>
    expect(info).toMatchObject({ doc_id: 'a', page_count: 2, outline_count: 3, memo_count: 1, notes: ['노트 A'], scanned: false, metadata: { author: '저자' } })
    const outline = await env.call('doc_outline', { doc_id: 'a' }) as { items: unknown[] }
    expect(outline.items).toEqual([{ title: '1장', page: 1, level: 1 }, { title: '1.1', page: 2, level: 2 }, { title: '외부', page: null, level: 1 }])
    expect(await env.call('ocr_status', { doc_id: 'b' })).toEqual({ doc_id: 'b', scanned: false, ocr: 'none', pages_with_text: 2 })
  })
})
