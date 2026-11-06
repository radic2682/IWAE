import { describe, expect, it } from 'vitest'
import {
  createDefaultTextBlockStyle,
  type CanvasBlockData,
  type CanvasDocumentV2,
  type PersistedCanvasNode,
  type TextBlockLevel,
} from './canvasDocument'
import { applyBlockFormat, type BlockFormatCommand } from './blockFormatting'

const sourceAnchor = {
  docId: 'doc-a',
  page: 2,
  coordSpace: 'pdfium-page' as const,
  rects: [{ x: 10, y: 20, w: 40, h: 12 }],
  charRange: [0, 4] as const,
  quote: 'test',
  prefix: '',
  suffix: '',
}

function node(id: string, block: CanvasBlockData): PersistedCanvasNode {
  return { id, position: { x: 10, y: 20 }, data: { block } }
}

const nodes: CanvasDocumentV2['nodes'] = [
  node('title-1', {
    kind: 'title',
    width: 320,
    height: 96,
    style: createDefaultTextBlockStyle('h1'),
    text: 'Title',
  }),
  node('body-1', {
    kind: 'paragraph',
    width: 280,
    height: 120,
    style: createDefaultTextBlockStyle(),
    text: 'Body',
  }),
  node('translation-1', {
    kind: 'translation',
    width: 280,
    height: 120,
    style: createDefaultTextBlockStyle(),
    text: '번역',
    sourceBlockId: 'excerpt-1',
    targetLanguage: 'ko',
    model: 'translategemma:4b',
    source: { relation: 'translation', anchor: sourceAnchor },
  }),
  node('excerpt-1', {
    kind: 'pdfExcerpt',
    width: 280,
    height: 120,
    style: createDefaultTextBlockStyle(),
    excerpt: {
      id: 'excerpt-1',
      type: 'pdfExcerpt',
      x: 10,
      y: 20,
      width: 280,
      height: 120,
      text: 'test',
      sourceTitle: 'Source',
      selection: {
        mode: 'text',
        anchor: sourceAnchor,
        pageSize: [612, 792],
        crop: { x: 8, y: 18, w: 44, h: 16 },
        glyphs: [{ c: 't', x: 10, y: 20, w: 8, h: 12 }],
      },
      iwae: { kind: 'pdf-excerpt', anchor: sourceAnchor },
    },
    source: { relation: 'excerpt', anchor: sourceAnchor },
  }),
]

function blockOf(result: readonly PersistedCanvasNode[], id: string): CanvasBlockData {
  const found = result.find((candidate) => candidate.id === id)
  if (found === undefined) throw new Error(`missing node: ${id}`)
  return found.data.block
}

describe('applyBlockFormat', () => {
  it.each<TextBlockLevel>(['paragraph', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6'])(
    '선택한 텍스트 블록의 레벨을 %s로 설정한다',
    (level) => {
      const next = applyBlockFormat(nodes, new Set(['body-1']), { type: 'setLevel', level })

      expect(blockOf(next, 'body-1').style.level).toBe(level)
      expect(blockOf(next, 'title-1').style.level).toBe('h1')
    },
  )

  it('글자 크기를 8에서 96 사이로 제한한다', () => {
    const tooSmall = applyBlockFormat(nodes, new Set(['body-1']), { type: 'setFontSize', fontSize: 2 })
    const tooLarge = applyBlockFormat(nodes, new Set(['body-1']), { type: 'setFontSize', fontSize: 200 })
    const withinRange = applyBlockFormat(nodes, new Set(['body-1']), { type: 'setFontSize', fontSize: 24 })

    expect(blockOf(tooSmall, 'body-1').style.fontSize).toBe(8)
    expect(blockOf(tooLarge, 'body-1').style.fontSize).toBe(96)
    expect(blockOf(withinRange, 'body-1').style.fontSize).toBe(24)
  })

  it.each<[BlockFormatCommand['type'], keyof CanvasBlockData['style']]>([
    ['toggleBold', 'bold'],
    ['toggleItalic', 'italic'],
    ['toggleUnderline', 'underline'],
    ['toggleStrike', 'strike'],
    ['toggleCode', 'code'],
  ])('%s 명령으로 선택한 텍스트 블록의 %s 상태를 토글한다', (type, property) => {
    const command = { type } as BlockFormatCommand
    const selected = new Set(['body-1', 'translation-1'])
    const next = applyBlockFormat(nodes, selected, command)
    const toggledBack = applyBlockFormat(next, selected, command)

    expect(blockOf(next, 'body-1').style[property]).toBe(true)
    expect(blockOf(next, 'translation-1').style[property]).toBe(true)
    expect(blockOf(toggledBack, 'body-1').style[property]).toBe(false)
  })

  it('선택한 텍스트 블록의 정렬을 설정한다', () => {
    const next = applyBlockFormat(nodes, new Set(['title-1', 'body-1']), {
      type: 'setAlign',
      align: 'center',
    })

    expect(blockOf(next, 'title-1').style.align).toBe('center')
    expect(blockOf(next, 'body-1').style.align).toBe('center')
    expect(blockOf(next, 'translation-1').style.align).toBe('left')
  })

  it('글머리와 번호 목록을 상호 배타적으로 토글한다', () => {
    const bullet = applyBlockFormat(nodes, new Set(['body-1']), { type: 'toggleList', list: 'bullet' })
    const number = applyBlockFormat(bullet, new Set(['body-1']), { type: 'toggleList', list: 'number' })
    const none = applyBlockFormat(number, new Set(['body-1']), { type: 'toggleList', list: 'number' })

    expect(blockOf(bullet, 'body-1').style.list).toBe('bullet')
    expect(blockOf(number, 'body-1').style.list).toBe('number')
    expect(blockOf(none, 'body-1').style.list).toBe('none')
  })

  it('글자색과 형광펜색을 설정한다', () => {
    const colored = applyBlockFormat(nodes, new Set(['body-1']), { type: 'setColor', color: '#123456' })
    const highlighted = applyBlockFormat(colored, new Set(['body-1']), {
      type: 'setHighlight',
      highlight: '#fff3a3',
    })

    expect(blockOf(highlighted, 'body-1').style.color).toBe('#123456')
    expect(blockOf(highlighted, 'body-1').style.highlight).toBe('#fff3a3')
  })

  it('PDF 발췌 블록에는 모든 서식 명령을 무시한다', () => {
    const commands: readonly BlockFormatCommand[] = [
      { type: 'setLevel', level: 'h2' },
      { type: 'setFontSize', fontSize: 40 },
      { type: 'toggleBold' },
      { type: 'toggleItalic' },
      { type: 'toggleUnderline' },
      { type: 'toggleStrike' },
      { type: 'toggleCode' },
      { type: 'setAlign', align: 'right' },
      { type: 'toggleList', list: 'bullet' },
      { type: 'setColor', color: '#ffffff' },
      { type: 'setHighlight', highlight: '#000000' },
    ]

    const next = commands.reduce(
      (current, command) => applyBlockFormat(current, new Set(['excerpt-1']), command),
      nodes,
    )

    expect(blockOf(next, 'excerpt-1')).toBe(blockOf(nodes, 'excerpt-1'))
  })

  it('입력 노드를 변경하지 않고 선택되지 않은 노드의 참조를 보존한다', () => {
    const before = structuredClone(nodes)
    const next = applyBlockFormat(nodes, new Set(['body-1']), { type: 'toggleBold' })

    expect(nodes).toEqual(before)
    expect(next).not.toBe(nodes)
    expect(next[1]).not.toBe(nodes[1])
    expect(next[0]).toBe(nodes[0])
    expect(next[2]).toBe(nodes[2])
    expect(next[3]).toBe(nodes[3])
  })
})
