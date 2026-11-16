import type { DocumentFormat } from './documentFormat'

/**
 * 검색용 글 뽑기. 화면에 그리는 flowRender 와 달리 DOMPurify 를 쓰지 않아(미리 읽는 파일이 많다) Vault 의 읽기 길에서 가볍게 부른다.
 */

const XHTML_NS = 'http://www.w3.org/1999/xhtml'

/** 읽기 화면에 필요 없거나 위험해서 통째로 지우는 요소 */
export const DROP_SELECTOR = [
  'script', 'style', 'link', 'meta', 'noscript', 'template', 'base', 'title', 'head',
  'form', 'input', 'button', 'select', 'option', 'optgroup', 'textarea', 'datalist', 'output',
  'iframe', 'frame', 'frameset', 'object', 'embed', 'applet', 'portal', 'fencedframe',
  'svg', 'math', 'canvas', 'video', 'audio', 'source', 'track', 'picture', 'map', 'area',
  'dialog', '[hidden]',
  // 사이트 메뉴(읽을 글이 아니다). header·footer·aside 는 남긴다
  'nav',
].join(', ')

export function hasParserError(doc: Document): boolean {
  if (doc.documentElement === null || doc.documentElement.localName === 'parsererror') return true
  // 브라우저는 깨진 XML 이면 파서 오류 요소를 (XHTML 이름공간으로) 문서 안에 끼워 넣는다
  for (const element of doc.getElementsByTagName('parsererror')) {
    if (element.namespaceURI === XHTML_NS) return true
  }
  return false
}

// ───────────────────────── 검색용 글 ─────────────────────────

const BLOCK_SELECTOR = 'p, div, li, tr, br, h1, h2, h3, h4, h5, h6, blockquote, pre, table, section, article, dd, dt, figcaption, hr'

/**
 * Vault 검색에 넣을 글. HTML·XML 은 태그가 아니라 눈에 보이는 글만 뽑는다(스크립트·스타일은 뺀다).
 * XML 은 글 마디와 속성값(RAG 와 같다). Markdown·텍스트는 원문 그대로다.
 * 그리는 것(DOMPurify)까지는 하지 않는다: 미리 읽는 파일이 많아 가볍게 만든다.
 */
export function flowPlainText(format: DocumentFormat, source: string): string {
  try {
    if (format === 'html') return htmlPlainText(source)
    if (format === 'xml') return xmlPlainText(source)
  } catch {
    // 못 읽으면 원문을 쓴다
  }
  return source
}

function htmlPlainText(source: string): string {
  const doc = new DOMParser().parseFromString(source, 'text/html')
  const body = doc.body ?? doc.documentElement
  for (const element of [...body.querySelectorAll(DROP_SELECTOR)]) element.remove()
  for (const element of body.querySelectorAll(BLOCK_SELECTOR)) element.append(doc.createTextNode('\n'))
  const title = (doc.title ?? '').replace(/\s+/gu, ' ').trim()
  const text = (body.textContent ?? '').replace(/[^\S\n]+/gu, ' ').replace(/ ?\n[ \n]*/gu, '\n').trim()
  return title !== '' && !text.includes(title) ? `${title}\n${text}` : text
}

function xmlPlainText(source: string): string {
  const text = source.charCodeAt(0) === 0xfeff ? source.slice(1) : source
  const doc = new DOMParser().parseFromString(text, 'application/xml')
  if (hasParserError(doc)) return source
  const parts: string[] = []
  // 재귀 없이 걷는다(아주 깊은 XML 에서도 스택이 넘치지 않게)
  const walker = doc.createTreeWalker(doc, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT | NodeFilter.SHOW_CDATA_SECTION)
  while (walker.nextNode()) {
    const node = walker.currentNode
    if (node.nodeType === Node.ELEMENT_NODE) {
      for (const attribute of (node as Element).attributes) if (attribute.value.trim() !== '') parts.push(attribute.value)
    } else {
      const value = (node.nodeValue ?? '').trim()
      if (value !== '') parts.push(value)
    }
  }
  return parts.join('\n')
}
