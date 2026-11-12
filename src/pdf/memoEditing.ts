/**
 * 메모 글쓰기 칸(contenteditable)의 서식 다루기: 문단 모양(제목·인용·코드 블록), `코드`, 할 일 목록, 그리고
 * Markdown 처럼 쓰면 바로 바뀌는 단축(# 제목, - 목록, 1. 번호, > 인용, [ ] 할 일, ``` 코드 블록, --- 구분선, `코드`, **굵게** …).
 */

/** 문단 모양. p 는 보통 글 */
export type MemoBlockKind = 'p' | 'h2' | 'h3' | 'h4' | 'blockquote' | 'pre'

const LINE_BLOCK = /^(DIV|P|LI|H2|H3|H4|BLOCKQUOTE|PRE)$/u
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
  exec('formatBlock', target === 'p' ? 'div' : target)
}

/** 커서가 있는 줄의 처음부터 커서까지(줄은 문단 요소나 <br> 로 나뉜다) */
function lineBeforeCaret(editor: HTMLElement, caret: Range): Range {
  const block = closestIn(caret.startContainer, editor, (element) => LINE_BLOCK.test(element.tagName)) ?? editor
  const range = document.createRange()
  range.setStart(block, 0)
  range.setEnd(caret.startContainer, caret.startOffset)
  for (const element of block.querySelectorAll('br, div, p, ul, ol, pre, blockquote, h2, h3, h4, hr')) {
    if (element.contains(caret.startContainer)) continue
    if (range.intersectsNode(element) && range.comparePoint(element, 0) >= 0) range.setStartAfter(element)
  }
  return range
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
    list.removeAttribute('data-type')
    for (const item of list.querySelectorAll(':scope > li')) item.removeAttribute('data-checked')
    exec('insertUnorderedList')
    return
  }
  if (list?.tagName === 'UL') {
    markChecklist(list)
    return
  }
  if (list !== null) {
    // 번호 목록은 글머리 목록으로 바꾼 뒤 할 일로
    exec('insertUnorderedList')
    const after = editorRange(editor)
    const made = after === null ? null : closestIn(after.startContainer, editor, (element) => element.tagName === 'UL')
    if (made !== null) markChecklist(made)
    return
  }
  // 새 할 일 목록은 손으로 만든다(insertUnorderedList 는 바로 위 목록에 붙여 버린다)
  const checklist = document.createElement('ul')
  checklist.setAttribute('data-type', 'check')
  const item = document.createElement('li')
  item.setAttribute('data-checked', 'false')
  checklist.appendChild(item)
  const line = closestIn(range.startContainer, editor, (element) => element.tagName === 'DIV' || element.tagName === 'P')
  if (line !== null) {
    item.append(...line.childNodes)
    line.replaceWith(checklist)
  } else {
    range.collapse(true)
    range.insertNode(checklist)
  }
  if (item.textContent === '') item.replaceChildren(document.createElement('br'))
  const end = item.lastChild instanceof HTMLBRElement ? 0 : item.childNodes.length
  placeCaret(item, end)
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
    const text = document.createTextNode((code.textContent ?? '').replaceAll(ZERO_WIDTH, ''))
    code.replaceWith(text)
    const selection = window.getSelection()
    const all = document.createRange()
    all.selectNodeContents(text)
    selection?.removeAllRanges()
    selection?.addRange(all)
    return
  }
  const selected = range.toString()
  range.deleteContents()
  const element = document.createElement('code')
  element.textContent = selected === '' ? ZERO_WIDTH : selected
  const after = document.createTextNode(ZERO_WIDTH)
  range.insertNode(after)
  range.insertNode(element)
  if (selected === '') placeCaret(element.firstChild!, 1)
  else placeCaret(after, 1)
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
    const rest = node.data.slice(range.startOffset)
    node.data = raw.slice(0, start)
    const element = document.createElement(rule.tag)
    element.textContent = inner
    const after = document.createTextNode(ZERO_WIDTH + rest)
    node.after(element, after)
    placeCaret(after, 1)
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
    else if (/^\d+[.)]$/u.test(text) && inList === null) action = () => exec('insertOrderedList')
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
export function looksLikeMarkdown(text: string): boolean {
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
