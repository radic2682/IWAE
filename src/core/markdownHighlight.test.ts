import { describe, expect, it } from 'vitest'
import {
  createPersistentMarkdownHighlight,
  markdownHighlightFile,
  parsePersistentMarkdownHighlights,
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
