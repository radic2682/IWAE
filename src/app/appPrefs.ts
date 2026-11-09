import { useSyncExternalStore } from 'react'

/**
 * 앱 동작 설정(이 PC 에만, localStorage). 설정 창의 「단축키·마우스」「검색·OCR」이 바꾸고,
 * 도구줄·마우스 제스처·색인·OCR 이 읽는다.
 */
export interface AppPrefs {
  /** 한 글자 도구 단축키(T·P·L·A·R·O·E) */
  readonly singleKeyShortcuts: boolean
  /** 오른쪽 버튼으로 그리는 마우스 제스처 */
  readonly mouseGestures: boolean
  /** Vault 를 열 때 모든 PDF 의 글자를 미리 읽어 검색 색인을 만든다 */
  readonly autoIndex: boolean
  /** 글자 층이 없는 쪽(스캔)을 OCR 로 읽는다: 검색 색인, 영역 캡처의 글자 */
  readonly ocr: boolean
}

export const DEFAULT_APP_PREFS: AppPrefs = { singleKeyShortcuts: true, mouseGestures: true, autoIndex: true, ocr: true }
const KEY = 'iwae:app-prefs:v1'

function read(): AppPrefs {
  try {
    const saved = JSON.parse(window.localStorage.getItem(KEY) ?? '{}') as Partial<Record<keyof AppPrefs, unknown>>
    return Object.fromEntries(Object.entries(DEFAULT_APP_PREFS).map(([key, base]) => [key, typeof saved[key as keyof AppPrefs] === 'boolean' ? saved[key as keyof AppPrefs] : base])) as unknown as AppPrefs
  } catch {
    return { ...DEFAULT_APP_PREFS }
  }
}

let prefs: AppPrefs = read()
const listeners = new Set<() => void>()

export function getAppPrefs(): AppPrefs {
  return prefs
}

export function setAppPref<K extends keyof AppPrefs>(key: K, value: AppPrefs[K]): void {
  prefs = { ...prefs, [key]: value }
  try { window.localStorage.setItem(KEY, JSON.stringify(prefs)) } catch { /* 이번 실행만 */ }
  for (const listener of listeners) listener()
}

export function useAppPrefs(): AppPrefs {
  return useSyncExternalStore((listener) => { listeners.add(listener); return () => listeners.delete(listener) }, () => prefs, () => prefs)
}
