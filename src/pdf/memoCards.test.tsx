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
import { MemoEditor } from './MemoEditor'
import { memoDisplayHtml } from './memoRichText'
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

describe('메모 편집기', () => {
  it('새 메모는 바로 쓰기 상태로 열리고, 쓴 글로 저장한다', () => {
    const onSave = vi.fn()
    render(<MemoEditor initialText="" onSave={onSave} onCancel={vi.fn()} />)
    const box = screen.getByRole('textbox', { name: '메모' })
    box.focus()
    box.textContent = '펄스 폭으로 구분'
    fireEvent.input(box)
    fireEvent.blur(box)
    expect(onSave).toHaveBeenCalledWith({ text: '펄스 폭으로 구분', html: '' })
  })

  it('새 메모를 Esc 로 그만두면 그만뒀다고 알린다', () => {
    const onCancel = vi.fn()
    render(<MemoEditor initialText="" onSave={vi.fn()} onCancel={onCancel} />)
    fireEvent.keyDown(screen.getByRole('textbox', { name: '메모' }), { key: 'Escape' })
    expect(onCancel).toHaveBeenCalled()
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
    const { sanitizeMemoHtml, hasMemoFormatting } = await import('./memoRichText')
    const html = sanitizeMemoHtml('<b>굵게</b> <span style="color: rgb(207, 34, 46); position: fixed">빨강</span><script>alert(1)</script><a href="x">링크</a><ul><li>항목</li></ul>')
    expect(html).toBe('<b>굵게</b> <span style="color: rgb(207, 34, 46)">빨강</span>링크<ul><li>항목</li></ul>')
    expect(hasMemoFormatting(html)).toBe(true)
    expect(hasMemoFormatting('그냥 글')).toBe(false)
    expect(memoDisplayHtml('a < b\n다음 줄', undefined)).toBe('a &lt; b<br>다음 줄')
  })

  it('저장된 서식을 그대로 보이고, 글만 고치면(서식 없이) 예전 서식은 버린다', () => {
    const card = updatePersistentPdfHighlight(createPersistentPdfHighlight(anchor('doc-a', 1, 100)), { note: '굵게', noteHtml: '<b>굵게</b>' })
    expect(card.noteHtml).toBe('<b>굵게</b>')
    expect(memoDisplayHtml(card.note, card.noteHtml)).toContain('<b>굵게</b>')
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
