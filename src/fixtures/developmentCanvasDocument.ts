import { buildAnchor, type Anchor } from '../core/anchor'
import {
  createDefaultTextBlockStyle,
  type CanvasBlockData,
  type CanvasDocumentV2,
  type PersistedCanvasNode,
  type TextBlockLevel,
} from '../core/canvasDocument'
import { createPdfExcerptBlock, createTextExcerptSelection, type PdfExcerptSelection } from '../core/pdfExcerpt'
import {
  SAMPLE_DOC_ID,
  SAMPLE_TITLE,
  samplePageSizes,
  samplePageTextIndex,
} from '../pdf/samplePage'

interface ExcerptFixture {
  readonly node: PersistedCanvasNode
  readonly anchor: Anchor
}

function textNode(
  id: string,
  kind: 'title' | 'paragraph' | 'code',
  text: string,
  x: number,
  y: number,
  width: number,
  height: number,
  level: TextBlockLevel = 'paragraph',
  styleOverrides: Partial<ReturnType<typeof createDefaultTextBlockStyle>> = {},
): PersistedCanvasNode {
  return {
    id,
    type: 'textBlock',
    position: { x, y },
    data: {
      block: {
        kind,
        width,
        height,
        style: { ...createDefaultTextBlockStyle(level), ...styleOverrides },
        text,
      },
    },
    className: 'note-canvas-node',
  }
}

function contextCrop(selection: PdfExcerptSelection, targetAspectRatio = 3): PdfExcerptSelection {
  const [pageWidth, pageHeight] = selection.pageSize
  const desiredHeight = Math.max(selection.crop.h, selection.crop.w / targetAspectRatio)
  const centerY = selection.crop.y + selection.crop.h / 2
  const y = Math.max(0, Math.min(pageHeight - desiredHeight, centerY - desiredHeight / 2))
  return {
    ...selection,
    crop: {
      x: Math.max(0, Math.min(pageWidth - selection.crop.w, selection.crop.x)),
      y,
      w: selection.crop.w,
      h: Math.min(desiredHeight, pageHeight),
    },
  }
}

function excerptNode(
  id: string,
  page: number,
  quote: string,
  x: number,
  y: number,
  width = 360,
): ExcerptFixture {
  const index = samplePageTextIndex(page)
  const start = index.text.indexOf(quote)
  if (start < 0) throw new Error(`개발 PDF 인용문을 찾을 수 없습니다: ${quote}`)
  const anchor = buildAnchor(SAMPLE_DOC_ID, page, index, start, start + quote.length)
  const selection = contextCrop(createTextExcerptSelection(anchor, index, samplePageSizes[page] ?? [612, 792]))
  const height = width / (selection.crop.w / selection.crop.h)
  const excerpt = createPdfExcerptBlock({
    id,
    selection,
    sourceTitle: SAMPLE_TITLE,
    geometry: { x, y, width, height },
  })
  const block: CanvasBlockData = {
    kind: 'pdfExcerpt',
    width,
    height,
    visualAspectRatio: selection.crop.w / selection.crop.h,
    style: createDefaultTextBlockStyle(),
    excerpt,
    source: { relation: 'excerpt', anchor },
  }
  return {
    anchor,
    node: {
      id,
      type: 'pdfExcerpt',
      position: { x, y },
      data: { block },
      className: 'note-canvas-node',
    },
  }
}

export function createDevelopmentCanvasDocument(): CanvasDocumentV2 {
  const workflow = excerptNode(
    'sample-workflow',
    1,
    'A useful research note preserves the claim, the surrounding context, and a direct route back to the source.',
    80,
    330,
  )
  const capture = excerptNode(
    'sample-capture',
    2,
    'Capture only enough material to preserve meaning; the smallest useful excerpt is easier to compare and reuse.',
    500,
    330,
  )
  const synthesis = excerptNode(
    'sample-synthesis',
    4,
    'Spatial arrangement turns a list of quotations into an argument you can inspect.',
    80,
    540,
  )

  const translationStyle = createDefaultTextBlockStyle()
  const translation: PersistedCanvasNode = {
    id: 'sample-translation',
    type: 'translation',
    position: { x: 500, y: 750 },
    data: {
      block: {
        kind: 'translation',
        width: 360,
        height: 110,
        style: { ...translationStyle, color: '#17212b', background: '#eaf6f2', borderColor: '#147d78' },
        text: '공간 배치는 인용문 목록을 눈으로 검토할 수 있는 논증 구조로 바꿉니다.',
        sourceBlockId: synthesis.node.id,
        targetLanguage: 'ko',
        model: 'Sample translation',
        source: { relation: 'translation', anchor: synthesis.anchor },
      },
    },
    className: 'note-canvas-node',
  }

  const nodes: PersistedCanvasNode[] = [
    textNode(
      'sample-title',
      'title',
      'Evidence Map — From Source to Insight',
      80,
      60,
      780,
      80,
      'h2',
      { color: '#17212b', background: '#f5c85b', borderColor: '#18334a' },
    ),
    textNode(
      'sample-question',
      'paragraph',
      'How can a research workspace preserve context while still making evidence easy to compare?',
      80,
      180,
      780,
      90,
      'h5',
      { color: '#ffffff', background: '#18334a', borderColor: '#147d78' },
    ),
    workflow.node,
    capture.node,
    synthesis.node,
    textNode(
      'sample-insight',
      'paragraph',
      'Working conclusion\n\nCapture narrowly, keep the source route attached, and use spatial structure to expose how evidence supports the claim.',
      500,
      540,
      360,
      150,
      'paragraph',
      { color: '#17212b', background: '#ffffff', borderColor: '#f27c62' },
    ),
    translation,
    textNode(
      'sample-code',
      'code',
      'question -> evidence\nevidence -> interpretation\ninterpretation -> reviewable claim',
      80,
      750,
      360,
      150,
      'paragraph',
      { code: true, background: '#18334a', borderColor: '#18334a', color: '#ffffff' },
    ),
  ]

  return {
    version: 2,
    nodes,
    edges: [
      { id: 'title-question', source: 'sample-title', target: 'sample-question', sourceHandle: 'bottom', targetHandle: 'top', endMarker: 'arrow' },
      { id: 'question-workflow', source: 'sample-question', target: workflow.node.id, sourceHandle: 'bottom', targetHandle: 'top', endMarker: 'arrow' },
      { id: 'question-capture', source: 'sample-question', target: capture.node.id, sourceHandle: 'right', targetHandle: 'top', endMarker: 'arrow' },
      { id: 'question-synthesis', source: 'sample-question', target: synthesis.node.id, sourceHandle: 'right', targetHandle: 'top', endMarker: 'arrow' },
      { id: 'workflow-insight', source: workflow.node.id, target: 'sample-insight', sourceHandle: 'right', targetHandle: 'left', endMarker: 'arrow' },
      { id: 'capture-insight', source: capture.node.id, target: 'sample-insight', sourceHandle: 'bottom', targetHandle: 'top', endMarker: 'arrow' },
      { id: 'synthesis-translation', source: synthesis.node.id, target: translation.id, sourceHandle: 'bottom', targetHandle: 'top', endMarker: 'arrow' },
      { id: 'insight-code', source: 'sample-insight', target: 'sample-code', sourceHandle: 'left', targetHandle: 'right', endMarker: 'arrow' },
    ],
    viewport: { x: 14, y: 78, zoom: 0.52 },
  }
}
