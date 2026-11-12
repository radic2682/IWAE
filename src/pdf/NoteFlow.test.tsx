// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { NoteFlow, type NoteFlowItem } from './NoteFlow'
import { MemoFormatSlotContext } from './MemoColumn'

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

describe('NoteFlow — 소제목', () => {
  it('소제목은 묶인 블록 수와 함께 보이고, 접기·이름 바꾸기, 우클릭 메뉴로 지운다. 손잡이는 없다', () => {
    const props = { ...handlers(), onToggleSection: vi.fn(), onRenameSection: vi.fn(), onRemoveSection: vi.fn() }
    const items: NoteFlowItem[] = [
      { kind: 'section', key: 's1', title: '타이밍', collapsed: false, count: 1 },
      { kind: 'text', key: 't1', text: '본문 글' },
    ]
    const { container, rerender } = render(<NoteFlow {...props} items={items} />)
    expect(container.querySelector('.note-section-title')?.textContent).toBe('타이밍')
    expect(container.querySelector('.note-section-count')?.textContent).toBe('1')
    expect(container.querySelector('.pdf-memo-grip')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '타이밍 접기' }))
    expect(props.onToggleSection).toHaveBeenCalledWith('s1', true)
    fireEvent.doubleClick(container.querySelector('.note-section-title')!)
    expect(props.onEdit).toHaveBeenCalledWith('s1')
    rerender(<NoteFlow {...props} items={items} editingKey="s1" />)
    const input = screen.getByRole('textbox', { name: '소제목' })
    fireEvent.change(input, { target: { value: '타이밍 요구' } })
    fireEvent.blur(input)
    expect(props.onRenameSection).toHaveBeenCalledWith('s1', '타이밍 요구')
    rerender(<NoteFlow {...props} items={items} />)
    fireEvent.contextMenu(container.querySelector('.note-section')!)
    fireEvent.click(screen.getByRole('menuitem', { name: '소제목 지우기(블록은 남김)' }))
    expect(props.onRemoveSection).toHaveBeenCalledWith('s1')
  })

  it('메모 블록은 내 메모가 먼저, 출처(원문)는 맨 아래. 원문은 형광펜 색 한 줄 칩으로 접혀 있다. 칩을 누르면 PDF 로, 펼치면 원문 전체', () => {
    const props = { ...handlers(), onInsertSection: vi.fn(), onInsertText: vi.fn() }
    const highlight = {
      id: 'h1', color: 'green' as const, note: '쓴 메모', rating: 2,
      anchor: { docId: 'd', page: 30, coordSpace: 'pdfium-page' as const, rects: [{ x: 1, y: 1, w: 1, h: 1 }], charRange: [0, 1] as const, quote: '원문 글', prefix: '', suffix: '' },
    }
    const items: NoteFlowItem[] = [{ kind: 'memo', key: 'b1', highlight }]
    const { container, rerender } = render(<NoteFlow {...props} items={items} />)
    expect(container.querySelector('.pdf-memo-card-head')).toBeNull()
    const card = container.querySelector('.pdf-memo-card-flow')!
    // 출처(PDF 이름 · 쪽)는 블록 위 테두리 왼쪽 탭에(호버할 때만 CSS 로 보인다). 단추 탭은 오른쪽
    expect(card.querySelector('.note-tab-l')?.textContent).toBe('PDF · p.31')
    expect(card.querySelector('.note-tab-r .note-tab-more')).not.toBeNull()
    expect(document.querySelector('.note-source-float')).toBeNull()
    expect(document.querySelector('.note-source-float')).toBeNull()
    const memoText = card.querySelector('.pdf-memo-card-text')!
    const chip = card.querySelector('.note-source-chip[data-hl="green"]')!
    expect(chip.textContent).toContain('원문 글')
    expect(chip.textContent).toContain('p.31')
    expect(chip.querySelector('.note-source-stars')?.textContent).toBe('★★')
    // 출처 칩은 늘 맨 아래(메모 다음)
    expect(chip.compareDocumentPosition(memoText) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy()
    expect(container.querySelector('.pdf-memo-card-quote')).toBeNull()
    fireEvent.click(chip)
    expect(props.onJump).toHaveBeenCalledWith(highlight)
    expect(props.onToggleCollapse).not.toHaveBeenCalled()
    // 색 점이 펼치기 단추(칩을 누른 것처럼 원문으로 가지는 않는다)
    const dot = screen.getByRole('button', { name: '근거 펼치기' })
    expect(dot.getAttribute('aria-expanded')).toBe('false')
    props.onJump.mockClear()
    fireEvent.click(dot)
    expect(props.onToggleCollapse).toHaveBeenCalledWith('h1', false)
    expect(props.onJump).not.toHaveBeenCalled()
    // 펼쳐 두면 원문 전체, 점은 접기 단추, 메뉴는 「원문 접기」
    rerender(<NoteFlow {...props} items={items} openQuotes={new Set(['h1'])} />)
    expect(container.querySelector('.note-source[data-hl="green"]')?.textContent).toContain('원문 글')
    // 형광펜 색이 닿는 것은 따옴표 글(.note-source-quote)뿐: 쪽 번호 · 번역 단추는 그 바깥(형제)이다
    const source = container.querySelector('.note-source[data-hl="green"]')!
    const quote = source.querySelector('.note-source-quote')!
    expect(quote.textContent).toBe('원문 글')
    expect(quote.querySelector('.note-source-page, .note-source-translate')).toBeNull()
    expect(quote.parentElement).toBe(source)
    expect(source.querySelector(':scope > .note-source-page')).not.toBeNull()
    expect(screen.getByRole('button', { name: '근거 접기' }).getAttribute('aria-expanded')).toBe('true')
    fireEvent.click(screen.getByRole('button', { name: '근거 접기' }))
    expect(props.onToggleCollapse).toHaveBeenLastCalledWith('h1', true)
    fireEvent.contextMenu(container.querySelector('.pdf-memo-card-flow')!)
    expect(screen.queryByRole('menuitemradio', { name: '파랑으로 바꾸기' })).toBeNull()
    fireEvent.click(screen.getByRole('menuitem', { name: '원문 접기' }))
    expect(props.onToggleCollapse).toHaveBeenCalledWith('h1', true)
    fireEvent.contextMenu(container.querySelector('.pdf-memo-card-flow')!)
    fireEvent.click(screen.getByRole('menuitemradio', { name: '별 5개' }))
    expect(props.onRate).toHaveBeenCalledWith('h1', 5)
    // 마우스를 올리면 보이는 … 단추도 같은 메뉴를 연다
    fireEvent.click(screen.getByRole('button', { name: '블록 메뉴' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '위에 소제목 넣기' }))
    expect(props.onInsertSection).toHaveBeenCalledWith('b1')
  })

  it('메모 없는 형광펜은 빈 줄 대신 「메모 쓰기」 단추로 쓴다', () => {
    const props = handlers()
    const highlight = {
      id: 'h2', color: 'yellow' as const,
      anchor: { docId: 'd', page: 0, coordSpace: 'pdfium-page' as const, rects: [{ x: 1, y: 1, w: 1, h: 1 }], charRange: [0, 1] as const, quote: '원문', prefix: '', suffix: '' },
    }
    const { container } = render(<NoteFlow {...props} items={[{ kind: 'memo', key: 'b2', highlight }]} />)
    expect(container.querySelector('.pdf-memo-card-text')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '메모 쓰기' }))
    expect(props.onEdit).toHaveBeenCalledWith('b2')
  })

  it('블록 사이 + 는 그 아래에 글을 넣고, 맨 아래 빈 곳은 끝에 글을 넣는다', () => {
    const props = { ...handlers(), onInsertText: vi.fn(), onAppendText: vi.fn() }
    const items: NoteFlowItem[] = [
      { kind: 'text', key: 't1', text: '첫 글' },
      { kind: 'text', key: 't2', text: '둘째 글' },
    ]
    render(<NoteFlow {...props} items={items} />)
    const adds = screen.getAllByRole('button', { name: '여기에 글 넣기' })
    expect(adds).toHaveLength(2)
    fireEvent.click(adds[0]!)
    expect(props.onInsertText).toHaveBeenCalledWith('t1')
    fireEvent.click(screen.getByRole('button', { name: '끝에 글 쓰기' }))
    expect(props.onAppendText).not.toHaveBeenCalled()
    fireEvent.doubleClick(screen.getByRole('button', { name: '끝에 글 쓰기' }))
    expect(props.onAppendText).toHaveBeenCalled()
  })

  it('글 블록 끝의 빈 줄에서 Enter 를 한 번 더 누르면 저장하고 아래에 새 글 블록', () => {
    const props = { ...handlers(), onInsertText: vi.fn() }
    const items: NoteFlowItem[] = [{ kind: 'text', key: 't1', text: '첫 줄' }]
    render(<NoteFlow {...props} items={items} editingKey="t1" />)
    const editor = screen.getByRole('textbox', { name: '글' })
    editor.innerHTML = '첫 줄<div><br></div>'
    const range = document.createRange()
    range.selectNodeContents(editor.lastChild!)
    range.collapse(false)
    window.getSelection()!.removeAllRanges()
    window.getSelection()!.addRange(range)
    fireEvent.keyDown(editor, { key: 'Enter' })
    expect(props.onSaveText).toHaveBeenCalledWith('t1', expect.objectContaining({ text: '첫 줄' }))
    expect(props.onInsertText).toHaveBeenCalledWith('t1')
  })

  it('서식 도구는 쓰는 칸 위가 아니라 노트 맨 위 자리(슬롯)에 붙는다', () => {
    const slot = document.createElement('div')
    document.body.append(slot)
    const { container } = render(
      <MemoFormatSlotContext.Provider value={slot}>
        <NoteFlow {...handlers()} items={[{ kind: 'text', key: 't1', text: '글' }]} editingKey="t1" />
      </MemoFormatSlotContext.Provider>,
    )
    expect(container.querySelector('.pdf-memo-format-bar')).toBeNull()
    expect(slot.querySelector('[role="toolbar"][aria-label="메모 서식"]')).not.toBeNull()
    slot.remove()
  })

  it('빈 글 블록을 쓰다 말고(Esc, 다른 블록으로 옮김) 떠나면 그 블록을 지운다. 글이 있으면 남긴다', () => {
    const props = { ...handlers(), onInsertText: vi.fn() }
    const items: NoteFlowItem[] = [{ kind: 'text', key: 't1', text: '글' }, { kind: 'text', key: 't2', text: '' }]
    const { rerender } = render(<NoteFlow {...props} items={items} editingKey="t2" />)
    expect(props.onRemoveText).not.toHaveBeenCalled()
    // Esc 로 그만둠: 부모가 편집을 끝낸다
    fireEvent.keyDown(screen.getByRole('textbox', { name: '글' }), { key: 'Escape' })
    rerender(<NoteFlow {...props} items={items} editingKey={null} />)
    expect(props.onRemoveText).toHaveBeenCalledExactlyOnceWith('t2')
    // 글이 있는 블록은 편집을 떠나도 남는다
    props.onRemoveText.mockClear()
    rerender(<NoteFlow {...props} items={items} editingKey="t1" />)
    rerender(<NoteFlow {...props} items={items} editingKey={null} />)
    expect(props.onRemoveText).not.toHaveBeenCalled()
  })

  it('빈 글 블록을 쓰는 중에 다른 곳을 눌러 다른 블록을 쓰기 시작해도 빈 블록은 지운다', () => {
    const props = { ...handlers() }
    const items: NoteFlowItem[] = [{ kind: 'text', key: 't1', text: '글' }, { kind: 'text', key: 't2', text: '' }]
    const { rerender } = render(<NoteFlow {...props} items={items} editingKey="t2" />)
    rerender(<NoteFlow {...props} items={items} editingKey="t1" />)
    expect(props.onRemoveText).toHaveBeenCalledExactlyOnceWith('t2')
  })

  it('글 블록에서 Ctrl+Enter 도 저장하고 아래에 새 글 블록', () => {
    const props = { ...handlers(), onInsertText: vi.fn() }
    render(<NoteFlow {...props} items={[{ kind: 'text', key: 't1', text: '글' }]} editingKey="t1" />)
    fireEvent.keyDown(screen.getByRole('textbox', { name: '글' }), { key: 'Enter', ctrlKey: true })
    expect(props.onSaveText).toHaveBeenCalled()
    expect(props.onInsertText).toHaveBeenCalledWith('t1')
  })
})

describe('NoteFlow — 티켓 · 여러 원문 · 여러 블록 고르기', () => {
  const anchor = (page: number, quote: string) => ({ docId: 'd', page, coordSpace: 'pdfium-page' as const, rects: [{ x: 1, y: 1, w: 1, h: 1 }], charRange: [0, 1] as const, quote, prefix: '', suffix: '' })
  const h1 = { id: 'h1', color: 'yellow' as const, note: '내 글', anchor: anchor(2, '첫 원문') }
  const h2 = { id: 'h2', color: 'yellow' as const, anchor: anchor(5, '둘째 원문') }

  it('ID·제목이 있으면 늘 ID·제목 → 내 글 → 원문 차례다', () => {
    const items: NoteFlowItem[] = [{ kind: 'memo', key: 'b1', highlight: h1, ticket: { id: 'REQ-1', title: '저장' } }]
    const { container } = render(<NoteFlow {...handlers()} items={items} />)
    const card = container.querySelector('.note-ticket')!
    const order = [...card.querySelector('.note-card-body')!.children].map((child) => child.className)
    expect(order.findIndex((name) => name.includes('note-ticket-head'))).toBeLessThan(order.findIndex((name) => name.includes('pdf-memo-card-text') || name.includes('pdf-memo-note')))
    expect(order.findIndex((name) => name.includes('note-ticket-head'))).toBeLessThan(order.findIndex((name) => name.includes('note-sources')))
    expect(card.querySelector('.note-ticket-id')?.textContent).toBe('REQ-1')
    expect(card.querySelector('.note-ticket-title')?.textContent).toBe('저장')
    expect(card.querySelector('.note-source-chip')?.textContent).toContain('첫 원문')
  })

  it('그냥 메모도 원문은 맨 아래이고, 「+ ID」로 ID 를 붙이면 다음 번호를 제안한다', () => {
    const onSetTicket = vi.fn()
    const items: NoteFlowItem[] = [
      { kind: 'memo', key: 'b0', highlight: h2, ticket: { id: 'REQ-03' } },
      { kind: 'memo', key: 'b1', highlight: h1 },
    ]
    const { container } = render(<NoteFlow {...handlers()} items={items} onSetTicket={onSetTicket} />)
    const card = container.querySelector('[data-note-block="b1"]')!
    const order = [...card.querySelector('.note-card-body')!.children].map((child) => child.className)
    expect(order.findIndex((name) => name.includes('note-sources'))).toBeGreaterThan(0)
    expect(card.querySelector('.note-ticket-head')).toBeNull()
    fireEvent.click(screen.getAllByRole('button', { name: '+ ID' })[0]!)
    expect(screen.getByRole('option', { name: /REQ-04/u })).toBeTruthy()
    fireEvent.pointerDown(screen.getByRole('option', { name: /REQ-04/u }))
    expect(onSetTicket).toHaveBeenCalledWith('b1', { id: 'REQ-04' })
  })

  it('이미 쓴 ID 를 넣으면 알려 준다', () => {
    const items: NoteFlowItem[] = [
      { kind: 'memo', key: 'b0', highlight: h2, ticket: { id: 'REQ-03' } },
      { kind: 'memo', key: 'b1', highlight: h1 },
    ]
    render(<NoteFlow {...handlers()} items={items} onSetTicket={vi.fn()} />)
    fireEvent.click(screen.getAllByRole('button', { name: '+ ID' })[0]!)
    fireEvent.change(screen.getByRole('textbox', { name: 'ID' }), { target: { value: 'req-03' } })
    expect(screen.getByRole('status').textContent).toContain('이미 있는 ID')
  })

  it('한 메모에 원문을 여럿 보이고, 더한 원문만 뗄 수 있다', () => {
    const onRemoveRef = vi.fn()
    const items: NoteFlowItem[] = [{ kind: 'memo', key: 'b1', highlight: h1, extraHighlights: [h2] }]
    const { container } = render(<NoteFlow {...handlers()} items={items} onRemoveRef={onRemoveRef} />)
    expect(container.querySelectorAll('.note-source-chip')).toHaveLength(2)
    const removes = screen.getAllByRole('button', { name: '이 원문 떼기' })
    expect(removes).toHaveLength(1)
    fireEvent.click(removes[0]!)
    expect(onRemoveRef).toHaveBeenCalledWith('b1', 'h2')
  })

  it('새 메모 글 맨 앞에 「REQ-04 」처럼 쓰면 그 낱말이 ID 가 되어 저장된다', () => {
    const props = handlers()
    const draft = { id: 'hd', color: 'yellow' as const, anchor: anchor(1, '새 원문') }
    const items: NoteFlowItem[] = [{ kind: 'memo', key: 'draft', highlight: draft, draft: true }]
    render(<MemoFormatSlotContext.Provider value={null}><NoteFlow {...props} items={items} onSetTicket={vi.fn()} /></MemoFormatSlotContext.Provider>)
    const editor = screen.getAllByRole('textbox').at(-1)!
    editor.textContent = 'REQ-04 요구사항'
    fireEvent.input(editor)
    fireEvent.keyDown(editor, { key: 'Enter', ctrlKey: true })
    expect(props.onSaveMemo).toHaveBeenCalledWith('hd', expect.objectContaining({ text: '요구사항' }), { id: 'REQ-04' })
  })

  it('Ctrl+누르기로 여러 블록을 고르고 한꺼번에 지운다', () => {
    const onDeleteBlocks = vi.fn()
    const items: NoteFlowItem[] = [
      { kind: 'text', key: 't1', text: '하나' },
      { kind: 'text', key: 't2', text: '둘' },
      { kind: 'text', key: 't3', text: '셋' },
    ]
    const { container } = render(<NoteFlow {...handlers()} items={items} onDeleteBlocks={onDeleteBlocks} />)
    const blocks = container.querySelectorAll('.note-text-card')
    fireEvent.click(blocks[0]!, { ctrlKey: true })
    fireEvent.click(blocks[2]!, { shiftKey: true })
    expect(container.querySelectorAll('.note-block-selected')).toHaveLength(3)
    fireEvent.click(screen.getByRole('button', { name: '지우기' }))
    fireEvent.click(screen.getByRole('button', { name: '지우기' }))
    expect(onDeleteBlocks).toHaveBeenCalledWith(['t1', 't2', 't3'])
  })
})
