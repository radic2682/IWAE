import type {
  CanvasBlockData,
  CanvasDocumentV2,
  PersistedCanvasNode,
  TextBlockLevel,
  TextBlockStyle,
} from './canvasDocument'

export type BlockFormatCommand =
  | { readonly type: 'setLevel'; readonly level: TextBlockLevel }
  | { readonly type: 'setFontSize'; readonly fontSize: number }
  | { readonly type: 'toggleBold' }
  | { readonly type: 'toggleItalic' }
  | { readonly type: 'toggleUnderline' }
  | { readonly type: 'toggleStrike' }
  | { readonly type: 'toggleCode' }
  | { readonly type: 'setAlign'; readonly align: TextBlockStyle['align'] }
  | { readonly type: 'toggleList'; readonly list: Exclude<TextBlockStyle['list'], 'none'> }
  | { readonly type: 'setColor'; readonly color: string }
  | { readonly type: 'setHighlight'; readonly highlight: string }

function clampedFontSize(fontSize: number): number {
  if (Number.isNaN(fontSize) || fontSize === Number.NEGATIVE_INFINITY) return 8
  if (fontSize === Number.POSITIVE_INFINITY) return 96
  return Math.min(Math.max(fontSize, 8), 96)
}

function formattedStyle(style: TextBlockStyle, command: BlockFormatCommand): TextBlockStyle {
  switch (command.type) {
    case 'setLevel':
      return style.level === command.level ? style : { ...style, level: command.level }
    case 'setFontSize': {
      const fontSize = clampedFontSize(command.fontSize)
      return style.fontSize === fontSize ? style : { ...style, fontSize }
    }
    case 'toggleBold':
      return { ...style, bold: !style.bold }
    case 'toggleItalic':
      return { ...style, italic: !style.italic }
    case 'toggleUnderline':
      return { ...style, underline: !style.underline }
    case 'toggleStrike':
      return { ...style, strike: !style.strike }
    case 'toggleCode':
      return { ...style, code: !style.code }
    case 'setAlign':
      return style.align === command.align ? style : { ...style, align: command.align }
    case 'toggleList': {
      const list = style.list === command.list ? 'none' : command.list
      return { ...style, list }
    }
    case 'setColor':
      return style.color === command.color ? style : { ...style, color: command.color }
    case 'setHighlight':
      return style.highlight === command.highlight
        ? style
        : { ...style, highlight: command.highlight }
  }
}

function formattedBlock(block: CanvasBlockData, command: BlockFormatCommand): CanvasBlockData {
  if (block.kind === 'pdfExcerpt' || block.kind === 'markdownExcerpt') return block
  const style = formattedStyle(block.style, command)
  if (style === block.style) return block
  return { ...block, style }
}

export function applyBlockFormat(
  nodes: CanvasDocumentV2['nodes'],
  ids: ReadonlySet<string>,
  command: BlockFormatCommand,
): readonly PersistedCanvasNode[] {
  let changed = false
  const formatted = nodes.map((node) => {
    if (!ids.has(node.id)) return node
    const block = formattedBlock(node.data.block, command)
    if (block === node.data.block) return node
    changed = true
    return { ...node, data: { block } }
  })

  return changed ? formatted : nodes
}
