import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react'
import type { Node, NodeProps } from '@xyflow/react'
import { ArrowRight } from '@phosphor-icons/react'
import type {
  ArrowCanvasBlock,
  TextBlockStyle,
  TextCanvasBlock,
  TranslationCanvasBlock,
} from '../../core/canvasDocument'
import type { CanvasMemoSource } from '../../core/canvasMemo'
import { CanvasBlockShell, useCanvasBlockRuntime } from './CanvasBlockShell'
import { CanvasMemoCard } from './CanvasMemoCard'
import type { CanvasSide } from '../../core/canvasPorts'
import { t } from '../../i18n'
import { registerEditorFlusher } from '../editorFlush'

export interface TextBlockNodeData extends Record<string, unknown> {
  readonly block: TextCanvasBlock | ArrowCanvasBlock
  readonly touchingSides?: ReadonlySet<CanvasSide>
  /** 이 글에 선으로 이어진 형광펜들. 있으면 노트 메모 카드로 그린다(NoteCanvas 가 선에서 구해 준다) */
  readonly memoSources?: readonly CanvasMemoSource[]
}

export type TextBlockFlowNode = Node<TextBlockNodeData, 'textBlock'>

export function textBlockCss(style: TextBlockStyle): CSSProperties {
  const listStyleType = style.list === 'bullet' ? 'disc' : style.list === 'number' ? 'decimal' : undefined
  return {
    fontSize: `${style.fontSize}px`,
    fontWeight: style.bold ? 700 : 400,
    fontStyle: style.italic ? 'italic' : 'normal',
    textDecoration: [style.underline ? 'underline' : '', style.strike ? 'line-through' : ''].filter(Boolean).join(' ') || 'none',
    textAlign: style.align,
    color: style.color === '#1f2328' ? 'var(--text-strong)' : style.color,
    fontFamily: style.code ? 'ui-monospace, SFMono-Regular, Consolas, monospace' : 'inherit',
    display: listStyleType === undefined ? undefined : 'list-item',
    listStyleType,
    listStylePosition: listStyleType === undefined ? undefined : 'inside',
  }
}

/** 쓴 글 그대로: 줄바꿈(Enter 로 생긴 문단 · <br>)을 살린다. 폭 없는 글자와 끝의 빈 줄은 뗀다 */
export function editableText(target: HTMLElement): string {
  const raw = target.innerText ?? target.textContent ?? ''
  return raw.replace(/\u200b/gu, '').replace(/\r\n?/gu, '\n').replace(/\n+$/u, '')
}

export function CanvasTextEditor({
  id,
  block,
  selected,
}: {
  id: string
  block: TextCanvasBlock | TranslationCanvasBlock
  selected: boolean
}) {
  const runtime = useCanvasBlockRuntime()
  const editorRef = useRef<HTMLDivElement | null>(null)
  const [editing, setEditing] = useState(false)

  useLayoutEffect(() => {
    if (!editing) return
    const editor = editorRef.current
    if (editor === null) return
    editor.textContent = block.text
    editor.focus()
  }, [block.text, editing])

  useEffect(() => {
    if (!selected) setEditing(false)
  }, [selected])

  // 형광펜에서 막 만든 메모는 바로 글을 쓸 수 있게 연다
  useEffect(() => {
    if (runtime.autoEditBlockId !== id || !selected) return
    setEditing(true)
    runtime.onAutoEditStarted?.(id)
  }, [id, runtime, selected])

  // 쓰는 중에 포커스를 잃지 않고 사라지는 길(칸 닫기 · 화면 전환)과 창 닫기 전에도 쓴 글을 저장한다
  const editingRef = useRef(false)
  const committedRef = useRef(true)
  const runtimeRef = useRef(runtime)
  runtimeRef.current = runtime
  editingRef.current = editing

  const commit = (target: HTMLDivElement) => {
    const text = editableText(target)
    committedRef.current = true
    target.replaceChildren()
    runtime.onTextCommit?.(id, text)
  }

  useLayoutEffect(() => {
    if (editing) committedRef.current = false
  }, [editing])

  useLayoutEffect(() => {
    const flush = () => {
      const editor = editorRef.current
      if (!editingRef.current || committedRef.current || editor === null) return
      // 창을 닫는 길: 글은 내려 보내되 칸은 그대로 둔다(창이 안 닫히면 이어 쓴다)
      runtimeRef.current.onTextCommit?.(id, editableText(editor))
    }
    const unregister = registerEditorFlusher(flush)
    return () => {
      unregister()
      const editor = editorRef.current
      if (editor !== null && editingRef.current && !committedRef.current) {
        committedRef.current = true
        runtimeRef.current.onTextCommit?.(id, editableText(editor))
      }
    }
    // id 는 이 칸이 사는 동안 바뀌지 않는다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const exitWithKeyboard = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!editing && selected && event.key === 'Enter') {
      event.preventDefault()
      event.stopPropagation()
      setEditing(true)
      return
    }
    if (editing && event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      commit(event.currentTarget)
      setEditing(false)
    }
  }

  return (
    <div
      ref={editorRef}
      role="textbox"
      aria-multiline="true"
      aria-label={editing ? t('텍스트 편집 중') : t('텍스트 블록, 눌러서 편집')}
      contentEditable={editing}
      suppressContentEditableWarning
      className={`canvas-text-editor ${editing ? 'nodrag nowheel canvas-text-editor-editing' : 'drag-handle canvas-text-editor-draggable'}`}
      data-canvas-auto-grow="true"
      data-editing={editing ? 'true' : 'false'}
      style={{
        ...textBlockCss(block.style),
        overflow: 'visible',
        height: 'auto',
        cursor: editing ? 'text' : 'grab',
        userSelect: editing ? 'text' : 'none',
      }}
      onClick={(event) => {
        if (editing) return
        event.stopPropagation()
        runtime.onSelectBlock?.(id)
      }}
      onDoubleClick={(event) => {
        if (editing || !selected) return
        event.preventDefault()
        event.stopPropagation()
        setEditing(true)
      }}
      onPointerDown={(event) => {
        if (editing) event.stopPropagation()
      }}
      onKeyDown={exitWithKeyboard}
      onBlur={(event) => {
        if (!editing) return
        commit(event.currentTarget)
        setEditing(false)
      }}
    >
      {editing
        ? null
        : <span className="canvas-text-highlight" style={{ backgroundColor: block.style.highlight }}>{block.text}</span>}
    </div>
  )
}

export function TextBlockNode({ id, data, selected }: NodeProps<TextBlockFlowNode>) {
  const runtime = useCanvasBlockRuntime()
  const { block } = data
  const memoSources = data.memoSources
  const memo = block.kind === 'paragraph' && memoSources !== undefined && memoSources.length > 0 ? { block, sources: memoSources } : null
  const isMemo = memo !== null
  const content = memo !== null
    ? <CanvasMemoCard id={id} block={memo.block} selected={selected} sources={memo.sources} />
    : block.kind === 'arrow'
    ? (
      <div className="canvas-arrow-block nodrag" aria-label={t('오른쪽 화살표')}>
        <ArrowRight aria-hidden="true" weight="regular" />
      </div>
    )
    : <CanvasTextEditor id={id} block={block} selected={selected} />
  return (
    <CanvasBlockShell
      id={id}
      block={block}
      selected={selected}
      touchingSides={data.touchingSides}
      className={isMemo ? 'canvas-block-memo' : undefined}
      onResizeFrame={runtime.onResizeFrame}
      onResizeCommit={runtime.onResizeCommit}
      onDelete={runtime.onDeleteBlock}
    >
      {content}
    </CanvasBlockShell>
  )
}

export const textBlockNodeTypes = {
  textBlock: TextBlockNode,
}
