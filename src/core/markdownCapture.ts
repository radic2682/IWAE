import { t } from '../i18n'

export interface MarkdownCaptureAnchor {
  readonly startOffset: number
  readonly endOffset: number
}

export interface MarkdownCaptureBlockData {
  readonly sourceFileId: string
  readonly sourceHash: string
  readonly anchor: MarkdownCaptureAnchor
  readonly plainText: string
  readonly renderedSnapshot: string
  readonly width: number
  readonly height: number
  readonly aspectRatio: number
}

export type MarkdownCaptureInput = Omit<MarkdownCaptureBlockData, 'renderedSnapshot' | 'aspectRatio'> & {
  readonly renderedSnapshot: string
}

const ALLOWED_TAGS = new Set([
  'A', 'BLOCKQUOTE', 'BR', 'CODE', 'DEL', 'DIV', 'EM', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
  'HR', 'IMG', 'LI', 'OL', 'P', 'PRE', 'S', 'SPAN', 'STRONG', 'TABLE', 'TBODY', 'TD', 'TH', 'THEAD', 'TR', 'UL',
])
const DROP_CONTENT_TAGS = new Set(['FORM', 'IFRAME', 'OBJECT', 'SCRIPT', 'STYLE'])
const ALLOWED_ATTRIBUTES = new Set(['alt', 'class', 'colspan', 'href', 'rowspan', 'src', 'title'])

function safeUrl(value: string): boolean {
  const normalized = value.trim().toLocaleLowerCase()
  return normalized.startsWith('#')
    || normalized.startsWith('/')
    || normalized.startsWith('./')
    || normalized.startsWith('../')
    || normalized.startsWith('iwae-asset:')
    || normalized.startsWith('data:image/')
}

export function sanitizeRenderSnapshot(html: string): string {
  const template = document.createElement('template')
  template.innerHTML = html
  const visit = (parent: ParentNode) => {
    for (const child of [...parent.childNodes]) {
      if (child.nodeType !== Node.ELEMENT_NODE) continue
      const element = child as HTMLElement
      if (DROP_CONTENT_TAGS.has(element.tagName)) {
        element.remove()
        continue
      }
      if (!ALLOWED_TAGS.has(element.tagName)) {
        element.replaceWith(...element.childNodes)
        visit(parent)
        continue
      }
      for (const attribute of [...element.attributes]) {
        const name = attribute.name.toLocaleLowerCase()
        if (!ALLOWED_ATTRIBUTES.has(name)
          || ((name === 'href' || name === 'src') && !safeUrl(attribute.value))) {
          element.removeAttribute(attribute.name)
        }
      }
      visit(element)
    }
  }
  visit(template.content)
  return template.innerHTML
}

export function createMarkdownCapture(input: MarkdownCaptureInput): MarkdownCaptureBlockData {
  if (input.width <= 0 || input.height <= 0) throw new Error(t('Markdown 캡처 크기가 올바르지 않습니다.'))
  return {
    ...input,
    renderedSnapshot: sanitizeRenderSnapshot(input.renderedSnapshot),
    aspectRatio: input.width / input.height,
  }
}

export function isMarkdownCaptureStale(capture: MarkdownCaptureBlockData, currentHash: string): boolean {
  return capture.sourceHash !== currentHash
}

export function isMarkdownCaptureBlockData(value: unknown): value is MarkdownCaptureBlockData {
  if (typeof value !== 'object' || value === null) return false
  const capture = value as Partial<MarkdownCaptureBlockData>
  return typeof capture.sourceFileId === 'string'
    && typeof capture.sourceHash === 'string'
    && typeof capture.plainText === 'string'
    && typeof capture.renderedSnapshot === 'string'
    && typeof capture.width === 'number' && capture.width > 0
    && typeof capture.height === 'number' && capture.height > 0
    && typeof capture.aspectRatio === 'number' && capture.aspectRatio > 0
    && typeof capture.anchor === 'object' && capture.anchor !== null
    && Number.isInteger(capture.anchor.startOffset)
    && Number.isInteger(capture.anchor.endOffset)
}

export function markdownSourceHash(source: string): string {
  let hash = 2166136261
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}
