import { describe, expect, it } from 'vitest'
import {
  createPersistentMarkdownHighlight,
  markdownHighlightFile,
  parsePersistentMarkdownHighlights,
  relocateMarkdownHighlights,
  removePersistentMarkdownHighlight,
} from './markdownHighlight'

const selection = {
  path: 'docs/guide.md',
  title: 'Guide',
  quote: 'Important',
  prefix: '',
  suffix: ' body',
  startOffset: 4,
  endOffset: 13,
  format: 'paragraph' as const,
}

describe('markdownHighlight', () => {
  it('안정 파일 ID와 원문 해시 및 문자 범위로 식별자를 만든다', () => {
    expect(createPersistentMarkdownHighlight('file-1', 'hash-1', selection, 'green')).toEqual({
      id: 'file-1:hash-1:4:13',
      sourceFileId: 'file-1',
      sourceHash: 'hash-1',
      selection,
      color: 'green',
    })
  })

  it('저장 파일을 검증하고 중복 항목을 한 번만 복원한다', () => {
    const highlight = createPersistentMarkdownHighlight('file-1', 'hash-1', selection)
    expect(parsePersistentMarkdownHighlights(markdownHighlightFile([highlight, highlight]))).toEqual([highlight])
  })

  it('식별자로 개별 형광펜을 삭제한다', () => {
    const first = createPersistentMarkdownHighlight('file-1', 'hash-1', selection)
    const second = createPersistentMarkdownHighlight('file-1', 'hash-1', { ...selection, startOffset: 20, endOffset: 24 })
    expect(removePersistentMarkdownHighlight([first, second], first.id)).toEqual([second])
  })
})

describe('relocateMarkdownHighlights', () => {
  const make = (quote: string, prefix: string, suffix: string, start: number) =>
    createPersistentMarkdownHighlight('f', 'old', { ...selection, quote, prefix, suffix, startOffset: start, endOffset: start + quote.length })

  it('keeps stored offsets when the hash is unchanged and the text there still equals the quote', () => {
    const h = make('Important', 'See ', ' body', 4)
    const text = 'See Important body'
    const [kept] = relocateMarkdownHighlights(text, [h], 'old')
    expect(kept).toBe(h)
  })

  it('같은 해시여도 그 자리의 글이 인용문과 다르면(그리는 방식이 바뀜) 다시 찾는다', () => {
    const h = make('Important', 'See ', ' body', 4)
    const [moved] = relocateMarkdownHighlights('Menu Menu\nSee Important body', [h], 'old')
    expect(moved?.selection.startOffset).toBe(14)
    expect(moved?.selection.endOffset).toBe(23)
  })

  it('같은 해시이고 인용문을 못 찾으면 칠하지 않는다(기록은 호출자가 그대로 둔다)', () => {
    const h = make('Important', 'See ', ' body', 4)
    expect(relocateMarkdownHighlights('totally different text', [h], 'old')).toEqual([])
  })

  it('공백·줄바꿈이 달라도 같은 글로 본다', () => {
    const h = make('first line second line', '', '', 0)
    const [kept] = relocateMarkdownHighlights('first linesecond line', [{ ...h, selection: { ...h.selection, endOffset: 21 } }], 'old')
    expect(kept?.selection.startOffset).toBe(0)
  })

  it('finds the quote after text is added before it', () => {
    const h = make('Important', 'See ', ' body', 4)
    const [moved] = relocateMarkdownHighlights('Intro line\nSee Important body', [h], 'new')
    expect(moved?.selection.startOffset).toBe(15)
    expect(moved?.selection.endOffset).toBe(24)
    expect(moved?.id).toBe(h.id)
  })

  it('uses context then old offset to pick among repeated quotes', () => {
    const text = 'aa cat bb\ndd cat ee'
    const h = make('cat', 'dd ', ' ee', 3)
    expect(relocateMarkdownHighlights(text, [h], 'new')[0]?.selection.startOffset).toBe(13)
    const h2 = make('cat', 'zz ', ' zz', 14)
    expect(relocateMarkdownHighlights(text, [h2], 'new')[0]?.selection.startOffset).toBe(13)
  })

  it('drops highlights whose quote is gone from the view only', () => {
    expect(relocateMarkdownHighlights('nothing here', [make('Important', '', '', 0)], 'new')).toEqual([])
  })

  it('ignores line ending differences in the stored quote', () => {
    const h = make('a\r\nb', '', '', 0)
    expect(relocateMarkdownHighlights('x a\nb', [h], 'new')[0]?.selection.startOffset).toBe(2)
  })
})
