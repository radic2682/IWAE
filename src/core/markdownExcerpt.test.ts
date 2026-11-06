import { describe, expect, it } from 'vitest'
import {
  MARKDOWN_EXCERPT_DRAG_MIME,
  createMarkdownSourceJumpRequest,
  parseMarkdownExcerptDrag,
  serializeMarkdownExcerptDrag,
  type MarkdownExcerptDragPayload,
} from './markdownExcerpt'

const payload: MarkdownExcerptDragPayload = {
  selection: {
    path: 'docs/guide.md',
    title: 'Guide',
    quote: '중요한 설명입니다.',
    prefix: '앞 문장 ',
    suffix: ' 다음 문장',
    startOffset: 12,
    endOffset: 22,
    format: 'quote',
  },
  displaySize: { width: 286, height: 68 },
}

describe('Markdown excerpt drag model', () => {
  it('선택 위치와 표시 형식을 안전하게 직렬화한다', () => {
    expect(MARKDOWN_EXCERPT_DRAG_MIME).toBe('application/x-iwae-markdown-excerpt')
    expect(parseMarkdownExcerptDrag(serializeMarkdownExcerptDrag(payload))).toEqual(payload)
  })

  it('잘못된 범위나 지원하지 않는 표시 형식을 거부한다', () => {
    expect(parseMarkdownExcerptDrag(JSON.stringify({
      ...payload,
      selection: { ...payload.selection, endOffset: 3 },
    }))).toBeNull()
    expect(parseMarkdownExcerptDrag(JSON.stringify({
      ...payload,
      selection: { ...payload.selection, format: 'script' },
    }))).toBeNull()
    expect(parseMarkdownExcerptDrag('not json')).toBeNull()
  })

  it('원문 위치로 돌아가는 요청을 만든다', () => {
    expect(createMarkdownSourceJumpRequest(payload.selection)).toEqual({
      kind: 'markdown',
      path: 'docs/guide.md',
      startOffset: 12,
      endOffset: 22,
      quote: '중요한 설명입니다.',
    })
  })
})
