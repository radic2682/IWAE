import { useSyncExternalStore } from 'react'
import { BAR_ZOOM_DEFAULT, clampBarZoom } from '../core/barZoom'

/**
 * 앱 동작 설정(이 PC 에만, localStorage). 설정 창의 「단축키·마우스」「검색·OCR」이 바꾸고,
 * 도구줄·마우스 제스처·색인·OCR 이 읽는다.
 */
export interface AppFlagPrefs {
  /** 한 글자 도구 단축키(T·P·L·A·R·O·E) */
  readonly singleKeyShortcuts: boolean
  /** 오른쪽 버튼으로 그리는 마우스 제스처 */
  readonly mouseGestures: boolean
  /** Vault 를 열 때 모든 PDF 의 글자를 미리 읽어 검색 색인을 만든다 */
  readonly autoIndex: boolean
  /** 글자 층이 없는 쪽(스캔)을 OCR 로 읽는다: 검색 색인, 영역 캡처의 글자 */
  readonly ocr: boolean
}

export interface AppPrefs extends AppFlagPrefs {
  /** 왼쪽 바 안쪽 확대(Ctrl+휠, 0.8~1.5) */
  readonly leftBarZoom: number
  /** 오른쪽 노트 바 안쪽 확대(Ctrl+휠, 0.8~1.5) */
  readonly rightBarZoom: number
  /** 펼친 라이브러리(PDF 관리 화면) 안쪽 확대(Ctrl+휠, 0.8~1.5). 왼쪽 바와 따로 쓴다 */
  readonly libraryZoom: number
}

const DEFAULT_FLAGS: AppFlagPrefs = { singleKeyShortcuts: true, mouseGestures: true, autoIndex: true, ocr: true }
export const DEFAULT_APP_PREFS: AppPrefs = { ...DEFAULT_FLAGS, leftBarZoom: BAR_ZOOM_DEFAULT, rightBarZoom: BAR_ZOOM_DEFAULT, libraryZoom: BAR_ZOOM_DEFAULT }
const KEY = 'iwae:app-prefs:v1'

/** 저장된 JSON 에서 읽는다. 모르는 값·잘못된 값은 기본값, 확대는 80~150% 로 바로잡는다 */
export function parseAppPrefs(text: string | null): AppPrefs {
  try {
    const saved = JSON.parse(text ?? '{}') as Partial<Record<keyof AppPrefs, unknown>>
    const flags = Object.fromEntries(Object.entries(DEFAULT_FLAGS).map(([key, base]) => [key, typeof saved[key as keyof AppFlagPrefs] === 'boolean' ? saved[key as keyof AppFlagPrefs] : base])) as unknown as AppFlagPrefs
    return { ...flags, leftBarZoom: clampBarZoom(saved.leftBarZoom), rightBarZoom: clampBarZoom(saved.rightBarZoom), libraryZoom: clampBarZoom(saved.libraryZoom) }
  } catch {
    return { ...DEFAULT_APP_PREFS }
  }
}

function read(): AppPrefs {
  try {
    return parseAppPrefs(window.localStorage.getItem(KEY))
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
  prefs = { ...prefs, [key]: key === 'leftBarZoom' || key === 'rightBarZoom' || key === 'libraryZoom' ? clampBarZoom(value) : value }
  try { window.localStorage.setItem(KEY, JSON.stringify(prefs)) } catch { /* 이번 실행만 */ }
  for (const listener of listeners) listener()
}

export function useAppPrefs(): AppPrefs {
  return useSyncExternalStore((listener) => { listeners.add(listener); return () => listeners.delete(listener) }, () => prefs, () => prefs)
}
