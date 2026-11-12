import type { MemoNoteBlock } from '../core/memoNote'
import type { NoteFlowItem } from './NoteFlow'
import type { PersistentPdfHighlight } from './persistentHighlight'

export interface NoteFlowItemsOptions {
  /** 형광펜 id → 형광펜 */
  readonly highlightById: ReadonlyMap<string, PersistentPdfHighlight>
  /**
   * 이 화면이 보는 문서의 id. 있으면 그 문서의 메모는 문서 이름을 달지 않고, 다른 문서의 메모만 카드 머리에 문서 이름을 단다.
   * 없으면(노트를 탭으로 열었을 때: 옆에 문서가 없다) 모든 메모가 자기 문서 이름을 단다
   */
  readonly docId?: string
  /** docId 문서의 이름(출처 칩 설명) */
  readonly title?: string
  readonly docTitles?: Readonly<Record<string, string>>
  /** 이름을 모르는 문서를 부르는 말(「다른 PDF」·「다른 문서」) */
  readonly otherLabel: string
  /** 만드는 중인 새 메모(저장 전). draftIndex 번째 블록 앞에 끼운다(없으면 맨 끝) */
  readonly draft?: PersistentPdfHighlight | null
  readonly draftIndex?: number
}

/**
 * 노트 블록들을 카드 목록(NoteFlow 의 items)으로 바꾼다. 노트 바(PDF·Markdown)와 노트 탭이 같은 규칙을 쓴다:
 * 접힌 소제목 아래 블록은 숨기고, 형광펜을 못 찾은 메모는 건너뛴다(새로 쓰는 메모는 늘 보인다).
 */
export function buildNoteFlowItems(blocks: readonly MemoNoteBlock[], options: NoteFlowItemsOptions): NoteFlowItem[] {
  const { highlightById, docId, title, docTitles, otherLabel, draft = null, draftIndex } = options
  const items: NoteFlowItem[] = []
  const draftItem = (): NoteFlowItem | null => draft === null ? null : { kind: 'memo', key: 'draft', highlight: draft, draft: true, sourceLabel: title ?? otherLabel }
  let hidden = false
  blocks.forEach((block, index) => {
    if (draftIndex === index) {
      const item = draftItem()
      if (item !== null) items.push(item)
    }
    if (block.kind === 'section') {
      hidden = block.collapsed === true
      const next = blocks.findIndex((candidate, at) => at > index && candidate.kind === 'section')
      items.push({ kind: 'section', key: block.id, title: block.title, collapsed: hidden, count: (next < 0 ? blocks.length : next) - index - 1 })
      return
    }
    if (hidden) return
    if (block.kind === 'text') {
      items.push({ kind: 'text', key: block.id, text: block.text, ...(block.html === undefined ? {} : { html: block.html }) })
      return
    }
    const highlight = highlightById.get(block.highlightId)
    if (highlight === undefined) return
    const own = docId !== undefined && highlight.anchor.docId === docId
    items.push({
      kind: 'memo',
      key: block.id,
      highlight,
      // 다른 문서의 메모: 그 문서 이름(「·」 앞의 짧은 이름)을 카드 머리에
      ...(own ? {} : { docLabel: (docTitles?.[highlight.anchor.docId] ?? otherLabel).split(' · ')[0]! }),
      sourceLabel: docTitles?.[highlight.anchor.docId] ?? (own ? title ?? otherLabel : otherLabel),
      ...(block.ticket === undefined ? {} : { ticket: block.ticket }),
      ...((block.refs ?? []).length === 0 ? {} : { extraHighlights: (block.refs ?? []).flatMap((ref) => { const found = highlightById.get(ref); return found === undefined ? [] : [found] }) }),
    })
  })
  if (draftIndex === undefined || draftIndex >= blocks.length) {
    const item = draftItem()
    if (item !== null) items.push(item)
  }
  return items
}
