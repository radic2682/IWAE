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

