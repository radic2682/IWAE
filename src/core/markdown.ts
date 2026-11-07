import MarkdownIt from 'markdown-it'
import DOMPurify from 'dompurify'

/**
 * Markdown → 안전한 HTML. GitHub 문서(표·그림·HTML 조각·문서 사이 링크)를 그대로 읽을 수 있게 markdown-it 을 쓰고,
 * 결과는 DOMPurify 로 거른다(스크립트·이벤트 속성·javascript: 링크 제거).
 *
 * - 제목에는 GitHub 과 같은 규칙의 id 를 붙인다(`#section-name` 링크가 그대로 동작하게).
 * - 그림의 상대 경로는 그대로 두고 data-md-src 에도 적는다. 실제 파일은 MarkdownPane 이 읽어 붙인다
 *   (웹뷰가 디스크 파일을 직접 읽지 못한다).
 * - 바깥 링크에는 rel 을 붙인다. 누르면 무엇을 할지는 MarkdownPane 이 정한다.
 */

const parser = new MarkdownIt({ html: true, linkify: true, typographer: false, breaks: false })

/** GitHub 식 제목 id: 소문자, 기호 제거, 빈칸은 -. 같은 제목이 또 나오면 -1, -2 */
export function githubSlug(text: string, used: Map<string, number>): string {
  const base = text
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .replace(/\s/gu, '-')
  const count = used.get(base) ?? 0
  used.set(base, count + 1)
  return count === 0 ? base : `${base}-${count}`
}

const defaultImage = parser.renderer.rules.image
parser.renderer.rules.image = (tokens, index, options, env, self) => {
  const token = tokens[index]!
  const src = String(token.attrGet('src') ?? '')
  if (!/^(?:https?:|data:)/iu.test(src)) {
    // 상대 경로 그림은 웹뷰가 직접 못 읽는다. 주소는 data-md-src 로 옮기고, MarkdownPane 이 파일을 읽어 붙인다
    token.attrSet('data-md-src', src)
    token.attrs = token.attrs?.filter(([name]) => name !== 'src') ?? null
  }
  token.attrSet('loading', 'lazy')
  return defaultImage === undefined ? self.renderToken(tokens, index, options) : defaultImage(tokens, index, options, env, self)
}

parser.core.ruler.push('github_heading_ids', (state) => {
  const used = new Map<string, number>()
  state.tokens.forEach((token, index) => {
    if (token.type !== 'heading_open') return
    const inline = state.tokens[index + 1]
    const text = inline?.children?.filter((child) => child.type === 'text' || child.type === 'code_inline').map((child) => child.content).join('') ?? ''
    token.attrSet('id', githubSlug(text, used))
  })
})

const defaultLinkOpen = parser.renderer.rules.link_open
parser.renderer.rules.link_open = (tokens, index, options, env, self) => {
  const token = tokens[index]!
  if (/^(?:https?:|mailto:)/iu.test(String(token.attrGet('href') ?? ''))) token.attrSet('rel', 'noreferrer noopener')
  return defaultLinkOpen === undefined ? self.renderToken(tokens, index, options) : defaultLinkOpen(tokens, index, options, env, self)
}

// GitHub 할 일 목록: `- [ ] 할 일`, `- [x] 끝낸 일`. 입력 칸 대신 그린 네모(문서는 읽기용)
parser.core.ruler.push('github_task_lists', (state) => {
  const tokens = state.tokens
  tokens.forEach((token, index) => {
    if (token.type !== 'inline' || tokens[index - 1]?.type !== 'paragraph_open' || tokens[index - 2]?.type !== 'list_item_open') return
    const first = token.children?.[0]
    const match = first?.type === 'text' ? /^\[([ xX])\]\s+/u.exec(first.content) : null
    if (first === undefined || match === null) return
    const done = match[1] !== ' '
    first.content = first.content.slice(match[0].length)
    const box = new state.Token('html_inline', '', 0)
    box.content = `<span class="md-task-box${done ? ' md-task-done' : ''}" role="img" aria-label="${done ? 'done' : 'to do'}"></span>`
    token.children!.unshift(box)
    tokens[index - 2]!.attrJoin('class', `md-task${done ? ' md-task-checked' : ''}`)
  })
})

// 표는 넓으면 가로로 스크롤되게 감싼다
parser.renderer.rules.table_open = () => '<div class="markdown-table-wrap"><table>'
parser.renderer.rules.table_close = () => '</table></div>'

const ALLOWED_URI = /^(?:(?:https?|mailto):|#|\.{0,2}\/|[^:]*$)/iu

// HTML 조각 안의 <img src="상대 경로"> 도 같은 길로(GitHub 문서는 그림 크기를 정하려고 HTML 을 자주 쓴다)
DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (node.tagName !== 'IMG') return
  const src = node.getAttribute('src')
  if (src === null || /^(?:https?:|data:|blob:)/iu.test(src)) return
  node.setAttribute('data-md-src', src)
  node.removeAttribute('src')
})

export function renderMarkdown(markdown: string): string {
  const html = parser.render(markdown)
  return DOMPurify.sanitize(html, {
    ADD_ATTR: ['data-md-src', 'loading', 'target'],
    ALLOWED_URI_REGEXP: ALLOWED_URI,
    FORBID_TAGS: ['style', 'form', 'input', 'button', 'textarea', 'select', 'iframe', 'object', 'embed'],
  })
}

/** 링크가 가리키는 곳: 바깥 주소, 같은 문서 안 제목, 다른 문서(상대 경로) */
export type MarkdownLinkTarget =
  | { readonly kind: 'external'; readonly url: string }
  | { readonly kind: 'anchor'; readonly id: string }
  | { readonly kind: 'document'; readonly path: string; readonly anchor: string | null }

/**
 * href 를 지금 문서 경로(currentPath, '/' 구분) 기준으로 푼다. '../a.md#x' → 'docs/a.md' + 'x'.
 * 문서 바깥(Vault 위)으로 나가면 null.
 */
export function resolveMarkdownLink(href: string, currentPath: string): MarkdownLinkTarget | null {
  const target = href.trim()
  if (target === '') return null
  if (/^(?:https?:|mailto:)/iu.test(target)) return { kind: 'external', url: target }
  if (target.startsWith('#')) return { kind: 'anchor', id: decodeURIComponent(target.slice(1)) }
  if (/^[a-z][a-z0-9+.-]*:/iu.test(target)) return null
  const [rawPath = '', rawAnchor] = target.split('#', 2)
  const path = resolveRelativePath(decodeURIComponent(rawPath.split('?')[0] ?? ''), currentPath)
  if (path === null) return null
  return { kind: 'document', path, anchor: rawAnchor === undefined || rawAnchor === '' ? null : decodeURIComponent(rawAnchor) }
}

/** 상대 경로를 지금 파일의 폴더 기준으로 푼다. '/' 로 시작하면 currentPath 의 맨 위(저장소 뿌리 대신 Vault 뿌리) 기준 */
export function resolveRelativePath(relative: string, currentPath: string): string | null {
  const normalizedCurrent = currentPath.replaceAll('\\', '/')
  const baseParts = relative.startsWith('/') ? [] : normalizedCurrent.split('/').slice(0, -1)
  const parts = [...baseParts]
  for (const part of relative.replace(/^\/+/u, '').split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..') {
      if (parts.length === 0) return null
      parts.pop()
      continue
    }
    parts.push(part)
  }
  return parts.join('/')
}
