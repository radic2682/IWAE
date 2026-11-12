// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { NoteFlow, type NoteFlowItem } from './NoteFlow'
import { MemoFormatSlotContext } from './MemoColumn'
import { MemoNoteContext, clearBlockReveal, peekBlockReveal, type MemoNoteApi } from './memoNoteContext'
import { buildTicketIndex } from '../core/memoTickets'
import type { MemoNote } from '../core/memoNote'

const handlers = () => ({
  editingKey: null,
  activeKey: null,
  pageSizeOf: () => undefined,
  onEdit: vi.fn(),
  onActivate: vi.fn(),
  onSaveMemo: vi.fn(),
  onCancelDraft: vi.fn(),
  onSaveText: vi.fn(),
  onRemoveText: vi.fn(),
  onRecolor: vi.fn(),
  onDeleteMemo: vi.fn(),
  onToggleCollapse: vi.fn(),
  onRate: vi.fn(),
  onMove: vi.fn(),
  onJump: vi.fn(),
  onCardLayout: vi.fn(),
})

const highlight = (id: string, quote: string) => ({
  id, color: 'green' as const, note: '메모',
  anchor: { docId: 'd', page: 1, coordSpace: 'pdfium-page' as const, rects: [{ x: 1, y: 1, w: 1, h: 1 }], charRange: [0, 1] as const, quote, prefix: '', suffix: '' },
})
const HIGHLIGHTS = new Map([['h1', highlight('h1', '로그인은 세션을 만든다')], ['h2', highlight('h2', '저장은 자동이다')], ['h3', highlight('h3', '다른 원문')]])

const memo = (id: string, highlightId: string, ticket?: { id: string; title?: string }) => ({ id, kind: 'memo' as const, highlightId, ...(ticket === undefined ? {} : { ticket }) })

type TestApi = MemoNoteApi & { updateOpen: ReturnType<typeof vi.fn>; open: ReturnType<typeof vi.fn> }

function setup(notes: Record<string, MemoNote>, openPath: string): TestApi {
  const map = new Map(Object.entries(notes))
  return {
    entries: [], openPath, openTitle: openPath, openNote: map.get(openPath)!, open: vi.fn(), create: vi.fn(), notesOf: () => [],
    updateOpen: vi.fn(), noteAt: () => null, updateNoteAt: vi.fn(), tickets: buildTicketIndex(map), highlightOf: (id: string) => HIGHLIGHTS.get(id), setTicket: vi.fn(),
  } as unknown as TestApi
}

const note = (...blocks: MemoNote['blocks'][number][]): MemoNote => ({ version: 1, blocks })
const items = (...entries: Array<[string, string, { id: string; title?: string }?]>): NoteFlowItem[] => entries.map(([key, highlightId, ticket]) => ({ kind: 'memo', key, highlight: HIGHLIGHTS.get(highlightId)!, ...(ticket === undefined ? {} : { ticket }) }))

function view(api: MemoNoteApi, flow: NoteFlowItem[], extra: Record<string, unknown> = {}) {
  return render(
    <MemoNoteContext.Provider value={api}>
      <MemoFormatSlotContext.Provider value={null}>
        <NoteFlow {...handlers()} items={flow} onInsertText={vi.fn()} onSetTicket={vi.fn()} {...extra} />
      </MemoFormatSlotContext.Provider>
    </MemoNoteContext.Provider>,
  )
}

describe('NoteFlow — 블록 사이 + 와 티켓', () => {
  it('+ 는 글 넣기 / 티켓 넣기 메뉴를 연다. 글 넣기는 예전처럼 글 블록을 넣는다', () => {
    const api = setup({ 'N/A.iwnote': note(memo('a1', 'h1', { id: 'REQ-01', title: '로그인' })) }, 'N/A.iwnote')
    const onInsertText = vi.fn()
    view(api, items(['a1', 'h1', { id: 'REQ-01', title: '로그인' }]), { onInsertText })
    fireEvent.click(screen.getByRole('button', { name: '여기에 넣기' }))
    const menu = screen.getByRole('menu', { name: '블록 사이에 넣기' })
    expect(within(menu).getAllByRole('menuitem').map((item) => item.textContent)).toEqual(['글 넣기', '티켓 넣기'])
    fireEvent.click(within(menu).getByRole('menuitem', { name: '글 넣기' }))
    expect(onInsertText).toHaveBeenCalledWith('a1')
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('티켓 넣기: 모든 노트의 티켓을 ID·제목·노트·원문으로 찾아, 같은 형광펜·같은 티켓의 블록을 그 자리에 넣는다. 이 노트에 있는 것은 고를 수 없다', () => {
    const api = setup({
      'N/A.iwnote': note(memo('a1', 'h1', { id: 'REQ-01', title: '로그인' })),
      'N/B.iwnote': note(memo('b1', 'h2', { id: 'REQ-02', title: '자동 저장' }), memo('b2', 'h1', { id: 'REQ-01', title: '로그인' })),
    }, 'N/A.iwnote')
    view(api, items(['a1', 'h1', { id: 'REQ-01', title: '로그인' }]))
    fireEvent.click(screen.getByRole('button', { name: '여기에 넣기' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '티켓 넣기' }))
    const list = screen.getByRole('listbox', { name: '티켓 목록' })
    const rows = within(list).getAllByRole('option')
    expect(rows).toHaveLength(2)
    expect(rows[0]!.textContent).toContain('REQ-01')
    expect(rows[1]!.textContent).toContain('REQ-02')
    // 노트 이름과 원문 글이 보인다
    expect(rows[1]!.textContent).toContain('B')
    expect(rows[1]!.textContent).toContain('저장은 자동이다')
    // 이 노트에 이미 있는 티켓은 고를 수 없다
    expect(rows[0]!.getAttribute('aria-disabled')).toBe('true')
    fireEvent.click(rows[0]!)
    expect(api.updateOpen).not.toHaveBeenCalled()

    // 검색: 원문 글로도 찾는다
    const search = screen.getByRole('combobox', { name: '티켓 찾기' })
    fireEvent.change(search, { target: { value: '자동이다' } })
    expect(within(screen.getByRole('listbox', { name: '티켓 목록' })).getAllByRole('option')).toHaveLength(1)
    fireEvent.keyDown(search, { key: 'Enter' })
    expect(api.updateOpen).toHaveBeenCalledTimes(1)
    const inserted = (api.updateOpen.mock.calls[0]![0] as (current: MemoNote) => MemoNote)(api.openNote!)
    expect(inserted.blocks.map((block) => (block.kind === 'memo' ? `${block.highlightId}:${block.ticket?.id}` : block.kind))).toEqual(['h1:REQ-01', 'h2:REQ-02'])
    expect(inserted.blocks[1]).toMatchObject({ kind: 'memo', ticket: { id: 'REQ-02', title: '자동 저장' } })
    expect(peekBlockReveal()?.path).toBe('N/A.iwnote')
    clearBlockReveal()
  })

  it('티켓이 하나도 없으면 안내를 보인다', () => {
    const api = setup({ 'N/A.iwnote': note(memo('a1', 'h1')) }, 'N/A.iwnote')
    view(api, items(['a1', 'h1']))
    fireEvent.click(screen.getByRole('button', { name: '여기에 넣기' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '티켓 넣기' }))
    expect(screen.getByText(/아직 티켓이 없습니다/u)).toBeTruthy()
  })

  it('같은 ID 가 여러 곳에 있으면 「n곳」 배지가 뜨고, 누르면 곳들을 나열하며 하나를 누르면 그 노트의 그 블록으로 간다', () => {
    const api = setup({
      'N/A.iwnote': note({ id: 's1', kind: 'section', title: '1장' }, memo('a1', 'h1', { id: 'REQ-01', title: '로그인' })),
      'N/B.iwnote': note(memo('b1', 'h1', { id: 'REQ-01', title: '로그인' })),
    }, 'N/A.iwnote')
    view(api, items(['a1', 'h1', { id: 'REQ-01', title: '로그인' }]))
    const badge = screen.getByRole('button', { name: '2곳' })
    expect(badge.className).not.toContain('warn')
    fireEvent.click(badge)
    const popover = screen.getByRole('dialog', { name: 'REQ-01 가 있는 곳' })
    const entries = within(popover).getAllByRole('button')
    expect(entries.map((entry) => entry.textContent)).toEqual(['A여기1장 · 2번째 블록', 'B1번째 블록'])
    expect(entries[0]!.getAttribute('aria-current')).toBe('true')
    fireEvent.click(entries[1]!)
    expect(api.open).toHaveBeenCalledWith('N/B.iwnote')
    expect(peekBlockReveal()).toMatchObject({ path: 'N/B.iwnote', blockId: 'b1' })
    clearBlockReveal()
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('같은 ID 를 서로 다른 메모가 쓰면 경고 배지이고, 목록에 두 메모가 나뉘어 보인다', () => {
    const api = setup({
      'N/A.iwnote': note(memo('a1', 'h1', { id: 'REQ-01', title: '로그인' })),
      'N/B.iwnote': note(memo('b1', 'h3', { id: 'REQ-01', title: '다른 것' })),
    }, 'N/A.iwnote')
    view(api, items(['a1', 'h1', { id: 'REQ-01', title: '로그인' }]))
    const badge = screen.getByRole('button', { name: '2곳' })
    expect(badge.className).toContain('note-ticket-badge-warn')
    fireEvent.click(badge)
    const popover = screen.getByRole('dialog')
    expect(within(popover).getByRole('status').textContent).toContain('서로 다른 메모 2개')
    expect(popover.textContent).toContain('로그인은 세션을 만든다')
    expect(popover.textContent).toContain('다른 원문')
  })

  it('ID 가 한 곳뿐이면 배지가 없다', () => {
    const api = setup({ 'N/A.iwnote': note(memo('a1', 'h1', { id: 'REQ-01' })) }, 'N/A.iwnote')
    view(api, items(['a1', 'h1', { id: 'REQ-01' }]))
    expect(screen.queryByRole('button', { name: /곳$/u })).toBeNull()
  })
})
