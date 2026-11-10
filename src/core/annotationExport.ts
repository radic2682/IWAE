import type { PdfHighlightColor, PersistentPdfHighlight } from '../pdf/persistentHighlight'
import { t } from '../i18n'

/** 기본 4색의 이모지. 내가 만든 색은 ⬜ */
const COLOR_MARK: Readonly<Record<string, string>> = {
  yellow: '🟨',
  green: '🟩',
  blue: '🟦',
  pink: '🟪',
}
const colorMark = (color: PdfHighlightColor): string => COLOR_MARK[color] ?? '⬜'

/** 쪽 순서, 같은 쪽에서는 위에서 아래로 — 문서를 읽는 순서다 */
export function sortAnnotations(highlights: readonly PersistentPdfHighlight[]): PersistentPdfHighlight[] {
  const top = (highlight: PersistentPdfHighlight) => Math.min(...highlight.anchor.rects.map((rect) => rect.y))
  return [...highlights].sort((a, b) => a.anchor.page - b.anchor.page || top(a) - top(b))
}

export interface AnnotationFilter {
  /** 비어 있으면 모든 색 */
  readonly colors: readonly PdfHighlightColor[]
  /** 인용문이나 메모에 들어 있는 글자. 대소문자를 가리지 않는다 */
  readonly query: string
}

export function filterAnnotations(
  highlights: readonly PersistentPdfHighlight[],
  filter: AnnotationFilter,
): PersistentPdfHighlight[] {
  const needle = filter.query.trim().toLocaleLowerCase('ko-KR')
  return highlights.filter((highlight) => {
    if (filter.colors.length > 0 && !filter.colors.includes(highlight.color)) return false
    if (needle === '') return true
    return highlight.anchor.quote.toLocaleLowerCase('ko-KR').includes(needle)
      || (highlight.note ?? '').toLocaleLowerCase('ko-KR').includes(needle)
  })
}

/** 인용문은 줄마다 `>` 를 붙여야 Markdown 에서 한 덩어리 인용으로 남는다 */
function quoteBlock(text: string, mark: string): string {
  const lines = text.replace(/\r\n?/gu, '\n').split('\n').map((line) => line.trim()).filter(Boolean)
  return lines.map((line, index) => index === 0 ? `${mark} > ${line}` : `> ${line}`).join('\n')
}

/** 문서 하나의 주석 요약. 쪽마다 제목을 달고, 색은 이모지로, 메모는 인용 아래 문단으로 둔다 */
export function annotationsToMarkdown(title: string, highlights: readonly PersistentPdfHighlight[]): string {
  const lines = [`# ${t('{title} — 주석', { title })}`, '']
  if (highlights.length === 0) return `${lines.join('\n')}\n_${t('주석이 없습니다.')}_\n`

  let page = -1
  for (const highlight of sortAnnotations(highlights)) {
    if (highlight.anchor.page !== page) {
      page = highlight.anchor.page
      lines.push(`## p.${page + 1}`, '')
    }
    lines.push(quoteBlock(highlight.anchor.quote, colorMark(highlight.color)), '')
    const note = highlight.note?.trim()
    if (note !== undefined && note !== '') lines.push(note.replace(/\r\n?/gu, '\n'), '')
  }
  return lines.join('\n')
}
