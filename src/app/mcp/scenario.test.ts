// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { clearUndo } from '../undoStack'
import { resetAiActivity } from './aiActivityStore'
import { resetAiChangeLog } from './aiChangeLog'
import { resetHighlightOverlay } from './memoTools'
import { fakePages } from './testPdf'
import { makeEnv } from './testHarness'

vi.mock('../../bridge/pdf', async () => {
  const h = await import('./testPdf')
  return { ...(await vi.importActual<object>('../../bridge/pdf')), pageTextIndex: h.fakePageTextIndex }
})

/**
 * 실제로 있었던 실패의 재생: 외부 AI 가 규격서 한 절을 노트로 만들 때 인용을 글 블록의 표로 붙여 넣어,
 * 형광펜도 카드도 연결선도 없는 노트가 됐다. 이제는 한 번의 note_build 로 소제목·메모 카드·티켓·영역 메모가 이어진다.
 */
const SPEC_PAGES = [
  '4.2 Power rails. The regulator shall start within 5 ms after the enable input rises. The output shall settle to within 2 % of the target.',
  'Table 7: Output limits. Rail A 1.8 V, Rail B 3.3 V, Rail C 5.0 V. Tolerance is stated per rail.\nThe unit shall report an alert when the junction temperature exceeds 125 C.',
]

let env: ReturnType<typeof makeEnv>
beforeEach(() => {
  clearUndo()
  resetAiChangeLog()
  resetAiActivity()
  resetHighlightOverlay()
  env = makeEnv({ pdfs: { spec: SPEC_PAGES } })
})

type Block = Record<string, unknown>

/** 쪽 글에서 그대로 베낀 인용인가(공백 차이만 허용) */
const verbatim = (quote: string) => {
  const flat = (text: string) => text.replace(/\s+/gu, ' ').trim()
  return SPEC_PAGES.some((page) => flat(page).includes(flat(quote)))
}

describe('규격서 한 절을 노트로: note_create → read_pages → note_build → note_read → ai_undo', () => {
  it('인용 표 없이 메모 카드·티켓·영역 메모가 형광펜에 이어지고, ai_undo 가 처음 상태로 돌려놓는다', async () => {
    const before = { notes: env.notes.size, highlights: env.highlights().length }

    // 1) 문서에 붙은 노트를 만든다
    const created = await env.call('note_create', { doc_id: 'spec' }) as { title: string; doc_id: string; created: boolean }
    expect(created).toMatchObject({ doc_id: 'spec', created: true })

    // 2) read_pages(Rust 가 하는 일): 쪽 글을 읽고 그대로 베낄 문장을 고른다
    expect(fakePages.get('spec')).toHaveLength(2)

    // 3) 한 번에 만든다: 소제목 하나, 메모 셋(티켓 하나·영역 하나), 글 하나
    const built = await env.call('note_build', {
      title: created.title,
      doc_id: 'spec',
      steps: [
        { section: '4.2 전원 레일' },
        { memo: { doc_id: 'spec', page: 1, from_text: 'The regulator shall start within 5 ms', to_text: 'rises.', note: '기동 시간 요구.', ticket_id: 'REQ-01', ticket_title: '기동 5 ms 이내' } },
        { memo: { doc_id: 'spec', page: 1, from_text: 'The output shall settle', to_text: 'of the target.', note: '정착 오차 2 %', color: 'green' } },
        { memo: { doc_id: 'spec', page: 2, kind: 'region', from_text: 'Table 7: Output limits.', to_text: 'Tolerance is stated per rail.', note: '레일별 전압 표(다시 입력하지 않고 영역으로 잡음)' } },
        { text: '요약: 기동·정착·레일 전압 세 요구를 다룬다.' },
      ],
    }) as { created: Block[]; skipped?: unknown[]; blocks_added: number }
    expect(built.skipped).toBeUndefined()
    expect(built.created).toHaveLength(3)
    expect(built.blocks_added).toBe(5)

    // 4) 읽어서 확인한다
    const note = await env.call('note_read', { title: created.title }) as { doc_id: string; total: number; blocks: Block[]; suggested_next_ids: string[] }
    expect(note.doc_id).toBe('spec') // 노트가 문서에 붙어 있다
    expect(note.blocks.map((block) => block.kind)).toEqual(['section', 'ticket', 'memo', 'memo', 'text'])
    const memoBlocks = note.blocks.filter((block) => block.highlight_id !== undefined)
    expect(memoBlocks).toHaveLength(3)

    // 인용 표를 글 블록에 붙여 넣지 않았다
    for (const text of note.blocks.filter((block) => block.kind === 'text')) {
      const rows = String(text.text ?? '').split('\n').filter((line) => line.trim().startsWith('|'))
      expect(rows.length < 3, 'quote table in a text block').toBe(true)
      expect(String(text.html ?? '')).not.toContain('<table')
    }
    // 모든 메모 카드는 실제 형광펜을 가리키고, 인용은 쪽 글 그대로이며, 영역 메모는 글을 다시 치지 않는다
    for (const block of memoBlocks) {
      const highlight = env.highlights().find((item) => item.id === block.highlight_id)
      expect(highlight, `highlight for ${String(block.id)}`).toBeDefined()
      expect(highlight!.anchor.rects.length).toBeGreaterThan(0)
      if (block.memo_kind !== 'region') expect(verbatim(String(block.quote))).toBe(true)
    }
    expect(memoBlocks.find((block) => block.memo_kind === 'region')).toMatchObject({ page: 2 })
    expect(memoBlocks[0]).toMatchObject({ ticket_id: 'REQ-01', quote: expect.stringContaining('regulator shall start') })
    expect(note.suggested_next_ids).toEqual(['REQ-02'])

    // 5) 한 묶음으로 기록됐고(노트 만들기 + 빌드는 각각 한 번의 AI 변경), 모두 되돌리면 처음 상태다
    const changes = await env.call('ai_changes', {}) as { changes: { tool: string; undone: boolean }[] }
    expect(changes.changes.map((change) => change.tool)).toEqual(['note_build', 'note_create'])
    const undone = await env.call('ai_undo', { steps: 2 }) as { undone: number[]; skipped: unknown[] }
    expect(undone.undone).toHaveLength(2)
    expect(undone.skipped).toEqual([])
    expect({ notes: env.notes.size, highlights: env.highlights().length }).toEqual(before)
  })

  it('사람이 노트를 고친 뒤에는 ai_undo 가 그 묶음을 건너뛴다', async () => {
    const created = await env.call('note_create', { doc_id: 'spec' }) as { title: string }
    await env.call('note_build', { title: created.title, steps: [{ section: '하나' }, { text: '글' }] })
    // 사람이 같은 노트를 고친다(앱의 노트 저장소가 되돌리기를 남기는 방식)
    const { recordUndo } = await import('../undoStack')
    const path = [...env.notes.keys()][0]!
    const note = env.notes.get(path)!
    const edited = { ...note, blocks: [...note.blocks, { id: 'human', kind: 'text' as const, text: '내 글' }] }
    recordUndo({ key: `note:${path}`, undo: () => env.notes.set(path, note), redo: () => env.notes.set(path, edited) })
    env.notes.set(path, edited)
    const result = await env.call('ai_undo', {}) as { undone: number[]; skipped: { reason: string }[] }
    expect(result.undone).toEqual([])
    expect(result.skipped[0]!.reason).toBe('edited since')
    expect((await env.call('note_read', { title: created.title }) as { total: number }).total).toBe(3)
  })
})
