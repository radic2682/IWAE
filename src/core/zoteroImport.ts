/**
 * Zotero 가져오기의 순수한 부분. Rust(`zotero_read`)가 Zotero 데이터 폴더에서 읽어 온 JSON 을
 * 다듬고, 서지 정보·Vault 폴더·주석 → 형광펜 변환을 정한다. 파일·PDF 엔진은 모른다.
 */

import { buildAnchor } from './anchor'
import type { BibEntry } from './bibliography'
import { DEFAULT_HIGHLIGHT_COLORS, nearestColorId, type HighlightColorDef } from './highlightColors'
import type { PageTextIndex } from './textIndex'
import { createPersistentPdfHighlight, type PersistentPdfHighlight } from '../pdf/persistentHighlight'

export interface ZoteroAnnotation {
  readonly kind: 'highlight' | 'underline' | 'note' | 'image' | 'ink' | 'other'
  readonly text?: string
  readonly comment?: string
  /** #rrggbb */
  readonly color?: string
  readonly pageLabel?: string
  /** 0-기반 */
  readonly pageIndex?: number
}

export interface ZoteroAttachment {
  readonly key: string
  /** 파일이 실제로 있는 절대 경로. 없으면 undefined */
  readonly path?: string
  readonly fileName: string
  readonly annotations: readonly ZoteroAnnotation[]
}

export interface ZoteroItem {
  readonly key: string
  readonly itemType: string
  readonly title?: string
  readonly authors: readonly string[]
  readonly year?: number
  readonly doi?: string
  readonly journal?: string
  readonly collections: readonly string[]
  readonly attachments: readonly ZoteroAttachment[]
  readonly notes: readonly string[]
}

export interface ZoteroLibrary {
  readonly dataDir: string
  readonly items: readonly ZoteroItem[]
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const str = (value: unknown): string | undefined => (typeof value === 'string' && value.trim() !== '' ? value : undefined)
const strings = (value: unknown): string[] => (Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item.trim() !== '') : [])

const KINDS = new Set(['highlight', 'underline', 'note', 'image', 'ink'])

function parseAnnotation(value: unknown): ZoteroAnnotation | null {
  if (!isRecord(value)) return null
  const kind = typeof value.kind === 'string' && KINDS.has(value.kind) ? (value.kind as ZoteroAnnotation['kind']) : 'other'
  const text = str(value.text)
  const comment = str(value.comment)
  const color = str(value.color)
  const pageLabel = str(value.pageLabel)
  return {
    kind,
    ...(text === undefined ? {} : { text }),
    ...(comment === undefined ? {} : { comment }),
    ...(color === undefined ? {} : { color }),
    ...(pageLabel === undefined ? {} : { pageLabel }),
    ...(typeof value.pageIndex === 'number' && Number.isInteger(value.pageIndex) && value.pageIndex >= 0 ? { pageIndex: value.pageIndex } : {}),
  }
}

/** Rust 가 준 값을 믿지 않고 모양을 확인해 읽는다 */
export function parseZoteroLibrary(value: unknown): ZoteroLibrary {
  if (!isRecord(value) || !Array.isArray(value.items)) return { dataDir: '', items: [] }
  const items = value.items.flatMap((raw: unknown): ZoteroItem[] => {
    if (!isRecord(raw) || typeof raw.key !== 'string') return []
    const attachments = (Array.isArray(raw.attachments) ? raw.attachments : []).flatMap((entry: unknown): ZoteroAttachment[] => {
      if (!isRecord(entry) || typeof entry.key !== 'string') return []
      const path = str(entry.path)
      return [{
        key: entry.key,
        ...(path === undefined ? {} : { path }),
        fileName: typeof entry.fileName === 'string' ? entry.fileName : '',
        annotations: (Array.isArray(entry.annotations) ? entry.annotations : []).flatMap((item: unknown) => parseAnnotation(item) ?? []),
      }]
    })
    const title = str(raw.title)
    const doi = str(raw.doi)
    const journal = str(raw.journal)
    return [{
      key: raw.key,
      itemType: typeof raw.itemType === 'string' ? raw.itemType : '',
      ...(title === undefined ? {} : { title }),
      authors: strings(raw.authors),
      ...(typeof raw.year === 'number' && Number.isFinite(raw.year) ? { year: raw.year } : {}),
      ...(doi === undefined ? {} : { doi }),
      ...(journal === undefined ? {} : { journal }),
      collections: strings(raw.collections),
      attachments,
      notes: strings(raw.notes),
    }]
  })
  return { dataDir: typeof value.dataDir === 'string' ? value.dataDir : '', items }
}

/** Vault 안에서 Zotero 항목을 둘 폴더: 「Zotero/컬렉션 경로」. 컬렉션이 없으면 「Zotero」 */
export const ZOTERO_ROOT_FOLDER = 'Zotero'

function folderPart(name: string): string {
  return name.replace(/[<>:"|?*\\/\u0000-\u001f]/gu, '_').replace(/\s+/gu, ' ').trim().replace(/[. ]+$/u, '')
}

/** 항목의 첫 컬렉션을 폴더로. 컬렉션이 여럿이면 첫 번째(가나다순)에 한 번만 복사한다 */
export function zoteroFolderFor(item: ZoteroItem): string {
  const first = item.collections[0]
  const parts = first === undefined ? [] : first.split('/').map(folderPart).filter((part) => part !== '' && part !== '.' && part !== '..')
  return [ZOTERO_ROOT_FOLDER, ...parts].join('/')
}

/** 서지 항목. 사람이 입력한 값처럼 다뤄 PDF 에서 자동으로 뽑은 값이 덮지 못하게 한다 */
export function zoteroBibEntry(item: ZoteroItem, now: string): BibEntry {
  return {
    ...(item.title === undefined ? {} : { title: item.title }),
    authors: item.authors,
    ...(item.year === undefined ? {} : { year: item.year }),
    ...(item.doi === undefined ? {} : { doi: item.doi }),
    ...(item.journal === undefined ? {} : { journal: item.journal }),
    source: 'manual',
    updatedAt: now,
  }
}

const HEX = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/iu

/** Zotero 주석 색(#rrggbb)과 가장 가까운 내 형광펜 색. 모르는 색은 첫 색 */
export function zoteroColorId(color: string | undefined, colors: readonly HighlightColorDef[] = DEFAULT_HIGHLIGHT_COLORS): string {
  const match = color === undefined ? null : HEX.exec(color.trim())
  return nearestColorId(colors, match === null ? null : [parseInt(match[1]!, 16), parseInt(match[2]!, 16), parseInt(match[3]!, 16)])
}

/** 띄어쓰기·줄바꿈·하이픈 줄바꿈 차이를 무시하려고 글자(공백 아님)만 모아 위치를 기억한다 */
function squeeze(text: string): { readonly flat: string; readonly at: readonly number[] } {
  const chars: string[] = []
  const at: number[] = []
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]!
    if (/\s/u.test(ch) || ch === '­') continue
    chars.push(ch.toLowerCase())
    at.push(i)
  }
  return { flat: chars.join(''), at }
}

/** 쪽 글자에서 주석 글을 찾아 `[시작, 끝)` 을 돌려준다. 공백·줄바꿈이 달라도 찾고, 못 찾으면 null */
export function findTextRange(index: PageTextIndex, text: string): [number, number] | null {
  const wanted = squeeze(text).flat
  if (wanted === '') return null
  const page = squeeze(index.text)
  const found = page.flat.indexOf(wanted)
  if (found < 0) return null
  const start = page.at[found]
  const end = page.at[found + wanted.length - 1]
  if (start === undefined || end === undefined) return null
  return [start, end + 1]
}

/** 이 글이 쪽 안에서 처음 찾아지는 자리부터 줄글 전체가 하이픈 줄바꿈으로 쪼개진 경우를 위한 한 번 더: 앞 40자만으로 찾는다 */
function findLooseRange(index: PageTextIndex, text: string): [number, number] | null {
  const exact = findTextRange(index, text)
  if (exact !== null) return exact
  const wanted = squeeze(text).flat
  if (wanted.length < 60) return null
  const head = findTextRange(index, text.trim().slice(0, 40))
  const tail = findTextRange(index, text.trim().slice(-40))
  return head !== null && tail !== null && tail[1] > head[0] && tail[1] - head[0] < text.length * 2 ? [head[0], tail[1]] : null
}

export interface ConvertedAnnotations {
  readonly highlights: readonly PersistentPdfHighlight[]
  /** 형광펜으로 바꾸지 못해 노트에 글로만 남길 것 */
  readonly memos: readonly string[]
  /** 그림·잉크처럼 글이 없어 가져오지 않은 수 */
  readonly skipped: number
}

/**
 * 첨부 PDF 한 권의 Zotero 주석을 바꾼다. 글이 쪽에서 찾아지면 그 자리의 형광펜(메모는 댓글)으로,
 * 못 찾거나 글 층이 없으면 「p.N 인용 + 댓글」 글로만 남긴다.
 */
export function convertZoteroAnnotations(
  docId: string,
  annotations: readonly ZoteroAnnotation[],
  pageIndexFor: (page: number) => PageTextIndex | null,
  colors: readonly HighlightColorDef[] = DEFAULT_HIGHLIGHT_COLORS,
  now: string = new Date().toISOString(),
): ConvertedAnnotations {
  const highlights: PersistentPdfHighlight[] = []
  const memos: string[] = []
  const seen = new Set<string>()
  let skipped = 0
  for (const annotation of annotations) {
    const where = annotation.pageLabel ?? (annotation.pageIndex === undefined ? '' : String(annotation.pageIndex + 1))
    const label = where === '' ? '' : `p.${where}`
    if (annotation.kind === 'note') {
      if (annotation.comment !== undefined) memos.push([label, annotation.comment].filter((part) => part !== '').join(' — '))
      else skipped += 1
      continue
    }
    if (annotation.kind !== 'highlight' && annotation.kind !== 'underline') { skipped += 1; continue }
    if (annotation.text === undefined) { skipped += 1; continue }
    const index = annotation.pageIndex === undefined ? null : pageIndexFor(annotation.pageIndex)
    const range = index === null ? null : findLooseRange(index, annotation.text)
    if (index !== null && range !== null && annotation.pageIndex !== undefined) {
      const highlight = createPersistentPdfHighlight(
        buildAnchor(docId, annotation.pageIndex, index, range[0], range[1]),
        zoteroColorId(annotation.color, colors),
        { ...(annotation.comment === undefined ? {} : { note: annotation.comment }), createdAt: now, source: 'imported' },
      )
      if (seen.has(highlight.id)) { skipped += 1; continue }
      seen.add(highlight.id)
      highlights.push(highlight)
    } else {
      memos.push([label, `“${annotation.text.replace(/\s+/gu, ' ').trim()}”`, annotation.comment ?? ''].filter((part) => part !== '').join(' — '))
    }
  }
  return { highlights, memos, skipped }
}
