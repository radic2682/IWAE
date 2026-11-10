import { useSyncExternalStore } from 'react'
import { BAR_ZOOM_DEFAULT, clampBarZoom } from '../core/barZoom'
import { sanitizeOverrides, setShortcutOverrides } from '../core/shortcutRegistry'
import { DEFAULT_HIGHLIGHT_COLORS, parseHighlightColors, type HighlightColorDef } from '../core/highlightColors'

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
  /** 펼친 라이브러리 보기: 목록(표) 또는 카드 */
  readonly libraryView: 'list' | 'grid'
  /** 형광펜 색 목록(순서 = 선택 순서, 첫 색 = 새 형광펜의 기본 색). 문서에는 id 만 저장된다 */
  readonly highlightColors: readonly HighlightColorDef[]
  /** 바꾼 단축키: 명령 id → 키 조합(빈 글자 = 키 없음). 없는 id 는 기본값(core/shortcutRegistry) */
  readonly shortcuts: Readonly<Record<string, string>>
}

const DEFAULT_FLAGS: AppFlagPrefs = { singleKeyShortcuts: true, mouseGestures: true, autoIndex: true, ocr: true }
export const DEFAULT_APP_PREFS: AppPrefs = { ...DEFAULT_FLAGS, leftBarZoom: BAR_ZOOM_DEFAULT, rightBarZoom: BAR_ZOOM_DEFAULT, libraryZoom: BAR_ZOOM_DEFAULT, libraryView: 'list', highlightColors: DEFAULT_HIGHLIGHT_COLORS, shortcuts: {} }
const KEY = 'iwae:app-prefs:v1'

/** 저장된 JSON 에서 읽는다. 모르는 값·잘못된 값은 기본값, 확대는 80~150% 로 바로잡는다 */
export function parseAppPrefs(text: string | null): AppPrefs {
  try {
    const saved = JSON.parse(text ?? '{}') as Partial<Record<keyof AppPrefs, unknown>>
    const flags = Object.fromEntries(Object.entries(DEFAULT_FLAGS).map(([key, base]) => [key, typeof saved[key as keyof AppFlagPrefs] === 'boolean' ? saved[key as keyof AppFlagPrefs] : base])) as unknown as AppFlagPrefs
    return { ...flags, leftBarZoom: clampBarZoom(saved.leftBarZoom), rightBarZoom: clampBarZoom(saved.rightBarZoom), libraryZoom: clampBarZoom(saved.libraryZoom), libraryView: saved.libraryView === 'grid' ? 'grid' : 'list', highlightColors: parseHighlightColors(saved.highlightColors), shortcuts: sanitizeOverrides(saved.shortcuts) }
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
setShortcutOverrides(prefs.shortcuts)
const listeners = new Set<() => void>()

export function getAppPrefs(): AppPrefs {
  return prefs
}

export function setAppPref<K extends keyof AppPrefs>(key: K, value: AppPrefs[K]): void {
  prefs = { ...prefs, [key]: key === 'leftBarZoom' || key === 'rightBarZoom' || key === 'libraryZoom' ? clampBarZoom(value) : value }
  setShortcutOverrides(prefs.shortcuts)
  try { window.localStorage.setItem(KEY, JSON.stringify(prefs)) } catch { /* 이번 실행만 */ }
  for (const listener of listeners) listener()
}

/**
 * 다른 창(같은 앱의 떼어 낸 창·새 창)이 설정을 바꾸면 localStorage 의 storage 이벤트가 온다.
 * 그때 다시 읽어 이 창의 화면도 바로 따라가게 한다.
 */
if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
  window.addEventListener('storage', (event) => {
    if (event.key !== KEY && event.key !== null) return
    prefs = read()
    setShortcutOverrides(prefs.shortcuts)
    for (const listener of listeners) listener()
  })
}

export function subscribeAppPrefs(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

export function useAppPrefs(): AppPrefs {
  return useSyncExternalStore(subscribeAppPrefs, () => prefs, () => prefs)
}
