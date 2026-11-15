/**
 * 메모 글쓰기 칸(contenteditable)의 서식 다루기: 문단 모양(제목·인용·코드 블록), `코드`, 할 일 목록, 그리고
 * Markdown 처럼 쓰면 바로 바뀌는 단축(# 제목, - 목록, 1. 번호, > 인용, [ ] 할 일, ``` 코드 블록, --- 구분선, `코드`, **굵게** …).
 */

/** 문단 모양. p 는 보통 글 */
export type MemoBlockKind = 'p' | 'h2' | 'h3' | 'h4' | 'blockquote' | 'pre'

const LINE_BLOCK = /^(DIV|P|LI|H2|H3|H4|BLOCKQUOTE|PRE|TD|TH)$/u
/** 이 요소를 만나면 그 뒤에서 새 줄이 시작된다 */
const LINE_BREAKER = /^(BR|DIV|P|UL|OL|PRE|BLOCKQUOTE|H2|H3|H4|HR|TABLE|TD|TH|TR)$/u
const SPECIAL_BLOCK = /^(H2|H3|H4|BLOCKQUOTE|PRE)$/u
const ZERO_WIDTH = '​'

function exec(command: string, value?: string) {
  document.execCommand('styleWithCSS', false, 'true')
  return document.execCommand(command, false, value)
}

/** 글쓰기 칸 안의 커서(선택) */
export function editorRange(editor: HTMLElement): Range | null {
  const selection = window.getSelection()
  if (selection === null || selection.rangeCount === 0) return null
  const range = selection.getRangeAt(0)
  return editor.contains(range.startContainer) ? range : null
}

function placeCaret(node: Node, offset: number) {
  const range = document.createRange()
  range.setStart(node, offset)
  range.collapse(true)
  const selection = window.getSelection()
  selection?.removeAllRanges()
  selection?.addRange(range)
}

function closestIn(node: Node | null, editor: HTMLElement, test: (element: HTMLElement) => boolean): HTMLElement | null {
  let current: Node | null = node
  while (current !== null && current !== editor) {
    if (current instanceof HTMLElement && test(current)) return current
    current = current.parentNode
  }
  return null
}

/** 지금 커서가 있는 문단의 모양 */
export function currentBlockKind(editor: HTMLElement): MemoBlockKind {
  const range = editorRange(editor)
  if (range === null) return 'p'
  const block = closestIn(range.startContainer, editor, (element) => SPECIAL_BLOCK.test(element.tagName))
  return block === null ? 'p' : block.tagName.toLowerCase() as MemoBlockKind
}

/** 문단 모양을 바꾼다. 이미 그 모양이면 보통 글로 되돌린다 */
export function setBlockKind(editor: HTMLElement, kind: MemoBlockKind) {
  const target = currentBlockKind(editor) === kind ? 'p' : kind
  const range = editorRange(editor)
  const item = range === null ? null : closestIn(range.startContainer, editor, (element) => element.tagName === 'LI')
  if (item !== null) {
    // 목록 칸은 이미 보통 글이다
    if (target === 'p') return
    // 목록 칸에 그대로 걸면 목록 전체가 제목·인용·코드 블록으로 감싸여 되돌릴 수 없다. 먼저 그 칸(들)을 목록에서 뺀다
    const endItem = closestIn(range!.endContainer, editor, (element) => element.tagName === 'LI')
    if (endItem !== null) exec(item.parentElement?.tagName === 'OL' ? 'insertOrderedList' : 'insertUnorderedList')
  }
  exec('formatBlock', target === 'p' ? 'div' : target)
}

/** 커서가 있는 줄의 처음부터 커서까지(줄은 문단 요소나 <br> 로 나뉜다) */
export function lineBeforeCaret(editor: HTMLElement, caret: Range): Range {
  const block = closestIn(caret.startContainer, editor, (element) => LINE_BLOCK.test(element.tagName)) ?? editor
  const range = document.createRange()
  const boundary = lineBreakBefore(block, caret.startContainer, caret.startOffset)
  if (boundary === null) range.setStart(block, 0)
  else range.setStartAfter(boundary)
  range.setEnd(caret.startContainer, caret.startOffset)
  return range
}

/**
 * 커서 바로 앞의 줄바꿈(<br> 이나 앞 문단 요소). 커서에서 거꾸로 걸어 처음 만나는 것에서 멈추므로 글이 길어도 이 줄만 본다.
 * block 안에 없으면 null(block 맨 앞이 줄의 처음)
 */
function lineBreakBefore(block: Node, container: Node, offset: number): Element | null {
  let parent: Node = container.nodeType === Node.TEXT_NODE ? container.parentNode! : container
  let node: Node | null = container.nodeType === Node.TEXT_NODE ? container.previousSibling : offset > 0 ? container.childNodes[offset - 1] ?? null : null
  for (;;) {
    while (node === null) {
      if (parent === block || parent.parentNode === null) return null
      node = parent.previousSibling
      parent = parent.parentNode
    }
    if (node instanceof Element) {
      if (LINE_BREAKER.test(node.tagName)) return node
      if (node.lastChild !== null) {
        parent = node
        node = node.lastChild
        continue
      }
    }
    node = node.previousSibling
  }
}

/** 커서 앞 글자를 지운다(되돌리기가 되게 execCommand 로) */
function deleteRange(range: Range) {
  if (range.collapsed) return
  const selection = window.getSelection()
  selection?.removeAllRanges()
  selection?.addRange(range)
  exec('delete')
}

function markChecklist(list: HTMLElement) {
  list.setAttribute('data-type', 'check')
  for (const item of list.children) if (item.tagName === 'LI' && !item.hasAttribute('data-checked')) item.setAttribute('data-checked', 'false')
}

/** 할 일 목록을 켜고 끈다 */
export function toggleChecklist(editor: HTMLElement) {
  const range = editorRange(editor)
  if (range === null) return
  const list = closestIn(range.startContainer, editor, (element) => element.tagName === 'UL' || element.tagName === 'OL')
  if (list?.getAttribute('data-type') === 'check') {
    // 지금 칸(들)만 목록에서 뺀다. 나머지는 그대로 할 일 목록이다(브라우저가 목록을 둘로 나누며 표시를 복사해 둔다)
    exec('insertUnorderedList')
    return
  }
  if (list?.tagName === 'UL') {
    markChecklist(list)
    return
  }
  // 번호 목록 칸이나 목록 밖의 줄(<br> 로 나뉜 글, 문단)은 브라우저의 글머리 목록 명령으로 감싼다(되돌리기가 이어지게). 그 뒤 할 일로 표시한다
  exec('insertUnorderedList')
  markFreshChecklist(editor)
}

/** 방금 만든(바꾼) 글머리 목록 칸을 할 일로 표시한다. 위·아래 글머리 목록에 붙었으면 그 칸들만 따로 떼어 낸다 */
function markFreshChecklist(editor: HTMLElement) {
  const now = editorRange(editor)
  if (now === null) return
  const made = closestIn(now.startContainer, editor, (element) => element.tagName === 'UL')
  if (made === null) return
  const items = [...made.children].filter((child): child is HTMLLIElement => child instanceof HTMLLIElement)
  const first = closestIn(now.startContainer, editor, (element) => element.tagName === 'LI')
  const targets = new Set(items.filter((item) => item === first || (!now.collapsed && now.intersectsNode(item))))
  if (made.getAttribute('data-type') === 'check') {
    for (const item of targets) if (!item.hasAttribute('data-checked')) item.setAttribute('data-checked', 'false')
    return
  }
  if (targets.size === 0 || targets.size === items.length) {
    markChecklist(made)
    return
  }
  // 칸을 옮기면 선택이 풀리므로 끝점을 적어 두었다가 되돌린다
  const saved = { start: [now.startContainer, now.startOffset] as const, end: [now.endContainer, now.endOffset] as const }
  const pieces: HTMLElement[] = []
  for (const item of items) {
    const check = targets.has(item)
    let piece = pieces[pieces.length - 1]
    if (piece === undefined || (piece.getAttribute('data-type') === 'check') !== check) {
      piece = document.createElement('ul')
      if (check) piece.setAttribute('data-type', 'check')
      pieces.push(piece)
    }
    if (check && !item.hasAttribute('data-checked')) item.setAttribute('data-checked', 'false')
    piece.appendChild(item)
  }
  made.replaceWith(...pieces)
  const restored = document.createRange()
  restored.setStart(...saved.start)
  restored.setEnd(...saved.end)
  const selection = window.getSelection()
  selection?.removeAllRanges()
  selection?.addRange(restored)
}

/** 할 일 칸(글 왼쪽의 네모)을 눌렀는가 */
export function checkItemAt(target: EventTarget | null, clientX: number): HTMLLIElement | null {
  if (!(target instanceof Element)) return null
  const item = target.closest('ul[data-type="check"] > li')
  if (!(item instanceof HTMLLIElement)) return null
  const left = item.getBoundingClientRect().left
  return clientX - left <= 24 ? item : null
}

export function toggleCheckItem(item: HTMLLIElement) {
  item.setAttribute('data-checked', item.getAttribute('data-checked') === 'true' ? 'false' : 'true')
}

/** 할 일 목록 안에서 몇 번째 칸인가(글만 있는 메모의 - [ ] 를 고칠 때) */
export function checkItemIndex(root: HTMLElement, item: HTMLLIElement): number {
  return [...root.querySelectorAll('ul[data-type="check"] > li')].indexOf(item)
}

/** `코드`: 고른 글을 코드로, 코드 안이면 풀기. 아무것도 안 골랐으면 빈 코드를 넣고 그 안에서 쓴다 */
export function toggleInlineCode(editor: HTMLElement) {
  const range = editorRange(editor)
  if (range === null) return
  if (closestIn(range.startContainer, editor, (element) => element.tagName === 'PRE') !== null) return
  const code = closestIn(range.commonAncestorContainer, editor, (element) => element.tagName === 'CODE')
  if (code !== null) {
    unwrapCode(editor, code, range)
    return
  }
  // 줄을 넘는 선택은 코드로 만들지 않는다(줄이 한 줄로 합쳐지고 HTML 이 깨진다)
  if (!range.collapsed && !withinOneLine(editor, range)) return
  const selected = range.toString().replaceAll(ZERO_WIDTH, '')
  // 되돌리기가 이어지도록 execCommand 로 넣는다. 만든 <code> 는 표시를 달아 두었다가 찾는다
  exec('insertHTML', `<code data-iwae-new="1">${escapeHtml(selected === '' ? ZERO_WIDTH : selected)}</code>${ZERO_WIDTH}`)
  const made = editor.querySelector('code[data-iwae-new]')
  if (made === null) return
  made.removeAttribute('data-iwae-new')
  const text = made.firstChild
  if (selected === '' && text !== null) {
    placeCaret(text, text.textContent?.length ?? 1)
    return
  }
  // 고른 글은 코드 안에서 그대로 고른 채로 둔다(한 번 더 누르면 풀린다)
  const inside = document.createRange()
  inside.selectNodeContents(made)
  const selection = window.getSelection()
  selection?.removeAllRanges()
  selection?.addRange(inside)
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>]/gu, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[char] ?? char))
}

/** 선택이 한 줄(한 문단) 안에 드는가 */
function withinOneLine(editor: HTMLElement, range: Range): boolean {
  const owner = (node: Node) => closestIn(node, editor, (element) => LINE_BLOCK.test(element.tagName))
  if (owner(range.startContainer) !== owner(range.endContainer)) return false
  return range.cloneContents().querySelector('br, div, p, li, ul, ol, pre, blockquote, h2, h3, h4, hr, table') === null
}

/** 코드를 풀어 보통 글로 되돌린다. 고른 글(커서)은 되돌린 글 위에 그대로 둔다 */
function unwrapCode(editor: HTMLElement, code: HTMLElement, range: Range) {
  const textOffset = (container: Node, offset: number): number => {
    if (!code.contains(container)) return container.compareDocumentPosition(code) & Node.DOCUMENT_POSITION_FOLLOWING ? 0 : Number.POSITIVE_INFINITY
    const before = document.createRange()
    before.setStart(code, 0)
    before.setEnd(container, offset)
    return before.toString().replaceAll(ZERO_WIDTH, '').length
  }
  const text = (code.textContent ?? '').replaceAll(ZERO_WIDTH, '')
  const from = Math.min(textOffset(range.startContainer, range.startOffset), text.length)
  const to = Math.min(textOffset(range.endContainer, range.endOffset), text.length)
  const selection = window.getSelection()
  // 코드 요소만 고르면 브라우저가 선택을 코드 안으로 접어서 글이 코드 안에 남는다. 옆 글자 하나씩을 함께 골라 코드가 통째로 지워지게 한다
  const previous = code.previousSibling instanceof Text && code.previousSibling.length > 0 ? code.previousSibling : null
  const next = code.nextSibling instanceof Text && code.nextSibling.length > 0 ? code.nextSibling : null
  if (previous === null && next === null) {
    // 옆에 글이 없으면 직접 푼다
    const plain = document.createTextNode(text)
    code.replaceWith(plain)
    const restored = document.createRange()
    restored.setStart(plain, from)
    restored.setEnd(plain, to)
    selection?.removeAllRanges()
    selection?.addRange(restored)
    return
  }
  const prefix = previous === null ? '' : previous.data.slice(-1)
  const suffix = next === null ? '' : next.data.slice(0, 1)
  const wide = document.createRange()
  if (previous === null) wide.setStartBefore(code)
  else wide.setStart(previous, previous.length - 1)
  if (next === null) wide.setEndAfter(code)
  else wide.setEnd(next, 1)
  selection?.removeAllRanges()
  selection?.addRange(wide)
  const inserted = prefix + text + suffix
  exec('insertText', inserted)
  const now = editorRange(editor)
  const node = now?.startContainer
  if (!(node instanceof Text)) return
  // 글을 넣은 뒤 커서는 넣은 글 끝에 있다
  const begin = now!.startOffset - inserted.length + prefix.length
  if (begin < 0) return
  const restored = document.createRange()
  restored.setStart(node, begin + from)
  restored.setEnd(node, begin + to)
  selection?.removeAllRanges()
  selection?.addRange(restored)
}

/** 코드 끝에서 ` 를 한 번 더 누르면 코드 밖으로 나간다 */
function leaveInlineCode(editor: HTMLElement, range: Range): boolean {
  const code = closestIn(range.startContainer, editor, (element) => element.tagName === 'CODE')
  if (code === null || code.closest('pre') !== null) return false
  const rest = document.createRange()
  rest.setStart(range.startContainer, range.startOffset)
  rest.setEnd(code, code.childNodes.length)
  if (rest.toString().replaceAll(ZERO_WIDTH, '') !== '') return false
  let next = code.nextSibling
  if (!(next instanceof Text)) {
    next = document.createTextNode(ZERO_WIDTH)
    code.after(next)
  } else if (!next.data.startsWith(ZERO_WIDTH)) {
    next.insertData(0, ZERO_WIDTH)
  }
  placeCaret(next, 1)
  return true
}

/** marker: 앞뒤 표시의 길이 */
const INLINE_RULES: readonly { readonly key: string; readonly pattern: RegExp; readonly tag: string; readonly marker: number }[] = [
  { key: '`', pattern: /`([^`]*[^`\s][^`]*)`$/u, tag: 'code', marker: 1 },
  { key: '*', pattern: /\*\*([^*\s](?:[^*]*[^*\s])?)\*\*$/u, tag: 'b', marker: 2 },
  { key: '~', pattern: /~~([^~\s](?:[^~]*[^~\s])?)~~$/u, tag: 's', marker: 2 },
  { key: '*', pattern: /(?:^|[^*\w])\*([^*\s](?:[^*]*[^*\s])?)\*$/u, tag: 'i', marker: 1 },
]

/**
 * 글자를 치기 전에: `코드`, **굵게**, ~~취소선~~, *기울임* 의 닫는 표시를 치면 바로 그 서식으로 바꾼다.
 * 바꿨으면 true(그 글자는 넣지 않는다)
 */
export function applyInlineMarkdown(editor: HTMLElement, key: string): boolean {
  const range = editorRange(editor)
  if (range === null || !range.collapsed) return false
  if (key === '`' && leaveInlineCode(editor, range)) return true
  const node = range.startContainer
  if (!(node instanceof Text)) return false
  if (closestIn(node, editor, (element) => element.tagName === 'PRE' || element.tagName === 'CODE') !== null) return false
  const before = node.data.slice(0, range.startOffset).replaceAll(ZERO_WIDTH, '') + key
  for (const rule of INLINE_RULES) {
    if (rule.key !== key) continue
    const match = rule.pattern.exec(before)
    if (match === null) continue
    const inner = match[1]!
    // 바꿀 글의 시작: 여는 표시부터
    const startInBefore = before.length - inner.length - rule.marker * 2
    const raw = node.data.slice(0, range.startOffset)
    // 폭 없는 글자를 뺀 위치를 원래 글의 위치로 되돌린다
    let start = 0
    for (let seen = 0; start < raw.length && seen < startInBefore; start += 1) if (raw[start] !== ZERO_WIDTH) seen += 1
    // 여는 표시부터 커서까지를 골라 execCommand 로 바꿔 넣는다(DOM 을 직접 고치면 브라우저의 되돌리기가 어긋난다)
    const marked = document.createRange()
    marked.setStart(node, start)
    marked.setEnd(node, range.startOffset)
    const selection = window.getSelection()
    selection?.removeAllRanges()
    selection?.addRange(marked)
    exec('insertHTML', `<${rule.tag}>${escapeHtml(inner)}</${rule.tag}>${ZERO_WIDTH}`)
    return true
  }
  return false
}

/**
 * 줄 맨 앞에서 Markdown 표시를 쓰고 띄어쓰기(또는 Enter)를 하면 그 모양으로 바꾼다.
 * 띄어쓰기: # ## ### 제목, - * + 목록, 1. 번호, > 인용, [ ] 할 일, ``` 코드 블록 / Enter: ``` 코드 블록, --- 구분선
 */
export function applyBlockMarkdown(editor: HTMLElement, trigger: 'space' | 'enter'): boolean {
  const caret = editorRange(editor)
  if (caret === null || !caret.collapsed) return false
  if (closestIn(caret.startContainer, editor, (element) => element.tagName === 'PRE' || element.tagName === 'CODE') !== null) return false
  const line = lineBeforeCaret(editor, caret)
  const text = line.toString().replaceAll(ZERO_WIDTH, '').trim()
  if (text === '' || (text.length > 4 && !text.startsWith('```'))) return false
  const inList = closestIn(caret.startContainer, editor, (element) => element.tagName === 'LI')
  let action: (() => void) | null = null
  if (trigger === 'space') {
    if (/^#{1,3}$/u.test(text)) action = () => exec('formatBlock', `h${text.length + 1}`)
    else if (/^[-*+]$/u.test(text) && inList === null) action = () => exec('insertUnorderedList')
    else if (/^\d+[.)]$/u.test(text) && inList === null) {
      const start = Number.parseInt(text, 10)
      action = () => {
        exec('insertOrderedList')
        // 3. 으로 시작했으면 3 부터 센다. 위 번호 목록에 붙은 것(이어 세기)은 건드리지 않는다
        const now = editorRange(editor)
        const made = now === null ? null : closestIn(now.startContainer, editor, (element) => element.tagName === 'OL')
        if (made !== null && start > 1 && start <= 99999 && made.children.length === 1) made.setAttribute('start', String(start))
      }
    }
    else if (text === '>') action = () => exec('formatBlock', 'blockquote')
    else if (/^\[[ xX]?\]$/u.test(text)) {
      const checked = /x/iu.test(text)
      action = () => {
        if (inList?.parentElement?.tagName === 'UL') markChecklist(inList.parentElement)
        else toggleChecklist(editor)
        const now = editorRange(editor)
        const item = now === null ? null : closestIn(now.startContainer, editor, (element) => element.tagName === 'LI')
        item?.setAttribute('data-checked', String(checked))
      }
    } else if (text === '```') action = () => exec('formatBlock', 'pre')
  } else if (/^```[\w+#.-]{0,20}$/u.test(text)) {
    action = () => exec('formatBlock', 'pre')
  } else if (/^(-{3}|\*{3}|_{3})$/u.test(text)) {
    action = () => exec('insertHorizontalRule')
  }
  if (action === null) return false
  deleteRange(line)
  action()
  return true
}

/** 커서 앞(같은 요소 안)에 <br> 이 있는가: 코드 블록·인용의 둘째 줄 이후인가 */
function brJustBefore(container: HTMLElement, caret: Range): HTMLBRElement | null {
  const before = document.createRange()
  before.setStart(container, 0)
  before.setEnd(caret.startContainer, caret.startOffset)
  if (before.toString().replaceAll(ZERO_WIDTH, '').length > 0) {
    // 마지막 <br> 뒤에 글이 있으면 빈 줄이 아니다
    const brs = [...container.querySelectorAll('br')].filter((br) => before.intersectsNode(br))
    const last = brs[brs.length - 1]
    if (last === undefined) return null
    const tail = document.createRange()
    tail.setStartAfter(last)
    tail.setEnd(caret.startContainer, caret.startOffset)
    return tail.toString().replaceAll(ZERO_WIDTH, '') === '' ? last : null
  }
  return null
}

/** 코드 블록·인용 맨 끝의 빈 줄에서 Enter: 빈 줄을 지우고 블록 밑에 보통 글 줄을 만든다 */
function exitTrailingEmptyLine(editor: HTMLElement, container: HTMLElement, caret: Range): boolean {
  const after = document.createRange()
  after.setStart(caret.startContainer, caret.startOffset)
  after.setEnd(container, container.childNodes.length)
  if (after.toString().replaceAll(ZERO_WIDTH, '') !== '') return false
  const line = closestIn(caret.startContainer, editor, (element) => LINE_BLOCK.test(element.tagName))
  if (line !== null && line !== container && container.contains(line)) {
    // 인용 안에서 Enter 로 생긴 <div> 줄
    if ((line.textContent ?? '').replaceAll(ZERO_WIDTH, '') !== '' || line === container.firstElementChild && container.childElementCount === 1) return false
    line.remove()
  } else {
    const br = brJustBefore(container, caret)
    if (br === null) return false
    // 빈 줄을 만든 <br> 과 그 뒤에 남은 자리표시 <br> 을 지운다
    for (const trailing of [...container.querySelectorAll('br')].filter((element) => after.intersectsNode(element))) trailing.remove()
    br.remove()
  }
  const next = document.createElement('div')
  next.appendChild(document.createElement('br'))
  container.after(next)
  placeCaret(next, 0)
  return true
}

/** Enter 를 누르기 전에. 처리했으면 true */
export function handleMemoEnter(editor: HTMLElement): boolean {
  const caret = editorRange(editor)
  if (caret === null) return false
  const container = closestIn(caret.startContainer, editor, (element) => element.tagName === 'PRE' || element.tagName === 'BLOCKQUOTE')
  if (container !== null) {
    if (caret.collapsed) {
      // 빈 코드 블록·인용에서 Enter: 보통 글로 되돌린다
      if ((container.textContent ?? '').replaceAll(ZERO_WIDTH, '') === '') {
        exec('formatBlock', 'div')
        return true
      }
      if (exitTrailingEmptyLine(editor, container, caret)) return true
    }
    // 코드 블록·인용 안에서는 새 블록 대신 줄만 바꾼다(빈 줄에서 한 번 더 Enter 면 빠져나간다)
    exec('insertLineBreak')
    return true
  }
  if (applyBlockMarkdown(editor, 'enter')) return true
  // 할 일 목록에서 Enter 로 생긴 새 칸은 체크하지 않은 상태로 시작한다
  const item = closestIn(caret.startContainer, editor, (element) => element.tagName === 'LI')
  if (item?.parentElement?.getAttribute('data-type') === 'check') {
    window.setTimeout(() => {
      const now = editorRange(editor)
      const fresh = now === null ? null : closestIn(now.startContainer, editor, (element) => element.tagName === 'LI')
      if (fresh !== null && fresh !== item) fresh.setAttribute('data-checked', 'false')
    }, 0)
  }
  return false
}

/** 제목·인용·코드 블록 맨 앞에서 Backspace: 보통 글로 되돌린다 */
export function handleMemoBackspace(editor: HTMLElement): boolean {
  const caret = editorRange(editor)
  if (caret === null || !caret.collapsed) return false
  const block = closestIn(caret.startContainer, editor, (element) => SPECIAL_BLOCK.test(element.tagName))
  if (block === null) return false
  const before = document.createRange()
  before.setStart(block, 0)
  before.setEnd(caret.startContainer, caret.startOffset)
  if (before.toString().replaceAll(ZERO_WIDTH, '') !== '' || [...block.querySelectorAll('br')].some((br) => before.intersectsNode(br) && br !== block.lastChild)) return false
  exec('formatBlock', 'div')
  return true
}

/** Tab: 목록이면 한 단계 들이기(Shift 면 내기), 코드 블록이면 띄어쓰기 두 칸 */
export function handleMemoTab(editor: HTMLElement, outdent: boolean): boolean {
  const caret = editorRange(editor)
  if (caret === null) return false
  if (closestIn(caret.startContainer, editor, (element) => element.tagName === 'PRE') !== null) {
    if (!outdent) exec('insertText', '  ')
    return true
  }
  const item = closestIn(caret.startContainer, editor, (element) => element.tagName === 'LI')
  if (item === null) return false
  const wasCheck = item.parentElement?.getAttribute('data-type') === 'check'
  exec(outdent ? 'outdent' : 'indent')
  if (wasCheck) {
    const now = editorRange(editor)
    const list = now === null ? null : closestIn(now.startContainer, editor, (element) => element.tagName === 'UL')
    if (list !== null) markChecklist(list)
  }
  return true
}

/** 글만 붙여 넣을 때 Markdown 표시가 있으면 서식으로 바꿔 넣는다(코드 블록 안에서는 글 그대로) */
export function looksLikeMarkdown(raw: string): boolean {
  const text = raw.replace(/\r\n?/gu, '\n')
  // | 표 | 머리줄 + |---| 구분줄
  if (/(^|\n)\s*\|?.*\|.*\n\s*\|?\s*:?-{2,}/u.test(text)) return true
  return /(^|\n)\s*(```|#{1,3}\s|[-*+]\s|\d+[.)]\s|>\s?|-{3,}\s*(\n|$))|`[^`\n]+`|\*\*[^*\n]+\*\*/u.test(text)
}

export function insideCodeBlock(editor: HTMLElement): boolean {
  const caret = editorRange(editor)
  return caret !== null && closestIn(caret.startContainer, editor, (element) => element.tagName === 'PRE') !== null
}

const BLOCK_TAGS = new Set(['P', 'DIV', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'LI', 'PRE', 'BLOCKQUOTE', 'TR'])

/** innerText 와 비슷한 모양의 글: 블록 요소와 <br> 는 줄바꿈이 된다 */
function domText(root: Node): string {
  let out = ''
  const newline = () => { if (out !== '' && !out.endsWith('\n')) out += '\n' }
  const walk = (node: Node) => {
    if (node.nodeType === 3) { out += node.textContent ?? ''; return }
    if (node.nodeType !== 1) return
    const tag = (node as Element).tagName
    if (tag === 'BR') { out += '\n'; return }
    const block = node !== root && BLOCK_TAGS.has(tag)
    if (block) newline()
    node.childNodes.forEach(walk)
    if (block) newline()
  }
  walk(root)
  return out
}

/** 저장할 글: 화면에 보이는 대로(폭 없는 글자·&nbsp; 는 지운다) */
export function memoPlainText(element: HTMLElement): string {
  let raw = element.innerText ?? element.textContent ?? ''
  // 카드가 화면 밖이라 그려지지 않으면(content-visibility) innerText 가 비어 나온다. 글이 있는데 빈 글로 저장하지 않게 DOM 을 돌아 같은 모양으로 만든다
  if (raw.trim() === '' && (element.textContent ?? '').replaceAll(ZERO_WIDTH, '').trim() !== '') raw = domText(element)
  return raw.replaceAll(ZERO_WIDTH, '').replace(/ /gu, ' ').replace(/\n{3,}/gu, '\n\n').trim()
}
