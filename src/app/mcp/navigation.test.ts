// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { fakeApp, makeEnv } from './testHarness'
import type { McpLibraryDoc } from './types'

vi.mock('../../bridge/pdf', async () => {
  const h = await import('./testPdf')
  return { ...(await vi.importActual<object>('../../bridge/pdf')), pageTextIndex: h.fakePageTextIndex }
})

const doc = (docId: string): McpLibraryDoc => ({ docId, title: `문서 ${docId}`, kind: 'pdf', folder: '', favorite: false, pageCount: 3, lastOpenedAt: null, addedAt: null, pagesWithText: null, scanned: null, ocr: null })

function setup() {
  const openDocument = vi.fn(async (_id: string, o: { page?: number }) => ({ pane: 'right' as const, page: o.page ?? null }))
  const goto = vi.fn(async (i: { flash: boolean }) => ({ flashed: i.flash }))
  const closeTab = vi.fn(() => true)
  const app = fakeApp({
    docs: [doc('d1')],
    openDocument,
    goto,
    closeTab,
    panes: { left: { tabs: [{ id: 'd1', title: 'T', kind: 'pdf' }], activeId: 'd1' }, right: { tabs: [], activeId: null }, third: { tabs: [], activeId: null }, fourth: { tabs: [], activeId: null } },
  })
  const env = makeEnv({ app, pdfs: { d1: ['a', 'b', 'c'] } })
  return { env, openDocument, goto, closeTab }
}

describe('MCP 탐색 도구', () => {
  it('open_document 는 문서와 쪽을 확인하고 연다', async () => {
    const { env, openDocument } = setup()
    const result = await env.call('open_document', { doc_id: 'd1', page: 2, pane: 'right' }) as { opened: unknown }
    expect(result.opened).toEqual({ doc_id: 'd1', pane: 'right', page: 2 })
    expect(openDocument).toHaveBeenCalledWith('d1', { pane: 'right', page: 2, activate: true })
    await expect(env.call('open_document', { doc_id: 'zz' })).rejects.toThrow(/doc_id not found/u)
    await expect(env.call('open_document', { doc_id: 'd1', page: 9 })).rejects.toThrow(/범위/u)
  })

  it('goto 는 flash 기본 true 로 이동한다', async () => {
    const { env, goto } = setup()
    const result = await env.call('goto', { doc_id: 'd1', page: 1, quote: 'a' }) as { went: unknown }
    expect(result.went).toEqual({ doc_id: 'd1', page: 1, flashed: true })
    expect(goto).toHaveBeenCalledWith({ docId: 'd1', page: 1, flash: true, quote: 'a' })
  })

  it('open_note 는 제목으로 노트를 찾고 없으면 노트가 없다고 알린다', async () => {
    const { env } = setup()
    await env.call('note_create', { title: 'N' })
    const opened = await env.call('open_note', { title: 'n' }) as { opened: { title: string } }
    expect(opened.opened.title).toBe('N')
    await expect(env.call('open_note', { title: '없음' })).rejects.toThrow(/노트가 없습니다/u)
  })

  it('set_layout 은 범위를 검사하고 close_tab 은 모르는 탭을 거절한다', async () => {
    const { env, closeTab } = setup()
    expect(await env.call('set_layout', { pane_count: 2, focus: 'right' })).toEqual({ pane_count: 2, active_pane: 'right' })
    await expect(env.call('set_layout', { pane_count: 5 })).rejects.toThrow()
    await expect(env.call('set_layout', { pane_count: 1, focus: 'right' })).rejects.toThrow()
    expect(await env.call('close_tab', { tab_id: 'd1' })).toEqual({ closed: 'd1' })
    expect(closeTab).toHaveBeenCalledWith('d1')
    await expect(env.call('close_tab', { tab_id: 'nope' })).rejects.toThrow(/tab not found/u)
  })

  it('앱 화면이 없으면 분명히 알린다', async () => {
    const env = makeEnv()
    await expect(env.call('set_layout', { pane_count: 2 })).rejects.toThrow(/app UI not available/u)
  })
})
