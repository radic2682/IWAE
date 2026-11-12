import { createContext, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type Dispatch, type KeyboardEvent, type ReactNode, type RefObject, type SetStateAction } from 'react'
import { CaretDown, Code, DotsThree, HighlighterCircle, ListBullets, ListChecks, ListNumbers, Table, TextAa, TextB, TextItalic, TextStrikethrough, TextTSlash, TextUnderline } from '@phosphor-icons/react'
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
  const barRef = useRef<HTMLDivElement | null>(null)
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
  const clusters: ReactNode[] = [
      <span key="block" className="pdf-memo-format-cluster" data-cluster="0">
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
      </span>,
      <span key="text" className="pdf-memo-format-cluster" data-cluster="1">
      {button(t('굵게 (Ctrl+B · **글**)'), <TextB size={15} weight="bold" aria-hidden="true" />, () => run('bold'))}
      {button(t('기울임 (Ctrl+I · *글*)'), <TextItalic size={15} aria-hidden="true" />, () => run('italic'))}
      {button(t('밑줄 (Ctrl+U)'), <TextUnderline size={15} aria-hidden="true" />, () => run('underline'))}
      {button(t('취소선 (~~글~~)'), <TextStrikethrough size={15} aria-hidden="true" />, () => run('strikeThrough'))}
      {button(t('코드 (Ctrl+E · `글`)'), <Code size={15} weight="bold" aria-hidden="true" />, withEditor(toggleInlineCode))}
      </span>,
      <span key="color" className="pdf-memo-format-cluster" data-cluster="2">
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
      </span>,
      <span key="list" className="pdf-memo-format-cluster" data-cluster="3">
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
      </span>,
  ]
  const [visible, moreOpen, setMoreOpen] = useFormatOverflow(barRef, clusters.length)
  return (
    <div ref={barRef} className={`pdf-memo-format-bar${disabled ? ' pdf-memo-format-bar-idle' : ''}`} role="toolbar" aria-label={t('메모 서식')} aria-disabled={disabled || undefined}>
      {clusters.slice(0, visible)}
      {visible < clusters.length ? (
        <button
          type="button"
          className="pdf-memo-format-button pdf-memo-format-more"
          aria-label={t('서식 더 보기')}
          title={t('서식 더 보기')}
          aria-haspopup="true"
          aria-expanded={moreOpen}
          onPointerDown={(event) => event.preventDefault()}
          onClick={() => setMoreOpen((open) => !open)}
        >
          <DotsThree size={16} weight="bold" aria-hidden="true" />
        </button>
      ) : null}
      {moreOpen && visible < clusters.length ? <div className="pdf-memo-format-overflow" role="group" aria-label={t('서식 더 보기')}>{clusters.slice(visible)}</div> : null}
    </div>
  )
}

/**
 * 노트 도구줄(.note-format-dock) 안의 서식 줄은 늘 한 줄이다: 폭이 모자라면 뒤쪽 묶음(목록 → 색 → 글자 모양 순)부터 「⋯」 메뉴로 옮긴다.
 * 첫 묶음(문단 모양)과 「⋯」 은 늘 줄에 있다. 묶음 폭은 줄에 있을 때 재어 두고(처음엔 모두 줄에 그린다) 그 폭으로 몇 개가 들어가는지 정한다.
 * 도구줄 밖(박스 메모 등)의 서식 줄은 건드리지 않는다.
 */
function useFormatOverflow(barRef: RefObject<HTMLDivElement | null>, total: number): [number, boolean, Dispatch<SetStateAction<boolean>>] {
  const [visible, setVisible] = useState(total)
  const [moreOpen, setMoreOpen] = useState(false)
  const widths = useRef<number[]>([])
  const [tick, setTick] = useState(0)
  // 다시 재야 할 때만 tick 을 올린다: 줄 · 도구줄 · 곁의 묶음 · 서식 묶음의 크기가 바뀌었을 때, 도구줄에 묶음이 생기거나 사라졌을 때(검색이 펼쳐지고 노트 단추가 나타날 때)
  useLayoutEffect(() => {
    const bar = barRef.current
    if (bar === null) return undefined
    const dock = bar.closest('.note-format-dock')
    const bump = () => setTick((value) => value + 1)
    const resize = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(bump)
    // 서식 줄은 내용 폭만큼만 차지하므로(옆의 검색 · 글 블록 · 펼치기 단추가 바로 이어 붙는다) 줄 폭이 아니라 도구줄의 폭 변화를 봐야 다시 넓어졌을 때 알아챈다.
    // 곁의 묶음(검색 · 글 블록 · 펼치기)도 본다: 그 묶음의 폭이 줄거나 늘어도 도구줄 폭은 그대로라서 도구줄만 보면 다시 재지 못한다.
    // 곁의 묶음은 처음 한 번만 보면 모자란다 — 나중에 생긴 묶음은 새로 보고(observeAll), 서식 묶음(.pdf-memo-format-bar 의 data-cluster)의 폭 변화도 본다
    const observeAll = () => {
      if (resize === null) return
      resize.disconnect()
      resize.observe(bar)
      if (dock !== null) {
        resize.observe(dock)
        for (const child of Array.from(dock.children)) if (!child.contains(bar)) resize.observe(child)
      }
      for (const cluster of Array.from(bar.querySelectorAll(':scope > [data-cluster]'))) resize.observe(cluster)
    }
    observeAll()
    const mutation = typeof MutationObserver === 'undefined' ? null : new MutationObserver(() => { observeAll(); bump() })
    if (dock !== null) mutation?.observe(dock, { childList: true })
    mutation?.observe(bar, { childList: true })
    return () => { resize?.disconnect(); mutation?.disconnect() }
  }, [barRef])
  // 재는 것은 필요할 때만: 크기 · 구성이 바뀌어 tick 이 오르거나, 보이는 묶음 수 · 전체 수가 바뀔 때(렌더마다 재지 않는다)
  useLayoutEffect(() => {
    const bar = barRef.current
    if (bar === null || bar.closest('.note-format-dock') === null) return
    for (const element of Array.from(bar.querySelectorAll<HTMLElement>(':scope > [data-cluster]'))) {
      // 소수 배율에서도 어긋나지 않게 반올림된 offsetWidth 가 아니라 실제 폭으로 잰다
      widths.current[Number(element.dataset.cluster)] = element.getBoundingClientRect().width
    }
    const capacity = formatCapacity(bar)
    const known = widths.current
    if (capacity <= 0 || known.length < total || known.some((width) => !(width > 0))) return
    const next = fitFormatClusters(known, capacity, FORMAT_MORE_W)
    if (next !== visible) setVisible(next)
  }, [barRef, tick, visible, total])
  useEffect(() => {
    if (!moreOpen) return undefined
    const close = (event: Event) => {
      if (event instanceof KeyboardEvent ? event.key === 'Escape' : !(event.target instanceof Node && barRef.current?.contains(event.target))) setMoreOpen(false)
    }
    window.addEventListener('pointerdown', close, true)
    window.addEventListener('keydown', close)
    return () => {
      window.removeEventListener('pointerdown', close, true)
      window.removeEventListener('keydown', close)
    }
  }, [moreOpen, barRef])
  return [visible, moreOpen, setMoreOpen]
}

/**
 * 서식 줄이 쓸 수 있는 폭(px). 줄은 내용 폭만큼만 차지해서(남는 자리는 도구줄 맨 뒤에 있다) 줄 자신의 폭은 쓸 수 있는 폭이 아니다 —
 * 도구줄 안쪽 폭에서 줄 곁의 다른 것들(검색 · 글 블록 · 펼치기 묶음과 그 여백)을 빼고, 줄의 음수 왼쪽 여백(-11px)을 돌려 더한다.
 * 도구줄 밖(박스 메모 등)의 서식 줄은 줄 폭 그대로다.
 * 폭은 모두 `getBoundingClientRect()` 의 실제(소수) 폭이고 1px 여유를 둔다 — 소수 배율에서 반올림한 폭을 더하면 마지막 묶음이 둘째 줄로 밀려 잘렸다.
 */
export function formatCapacity(bar: HTMLElement): number {
  const dock = bar.closest<HTMLElement>('.note-format-dock')
  if (dock === null) return bar.getBoundingClientRect().width
  const style = getComputedStyle(dock)
  const number = (value: string) => Number.parseFloat(value) || 0
  let beside = 0
  for (const child of Array.from(dock.children)) {
    if (!(child instanceof HTMLElement) || child === bar || child.contains(bar)) continue
    const own = getComputedStyle(child)
    beside += child.getBoundingClientRect().width + number(own.marginLeft) + number(own.marginRight)
  }
  const inner = dock.getBoundingClientRect().width - number(style.paddingLeft) - number(style.paddingRight)
  return inner - beside - number(getComputedStyle(bar).marginLeft) - FORMAT_SLACK_PX
}

/** 서식 줄 용량에서 덜어 두는 여유(px): 소수 폭 · 서브픽셀 어림이 쌓여 한 줄에 안 들어가는 일이 없게 */
const FORMAT_SLACK_PX = 1

/** 「⋯」 단추가 차지하는 폭(px): 28px + 앞 여백 6px */
const FORMAT_MORE_W = 34

/** 묶음 폭들(앞에서부터)이 capacity 안에 몇 개 들어가는가. 다 안 들어가면 「⋯」 자리(moreWidth)를 남기고, 첫 묶음은 늘 남긴다 */
export function fitFormatClusters(widths: readonly number[], capacity: number, moreWidth: number): number {
  const all = widths.reduce((sum, width) => sum + width, 0)
  if (all <= capacity) return widths.length
  let used = moreWidth
  let count = 0
  for (const width of widths) {
    if (used + width > capacity) break
    used += width
    count += 1
  }
  return Math.max(count, 1)
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
