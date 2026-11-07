import { useSyncExternalStore } from 'react'
import { EN } from './en'
import { platformShortcut } from '../core/platform'

/**
 * 화면 글의 언어(한국어 · 영어).
 *
 * 앱의 글은 한국어로 쓰여 있고, 그 한국어 문장을 그대로 열쇠로 쓴다: `t('메모 쓰기')`.
 * 영어일 때는 `en/` 사전에서 같은 문장을 찾고, 없으면 한국어를 그대로 보인다(빠뜨린 번역이 화면을 깨지 않게).
 * 값이 들어가는 글은 `{이름}` 자리를 쓴다: `t('{count}개', { count: 3 })`.
 *
 * 언어는 처음 켤 때 정한다: 설정에서 고른 값 → 설치할 때 고른 언어 → 운영체제 언어.
 * 바꾸면 앱을 다시 시작해야 모든 화면에 걸린다(설정 화면이 다시 시작을 권한다).
 */
export type Locale = 'ko' | 'en'
export type LocalePreference = Locale | 'system'

export const LOCALE_STORAGE_KEY = 'iwae:locale:v1'

type Vars = Readonly<Record<string, string | number>>

function systemLocale(): Locale {
  const languages = typeof navigator === 'undefined' ? [] : [...(navigator.languages ?? []), navigator.language]
  return languages.some((language) => typeof language === 'string' && language.toLowerCase().startsWith('ko')) ? 'ko' : 'en'
}

export function readLocalePreference(): LocalePreference | null {
  try {
    const saved = globalThis.localStorage?.getItem(LOCALE_STORAGE_KEY)
    return saved === 'ko' || saved === 'en' || saved === 'system' ? saved : null
  } catch {
    return null
  }
}

export function resolveLocale(preference: LocalePreference | null, installer: Locale | null = null): Locale {
  if (preference === 'ko' || preference === 'en') return preference
  if (preference === 'system') return systemLocale()
  return installer ?? systemLocale()
}

let current: Locale = resolveLocale(readLocalePreference())
const listeners = new Set<() => void>()

export function getLocale(): Locale {
  return current
}

export function setLocale(locale: Locale): void {
  if (locale === current) return
  current = locale
  if (typeof document !== 'undefined') document.documentElement.lang = locale
  for (const listener of listeners) listener()
}

/** 설정에서 고른 값을 남긴다. 화면 전체에는 다시 시작한 뒤 걸린다 */
export function saveLocalePreference(preference: LocalePreference): void {
  try {
    globalThis.localStorage?.setItem(LOCALE_STORAGE_KEY, preference)
  } catch {
    // 이번 실행에만
  }
}

export function useLocale(): Locale {
  return useSyncExternalStore((listener) => {
    listeners.add(listener)
    return () => listeners.delete(listener)
  }, getLocale, getLocale)
}

function fill(template: string, vars?: Vars): string {
  if (vars === undefined) return template
  return template.replace(/\{(\w+)\}/gu, (whole, name: string) => (name in vars ? String(vars[name]) : whole))
}

/** 한국어 문장 → 지금 언어의 문장. 글 안의 단축키(`Ctrl+F` 등)는 맥에서 `⌘F` 처럼 바꿔 보인다 */
export function t(korean: string, vars?: Vars): string {
  if (current === 'ko') return platformShortcut(fill(korean, vars))
  return platformShortcut(fill(EN[korean] ?? korean, vars))
}

/** 날짜·시각을 보일 때 쓰는 지역 이름(정렬은 이것과 상관없이 ko-KR 로 둔다) */
export function dateLocale(): string {
  return current === 'en' ? 'en-US' : 'ko-KR'
}

/** 언어마다 다른 값을 바로 고른다(문장 조립이 언어마다 다를 때) */
export function pick<T>(values: { readonly ko: T; readonly en: T }): T {
  return values[current]
}
