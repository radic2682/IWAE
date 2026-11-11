// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import type { PdfBookmark } from '../../core/pdfBookmarks'
import { fakeApp, makeEnv } from './testHarness'

vi.mock('../../bridge/pdf', async () => {
  const h = await import('./testPdf')
  return { ...(await vi.importActual<object>('../../bridge/pdf')), pageTextIndex: h.fakePageTextIndex }
})

/** 앱의 책갈피 저장소를 흉내 낸다. 상태는 app.bookmarks 가 읽는다 */
function setup(initial: PdfBookmark[] = []) {
  let list = initial
  const app = fakeApp({
    addBookmark: (docId, page, title, o) => {
      const id = `${docId}:${page}${o.y === undefined ? '' : `:${Math.round(o.y * 1000)}`}`
      list = [...list, { id, docId, page, title, createdAt: 'x', ...(o.y === undefined ? {} : { y: o.y }), ...(o.emoji === undefined ? {} : { emoji: o.emoji }) }]
      return id
    },
    updateBookmark: (id, patch) => { list = list.map((b) => (b.id === id ? { ...b, ...patch } : b)); return id },
    removeBookmark: (id) => { list = list.filter((b) => b.id !== id) },
    restoreBookmarks: (items) => { list = [...list, ...items] },
  })
  // fakeApp 은 값을 복사하므로 목록은 읽을 때마다 현재 값을 주는 접근자로 건다
  Object.defineProperty(app, 'bookmarks', { get: () => list })
  return { env: makeEnv({ app, pdfs: { d1: ['a', 'b'] } }), list: () => list }
}

describe('MCP 책갈피 도구', () => {
  it('add 는 1부터 받아 0부터 저장하고, list 는 다시 1부터 돌려주며, ai_undo 로 뺀다', async () => {
    const { env, list } = setup()
    const added = await env.call('bookmark_add', { doc_id: 'd1', page: 2, title: '둘째', y: 421 }) as { id: string }
    expect(list()[0]).toMatchObject({ page: 1, title: '둘째' })
    expect(list()[0]!.y).toBeCloseTo(0.5, 2)
    const listed = await env.call('bookmark_list', { doc_id: 'd1' }) as { bookmarks: { id: string; page: number }[] }
    expect(listed.bookmarks).toMatchObject([{ id: added.id, page: 2 }])
    await env.call('ai_undo')
    expect(list()).toHaveLength(0)
    await expect(env.call('bookmark_add', { doc_id: 'd1', page: 9, title: 'x' })).rejects.toThrow(/범위/u)
  })

  it('update 와 remove 는 되돌릴 수 있다', async () => {
    const before: PdfBookmark = { id: 'd1:0', docId: 'd1', page: 0, title: '처음', createdAt: 'x' }
    const { env, list } = setup([before])
    await env.call('bookmark_update', { id: 'd1:0', title: '바뀜' })
    expect(list()[0]!.title).toBe('바뀜')
    await env.call('ai_undo')
    expect(list()).toEqual([before])
    const removed = await env.call('bookmark_remove', { ids: ['d1:0', 'nope'] }) as { removed: string[] }
    expect(removed.removed).toEqual(['d1:0'])
    expect(list()).toHaveLength(0)
    await env.call('ai_undo')
    expect(list()).toEqual([before])
    await expect(env.call('bookmark_update', { id: 'nope' })).rejects.toThrow(/bookmark not found/u)
  })
})
