import { t } from '../i18n'

/**
 * 세션 이름과 목록 메타(docs/design/workspace-tmux.md 6). 세션은 Vault 의 `.iwae/sessions/<이름>.json` 에 있고,
 * 마지막으로 쓴 세션과 세션별 마지막 사용 시각은 `.iwae/sessions/_last.json` 에 있다. DOM·파일을 모르는 순수 함수만 둔다.
 */

export const SESSIONS_DIR = 'sessions'
export const SESSIONS_META_FILE = '_last.json'
export const MAX_SESSION_NAME_LENGTH = 60

/** 파일 이름에 못 쓰는 글자(경로 구분자 포함)와 제어 문자 */
// eslint-disable-next-line no-control-regex
const FORBIDDEN = /[\\/:*?"<>|\u0000-\u001f]/u

export type SessionNameCheck =
  | { readonly ok: true; readonly name: string }
  | { readonly ok: false; readonly reason: string }

const same = (a: string, b: string) => a.toLocaleLowerCase() === b.toLocaleLowerCase()

/**
 * 이름을 검사한다: 앞뒤 빈칸을 자르고, 비었거나 경로 구분자·파일 이름에 못 쓰는 글자·`.` 로 시작·`_` 로 시작(내부 파일용)이거나
 * 너무 길면 막는다. 이미 있는 이름(대소문자 무시 — Windows 파일 이름이 그렇다)도 막되, except(이름 바꾸기에서 자기 자신)는 허용한다.
 */
export function validateSessionName(raw: string, existing: readonly string[], except?: string): SessionNameCheck {
  const name = raw.trim()
  if (name === '') return { ok: false, reason: t('세션 이름을 쓰세요') }
  if (FORBIDDEN.test(name)) return { ok: false, reason: t('세션 이름에는 / \\ : * ? " < > | 를 쓸 수 없습니다') }
  if (name.startsWith('.') || name.startsWith('_')) return { ok: false, reason: t('세션 이름은 . 이나 _ 로 시작할 수 없습니다') }
  if ([...name].length > MAX_SESSION_NAME_LENGTH) return { ok: false, reason: t('세션 이름이 너무 깁니다 ({max}자까지)', { max: MAX_SESSION_NAME_LENGTH }) }
  if (existing.some((candidate) => same(candidate, name) && (except === undefined || !same(except, candidate)))) {
    return { ok: false, reason: t('같은 이름의 세션이 이미 있습니다: {name}', { name }) }
  }
  return { ok: true, name }
}

/** 이미 있는 이름과 겹치지 않는 이름(`base`, `base 2`, `base 3` …) */
export function uniqueSessionName(base: string, existing: readonly string[]): string {
  const root = base.trim() === '' ? t('세션') : base.trim()
  if (!existing.some((candidate) => same(candidate, root))) return root
  for (let index = 2; ; index += 1) {
    const candidate = `${root} ${index}`
    if (!existing.some((other) => same(other, candidate))) return candidate
  }
}

/** 이름으로 이미 있는 세션을 찾는다(대소문자 무시). 없으면 null */
export function findSessionName(names: readonly string[], query: string): string | null {
  const text = query.trim()
  return names.find((name) => same(name, text)) ?? null
}

/** `_last.json`: 마지막으로 쓴 세션과 세션별 마지막 사용 시각(ms) */
export interface SessionsMeta {
  readonly last: string | null
  readonly used: Readonly<Record<string, number>>
}

export const emptySessionsMeta: SessionsMeta = { last: null, used: {} }

export function parseSessionsMeta(raw: unknown): SessionsMeta {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return emptySessionsMeta
  const record = raw as Record<string, unknown>
  const used: Record<string, number> = {}
  if (typeof record.used === 'object' && record.used !== null && !Array.isArray(record.used)) {
    for (const [name, value] of Object.entries(record.used)) if (typeof value === 'number' && Number.isFinite(value)) used[name] = value
  }
  return { last: typeof record.last === 'string' && record.last !== '' ? record.last : null, used }
}

/** 이 세션을 마지막으로 쓴 것으로 적는다 */
export function touchSessionMeta(meta: SessionsMeta, name: string, now: number): SessionsMeta {
  return { last: name, used: { ...meta.used, [name]: now } }
}

/** 이름이 바뀌었다(또는 갈래를 만들었다): from 의 시각을 to 로 옮긴다 */
export function renameInMeta(meta: SessionsMeta, from: string, to: string): SessionsMeta {
  const { [from]: moved, ...rest } = meta.used
  return { last: meta.last === from ? to : meta.last, used: moved === undefined ? rest : { ...rest, [to]: moved } }
}

export function removeFromMeta(meta: SessionsMeta, name: string): SessionsMeta {
  const { [name]: _gone, ...rest } = meta.used
  return { last: meta.last === name ? null : meta.last, used: rest }
}

/** 세션 목록의 한 줄 */
export interface SessionSummary {
  readonly name: string
  readonly screenCount: number
  /** 마지막으로 쓴 시각(ms). 모르면 null */
  readonly lastUsedAt: number | null
}

/** 「3분 전」 같은 짧은 말(목록용). now 를 받아 시험하기 쉽게 */
export function relativeTimeText(at: number | null, now: number): string {
  if (at === null) return ''
  const seconds = Math.max(0, Math.round((now - at) / 1000))
  if (seconds < 60) return t('방금')
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return t('{n}분 전', { n: minutes })
  const hours = Math.round(minutes / 60)
  if (hours < 24) return t('{n}시간 전', { n: hours })
  return t('{n}일 전', { n: Math.round(hours / 24) })
}
