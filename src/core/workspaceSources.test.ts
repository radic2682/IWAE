import { describe, expect, it } from 'vitest'
import type { Anchor } from './anchor'
import {
  canvasSourceReferences,
  visibleWorkspaceSources,
  type CanvasSourceReference,
  type WorkspaceSourceInput,
} from './workspaceSources'
import { createDefaultTextBlockStyle, type CanvasDocumentV2 } from './canvasDocument'

function anchor(docId: string, page: number, quote: string): Anchor {
  return {
    docId,
    page,
    coordSpace: 'pdfium-page',
    rects: [{ x: 10, y: 20, w: 40, h: 12 }],
    charRange: [0, quote.length],
    quote,
    prefix: '',
    suffix: '',
  }
}

function reference(
  blockId: string,
  sourceAnchor: Anchor,
  relation: 'excerpt' | 'translation' = 'excerpt',
): CanvasSourceReference {
  return { blockId, anchor: sourceAnchor, relation }
}

function input(
  references: readonly CanvasSourceReference[],
  overrides: Partial<WorkspaceSourceInput> = {},
): WorkspaceSourceInput {
  return {
    references,
    activeDocId: 'doc-a',
    currentPage: 2,
    selectedIds: new Set(),
    hoveredId: null,
    ...overrides,
  }
}

describe('visibleWorkspaceSources', () => {
  it('같은 현재 페이지의 여러 출처를 모두 유지한다', () => {
    const references = [
      reference('a', anchor('doc-a', 2, 'first')),
      reference('b', anchor('doc-a', 2, 'second')),
    ]

    expect(visibleWorkspaceSources(input(references))).toEqual([
      { ...references[0], selected: false, hovered: false, visibleOnCurrentPage: true },
      { ...references[1], selected: false, hovered: false, visibleOnCurrentPage: true },
    ])
  })

  it('같은 PDF의 다른 페이지 출처도 선택 여부와 관계없이 표시한다', () => {
    const source = reference('a', anchor('doc-a', 7, 'elsewhere'))

    expect(visibleWorkspaceSources(input([source]))).toEqual([
      { ...source, selected: false, hovered: false, visibleOnCurrentPage: false },
    ])
    expect(visibleWorkspaceSources(input([source], { selectedIds: new Set(['a']) }))).toEqual([
      { ...source, selected: true, hovered: false, visibleOnCurrentPage: false },
    ])
    expect(visibleWorkspaceSources(input([source], { hoveredId: 'a' }))).toEqual([
      { ...source, selected: false, hovered: true, visibleOnCurrentPage: false },
    ])
  })

  it('다른 문서의 비활성 출처를 숨긴다', () => {
    const source = reference('other-doc', anchor('doc-b', 2, 'foreign'))

    expect(visibleWorkspaceSources(input([source]))).toEqual([])
  })

  it('같은 앵커를 가진 블록도 blockId별로 구분한다', () => {
    const sharedAnchor = anchor('doc-a', 2, 'same quote')
    const references = [
      reference('excerpt-a', sharedAnchor),
      reference('excerpt-b', sharedAnchor),
    ]

    expect(visibleWorkspaceSources(input(references)).map((source) => source.blockId)).toEqual([
      'excerpt-a',
      'excerpt-b',
    ])
  })

  it('번역 출처의 관계와 앵커를 보존한다', () => {
    const sourceAnchor = anchor('doc-a', 2, 'translated source')
    const source = reference('translation-a', sourceAnchor, 'translation')

    expect(visibleWorkspaceSources(input([source]))).toEqual([
      {
        blockId: 'translation-a',
        anchor: sourceAnchor,
        relation: 'translation',
        selected: false,
        hovered: false,
        visibleOnCurrentPage: true,
      },
    ])
  })

  it('필터링 후에도 입력 순서를 안정적으로 유지한다', () => {
    const references = [
      reference('selected-other-page', anchor('doc-a', 8, 'selected')),
      reference('current-page-first', anchor('doc-a', 2, 'first')),
      reference('hidden-other-doc', anchor('doc-b', 2, 'hidden')),
      reference('hovered-other-page', anchor('doc-a', 9, 'hovered')),
      reference('current-page-last', anchor('doc-a', 2, 'last')),
    ]

    expect(visibleWorkspaceSources(input(references, {
      selectedIds: new Set(['selected-other-page']),
      hoveredId: 'hovered-other-page',
    })).map((source) => source.blockId)).toEqual([
      'selected-other-page',
      'current-page-first',
      'hovered-other-page',
      'current-page-last',
    ])
  })
})

describe('canvasSourceReferences', () => {
  it('V2 PDF·Markdown 발췌와 앵커가 있는 번역 블록만 출처로 추출한다', () => {
    const excerptAnchor = anchor('doc-a', 2, 'excerpt')
    const translationAnchor = anchor('doc-a', 4, 'translation')
    const document = {
      version: 2,
      nodes: [
        {
          id: 'excerpt', position: { x: 0, y: 0 }, data: { block: {
            kind: 'pdfExcerpt', width: 200, height: 100,
            style: createDefaultTextBlockStyle(),
            excerpt: {
              id: 'excerpt', type: 'pdfExcerpt', x: 0, y: 0, width: 200, height: 100,
              text: '> excerpt', sourceTitle: 'Source',
              selection: { mode: 'text', anchor: excerptAnchor, pageSize: [612, 792], crop: { x: 8, y: 18, w: 44, h: 16 }, glyphs: [] },
              iwae: { kind: 'pdf-excerpt', anchor: excerptAnchor },
            },
            source: { relation: 'excerpt', anchor: excerptAnchor },
          } },
        },
        {
          id: 'translated', position: { x: 0, y: 0 }, data: { block: {
            kind: 'translation', width: 240, height: 120,
            style: createDefaultTextBlockStyle(), text: '번역', sourceBlockId: 'excerpt',
            targetLanguage: 'ko', model: 'model',
            source: { relation: 'translation', anchor: translationAnchor },
          } },
        },
        {
          id: 'plain-translation', position: { x: 0, y: 0 }, data: { block: {
            kind: 'translation', width: 240, height: 120,
            style: createDefaultTextBlockStyle(), text: '번역', sourceBlockId: 'paragraph',
            targetLanguage: 'ko', model: 'model', source: { relation: 'translation' },
          } },
        },
        {
          id: 'markdown-excerpt', position: { x: 0, y: 0 }, data: { block: {
            kind: 'markdownExcerpt', width: 280, height: 70,
            style: createDefaultTextBlockStyle('h2'),
            selection: {
              path: 'docs/guide.md', title: 'Guide', quote: '제목', prefix: '', suffix: ' 본문',
              startOffset: 0, endOffset: 2, format: 'heading-2',
            },
            source: { relation: 'markdown-excerpt', selection: {
              path: 'docs/guide.md', title: 'Guide', quote: '제목', prefix: '', suffix: ' 본문',
              startOffset: 0, endOffset: 2, format: 'heading-2',
            } },
          } },
        },
      ],
      edges: [], viewport: { x: 0, y: 0, zoom: 1 },
    } satisfies CanvasDocumentV2

    expect(canvasSourceReferences(document)).toEqual([
      { blockId: 'excerpt', anchor: excerptAnchor, relation: 'excerpt' },
      { blockId: 'translated', anchor: translationAnchor, relation: 'translation' },
      {
        blockId: 'markdown-excerpt',
        relation: 'markdown-excerpt',
        selection: {
          path: 'docs/guide.md', title: 'Guide', quote: '제목', prefix: '', suffix: ' 본문',
          startOffset: 0, endOffset: 2, format: 'heading-2',
        },
      },
    ])
  })
})
