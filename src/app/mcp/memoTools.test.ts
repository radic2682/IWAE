// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clearUndo } from '../undoStack'
import { resetAiActivity } from './aiActivityStore'
import { resetAiChangeLog } from './aiChangeLog'
import { resetHighlightOverlay } from './memoTools'
import { makeEnv, type FakeEnv } from './testHarness'

vi.mock('../../bridge/pdf', async () => {
  const h = await import('./testPdf')
  return { ...(await vi.importActual<object>('../../bridge/pdf')), pageTextIndex: h.fakePageTextIndex }
})

const PAGE_ONE = 'The UVLO threshold shall be 2.6 V rising. Hysteresis is 200 mV. Startup time shall not exceed 5 ms.'

let env: FakeEnv
beforeEach(() => {
  clearUndo()
  resetAiChangeLog()
  resetAiActivity()
  resetHighlightOverlay()
  env = makeEnv({ pdfs: { d1: [PAGE_ONE, 'Second page text.'] } })
})
afterEach(() => resetAiActivity())

type Created = { id: string; quote: string; color: string; block_id?: string; note_title?: string; style?: string; warnings?: string[] }

describe('highlight_colors', () => {
  it('사용자 색 목록을 id·이름·색으로 돌려준다', async () => {
    const result = await env.call('highlight_colors') as { colors: { id: string; name: string; fill: string }[] }
    expect(result.colors.length).toBeGreaterThanOrEqual(4)
    expect(result.colors[0]).toEqual({ id: 'yellow', name: '노랑', fill: expect.stringMatching(/^#/u) })
  })
})

describe('memo_add', () => {
  it('글 메모를 만들고 note_title 이 있으면 그 노트(doc_id 에 붙여 새로 만든)에 카드를 넣는다', async () => {
    const result = await env.call('memo_add', { memos: [{ doc_id: 'd1', page: 1, from_text: 'Hysteresis is 200 mV.', note: '이력', topic: '전원', color: '초록', rating: 4 }] }) as { created: Created[] }
    expect(result.created[0]).toMatchObject({ quote: 'Hysteresis is 200 mV.', color: 'green', note_title: '전원', rating: 4 })
    expect(result.created[0]!.block_id).toBeTruthy()
    expect(env.highlights()).toHaveLength(1)
    const list = await env.call('note_list', { doc_id: 'd1' }) as { notes: { title: string; memo_count: number }[] }
    expect(list.notes).toEqual([expect.objectContaining({ title: '전원', memo_count: 1 })])
  })

  it('ticket_id/ticket_title 은 카드를 티켓으로 만들고, note_position 이 자리를 정한다', async () => {
    await env.call('note_create', { title: 'T', doc_id: 'd1' })
    await env.call('note_append', { title: 'T', blocks: [{ kind: 'section', title: '앞' }, { kind: 'section', title: '뒤' }] })
    const read = await env.call('note_read', { title: 'T' }) as { blocks: { id: string }[] }
    await env.call('memo_add', { memos: [
      { doc_id: 'd1', page: 1, from_text: 'Hysteresis', note: 'a', note_title: 'T', ticket_id: 'REQ-1', ticket_title: '이력', note_position: { before: read.blocks[1]!.id } },
      { doc_id: 'd1', page: 1, from_text: 'Startup time', note: 'b', note_title: 'T', note_position: { before: read.blocks[1]!.id } },
    ] })
    const after = await env.call('note_read', { title: 'T' }) as { blocks: { kind: string; ticket_id?: string; title?: string }[] }
    expect(after.blocks.map((block) => block.kind)).toEqual(['section', 'ticket', 'memo', 'section'])
    expect(after.blocks[1]).toMatchObject({ ticket_id: 'REQ-1' })
  })

  it('style:box 는 PDF 쪽 위의 박스 메모(노트에는 넣지 않고 box 가 쪽 안에 있다)', async () => {
    const result = await env.call('memo_add', { memos: [{ doc_id: 'd1', page: 1, from_text: 'Startup time', note: '박스', style: 'box', note_title: '무시됨' }] }) as { created: Created[] }
    expect(result.created[0]).toMatchObject({ style: 'box' })
    expect(result.created[0]!.block_id).toBeUndefined()
    expect(result.created[0]!.warnings?.[0]).toMatch(/not added to a note/u)
    const box = env.highlights()[0]!.box!
    expect(box.x).toBeGreaterThanOrEqual(0)
    expect(box.x + box.w).toBeLessThanOrEqual(595)
    expect(box.w).toBeGreaterThanOrEqual(90)
    expect(env.notes.size).toBe(0)
    // 이미 메모가 있는 글에는 박스를 만들지 않는다
    const again = await env.call('memo_add', { memos: [{ doc_id: 'd1', page: 1, from_text: 'time shall not', note: '또', style: 'box' }] }) as { created: Created[]; skipped?: { reason: string }[] }
    expect(again.created).toHaveLength(0)
    expect(again.skipped![0]!.reason).toMatch(/이미 메모/u)
  })

  it('찾지 못한 글은 skipped 에 이유와 함께 남고 나머지는 만든다', async () => {
    const result = await env.call('memo_add', { memos: [
      { doc_id: 'd1', page: 1, from_text: 'no such text', note: 'x' },
      { doc_id: 'd1', page: 9, from_text: 'x', note: 'y' },
      { doc_id: 'd1', page: 1, from_text: 'Startup time', note: 'z' },
    ] }) as { created: Created[]; skipped: { index: number; reason: string }[] }
    expect(result.created).toHaveLength(1)
    expect(result.skipped.map((item) => item.index)).toEqual([0, 1])
    expect(result.skipped[0]!.reason).toMatch(/찾지 못/u)
    expect(result.skipped[1]!.reason).toMatch(/범위/u)
  })

  it('dry_run 은 아무것도 쓰지 않는다', async () => {
    const result = await env.call('memo_add', { dry_run: true, memos: [{ doc_id: 'd1', page: 1, from_text: 'Startup time', note: 'z', topic: '노트' }] }) as { dry_run: boolean; created: Created[] }
    expect(result.dry_run).toBe(true)
    expect(result.created).toHaveLength(1)
    expect(env.highlights()).toHaveLength(0)
    expect(env.notes.size).toBe(0)
    expect(((await env.call('ai_changes', {})) as { changes: unknown[] }).changes).toHaveLength(0)
  })

  it('모르는 색 이름은 기본 색으로 두고 알린다', async () => {
    const result = await env.call('memo_add', { memos: [{ doc_id: 'd1', page: 1, from_text: 'Startup time', note: 'z', color: 'ultraviolet' }] }) as { created: Created[] }
    expect(result.created[0]!.color).toBe('yellow')
    expect(result.created[0]!.warnings![0]).toMatch(/unknown color/u)
  })

  it('한 번의 memo_add 는 한 묶음이고 ai_undo 가 형광펜과 노트 카드를 함께 지운다', async () => {
    await env.call('memo_add', { memos: [
      { doc_id: 'd1', page: 1, from_text: 'Hysteresis', note: 'a', topic: 'U' },
      { doc_id: 'd1', page: 1, from_text: 'Startup time', note: 'b', topic: 'U' },
    ] })
    expect(env.highlights()).toHaveLength(2)
    expect(((await env.call('ai_changes', {})) as { changes: unknown[] }).changes).toHaveLength(1)
    await env.call('ai_undo', {})
    expect(env.highlights()).toHaveLength(0)
    expect(env.notes.size).toBe(0)
  })
})

describe('memo_list / memo_update / memo_delete / memo_move_to_note', () => {
  async function seed() {
    await env.call('note_build', { title: 'A', doc_id: 'd1', steps: [
      { memo: { doc_id: 'd1', page: 1, from_text: 'Hysteresis', note: '이력', ticket_id: 'REQ-1', ticket_title: '이력', color: 'blue', rating: 5 } },
      { memo: { doc_id: 'd1', page: 2, from_text: 'Second page', note: '둘째' } },
    ] })
    await env.call('note_create', { title: 'B', doc_id: 'd1' })
    return (await env.call('memo_list', {})) as { memos: { id: string; page: number; note_titles: string[]; ticket: unknown; rating: number | null }[] }
  }

  it('memo_list 는 노트 제목·티켓·별점을 보이고 color/page/ticket/rating/in_notes 로 거른다', async () => {
    const all = await seed()
    expect(all.memos).toHaveLength(2)
    expect(all.memos[0]).toMatchObject({ page: 1, note_titles: ['A'], ticket: { id: 'REQ-1', title: '이력' }, rating: 5 })
    const ids = async (args: Record<string, unknown>) => ((await env.call('memo_list', args)) as { memos: { page: number }[] }).memos.map((memo) => memo.page)
    expect(await ids({ color: 'blue' })).toEqual([1])
    expect(await ids({ color: '파랑' })).toEqual([1])
    expect(await ids({ page: 2 })).toEqual([2])
    expect(await ids({ ticket: true })).toEqual([1])
    expect(await ids({ ticket: false })).toEqual([2])
    expect(await ids({ rating: 4 })).toEqual([1])
    expect(await ids({ in_notes: false })).toEqual([])
    expect(await ids({ box: true })).toEqual([])
  })

  it('memo_update 는 메모 글·색·티켓을 바꾸고 한 묶음으로 되돌려진다', async () => {
    const all = await seed()
    const id = all.memos[1]!.id
    await env.call('memo_update', { updates: [{ id, note: '바뀐 글', color: 'pink', ticket_id: 'Q-1', ticket_title: '질문', rating: 3 }] })
    const after = (await env.call('memo_list', { page: 2 })) as { memos: { note: string; color: string; ticket: unknown; rating: number }[] }
    expect(after.memos[0]).toMatchObject({ note: '바뀐 글', color: 'pink', ticket: { id: 'Q-1', title: '질문' }, rating: 3 })
    await env.call('ai_undo', {})
    const undone = (await env.call('memo_list', { page: 2 })) as { memos: { note: string; ticket: unknown }[] }
    expect(undone.memos[0]).toMatchObject({ note: '둘째', ticket: null })
  })

  it('없는 메모 id 는 skipped 로 알려 준다', async () => {
    const result = await env.call('memo_update', { updates: [{ id: 'zz', note: 'x' }] }) as { updated: string[]; skipped: { id: string; reason: string }[] }
    expect(result.updated).toEqual([])
    expect(result.skipped[0]!.reason).toMatch(/없는 메모/u)
  })

  it('memo_delete 는 형광펜과 노트 카드를 지우고 ai_undo 가 둘 다 되살린다', async () => {
    const all = await seed()
    const result = await env.call('memo_delete', { ids: [all.memos[0]!.id, 'nope'] }) as { deleted: string[] }
    expect(result.deleted).toEqual([all.memos[0]!.id])
    expect(env.highlights()).toHaveLength(1)
    expect((await env.call('note_read', { title: 'A' }) as { total: number }).total).toBe(1)
    await env.call('ai_undo', {})
    expect(env.highlights()).toHaveLength(2)
    expect((await env.call('note_read', { title: 'A' }) as { total: number }).total).toBe(2)
  })

  it('memo_move_to_note 는 다른 노트에서 빼고 목표 노트에 티켓을 지킨 채 넣는다', async () => {
    const all = await seed()
    const moved = await env.call('memo_move_to_note', { ids: [all.memos[0]!.id], note_title: 'B' }) as { moved: { id: string; block_id: string }[] }
    expect(moved.moved[0]!.block_id).toBeTruthy()
    const a = await env.call('note_read', { title: 'A' }) as { total: number }
    const b = await env.call('note_read', { title: 'B' }) as { blocks: { kind: string; ticket_id?: string }[] }
    expect(a.total).toBe(1)
    expect(b.blocks).toEqual([expect.objectContaining({ kind: 'ticket', ticket_id: 'REQ-1' })])
    await env.call('ai_undo', {})
    expect((await env.call('note_read', { title: 'A' }) as { total: number }).total).toBe(2)
    expect((await env.call('note_read', { title: 'B' }) as { total: number }).total).toBe(0)
  })
})
