// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import {
  createPersistentPdfHighlight,
  parsePersistentPdfHighlights,
  persistentPdfHighlightFile,
  updatePersistentPdfHighlight,
  type PersistentPdfHighlight,
} from './persistentHighlight'
import { MemoColumn, type MemoTarget } from './MemoColumn'
import { NoteOutline, outlineEntries, outlineFits, outlineWidthFor, plainLine } from './NoteOutline'

const anchor = (docId: string, page: number, y: number, quote = `quote ${y}`) => ({
  docId, page, coordSpace: 'pdfium-page' as const,
  rects: [{ x: 60, y, w: 200, h: 12 }], charRange: [y, y + 5] as const, quote, prefix: '', suffix: '',
})

const memo = (docId: string, page: number, y: number, note: string, topic?: string): PersistentPdfHighlight =>
  updatePersistentPdfHighlight(createPersistentPdfHighlight(anchor(docId, page, y)), { note, ...(topic === undefined ? {} : { topic }) })

describe('메모 저장', () => {
  it('카테고리와 표·그림 영역 메모를 저장했다가 그대로 읽는다', () => {
    const region = updatePersistentPdfHighlight(
      createPersistentPdfHighlight({ ...anchor('doc-a', 31, 52, ''), charRange: [0, 0] as const }, 'yellow', { kind: 'region', pageSize: [612, 792] }),
      { note: '구조 그림', topic: '#TODO' },
    )
    expect(region.id).toBe('doc-a:31:region:60:52:200:12')
    const restored = parsePersistentPdfHighlights(JSON.parse(JSON.stringify(persistentPdfHighlightFile([region]))))
    expect(restored[0]).toMatchObject({ kind: 'region', topic: 'TODO', note: '구조 그림', pageSize: [612, 792] })
  })

  it('접기·별점·순서를 저장했다가 그대로 읽고, 0·null 은 지운다', async () => {
    const { sortMemosForList } = await import('./persistentHighlight')
    const card = updatePersistentPdfHighlight(memo('doc-a', 1, 100, '메모'), { collapsed: true, rating: 4, order: 2 })
    const restored = parsePersistentPdfHighlights(JSON.parse(JSON.stringify(persistentPdfHighlightFile([card]))))
    expect(restored[0]).toMatchObject({ collapsed: true, rating: 4, order: 2 })
    const cleared = updatePersistentPdfHighlight(card, { collapsed: false, rating: 0, order: null })
    expect(cleared.collapsed).toBeUndefined()
    expect(cleared.rating).toBeUndefined()
    expect(cleared.order).toBeUndefined()
    // 끌어 정한 순서를 따르고, 순서 없는 새 메모는 문서에서 앞선 메모 바로 뒤에 붙는다
    const a = updatePersistentPdfHighlight(memo('doc-a', 1, 100, 'A'), { order: 1 })
    const b = updatePersistentPdfHighlight(memo('doc-a', 2, 100, 'B'), { order: 0 })
    const c = memo('doc-a', 1, 200, 'C')
    expect(sortMemosForList([a, b, c], (h) => h, (h) => h.anchor.rects[0]!.y).map((h) => h.note)).toEqual(['B', 'A', 'C'])
  })

  it('빈 카테고리는 지운다', () => {
    expect(updatePersistentPdfHighlight(memo('doc-a', 1, 100, '메모', 'A'), { topic: ' ' }).topic).toBeUndefined()
  })
})

describe('메모 카드 열', () => {
  const target = (highlight: PersistentPdfHighlight, top: number, draft = false): MemoTarget => ({ highlight, top, anchorX: 300, anchorY: top + 6, draft })
  const base = { columnLeft: 640, pageRight: 612, height: 2000, width: 1000, activeId: null, onActivate: vi.fn(), onRecolor: vi.fn(), onDelete: vi.fn() }

  it('새 메모는 바로 쓰기 상태로 열리고, 쓴 글로 저장한다', () => {
    const onSave = vi.fn()
    const draft = createPersistentPdfHighlight(anchor('doc-a', 30, 380))
    render(<MemoColumn {...base} targets={[target(draft, 100, true)]} editingId={null} onEdit={vi.fn()} onSave={onSave} />)
    const box = screen.getByRole('textbox', { name: '메모' })
    expect(document.activeElement).toBe(box)
    box.textContent = '펄스 폭으로 구분'
    fireEvent.input(box)
    fireEvent.blur(box)
    expect(onSave).toHaveBeenCalledWith(draft.id, { text: '펄스 폭으로 구분', html: '' })
  })

  it('새 메모를 Esc 로 그만두면 그만뒀다고 알린다', () => {
    const onCancelDraft = vi.fn()
    const draft = createPersistentPdfHighlight(anchor('doc-a', 30, 380))
    render(<MemoColumn {...base} targets={[target(draft, 100, true)]} editingId={null} onEdit={vi.fn()} onSave={vi.fn()} onCancelDraft={onCancelDraft} />)
    fireEvent.keyDown(screen.getByRole('textbox', { name: '메모' }), { key: 'Escape' })
    expect(onCancelDraft).toHaveBeenCalled()
  })

  it('카테고리는 이 PDF 에서 쓰는 것 중에서 고르거나 새로 만든다', () => {
    const onSetTopic = vi.fn()
    const card = memo('doc-a', 1, 100, '메모')
    render(<MemoColumn {...base} targets={[target(card, 100)]} editingId={null} categories={['QUESTIONS', 'TODO']} onEdit={vi.fn()} onSave={vi.fn()} onSetTopic={onSetTopic} />)
    fireEvent.click(screen.getByRole('button', { name: '카테고리 정하기' }))
    expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual(['QUESTIONS', 'TODO'])
    fireEvent.click(screen.getByRole('option', { name: 'TODO' }))
    expect(onSetTopic).toHaveBeenCalledWith(card.id, 'TODO')
    fireEvent.click(screen.getByRole('button', { name: '카테고리 정하기' }))
    const input = screen.getByRole('textbox', { name: '새 카테고리' })
    fireEvent.change(input, { target: { value: 'SCL low' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onSetTopic).toHaveBeenCalledWith(card.id, 'SCL low')
  })

  it('목록으로 쌓기(메모 바가 따로 스크롤): 문서 순서대로 놓고 선은 그리지 않으며, 카드 자리를 알려 준다', () => {
    const later = memo('doc-a', 5, 100, '뒤 쪽')
    const earlier = memo('doc-a', 1, 300, '앞 쪽')
    const onCardLayout = vi.fn()
    const onJump = vi.fn()
    const { container } = render(<MemoColumn {...base} flow onCardLayout={onCardLayout} onJump={onJump} targets={[target(later, 900), target(earlier, 300)]} editingId={null} onEdit={vi.fn()} onSave={vi.fn()} />)
    expect([...container.querySelectorAll('.pdf-memo-card-flow .pdf-memo-card-text')].map((el) => el.textContent)).toEqual(['앞 쪽', '뒤 쪽'])
    expect(container.querySelector('svg.pdf-memo-links')).toBeNull()
    expect(onCardLayout).toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'p.6' }))
    expect(onJump).toHaveBeenCalledWith(later)
  })

  it('접으면 원문만 숨고 쓴 메모는 다 보인다. 별을 누르면 별점을 주고 같은 별을 다시 누르면 지운다', () => {
    const onToggleCollapse = vi.fn()
    const onRate = vi.fn()
    const folded = updatePersistentPdfHighlight(memo('doc-a', 1, 100, '접힌 메모 내용'), { collapsed: true, rating: 3 })
    const { container } = render(<MemoColumn {...base} flow targets={[target(folded, 100)]} editingId={null} onEdit={vi.fn()} onSave={vi.fn()} onToggleCollapse={onToggleCollapse} onRate={onRate} onReorder={vi.fn()} />)
    expect(container.querySelector('.pdf-memo-card-quote')).toBeNull()
    expect(container.querySelector('.pdf-memo-card-text')?.textContent).toBe('접힌 메모 내용')
    fireEvent.click(screen.getByRole('button', { name: '원문 펼치기' }))
    expect(onToggleCollapse).toHaveBeenCalledWith(folded.id, false)
    expect(container.querySelectorAll('.pdf-memo-star-on')).toHaveLength(3)
    fireEvent.click(screen.getByRole('radio', { name: '별 5개' }))
    expect(onRate).toHaveBeenLastCalledWith(folded.id, 5)
    fireEvent.click(screen.getByRole('radio', { name: '별 3개' }))
    expect(onRate).toHaveBeenLastCalledWith(folded.id, 0)
    expect(screen.getByRole('button', { name: '끌어서 순서 바꾸기' })).toBeTruthy()
  })

  it('노트 검색어에 맞지 않는 카드는 흐리게 한다', () => {
    const a = memo('doc-a', 1, 100, '펄스 폭')
    const b = memo('doc-a', 1, 300, '풀업 저항')
    const { container } = render(<MemoColumn {...base} targets={[target(a, 100), target(b, 300)]} editingId={null} query="풀업" onEdit={vi.fn()} onSave={vi.fn()} />)
    expect(container.querySelector(`[data-memo-id="${a.id}"]`)?.classList.contains('pdf-memo-card-dim')).toBe(true)
    expect(container.querySelector(`[data-memo-id="${b.id}"]`)?.classList.contains('pdf-memo-card-dim')).toBe(false)
  })
})

describe('메모만 보기 목차', () => {
  const highlights = [
    memo('doc-a', 30, 380, '펄스 폭으로 구분'),
    memo('doc-a', 5, 200, ''),
  ]
  const items = [
    { kind: 'text' as const, key: 't1', text: '머리말 글\n둘째 줄' },
    { kind: 'section' as const, key: 's1', title: '실험', collapsed: false, count: 2 },
    { kind: 'memo' as const, key: 'b1', highlight: highlights[0]!, ticket: { id: 'REQ-01', title: '펄스 폭' } },
    { kind: 'memo' as const, key: 'b2', highlight: highlights[1]! },
    { kind: 'memo' as const, key: 'draft', highlight: highlights[1]!, draft: true },
  ]

  it('줄 이름: 소제목은 제목, 메모는 ID·제목 → 메모 첫 줄 → 원문 앞부분, 글은 첫 줄. 소제목 아래는 안쪽으로, 새 메모(초안)는 뺀다', () => {
    const entries = outlineEntries(items)
    expect(entries.map((entry) => [entry.kind, entry.id, entry.text, entry.nested])).toEqual([
      ['text', undefined, '머리말 글', false],
      ['section', undefined, '실험', false],
      ['memo', 'REQ-01', '펄스 폭', true],
      ['memo', undefined, highlights[1]!.anchor.quote.replace(/\s+/gu, ' ').trim(), true],
    ])
    expect(outlineEntries([{ kind: 'memo', key: 'n', highlight: { ...highlights[0]!, note: '\n  첫 줄 메모\n다음' } }])[0]?.text).toBe('첫 줄 메모')
  })

  it('목차는 줄을 누르면 그 블록으로 스크롤한다(좁으면 감춘다)', () => {
    const scroller = document.createElement('div')
    Object.defineProperty(scroller, 'offsetWidth', { value: 1400 })
    scroller.scrollTo = vi.fn() as never
    scroller.innerHTML = '<div data-note-block="b1"></div>'
    document.body.append(scroller)
    const { container } = render(<NoteOutline items={items} scrollerRef={{ current: scroller }} />)
    fireEvent.click(screen.getByRole('button', { name: /펄스 폭/ }))
    expect(scroller.scrollTo).toHaveBeenCalled()
    expect(container.querySelector('.note-outline')).not.toBeNull()
    scroller.remove()
  })
})

describe('메모 서식', () => {
  it('허용한 서식만 남기고 스크립트·링크는 버린다', async () => {
    const { sanitizeMemoHtml, hasMemoFormatting, memoDisplayHtml } = await import('./memoRichText')
    const html = sanitizeMemoHtml('<b>굵게</b> <span style="color: rgb(207, 34, 46); position: fixed">빨강</span><script>alert(1)</script><a href="x">링크</a><ul><li>항목</li></ul>')
    expect(html).toBe('<b>굵게</b> <span style="color: rgb(207, 34, 46)">빨강</span>링크<ul><li>항목</li></ul>')
    expect(hasMemoFormatting(html)).toBe(true)
    expect(hasMemoFormatting('그냥 글')).toBe(false)
    expect(memoDisplayHtml('a < b\n다음 줄', undefined)).toBe('a &lt; b<br>다음 줄')
  })

  it('저장된 서식을 그대로 보이고, 글만 고치면(서식 없이) 예전 서식은 버린다', () => {
    const card = updatePersistentPdfHighlight(createPersistentPdfHighlight(anchor('doc-a', 1, 100)), { note: '굵게', noteHtml: '<b>굵게</b>' })
    expect(card.noteHtml).toBe('<b>굵게</b>')
    const { container } = render(<MemoColumn targets={[{ highlight: card, top: 100, anchorX: 300, anchorY: 106 }]} columnLeft={640} pageRight={612} height={2000} width={1000}
      editingId={null} activeId={null} onActivate={vi.fn()} onRecolor={vi.fn()} onDelete={vi.fn()} onEdit={vi.fn()} onSave={vi.fn()} />)
    expect(container.querySelector('.pdf-memo-card-text b')?.textContent).toBe('굵게')
    expect(updatePersistentPdfHighlight(card, { note: 'MCP 가 고친 글' }).noteHtml).toBeUndefined()
  })
})

describe('목차 폭 계산·표시 기호', () => {
  it('목차 폭은 칸 폭의 18% 를 160~240px 로 자른다', () => {
    expect(outlineWidthFor(600)).toBe(160)
    expect(outlineWidthFor(1280)).toBe(230)
    expect(outlineWidthFor(1920)).toBe(240)
  })
  it('글 칸 + 목차 + 사이 + 양쪽 여백이 안 들어가면 목차를 감춘다', () => {
    expect(outlineFits(900)).toBe(false)
    expect(outlineFits(960)).toBe(true)
    expect(outlineFits(1920)).toBe(true)
  })
  it('목차 글에서 굵게 기호를 걷어 낸다', () => {
    expect(plainLine('메모에는 **ID** 와 `코드`')).toBe('메모에는 ID 와 코드')
  })
})
