import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { CaretDown, CaretRight, Check, Code, DotsSixVertical, HighlighterCircle, ListBullets, ListChecks, ListNumbers, Star, Table, TextAa, TextB, TextItalic, TextStrikethrough, TextTSlash, TextUnderline, Trash } from '@phosphor-icons/react'
import { createPortal } from 'react-dom'
import { hasMemoFormatting, memoDisplayHtml, plainMemoTextToHtml, sanitizeMemoHtml, togglePlainCheck } from './memoRichText'
import { addTableColumn, addTableRow, deleteTableColumn, deleteTableRow, insertTable, moveTableCell, tableCellAt } from './memoTableEditing'
import {
  applyBlockMarkdown, applyInlineMarkdown, checkItemAt, checkItemIndex, currentBlockKind, handleMemoBackspace, handleMemoEnter, handleMemoTab,
  insideCodeBlock, looksLikeMarkdown, memoPlainText, setBlockKind, toggleCheckItem, toggleChecklist, toggleInlineCode, type MemoBlockKind,
} from './memoEditing'
import { useHighlightColors } from '../app/highlightColorStyle'
import { highlightColorLabel } from '../core/highlightColors'
import { sortMemosForList, type PersistentPdfHighlight } from './persistentHighlight'
import type { PdfHighlightColor } from './SelectionLayer'
import { RegionCrop } from './RegionCrop'
import { CategoryTag } from './CategoryTag'
import { t } from '../i18n'

/** 메모 카드 열의 최대 폭과 페이지와의 간격(px) */
export const MEMO_COLUMN_WIDTH = 380
export const MEMO_COLUMN_GAP = 28
/** 메모 열 맨 위 머리(검색칸)의 높이. 카드는 이 아래부터 쌓는다 */
export const MEMO_HEADER_HEIGHT = 46
const CARD_GAP = 8
const ESTIMATED_CARD_HEIGHT = 64

/** 메모 카드 하나가 붙을 자리: 형광펜이 있는 화면 위치(문서 좌표) */
export interface MemoTarget {
  readonly highlight: PersistentPdfHighlight
  /** 형광펜 첫 줄의 위쪽 */
  readonly top: number
  /** 선이 시작하는 점: 형광펜 첫 줄 오른쪽 끝, 높이는 첫 줄 가운데 */
  readonly anchorX: number
  readonly anchorY: number
  /** 아직 저장 안 된 새 메모(글을 쓰면 저장, 안 쓰고 나가면 사라진다) */
  readonly draft?: boolean
}

/** 카드를 형광펜 높이에 맞춰 놓는다. 앞 카드와 겹치면 아래로 비켜 쌓는다(문서 순서 그대로) */
export function stackMemoCards(targets: readonly MemoTarget[], heights: ReadonlyMap<string, number>): Map<string, number> {
  const placed = new Map<string, number>()
  let bottom = -Infinity
  for (const target of [...targets].sort((a, b) => a.top - b.top || a.anchorX - b.anchorX)) {
    const top = Math.max(target.top - 6, bottom + CARD_GAP)
    placed.set(target.highlight.id, top)
    bottom = top + (heights.get(target.highlight.id) ?? ESTIMATED_CARD_HEIGHT)
  }
  return placed
}


/** 메모 내용: 글(검색·MCP 용)과 서식 HTML(꾸밈이 없으면 빈 문자열) */
export interface MemoContent {
  readonly text: string
  readonly html: string
}

const TEXT_COLORS: readonly (readonly [string, string])[] = [
  ['검정', '#1f2328'], ['빨강', '#cf222e'], ['주황', '#bc4c00'], ['초록', '#1a7f37'], ['파랑', '#0969da'], ['보라', '#8250df'],
]
const BACK_COLORS: readonly (readonly [string, string])[] = [
  ['노랑', '#fff1a8'], ['초록', '#d3f5dc'], ['파랑', '#dbeafe'], ['분홍', '#fde2ef'], ['없음', 'transparent'],
]

function run(command: string, value?: string) {
  // 글자색·배경색은 <font> 대신 style 로 남긴다(저장할 때 걸러 내기 쉽게)
  document.execCommand('styleWithCSS', false, 'true')
  document.execCommand(command, false, value)
}

/** 지금 쓰고 있는 글쓰기 칸(서식 도구는 칸 밖, 노트 바 맨 위에 있을 수 있다) */
function activeMemoEditor(): HTMLElement | null {
  const node = window.getSelection()?.anchorNode ?? null
  const element = node instanceof Element ? node : node?.parentElement ?? null
  const editor = element?.closest('.pdf-memo-editor')
  return editor instanceof HTMLElement ? editor : null
}

/** 문단 모양 고르개: 이름, 단축 안내(Markdown 처럼 쓰는 법) */
const BLOCK_KINDS: readonly (readonly [MemoBlockKind, string, string])[] = [
  ['p', '본문', 'Ctrl+Alt+0'],
  ['h2', '제목 1', '# 띄어쓰기'],
  ['h3', '제목 2', '## 띄어쓰기'],
  ['h4', '제목 3', '### 띄어쓰기'],
  ['blockquote', '인용', '> 띄어쓰기'],
  ['pre', '코드 블록', '``` Enter'],
]
const BLOCK_LABEL: Record<MemoBlockKind, string> = { p: '본문', h2: '제목 1', h3: '제목 2', h4: '제목 3', blockquote: '인용', pre: '코드' }

/** 서식 도구줄: 누르는 동안 글쓰기 칸의 포커스를 빼앗지 않는다 */
/**
 * 서식 도구를 붙일 자리. 노트 바는 맨 위에 한 줄(늘 같은 자리)을 두고, 쓰는 중인 칸의 서식 단추를 그리로 보낸다.
 * 없으면(메모만 보기 등) 지금처럼 칸마다 위에 붙는다.
 */
export const MemoFormatSlotContext = createContext<HTMLElement | null>(null)

/** 서식 도구. disabled 면 쓰는 칸이 없을 때 맨 위 자리에 보이는 꺼진 도구 */
export function MemoFormatBar({ onCommand, disabled = false }: { readonly onCommand: () => void; readonly disabled?: boolean }) {
  const [palette, setPalette] = useState<'fore' | 'back' | 'block' | 'table' | null>(null)
  const [blockKind, setBlockKindState] = useState<MemoBlockKind>('p')
  // 커서가 표 안에 있는가(줄·칸 더하기·빼기를 켠다)
  const [inTable, setInTable] = useState(false)
  // 커서를 옮길 때마다 지금 문단 모양을 고르개에 보인다
  useEffect(() => {
    if (disabled) return
    const update = () => {
      const editor = activeMemoEditor()
      if (editor !== null) {
        setBlockKindState(currentBlockKind(editor))
        setInTable(tableCellAt(editor) !== null)
      }
    }
    update()
    document.addEventListener('selectionchange', update)
    return () => document.removeEventListener('selectionchange', update)
  }, [disabled])
  const withEditor = (action: (editor: HTMLElement) => void) => () => {
    const editor = activeMemoEditor()
    if (editor !== null) action(editor)
  }
  const button = (label: string, content: ReactNode, action: () => void) => (
    <button
      type="button"
      className="pdf-memo-format-button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onPointerDown={(event) => event.preventDefault()}
      onClick={() => {
        action()
        onCommand()
      }}
    >
      {content}
    </button>
  )
  return (
    <div className={`pdf-memo-format-bar${disabled ? ' pdf-memo-format-bar-idle' : ''}`} role="toolbar" aria-label={t('메모 서식')} aria-disabled={disabled || undefined}>
      <span className="pdf-memo-format-cluster">
      <span className="pdf-memo-format-group">
        <button
          type="button"
          className="pdf-memo-format-button pdf-memo-format-block"
          aria-label={t('문단 모양: {kind}', { kind: t(BLOCK_LABEL[blockKind]) })}
          aria-haspopup="menu"
          aria-expanded={palette === 'block'}
          title={t('문단 모양 (제목·인용·코드 블록)')}
          disabled={disabled}
          onPointerDown={(event) => event.preventDefault()}
          onClick={() => setPalette((current) => current === 'block' ? null : 'block')}
        >
          <span>{disabled ? t('본문') : t(BLOCK_LABEL[blockKind])}</span>
          <CaretDown size={11} weight="bold" aria-hidden="true" />
        </button>
        {palette === 'block' ? (
          <span className="pdf-memo-format-menu" role="menu" aria-label={t('문단 모양')}>
            {BLOCK_KINDS.map(([kind, name, hint]) => (
              <button
                key={kind}
                type="button"
                role="menuitemradio"
                aria-checked={blockKind === kind}
                className={`pdf-memo-format-menu-item pdf-memo-format-menu-${kind}`}
                onPointerDown={(event) => event.preventDefault()}
                onClick={withEditor((editor) => {
                  // 「본문」은 지금 모양을 한 번 더 고른 것과 같다(되돌리기)
                  setBlockKind(editor, kind === 'p' ? currentBlockKind(editor) : kind)
                  setBlockKindState(currentBlockKind(editor))
                  setPalette(null)
                  onCommand()
                })}
              >
                <span className="pdf-memo-format-menu-name">{t(name)}</span>
                <span className="pdf-memo-format-menu-hint">{t(hint)}</span>
              </button>
            ))}
            <button
              type="button"
              role="menuitem"
              className="pdf-memo-format-menu-item"
              onPointerDown={(event) => event.preventDefault()}
              onClick={() => {
                run('insertHorizontalRule')
                setPalette(null)
                onCommand()
              }}
            >
              <span className="pdf-memo-format-menu-name">{t('구분선')}</span>
              <span className="pdf-memo-format-menu-hint">--- Enter</span>
            </button>
          </span>
        ) : null}
      </span>
      </span>
      <span className="pdf-memo-format-cluster">
      {button(t('굵게 (Ctrl+B · **글**)'), <TextB size={15} weight="bold" aria-hidden="true" />, () => run('bold'))}
      {button(t('기울임 (Ctrl+I · *글*)'), <TextItalic size={15} aria-hidden="true" />, () => run('italic'))}
      {button(t('밑줄 (Ctrl+U)'), <TextUnderline size={15} aria-hidden="true" />, () => run('underline'))}
      {button(t('취소선 (~~글~~)'), <TextStrikethrough size={15} aria-hidden="true" />, () => run('strikeThrough'))}
      {button(t('코드 (Ctrl+E · `글`)'), <Code size={15} weight="bold" aria-hidden="true" />, withEditor(toggleInlineCode))}
      </span>
      <span className="pdf-memo-format-cluster">
      <span className="pdf-memo-format-group">
        {button(t('글자색'), <TextAa size={15} aria-hidden="true" />, () => setPalette((current) => current === 'fore' ? null : 'fore'))}
        {palette === 'fore' ? (
          <span className="pdf-memo-format-palette" role="group" aria-label={t('글자색')}>
            {TEXT_COLORS.map(([name, color]) => (
              <button
                key={color}
                type="button"
                className="pdf-memo-format-swatch"
                style={{ color }}
                aria-label={t('글자색 {name}', { name: t(name) })}
                onPointerDown={(event) => event.preventDefault()}
                onClick={() => {
                  run('foreColor', color)
                  setPalette(null)
                  onCommand()
                }}
              >
                A
              </button>
            ))}
          </span>
        ) : null}
      </span>
      <span className="pdf-memo-format-group">
        {button(t('배경색'), <HighlighterCircle size={15} aria-hidden="true" />, () => setPalette((current) => current === 'back' ? null : 'back'))}
        {palette === 'back' ? (
          <span className="pdf-memo-format-palette" role="group" aria-label={t('배경색')}>
            {BACK_COLORS.map(([name, color]) => (
              <button
                key={color}
                type="button"
                className="pdf-memo-format-swatch pdf-memo-format-swatch-back"
                style={{ background: color }}
                aria-label={t('배경색 {name}', { name: t(name) })}
                onPointerDown={(event) => event.preventDefault()}
                onClick={() => {
                  run('hiliteColor', color)
                  setPalette(null)
                  onCommand()
                }}
              />
            ))}
          </span>
        ) : null}
      </span>
      </span>
      <span className="pdf-memo-format-cluster">
      {button(t('글머리 목록 (- 띄어쓰기)'), <ListBullets size={15} aria-hidden="true" />, () => run('insertUnorderedList'))}
      {button(t('번호 목록 (1. 띄어쓰기)'), <ListNumbers size={15} aria-hidden="true" />, () => run('insertOrderedList'))}
      {button(t('할 일 목록 ([ ] 띄어쓰기)'), <ListChecks size={15} aria-hidden="true" />, withEditor(toggleChecklist))}
      <span className="pdf-memo-format-group">
        {button(t('표'), <Table size={15} aria-hidden="true" />, () => setPalette((current) => current === 'table' ? null : 'table'))}
        {palette === 'table' ? (
          <span className="pdf-memo-format-menu pdf-memo-format-table-menu" role="menu" aria-label={t('표')}>
            {([
              ['표 넣기 (3×3)', '| 칸 | 칸 | 붙여 넣기도 됨', (editor: HTMLElement) => insertTable(editor, 3, 3), false],
              ['줄 더하기', '마지막 칸에서 Tab', (editor: HTMLElement) => { addTableRow(editor) }, true],
              ['칸 더하기', '', (editor: HTMLElement) => { addTableColumn(editor) }, true],
              ['줄 빼기', '', (editor: HTMLElement) => { deleteTableRow(editor) }, true],
              ['칸 빼기', '', (editor: HTMLElement) => { deleteTableColumn(editor) }, true],
            ] as const).map(([name, hint, action, needsTable]) => (
              <button
                key={name}
                type="button"
                role="menuitem"
                className="pdf-memo-format-menu-item"
                disabled={needsTable && !inTable}
                onPointerDown={(event) => event.preventDefault()}
                onClick={withEditor((editor) => {
                  action(editor)
                  setInTable(tableCellAt(editor) !== null)
                  setPalette(null)
                  onCommand()
                })}
              >
                <span className="pdf-memo-format-menu-name">{t(name)}</span>
                {hint === '' ? null : <span className="pdf-memo-format-menu-hint">{t(hint)}</span>}
              </button>
            ))}
          </span>
        ) : null}
      </span>
      {button(t('서식 지우기'), <TextTSlash size={15} aria-hidden="true" />, () => run('removeFormat'))}
      </span>
    </div>
  )
}

/** 글 끝(마지막 의미 있는 노드)을 고른다. 빈 글자 노드는 건너뛴다 */
function lastMeaningfulChild(element: HTMLElement): ChildNode | null {
  let node = element.lastChild
  while (node !== null && node.nodeType === Node.TEXT_NODE && (node.textContent ?? '') === '') node = node.previousSibling
  return node
}

/** 커서가 글 맨 끝의 빈 줄에 있다(글이 있고, 그 뒤에 Enter 로 만든 빈 줄이 하나 있다) */
function endsWithEmptyLine(element: HTMLElement): boolean {
  if ((element.textContent ?? '').trim() === '') return false
  const selection = window.getSelection()
  if (selection === null || selection.rangeCount === 0 || !selection.isCollapsed) return false
  const caret = selection.getRangeAt(0)
  if (!element.contains(caret.startContainer)) return false
  const rest = document.createRange()
  rest.setStart(caret.startContainer, caret.startOffset)
  rest.setEnd(element, element.childNodes.length)
  if (rest.toString() !== '') return false
  const last = lastMeaningfulChild(element)
  if (last instanceof HTMLElement && /^(DIV|P)$/u.test(last.tagName)) return (last.textContent ?? '') === ''
  return last instanceof HTMLBRElement && last.previousSibling instanceof HTMLBRElement
}

/** 글도 구분선도 없는 빈 칸인가(안내 글을 보일지) */
function isBlank(element: HTMLElement): boolean {
  return (element.textContent ?? '').replace(/​/gu, '').trim() === '' && element.querySelector('hr, li, pre') === null
}

function dropTrailingEmptyLine(element: HTMLElement) {
  const last = lastMeaningfulChild(element)
  last?.remove()
}

/**
 * 메모 글쓰기 칸(서식 가능). 다른 곳을 누르거나 Ctrl+Enter 면 저장, Esc 면 그만둔다.
 * onNext 가 있으면(노트의 글 블록) Ctrl+Enter, 또는 끝에서 빈 줄에 Enter 를 한 번 더 누르면 저장하고 onNext(아래에 새 글).
 */
export function MemoEditor({ initialText, initialHtml, placeholder = t('메모를 쓰세요'), label = t('메모'), onSave, onCancel, onNext, discardEmptyOnBlur = false }: {
  /** 비운 채 다른 곳을 누르면 저장하지 않고 그만둔다(새 메모). Ctrl+Enter 로는 빈 채로도 남길 수 있다 */
  readonly discardEmptyOnBlur?: boolean
  readonly initialText: string
  readonly initialHtml?: string
  readonly placeholder?: string
  readonly label?: string
  readonly onSave: (content: MemoContent) => void
  readonly onCancel: () => void
  readonly onNext?: () => void
}) {
  const ref = useRef<HTMLDivElement | null>(null)
  const doneRef = useRef(false)
  const [empty, setEmpty] = useState(initialText.trim() === '')
  const formatSlot = useContext(MemoFormatSlotContext)

  useLayoutEffect(() => {
    const element = ref.current
    if (element === null) return
    element.innerHTML = memoDisplayHtml(initialText, initialHtml)
    element.focus()
    const range = document.createRange()
    range.selectNodeContents(element)
    range.collapse(false)
    const selection = window.getSelection()
    selection?.removeAllRanges()
    selection?.addRange(range)
    // 처음 한 번만 채운다(그 뒤로는 사람이 쓰는 대로 둔다)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const finish = (save: boolean) => {
    if (doneRef.current) return
    doneRef.current = true
    if (!save) {
      onCancel()
      return
    }
    const element = ref.current
    const text = element === null ? '' : memoPlainText(element)
    const html = text === '' ? '' : sanitizeMemoHtml(element?.innerHTML ?? '')
    onSave({ text, html: hasMemoFormatting(html) ? html : '' })
  }

  return (
    <div className="pdf-memo-editor-wrap">
      {(() => {
        const bar = <MemoFormatBar onCommand={() => setEmpty(ref.current === null || isBlank(ref.current))} />
        return formatSlot === null ? bar : createPortal(bar, formatSlot)
      })()}
      <div
        ref={ref}
        className={`pdf-memo-editor${empty ? ' pdf-memo-editor-empty' : ''}`}
        role="textbox"
        aria-multiline="true"
        aria-label={label}
        data-placeholder={placeholder}
        contentEditable
        suppressContentEditableWarning
        onInput={(event) => setEmpty(isBlank(event.currentTarget))}
        onPointerDown={(event) => {
          // 할 일 칸의 네모를 누르면 체크만 바꾼다(커서는 옮기지 않는다)
          const item = checkItemAt(event.target, event.clientX)
          if (item === null) return
          event.preventDefault()
          toggleCheckItem(item)
        }}
        onPaste={(event) => {
          const plain = event.clipboardData.getData('text/plain')
          if (insideCodeBlock(event.currentTarget)) {
            // 코드 블록에는 글 그대로(서식 없이)
            event.preventDefault()
            document.execCommand('insertText', false, plain)
          } else if (!event.clipboardData.types.includes('text/html') && looksLikeMarkdown(plain)) {
            // Markdown 글(``` 코드, - 목록 …)은 서식으로 바꿔 넣는다
            event.preventDefault()
            document.execCommand('insertHTML', false, plainMemoTextToHtml(plain))
          }
        }}
        onBlur={(event) => {
          // 같은 카드 안(서식 도구·카테고리 고르기 등)으로 옮겨 간 것은 쓰기를 끝낸 게 아니다
          const card = event.currentTarget.closest('.pdf-memo-card, .pdf-memo-list-row, .pdf-box-card')
          if (event.relatedTarget instanceof Node && card?.contains(event.relatedTarget)) return
          // 다른 앱으로 갔다 오는 것(창 전체가 포커스를 잃음)은 쓰기를 끝낸 게 아니다 — 돌아오면 그대로 이어 쓴다
          if (typeof document.hasFocus === 'function' && !document.hasFocus()) return
          finish(!(discardEmptyOnBlur && memoPlainText(event.currentTarget).trim() === ''))
        }}
        onKeyDown={(event: KeyboardEvent<HTMLDivElement>) => {
          event.stopPropagation()
          const element = event.currentTarget
          const handled = (done: boolean) => {
            if (done) {
              event.preventDefault()
              setEmpty(isBlank(element))
            }
            return done
          }
          if (event.key === 'Escape') {
            event.preventDefault()
            finish(false)
          } else if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
            event.preventDefault()
            finish(true)
            onNext?.()
          } else if (event.nativeEvent.isComposing) {
            // 한글을 조합하는 중에는 단축을 쓰지 않는다
          } else if ((event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 'e') {
            event.preventDefault()
            toggleInlineCode(element)
          } else if (event.ctrlKey && event.altKey && /^[0-3]$/u.test(event.key)) {
            const kind = (['p', 'h2', 'h3', 'h4'] as const)[Number(event.key)]!
            event.preventDefault()
            setBlockKind(element, kind === 'p' ? currentBlockKind(element) : kind)
          } else if (event.key === 'Tab' && !event.ctrlKey && !event.altKey) {
            // 표 안이면 다음(앞) 칸으로, 마지막 칸이면 줄을 더한다
            handled(moveTableCell(element, event.shiftKey) || handleMemoTab(element, event.shiftKey))
          } else if (event.key === 'Backspace' && !event.ctrlKey) {
            handled(handleMemoBackspace(element))
          } else if (event.key === ' ' && !event.ctrlKey) {
            handled(applyBlockMarkdown(element, 'space'))
          } else if ((event.key === '`' || event.key === '*' || event.key === '~') && !event.ctrlKey && !event.altKey) {
            handled(applyInlineMarkdown(element, event.key))
          } else if (event.key === 'Enter' && !event.shiftKey && handled(handleMemoEnter(element))) {
            // 코드 블록 안 줄바꿈, 인용·코드 블록 빠져나오기, ``` · --- 바꾸기
          } else if (event.key === 'Enter' && !event.shiftKey && onNext !== undefined && endsWithEmptyLine(event.currentTarget)) {
            // 끝의 빈 줄에서 한 번 더 Enter: 빈 줄을 지우고 이 글은 저장, 아래에 새 글
            event.preventDefault()
            dropTrailingEmptyLine(event.currentTarget)
            finish(true)
            onNext()
          }
        }}
      />
    </div>
  )
}

/**
 * 저장된 메모를 서식 그대로 보인다. 누르면 고치기.
 * onChange 가 있으면 할 일 칸의 네모를 눌러 고치기 없이 바로 체크한다.
 */
export function MemoNoteView({ note, noteHtml, onEdit, onChange }: {
  readonly note: string | undefined
  readonly noteHtml: string | undefined
  readonly onEdit: () => void
  readonly onChange?: (content: MemoContent) => void
}) {
  return (
    <div
      className="pdf-memo-card-text"
      role="button"
      tabIndex={0}
      aria-label={t('메모 고치기')}
      onClick={(event) => {
        const item = onChange === undefined ? null : checkItemAt(event.target, event.clientX)
        if (item === null || onChange === undefined) {
          onEdit()
          return
        }
        event.stopPropagation()
        const nth = checkItemIndex(event.currentTarget, item)
        if ((noteHtml ?? '').trim() === '') {
          // 글만 있는 메모(- [ ] …)는 글을 고친다
          const next = togglePlainCheck(note ?? '', nth)
          if (next !== null) onChange({ text: next, html: '' })
          return
        }
        const copy = document.createElement('div')
        copy.innerHTML = memoDisplayHtml(note, noteHtml)
        const target = copy.querySelectorAll('ul[data-type="check"] > li')[nth]
        if (target instanceof HTMLLIElement) toggleCheckItem(target)
        onChange({ text: note ?? '', html: sanitizeMemoHtml(copy.innerHTML) })
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault()
          onEdit()
        }
      }}
      dangerouslySetInnerHTML={{ __html: memoDisplayHtml(note, noteHtml) }}
    />
  )
}

/** 카드의 카테고리: 누르면 이 PDF 에서 쓰는 카테고리 중에서 고르거나 새로 만든다 */
export function MemoCategoryPicker({ value, categories, onChange }: {
  readonly value: string | undefined
  readonly categories: readonly string[]
  readonly onChange: (topic: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState('')
  const rootRef = useRef<HTMLSpanElement | null>(null)

  useEffect(() => {
    if (!open) return
    const close = (event: PointerEvent) => {
      if (!(event.target instanceof Node) || rootRef.current?.contains(event.target) !== true) setOpen(false)
    }
    document.addEventListener('pointerdown', close, true)
    return () => document.removeEventListener('pointerdown', close, true)
  }, [open])

  const pick = (topic: string) => {
    setOpen(false)
    setDraft('')
    onChange(topic)
  }

  return (
    <span ref={rootRef} className="pdf-memo-category">
      <button
        type="button"
        className={`pdf-memo-topic${value === undefined ? ' pdf-memo-topic-empty' : ''}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={value === undefined ? t('카테고리 정하기') : t('카테고리 {name} 바꾸기', { name: value })}
        onPointerDown={(event) => event.preventDefault()}
        onClick={() => setOpen((current) => !current)}
      >
        {value === undefined ? t('+ 카테고리') : <CategoryTag name={value} />}
      </button>
      {open ? (
        <div className="pdf-memo-category-menu" role="listbox" aria-label={t('이 PDF의 카테고리')}>
          <div className="pdf-memo-category-head">{t('이 PDF의 카테고리')}</div>
          {categories.map((category) => (
            <button
              key={category}
              type="button"
              role="option"
              aria-selected={category === value}
              onPointerDown={(event) => event.preventDefault()}
              onClick={() => pick(category)}
            >
              <span className="pdf-memo-category-check">{category === value ? <Check size={12} weight="bold" aria-hidden="true" /> : null}</span>
              <CategoryTag name={category} />
            </button>
          ))}
          {value === undefined ? null : (
            <button type="button" className="pdf-memo-category-clear" onPointerDown={(event) => event.preventDefault()} onClick={() => pick('')}>
              {t('카테고리 빼기')}
            </button>
          )}
          <input
            aria-label={t('새 카테고리')}
            placeholder={t('새 카테고리 (Enter)')}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              event.stopPropagation()
              if (event.key === 'Enter' && draft.trim() !== '') {
                event.preventDefault()
                pick(draft.trim())
              } else if (event.key === 'Escape') {
                setOpen(false)
              }
            }}
          />
        </div>
      ) : null}
    </span>
  )
}

/**
 * 페이지 오른쪽의 메모 카드 열과, 형광펜에서 카드로 가는 선.
 * 문서 스크롤 상자 안에 절대 위치로 얹혀 페이지와 함께 움직인다.
 */
export function MemoColumn({
  targets,
  columnLeft,
  columnWidth = MEMO_COLUMN_WIDTH,
  pageRight,
  height,
  width,
  editingId,
  activeId,
  categories = [],
  query = '',
  showInnerLink = true,
  pageSizeOf,
  onEdit,
  onActivate,
  onSave,
  onCancelDraft,
  onRecolor,
  onDelete,
  onSetTopic,
  flow = false,
  onCardLayout,
  onJump,
  onToggleCollapse,
  onRate,
  onReorder,
}: {
  readonly targets: readonly MemoTarget[]
  /** 카드 열의 왼쪽(문서 좌표) */
  readonly columnLeft: number
  readonly columnWidth?: number
  /** 페이지 오른쪽 끝(문서 좌표) */
  readonly pageRight: number
  readonly height: number
  readonly width: number
  readonly editingId: string | null
  readonly activeId: string | null
  /** 이 PDF 에서 쓰는 카테고리 */
  readonly categories?: readonly string[]
  /** 노트 검색어: 맞지 않는 카드는 흐리게 */
  readonly query?: string
  /** 형광펜 끝에서 페이지 끝까지의 선도 그릴까(카드가 따로 떨어진 바에 있으면 그 선은 페이지 쪽이 그린다) */
  readonly showInnerLink?: boolean
  /** 영역 메모의 원문을 카드 안에 그릴 때 쓰는 그 쪽의 크기(pt) */
  readonly pageSizeOf?: (highlight: PersistentPdfHighlight) => readonly [number, number] | undefined
  readonly onEdit: (id: string | null) => void
  readonly onActivate: (id: string | null) => void
  readonly onSave: (id: string, content: MemoContent) => void
  /** 새 메모를 Esc 로 그만뒀다 */
  readonly onCancelDraft?: () => void
  readonly onRecolor: (id: string, color: PdfHighlightColor) => void
  readonly onDelete: (id: string) => void
  readonly onSetTopic?: (id: string, topic: string) => void
  /**
   * 목록으로 쌓기: 카드를 문서 순서대로 차례로 놓고(형광펜 높이에 맞추지 않는다) 선은 그리지 않는다.
   * 메모 바가 PDF 와 따로 스크롤할 때 쓴다. 선은 onCardLayout 으로 받은 카드 자리로 바깥에서 그린다
   */
  readonly flow?: boolean
  /** 목록으로 쌓을 때 카드마다의 자리(스크롤 상자 안 좌표) */
  readonly onCardLayout?: (layout: ReadonlyMap<string, { top: number; height: number }>) => void
  /** 카드의 쪽 번호를 누르면 PDF 의 그 자리로 */
  readonly onJump?: (highlight: PersistentPdfHighlight) => void
  /** 카드 접기·펼치기 */
  readonly onToggleCollapse?: (id: string, collapsed: boolean) => void
  /** 별점(1~5, 0 이면 지움) */
  readonly onRate?: (id: string, rating: number) => void
  /** 목록에서 손잡이로 끌어 순서를 바꿨다(바뀐 뒤 카드 id 차례) */
  readonly onReorder?: (ids: readonly string[]) => void
}) {
  const colors = useHighlightColors()
  const cardRefs = useRef(new Map<string, HTMLDivElement>())
  const reportedLayoutRef = useRef('')
  const [heights, setHeights] = useState<ReadonlyMap<string, number>>(new Map())
  const tops = stackMemoCards(targets, heights)
  const needle = query.trim().toLowerCase()

  useLayoutEffect(() => {
    let changed = false
    const next = new Map(heights)
    for (const target of targets) {
      const element = cardRefs.current.get(target.highlight.id)
      if (element === undefined) continue
      const measured = element.offsetHeight
      if (measured > 0 && next.get(target.highlight.id) !== measured) {
        next.set(target.highlight.id, measured)
        changed = true
      }
    }
    if (changed) setHeights(next)
    if (flow && onCardLayout !== undefined) {
      const layout = new Map<string, { top: number; height: number }>()
      for (const [id, element] of cardRefs.current) layout.set(id, { top: element.offsetTop, height: element.offsetHeight })
      const key = [...layout].map(([id, box]) => `${id}:${box.top}:${box.height}`).join('|')
      if (key !== reportedLayoutRef.current) {
        reportedLayoutRef.current = key
        onCardLayout(layout)
      }
    }
  })
  const ordered = flow ? sortMemosForList(targets, (target) => target.highlight, (target) => target.top) : targets
  // 손잡이로 끄는 중인 카드와, 놓으면 들어갈 자리(그 앞에 끼운다. 끝이면 ordered.length)
  const [dragging, setDragging] = useState<{ id: string; drop: number } | null>(null)
  const dropIndexAt = (clientY: number) => {
    const index = ordered.findIndex((target) => {
      const rect = cardRefs.current.get(target.highlight.id)?.getBoundingClientRect()
      return rect !== undefined && clientY < rect.top + rect.height / 2
    })
    return index < 0 ? ordered.length : index
  }
  const startReorder = (event: ReactPointerEvent<HTMLElement>, id: string) => {
    if (event.button !== 0 || onReorder === undefined) return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    setDragging({ id, drop: dropIndexAt(event.clientY) })
  }
  const moveReorder = (event: ReactPointerEvent<HTMLElement>) => {
    if (dragging === null) return
    const drop = dropIndexAt(event.clientY)
    if (drop !== dragging.drop) setDragging({ ...dragging, drop })
    // 끄는 동안 목록 끝에 닿으면 굴린다
    const scroller = event.currentTarget.closest('.pdf-memo-bar-scroll')
    if (scroller !== null) {
      const rect = scroller.getBoundingClientRect()
      if (event.clientY < rect.top + 30) scroller.scrollTop -= 12
      else if (event.clientY > rect.bottom - 30) scroller.scrollTop += 12
    }
  }
  const endReorder = () => {
    if (dragging === null) return
    const ids = ordered.map((target) => target.highlight.id)
    const from = ids.indexOf(dragging.id)
    setDragging(null)
    if (from < 0) return
    const to = dragging.drop > from ? dragging.drop - 1 : dragging.drop
    if (to === from) return
    ids.splice(from, 1)
    ids.splice(to, 0, dragging.id)
    onReorder?.(ids)
  }

  return (
    <>
      {flow ? null : <svg className="pdf-memo-links" width={width} height={height} aria-hidden="true">
        {/* 가리키는 메모의 선은 다른 선에 묻히지 않게 맨 나중(위)에 그린다 */}
        {[...targets].sort((a, b) => Number(a.highlight.id === activeId || a.highlight.id === editingId) - Number(b.highlight.id === activeId || b.highlight.id === editingId)).map((target) => {
          const top = tops.get(target.highlight.id)
          if (top === undefined) return null
          const cardY = top + 16
          const bend = pageRight + (columnLeft - pageRight) / 2
          const active = target.highlight.id === activeId || target.highlight.id === editingId || target.draft === true
          return (
            <g key={target.highlight.id} data-hl={target.highlight.color} className={`pdf-memo-link${active ? ' pdf-memo-link-active' : ''}`}>
              {/* 페이지 안쪽(형광펜 끝 → 페이지 가장자리)은 카드를 가리킬 때만 그린다. 늘 그리면 본문 글자를 가로지른다 */}
              {active && showInnerLink ? <path className="pdf-memo-link-inner" d={`M ${target.anchorX} ${target.anchorY} H ${pageRight}`} /> : null}
              {active && showInnerLink ? <circle cx={target.anchorX} cy={target.anchorY} r={2.5} /> : null}
              <path d={`M ${pageRight} ${target.anchorY} C ${bend} ${target.anchorY}, ${bend} ${cardY}, ${columnLeft} ${cardY}`} />
              {showInnerLink ? <circle className="pdf-memo-link-edge" cx={pageRight} cy={target.anchorY} r={2} /> : null}
            </g>
          )
        })}
      </svg>}
      {ordered.map((target, orderIndex) => {
        const { highlight } = target
        const top = tops.get(highlight.id)
        if (top === undefined) return null
        const draft = target.draft === true
        const editing = draft || highlight.id === editingId
        const active = highlight.id === activeId || editing
        const collapsed = highlight.collapsed === true && !editing
        const matches = needle === ''
          || (highlight.note ?? '').toLowerCase().includes(needle)
          || highlight.anchor.quote.toLowerCase().includes(needle)
          || (highlight.topic ?? '').toLowerCase().includes(needle)
        return (
          <div
            key={highlight.id}
            ref={(element) => {
              if (element === null) cardRefs.current.delete(highlight.id)
              else cardRefs.current.set(highlight.id, element)
            }}
            className={[
              'pdf-memo-card',
              active ? 'pdf-memo-card-active' : '',
              editing ? 'pdf-memo-card-editing' : '',
              draft ? 'pdf-memo-card-draft' : '',
              matches ? '' : 'pdf-memo-card-dim',
              flow ? 'pdf-memo-card-flow' : '',
              collapsed ? 'pdf-memo-card-collapsed' : '',
              dragging?.id === highlight.id ? 'pdf-memo-card-dragging' : '',
              dragging !== null && dragging.id !== highlight.id && dragging.drop === orderIndex ? 'pdf-memo-card-drop-before' : '',
              dragging !== null && dragging.id !== highlight.id && dragging.drop === ordered.length && orderIndex === ordered.length - 1 ? 'pdf-memo-card-drop-after' : '',
            ].filter(Boolean).join(' ')}
            style={flow ? undefined : { top: `${top}px`, left: `${columnLeft}px`, width: `${columnWidth}px` }}
            data-memo-id={highlight.id}
            data-hl={highlight.color}
            onPointerEnter={() => onActivate(highlight.id)}
            onPointerLeave={() => onActivate(null)}
          >
            <div className="pdf-memo-card-head">
              {flow && onReorder !== undefined && !draft ? (
                <span
                  className="pdf-memo-grip"
                  role="button"
                  tabIndex={-1}
                  aria-label={t('끌어서 순서 바꾸기')}
                  title={t('끌어서 순서 바꾸기')}
                  onPointerDown={(event) => startReorder(event, highlight.id)}
                  onPointerMove={moveReorder}
                  onPointerUp={endReorder}
                  onPointerCancel={() => setDragging(null)}
                >
                  <DotsSixVertical size={14} weight="bold" aria-hidden="true" />
                </span>
              ) : null}
              {onToggleCollapse !== undefined && !draft ? (
                <button
                  type="button"
                  className="pdf-memo-collapse"
                  aria-label={collapsed ? t('원문 펼치기') : t('원문 접기')}
                  aria-expanded={!collapsed}
                  title={collapsed ? t('원문 펼치기') : t('원문 접기')}
                  onPointerDown={(event) => event.preventDefault()}
                  onClick={() => onToggleCollapse(highlight.id, !collapsed)}
                >
                  {collapsed ? <CaretRight size={12} weight="bold" aria-hidden="true" /> : <CaretDown size={12} weight="bold" aria-hidden="true" />}
                </button>
              ) : null}
              <span className="pdf-memo-dot" data-hl={highlight.color} aria-hidden="true" />
              {onJump !== undefined && !draft ? (
                <button type="button" className="pdf-memo-card-page pdf-memo-card-jump" title={t('PDF 의 이 자리로')} onClick={() => onJump(highlight)}>
                  p.{highlight.anchor.page + 1}{highlight.kind === 'region' ? ` · ${t('표/그림')}` : ''}
                </button>
              ) : (
                <span className="pdf-memo-card-page">p.{highlight.anchor.page + 1}{draft ? <em> · {t('새 메모')}</em> : null}{highlight.kind === 'region' ? ` · ${t('표/그림')}` : ''}</span>
              )}
              <MemoCategoryPicker
                value={highlight.topic}
                categories={categories}
                onChange={(topic) => {
                  onSetTopic?.(highlight.id, topic)
                  // 쓰던 중이었으면 다시 글쓰기로 돌아간다(새 메모가 빈 채로 사라지지 않게)
                  if (editing) {
                    window.requestAnimationFrame(() => {
                      cardRefs.current.get(highlight.id)?.querySelector('textarea')?.focus()
                    })
                  }
                }}
              />
              {onRate !== undefined && !draft ? (
                <span className={`pdf-memo-stars${highlight.rating === undefined ? ' pdf-memo-stars-empty' : ''}`} role="radiogroup" aria-label={t('별점')}>
                  {[1, 2, 3, 4, 5].map((value) => (
                    <button
                      key={value}
                      type="button"
                      role="radio"
                      aria-checked={highlight.rating === value}
                      aria-label={t('별 {count}개', { count: value })}
                      className={`pdf-memo-star${(highlight.rating ?? 0) >= value ? ' pdf-memo-star-on' : ''}`}
                      onPointerDown={(event) => event.preventDefault()}
                      onClick={() => onRate(highlight.id, highlight.rating === value ? 0 : value)}
                    >
                      <Star size={12} weight={(highlight.rating ?? 0) >= value ? 'fill' : 'regular'} aria-hidden="true" />
                    </button>
                  ))}
                </span>
              ) : null}
              <span className="pdf-memo-card-actions">
                {colors.map(({ id: color }) => (
                  <button
                    key={color}
                    type="button"
                    data-hl={color}
                    className="pdf-memo-swatch"
                    aria-label={t('{color}으로 바꾸기', { color: highlightColorLabel(colors, color) })}
                    aria-pressed={highlight.color === color}
                    onPointerDown={(event) => event.preventDefault()}
                    onClick={() => onRecolor(highlight.id, color)}
                  />
                ))}
                {draft ? null : (
                  <button
                    type="button"
                    className="pdf-memo-delete"
                    aria-label={t('형광펜과 메모 지우기')}
                    onPointerDown={(event) => event.preventDefault()}
                    onClick={() => onDelete(highlight.id)}
                  >
                    <Trash size={13} aria-hidden="true" />
                  </button>
                )}
              </span>
            </div>
            {collapsed ? null : (() => {
              // 카드 안에 고른 원문: 표·그림은 카드 폭에 맞춘 그림, 글은 칠한 글자 그대로
              const pageSize = highlight.kind === 'region' ? pageSizeOf?.(highlight) ?? highlight.pageSize : undefined
              if (highlight.kind === 'region' && pageSize !== undefined) {
                return <div className="pdf-memo-card-source"><RegionCrop highlight={highlight} pageSize={pageSize} maxWidth={columnWidth - 24} /></div>
              }
              const quote = highlight.anchor.quote.replace(/\s+/gu, ' ').trim()
              return quote === '' ? null : <div className="pdf-memo-card-quote" data-hl={highlight.color}>{quote}</div>
            })()}
            {editing ? (
              <MemoEditor
                key={highlight.id}
                initialText={highlight.note ?? ''}
                initialHtml={highlight.noteHtml}
                placeholder={draft ? t('메모를 쓰세요 (안 쓰고 다른 곳을 누르면 사라집니다)') : t('메모를 쓰세요')}
                onSave={(content) => {
                  onSave(highlight.id, content)
                  onEdit(null)
                }}
                onCancel={() => {
                  if (draft) onCancelDraft?.()
                  onEdit(null)
                }}
              />
            ) : (
              <MemoNoteView note={highlight.note} noteHtml={highlight.noteHtml} onEdit={() => onEdit(highlight.id)} onChange={(content) => onSave(highlight.id, content)} />
            )}
          </div>
        )
      })}
    </>
  )
}
