import { createContext, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { Table } from '@phosphor-icons/react'
import { createPortal } from 'react-dom'
import { restoreInlineStyles } from '../app/runtimeStyle'
import { useHasTopBarSlot } from '../app/topBarToolbar'
import { hasMemoFormatting, memoDisplayHtml, plainMemoTextToHtml, sanitizeMemoHtml, togglePlainCheck } from './memoRichText'
import { addTableColumn, addTableRow, deleteTableColumn, deleteTableRow, insertTable, moveTableCell, tableCellAt } from './memoTableEditing'
import {
  applyBlockMarkdown, applyInlineMarkdown, checkItemAt, checkItemIndex, currentBlockKind, handleMemoBackspace, handleMemoEnter, handleMemoTab,
  insideCodeBlock, looksLikeMarkdown, memoPlainText, setBlockKind, toggleCheckItem, toggleChecklist, toggleInlineCode, type MemoBlockKind,
} from './memoEditing'
import { t } from '../i18n'
import { imeKey } from '../ui/ime'
import { FormatBar, FormatMenuButton, type FormatSwatch } from '../ui/format/FormatBar'

/** 메모 내용: 글(검색·MCP 용)과 서식 HTML(꾸밈이 없으면 빈 문자열) */
export interface MemoContent {
  readonly text: string
  readonly html: string
}

/** 노트 메모의 글자색 · 글자 배경색(execCommand 가 style 로 남긴다) */
const TEXT_COLORS: readonly FormatSwatch[] = [
  { name: '검정', value: '#1f2328' }, { name: '빨강', value: '#cf222e' }, { name: '주황', value: '#bc4c00' },
  { name: '초록', value: '#1a7f37' }, { name: '파랑', value: '#0969da' }, { name: '보라', value: '#8250df' },
]
const BACK_COLORS: readonly FormatSwatch[] = [
  { name: '노랑', value: '#fff1a8' }, { name: '초록', value: '#d3f5dc' }, { name: '파랑', value: '#dbeafe' },
  { name: '분홍', value: '#fde2ef' }, { name: '없음', value: 'transparent' },
]

function run(command: string, value?: string) {
  // 글자색·배경색은 <font> 대신 style 로 남긴다(저장할 때 걸러 내기 쉽게)
  document.execCommand('styleWithCSS', false, 'true')
  document.execCommand(command, false, value)
}

/** execCommand 상태(굵게 · 목록 …). 고른 글이 없거나 브라우저가 모르면 false */
function commandState(command: string): boolean {
  try {
    return typeof document.queryCommandState === 'function' && document.queryCommandState(command)
  } catch {
    return false
  }
}

/** 지금 쓰고 있는 글쓰기 칸(서식 도구는 칸 밖, 노트 바 맨 위에 있을 수 있다) */
function activeMemoEditor(): HTMLElement | null {
  const node = window.getSelection()?.anchorNode ?? null
  const element = node instanceof Element ? node : node?.parentElement ?? null
  const editor = element?.closest('.pdf-memo-editor')
  return editor instanceof HTMLElement ? editor : null
}

/** 커서가 editor 안에서 selector 에 드는 요소 안에 있는가(인라인 코드 · 할 일 목록의 눌림 표시) */
function caretInside(editor: HTMLElement, selector: string): boolean {
  const node = window.getSelection()?.anchorNode ?? null
  const element = node instanceof Element ? node : node?.parentElement ?? null
  const hit = element?.closest(selector)
  return hit != null && editor.contains(hit)
}

/** 문단 모양 고르개: 값, 이름, 단축 안내(Markdown 처럼 쓰는 법). 「구분선」은 모양이 아니라 한 번 넣는 것 */
const BLOCK_KINDS: readonly (readonly [MemoBlockKind | 'hr', string, string])[] = [
  ['p', '본문', 'Ctrl+Alt+0'],
  ['h2', '제목 1', '# 띄어쓰기'],
  ['h3', '제목 2', '## 띄어쓰기'],
  ['h4', '제목 3', '### 띄어쓰기'],
  ['blockquote', '인용', '> 띄어쓰기'],
  ['pre', '코드 블록', '``` Enter'],
  ['hr', '구분선', '--- Enter'],
]

/** 노트 서식 줄의 눌림 상태: 커서를 옮길 때마다 다시 본다 */
interface MemoFormatState {
  readonly block: MemoBlockKind
  readonly inTable: boolean
  readonly bold: boolean
  readonly italic: boolean
  readonly underline: boolean
  readonly strike: boolean
  readonly code: boolean
  readonly bullet: boolean
  readonly number: boolean
  readonly check: boolean
}
const IDLE_STATE: MemoFormatState = { block: 'p', inTable: false, bold: false, italic: false, underline: false, strike: false, code: false, bullet: false, number: false, check: false }

function readMemoFormatState(editor: HTMLElement): MemoFormatState {
  return {
    block: currentBlockKind(editor),
    inTable: tableCellAt(editor) !== null,
    bold: commandState('bold'),
    italic: commandState('italic'),
    underline: commandState('underline'),
    strike: commandState('strikeThrough'),
    code: caretInside(editor, 'code'),
    bullet: commandState('insertUnorderedList') && !caretInside(editor, 'ul[data-type="check"]'),
    number: commandState('insertOrderedList'),
    check: caretInside(editor, 'ul[data-type="check"]'),
  }
}

/**
 * 서식 도구를 붙일 자리. 노트 바는 맨 위에 한 줄(늘 같은 자리)을 두고, 쓰는 중인 칸의 서식 단추를 그리로 보낸다.
 * 없으면(메모만 보기 등) 지금처럼 칸마다 위에 붙는다.
 */
export const MemoFormatSlotContext = createContext<HTMLElement | null>(null)

/**
 * 노트 메모의 서식 줄: 공용 서식 줄(FormatBar)에 문단 모양 · 글자 모양 · 목록(+ 표) · 색 · 서식 지우기를 넘긴다(정렬 · 글자 크기는 없다).
 * 명령은 지금 쓰는 칸(.pdf-memo-editor)에 execCommand 로 건다. disabled 면 쓰는 칸이 없을 때 맨 위 자리에 보이는 꺼진 도구.
 */
export function MemoFormatBar({ onCommand, disabled = false }: { readonly onCommand: () => void; readonly disabled?: boolean }) {
  const [state, setState] = useState<MemoFormatState>(IDLE_STATE)
  // 커서를 옮길 때마다 지금 문단 모양 · 눌린 서식을 보인다
  const refresh = () => {
    const editor = activeMemoEditor()
    if (editor !== null) setState(readMemoFormatState(editor))
  }
  useEffect(() => {
    if (disabled) return
    refresh()
    document.addEventListener('selectionchange', refresh)
    return () => document.removeEventListener('selectionchange', refresh)
    // refresh 는 지금 고른 글만 읽는다(바뀌는 값을 품지 않는다)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [disabled])
  const withEditor = (action: (editor: HTMLElement) => void) => () => {
    const editor = activeMemoEditor()
    if (editor !== null) action(editor)
  }
  const after = () => {
    refresh()
    onCommand()
  }
  const blockOptions = BLOCK_KINDS.map(([kind, name, hint]) => ({ value: kind, label: t(name), hint: t(hint), className: `format-bar-block-${kind}` }))
  const tableItems = ([
    ['insert', '표 넣기 (3×3)', '| 칸 | 칸 | 붙여 넣기도 됨', (editor: HTMLElement) => insertTable(editor, 3, 3), false],
    ['row', '줄 더하기', '마지막 칸에서 Tab', (editor: HTMLElement) => { addTableRow(editor) }, true],
    ['column', '칸 더하기', '', (editor: HTMLElement) => { addTableColumn(editor) }, true],
    ['delete-row', '줄 빼기', '', (editor: HTMLElement) => { deleteTableRow(editor) }, true],
    ['delete-column', '칸 빼기', '', (editor: HTMLElement) => { deleteTableColumn(editor) }, true],
  ] as const).map(([key, name, hint, action, needsTable]) => ({
    key,
    label: t(name),
    hint: hint === '' ? undefined : t(hint),
    disabled: needsTable && !state.inTable,
    onSelect: withEditor(action),
  }))
  return (
    <FormatBar
      label={t('메모 서식')}
      className="memo-format-bar"
      disabled={disabled}
      onCommand={after}
      block={{
        value: disabled ? 'p' : state.block,
        options: blockOptions,
        onChange: (value) => {
          if (value === 'hr') {
            run('insertHorizontalRule')
            return
          }
          // 「본문」은 지금 모양을 한 번 더 고른 것과 같다(되돌리기)
          withEditor((editor) => setBlockKind(editor, value === 'p' ? currentBlockKind(editor) : value as MemoBlockKind))()
        },
      }}
      marks={{
        bold: { active: state.bold, onToggle: () => run('bold') },
        italic: { active: state.italic, onToggle: () => run('italic') },
        underline: { active: state.underline, onToggle: () => run('underline') },
        strike: { active: state.strike, onToggle: () => run('strikeThrough') },
        code: { active: state.code, onToggle: withEditor(toggleInlineCode) },
      }}
      lists={{
        bullet: { active: state.bullet, onToggle: () => run('insertUnorderedList') },
        number: { active: state.number, onToggle: () => run('insertOrderedList') },
        check: { active: state.check, onToggle: withEditor(toggleChecklist) },
      }}
      slots={{ lists: <FormatMenuButton label={t('표')} icon={<Table size={16} aria-hidden="true" />} items={tableItems} disabled={disabled} onCommand={after} /> }}
      textColor={{ colors: TEXT_COLORS, onChange: (color) => run('foreColor', color) }}
      highlight={{ colors: BACK_COLORS, onChange: (color) => run('hiliteColor', color) }}
      clear={() => run('removeFormat')}
      shortcuts={{
        bold: t('Ctrl+B, **글**'),
        italic: t('Ctrl+I, *글*'),
        underline: 'Ctrl+U',
        strike: t('~~글~~'),
        code: t('Ctrl+E, `글`'),
        bullet: t('- 띄어쓰기'),
        number: t('1. 띄어쓰기'),
        check: t('[ ] 띄어쓰기'),
      }}
    />
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
  const hasTopBarSlot = useHasTopBarSlot()

  useLayoutEffect(() => {
    const element = ref.current
    if (element === null) return
    element.innerHTML = memoDisplayHtml(initialText, initialHtml)
    restoreInlineStyles(element)
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
        // 서식 줄은 상단바 도구줄(노트 칸이 만지는 칸일 때만 있는 자리)에 포털로만 그린다. 그 칸을 만지지 않아 자리가 없을 때 카드 안으로 뛰어들면 글이 밀린다 — 상단바가 있는 앱에서는 아무것도 그리지 않는다(칸 안에 두는 것은 상단바가 없는 시험 · 단독일 때뿐)
        if (formatSlot !== null) return createPortal(bar, formatSlot)
        return hasTopBarSlot ? null : bar
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
          } else if (imeKey(event)) {
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
  const viewRef = useRef<HTMLDivElement>(null)
  const displayHtml = useMemo(() => memoDisplayHtml(note, noteHtml), [note, noteHtml])
  // 저장된 서식(글자색 등)의 style="" 는 제품 빌드 CSP 가 막으므로 CSSOM 으로 다시 입힌다
  useLayoutEffect(() => {
    if (viewRef.current !== null) restoreInlineStyles(viewRef.current)
  }, [displayHtml])
  return (
    <div
      ref={viewRef}
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
      dangerouslySetInnerHTML={{ __html: displayHtml }}
    />
  )
}
