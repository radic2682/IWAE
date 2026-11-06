import { describe, expect, it } from 'vitest'
import {
  CANVAS_GRID_SIZE,
  applyCanvasBlockCommand,
  createDefaultTextBlockStyle,
  normalizeCanvasBlockSize,
  normalizeCanvasPosition,
  parseCanvasBlock,
  parseCanvasDocument,
  pdfExcerptAspectRatio,
  textBlockLevelFontSize,
  type CanvasDocumentV1,
  type PdfExcerptCanvasBlock,
} from './canvasDocument'
import type { MarkdownExcerptSelection } from './markdownExcerpt'

const excerptSelection = {
  mode: 'text' as const,
  anchor: {
    docId: 'doc-a',
    page: 0,
    coordSpace: 'pdfium-page' as const,
    rects: [{ x: 10, y: 20, w: 40, h: 12 }],
    charRange: [0, 4] as const,
    quote: 'test',
    prefix: '',
    suffix: '',
  },
  pageSize: [612, 792] as const,
  crop: { x: 6, y: 16, w: 48, h: 20 },
  glyphs: [{ c: 't', x: 10, y: 20, w: 8, h: 12 }],
}

const validDocument: CanvasDocumentV1 = {
  version: 1,
  nodes: [
    {
      id: 'excerpt-1',
      type: 'pdfExcerpt',
      position: { x: 120, y: 80 },
      style: { width: 280, height: 120 },
      data: {
        block: {
          id: 'excerpt-1',
          type: 'pdfExcerpt',
          x: 120,
          y: 80,
          width: 280,
          height: 120,
          text: '> test',
          sourceTitle: 'Source',
          selection: excerptSelection,
          iwae: { kind: 'pdf-excerpt', anchor: excerptSelection.anchor },
        },
      },
    },
    {
      id: 'title-1',
      type: 'title',
      position: { x: 40, y: 30 },
      data: { label: 'Title' },
    },
  ],
  edges: [{ id: 'edge-1', source: 'title-1', target: 'excerpt-1' }],
  viewport: { x: 10, y: 20, zoom: 1.25 },
}

describe('canvasDocument', () => {
  it('이미지 블록을 저장하고 다시 읽는다', () => {
    const document = {
      version: 2,
      nodes: [{
        id: 'image-0', position: { x: 120, y: 80 },
        data: { block: { kind: 'image', width: 320, height: 160, style: createDefaultTextBlockStyle(), src: 'data:image/webp;base64,YWJj', alt: 'figure.png' } },
      }],
      edges: [], viewport: { x: 0, y: 0, zoom: 1 },
    }
    expect(parseCanvasDocument(document).nodes[0]?.data.block).toMatchObject({ kind: 'image', src: 'data:image/webp;base64,YWJj', alt: 'figure.png' })
  })

  it('수동으로 늘린 텍스트 높이를 저장 문서에서 유지한다', () => {
    const parsed = parseCanvasDocument({
      version: 2,
      nodes: [{
        id: 'text-1',
        position: { x: 80, y: 80 },
        data: { block: { kind: 'paragraph', width: 320, height: 200, manualHeight: true, style: createDefaultTextBlockStyle(), text: '짧은 내용' } },
      }],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
    })
    expect(parsed.nodes[0]?.data.block.manualHeight).toBe(true)
  })

  it('Markdown 발췌의 의미 형식과 원문 범위를 V2 블록으로 읽는다', () => {
    const selection: MarkdownExcerptSelection = {
      path: 'docs/guide.md',
      title: 'Guide',
      quote: '선택한 제목',
      prefix: '',
      suffix: ' 본문',
      startOffset: 0,
      endOffset: 6,
      format: 'heading-2',
    }
    const style = createDefaultTextBlockStyle('h2')

    const parsed = parseCanvasDocument({
      version: 2,
      nodes: [{
        id: 'markdown-excerpt-0',
        type: 'markdownExcerpt',
        position: { x: 40, y: 50 },
        data: { block: {
          kind: 'markdownExcerpt',
          width: 280,
          height: 70,
          style,
          selection,
          source: { relation: 'markdown-excerpt', selection },
        } },
      }],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
    })

    expect(parsed.nodes[0]?.data.block).toEqual({
      kind: 'markdownExcerpt',
      width: 280,
      height: 70,
      style,
      selection,
      source: { relation: 'markdown-excerpt', selection },
    })
  })

  it('위치와 블록 크기를 한 칸 단위로 정규화한다', () => {
    expect(CANVAS_GRID_SIZE).toBe(20)
    expect(normalizeCanvasPosition({ x: 31, y: 46 })).toEqual({ x: 40, y: 50 })

    const block = {
      kind: 'paragraph' as const,
      width: 300,
      height: 120,
      style: parseCanvasDocument(validDocument).nodes[1]!.data.block.style,
      text: '본문',
    }
    expect(normalizeCanvasBlockSize(block, { width: 413, height: 174 })).toEqual({
      width: 420,
      height: 170,
    })
  })

  it('내용이 넘치면 내부 스크롤 대신 다음 격자 높이까지 확장한다', () => {
    const block = {
      kind: 'paragraph' as const,
      width: 300,
      height: 120,
      style: parseCanvasDocument(validDocument).nodes[1]!.data.block.style,
      text: '긴 본문',
    }

    expect(normalizeCanvasBlockSize(block, { width: 300, height: 120 }, 153)).toEqual({
      width: 300,
      height: 160,
    })
  })

  it('PDF 발췌의 원본 crop 비율을 계산한다', () => {
    const migrated = parseCanvasDocument(validDocument)
    const block = migrated.nodes[0]!.data.block as PdfExcerptCanvasBlock

    expect(pdfExcerptAspectRatio(block)).toBeCloseTo(48 / 20)
    expect(normalizeCanvasBlockSize(block, { width: 413, height: 999 })).toEqual({
      width: 413,
      height: 413 / (48 / 20),
    })
  })

  it('Markdown 캡처는 일반 텍스트 격자 대신 캡처 원본 비율을 유지한다', () => {
    const selection: MarkdownExcerptSelection = {
      path: 'docs/guide.md', title: 'Guide', quote: '본문', prefix: '', suffix: '',
      startOffset: 0, endOffset: 2, format: 'paragraph',
    }
    const block = {
      kind: 'markdownExcerpt' as const,
      width: 240,
      height: 80,
      style: createDefaultTextBlockStyle(),
      selection,
      capture: {
        sourceFileId: 'md-1', sourceHash: 'hash', anchor: { startOffset: 0, endOffset: 2 },
        plainText: '본문', renderedSnapshot: '<p>본문</p>', width: 240, height: 80, aspectRatio: 3,
      },
      source: { relation: 'markdown-excerpt' as const, selection },
    }

    expect(normalizeCanvasBlockSize(block, { width: 333, height: 999 })).toEqual({
      width: 333,
      height: 111,
    })
  })

  it('본문은 20px, H2 는 25px 이고 H1-H6는 단계별로 서로 다른 기본 크기를 사용한다', () => {
    expect(textBlockLevelFontSize('paragraph')).toBe(20)
    expect(['h1', 'h2', 'h3', 'h4', 'h5', 'h6'].map((level) => (
      textBlockLevelFontSize(level as 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6')
    ))).toEqual([32, 25, 23, 21, 20, 18])
    expect(createDefaultTextBlockStyle('h3')).toMatchObject({ fontSize: 23, bold: true })
    expect(createDefaultTextBlockStyle()).toMatchObject({ fontSize: 20, borderColor: '#c9ced6' })
  })

  it('도형과 코드 프리셋 블록 및 선 양끝 마커를 V2 문서로 읽는다', () => {
    const style = createDefaultTextBlockStyle()
    const parsed = parseCanvasDocument({
      version: 2,
      nodes: [
        { id: 'rectangle-0', type: 'presetBlock', position: { x: 0, y: 0 }, data: { block: { kind: 'rectangle', width: 240, height: 120, style } } },
        { id: 'square-0', type: 'presetBlock', position: { x: 260, y: 0 }, data: { block: { kind: 'square', width: 160, height: 160, style } } },
        { id: 'ellipse-0', type: 'presetBlock', position: { x: 440, y: 0 }, data: { block: { kind: 'ellipse', width: 240, height: 120, style } } },
        { id: 'diamond-0', type: 'presetBlock', position: { x: 700, y: 0 }, data: { block: { kind: 'diamond', width: 180, height: 180, style } } },
        { id: 'code-0', type: 'presetBlock', position: { x: 0, y: 200 }, data: { block: { kind: 'code', width: 320, height: 100, text: 'const value = 1', style: { ...style, code: true } } } },
      ],
      edges: [{ id: 'edge-0', source: 'rectangle-0', target: 'ellipse-0', startMarker: 'none', endMarker: 'arrow' }],
      viewport: { x: 0, y: 0, zoom: 1 },
    })

    expect(parsed.nodes.map(({ data }) => data.block.kind)).toEqual(['rectangle', 'square', 'ellipse', 'diamond', 'code'])
    expect(parsed.edges[0]).toMatchObject({ startMarker: 'none', endMarker: 'arrow' })
  })

  it('기존 V2 서식에는 별도 블록 배경 기본값을 보충한다', () => {
    const migrated = parseCanvasDocument(validDocument)
    const legacyV2 = {
      ...migrated,
      nodes: migrated.nodes.map((node) => ({
        ...node,
        data: {
          block: {
            ...node.data.block,
            style: Object.fromEntries(Object.entries(node.data.block.style).filter(([key]) => key !== 'background')),
          },
        },
      })),
    }

    const parsed = parseCanvasDocument(legacyV2)
    expect(parsed.nodes.every((node) => node.data.block.style.background === 'transparent')).toBe(true)
    expect(parsed.nodes.every((node) => node.data.block.style.highlight === 'transparent')).toBe(true)
  })

  it('화살표 블록과 단일 면 포트 id를 현재 V2 형식으로 이전한다', () => {
    const style = { ...parseCanvasDocument(validDocument).nodes[1]!.data.block.style, background: 'transparent' }
    const parsed = parseCanvasDocument({
      version: 2,
      nodes: [
        {
          id: 'arrow-0',
          type: 'textBlock',
          position: { x: 40, y: 50 },
          data: { block: { kind: 'arrow', width: 200, height: 40, direction: 'right', style } },
        },
        {
          id: 'body-0',
          type: 'textBlock',
          position: { x: 280, y: 50 },
          data: { block: { kind: 'paragraph', width: 280, height: 80, text: '', style } },
        },
      ],
      edges: [{
        id: 'edge-0',
        source: 'arrow-0',
        target: 'body-0',
        sourceHandle: 'source-right',
        targetHandle: 'target-left',
      }],
      viewport: { x: 0, y: 0, zoom: 1 },
    })

    expect(parsed.nodes[0]?.data.block).toMatchObject({ kind: 'arrow', direction: 'right' })
    expect(parsed.edges[0]).toMatchObject({ sourceHandle: 'right', targetHandle: 'left' })
  })

  it('V1 제목과 PDF 발췌 노드를 V2 공통 블록으로 이전한다', () => {
    const parsed = parseCanvasDocument(validDocument)
    expect(parsed.version).toBe(2)
    expect(parsed.nodes[0]?.data).toMatchObject({
      block: {
        kind: 'pdfExcerpt',
        width: 280,
        height: 120,
        excerpt: expect.objectContaining({ id: 'excerpt-1' }),
        source: {
          relation: 'excerpt',
          anchor: excerptSelection.anchor,
        },
      },
    })
    expect(parsed.nodes[1]?.data).toMatchObject({
      block: {
        kind: 'title',
        text: 'Title',
        width: expect.any(Number),
        height: expect.any(Number),
        style: expect.objectContaining({ level: 'h1' }),
      },
    })
    expect(parsed).not.toBe(validDocument)
  })

  it('V2 블록은 유효한 크기와 서식을 요구한다', () => {
    const migrated = parseCanvasDocument(validDocument)
    const first = migrated.nodes[0]!

    expect(() => parseCanvasDocument({
      ...migrated,
      nodes: [{
        ...first,
        data: {
          block: {
            ...(first.data.block as object),
            width: 0,
          },
        },
      }, migrated.nodes[1]],
      edges: [],
    })).toThrow('블록 크기')

    const title = migrated.nodes[1]!
    expect(() => parseCanvasDocument({
      ...migrated,
      nodes: [first, {
        ...title,
        data: {
          block: {
            ...(title.data.block as object),
            style: {
              ...((title.data.block as { style: object }).style),
              level: 'hero',
            },
          },
        },
      }],
      edges: [],
    })).toThrow('블록 서식')
  })

  it('함수와 유한하지 않은 좌표를 거부한다', () => {
    expect(() => parseCanvasDocument({
      ...validDocument,
      nodes: [{
        id: 'bad',
        position: { x: 0, y: 0 },
        data: { onOpenSource() {} },
      }],
      edges: [],
    })).toThrow('직렬화')

    expect(() => parseCanvasDocument({
      ...validDocument,
      viewport: { x: 0, y: 0, zoom: Number.NaN },
    })).toThrow('viewport')
  })

  it('중복 노드와 존재하지 않는 노드를 가리키는 edge를 거부한다', () => {
    expect(() => parseCanvasDocument({
      ...validDocument,
      nodes: [validDocument.nodes[0], validDocument.nodes[0]],
      edges: [],
    })).toThrow('중복')

    expect(() => parseCanvasDocument({
      ...validDocument,
      edges: [{ id: 'bad-edge', source: 'missing', target: 'excerpt-1' }],
    })).toThrow('노드')
  })

  it('잘못된 PDF 발췌 블록을 거부한다', () => {
    const excerpt = validDocument.nodes[0]!
    expect(() => parseCanvasDocument({
      ...validDocument,
      nodes: [{
        ...excerpt,
        data: {
          block: {
            ...(excerpt.data.block as object),
            selection: { ...excerptSelection, mode: 'unknown' },
          },
        },
      }],
      edges: [],
    })).toThrow('PDF 발췌')
  })

  it('테두리 두께는 선택 항목으로 읽고 명령으로 바꾼다', () => {
    const style = { ...createDefaultTextBlockStyle(), borderWidth: 3 }
    const block = parseCanvasBlock({ kind: 'rectangle', width: 40, height: 20, style })
    expect(block.style.borderWidth).toBe(3)
    expect(parseCanvasBlock({ kind: 'rectangle', width: 40, height: 20, style: createDefaultTextBlockStyle() }).style.borderWidth).toBeUndefined()
    expect(() => parseCanvasBlock({ kind: 'rectangle', width: 40, height: 20, style: { ...style, borderWidth: -1 } })).toThrow()
    expect(applyCanvasBlockCommand(block, { type: 'setBlockBorderWidth', borderWidth: 6 }).style.borderWidth).toBe(6)
  })
})
