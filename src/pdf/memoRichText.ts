/**
 * 메모의 서식(굵게·기울임·밑줄·취소선·글자색·배경색·목록·할 일·제목·인용·코드·구분선). 저장은 작은 HTML 조각으로 하고,
 * 그릴 때와 저장할 때 모두 아래 허용 목록만 남긴다(스크립트·링크·그림 등은 버린다).
 * 서식 없이 글만 있는 메모(MCP·옛 메모)는 Markdown 처럼 읽어 그린다(`코드`, ``` 코드 블록, - 목록, > 인용, # 제목 …).
 */

const ALLOWED_TAGS = new Set([
  'B', 'STRONG', 'I', 'EM', 'U', 'S', 'STRIKE', 'SPAN', 'UL', 'OL', 'LI', 'BR', 'DIV', 'P', 'CODE',
  'PRE', 'BLOCKQUOTE', 'H2', 'H3', 'H4', 'HR',
  // 표: 노트·메모에 표를 그대로 둔다(붙여 넣은 표, | 표 | Markdown, MCP)
  'TABLE', 'THEAD', 'TBODY', 'TFOOT', 'TR', 'TH', 'TD', 'CAPTION',
])
/** 다른 곳에서 붙여 넣은 제목은 노트가 쓰는 세 단계로 맞춘다 */
const RENAMED_TAGS: Readonly<Record<string, string>> = { H1: 'H2', H5: 'H4', H6: 'H4', DEL: 'S', INS: 'U', KBD: 'CODE', SAMP: 'CODE', TT: 'CODE' }
/** 안의 글까지 통째로 버리는 태그 */
const DROPPED_TAGS = new Set(['SCRIPT', 'STYLE', 'TEMPLATE', 'IFRAME', 'OBJECT', 'EMBED', 'SVG', 'MATH', 'NOSCRIPT'])
const ALLOWED_STYLES = ['color', 'background-color', 'font-weight', 'font-style', 'text-decoration', 'text-decoration-line']
/** 글자 뒤에 커서를 두려고 잠깐 넣는 폭 없는 글자. 저장할 때는 지운다 */
const ZERO_WIDTH = /​/gu

function cleanStyle(style: CSSStyleDeclaration): string {
  return ALLOWED_STYLES
    .map((name) => [name, style.getPropertyValue(name)] as const)
    .filter(([, value]) => value !== '' && !/url\(|expression|javascript/iu.test(value))
    .map(([name, value]) => `${name}: ${value}`)
    .join('; ')
}

function cleanNode(node: Node, into: Node, doc: Document) {
  for (const child of [...node.childNodes]) {
    if (child.nodeType === Node.TEXT_NODE) {
      const text = (child.textContent ?? '').replace(ZERO_WIDTH, '')
      if (text !== '') into.appendChild(doc.createTextNode(text))
      continue
    }
    if (!(child instanceof Element)) continue
    let tag = child.tagName.toUpperCase()
    if (DROPPED_TAGS.has(tag)) continue
    tag = RENAMED_TAGS[tag] ?? tag
    // execCommand 가 남기는 <font color> 는 글자색 span 으로 바꾼다
    let extraStyle = ''
    if (tag === 'FONT') {
      const color = child.getAttribute('color')
      tag = 'SPAN'
      if (color !== null && /^[#a-z0-9(),.\s%]+$/iu.test(color)) extraStyle = `color: ${color}`
    }
    if (!ALLOWED_TAGS.has(tag)) {
      // 모르는 태그는 버리고 안의 글자만 남긴다
      cleanNode(child, into, doc)
      continue
    }
    const element = doc.createElement(tag.toLowerCase())
    const style = [child instanceof HTMLElement ? cleanStyle(child.style) : '', extraStyle].filter(Boolean).join('; ')
    if (style !== '') element.setAttribute('style', style)
    // 할 일 목록: <ul data-type="check"><li data-checked="true|false">
    if (tag === 'UL' && child.getAttribute('data-type') === 'check') element.setAttribute('data-type', 'check')
    if (tag === 'LI') {
      const checked = child.getAttribute('data-checked')
      if (checked === 'true' || checked === 'false') element.setAttribute('data-checked', checked)
    }
    // 표 칸 합치기와 정렬만 남긴다
    if (tag === 'TD' || tag === 'TH') {
      for (const name of ['colspan', 'rowspan'] as const) {
        const value = Number(child.getAttribute(name))
        if (Number.isInteger(value) && value > 1 && value <= 50) element.setAttribute(name, String(value))
      }
      const align = child.getAttribute('align') ?? (child instanceof HTMLElement ? child.style.textAlign : '')
      if (align === 'left' || align === 'center' || align === 'right') element.setAttribute('align', align)
    }
    cleanNode(child, element, doc)
    into.appendChild(element)
  }
}

export function sanitizeMemoHtml(html: string): string {
  if (typeof DOMParser === 'undefined') return ''
  const parsed = new DOMParser().parseFromString(`<div>${html}</div>`, 'text/html')
  const out = document.implementation.createHTMLDocument('')
  const root = out.createElement('div')
  const source = parsed.body.firstElementChild
  if (source !== null) cleanNode(source, root, out)
  return root.innerHTML
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"]/gu, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[char] ?? char))
}

export function escapeMemoText(text: string): string {
  return text.replace(/[&<>]/gu, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[char] ?? char)).replace(/\n/gu, '<br>')
}

/** 한 줄 안의 Markdown: `코드`, **굵게**, ~~취소선~~, *기울임*. 코드 안은 그대로 둔다 */
export function inlineMarkdownToHtml(line: string): string {
  const parts = line.split(/(`[^`\n]+`)/u)
  return parts.map((part, index) => {
    if (index % 2 === 1) return `<code>${escapeMemoText(part.slice(1, -1))}</code>`
    return escapeMemoText(part)
      .replace(/\*\*(?=\S)(.+?)(?<=\S)\*\*/gu, '<b>$1</b>')
      .replace(/~~(?=\S)(.+?)(?<=\S)~~/gu, '<s>$1</s>')
      .replace(/(^|[^*\w])\*(?=[^\s*])([^*]+?)(?<=[^\s*])\*(?![*\w])/gu, '$1<i>$2</i>')
  }).join('')
}

type MarkdownSegment = { readonly inline: boolean; readonly html: string }

const FENCE = /^\s*(```|~~~)/u
const HEADING = /^(#{1,3})\s+(.+)$/u
const CHECK_ITEM = /^\s*[-*+]\s+\[([ xX])\]\s?(.*)$/u
const BULLET_ITEM = /^\s*[-*+•]\s+(.*)$/u
const NUMBER_ITEM = /^\s*\d+[.)]\s+(.*)$/u
const QUOTE_LINE = /^\s*>\s?(.*)$/u
const RULE_LINE = /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/u
/** | 칸 | 칸 | 줄. 바깥 | 는 없어도 된다(칸이 둘 이상이면) */
const TABLE_ROW = /^\s*\|?.*\|.*$/u
/** 머리줄 아래 구분줄: |---|:---:|---:| */
const TABLE_RULE = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/u

function tableCells(line: string): string[] {
  let row = line.trim()
  if (row.startsWith('|')) row = row.slice(1)
  if (row.endsWith('|') && !row.endsWith('\\|')) row = row.slice(0, -1)
  // \| 는 칸 나누기가 아니다
  return row.split(/(?<!\\)\|/u).map((cell) => cell.trim().replace(/\\\|/gu, '|'))
}

/** Markdown 표(머리줄 + 구분줄 + 줄들) → <table>. 정렬(:---:)도 따른다 */
export function markdownTableToHtml(lines: readonly string[]): string {
  const header = tableCells(lines[0] ?? '')
  const aligns = tableCells(lines[1] ?? '').map((cell) => cell.startsWith(':') && cell.endsWith(':') ? 'center' : cell.endsWith(':') ? 'right' : cell.startsWith(':') ? 'left' : '')
  const cell = (tag: 'th' | 'td', text: string, index: number) => {
    const align = aligns[index]
    return `<${tag}${align === undefined || align === '' ? '' : ` align="${align}"`}>${inlineMarkdownToHtml(text) || '<br>'}</${tag}>`
  }
  const body = lines.slice(2).map((line) => {
    const cells = tableCells(line)
    return `<tr>${header.map((_, index) => cell('td', cells[index] ?? '', index)).join('')}</tr>`
  }).join('')
  return `<table><thead><tr>${header.map((text, index) => cell('th', text, index)).join('')}</tr></thead><tbody>${body}</tbody></table>`
}

/**
 * 서식 없는 글을 메모 HTML 로. Markdown 표시가 없는 줄은 예전처럼 그대로(줄바꿈은 <br>) 두어서,
 * 그냥 쓴 글은 전과 똑같이 보인다.
 */
export function plainMemoTextToHtml(text: string): string {
  const lines = text.split('\n')
  const segments: MarkdownSegment[] = []
  const block = (html: string) => segments.push({ inline: false, html })
  let index = 0
  while (index < lines.length) {
    const line = lines[index]!
    const fence = FENCE.exec(line)
    if (fence !== null) {
      const body: string[] = []
      index += 1
      while (index < lines.length && !lines[index]!.trimStart().startsWith(fence[1]!)) {
        body.push(lines[index]!)
        index += 1
      }
      index += 1
      block(`<pre>${body.map((row) => escapeHtml(row)).join('<br>') || '<br>'}</pre>`)
      continue
    }
    // 표: 머리줄 다음 줄이 |---| 구분줄이면 표가 끝날 때까지 모은다
    if (TABLE_ROW.test(line) && TABLE_RULE.test(lines[index + 1] ?? '') && tableCells(line).length >= 2) {
      const rows = [line, lines[index + 1]!]
      index += 2
      while (index < lines.length && TABLE_ROW.test(lines[index]!) && lines[index]!.trim() !== '') {
        rows.push(lines[index]!)
        index += 1
      }
      block(markdownTableToHtml(rows))
      continue
    }
    const heading = HEADING.exec(line)
    if (heading !== null) {
      const tag = `h${heading[1]!.length + 1}`
      block(`<${tag}>${inlineMarkdownToHtml(heading[2]!.trim())}</${tag}>`)
      index += 1
      continue
    }
    if (RULE_LINE.test(line)) {
      block('<hr>')
      index += 1
      continue
    }
    // 같은 모양의 줄이 이어지는 동안 모은다
    const collect = (pattern: RegExp, skip?: RegExp): RegExpExecArray[] => {
      const rows: RegExpExecArray[] = []
      while (index < lines.length) {
        const match = pattern.exec(lines[index]!)
        if (match === null || skip?.test(lines[index]!) === true) break
        rows.push(match)
        index += 1
      }
      return rows
    }
    if (CHECK_ITEM.test(line)) {
      const items = collect(CHECK_ITEM).map((match) => `<li data-checked="${match[1] === ' ' ? 'false' : 'true'}">${inlineMarkdownToHtml(match[2]!) || '<br>'}</li>`)
      block(`<ul data-type="check">${items.join('')}</ul>`)
      continue
    }
    if (BULLET_ITEM.test(line)) {
      block(`<ul>${collect(BULLET_ITEM, CHECK_ITEM).map((match) => `<li>${inlineMarkdownToHtml(match[1]!)}</li>`).join('')}</ul>`)
      continue
    }
    if (NUMBER_ITEM.test(line)) {
      block(`<ol>${collect(NUMBER_ITEM).map((match) => `<li>${inlineMarkdownToHtml(match[1]!)}</li>`).join('')}</ol>`)
      continue
    }
    if (QUOTE_LINE.test(line)) {
      block(`<blockquote>${collect(QUOTE_LINE).map((match) => inlineMarkdownToHtml(match[1]!)).join('<br>')}</blockquote>`)
      continue
    }
    segments.push({ inline: true, html: inlineMarkdownToHtml(line) })
    index += 1
  }
  // 글 줄끼리는 <br>, 블록(목록·코드 …) 앞뒤에는 줄바꿈을 따로 넣지 않는다(블록이 알아서 줄을 바꾼다)
  let html = ''
  segments.forEach((segment, at) => {
    const previous = segments[at - 1]
    if (previous !== undefined && previous.inline && segment.inline) html += '<br>'
    html += segment.html
  })
  return html
}

/** Markdown 글 → 노트·메모 서식 HTML(MCP note_append·붙여 넣기). 허용 목록으로 한 번 더 거른다 */
export function markdownToMemoHtml(markdown: string): string {
  return sanitizeMemoHtml(plainMemoTextToHtml(markdown.replace(/\r\n?/gu, '\n')))
}

/** 메모를 그릴 HTML: 서식이 있으면 그것을, 없으면 글을 Markdown 처럼(표시가 없으면 그대로, 줄바꿈 유지) */
export function memoDisplayHtml(note: string | undefined, noteHtml: string | undefined): string {
  if (noteHtml !== undefined && noteHtml.trim() !== '') return sanitizeMemoHtml(noteHtml)
  return plainMemoTextToHtml(note ?? '')
}

/** 서식에 실제로 꾸밈이 있는가(글만 있으면 noteHtml 은 저장하지 않는다) */
export function hasMemoFormatting(html: string): boolean {
  return /<(b|strong|i|em|u|s|strike|span|ul|ol|li|code|pre|blockquote|h[2-4]|hr|table)\b/iu.test(html)
}

/** 글에 Markdown 할 일 표시(- [ ] / - [x])가 있으면 n 번째 것을 뒤집는다. 없으면 null */
export function togglePlainCheck(text: string, nth: number): string | null {
  let seen = -1
  let changed = false
  const next = text.split('\n').map((line) => {
    const match = /^(\s*[-*+]\s+\[)([ xX])(\].*)$/u.exec(line)
    if (match === null) return line
    seen += 1
    if (seen !== nth) return line
    changed = true
    return `${match[1]}${match[2] === ' ' ? 'x' : ' '}${match[3]}`
  }).join('\n')
  return changed ? next : null
}
