/**
 * 메모 노트를 Markdown(Obsidian·Notion 이 읽는 글)으로 바꾸는 순수한 부분.
 * 파일·PDF 엔진·대화상자는 모른다 — 노트와 형광펜을 받아 글자를 돌려주므로 그대로 시험할 수 있다.
 *
 * 한 노트는 한 파일이다. 소제목은 제목(##), 티켓 ID·제목이 있는 메모는 그 아래 제목(###)이 되고,
 * 메모마다 원문은 인용(>), 그 아래에 문서 제목·쪽·돌아가는 링크, 내 메모, 번역, 영역 그림이 차례로 온다.
 */

import type { MemoNote, MemoTicket } from './memoNote'
import { memoHighlightIds, normalizeTicket } from './memoNote'
import { t } from '../i18n'
import type { PersistentPdfHighlight } from '../pdf/persistentHighlight'

/** 인용 하나(원문 + 그 출처) */
export interface MarkdownQuote {
  readonly text: string
  /** 1-기반 쪽 */
  readonly page: number
  readonly docTitle: string
  /** 파일 옆에서 그 PDF 의 그 쪽으로 가는 링크(상대 경로 + #page=). 모르면 없다 */
  readonly link?: string
  /** 영역 메모의 그림 파일(.md 기준 상대 경로) */
  readonly image?: string
}

export type MarkdownBlock =
  | {
    readonly kind: 'memo'
    readonly ticket?: MemoTicket
    readonly quotes: readonly MarkdownQuote[]
    readonly note?: string
    readonly translation?: string
    readonly topic?: string
    readonly rating?: number
  }
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'section'; readonly title: string }

export interface MarkdownNoteInput {
  readonly title: string
  readonly blocks: readonly MarkdownBlock[]
  /** 보낸 날(YYYY-MM-DD) */
  readonly exportedAt: string
}

/** 줄마다 `> ` 를 붙인다(빈 줄도 인용이 끊기지 않게) */
function blockquote(text: string): string {
  return text.replace(/\r\n?/gu, '\n').trim().split('\n').map((line) => (line.trim() === '' ? '>' : `> ${line}`)).join('\n')
}

/** 한 줄로 쓸 글(제목·표 칸)에서 줄바꿈을 걷는다 */
const oneLine = (text: string) => text.replace(/\s+/gu, ' ').trim()

const yamlString = (value: string) => JSON.stringify(value)

function ticketHeading(ticket: MemoTicket | undefined): string {
  const normalized = normalizeTicket(ticket ?? null)
  if (normalized === null) return ''
  return [normalized.id ?? '', normalized.title ?? ''].filter((part) => part !== '').map(oneLine).join(' · ')
}

function sourceLine(quote: MarkdownQuote): string {
  const where = t('p.{page}', { page: quote.page })
  const label = `${oneLine(quote.docTitle)}, ${where}`
  return quote.link === undefined ? `— ${label}` : `— [${label.replace(/[[\]]/gu, '\\$&')}](${quote.link})`
}

/** 노트 하나를 Markdown 글로. 앞머리(YAML)에 제목·문서·보낸 날이 들어간다 */
export function renderNoteMarkdown(input: MarkdownNoteInput): string {
  const documents = [...new Set(input.blocks.flatMap((block) => (block.kind === 'memo' ? block.quotes.map((quote) => quote.docTitle) : [])))]
  const out: string[] = [
    '---',
    `title: ${yamlString(input.title)}`,
    ...(documents.length === 0 ? [] : ['documents:', ...documents.map((doc) => `  - ${yamlString(doc)}`)]),
    `exported: ${input.exportedAt}`,
    'source: IWAE',
    '---',
    '',
    `# ${oneLine(input.title)}`,
    '',
  ]
  let inSection = false
  for (const block of input.blocks) {
    if (block.kind === 'section') {
      inSection = true
      out.push(`## ${oneLine(block.title) || t('(제목 없음)')}`, '')
      continue
    }
    if (block.kind === 'text') {
      if (block.text.trim() !== '') out.push(block.text.trim(), '')
      continue
    }
    const heading = ticketHeading(block.ticket)
    if (heading !== '') out.push(`${inSection ? '###' : '##'} ${heading}`, '')
    for (const quote of block.quotes) {
      if (quote.image !== undefined) out.push(`![${t('영역 그림')} ${oneLine(quote.docTitle)} p.${quote.page}](${quote.image})`, '')
      if (quote.text.trim() !== '') out.push(blockquote(quote.text), '')
      out.push(sourceLine(quote), '')
    }
    if (block.note !== undefined && block.note.trim() !== '') out.push(block.note.trim(), '')
    if (block.translation !== undefined && block.translation.trim() !== '') {
      out.push(`**${t('번역')}**`, '', blockquote(block.translation), '')
    }
    const extras = [
      block.topic === undefined || block.topic === '' ? '' : `#${block.topic.replace(/\s+/gu, '_')}`,
      block.rating === undefined ? '' : `${'★'.repeat(block.rating)}${'☆'.repeat(5 - block.rating)}`,
    ].filter((part) => part !== '')
    if (extras.length > 0) out.push(extras.join('  '), '')
  }
  return `${out.join('\n').replace(/\n{3,}/gu, '\n\n').trimEnd()}\n`
}

export interface BuildContext {
  readonly highlights: ReadonlyMap<string, PersistentPdfHighlight>
  readonly docTitle: (docId: string) => string
  /** 그 문서의 그 쪽(1-기반)으로 가는 링크. 파일 위치를 모르면 undefined */
  readonly link: (docId: string, page: number) => string | undefined
  /** 그 원문의 번역(있으면) */
  readonly translation: (quote: string) => string | undefined
  /** 영역 메모의 그림 파일. 그림을 내보내지 않으면 undefined */
  readonly image: (highlight: PersistentPdfHighlight) => string | undefined
}

/** 노트 블록과 형광펜을 내보낼 블록으로 잇는다. 지워진 형광펜을 가리키는 메모는 건너뛴다 */
export function buildMarkdownBlocks(note: MemoNote, context: BuildContext): MarkdownBlock[] {
  const blocks: MarkdownBlock[] = []
  for (const block of note.blocks) {
    if (block.kind === 'section') blocks.push({ kind: 'section', title: block.title })
    else if (block.kind === 'text') blocks.push({ kind: 'text', text: block.text })
    else {
      const highlights = memoHighlightIds(block).flatMap((id) => context.highlights.get(id) ?? [])
      const first = highlights[0]
      if (first === undefined) continue
      const quotes = highlights.map((highlight): MarkdownQuote => {
        const page = highlight.anchor.page + 1
        const link = context.link(highlight.anchor.docId, page)
        const image = highlight.kind === 'region' ? context.image(highlight) : undefined
        return {
          text: highlight.kind === 'region' ? '' : highlight.anchor.quote,
          page,
          docTitle: context.docTitle(highlight.anchor.docId),
          ...(link === undefined ? {} : { link }),
          ...(image === undefined ? {} : { image }),
        }
      })
      const translation = context.translation(first.anchor.quote)
      blocks.push({
        kind: 'memo',
        ...(block.ticket === undefined ? {} : { ticket: block.ticket }),
        quotes,
        ...(first.note === undefined ? {} : { note: first.note }),
        ...(translation === undefined || first.kind === 'region' ? {} : { translation }),
        ...(first.topic === undefined ? {} : { topic: first.topic }),
        ...(first.rating === undefined ? {} : { rating: first.rating }),
      })
    }
  }
  return blocks
}

// ───────────── 파일 이름·링크 ─────────────

/** 파일 이름으로 쓸 수 있게 다듬는다(윈도우에서 못 쓰는 글자·끝의 점·공백 제거) */
export function markdownFileStem(title: string): string {
  const cleaned = title.replace(/[\\/:*?"<>|\u0000-\u001f]/gu, '_').replace(/\s+/gu, ' ').trim().replace(/[. ]+$/u, '')
  return cleaned === '' ? t('노트') : cleaned.slice(0, 120)
}

/** 같은 이름이 있으면 ` (2)` 를 붙여 겹치지 않게 한다. taken 은 소문자로 비교한다 */
export function uniqueFileStem(stem: string, taken: ReadonlySet<string>): string {
  let candidate = stem
  for (let n = 2; taken.has(candidate.toLowerCase()); n += 1) candidate = `${stem} (${n})`
  return candidate
}

const splitPath = (path: string) => path.replaceAll('\\', '/').split('/').filter((part) => part !== '')

/** 경로 조각마다 주소로 쓸 수 있게 인코딩한다(슬래시는 그대로) */
const encodePath = (parts: readonly string[]) => parts.map((part) => /^[A-Za-z]:$/u.test(part) ? part : encodeURIComponent(part).replace(/[()]/gu, (c) => (c === '(' ? '%28' : '%29'))).join('/')

/**
 * 내보낸 .md 가 있는 폴더(fromDir)에서 그 PDF(toPath)로 가는 링크. 같은 드라이브면 상대 경로, 아니면 file:// 주소.
 * 쪽을 알면 `#page=N` 을 붙인다(대부분의 PDF 보기 프로그램이 따른다).
 */
export function relativePdfLink(fromDir: string, toPath: string, page?: number): string {
  const from = splitPath(fromDir)
  const to = splitPath(toPath)
  const suffix = page === undefined ? '' : `#page=${page}`
  const drive = (parts: readonly string[]) => (/^[A-Za-z]:$/u.test(parts[0] ?? '') ? (parts[0] ?? '').toLowerCase() : '')
  if (drive(from) !== drive(to)) {
    const prefix = toPath.startsWith('/') ? 'file://' : 'file:///'
    return `${prefix}${encodePath(to)}${suffix}`
  }
  let common = 0
  while (common < from.length && common < to.length - 1 && from[common]!.toLowerCase() === to[common]!.toLowerCase()) common += 1
  const up = Array.from({ length: from.length - common }, () => '..')
  return `${encodePath([...up, ...to.slice(common)])}${suffix}`
}
