/**
 * 문서(PDF)의 원본 출처. 한 문서에 출처를 여러 개 달 수 있다 — 클라우드 링크, 사이트, 폴더·파일 경로 등.
 * 종류를 따로 나누지 않고 target 하나로 둔다: http(s):// 로 시작하면 주소(브라우저), 아니면 경로(탐색기).
 * 저장은 `.iwae/sources.json`, 열쇠는 문서(판) id.
 */

export interface DocSource {
  readonly id: string
  /** 이름(「원본」, 「최신판」, 「벤더 포털」 …) */
  readonly label: string
  /** 주소 또는 경로 */
  readonly target: string
  readonly note?: string
  readonly addedAt: string
}

export interface DocSourcesFile {
  readonly version: 1
  readonly sources: Readonly<Record<string, readonly DocSource[]>>
}

export const EMPTY_DOC_SOURCES: DocSourcesFile = { version: 1, sources: {} }

export type SourceTargetKind = 'url' | 'path'

/** 주소인가 경로인가. mailto 같은 것은 지원하지 않는다 */
export function sourceTargetKind(target: string): SourceTargetKind {
  return /^https?:\/\//iu.test(target.trim()) ? 'url' : 'path'
}

/** 입력을 다듬는다: 앞뒤 공백·따옴표를 떼고, `www.` 로 시작하는 주소에는 https:// 를 붙인다 */
export function normalizeSourceTarget(input: string): string {
  const trimmed = input.trim().replace(/^["'“”]+|["'“”]+$/gu, '').trim()
  if (/^www\./iu.test(trimmed)) return `https://${trimmed}`
  return trimmed
}

/** 쓸 수 있는 target 인가(빈 글·위험한 프로토콜 제외) */
export function isValidSourceTarget(target: string): boolean {
  const value = target.trim()
  if (value === '' || value.length > 2000) return false
  if (/^(?:javascript|data|vbscript|file):/iu.test(value)) return false
  if (/^[a-z][a-z0-9+.-]*:\/\//iu.test(value)) return /^https?:\/\//iu.test(value)
  return true
}

/** 목록에 보일 짧은 이름: 라벨이 없으면 주소의 호스트나 경로의 마지막 이름 */
export function sourceDisplayLabel(source: Pick<DocSource, 'label' | 'target'>): string {
  if (source.label.trim() !== '') return source.label.trim()
  if (sourceTargetKind(source.target) === 'url') {
    try { return new URL(source.target).host } catch { /* 아래로 */ }
  }
  return source.target.replaceAll('\\', '/').replace(/\/+$/u, '').split('/').at(-1) ?? source.target
}

let counter = 0
export function newSourceId(): string {
  counter += 1
  return `s${Date.now().toString(36)}${counter.toString(36)}${Math.random().toString(36).slice(2, 5)}`
}

export function createDocSource(input: { label?: string; target: string; note?: string }, now: Date = new Date()): DocSource {
  const note = input.note?.trim()
  return {
    id: newSourceId(),
    label: (input.label ?? '').trim(),
    target: normalizeSourceTarget(input.target),
    ...(note === undefined || note === '' ? {} : { note }),
    addedAt: now.toISOString(),
  }
}

/** 같은 주소가 이미 있으면 더하지 않는다(대소문자·끝 슬래시 무시). 바뀌지 않으면 같은 객체 */
export function addSource(list: readonly DocSource[], source: DocSource): readonly DocSource[] {
  const key = comparable(source.target)
  return list.some((item) => comparable(item.target) === key) ? list : [...list, source]
}

function comparable(target: string): string {
  return target.trim().replaceAll('\\', '/').replace(/\/+$/u, '').toLowerCase()
}

export function parseDocSources(value: unknown): DocSourcesFile {
  if (typeof value !== 'object' || value === null) return EMPTY_DOC_SOURCES
  const raw = (value as { sources?: unknown }).sources
  if (typeof raw !== 'object' || raw === null) return EMPTY_DOC_SOURCES
  const sources: Record<string, DocSource[]> = {}
  for (const [docId, list] of Object.entries(raw)) {
    if (!Array.isArray(list)) continue
    const items = list.flatMap((item: unknown): DocSource[] => {
      if (typeof item !== 'object' || item === null) return []
      const { id, label, target, note, addedAt } = item as Record<string, unknown>
      if (typeof target !== 'string' || !isValidSourceTarget(target)) return []
      return [{
        id: typeof id === 'string' && id !== '' ? id : newSourceId(),
        label: typeof label === 'string' ? label : '',
        target,
        ...(typeof note === 'string' && note !== '' ? { note } : {}),
        addedAt: typeof addedAt === 'string' ? addedAt : new Date(0).toISOString(),
      }]
    })
    if (items.length > 0) sources[docId] = items
  }
  return { version: 1, sources }
}
