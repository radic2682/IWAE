import { insertBlock, sectionRange, type MemoNote, type MemoNoteBlock } from '../../core/memoNote'

/** 블록을 끼울 자리. 아무것도 없으면 맨 끝 */
export interface BlockPosition {
  readonly before?: string
  readonly after?: string
  /** 그 소제목 묶음의 끝 */
  readonly section_id?: string
  /** 0부터 */
  readonly index?: number
  readonly to_end?: boolean
}

export function parsePosition(raw: unknown): BlockPosition | undefined {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return undefined
  const source = raw as Record<string, unknown>
  const position: { -readonly [K in keyof BlockPosition]: BlockPosition[K] } = {}
  if (typeof source.before === 'string' && source.before !== '') position.before = source.before
  if (typeof source.after === 'string' && source.after !== '') position.after = source.after
  if (typeof source.section_id === 'string' && source.section_id !== '') position.section_id = source.section_id
  if (typeof source.index === 'number' && Number.isFinite(source.index)) position.index = Math.trunc(source.index)
  if (source.to_end === true) position.to_end = true
  return Object.keys(position).length === 0 ? undefined : position
}

/** 노트 안의 자리(끼울 칸)를 정한다. 없는 블록을 가리키면 오류 */
export function resolveIndex(note: MemoNote, position: BlockPosition | undefined): number {
  const length = note.blocks.length
  if (position === undefined || position.to_end === true) return length
  const find = (id: string, what: string): number => {
    const at = note.blocks.findIndex((block) => block.id === id)
    if (at < 0) throw new Error(`${what} 블록을 찾지 못했습니다(block not found): ${id}. note_read로 블록 id를 확인하세요.`)
    return at
  }
  if (position.before !== undefined) return find(position.before, 'before')
  if (position.after !== undefined) return find(position.after, 'after') + 1
  if (position.section_id !== undefined) {
    const range = sectionRange(note, position.section_id)
    if (range === null) throw new Error(`section_id가 소제목이 아닙니다(not a section): ${position.section_id}`)
    return range[1]
  }
  if (position.index !== undefined) return Math.min(Math.max(position.index, 0), length)
  return length
}

/**
 * 블록들을 차례대로 한 자리에 끼운다(입력 차례 = 노트 차례). 같은 메모가 이미 노트에 있으면 그 블록은 끼우지 않는다.
 */
export function insertBlocks(note: MemoNote, blocks: readonly MemoNoteBlock[], position: BlockPosition | undefined): { note: MemoNote; inserted: MemoNoteBlock[]; duplicates: MemoNoteBlock[] } {
  let at = resolveIndex(note, position)
  let next = note
  const inserted: MemoNoteBlock[] = []
  const duplicates: MemoNoteBlock[] = []
  for (const block of blocks) {
    const before = next
    next = insertBlock(next, block, at)
    if (next === before) {
      duplicates.push(block)
    } else {
      inserted.push(block)
      at += 1
    }
  }
  return { note: next, inserted, duplicates }
}

/** 블록이 속한 소제목(없으면 null) */
export function sectionIdOf(note: MemoNote, index: number): string | null {
  for (let at = index; at >= 0; at -= 1) {
    const block = note.blocks[at]
    if (block?.kind === 'section') return block.id
  }
  return null
}
