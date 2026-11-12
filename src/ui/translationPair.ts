import { useSyncExternalStore } from 'react'

/**
 * 번역 언어 쌍의 원문 쪽. 도착 언어는 번역 설정의 「번역 언어」(translation settings 저장소)가 그대로 맡고,
 * 여기서는 원문 언어만 따로 기억한다(localStorage `iwae:translation-source:v1`). 'auto' = 자동 감지(글자로 어림).
 */
export const AUTO_SOURCE = 'auto'
const STORAGE_KEY = 'iwae:translation-source:v1'

function read(): string {
  try {
    const value = window.localStorage.getItem(STORAGE_KEY)
    return value !== null && value !== '' ? value : AUTO_SOURCE
  } catch {
    return AUTO_SOURCE
  }
}

let current = read()
const listeners = new Set<() => void>()

export function getTranslationSource(): string {
  return current
}

export function setTranslationSource(code: string): void {
  if (code === current) return
  current = code
  try { window.localStorage.setItem(STORAGE_KEY, code) } catch { /* 이번 실행에만 */ }
  for (const listener of listeners) listener()
}

/** 저장된 값을 다시 읽는다(시험용: 앱을 다시 켠 것처럼) */
export function reloadTranslationSource(): void {
  current = read()
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

export function useTranslationSource(): string {
  return useSyncExternalStore(subscribe, getTranslationSource, getTranslationSource)
}

export interface LanguagePair {
  readonly source: string
  readonly target: string
}

/**
 * 원문·번역 언어를 맞바꾼다. 원문이 자동이면 글자로 어림한 언어(detected)가 새 번역 언어가 되고,
 * 어림하지 못하면(또는 번역 언어와 같으면) null(바꿀 수 없다).
 */
export function swapPair(source: string, target: string, detected: string | null): LanguagePair | null {
  if (source === AUTO_SOURCE) {
    if (detected === null || detected === target) return null
    return { source: target, target: detected }
  }
  return { source: target, target: source }
}

/** 원문을 고른다. 번역 언어와 같아지면 번역 언어를 이전 원문(자동이면 다른 언어)으로 옮긴다 */
export function pickSource(pair: LanguagePair, code: string): LanguagePair {
  if (code !== AUTO_SOURCE && code === pair.target) {
    const target = pair.source !== AUTO_SOURCE ? pair.source : code === 'ko' ? 'en' : 'ko'
    return { source: code, target }
  }
  return { source: code, target: pair.target }
}

/** 번역 언어를 고른다. 원문과 같아지면 원문을 이전 번역 언어로 옮긴다(맞바꿈) */
export function pickTarget(pair: LanguagePair, code: string): LanguagePair {
  if (code === pair.source) return { source: pair.target, target: code }
  return { source: pair.source, target: code }
}

/** 번역에 쓰는 언어(설정의 「번역 언어」와 같은 목록). 이름은 그 나라 글자로 쓴다 */
export const TRANSLATION_LANGUAGES: readonly { readonly code: string; readonly label: string }[] = [
  { code: 'ko', label: '한국어' },
  { code: 'en', label: 'English' },
  { code: 'ja', label: '日本語' },
  { code: 'zh', label: '中文' },
]

export function languageLabel(code: string): string {
  return TRANSLATION_LANGUAGES.find((language) => language.code === code)?.label ?? code
}
