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
const PAGE_TWO = 'Table 3: Thermal limits. Junction temperature shall stay below 125 C.'

let env: FakeEnv
beforeEach(() => {
  clearUndo()
  resetAiChangeLog()
  resetAiActivity()
  resetHighlightOverlay()
  env = makeEnv({ pdfs: { d1: [PAGE_ONE, PAGE_TWO] } })
})
afterEach(() => resetAiActivity())

type Block = Record<string, unknown>

describe('note_create / note_list / note_read', () => {
  it('note_create 는 doc_id 가 있으면 그 PDF 의 노트를 만들고, 같은 제목은 다시 만들지 않는다', async () => {
    const first = await env.call('note_create', { title: '전원 요구사항', doc_id: 'd1' })
    expect(first).toMatchObject({ title: '전원 요구사항', doc_id: 'd1', created: true })
    const again = await env.call('note_create', { title: '전원 요구사항', doc_id: 'd1' })
    expect(again).toMatchObject({ created: false })
    const unique = await env.call('note_create', { title: '전원 요구사항', doc_id: 'd1', unique: true })
    expect(unique).toMatchObject({ created: true, title: '전원 요구사항 2' })
    const list = await env.call('note_list', { doc_id: 'd1' }) as { notes: { title: string; doc_id: string }[] }
    expect(list.notes.map((note) => note.title).sort()).toEqual(['전원 요구사항', '전원 요구사항 2'])
  })

  it('제목 없이 doc_id 만 주면 그 문서의 노트 제목을 쓰고, 없는 문서는 알려 준다', async () => {
    const made = await env.call('note_create', { doc_id: 'd1' }) as { title: string }
    expect(made.title).toContain('d1')
    await expect(env.call('note_create', { doc_id: 'nope' })).rejects.toThrow(/doc_id not found/u)
  })

  it('없는 노트는 「노트가 없습니다」로 알린다', async () => {
    await expect(env.call('note_read', { title: '없음' })).rejects.toThrow(/노트가 없습니다/u)
    await expect(env.call('note_build', { title: '없음', create: false, steps: [{ section: 'a' }] })).rejects.toThrow(/노트가 없습니다/u)
  })

  it('folder 는 노트 폴더 안으로만(「..」 거절)', async () => {
    await expect(env.call('note_create', { title: 'x', folder: '../밖' })).rejects.toThrow(/folder/u)
    const made = await env.call('note_create', { title: 'x', folder: '회의' }) as { path: string }
    expect(made.path.startsWith('노트/회의/')).toBe(true)
  })
})

describe('note_build', () => {
  const steps = [
    { section: '전원' },
    { memo: { doc_id: 'd1', page: 1, from_text: 'The UVLO threshold', to_text: '2.6 V rising.', note: '문턱 전압', ticket_id: 'REQ-01', ticket_title: 'UVLO 문턱', color: 'green' } },
    { text: '**요약** 문턱은 2.6 V.' },
    { memo: { doc_id: 'd1', page: 2, kind: 'region', from_text: 'Table 3: Thermal limits.', note: '표 3' } },
    { block_ref: { highlight_id: 'missing' } },
    { memo: { doc_id: 'd1', page: 1, from_text: 'not in the page', note: '없는 글' } },
  ]

  it('메모를 먼저 만들고 모든 블록을 한 번의 edit 로 넣어 차례가 단계 차례와 같고, 한 묶음으로 되돌려진다', async () => {
    await env.call('note_create', { title: '전원', doc_id: 'd1' })
    const edits = vi.spyOn(env.deps.notes!, 'edit')
    const built = await env.call('note_build', { title: '전원', steps }) as { created: Block[]; skipped: { index: number; reason: string }[]; blocks_added: number }
    expect(edits).toHaveBeenCalledTimes(1)
    expect(built.blocks_added).toBe(4)
    expect(built.created).toHaveLength(2)
    expect(built.created[0]).toMatchObject({ step: 1, quote: 'The UVLO threshold shall be 2.6 V rising.', color: 'green' })
    expect(built.skipped.map((item) => item.index).sort()).toEqual([4, 5])
    expect(built.skipped.find((item) => item.index === 5)!.reason).toMatch(/찾지 못|not found/u)
    const read = await env.call('note_read', { title: '전원' }) as { blocks: Block[]; total: number; doc_id: string; suggested_next_ids: string[] }
    expect(read.doc_id).toBe('d1')
    expect(read.blocks.map((block) => block.kind)).toEqual(['section', 'ticket', 'text', 'memo'])
    expect(read.blocks[1]).toMatchObject({ ticket_id: 'REQ-01', ticket: { id: 'REQ-01', title: 'UVLO 문턱' }, section_id: read.blocks[0]!.id })
    expect(read.blocks[3]).toMatchObject({ memo_kind: 'region', page: 2 })
    expect(read.suggested_next_ids).toEqual(['REQ-02'])
    // 형광펜은 노트 블록이 가리키는 것과 같다
    for (const block of read.blocks.filter((item) => item.highlight_id !== undefined)) {
      expect(env.highlights().some((highlight) => highlight.id === block.highlight_id)).toBe(true)
    }
    const changes = await env.call('ai_changes', {}) as { changes: { tool: string }[] }
    expect(changes.changes.filter((change) => change.tool === 'note_build')).toHaveLength(1)
    const undone = await env.call('ai_undo', {}) as { undone: number[] }
    expect(undone.undone).toHaveLength(1)
    expect(env.highlights()).toHaveLength(0)
    const after = await env.call('note_read', { title: '전원' }) as { total: number }
    expect(after.total).toBe(0)
  })

  it('create 가 기본이라 없는 노트도 doc_id 에 붙여 만든다', async () => {
    await env.call('note_build', { title: '새 요약', doc_id: 'd1', steps: [{ section: '하나' }] })
    const list = await env.call('note_list', {}) as { notes: { title: string; doc_id: string }[] }
    expect(list.notes).toEqual([expect.objectContaining({ title: '새 요약', doc_id: 'd1' })])
    // 노트 만들기까지 포함해 한 번에 되돌려진다
    await env.call('ai_undo', {})
    expect(env.notes.size).toBe(0)
  })

  it('position 으로 기존 블록 앞에 끼운다', async () => {
    await env.call('note_build', { title: 'A', doc_id: 'd1', steps: [{ section: '끝' }] })
    const first = await env.call('note_read', { title: 'A' }) as { blocks: Block[] }
    await env.call('note_build', { title: 'A', position: { before: first.blocks[0]!.id }, steps: [{ section: '앞' }, { text: '글' }] })
    const read = await env.call('note_read', { title: 'A' }) as { blocks: Block[] }
    expect(read.blocks.map((block) => block.title ?? 'text')).toEqual(['앞', 'text', '끝'])
  })

  it('한 단계에 종류가 둘이면 그 단계만 건너뛴다', async () => {
    const built = await env.call('note_build', { title: 'B', doc_id: 'd1', steps: [{ section: 'a', text: 'b' }, { section: 'ok' }] }) as { skipped: { index: number }[]; blocks_added: number }
    expect(built.skipped[0]!.index).toBe(0)
    expect(built.blocks_added).toBe(1)
  })
})

describe('note_append / note_update_block / note_move_blocks / note_delete_blocks', () => {
  it('append 는 위치(after/before/index/section_id)에 끼운다', async () => {
    await env.call('note_create', { title: 'N' })
    const first = await env.call('note_append', { title: 'N', blocks: [{ kind: 'section', title: '하나' }, { kind: 'section', title: '셋' }] }) as { added: { id: string }[] }
    const [one] = first.added.map((block) => block.id) as [string]
    const middle = await env.call('note_append', { title: 'N', after: one, blocks: [{ kind: 'text', markdown: '- 둘' }] }) as { added: { id: string }[] }
    await env.call('note_append', { title: 'N', section_id: one, blocks: [{ kind: 'text', markdown: '하나 끝' }] })
    await env.call('note_append', { title: 'N', index: 0, blocks: [{ kind: 'section', title: '맨 앞' }] })
    const read = await env.call('note_read', { title: 'N' }) as { blocks: Block[] }
    expect(read.blocks.map((block) => String(block.title ?? block.text).trim())).toEqual(['맨 앞', '하나', '둘', '하나 끝', '셋'])
    expect(middle.added).toHaveLength(1)
  })

  it('티켓 블록은 title 이 필요하고, 없는 메모는 알려 준다', async () => {
    await env.call('note_create', { title: 'N' })
    await expect(env.call('note_append', { title: 'N', blocks: [{ kind: 'ticket', highlight_id: 'zz' }] })).rejects.toThrow(/없는 메모/u)
  })

  it('update_block: 소제목 제목·접기, 글 블록, 티켓 지우기', async () => {
    await env.call('note_build', { title: 'U', doc_id: 'd1', steps: [{ section: '제목' }, { text: '글' }, { memo: { doc_id: 'd1', page: 1, from_text: 'Hysteresis is 200 mV.', note: 'x', ticket_id: 'Q1', ticket_title: '질문' } }] })
    const read = await env.call('note_read', { title: 'U' }) as { blocks: Block[] }
    const [section, text, memo] = read.blocks as [Block, Block, Block]
    expect(await env.call('note_update_block', { title: 'U', id: section.id, section_title: '새 제목', collapsed: true })).toEqual({ updated: { id: section.id, kind: 'section' } })
    await env.call('note_update_block', { title: 'U', id: text.id, markdown: '*바꿈*' })
    await env.call('note_update_block', { title: 'U', id: memo.id, ticket_id: '', ticket_title: '' })
    const after = await env.call('note_read', { title: 'U' }) as { blocks: Block[] }
    expect(after.blocks[0]).toMatchObject({ title: '새 제목', collapsed: true })
    expect(after.blocks[1]!.html).toBe('<i>바꿈</i>')
    expect(after.blocks[2]).toMatchObject({ kind: 'memo' })
    expect(after.blocks[2]!.ticket).toBeUndefined()
    await expect(env.call('note_update_block', { title: 'U', id: 'nope', markdown: 'x' })).rejects.toThrow(/block not found/u)
  })

  it('move_blocks: before / after / to_end / section_id, 소제목은 묶음째', async () => {
    await env.call('note_build', { title: 'M', doc_id: 'd1', steps: [{ section: 'A' }, { text: 'a1' }, { text: 'a2' }, { section: 'B' }, { text: 'b1' }] })
    const read = await env.call('note_read', { title: 'M' }) as { blocks: Block[] }
    const [A, a1, a2, B, b1] = read.blocks.map((block) => block.id as string) as [string, string, string, string, string]
    const order = async () => ((await env.call('note_read', { title: 'M' }) as { blocks: Block[] }).blocks.map((block) => String(block.title ?? block.text).trim()))
    await env.call('note_move_blocks', { title: 'M', ids: [b1], before: a1 })
    expect(await order()).toEqual(['A', 'b1', 'a1', 'a2', 'B'])
    await env.call('note_move_blocks', { title: 'M', ids: [a2, a1], after: A })
    expect(await order()).toEqual(['A', 'a2', 'a1', 'b1', 'B'])
    await env.call('note_move_blocks', { title: 'M', ids: [A], to_end: true })
    expect(await order()).toEqual(['B', 'A', 'a2', 'a1', 'b1'])
    await env.call('note_move_blocks', { title: 'M', ids: [a1], section_id: B })
    expect(await order()).toEqual(['B', 'a1', 'A', 'a2', 'b1'])
    await expect(env.call('note_move_blocks', { title: 'M', ids: [a1], before: 'nope' })).rejects.toThrow(/not found/u)
    await expect(env.call('note_move_blocks', { title: 'M', ids: [a1], before: a1 })).rejects.toThrow(/기준 블록/u)
  })

  it('delete_blocks 는 지운 id 만 돌려주고 ai_undo 로 되살린다', async () => {
    await env.call('note_build', { title: 'D', doc_id: 'd1', steps: [{ section: 'A' }, { text: 'x' }] })
    const read = await env.call('note_read', { title: 'D' }) as { blocks: Block[] }
    const deleted = await env.call('note_delete_blocks', { title: 'D', ids: [read.blocks[1]!.id, 'nope'] }) as { deleted: string[] }
    expect(deleted.deleted).toEqual([read.blocks[1]!.id])
    await env.call('ai_undo', {})
    expect((await env.call('note_read', { title: 'D' }) as { total: number }).total).toBe(2)
  })
})

describe('note_rename / note_delete / note_export_markdown', () => {
  it('rename 은 겹치는 제목을 거절하고, 이름을 바꾼 뒤 되돌린다', async () => {
    await env.call('note_create', { title: '하나' })
    await env.call('note_create', { title: '둘' })
    await expect(env.call('note_rename', { title: '하나', new_title: '둘' })).rejects.toThrow(/already exists/u)
    expect(await env.call('note_rename', { title: '하나', new_title: '셋' })).toEqual({ title: '하나', new_title: '셋' })
    await env.call('ai_undo', {})
    expect([...env.notes.keys()].map((path) => path.split('/').pop()).sort()).toEqual(['둘.iwnote', '하나.iwnote'])
  })

  it('delete 는 휴지통으로 보내고 ai_undo 가 같은 내용으로 되살린다', async () => {
    await env.call('note_build', { title: '지울 노트', doc_id: 'd1', steps: [{ section: 'A' }, { text: '내용' }] })
    const gone = await env.call('note_delete', { title: '지울 노트', confirm: true }) as { deleted: string }
    expect(gone.deleted).toBe('지울 노트')
    expect(env.trashed).toHaveLength(1)
    expect(env.notes.size).toBe(0)
    await env.call('ai_undo', {})
    const back = await env.call('note_read', { title: '지울 노트' }) as { total: number; doc_id: string }
    expect(back).toMatchObject({ total: 2, doc_id: 'd1' })
  })

  it('export 는 Markdown 글을 돌려주고 인용은 blockquote 다', async () => {
    await env.call('note_build', { title: '내보내기', doc_id: 'd1', steps: [{ section: '전원' }, { memo: { doc_id: 'd1', page: 1, from_text: 'Hysteresis is 200 mV.', note: '이력' } }] })
    const out = await env.call('note_export_markdown', { title: '내보내기' }) as { markdown: string }
    expect(out.markdown).toContain('## 전원')
    expect(out.markdown).toContain('> Hysteresis is 200 mV.')
    expect(out.markdown).toContain('이력')
  })
})

describe('노트가 밖에서 바뀌었을 때', () => {
  it('저장이 거부되면 「디스크에서 바뀌었다」고 알리고 note_read 를 권한다', async () => {
    await env.call('note_create', { title: 'S' })
    env.state.refuseEdits = true
    await expect(env.call('note_append', { title: 'S', blocks: [{ kind: 'section', title: 'x' }] })).rejects.toThrow(/changed on disk/u)
    env.state.refuseEdits = false
    expect((await env.call('note_read', { title: 'S' }) as { total: number }).total).toBe(0)
  })

  it('충돌이 잡힌 노트는 쓰기 전에 거절한다', async () => {
    await env.call('note_create', { title: 'C' })
    env.state.conflictPath = [...env.notes.keys()][0]!
    await expect(env.call('note_build', { title: 'C', steps: [{ section: 'x' }] })).rejects.toThrow(/changed on disk/u)
    expect([...env.notes.values()][0]!.blocks).toHaveLength(0)
  })
})
