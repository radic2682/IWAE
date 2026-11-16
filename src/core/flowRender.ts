import { t } from '../i18n'
import type { DocumentFormat } from './documentFormat'
import { renderMarkdown, sanitizeFlowHtml } from './markdown'
import { markdownHeadings, markdownSectionPreviews } from './markdownHeadings'
import { DROP_SELECTOR, hasParserError } from './flowPlainText'

export { flowPlainText } from './flowPlainText'

/**
 * 흐르는 글(Markdown·텍스트·HTML·XML) 읽기 화면이 그릴 본문을 만든다.
 * 형식마다 달라지는 것은 이 함수 하나뿐이고, 선택·형광펜·메모·검색·책갈피·목차·배율·인쇄는
 * 모두 그려진 본문(DOM·textContent) 위에서 돌아가므로 형식과 상관없이 같다.
 * 결과 HTML 은 언제나 거른 것이다(원문을 그대로 넣지 않는다).
 */

/** 본문의 제목. 목차·절 미리보기가 쓴다 */
export interface FlowHeading {
  readonly title: string
  /** 1(h1) – 6(h6) */
  readonly depth: number
}

export interface FlowDocument {
  /** 읽기 화면에 넣을 거른 HTML */
  readonly html: string
  readonly headings: readonly FlowHeading[]
  /** 화면에 한 줄로 알릴 말(예: XML 이 깨져 글자 그대로 보여 줄 때) */
  readonly notice?: string
}

export interface FlowSectionPreview {
  readonly title: string
  readonly depth: number
  readonly excerpt: string
}

// ───────────────────────── 텍스트 ─────────────────────────

function escapeHtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

/**
 * 글자 그대로: 모두 이스케이프하고, 빈 줄로 문단을 나눈다. 문단 안의 줄바꿈·연속 빈칸·탭은 CSS(pre-wrap)가 지킨다.
 * 문단 사이에 줄바꿈 글자를 두어 textContent 에서도 문단이 붙지 않게 한다(Markdown 출력과 같다).
 */
function renderText(source: string): FlowDocument {
  const text = source.replaceAll('\r\n', '\n').replaceAll('\r', '\n')
  const paragraphs: string[] = []
  let current: string[] = []
  const flush = () => {
    if (current.length > 0) paragraphs.push(`<p class="flow-text">${escapeHtml(current.join('\n'))}</p>`)
    current = []
  }
  for (const line of text.split('\n')) {
    if (/^[ \t\f\v]*$/u.test(line)) flush()
    else current.push(line)
  }
  flush()
  return { html: paragraphs.join('\n'), headings: [] }
}

// ───────────────────────── HTML ─────────────────────────

/** 본문에 남길 수 있는 속성. 나머지(on*, style, class, srcset, data-* 따위)는 모두 지운다 */
const KEEP_ATTRIBUTES: ReadonlySet<string> = new Set([
  'href', 'src', 'alt', 'title', 'width', 'height', 'colspan', 'rowspan', 'headers', 'scope',
  'start', 'reversed', 'type', 'open', 'lang', 'dir', 'cite', 'datetime', 'abbr', 'align', 'valign',
  'id',
])

/** 안전한 그림 data: 주소(점 찍는 그림만. SVG 는 뺀다) */
const RASTER_DATA_URL = /^data:image\/(?:png|jpe?g|gif|webp|avif|bmp|x-icon|vnd\.microsoft\.icon);base64,[a-z0-9+/=]*$/iu

/** 문서 안 주소(#id)·이름표가 앱 화면의 id 와 겹치지 않게 붙이는 앞머리 */
const ID_PREFIX = 'flow-'

/** scheme 사이에 끼워 넣어 검사를 피하는 제어문자·보이지 않는 글자 */
const HIDDEN_CHARS = new RegExp(`[${String.fromCharCode(0)}-${String.fromCharCode(32)}${String.fromCharCode(127)}-${String.fromCharCode(159)}${String.fromCharCode(0x200b)}-${String.fromCharCode(0x200f)}${String.fromCharCode(0x2028, 0x2029, 0xfeff)}]`, 'gu')

function sanitizeUrlAttributes(element: Element): void {
  for (const name of ['href', 'src', 'cite']) {
    const value = element.getAttribute(name)
    if (value === null) continue
    // 제어문자·공백을 끼워 scheme 을 숨기는 수법을 막으려고 비교용으로는 걷어 낸다
    const compact = value.replace(HIDDEN_CHARS, '')
    if (name === 'src' && element.tagName === 'IMG' && /^data:/iu.test(compact)) {
      if (!RASTER_DATA_URL.test(compact)) element.removeAttribute(name)
      continue
    }
    if (/^(?:javascript|vbscript|data|file|blob|filesystem):/iu.test(compact)) element.removeAttribute(name)
  }
}

/** 이 문서를 읽기용으로 다듬는다: DOM 에서 위험·잡음 요소와 속성을 걷어 낸 뒤 공용 거르개(DOMPurify)에 넘긴다 */
function renderHtml(source: string): FlowDocument {
  // DOMParser 가 만든 문서는 스크립트를 실행하지 않고 그림·스타일도 불러오지 않는다
  const doc = new DOMParser().parseFromString(source, 'text/html')
  const title = (doc.title ?? '').replace(/\s+/gu, ' ').trim()
  const body = doc.body ?? doc.documentElement
  for (const element of [...body.querySelectorAll(DROP_SELECTOR)]) element.remove()

  for (const element of [...body.querySelectorAll('*')]) {
    // 이름표(<a name>)는 같은 문서 안 링크 대상이다. id 로 옮긴다
    if (element.tagName === 'A' && !element.hasAttribute('id') && element.hasAttribute('name')) {
      element.setAttribute('id', element.getAttribute('name') ?? '')
    }
    for (const attribute of [...element.attributes]) {
      if (!KEEP_ATTRIBUTES.has(attribute.name)) element.removeAttribute(attribute.name)
    }
    sanitizeUrlAttributes(element)
    const id = element.getAttribute('id')
    if (id !== null) {
      if (id === '') element.removeAttribute('id')
      else element.setAttribute('id', ID_PREFIX + id)
    }
    if (element.tagName === 'A') {
      const href = element.getAttribute('href') ?? ''
      if (href.startsWith('#')) element.setAttribute('href', `#${ID_PREFIX}${href.slice(1)}`)
      else if (/^(?:https?:|mailto:)/iu.test(href)) element.setAttribute('rel', 'noreferrer noopener')
    }
  }
  // 빈 제목은 목차에 빈 줄만 만든다
  for (const heading of [...body.querySelectorAll('h1, h2, h3, h4, h5, h6')]) {
    if ((heading.textContent ?? '').trim() === '' && heading.querySelector('img') === null) heading.remove()
  }
  // 표는 넓으면 가로로 스크롤되게 감싼다(Markdown 과 같다)
  for (const table of [...body.querySelectorAll('table')]) {
    const wrap = doc.createElement('div')
    wrap.className = 'markdown-table-wrap'
    table.replaceWith(wrap)
    wrap.append(table)
  }
  // h1 이 없고 <title> 이 있으면 제목으로 올린다(저장한 웹 문서는 제목이 <title> 에만 있는 일이 많다)
  if (title !== '' && body.querySelector('h1') === null) {
    const heading = doc.createElement('h1')
    heading.textContent = title
    body.prepend(heading)
  }
  const html = sanitizeFlowHtml(body.innerHTML, { htmlOnly: true })
  return { html, headings: headingsOfHtml(html) }
}

function headingsOfHtml(html: string): FlowHeading[] {
  const template = document.createElement('template')
  template.innerHTML = html
  return [...template.content.querySelectorAll('h1, h2, h3, h4, h5, h6')].map((element) => ({
    title: (element.textContent ?? '').replace(/\s+/gu, ' ').trim(),
    depth: Number(element.tagName.slice(1)),
  }))
}

// ───────────────────────── XML ─────────────────────────

function span(className: string, text: string): string {
  return `<span class="${className}">${escapeHtml(text)}</span>`
}

const INDENT = '  '

function hasMeaningfulText(node: Node): boolean {
  return (node.nodeType === Node.TEXT_NODE || node.nodeType === Node.CDATA_SECTION_NODE) && (node.nodeValue ?? '').trim() !== ''
}

/** 시작 태그: <이름 속성="값"> (속성은 입력 순서 그대로) */
function openTag(element: Element, selfClosing: boolean): string {
  let out = span('xml-tag', `<${element.tagName}`)
  for (const attribute of [...element.attributes]) {
    out += ` ${span('xml-attr', attribute.name)}${span('xml-tag', '=')}${span('xml-val', `"${attribute.value}"`)}`
  }
  return out + span('xml-tag', selfClosing ? '/>' : '>')
}

function inlineNode(node: Node): string {
  switch (node.nodeType) {
    case Node.TEXT_NODE: return span('xml-text', node.nodeValue ?? '')
    case Node.CDATA_SECTION_NODE: return span('xml-cdata', `<![CDATA[${node.nodeValue ?? ''}]]>`)
    case Node.COMMENT_NODE: return span('xml-comment', `<!--${node.nodeValue ?? ''}-->`)
    case Node.PROCESSING_INSTRUCTION_NODE: {
      const pi = node as ProcessingInstruction
      return span('xml-pi', `<?${pi.target}${pi.data === '' ? '' : ` ${pi.data}`}?>`)
    }
    case Node.ELEMENT_NODE: {
      const element = node as Element
      if (element.childNodes.length === 0) return openTag(element, true)
      return openTag(element, false) + [...element.childNodes].map(inlineNode).join('') + span('xml-tag', `</${element.tagName}>`)
    }
    default: return ''
  }
}

/** 요소 하나를 들여 써서 줄 목록에 덧붙인다 */
function blockElement(element: Element, depth: number, lines: string[]): void {
  const pad = INDENT.repeat(depth)
  const children = [...element.childNodes]
  if (children.length === 0) {
    lines.push(pad + openTag(element, true))
    return
  }
  const textual = children.some(hasMeaningfulText)
  const onlyText = children.every((child) => child.nodeType === Node.TEXT_NODE || child.nodeType === Node.CDATA_SECTION_NODE)
  if (textual || onlyText) {
    // 글이 든 요소(글만 있거나 글과 태그가 섞인 것)는 줄바꿈을 더하지 않고 한 덩어리로 둔다: 글을 바꾸지 않는다
    lines.push(pad + inlineNode(element))
    return
  }
  lines.push(pad + openTag(element, false))
  for (const child of children) {
    if (child.nodeType === Node.ELEMENT_NODE) blockElement(child as Element, depth + 1, lines)
    else if (child.nodeType === Node.TEXT_NODE) continue // 공백뿐인 글은 들여쓰기로 대신한다
    else lines.push(INDENT.repeat(depth + 1) + inlineNode(child))
  }
  lines.push(pad + span('xml-tag', `</${element.tagName}>`))
}

/** 이보다 큰 XML 은 색을 입히지 않고 글자 그대로 보인다(요소마다 span 을 만들면 화면이 멈춘다) */
const XML_MAX_CHARS = 2 * 1024 * 1024
/** 이보다 깊은 XML 도 글자 그대로 보인다(재귀로 그리다 스택이 넘치지 않게) */
const XML_MAX_DEPTH = 400

type NoticeKind = 'xmlInvalid' | 'tooLarge' | 'failed'

/** 알림 문구는 읽는 때의 언어로 만든다(그려 둔 결과를 기억해도 언어를 바꾸면 따라간다) */
function noticeText(kind: NoticeKind): string {
  switch (kind) {
    case 'xmlInvalid': return t('XML 형식이 올바르지 않아 글자 그대로 보여 줍니다.')
    case 'tooLarge': return t('파일이 커서 색 없이 글자 그대로 보여 줍니다.')
    case 'failed': return t('이 파일을 그리지 못해 글자 그대로 보여 줍니다.')
  }
}

/** 글자 그대로 그리고 알림을 붙인다 */
function plainWithNotice(source: string, kind: NoticeKind): FlowDocument {
  const base = renderText(source)
  return { html: base.html, headings: base.headings, get notice() { return noticeText(kind) } }
}

/** 요소 깊이의 최댓값(재귀 없이 잰다) */
function maxDepth(doc: Document): number {
  let deepest = 0
  const walker = doc.createTreeWalker(doc, NodeFilter.SHOW_ELEMENT)
  let depth = 0
  const stack: Node[] = []
  while (walker.nextNode()) {
    const node = walker.currentNode
    while (stack.length > 0 && !stack[stack.length - 1]!.contains(node)) {
      stack.pop()
      depth -= 1
    }
    stack.push(node)
    depth += 1
    if (depth > deepest) deepest = depth
    if (deepest > XML_MAX_DEPTH) break
  }
  return deepest
}

function renderXml(source: string): FlowDocument {
  if (source.length > XML_MAX_CHARS) return plainWithNotice(source, 'tooLarge')
  const text = source.charCodeAt(0) === 0xfeff ? source.slice(1) : source
  const doc = new DOMParser().parseFromString(text, 'application/xml')
  if (hasParserError(doc)) return plainWithNotice(source, 'xmlInvalid')
  if (maxDepth(doc) > XML_MAX_DEPTH) return plainWithNotice(source, 'failed')
  const lines: string[] = []
  // 파서는 맨 앞 <?xml ... ?> 선언을 DOM 에 남기지 않는다. 원문에서 읽어 그대로 보여 준다
  const declaration = /^\s*(<\?xml\s[^?]*\?>)/u.exec(text)
  if (declaration !== null) lines.push(span('xml-pi', declaration[1]!))
  for (const node of [...doc.childNodes]) {
    if (node.nodeType === Node.DOCUMENT_TYPE_NODE) {
      const doctype = node as DocumentType
      const external = doctype.publicId !== '' ? ` PUBLIC "${doctype.publicId}" "${doctype.systemId}"` : doctype.systemId !== '' ? ` SYSTEM "${doctype.systemId}"` : ''
      lines.push(span('xml-doctype', `<!DOCTYPE ${doctype.name}${external}>`))
    } else if (node.nodeType === Node.ELEMENT_NODE) blockElement(node as Element, 0, lines)
    else if (node.nodeType !== Node.TEXT_NODE) lines.push(inlineNode(node))
  }
  return { html: `<pre class="flow-xml">${lines.join('\n')}</pre>`, headings: [] }
}

// ───────────────────────── 진입점 ─────────────────────────

/** 마지막으로 그린 몇 개를 기억한다(본문·목차·절 미리보기가 같은 원문으로 거듭 부르므로) */
const cache: { format: DocumentFormat; source: string; result: FlowDocument }[] = []
const CACHE_SIZE = 4
const CACHE_MAX_CHARS = 2 * 1024 * 1024

export function renderFlowDocument(format: DocumentFormat, source: string): FlowDocument {
  const hit = cache.find((entry) => entry.format === format && entry.source === source)
  if (hit !== undefined) return hit.result
  let result: FlowDocument
  try {
    switch (format) {
      case 'html': result = renderHtml(source); break
      case 'xml': result = renderXml(source); break
      case 'text': result = renderText(source); break
      // PDF 는 이 길로 오지 않는다. 오더라도 Markdown 처럼 그린다
      default: result = { html: renderMarkdown(source), headings: markdownHeadings(source) }
    }
  } catch {
    // 파서 오류·스택 넘침 따위: 화면이 죽지 않게 글자 그대로 보인다
    result = plainWithNotice(source, 'failed')
  }
  // 아주 큰 원문은 기억하지 않는다(메모리)
  if (source.length <= CACHE_MAX_CHARS) {
    cache.unshift({ format, source, result })
    cache.length = Math.min(cache.length, CACHE_SIZE)
  }
  return result
}

/** 목차용 제목. Markdown 은 원문에서(예전과 같다), HTML 은 그린 본문에서 읽는다 */
export function flowHeadings(format: DocumentFormat, source: string): readonly FlowHeading[] {
  return format === 'markdown' || format === 'pdf' ? markdownHeadings(source) : renderFlowDocument(format, source).headings
}

/** 절 미리보기: h1–h3 로 나눈 절마다 제목과 첫 몇 줄 */
export function flowSectionPreviews(format: DocumentFormat, source: string, lines = 4): FlowSectionPreview[] {
  if (format === 'markdown' || format === 'pdf') return markdownSectionPreviews(source, lines)
  if (format !== 'html') return []
  const template = document.createElement('template')
  template.innerHTML = renderFlowDocument(format, source).html
  const sections: { title: string; depth: number; excerpt: string[] }[] = []
  for (const element of template.content.querySelectorAll('h1, h2, h3, p, li, blockquote, pre, td, th, dd')) {
    if (/^H[1-3]$/u.test(element.tagName)) {
      sections.push({ title: (element.textContent ?? '').replace(/\s+/gu, ' ').trim(), depth: Number(element.tagName.slice(1)), excerpt: [] })
      continue
    }
    const current = sections.at(-1)
    // 안에 또 다른 글 덩어리가 든 요소(li > p 등)는 안쪽 것만 센다
    if (current === undefined || current.excerpt.length >= lines || element.querySelector('p, li, blockquote, pre, td, th, dd') !== null) continue
    const text = (element.textContent ?? '').replace(/\s+/gu, ' ').trim()
    if (text !== '') current.excerpt.push(text)
  }
  return sections.map((section) => ({ title: section.title, depth: section.depth, excerpt: section.excerpt.join(' ') }))
}
