/**
 * 메모(글 + 서식 HTML)를 Markdown 으로 바꾼다(노트 내보내기). 서식 HTML 은 memoRichText 가 거른 작은 조각이다:
 * 제목 · 목록(할 일 · 번호) · 굵게 · 기울임 · 취소선 · 코드 · 코드 블록 · 인용 · 표 · 구분선 · 링크 · 줄바꿈.
 * 글만 있는 메모는 줄바꿈을 그대로 살린다(Markdown 에서 한 줄 바꿈은 이어 붙으므로 줄 끝에 공백 둘).
 */

const BLOCK_TAGS = new Set(['P', 'DIV', 'UL', 'OL', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'PRE', 'BLOCKQUOTE', 'HR', 'TABLE'])
const HEADING = /^H([1-6])$/u
const BLOCK_LINE = /^\s*(?:#{1,6}\s|[-*+]\s|\d+[.)]\s|>|```|~~~|\||(?:-{3,}|\*{3,}|_{3,})\s*$)/u

/** 글 속의 Markdown 표시가 표시로 읽히지 않게 막는다 */
function escapeInline(text: string): string {
  return text
    .replace(/ /gu, ' ')
    .replace(/\\/gu, '\\\\')
    .replace(/([*`[\]<~])/gu, '\\$1')
    .replace(/(^|[^\p{L}\p{N}])_|_(?=$|[^\p{L}\p{N}])/gu, (match) => match.replace('_', '\\_'))
}

/** 줄 맨 앞에 와서 목록 · 제목 · 인용으로 읽힐 표시를 막는다 */
function escapeLineStart(line: string): string {
  return line
    .replace(/^(\s*)([#>+-])(?=\s|$)/u, '$1\\$2')
    .replace(/^(\s*)(\d+)([.)])(?=\s|$)/u, '$1$2\\$3')
    .replace(/^(\s*)(={3,}|-{3,}|_{3,})\s*$/u, '$1\\$2')
}

function wrapMark(mark: string, inner: string): string {
  const core = inner.trim()
  if (core === '') return inner
  const lead = inner.slice(0, inner.length - inner.trimStart().length)
  const tail = inner.slice(inner.trimEnd().length)
  return `${lead}${mark}${core}${mark}${tail}`
}

function codeSpan(text: string): string {
  const flat = text.replace(/ /gu, ' ').replace(/\n/gu, ' ')
  if (flat.trim() === '') return ''
  const longest = Math.max(0, ...[...flat.matchAll(/`+/gu)].map((match) => match[0].length))
  const fence = '`'.repeat(longest + 1)
  const pad = flat.startsWith('`') || flat.endsWith('`') ? ' ' : ''
  return `${fence}${pad}${flat}${pad}${fence}`
}

/** 안의 글만(코드 블록 · 코드): <br> 는 줄바꿈 */
function rawText(node: Node): string {
  if (node.nodeType === 3) return node.textContent ?? ''
  if (!(node instanceof Element)) return ''
  if (node.tagName === 'BR') return '\n'
  return [...node.childNodes].map(rawText).join('')
}

function spanMarks(element: Element): { bold: boolean; italic: boolean; strike: boolean } {
  const style = element instanceof HTMLElement ? element.style : null
  const weight = style?.fontWeight ?? ''
  return {
    bold: weight === 'bold' || weight === 'bolder' || (/^\d+$/u.test(weight) && Number(weight) >= 600),
    italic: style?.fontStyle === 'italic',
    strike: /line-through/u.test(`${style?.textDecoration ?? ''} ${style?.getPropertyValue('text-decoration-line') ?? ''}`),
  }
}

/** 줄 안의 글. <br> 는 \n 으로 남긴다(문단이 줄로 나눈다) */
function inline(nodes: readonly Node[]): string {
  return nodes.map((node) => {
    if (node.nodeType === 3) return escapeInline((node.textContent ?? '').replace(/\r?\n/gu, ' '))
    if (!(node instanceof Element)) return ''
    const tag = node.tagName
    if (tag === 'BR') return '\n'
    if (tag === 'CODE') return codeSpan(rawText(node))
    const inner = inline([...node.childNodes])
    if (tag === 'B' || tag === 'STRONG') return wrapMark('**', inner)
    if (tag === 'I' || tag === 'EM') return wrapMark('*', inner)
    if (tag === 'S' || tag === 'STRIKE' || tag === 'DEL') return wrapMark('~~', inner)
    if (tag === 'U') return inner.trim() === '' ? inner : `<u>${inner}</u>`
    if (tag === 'A') {
      const href = node.getAttribute('href') ?? ''
      return href === '' || inner.trim() === '' ? inner : `[${inner.replace(/\n/gu, ' ')}](${href.replace(/[()\s]/gu, (char) => encodeURIComponent(char))})`
    }
    if (tag === 'SPAN') {
      const { bold, italic, strike } = spanMarks(node)
      let out = inner
      if (strike) out = wrapMark('~~', out)
      if (italic) out = wrapMark('*', out)
      if (bold) out = wrapMark('**', out)
      return out
    }
    return inner
  }).join('')
}

/** 한 문단: 줄은 공백 둘로 이어(하드 줄바꿈), 빈 줄은 문단 나누기 */
function paragraph(nodes: readonly Node[]): string {
  const lines = inline(nodes).split('\n').map((line) => escapeLineStart(line.replace(/[ \t]+$/u, '')))
  while (lines.length > 0 && lines[0]!.trim() === '') lines.shift()
  while (lines.length > 0 && lines[lines.length - 1]!.trim() === '') lines.pop()
  let out = ''
  lines.forEach((line, index) => {
    if (index > 0) out += line.trim() === '' || lines[index - 1]!.trim() === '' ? '\n' : '  \n'
    out += line
  })
  return out
}

function tableToMarkdown(table: Element): string {
  const rows = [...table.querySelectorAll('tr')].map((row) => [...row.children].filter((cell) => cell.tagName === 'TD' || cell.tagName === 'TH'))
  if (rows.length === 0) return ''
  const columns = Math.max(...rows.map((row) => row.length))
  if (columns === 0) return ''
  const cellText = (cell: Element | undefined) => (cell === undefined ? '' : inline([...cell.childNodes]).split('\n').map((line) => line.trim()).filter((line) => line !== '').join('<br>').replace(/\|/gu, '\\|'))
  const line = (row: readonly Element[]) => `| ${Array.from({ length: columns }, (_, index) => cellText(row[index])).join(' | ')} |`
  const aligns = Array.from({ length: columns }, (_, index) => {
    const align = rows[0]![index]?.getAttribute('align')
    return align === 'center' ? ':---:' : align === 'right' ? '---:' : align === 'left' ? ':---' : '---'
  })
  return [line(rows[0]!), `| ${aligns.join(' | ')} |`, ...rows.slice(1).map(line)].join('\n')
}

function indentBlock(text: string, first: string, rest: string): string {
  return text.split('\n').map((line, index) => (index === 0 ? first + line : line === '' ? '' : rest + line)).join('\n')
}

function listToMarkdown(list: Element): string {
  const ordered = list.tagName === 'OL'
  const check = list.getAttribute('data-type') === 'check'
  const startAttr = Number(list.getAttribute('start'))
  const start = Number.isInteger(startAttr) && startAttr >= 0 ? startAttr : 1
  const items = [...list.children].filter((child) => child.tagName === 'LI')
  return items.map((item, index) => {
    const marker = ordered ? `${start + index}. ` : check ? `- [${item.getAttribute('data-checked') === 'true' ? 'x' : ' '}] ` : '- '
    const parts = blocksOf(item)
    let body = ''
    parts.forEach((part, at) => {
      if (at > 0) body += /^\s*(?:[-*+]|\d+[.)])\s/u.test(part) ? '\n' : '\n\n'
      body += part
    })
    return indentBlock(body, marker, ' '.repeat(marker.length)).replace(/[ \t]+$/u, '')
  }).join('\n')
}

function blockToMarkdown(element: Element): string[] {
  const tag = element.tagName
  const heading = HEADING.exec(tag)
  if (heading !== null) {
    const text = paragraph([...element.childNodes]).replace(/\s*\n\s*/gu, ' ').trim()
    return text === '' ? [] : [`${'#'.repeat(Number(heading[1]))} ${text}`]
  }
  if (tag === 'UL' || tag === 'OL') return [listToMarkdown(element)]
  if (tag === 'PRE') {
    const body = rawText(element).replace(/ /gu, ' ').replace(/\n+$/u, '')
    const longest = Math.max(2, ...[...body.matchAll(/`{3,}/gu)].map((match) => match[0].length))
    const fence = '`'.repeat(longest + 1)
    return [`${fence}\n${body}\n${fence}`]
  }
  if (tag === 'BLOCKQUOTE') {
    const inner = blocksOf(element).join('\n\n')
    if (inner.trim() === '') return []
    return [inner.split('\n').map((line) => (line.trim() === '' ? '>' : `> ${line}`)).join('\n')]
  }
  if (tag === 'HR') return ['---']
  if (tag === 'TABLE') {
    const table = tableToMarkdown(element)
    return table === '' ? [] : [table]
  }
  return blocksOf(element)
}

/** element 안을 블록(문단 · 목록 · 코드 …)별 Markdown 으로. 블록 사이에 낀 글 · 인라인은 한 문단으로 모은다 */
function blocksOf(parent: Node): string[] {
  const blocks: string[] = []
  let run: Node[] = []
  const flush = () => {
    if (run.length === 0) return
    const text = paragraph(run)
    run = []
    if (text !== '') blocks.push(text)
  }
  for (const child of parent.childNodes) {
    if (child instanceof Element && BLOCK_TAGS.has(child.tagName)) {
      flush()
      blocks.push(...blockToMarkdown(child))
    } else run.push(child)
  }
  flush()
  return blocks
}

/** 메모 서식 HTML → Markdown */
export function memoHtmlToMarkdown(html: string): string {
  const parsed = new DOMParser().parseFromString(`<div>${html}</div>`, 'text/html')
  const root = parsed.body.firstElementChild
  return root === null ? '' : blocksOf(root).join('\n\n').trim()
}

/** 글만 있는 메모: 줄바꿈을 살린다. 목록 · 표 · 코드 블록처럼 Markdown 으로 읽을 줄은 건드리지 않는다 */
export function plainTextToMarkdown(text: string): string {
  const lines = text.replace(/\r\n?/gu, '\n').trim().split('\n')
  let fence: string | null = null
  return lines.map((line, index) => {
    const fenced = /^\s*(```|~~~)/u.exec(line)
    const inFence = fence !== null
    if (fenced !== null) fence = fence === null ? fenced[1]! : line.trimStart().startsWith(fence) ? null : fence
    const next = lines[index + 1]
    if (inFence || fenced !== null || next === undefined || line.trim() === '' || next.trim() === '') return line
    if (BLOCK_LINE.test(line) || BLOCK_LINE.test(next)) return line
    return `${line.replace(/\s+$/u, '')}  `
  }).join('\n')
}

/** 메모 한 칸을 Markdown 으로: 서식 HTML 이 있으면 그것을, 없으면 글을 */
export function memoToMarkdown(text: string, html?: string): string {
  if (html !== undefined && html.trim() !== '' && typeof DOMParser !== 'undefined') {
    const converted = memoHtmlToMarkdown(html)
    if (converted !== '') return converted
  }
  return plainTextToMarkdown(text)
}
